// ====================================
// RUTAS: FACTURACIÓN ELECTRÓNICA SRI — AELA
// backend/routes/facturas.js
// ====================================

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const prisma  = require('../config/prisma');
const sri     = require('../utils/sri');
const { registrarAuditoria } = require('../utils/auditoria');
const {
  crearAsientoFacturaAutorizada,
  crearAsientoNotaCreditoEmitida,
  crearAsientoReversoFacturaAnulada,
} = require('../utils/contabilidad');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { construirConfiguracionSriBase } = require('../utils/sriContribuyente');
const { siguienteSecuencial } = require('../utils/secuenciales');
const { registrarMovimientoCaja } = require('../utils/caja');
const { aplicarMovimientosVentaDesdeDetalles } = require('../utils/inventario');
const { esErrorConectividad } = require('../utils/colaSRI');

// Aplicar autenticación JWT a todas las rutas
router.use(proteger);

const permitirConfigurarSri = autorizarPermiso('sri.configurar');
const permitirVerFacturacion = autorizarPermiso('facturacion.ver');
const permitirEmitirFacturacion = autorizarPermiso('facturacion.emitir');
const permitirAnularFacturacion = autorizarPermiso('facturacion.anular');
const permitirReportesTributarios = autorizarPermiso('tributario.reportes');

// ─── Carpetas necesarias ────────────────────────────────────────────────────
const DIR_FACTURAS      = path.join(__dirname, '..', 'uploads', 'facturas');
const DIR_CERTIFICADOS  = path.join(__dirname, '..', 'uploads', 'certificados');
const DIR_LOGOS         = path.join(__dirname, '..', 'uploads', 'logos');
[DIR_FACTURAS, DIR_CERTIFICADOS, DIR_LOGOS].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Multer para .p12 ───────────────────────────────────────────────────────
const storageCert = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIR_CERTIFICADOS),
  filename:    (req, file, cb) => cb(null, `certificado-${Date.now()}.p12`),
});
const uploadCert = multer({
  storage: storageCert,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.p12', '.pfx'].includes(ext)) cb(null, true);
    else cb(new Error('Solo se aceptan archivos .p12 o .pfx'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ─── Multer para logo (memoria → base64 en BD, sin escribir a disco) ─────────
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) cb(null, true);
    else cb(new Error('Solo se aceptan imágenes (png, jpg, jpeg, gif, webp)'));
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

// ─── Helper: obtener configuración SRI activa ────────────────────────────────
async function getConfigSRI(empresaId) {
  return prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
}

async function getConfigSRIEditable(empresaId) {
  const existente = await getConfigSRI(empresaId);
  if (existente) return existente;

  const empresa = await prisma.empresas.findUnique({
    where: { id: empresaId },
  });
  if (!empresa) return null;

  return construirConfiguracionSriBase(empresa);
}

// ─── Helper: ejecutar flujo SRI completo ────────────────────────────────────
async function procesarFacturaEnSRI(facturaId, xmlGenerado, config) {
  try {
    // Si usa token físico, el usuario firma manualmente — no procesar aquí
    if (config.tipoCertificado === 'token') {
      return; // Queda en PENDIENTE_FIRMA hasta que el usuario suba el XML firmado
    }
    // Leer certificado P12
    if (!config.certificadoP12 || !fs.existsSync(config.certificadoP12)) {
      return; // Sin certificado → queda en PENDIENTE_FIRMA
    }

    const p12Buffer = fs.readFileSync(config.certificadoP12);
    const claveP12  = config.claveCertificado || '';

    // Firmar
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, claveP12);
    await prisma.facturas.update({
      where: { id: facturaId },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    // Enviar al SRI
    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.facturas.update({
        where: { id: facturaId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    // Autorizar — el SRI necesita unos segundos para procesar tras la recepción.
    // Reintentar hasta 5 veces con pausa de 4 s entre intentos.
    const factura = await prisma.facturas.findUnique({ where: { id: facturaId } });
    let autorizacion = null;
    for (let intento = 0; intento < 5; intento++) {
      if (intento > 0) await new Promise(r => setTimeout(r, 4000));
      autorizacion = await sri.autorizarComprobanteSRI(factura.claveAcceso, config.ambiente);
      // Si hay resultado concluyente (autorizado o mensajes de error reales), salir del loop
      if (autorizacion.autorizado || (autorizacion.mensajes && autorizacion.mensajes.length > 0)) break;
    }

    if (autorizacion.autorizado) {
      // Generar RIDE PDF
      const pdfPath = path.join(DIR_FACTURAS, `factura-${facturaId}.pdf`);
      await sri.generarRIDEFactura(
        { ...factura, xmlAutorizado: autorizacion.xmlAutorizado },
        config,
        pdfPath
      );
      const pdfUrl = `/uploads/facturas/factura-${facturaId}.pdf`;

      await prisma.facturas.update({
        where: { id: facturaId },
        data: {
          estadoSri:         'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado,
          mensajesSri:        { autorizacion: autorizacion.estado },
          pdfUrl,
        },
      });

      try {
        await crearAsientoFacturaAutorizada({
          facturaId,
          usuarioId: factura.emisorId,
          fecha: factura.fechaEmision || new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento automático de factura:', contErr.message);
      }
    } else {
      // Si hay mensajes de rechazo reales del SRI → RECHAZADO definitivo
      // Si la respuesta está vacía (SRI aún procesando) → FIRMADO_PENDIENTE_ENVIO para reintento
      const esRechazoReal = autorizacion.mensajes && autorizacion.mensajes.length > 0;
      await prisma.facturas.update({
        where: { id: facturaId },
        data: {
          estadoSri:   esRechazoReal ? 'RECHAZADO' : 'FIRMADO_PENDIENTE_ENVIO',
          mensajesSri: { recepcion, autorizacion: autorizacion.mensajes },
        },
      });
    }
  } catch (err) {
    console.error('Error en flujo SRI:', err.message);
    const nuevoEstado = esErrorConectividad(err) ? 'FIRMADO_PENDIENTE_ENVIO' : 'RECHAZADO';
    if (nuevoEstado === 'FIRMADO_PENDIENTE_ENVIO') {
      console.log(`[SRI] Factura #${facturaId} queda en cola — sin internet (${err.code || err.message})`);
    }
    await prisma.facturas.update({
      where: { id: facturaId },
      data:  { estadoSri: nuevoEstado, mensajesSri: { error: err.message, code: err.code } },
    }).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN SRI
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas/configuracion
router.get('/configuracion', permitirConfigurarSri, async (req, res) => {
  try {
    const config = await getConfigSRIEditable(req.empresa.id);
    res.json({ ok: true, data: config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/facturas/configuracion
router.put('/configuracion', permitirConfigurarSri, async (req, res) => {
  try {
    const {
      ruc, razonSocial, nombreComercial, dirMatriz, dirEstablecimiento,
      establecimiento, puntoEmision, ambiente, contribuyenteEspecial,
      contribuyenteRimpe, negocioPopular,
      obligadoContabilidad, agenteRetencion, emailNotificaciones, telefono,
      tipoCertificado,
    } = req.body;

    const fields = {
      empresaId:            req.empresa.id,
      ruc, razonSocial, nombreComercial, dirMatriz, dirEstablecimiento,
      establecimiento:      establecimiento || '001',
      puntoEmision:         puntoEmision    || '001',
      ambiente:             parseInt(ambiente) || 1,
      contribuyenteEspecial: contribuyenteEspecial || null,
      contribuyenteRimpe:   !!contribuyenteRimpe,
      negocioPopular:       !!negocioPopular,
      obligadoContabilidad: !!obligadoContabilidad,
      agenteRetencion:      agenteRetencion || null,
      emailNotificaciones:  emailNotificaciones || null,
      telefono:             telefono || null,
      tipoCertificado:      ['archivo', 'token'].includes(tipoCertificado) ? tipoCertificado : 'archivo',
      activo:               true,
    };

    const existing = await getConfigSRI(req.empresa.id);
    let config;
    if (existing) {
      config = await prisma.configuracion_sri.update({ where: { id: existing.id }, data: fields });
    } else {
      config = await prisma.configuracion_sri.create({ data: fields });
    }

    await prisma.empresas.update({
      where: { id: req.empresa.id },
      data: {
        ruc,
        razonSocial,
        nombreComercial: nombreComercial || null,
        direccion: dirMatriz || null,
        email: emailNotificaciones || null,
        telefono: telefono || null,
      },
    });

    await registrarAuditoria({ usuarioId: req.usuario.id, accion: 'UPDATE', tabla: 'configuracion_sri', registroId: config.id, req });
    res.json({ ok: true, data: config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/logo
// Convierte la imagen a data URI (base64) y la guarda en la BD.
// Así el logo persiste aunque el servidor se reinicie o redeploy (Railway).
router.post('/configuracion/logo', permitirConfigurarSri, uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });

    // Construir data URI directamente desde el buffer en memoria
    const mime    = req.file.mimetype || 'image/png';
    const b64     = req.file.buffer.toString('base64');
    const logoUrl = `data:${mime};base64,${b64}`;

    await prisma.configuracion_sri.update({ where: { id: config.id }, data: { logoUrl } });
    res.json({ ok: true, data: { logoUrl } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/certificado
router.post('/configuracion/certificado', permitirConfigurarSri, uploadCert.single('certificado'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo .p12' });

  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });

    // Eliminar certificado anterior
    if (config.certificadoP12 && fs.existsSync(config.certificadoP12)) {
      fs.unlinkSync(config.certificadoP12);
    }

    const updated = await prisma.configuracion_sri.update({
      where: { id: config.id },
      data: {
        certificadoP12:  req.file.path,
        claveCertificado: req.body.clave || '',
      },
    });
    res.json({ ok: true, data: { certificadoCargado: true, archivo: req.file.filename } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/facturas/configuracion/certificado
router.delete('/configuracion/certificado', permitirConfigurarSri, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (config?.certificadoP12 && fs.existsSync(config.certificadoP12)) {
      fs.unlinkSync(config.certificadoP12);
    }
    await prisma.configuracion_sri.update({
      where: { id: config.id },
      data:  { certificadoP12: null, claveCertificado: null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// FACTURAS — CRUD
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas  — lista con filtros opcionales
router.get('/', permitirVerFacturacion, async (req, res) => {
  try {
    const { estado, clienteId, fechaDesde, fechaHasta, busqueda } = req.query;
    const where = { empresaId: req.empresa.id };
    if (estado)    where.estadoSri = estado;
    if (clienteId) where.clienteId = parseInt(clienteId);
    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) where.fechaEmision.lte = new Date(fechaHasta);
    }
    if (busqueda) {
      where.OR = [
        { numeroFactura: { contains: busqueda, mode: 'insensitive' } },
        { razonSocialComprador: { contains: busqueda, mode: 'insensitive' } },
        { identificacionComprador: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const facturas = await prisma.facturas.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        importeTotal: true, estadoSri: true, anulada: true,
        numeroAutorizacion: true, pdfUrl: true, clienteId: true,
        createdAt: true,
      },
    });

    res.json({ ok: true, data: facturas });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id
router.get('/:id', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    res.json({ ok: true, data: factura });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas  — crear factura
router.post('/', permitirEmitirFacturacion, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) {
      return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI (RUC, razón social, etc.)' });
    }

    const {
      tipoIdentificacionComprador,
      identificacionComprador,
      razonSocialComprador,
      direccionComprador,
      emailComprador,
      telefonoComprador,
      detalles,
      pagos,
      propina,
      observaciones,
      clienteId,
      fechaEmision,
    } = req.body;

    // Validaciones mínimas
    if (!tipoIdentificacionComprador || !identificacionComprador || !razonSocialComprador) {
      return res.status(400).json({ ok: false, error: 'Faltan datos del comprador' });
    }
    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ ok: false, error: 'Debe incluir al menos un detalle' });
    }

    const detallesFinales = detalles;

    // Siguiente secuencial (respeta secuencial inicial si la empresa migró desde otro sistema)
    const lastFact = await prisma.facturas.findFirst({
      where: { empresaId: req.empresa.id, rucEmisor: config.ruc },
      orderBy: { secuencial: 'desc' },
    });
    const maxEnBD = lastFact ? (parseInt(String(lastFact.secuencial), 10) || 0) : 0;
    const secuencialNum = await siguienteSecuencial(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD, 'secInicialFactura'
    );
    const secuencial = String(secuencialNum).padStart(9, '0');

    const fecha = fechaEmision ? new Date(fechaEmision) : new Date();

    // Generar clave de acceso
    const claveAcceso = sri.generarClaveAcceso({
      fecha,
      tipoCod:    '01',
      ruc:        config.ruc,
      ambiente:   config.ambiente,
      estab:      config.establecimiento,
      ptoEmi:     config.puntoEmision,
      secuencial,
    });

    const numeroFactura = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

    // Generar XML
    const { xml, totales } = sri.generarXMLFactura({
      claveAcceso, secuencial, fechaEmision: fecha,
      tipoIdentificacionComprador, identificacionComprador,
      razonSocialComprador, direccionComprador, emailComprador, telefonoComprador,
      detalles: detallesFinales, pagos, propina, observaciones,
      vendedor: req.usuario.nombre || null,
    }, config);

    // Guardar en BD
    const pagosFinales = pagos || [{ formaPago: 'Efectivo', total: totales.importeTotal }];
    const factura = await prisma.$transaction(async (tx) => {
      const creada = await tx.facturas.create({
        data: {
          empresaId: req.empresa.id,
          claveAcceso,
          numeroFactura,
          secuencial,
          rucEmisor: config.ruc,
          razonSocialEmisor: config.razonSocial,
          tipoIdentificacionComprador,
          identificacionComprador,
          razonSocialComprador,
          direccionComprador: direccionComprador || null,
          emailComprador: emailComprador || null,
          telefonoComprador: telefonoComprador || null,
          clienteId: clienteId ? parseInt(clienteId, 10) : null,
          fechaEmision: fecha,
          subtotal0: totales.subtotal0,
          subtotal5: totales.subtotal5 || 0,
          subtotal15: totales.subtotal15,
          subtotalNoObjetoIva: 0,
          totalDescuento: totales.totalDescuento,
          totalIva: totales.totalIva,
          propina: totales.propina,
          importeTotal: totales.importeTotal,
          detalles: detallesFinales,
          pagos: pagosFinales,
          estadoSri: 'PENDIENTE_FIRMA',
          xmlGenerado: xml,
          observaciones: observaciones || null,
          vendedor: req.usuario.nombre || null,
          emisorId: req.usuario.id,
        },
      });

      await aplicarMovimientosVentaDesdeDetalles({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        detalles: detallesFinales,
        tipoDocumento: 'FACTURA',
        referencia: numeroFactura,
        metadata: { facturaId: creada.id },
      });

      const totalCaja = pagosFinales.reduce((acc, pago) => acc + Number(pago.total || 0), 0) || Number(totales.importeTotal || 0);
      await registrarMovimientoCaja({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha,
        tipo: 'VENTA_FACTURA',
        monto: totalCaja,
        descripcion: `Venta por factura ${numeroFactura}`,
        referencia: numeroFactura,
        categoria: pagosFinales.map((pago) => pago.formaPago).filter(Boolean).join(', ') || null,
        origenId: creada.id,
        metadata: { facturaId: creada.id, pagos: pagosFinales },
      });

      return creada;
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'CREATE',
      tabla: 'facturas', registroId: factura.id,
      datosNuevos: { numeroFactura, importeTotal: totales.importeTotal },
      req,
    });

    // Intentar flujo SRI en segundo plano (no bloquear la respuesta)
    procesarFacturaEnSRI(factura.id, xml, config).catch(err => console.error('SRI background:', err));

    res.status(201).json({ ok: true, data: factura, mensaje: 'Factura creada. Procesando en SRI...' });
  } catch (err) {
    console.error('Error al crear factura:', err);
    if (/Stock insuficiente|Producto no encontrado/.test(err.message || '')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/:id/reenviar — reintentar envío al SRI
router.post('/:id/reenviar', permitirEmitirFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    if (factura.estadoSri === 'AUTORIZADO') {
      return res.status(400).json({ ok: false, error: 'La factura ya está autorizada' });
    }

    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Sin configuración SRI' });

    await procesarFacturaEnSRI(factura.id, factura.xmlGenerado || factura.xmlFirmado, config);
    const updated = await prisma.facturas.findUnique({ where: { id: factura.id } });
    res.json({ ok: true, data: updated, mensaje: `Estado actual: ${updated.estadoSri}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/:id/anular
router.post('/:id/anular', permitirAnularFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    if (factura.anulada) return res.status(400).json({ ok: false, error: 'La factura ya está anulada' });

    const updated = await prisma.$transaction(async (tx) => {
      const anulada = await tx.facturas.update({
        where: { id: factura.id },
        data: {
          anulada: true,
          estadoSri: 'ANULADO',
          motivoAnulacion: req.body.motivo || 'Anulada por el emisor',
        },
      });

      await aplicarMovimientosVentaDesdeDetalles({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        detalles: factura.detalles || [],
        tipoDocumento: 'FACTURA',
        referencia: factura.numeroFactura,
        metadata: { facturaId: factura.id, anulado: true },
        revertir: true,
      });

      await registrarMovimientoCaja({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha: new Date(),
        tipo: 'ANULACION_FACTURA',
        monto: Number(factura.importeTotal || 0),
        descripcion: `Anulación de factura ${factura.numeroFactura}`,
        referencia: factura.numeroFactura,
        origenId: factura.id,
        metadata: { facturaId: factura.id },
      });

      return anulada;
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'UPDATE',
      tabla: 'facturas', registroId: factura.id,
      datosAnteriores: { estadoSri: factura.estadoSri },
      datosNuevos:     { estadoSri: 'ANULADO' },
      req,
    });

    try {
      await crearAsientoReversoFacturaAnulada({
        facturaId: factura.id,
        usuarioId: req.usuario.id,
        fecha: new Date(),
      });
    } catch (contErr) {
      console.error('Error creando asiento reverso por anulación:', contErr.message);
    }

    res.json({ ok: true, data: updated, mensaje: 'Factura anulada y asiento reverso contable generado.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id/pdf — descarga RIDE PDF
router.get('/:id/pdf', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const config  = await getConfigSRI(req.empresa.id);
    const pdfPath = path.join(DIR_FACTURAS, `factura-${factura.id}.pdf`);

    // Siempre regenerar: el logo o el estado de autorización pueden haber cambiado
    await sri.generarRIDEFactura(factura, config || {}, pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-${factura.numeroFactura}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id/recibo — recibo POS (pequeño, para impresora térmica)
router.get('/:id/recibo', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const config  = await getConfigSRI(req.empresa.id);
    const pdfPath = path.join(DIR_FACTURAS, `recibo-${factura.id}.pdf`);

    // Siempre regenerar (el recibo es pequeño y cambia si se autoriza)
    await sri.generarReciboPOS(factura, config || {}, pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=recibo-${factura.numeroFactura}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id/xml — descarga XML
router.get('/:id/xml', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const xml = factura.xmlAutorizado || factura.xmlFirmado || factura.xmlGenerado;
    if (!xml) return res.status(404).json({ ok: false, error: 'Sin XML disponible' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename=factura-${factura.numeroFactura}.xml`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// NOTAS DE CRÉDITO
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas/notas-credito — lista
router.get('/notas-credito/lista', permitirVerFacturacion, async (req, res) => {
  try {
    const ncs = await prisma.notas_credito.findMany({
      where: { empresaId: req.empresa.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: ncs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/notas-credito — emitir NC contra una factura
router.post('/notas-credito', permitirEmitirFacturacion, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero el SRI' });

    const {
      facturaId,
      motivoModificacion,
      detalles,
    } = req.body;

    if (!facturaId || !motivoModificacion || !detalles?.length) {
      return res.status(400).json({ ok: false, error: 'Faltan datos para la Nota de Crédito' });
    }

    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(facturaId, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura origen no encontrada' });
    if (factura.anulada) {
      return res.status(400).json({ ok: false, error: 'No se puede emitir Nota de Crédito sobre una factura anulada' });
    }

    // Siguiente secuencial de NC (respeta secuencial inicial configurado)
    const lastNC = await prisma.notas_credito.findFirst({
      where: { empresaId: req.empresa.id },
      orderBy: { secuencial: 'desc' },
    });
    const maxEnBD_nc = lastNC ? (parseInt(String(lastNC.secuencial), 10) || 0) : 0;
    const secuencialNum_nc = await siguienteSecuencial(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD_nc, 'secInicialNotaCredito'
    );
    const secuencial = String(secuencialNum_nc).padStart(9, '0');

    const fecha = new Date();
    const claveAcceso = sri.generarClaveAcceso({
      fecha,
      tipoCod:    '04',
      ruc:        config.ruc,
      ambiente:   config.ambiente,
      estab:      config.establecimiento,
      ptoEmi:     config.puntoEmision,
      secuencial,
    });
    const numeroNC = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

    const { xml, totales } = sri.generarXMLNotaCredito({
      claveAcceso, secuencial, fechaEmision: fecha,
      tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
      identificacionComprador:     factura.identificacionComprador,
      razonSocialComprador:        factura.razonSocialComprador,
      numeroFacturaAfectada:       factura.numeroFactura,
      fechaEmisionDocSustento:     factura.fechaEmision,
      motivoModificacion,
      detalles,
    }, config);

    const nc = await prisma.notas_credito.create({
      data: {
        empresaId: req.empresa.id,
        claveAcceso, numeroNC, secuencial,
        tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
        identificacionComprador:     factura.identificacionComprador,
        razonSocialComprador:        factura.razonSocialComprador,
        facturaId:                   factura.id,
        numeroFacturaAfectada:       factura.numeroFactura,
        fechaEmisionDocSustento:     factura.fechaEmision,
        motivoModificacion,
        fechaEmision:                fecha,
        totalSinImpuestos:           totales.totalSinImpuestos,
        totalIva:                    totales.totalIva,
        importeTotal:                totales.importeTotal,
        detalles,
        estadoSri:                   'PENDIENTE_FIRMA',
        xmlGenerado:                 xml,
        emisorId:                    req.usuario.id,
      },
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'CREATE',
      tabla: 'notas_credito', registroId: nc.id,
      datosNuevos: { numeroNC, facturaId },
      req,
    });

    try {
      await crearAsientoNotaCreditoEmitida({
        notaCreditoId: nc.id,
        usuarioId: req.usuario.id,
        fecha,
      });
    } catch (contErr) {
      console.error('Error creando asiento automático de nota de crédito:', contErr.message);
    }

    res.status(201).json({ ok: true, data: nc });
  } catch (err) {
    console.error('Error al crear NC:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/notas-credito/:id/pdf
router.get('/notas-credito/:id/pdf', permitirVerFacturacion, async (req, res) => {
  try {
    const nc = await prisma.notas_credito.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!nc) return res.status(404).json({ ok: false, error: 'NC no encontrada' });

    const config  = await getConfigSRI(req.empresa.id);
    const pdfPath = path.join(DIR_FACTURAS, `nc-${nc.id}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      await sri.generarRIDENotaCredito(nc, config || {}, pdfPath);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=nc-${nc.numeroNC}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/facturas/reportes/tributario?mes=MM&anio=YYYY
// Resumen mensual para declaración de IVA (Formulario 104)
// Devuelve: facturas, notas de crédito y retenciones del período
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reportes/tributario', permitirReportesTributarios, async (req, res) => {
  try {
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();

    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 0, 23, 59, 59, 999); // último día del mes

    // ── Facturas del período ──────────────────────────────────────────────────
    const facturas = await prisma.facturas.findMany({
      where: {
        empresaId: req.empresa.id,
        fechaEmision: { gte: desde, lte: hasta },
        anulada: false,
      },
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
        estadoSri: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Notas de crédito del período ─────────────────────────────────────────
    const notasCredito = await prisma.notas_credito.findMany({
      where: { empresaId: req.empresa.id, fechaEmision: { gte: desde, lte: hasta } },
      select: {
        id: true, numeroNC: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        totalSinImpuestos: true, totalIva: true, importeTotal: true,
        estadoSri: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Retenciones del período ───────────────────────────────────────────────
    const retenciones = await prisma.retenciones.findMany({
      where: {
        empresaId: req.empresa.id,
        fechaEmision: { gte: desde, lte: hasta },
        anulada: false,
      },
      select: {
        id: true, numeroRetencion: true, fechaEmision: true,
        razonSocialProveedor: true, identificacionProveedor: true,
        totalRetenido: true, estadoSri: true, impuestos: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Calcular totales de IVA (Formulario 104) ──────────────────────────────
    const totVentas = facturas.reduce((acc, f) => ({
      subtotal0:    acc.subtotal0    + parseFloat(f.subtotal0  || 0),
      subtotal15:   acc.subtotal15   + parseFloat(f.subtotal15 || 0),
      totalIva:     acc.totalIva     + parseFloat(f.totalIva   || 0),
      importeTotal: acc.importeTotal + parseFloat(f.importeTotal),
    }), { subtotal0: 0, subtotal15: 0, totalIva: 0, importeTotal: 0 });

    const totNC = notasCredito.reduce((acc, nc) => ({
      totalSinImpuestos: acc.totalSinImpuestos + parseFloat(nc.totalSinImpuestos || 0),
      totalIva:          acc.totalIva          + parseFloat(nc.totalIva          || 0),
      importeTotal:      acc.importeTotal      + parseFloat(nc.importeTotal),
    }), { totalSinImpuestos: 0, totalIva: 0, importeTotal: 0 });

    // Retención IVA cobrada (código 2)
    let retencionIvaCobrada = 0;
    let retencionRentaCobrada = 0;
    retenciones.forEach(ret => {
      const imps = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
      imps.forEach(imp => {
        if (String(imp.codigo) === '2') retencionIvaCobrada += parseFloat(imp.valorRetenido || 0);
        if (String(imp.codigo) === '1') retencionRentaCobrada += parseFloat(imp.valorRetenido || 0);
      });
    });

    // IVA a pagar = IVA cobrado en facturas - NC - Retenciones de IVA recibidas
    const ivaNeto = parseFloat((totVentas.totalIva - totNC.totalIva - retencionIvaCobrada).toFixed(2));

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${String(mes).padStart(2,'0')}/${anio}` },
        facturas,
        notasCredito,
        retenciones,
        resumen: {
          ventas: {
            subtotal0:    parseFloat(totVentas.subtotal0.toFixed(2)),
            subtotal15:   parseFloat(totVentas.subtotal15.toFixed(2)),
            totalIva:     parseFloat(totVentas.totalIva.toFixed(2)),
            importeTotal: parseFloat(totVentas.importeTotal.toFixed(2)),
            cantidadFacturas: facturas.length,
          },
          notasCredito: {
            totalSinImpuestos: parseFloat(totNC.totalSinImpuestos.toFixed(2)),
            totalIva:          parseFloat(totNC.totalIva.toFixed(2)),
            importeTotal:      parseFloat(totNC.importeTotal.toFixed(2)),
            cantidad:          notasCredito.length,
          },
          retenciones: {
            retencionIvaCobrada:    parseFloat(retencionIvaCobrada.toFixed(2)),
            retencionRentaCobrada:  parseFloat(retencionRentaCobrada.toFixed(2)),
            cantidad:               retenciones.length,
          },
          ivaNeto, // IVA resultante a declarar
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
