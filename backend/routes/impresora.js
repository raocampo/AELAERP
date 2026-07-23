// ============================================================
// AELA — Rutas de impresora térmica POS
// GET  /api/impresora/config          → leer configuración
// PUT  /api/impresora/config          → guardar configuración
// POST /api/impresora/test            → probar conexión TCP
// POST /api/impresora/recibo/:tipo/:id → imprimir recibo
// POST /api/impresora/cajon           → abrir cajón de dinero
// ============================================================
const express = require('express');
const router  = express.Router();
const { proteger } = require('../middleware/auth');
const { imprimirRecibo, abrirCajon, probarConexion, generarEtiquetaProducto, imprimirBuffer } = require('../utils/impresoraEscPos');

// Todos los endpoints requieren sesión válida
router.use(proteger);

// ── GET /api/impresora/config ─────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const cfg = await req.prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: {
        impresoraHabilitada: true,
        impresoraIp:         true,
        impresoraPuerto:     true,
        impresoraAncho:      true,
        cajaDineroHabilitada: true,
        impresionAutoReciboPos: true,
        impresionAutoMobile: true,
      },
    });
    res.json({ success: true, data: cfg || {} });
  } catch (err) {
    console.error('GET /impresora/config:', err);
    res.status(500).json({ success: false, mensaje: 'Error al leer la configuración de impresora' });
  }
});

// ── PUT /api/impresora/config ─────────────────────────────────
router.put('/config', async (req, res) => {
  try {
    const {
      impresoraHabilitada,
      impresoraIp,
      impresoraPuerto,
      impresoraAncho,
      cajaDineroHabilitada,
      impresionAutoReciboPos,
      impresionAutoMobile,
    } = req.body;

    const data = {};
    if (impresoraHabilitada   !== undefined) data.impresoraHabilitada   = Boolean(impresoraHabilitada);
    if (impresoraIp           !== undefined) data.impresoraIp           = impresoraIp?.trim() || null;
    if (impresoraPuerto       !== undefined) data.impresoraPuerto       = parseInt(impresoraPuerto) || 9100;
    if (impresoraAncho        !== undefined) data.impresoraAncho        = parseInt(impresoraAncho) || 80;
    if (cajaDineroHabilitada  !== undefined) data.cajaDineroHabilitada  = Boolean(cajaDineroHabilitada);
    if (impresionAutoReciboPos !== undefined) data.impresionAutoReciboPos = Boolean(impresionAutoReciboPos);
    if (impresionAutoMobile   !== undefined) data.impresionAutoMobile   = Boolean(impresionAutoMobile);

    await req.prisma.configuracion_sistema.upsert({
      where: { empresaId: req.empresa.id },
      update: data,
      create: { empresaId: req.empresa.id, ...data },
    });

    res.json({ success: true, mensaje: 'Configuración de impresora guardada' });
  } catch (err) {
    console.error('PUT /impresora/config:', err);
    res.status(500).json({ success: false, mensaje: 'Error al guardar la configuración' });
  }
});

// ── POST /api/impresora/test ──────────────────────────────────
router.post('/test', async (req, res) => {
  const { ip, puerto = 9100 } = req.body;
  try {
    await probarConexion(ip?.trim(), parseInt(puerto));
    res.json({ success: true, mensaje: `Conexión exitosa con ${ip}:${puerto}` });
  } catch (err) {
    res.status(400).json({ success: false, mensaje: err.message });
  }
});

// ── POST /api/impresora/recibo/:tipo/:id ──────────────────────
// tipo = 'nota_venta' | 'factura'
router.post('/recibo/:tipo/:id', async (req, res) => {
  const { tipo, id } = req.params;
  try {
    // 1. Leer config de impresora
    const cfg = await req.prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: {
        impresoraHabilitada: true,
        impresoraIp:         true,
        impresoraPuerto:     true,
        impresoraAncho:      true,
        cajaDineroHabilitada: true,
      },
    });

    if (!cfg?.impresoraHabilitada || !cfg?.impresoraIp) {
      return res.status(400).json({
        success: false,
        mensaje: 'Impresora no configurada. Ve a Configuración → Impresora.',
      });
    }

    // 2. Cargar el documento
    let doc;
    const docId = parseInt(id);

    if (tipo === 'nota_venta') {
      doc = await req.prisma.notas_venta.findFirst({
        where: { id: docId, empresaId: req.empresa.id },
      });
    } else if (tipo === 'factura') {
      doc = await req.prisma.facturas.findFirst({
        where: { id: docId, empresaId: req.empresa.id },
      });
    } else {
      return res.status(400).json({ success: false, mensaje: 'Tipo de documento no válido' });
    }

    if (!doc) {
      return res.status(404).json({ success: false, mensaje: 'Documento no encontrado' });
    }

    // 3. Cargar datos de la empresa
    const emp = await req.prisma.configuracion_sri.findFirst({
      where: { empresaId: req.empresa.id },
      select: {
        razonSocial: true, ruc: true, dirMatriz: true,
        nombreComercial: true, emailNotificaciones: true,
      },
    });

    const empData = {
      razonSocial:   emp?.razonSocial   || req.empresa.razonSocial || '',
      nombreComercial: emp?.nombreComercial || req.empresa.nombreComercial || '',
      ruc:           emp?.ruc            || req.empresa.ruc || '',
      dirMatriz:     emp?.dirMatriz      || '',
      emailFactura:  emp?.emailNotificaciones || '',
    };

    // 4. Enviar a impresora
    await imprimirRecibo(
      { ...doc, tipo },
      empData,
      {
        ip:         cfg.impresoraIp,
        puerto:     cfg.impresoraPuerto || 9100,
        ancho:      cfg.impresoraAncho  || 80,
        cajaDinero: cfg.cajaDineroHabilitada,
      },
    );

    res.json({ success: true, mensaje: 'Recibo enviado a la impresora' });
  } catch (err) {
    console.error(`POST /impresora/recibo/${tipo}/${id}:`, err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al imprimir' });
  }
});

// ── POST /api/impresora/cajon ─────────────────────────────────
router.post('/cajon', async (req, res) => {
  try {
    const cfg = await req.prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: { impresoraIp: true, impresoraPuerto: true, cajaDineroHabilitada: true },
    });

    if (!cfg?.cajaDineroHabilitada || !cfg?.impresoraIp) {
      return res.status(400).json({
        success: false,
        mensaje: 'Cajón de dinero no habilitado o impresora no configurada',
      });
    }

    await abrirCajon(cfg.impresoraIp, cfg.impresoraPuerto || 9100);
    res.json({ success: true, mensaje: 'Cajón de dinero abierto' });
  } catch (err) {
    console.error('POST /impresora/cajon:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al abrir el cajón' });
  }
});

// ── POST /api/impresora/etiquetas/preview ─────────────────────
// No imprime — devuelve los datos ya resueltos (nombre, código usado, precio)
// para que el frontend renderice una vista previa en HTML/CSS.
router.post('/etiquetas/preview', async (req, res) => {
  try {
    const { productos = [] } = req.body || {};
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debes indicar al menos un producto' });
    }

    const ids = productos.map((p) => parseInt(p.productoId, 10)).filter(Boolean);
    const encontrados = await req.prisma.productos_servicios.findMany({
      where: { id: { in: ids }, empresaId: req.empresa.id },
      select: { id: true, codigoPrincipal: true, codigoAuxiliar: true, nombre: true, precioUnitario: true },
    });
    const porId = new Map(encontrados.map((p) => [p.id, p]));

    const data = productos.map((p) => {
      const prod = porId.get(parseInt(p.productoId, 10));
      if (!prod) return null;
      return {
        productoId: prod.id,
        codigoUsado: prod.codigoAuxiliar || prod.codigoPrincipal,
        nombre: prod.nombre,
        precioUnitario: Number(prod.precioUnitario || 0),
        cantidad: Math.max(1, parseInt(p.cantidad, 10) || 1),
      };
    }).filter(Boolean);

    res.json({ success: true, data });
  } catch (err) {
    console.error('POST /impresora/etiquetas/preview:', err);
    res.status(500).json({ success: false, mensaje: 'Error al generar la vista previa' });
  }
});

// ── POST /api/impresora/etiquetas/imprimir ────────────────────
router.post('/etiquetas/imprimir', async (req, res) => {
  try {
    const { productos = [], ancho } = req.body || {};
    if (!Array.isArray(productos) || productos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debes indicar al menos un producto' });
    }

    const cfg = await req.prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: { impresoraHabilitada: true, impresoraIp: true, impresoraPuerto: true, impresoraAncho: true },
    });

    if (!cfg?.impresoraHabilitada || !cfg?.impresoraIp) {
      return res.status(400).json({
        success: false,
        mensaje: 'Impresora no configurada. Ve a Configuración → Impresora.',
      });
    }

    const anchoFinal = parseInt(ancho, 10) || cfg.impresoraAncho || 80;

    const ids = productos.map((p) => parseInt(p.productoId, 10)).filter(Boolean);
    const encontrados = await req.prisma.productos_servicios.findMany({
      where: { id: { in: ids }, empresaId: req.empresa.id },
      select: { id: true, codigoPrincipal: true, codigoAuxiliar: true, nombre: true, precioUnitario: true },
    });
    const porId = new Map(encontrados.map((p) => [p.id, p]));

    const buffers = [];
    let totalEtiquetas = 0;
    for (const p of productos) {
      const prod = porId.get(parseInt(p.productoId, 10));
      if (!prod) continue;
      const cantidad = Math.max(1, parseInt(p.cantidad, 10) || 1);
      buffers.push(generarEtiquetaProducto(prod, { ancho: anchoFinal, copias: cantidad }));
      totalEtiquetas += cantidad;
    }

    if (buffers.length === 0) {
      return res.status(404).json({ success: false, mensaje: 'Ninguno de los productos indicados existe' });
    }

    await imprimirBuffer(cfg.impresoraIp, cfg.impresoraPuerto || 9100, Buffer.concat(buffers));

    res.json({ success: true, mensaje: `${totalEtiquetas} etiqueta(s) enviada(s) a la impresora` });
  } catch (err) {
    console.error('POST /impresora/etiquetas/imprimir:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al imprimir las etiquetas' });
  }
});

module.exports = router;
