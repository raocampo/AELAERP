// ====================================
// RUTAS: LIQUIDACIONES DE COMPRA SRI (tipo 03)
// backend/routes/liquidacionesCompra.js
// ====================================

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const prisma  = require('../config/prisma');
const sri     = require('../utils/sri');
const { requiereModulo } = require('../middleware/modulos');
const { soloFull } = require('../middleware/edition');
const {
  crearAsientoLiquidacionCompraAutorizada,
  crearAsientoReversoLiquidacionAnulada,
} = require('../utils/contabilidad');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { esErrorConectividad } = require('../utils/colaSRI');
const { getCertBuffer, tieneCertificado } = require('../utils/certUtils');

const REVERSOS_ANULACION_HABILITADOS = process.env.CONTA_REVERSOS_ANULACION !== 'false';

router.use(proteger);
router.use(soloFull);
router.use(requiereModulo('liquidacionesHabilitadas'));
router.use(autorizarPermiso('liquidaciones.gestionar'));

// ─── Carpeta de salida ────────────────────────────────────────────────────────
const DIR_LIQUIDACIONES = path.join(__dirname, '..', 'uploads', 'liquidaciones');
if (!fs.existsSync(DIR_LIQUIDACIONES)) fs.mkdirSync(DIR_LIQUIDACIONES, { recursive: true });

// ─── Helper: configuración SRI activa ────────────────────────────────────────
async function getConfigSRI(empresaId) {
  const config = await prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
  if (!config) throw new Error('No hay configuración SRI. Configure primero los datos del emisor.');
  return config;
}

// ─── Helper: flujo SRI (firma → envío → autorización → RIDE PDF) ─────────────
async function procesarLiquidacionEnSRI(liqId, xmlGenerado, config) {
  try {
    if (config.tipoCertificado === 'token') return;
    if (!tieneCertificado(config)) return;

    const p12Buffer  = getCertBuffer(config);
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, config.claveCertificado || '');

    await prisma.liquidaciones_compra.update({
      where: { id: liqId },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.liquidaciones_compra.update({
        where: { id: liqId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const liq = await prisma.liquidaciones_compra.findUnique({ where: { id: liqId } });
    const autorizacion = await sri.autorizarComprobanteSRI(liq.claveAcceso, config.ambiente);

    if (autorizacion.autorizado) {
      const pdfFilename = `liquidacion-${liq.claveAcceso}.pdf`;
      const pdfPath     = path.join(DIR_LIQUIDACIONES, pdfFilename);
      await sri.generarRIDELiquidacionCompra(
        { ...liq, numeroAutorizacion: autorizacion.numeroAutorizacion, fechaAutorizacion: autorizacion.fechaAutorizacion },
        config,
        pdfPath
      );
      await prisma.liquidaciones_compra.update({
        where: { id: liqId },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion:  autorizacion.numeroAutorizacion,
          fechaAutorizacion:   autorizacion.fechaAutorizacion,
          xmlAutorizado:       autorizacion.xmlAutorizado || xmlFirmado,
          pdfUrl:             `/uploads/liquidaciones/${pdfFilename}`,
          mensajesSri:         autorizacion.mensajes,
        },
      });

      try {
        await crearAsientoLiquidacionCompraAutorizada({
          liquidacionId: liqId,
          usuarioId: liq.emisorId,
          fecha: liq.fechaEmision || new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento automático de liquidación:', contErr.message);
      }
    } else {
      await prisma.liquidaciones_compra.update({
        where: { id: liqId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: autorizacion },
      });
    }
  } catch (err) {
    console.error('Error procesando liquidación en SRI:', err.message);
    const nuevoEstado = esErrorConectividad(err) ? 'FIRMADO_PENDIENTE_ENVIO' : 'ERROR';
    if (nuevoEstado === 'FIRMADO_PENDIENTE_ENVIO') {
      console.log(`[SRI] Liquidación #${liqId} queda en cola — sin internet`);
    }
    try {
      await prisma.liquidaciones_compra.update({
        where: { id: liqId },
        data:  { estadoSri: nuevoEstado, mensajesSri: { error: err.message, code: err.code } },
      });
    } catch (_) {}
  }
}

// ─── GET / — Lista con filtros y paginación ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 15, fechaDesde, fechaHasta, estado, proveedor } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { empresaId: req.empresa.id };

    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        where.fechaEmision.lte = hasta;
      }
    }
    if (estado)    where.estadoSri = estado;
    if (proveedor) {
      where.OR = [
        { razonSocialProveedor:    { contains: proveedor, mode: 'insensitive' } },
        { identificacionProveedor: { contains: proveedor, mode: 'insensitive' } },
      ];
    }

    const [total, liquidaciones] = await Promise.all([
      prisma.liquidaciones_compra.count({ where }),
      prisma.liquidaciones_compra.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        select: {
          id: true, numeroLiquidacion: true, fechaEmision: true,
          razonSocialProveedor: true, identificacionProveedor: true,
          importeTotal: true, estadoSri: true, anulada: true, claveAcceso: true,
        },
      }),
    ]);

    res.json({
      ok: true,
      data:  liquidaciones,
      total,
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id — Detalle completo ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const liq = await prisma.liquidaciones_compra.findUnique({
      where: { id: parseInt(req.params.id, 10) },
    });
    if (!liq || liq.empresaId !== req.empresa.id) return res.status(404).json({ error: 'Liquidación no encontrada' });
    res.json({ ok: true, data: liq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST / — Emitir nueva liquidación ───────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    const {
      tipoIdentificacionProveedor,
      identificacionProveedor,
      razonSocialProveedor,
      direccionProveedor,
      detalles,
      pagos,
      observaciones,
      fechaEmision,
    } = req.body;

    if (!identificacionProveedor?.trim()) return res.status(400).json({ error: 'Identificación del proveedor es requerida' });
    if (!razonSocialProveedor?.trim())    return res.status(400).json({ error: 'Nombre del proveedor es requerido' });
    if (!detalles || !detalles.length)   return res.status(400).json({ error: 'Debe agregar al menos un detalle' });

    // Calcular secuencial (respeta secuencial inicial configurado)
    const maxSeq = await prisma.liquidaciones_compra.aggregate({
      _max: { secuencial: true },
      where: { rucEmisor: config.ruc },
    });
    const maxEnBD_lc = maxSeq._max.secuencial || 0;
    const { siguienteSecuencial: nextSec_lc } = require('../utils/secuenciales');
    const secuencial = await nextSec_lc(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD_lc, 'secInicialLiquidacion'
    );

    const fEmision = fechaEmision ? new Date(fechaEmision) : new Date();

    const claveAcceso = sri.generarClaveAcceso({
      fecha:      fEmision,
      tipoCod:    sri.TIPO_COMPROBANTE.LIQUIDACION_COMPRA,
      ruc:        config.ruc,
      ambiente:   config.ambiente,
      estab:      config.establecimiento,
      ptoEmi:     config.puntoEmision,
      secuencial,
    });

    const numeroLiquidacion = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

    const { xml: xmlGenerado, totales } = sri.generarXMLLiquidacionCompra(
      {
        claveAcceso,
        secuencial,
        fechaEmision: fEmision,
        tipoIdentificacionProveedor,
        identificacionProveedor,
        razonSocialProveedor,
        direccionProveedor,
        detalles,
        pagos,
        observaciones,
      },
      config
    );

    const liq = await prisma.liquidaciones_compra.create({
      data: {
        empresaId: req.empresa.id,
        claveAcceso,
        numeroLiquidacion,
        secuencial,
        rucEmisor:                  config.ruc,
        tipoIdentificacionProveedor,
        identificacionProveedor,
        razonSocialProveedor,
        direccionProveedor:         direccionProveedor || null,
        subtotal0:                  totales.subtotal0,
        subtotal5:                  totales.subtotal5,
        subtotal12:                 totales.subtotal12,
        subtotal15:                 totales.subtotal15,
        totalDescuento:             totales.totalDescuento,
        totalIva:                   totales.totalIva,
        importeTotal:               totales.importeTotal,
        detalles:                   JSON.parse(JSON.stringify(detalles)),
        pagos:                      JSON.parse(JSON.stringify(pagos || [])),
        fechaEmision:               fEmision,
        estadoSri:                  'PENDIENTE_FIRMA',
        emisorId:                   req.usuario.id,
        observaciones:              observaciones || null,
        xmlGenerado,
      },
    });

    // Procesar en SRI de forma asíncrona
    procesarLiquidacionEnSRI(liq.id, xmlGenerado, config).catch(console.error);

    res.status(201).json({ ok: true, data: liq });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/pdf — Descargar RIDE PDF ───────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const liq = await prisma.liquidaciones_compra.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!liq || liq.empresaId !== req.empresa.id) return res.status(404).json({ error: 'Liquidación no encontrada' });

    const config = await getConfigSRI(req.empresa.id);
    const pdfFilename = `liquidacion-${liq.claveAcceso}.pdf`;
    const pdfPath     = path.join(DIR_LIQUIDACIONES, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      await sri.generarRIDELiquidacionCompra(liq, config, pdfPath);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="liquidacion-${liq.numeroLiquidacion}.pdf"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/xml — Descargar XML ────────────────────────────────────────────
router.get('/:id/xml', async (req, res) => {
  try {
    const liq = await prisma.liquidaciones_compra.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!liq || liq.empresaId !== req.empresa.id) return res.status(404).json({ error: 'Liquidación no encontrada' });

    const xmlContent = liq.xmlAutorizado || liq.xmlFirmado || liq.xmlGenerado;
    if (!xmlContent) return res.status(404).json({ error: 'XML no disponible' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="liquidacion-${liq.numeroLiquidacion}.xml"`);
    res.send(xmlContent);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/reenviar — Reenviar al SRI ────────────────────────────────────
router.post('/:id/reenviar', async (req, res) => {
  try {
    const liq = await prisma.liquidaciones_compra.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!liq || liq.empresaId !== req.empresa.id) return res.status(404).json({ error: 'Liquidación no encontrada' });
    if (liq.anulada) return res.status(400).json({ error: 'La liquidación está anulada' });

    const config = await getConfigSRI(req.empresa.id);
    const xmlParaFirmar = liq.xmlGenerado;
    if (!xmlParaFirmar) return res.status(400).json({ error: 'No hay XML disponible para reenviar' });

    procesarLiquidacionEnSRI(liq.id, xmlParaFirmar, config).catch(console.error);

    res.json({ ok: true, mensaje: 'Reenvío iniciado. El estado se actualizará en breve.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/anular — Anular liquidación ───────────────────────────────────
router.post('/:id/anular', async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo?.trim()) return res.status(400).json({ error: 'El motivo de anulación es requerido' });

    const liq = await prisma.liquidaciones_compra.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!liq || liq.empresaId !== req.empresa.id) return res.status(404).json({ error: 'Liquidación no encontrada' });
    if (liq.anulada) return res.status(400).json({ error: 'La liquidación ya está anulada' });

    const updated = await prisma.liquidaciones_compra.update({
      where: { id: liq.id },
      data:  { anulada: true, motivoAnulacion: motivo, estadoSri: 'ANULADO' },
    });

    if (REVERSOS_ANULACION_HABILITADOS) {
      try {
        await crearAsientoReversoLiquidacionAnulada({
          liquidacionId: liq.id,
          usuarioId: req.usuario.id,
          fecha: new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento reverso por anulación de liquidación:', contErr.message);
      }
    }

    res.json({ ok: true, data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
