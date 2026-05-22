// ====================================
// RUTAS: GUÍAS DE REMISIÓN — AELA
// Tipo de comprobante 06 del SRI Ecuador
// backend/routes/guiasRemision.js
// ====================================

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const prisma  = require('../config/prisma');
const sri     = require('../utils/sri');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { registrarAuditoria } = require('../utils/auditoria');
const { getCertBuffer, tieneCertificado } = require('../utils/certUtils');

router.use(proteger);
router.use(autorizarPermiso('facturacion.ver'));

// Carpeta para PDFs de guías
const DIR_GUIAS = path.join(__dirname, '..', 'uploads', 'guias');
if (!fs.existsSync(DIR_GUIAS)) fs.mkdirSync(DIR_GUIAS, { recursive: true });

// ─── Helper: config SRI ──────────────────────────────────────────────────────
async function getConfigSRI(empresaId) {
  return prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } });
}

// ─── Helper: flujo SRI completo para guía ────────────────────────────────────
async function procesarGuiaEnSRI(guiaId, xmlGenerado, config) {
  try {
    if (config.tipoCertificado === 'token') return;
    if (!tieneCertificado(config)) return;

    const p12Buffer  = getCertBuffer(config);
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, config.claveCertificado || '');

    await prisma.guias_remision.update({where: { id: guiaId }, data: { xmlFirmado, estadoSRI: 'PENDIENTE' } });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.guias_remision.update({ where: { id: guiaId }, data: { estadoSRI: 'RECHAZADA', mensajesSri: recepcion } });
      return;
    }

    const guia = await prisma.guias_remision.findUnique({ where: { id: guiaId } });
    const autorizacion = await sri.autorizarComprobanteSRI(guia.claveAcceso, config.ambiente);

    if (autorizacion.autorizado) {
      await prisma.guias_remision.update({
        where: { id: guiaId },
        data: {
          estadoSRI:          'AUTORIZADA',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          mensajesSri:        { autorizacion: autorizacion.estado },
        },
      });
    } else {
      await prisma.guias_remision.update({
        where: { id: guiaId },
        data: { estadoSRI: 'RECHAZADA', mensajesSri: { mensajes: autorizacion.mensajes } },
      });
    }
  } catch (err) {
    console.error('SRI guía background:', err.message);
    await prisma.guias_remision.update({
      where: { id: guiaId },
      data: { estadoSRI: 'RECHAZADA', mensajesSri: { error: err.message } },
    }).catch(() => {});
  }
}

const { siguienteSecuencial: _nextSec } = require('../utils/secuenciales');

// ─── Helper: próximo secuencial ──────────────────────────────────────────────
async function siguienteSecuencial(empresaId, establecimiento, puntoEmision) {
  const ultima = await prisma.guias_remision.findFirst({
    where: { empresaId, establecimiento, puntoEmision },
    orderBy: { secuencial: 'desc' },
    select: { secuencial: true },
  });
  const actual = ultima ? parseInt(ultima.secuencial, 10) : 0;
  const num = await _nextSec(
    prisma, empresaId, establecimiento, puntoEmision,
    actual, 'secInicialGuiaRemision'
  );
  return String(num).padStart(9, '0');
}

// ─── GET /api/guias-remision ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, busqueda, estado, page = 1, limit = 50 } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { empresaId: req.empresa.id };

    if (fechaDesde || fechaHasta) {
      where.fechaIniTransporte = {};
      if (fechaDesde) where.fechaIniTransporte.gte = new Date(fechaDesde);
      if (fechaHasta) where.fechaIniTransporte.lte = new Date(fechaHasta + 'T23:59:59');
    }
    if (estado && estado !== 'TODOS') {
      where.estadoSRI = estado;
    }
    if (busqueda) {
      where.OR = [
        { nombreDestinatario: { contains: busqueda, mode: 'insensitive' } },
        { rucDestinatario:    { contains: busqueda, mode: 'insensitive' } },
        { motivoTraslado:     { contains: busqueda, mode: 'insensitive' } },
        { secuencial:         { contains: busqueda } },
      ];
    }

    const [guias, total] = await Promise.all([
      prisma.guias_remision.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, establecimiento: true, puntoEmision: true, secuencial: true,
          fechaIniTransporte: true, fechaFinTransporte: true,
          nombreDestinatario: true, rucDestinatario: true,
          motivoTraslado: true, estadoSRI: true, anulada: true,
          claveAcceso: true, createdAt: true,
        },
      }),
      prisma.guias_remision.count({ where }),
    ]);

    res.json({
      ok: true,
      guias: guias.map((g) => ({
        ...g,
        numero: `${g.establecimiento}-${g.puntoEmision}-${g.secuencial}`,
      })),
      total,
      pagina: parseInt(page),
      totalPaginas: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error('GET /guias-remision:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /api/guias-remision/:id ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const guia = await prisma.guias_remision.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!guia) return res.status(404).json({ ok: false, mensaje: 'Guía no encontrada' });
    res.json({ ok: true, guia: { ...guia, numero: `${guia.establecimiento}-${guia.puntoEmision}-${guia.secuencial}` } });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── POST /api/guias-remision ─────────────────────────────────────────────────
router.post('/', autorizarPermiso('facturacion.emitir'), async (req, res) => {
  try {
    const {
      establecimiento = '001', puntoEmision = '001',
      fechaIniTransporte, fechaFinTransporte,
      dirPartida,
      rucTransportista, nombreTransportista, placaVehiculo,
      rucDestinatario,  nombreDestinatario,  dirDestinatario,
      motivoTraslado,   docAduaneroUnico,
      codDocSustento = '01',
      numDocSustento,
      numAutDocSustento,
      fechaEmisionDocSustento,
      detalles = [],    observaciones,
    } = req.body;

    if (!fechaIniTransporte || !fechaFinTransporte)
      return res.status(400).json({ ok: false, mensaje: 'Fechas de transporte requeridas' });
    if (!rucTransportista || !nombreTransportista)
      return res.status(400).json({ ok: false, mensaje: 'Datos del transportista requeridos' });
    if (!rucDestinatario || !nombreDestinatario || !dirDestinatario)
      return res.status(400).json({ ok: false, mensaje: 'Datos del destinatario requeridos' });
    if (!motivoTraslado)
      return res.status(400).json({ ok: false, mensaje: 'Motivo de traslado requerido' });
    if (!Array.isArray(detalles) || detalles.length === 0)
      return res.status(400).json({ ok: false, mensaje: 'Debe incluir al menos un detalle' });

    const secuencial = await siguienteSecuencial(req.empresa.id, establecimiento, puntoEmision);
    const config     = await getConfigSRI(req.empresa.id);

    // Generar clave de acceso si hay config SRI
    let claveAcceso = null;
    let xmlGenerado = null;
    if (config) {
      claveAcceso = sri.generarClaveAcceso({
        fecha:     new Date(fechaIniTransporte),
        tipoCod:   '06',
        ruc:       config.ruc,
        ambiente:  config.ambiente,
        estab:     establecimiento,
        ptoEmi:    puntoEmision,
        secuencial,
      });

      const result = sri.generarXMLGuiaRemision({
        claveAcceso, secuencial,
        fechaIniTransporte, fechaFinTransporte,
        dirPartida: dirPartida || config.dirMatriz,
        rucTransportista, nombreTransportista, placaVehiculo,
        rucDestinatario,  nombreDestinatario,  dirDestinatario,
        motivoTraslado,   docAduaneroUnico,
        codDocSustento, numDocSustento: numDocSustento || '',
        numAutDocSustento: numAutDocSustento || '',
        fechaEmisionDocSustento,
        detalles, observaciones,
      }, config);
      xmlGenerado = result.xml;
    }

    const guia = await prisma.guias_remision.create({
      data: {
        empresaId:   req.empresa.id,
        usuarioId:   req.usuario.id,
        establecimiento, puntoEmision, secuencial,
        fechaIniTransporte: new Date(fechaIniTransporte),
        fechaFinTransporte: new Date(fechaFinTransporte),
        dirPartida:          dirPartida || '',
        rucTransportista, nombreTransportista,
        placaVehiculo:     placaVehiculo || null,
        rucDestinatario,  nombreDestinatario, dirDestinatario,
        motivoTraslado,
        docAduaneroUnico:  docAduaneroUnico || null,
        codDocSustento:    codDocSustento || '01',
        numDocSustento:    numDocSustento || null,
        numAutDocSustento: numAutDocSustento || null,
        fechaEmisionDocSustento: fechaEmisionDocSustento ? new Date(fechaEmisionDocSustento) : null,
        detalles,
        observaciones:     observaciones || null,
        claveAcceso:       claveAcceso || null,
        xmlGenerado:       xmlGenerado || null,
        estadoSRI: config ? 'PENDIENTE_FIRMA' : 'NO_ENVIADA',
      },
    });

    await registrarAuditoria({
      empresaId: req.empresa.id, usuarioId: req.usuario.id,
      accion: 'CREAR_GUIA_REMISION', tabla: 'guias_remision',
      registroId: guia.id,
    });

    // Intentar envío SRI en segundo plano
    if (config && xmlGenerado) {
      procesarGuiaEnSRI(guia.id, xmlGenerado, config).catch(err => console.error('SRI guía bg:', err));
    }

    res.status(201).json({
      ok: true,
      guia: { ...guia, numero: `${guia.establecimiento}-${guia.puntoEmision}-${guia.secuencial}` },
      mensaje: config ? 'Guía creada. Procesando en SRI...' : 'Guía creada (sin config SRI)',
    });
  } catch (err) {
    console.error('POST /guias-remision:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── PATCH /api/guias-remision/:id — editar (solo NO_ENVIADA) ──────────────
router.patch('/:id', autorizarPermiso('facturacion.emitir'), async (req, res) => {
  try {
    const guia = await prisma.guias_remision.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!guia) return res.status(404).json({ ok: false, mensaje: 'Guía no encontrada' });
    if (guia.estadoSRI !== 'NO_ENVIADA')
      return res.status(400).json({ ok: false, mensaje: 'Solo se puede editar una guía no enviada al SRI' });

    const campos = [
      'fechaIniTransporte','fechaFinTransporte','dirPartida',
      'rucTransportista','nombreTransportista','placaVehiculo',
      'rucDestinatario','nombreDestinatario','dirDestinatario',
      'motivoTraslado','docAduaneroUnico','detalles','observaciones',
    ];
    const data = {};
    for (const c of campos) {
      if (req.body[c] !== undefined) {
        data[c] = (c.includes('fecha'))
          ? new Date(req.body[c])
          : req.body[c];
      }
    }

    const actualizada = await prisma.guias_remision.update({
      where: { id: guia.id },
      data,
    });

    res.json({ ok: true, guia: { ...actualizada, numero: `${actualizada.establecimiento}-${actualizada.puntoEmision}-${actualizada.secuencial}` } });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── DELETE /api/guias-remision/:id — anular ─────────────────────────────────
router.delete('/:id', autorizarPermiso('facturacion.emitir'), async (req, res) => {
  try {
    const guia = await prisma.guias_remision.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!guia) return res.status(404).json({ ok: false, mensaje: 'Guía no encontrada' });
    if (guia.anulada) return res.status(400).json({ ok: false, mensaje: 'La guía ya está anulada' });

    const anulada = await prisma.guias_remision.update({
      where: { id: guia.id },
      data: { anulada: true, estadoSRI: 'ANULADA' },
    });

    await registrarAuditoria({
      empresaId: req.empresa.id, usuarioId: req.usuario.id,
      accion: 'ANULAR_GUIA_REMISION', tabla: 'guias_remision',
      registroId: guia.id,
    });

    res.json({ ok: true, guia: anulada });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── POST /api/guias-remision/:id/enviar-sri — reenviar al SRI ───────────────
router.post('/:id/enviar-sri', autorizarPermiso('facturacion.emitir'), async (req, res) => {
  try {
    const guia = await prisma.guias_remision.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!guia) return res.status(404).json({ ok: false, mensaje: 'Guía no encontrada' });
    if (guia.anulada) return res.status(400).json({ ok: false, mensaje: 'La guía está anulada' });
    if (guia.estadoSRI === 'AUTORIZADA') return res.status(400).json({ ok: false, mensaje: 'La guía ya está autorizada' });

    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, mensaje: 'Sin configuración SRI activa' });

    // Regenerar XML si no existe
    let xmlGenerado = guia.xmlGenerado;
    if (!xmlGenerado) {
      let claveAcceso = guia.claveAcceso;
      if (!claveAcceso) {
        claveAcceso = sri.generarClaveAcceso({
          fecha:    guia.fechaIniTransporte,
          tipoCod:  '06',
          ruc:      config.ruc,
          ambiente: config.ambiente,
          estab:    guia.establecimiento,
          ptoEmi:   guia.puntoEmision,
          secuencial: guia.secuencial,
        });
        await prisma.guias_remision.update({ where: { id: guia.id }, data: { claveAcceso } });
      }
      const detalles = typeof guia.detalles === 'string' ? JSON.parse(guia.detalles) : (guia.detalles || []);
      const result = sri.generarXMLGuiaRemision({
        claveAcceso,
        secuencial: guia.secuencial,
        fechaIniTransporte: guia.fechaIniTransporte,
        fechaFinTransporte: guia.fechaFinTransporte,
        dirPartida: guia.dirPartida,
        rucTransportista:   guia.rucTransportista,
        nombreTransportista: guia.nombreTransportista,
        placaVehiculo:      guia.placaVehiculo,
        rucDestinatario:    guia.rucDestinatario,
        nombreDestinatario: guia.nombreDestinatario,
        dirDestinatario:    guia.dirDestinatario,
        motivoTraslado:     guia.motivoTraslado,
        docAduaneroUnico:   guia.docAduaneroUnico,
        codDocSustento:     guia.codDocSustento || '01',
        numDocSustento:     guia.numDocSustento || '',
        numAutDocSustento:  guia.numAutDocSustento || '',
        fechaEmisionDocSustento: guia.fechaEmisionDocSustento,
        detalles,
        observaciones: guia.observaciones,
      }, config);
      xmlGenerado = result.xml;
      await prisma.guias_remision.update({ where: { id: guia.id }, data: { xmlGenerado } });
    }

    await procesarGuiaEnSRI(guia.id, xmlGenerado, config);

    const actualizada = await prisma.guias_remision.findUnique({ where: { id: guia.id } });
    res.json({ ok: true, guia: actualizada, mensaje: `Estado SRI: ${actualizada.estadoSRI}` });
  } catch (err) {
    console.error('POST /guias-remision/:id/enviar-sri:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

module.exports = router;
