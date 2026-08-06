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
const prisma  = require('../config/prisma');
const { proteger } = require('../middleware/auth');
const {
  imprimirRecibo, abrirCajon, probarConexion, generarEtiquetaProducto, imprimirBuffer,
  generarRecibo, generarComandoCajon, generarTicketPrueba,
} = require('../utils/impresoraEscPos');

// Todos los endpoints requieren sesión válida
router.use(proteger);

// ── GET /api/impresora/config ─────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const cfg = await prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: {
        impresoraModo:       true,
        impresoraHabilitada: true,
        impresoraIp:         true,
        impresoraPuerto:     true,
        impresoraAncho:      true,
        cajaDineroHabilitada: true,
        impresionAutoReciboPos: true,
        impresionAutoMobile: true,
        impresoraCocinaHabilitada: true,
        impresoraCocinaIp:         true,
        impresoraCocinaPuerto:     true,
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
      impresoraModo,
      impresoraHabilitada,
      impresoraIp,
      impresoraPuerto,
      impresoraAncho,
      cajaDineroHabilitada,
      impresionAutoReciboPos,
      impresionAutoMobile,
      impresoraCocinaHabilitada,
      impresoraCocinaIp,
      impresoraCocinaPuerto,
    } = req.body;

    const data = {};
    if (impresoraModo !== undefined) {
      data.impresoraModo = ['ninguna', 'red', 'usb'].includes(impresoraModo) ? impresoraModo : 'ninguna';
    }
    if (impresoraHabilitada   !== undefined) data.impresoraHabilitada   = Boolean(impresoraHabilitada);
    if (impresoraIp           !== undefined) data.impresoraIp           = impresoraIp?.trim() || null;
    if (impresoraPuerto       !== undefined) data.impresoraPuerto       = parseInt(impresoraPuerto) || 9100;
    if (impresoraAncho        !== undefined) data.impresoraAncho        = parseInt(impresoraAncho) || 80;
    if (cajaDineroHabilitada  !== undefined) data.cajaDineroHabilitada  = Boolean(cajaDineroHabilitada);
    if (impresionAutoReciboPos !== undefined) data.impresionAutoReciboPos = Boolean(impresionAutoReciboPos);
    if (impresionAutoMobile   !== undefined) data.impresionAutoMobile   = Boolean(impresionAutoMobile);
    // Impresora de cocina (módulo Mesas y Comandas) — equipo físico distinto
    // al de la impresora principal, por eso IP/puerto separados.
    if (impresoraCocinaHabilitada !== undefined) data.impresoraCocinaHabilitada = Boolean(impresoraCocinaHabilitada);
    if (impresoraCocinaIp         !== undefined) data.impresoraCocinaIp         = impresoraCocinaIp?.trim() || null;
    if (impresoraCocinaPuerto     !== undefined) data.impresoraCocinaPuerto     = parseInt(impresoraCocinaPuerto) || 9100;

    await prisma.configuracion_sistema.upsert({
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
    const cfg = await prisma.configuracion_sistema.findUnique({
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
      doc = await prisma.notas_venta.findFirst({
        where: { id: docId, empresaId: req.empresa.id },
      });
    } else if (tipo === 'factura') {
      doc = await prisma.facturas.findFirst({
        where: { id: docId, empresaId: req.empresa.id },
      });
    } else {
      return res.status(400).json({ success: false, mensaje: 'Tipo de documento no válido' });
    }

    if (!doc) {
      return res.status(404).json({ success: false, mensaje: 'Documento no encontrado' });
    }

    // 3. Cargar datos de la empresa
    const emp = await prisma.configuracion_sri.findFirst({
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
    const cfg = await prisma.configuracion_sistema.findUnique({
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
    const encontrados = await prisma.productos_servicios.findMany({
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

// Arma el buffer combinado de etiquetas a partir del body { productos, ancho }
// — compartido por /etiquetas/imprimir (TCP) y /etiquetas/generar (bytes
// crudos para WebUSB).
async function construirBufferEtiquetas(req, anchoDefault) {
  const { productos = [], ancho } = req.body || {};
  if (!Array.isArray(productos) || productos.length === 0) {
    const err = new Error('Debes indicar al menos un producto');
    err.status = 400;
    throw err;
  }

  const anchoFinal = parseInt(ancho, 10) || anchoDefault || 80;

  const ids = productos.map((p) => parseInt(p.productoId, 10)).filter(Boolean);
  const encontrados = await prisma.productos_servicios.findMany({
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
    const err = new Error('Ninguno de los productos indicados existe');
    err.status = 404;
    throw err;
  }

  return { buffer: Buffer.concat(buffers), totalEtiquetas };
}

// ── POST /api/impresora/etiquetas/imprimir (modo red — TCP) ───
router.post('/etiquetas/imprimir', async (req, res) => {
  try {
    const cfg = await prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: { impresoraHabilitada: true, impresoraIp: true, impresoraPuerto: true, impresoraAncho: true },
    });

    if (!cfg?.impresoraHabilitada || !cfg?.impresoraIp) {
      return res.status(400).json({
        success: false,
        mensaje: 'Impresora no configurada. Ve a Configuración → Impresora.',
      });
    }

    const { buffer, totalEtiquetas } = await construirBufferEtiquetas(req, cfg.impresoraAncho);
    await imprimirBuffer(cfg.impresoraIp, cfg.impresoraPuerto || 9100, buffer);

    res.json({ success: true, mensaje: `${totalEtiquetas} etiqueta(s) enviada(s) a la impresora` });
  } catch (err) {
    console.error('POST /impresora/etiquetas/imprimir:', err);
    res.status(err.status || 500).json({ success: false, mensaje: err.message || 'Error al imprimir las etiquetas' });
  }
});

// ── POST /api/impresora/etiquetas/generar (modo usb — bytes crudos) ───
// Devuelve el buffer ESC/POS ya armado para que el navegador lo mande por
// WebUSB — no requiere impresoraIp (irrelevante en modo USB), solo que el
// módulo esté habilitado.
router.post('/etiquetas/generar', async (req, res) => {
  try {
    const cfg = await prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: { impresoraHabilitada: true, impresoraAncho: true },
    });

    if (!cfg?.impresoraHabilitada) {
      return res.status(400).json({
        success: false,
        mensaje: 'Impresora no habilitada. Ve a Configuración → Impresora.',
      });
    }

    const { buffer } = await construirBufferEtiquetas(req, cfg.impresoraAncho);
    res.set('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (err) {
    console.error('POST /impresora/etiquetas/generar:', err);
    res.status(err.status || 500).json({ success: false, mensaje: err.message || 'Error al generar las etiquetas' });
  }
});

// ── POST /api/impresora/recibo/:tipo/:id/generar (modo usb) ───
// Mismo documento/empresa que /recibo/:tipo/:id (TCP), pero devuelve el
// buffer crudo en vez de mandarlo por TCP.
router.post('/recibo/:tipo/:id/generar', async (req, res) => {
  const { tipo, id } = req.params;
  try {
    const cfg = await prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: { impresoraHabilitada: true, impresoraAncho: true, cajaDineroHabilitada: true },
    });

    if (!cfg?.impresoraHabilitada) {
      return res.status(400).json({
        success: false,
        mensaje: 'Impresora no habilitada. Ve a Configuración → Impresora.',
      });
    }

    const docId = parseInt(id, 10);
    let doc;
    if (tipo === 'nota_venta') {
      doc = await prisma.notas_venta.findFirst({ where: { id: docId, empresaId: req.empresa.id } });
    } else if (tipo === 'factura') {
      doc = await prisma.facturas.findFirst({ where: { id: docId, empresaId: req.empresa.id } });
    } else {
      return res.status(400).json({ success: false, mensaje: 'Tipo de documento no válido' });
    }
    if (!doc) return res.status(404).json({ success: false, mensaje: 'Documento no encontrado' });

    const emp = await prisma.configuracion_sri.findFirst({
      where: { empresaId: req.empresa.id },
      select: { razonSocial: true, ruc: true, dirMatriz: true, nombreComercial: true, emailNotificaciones: true },
    });
    const empData = {
      razonSocial:     emp?.razonSocial     || req.empresa.razonSocial     || '',
      nombreComercial: emp?.nombreComercial || req.empresa.nombreComercial || '',
      ruc:             emp?.ruc             || req.empresa.ruc            || '',
      dirMatriz:       emp?.dirMatriz       || '',
      emailFactura:    emp?.emailNotificaciones || '',
    };

    const buffer = generarRecibo({ ...doc, tipo }, empData, cfg.impresoraAncho || 80, cfg.cajaDineroHabilitada);
    res.set('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (err) {
    console.error(`POST /impresora/recibo/${tipo}/${id}/generar:`, err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al generar el recibo' });
  }
});

// ── POST /api/impresora/cajon/generar (modo usb) ──────────────
router.post('/cajon/generar', async (req, res) => {
  try {
    const cfg = await prisma.configuracion_sistema.findUnique({
      where: { empresaId: req.empresa.id },
      select: { cajaDineroHabilitada: true },
    });
    if (!cfg?.cajaDineroHabilitada) {
      return res.status(400).json({ success: false, mensaje: 'Cajón de dinero no habilitado' });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.send(generarComandoCajon());
  } catch (err) {
    console.error('POST /impresora/cajon/generar:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al generar el comando del cajón' });
  }
});

// ── GET /api/impresora/prueba/generar (modo usb) ──────────────
// Ticket corto de prueba — usado por el botón "Probar impresión" en modo USB.
router.get('/prueba/generar', async (req, res) => {
  try {
    const ancho = parseInt(req.query.ancho, 10) || 80;
    res.set('Content-Type', 'application/octet-stream');
    res.send(generarTicketPrueba(ancho));
  } catch (err) {
    console.error('GET /impresora/prueba/generar:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al generar el ticket de prueba' });
  }
});

module.exports = router;
