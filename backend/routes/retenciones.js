// ====================================
// RUTAS: COMPROBANTES DE RETENCIÓN SRI
// backend/routes/retenciones.js
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
  crearAsientoRetencionAutorizada,
  crearAsientoReversoRetencionAnulada,
} = require('../utils/contabilidad');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { esErrorConectividad } = require('../utils/colaSRI');
const {
  calcularRetencionesCompra,
  serializarCompraPreload,
  resumirCompraBusquedaRetencion,
} = require('../utils/retenciones');
const { getCertBuffer, tieneCertificado } = require('../utils/certUtils');

const REVERSOS_ANULACION_HABILITADOS = process.env.CONTA_REVERSOS_ANULACION !== 'false';

router.use(proteger);
router.use(soloFull);
router.use(requiereModulo('retencionesHabilitadas'));
router.use(autorizarPermiso('retenciones.gestionar'));

// ─── Carpeta de salida ────────────────────────────────────────────────────────
const DIR_RETENCIONES = path.join(__dirname, '..', 'uploads', 'retenciones');
if (!fs.existsSync(DIR_RETENCIONES)) fs.mkdirSync(DIR_RETENCIONES, { recursive: true });

// ─── Helper: obtener configuración SRI activa ────────────────────────────────
async function getConfigSRI(empresaId) {
  const config = await prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
  if (!config) throw new Error('No hay configuración SRI. Configure primero los datos del emisor.');
  return config;
}

async function sincronizarRetencionesCompra(compraId, tx = prisma) {
  const compraIdNum = parseInt(compraId, 10);
  if (!Number.isFinite(compraIdNum)) return null;

  const retenciones = await tx.retenciones.findMany({
    where: { compraId: compraIdNum, anulada: false },
    select: { impuestos: true },
  });

  const acumulado = retenciones.reduce((acc, retencion) => {
    const totales = calcularRetencionesCompra(retencion.impuestos);
    acc.retencionIVA += totales.retencionIVA;
    acc.retencionRenta += totales.retencionRenta;
    return acc;
  }, { retencionIVA: 0, retencionRenta: 0 });

  return tx.facturas_compra.update({
    where: { id: compraIdNum },
    data: {
      retencionIVA: parseFloat(acumulado.retencionIVA.toFixed(2)),
      retencionRenta: parseFloat(acumulado.retencionRenta.toFixed(2)),
    },
  });
}

async function obtenerCompraRetencion(compraId, empresaId, tx = prisma) {
  const compraIdNum = parseInt(compraId, 10);
  if (!Number.isFinite(compraIdNum)) return null;

  return tx.facturas_compra.findFirst({
    where: {
      id: compraIdNum,
      empresaId,
      anulada: false,
    },
    include: {
      retenciones: {
        where: { anulada: false },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          numeroRetencion: true,
          fechaEmision: true,
          totalRetenido: true,
          estadoSri: true,
          numeroAutorizacion: true,
        },
      },
    },
  });
}

// ─── Helper: procesar retención en SRI (firma → envío → autorización) ────────
async function procesarRetencionEnSRI(retencionId, xmlGenerado, config) {
  try {
    if (config.tipoCertificado === 'token') return;
    if (!tieneCertificado(config)) return;

    const p12Buffer  = getCertBuffer(config);
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, config.claveCertificado || '');

    await prisma.retenciones.update({
      where: { id: retencionId },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.retenciones.update({
        where: { id: retencionId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const retencion = await prisma.retenciones.findUnique({ where: { id: retencionId } });
    const autorizacion = await sri.autorizarComprobanteSRI(retencion.claveAcceso, config.ambiente);

    if (autorizacion.autorizado) {
      const pdfFilename = `retencion-${retencion.claveAcceso}.pdf`;
      const pdfPath     = path.join(DIR_RETENCIONES, pdfFilename);
      await sri.generarRIDERetencion(
        { ...retencion, numeroAutorizacion: autorizacion.numeroAutorizacion, fechaAutorizacion: autorizacion.fechaAutorizacion },
        config,
        pdfPath
      );

      await prisma.retenciones.update({
        where: { id: retencionId },
        data: {
          estadoSri:         'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado || xmlFirmado,
          pdfUrl:            `/uploads/retenciones/${pdfFilename}`,
          mensajesSri:       autorizacion.mensajes,
        },
      });

      try {
        await crearAsientoRetencionAutorizada({
          retencionId,
          usuarioId: retencion.emisorId,
          fecha: retencion.fechaEmision || new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento automático de retención:', contErr.message);
      }
    } else {
      await prisma.retenciones.update({
        where: { id: retencionId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: autorizacion },
      });
    }
  } catch (err) {
    console.error('Error procesando retención en SRI:', err.message);
    const nuevoEstado = esErrorConectividad(err) ? 'FIRMADO_PENDIENTE_ENVIO' : 'ERROR';
    if (nuevoEstado === 'FIRMADO_PENDIENTE_ENVIO') {
      console.log(`[SRI] Retención #${retencionId} queda en cola — sin internet`);
    }
    await prisma.retenciones.update({
      where: { id: retencionId },
      data:  { estadoSri: nuevoEstado, mensajesSri: { error: err.message, code: err.code } },
    }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/retenciones
// Lista con filtros: fechaDesde, fechaHasta, estado, proveedor
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, estado, proveedor, page = 1, limit = 20 } = req.query;
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

    if (estado) where.estadoSri = estado;
    if (proveedor) {
      where.OR = [
        { razonSocialProveedor: { contains: proveedor, mode: 'insensitive' } },
        { identificacionProveedor: { contains: proveedor, mode: 'insensitive' } },
      ];
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await prisma.retenciones.count({ where });
    const retenciones = await prisma.retenciones.findMany({
      where,
      orderBy: { fechaEmision: 'desc' },
      skip,
      take: parseInt(limit),
      select: {
        id: true, numeroRetencion: true, fechaEmision: true,
        razonSocialProveedor: true, identificacionProveedor: true,
        periodoFiscal: true, totalRetenido: true, estadoSri: true,
        numeroAutorizacion: true, pdfUrl: true, anulada: true, createdAt: true,
      },
    });

    res.json({ ok: true, data: retenciones, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/compras/buscar', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ ok: true, data: [] });

    const compras = await prisma.facturas_compra.findMany({
      where: {
        empresaId: req.empresa.id,
        anulada: false,
        OR: [
          { numeroFactura: { contains: q, mode: 'insensitive' } },
          { identificacionProveedor: { contains: q, mode: 'insensitive' } },
          { razonSocialProveedor: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ fechaEmision: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        numeroFactura: true,
        fechaEmision: true,
        identificacionProveedor: true,
        razonSocialProveedor: true,
        importeTotal: true,
        totalIva: true,
        retencionIVA: true,
        retencionRenta: true,
      },
    });

    const data = compras.map(resumirCompraBusquedaRetencion);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('GET /retenciones/compras/buscar:', err);
    res.status(500).json({ ok: false, error: 'No se pudieron buscar compras para retención' });
  }
});

router.get('/compras/:compraId/preload', async (req, res) => {
  try {
    const compra = await obtenerCompraRetencion(req.params.compraId, req.empresa.id);
    if (!compra) {
      return res.status(404).json({ ok: false, error: 'Compra no encontrada para retención' });
    }

    res.json({ ok: true, data: serializarCompraPreload(compra) });
  } catch (err) {
    console.error('GET /retenciones/compras/:compraId/preload:', err);
    res.status(500).json({ ok: false, error: 'No se pudo precargar la compra seleccionada' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/retenciones/:id  — Detalle completo
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const ret = await prisma.retenciones.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
    });
    if (!ret) return res.status(404).json({ ok: false, error: 'Retención no encontrada' });
    res.json({ ok: true, data: ret });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/retenciones/:id — Editar códigos/montos de una retención NO autorizada.
// Mismo guard que /reenviar: solo se puede editar antes de que el SRI la autorice
// y mientras no esté anulada. Regenera el XML (el usuario debe usar "Reenviar"
// después para volver a firmarlo y enviarlo al SRI).
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const ret = await prisma.retenciones.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!ret) return res.status(404).json({ ok: false, error: 'Retención no encontrada' });
    if (ret.estadoSri === 'AUTORIZADO') return res.status(400).json({ ok: false, error: 'La retención ya está autorizada por el SRI y no puede editarse' });
    if (ret.anulada) return res.status(400).json({ ok: false, error: 'La retención está anulada' });

    const { impuestos, observaciones } = req.body;
    if (!Array.isArray(impuestos) || impuestos.length === 0) {
      return res.status(400).json({ ok: false, error: 'Debe ingresar al menos un impuesto retenido' });
    }

    const totalRetenido = impuestos.reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
    const config = await getConfigSRI(req.empresa.id);

    const { xml: xmlGenerado } = sri.generarXMLRetencion({
      claveAcceso: ret.claveAcceso,
      secuencial: ret.secuencial,
      fechaEmision: ret.fechaEmision,
      periodoFiscal: ret.periodoFiscal,
      tipoIdentificacionProveedor: ret.tipoIdentificacionProveedor,
      identificacionProveedor: ret.identificacionProveedor,
      razonSocialProveedor: ret.razonSocialProveedor,
      tipoDocSustento: ret.tipoDocSustento,
      numeroDocSustento: ret.numeroDocSustento,
      fechaEmisionDocSustento: ret.fechaEmisionDocSustento,
      impuestos,
      observaciones: observaciones !== undefined ? observaciones : ret.observaciones,
    }, config);

    const actualizada = await prisma.retenciones.update({
      where: { id: ret.id },
      data: {
        impuestos,
        totalRetenido: parseFloat(totalRetenido.toFixed(2)),
        observaciones: observaciones !== undefined ? observaciones : ret.observaciones,
        xmlGenerado,
        xmlFirmado: null,
        xmlAutorizado: null,
        estadoSri: 'PENDIENTE_FIRMA',
        mensajesSri: null,
      },
    });

    res.json({ ok: true, data: actualizada, mensaje: 'Retención actualizada. Use "Reenviar" para firmarla y enviarla al SRI.' });
  } catch (err) {
    console.error('PUT /retenciones/:id:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/retenciones  — Emitir comprobante de retención
// Body: {
//   periodoFiscal, tipoIdentificacionProveedor, identificacionProveedor, razonSocialProveedor,
//   tipoDocSustento, numeroDocSustento, fechaEmisionDocSustento,
//   impuestos: [{codigo, codigoPorcentaje, baseImponible, porcentajeRetener, valorRetenido}],
//   observaciones
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    const {
      periodoFiscal,
      compraId,
      tipoIdentificacionProveedor,
      identificacionProveedor,
      razonSocialProveedor,
      tipoDocSustento = '01',
      numeroDocSustento,
      fechaEmisionDocSustento,
      impuestos = [],
      observaciones,
    } = req.body;

    const compra = compraId
      ? await obtenerCompraRetencion(compraId, req.empresa.id)
      : null;

    if (compraId && !compra) {
      return res.status(404).json({ ok: false, error: 'La compra seleccionada no existe o no pertenece a la empresa activa' });
    }

    const tipoIdentificacionFinal = compra?.tipoIdentificacionProveedor || tipoIdentificacionProveedor;
    const identificacionFinal = compra?.identificacionProveedor || identificacionProveedor;
    const razonSocialFinal = compra?.razonSocialProveedor || razonSocialProveedor;
    const tipoDocSustentoFinal = compra ? '01' : tipoDocSustento;
    const numeroDocSustentoFinal = compra?.numeroFactura || numeroDocSustento;
    const fechaEmisionDocSustentoFinal = compra?.fechaEmision || fechaEmisionDocSustento;

    if (!periodoFiscal)             return res.status(400).json({ ok: false, error: 'periodoFiscal requerido (MM/YYYY)' });
    if (!identificacionFinal)       return res.status(400).json({ ok: false, error: 'identificacionProveedor requerido' });
    if (!razonSocialFinal)          return res.status(400).json({ ok: false, error: 'razonSocialProveedor requerido' });
    if (!numeroDocSustentoFinal)    return res.status(400).json({ ok: false, error: 'numeroDocSustento requerido' });
    if (!fechaEmisionDocSustentoFinal) return res.status(400).json({ ok: false, error: 'fechaEmisionDocSustento requerida' });
    if (!impuestos || impuestos.length === 0) return res.status(400).json({ ok: false, error: 'Debe ingresar al menos un impuesto retenido' });

    // Calcular secuencial (respeta secuencial inicial configurado)
    const maxSec = await prisma.retenciones.aggregate({
      _max: { secuencial: true },
      where: { empresaId: req.empresa.id, rucEmisor: config.ruc },
    });
    const maxEnBD = parseInt(maxSec._max.secuencial || '0', 10) || 0;
    const { siguienteSecuencial: nextSec } = require('../utils/secuenciales');
    const secuencial = await nextSec(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD, 'secInicialRetencion'
    );

    const fechaEmision = new Date();

    const claveAcceso = sri.generarClaveAcceso({
      fecha:    fechaEmision,
      tipoCod:  sri.TIPO_COMPROBANTE.COMPROBANTE_RETENCION,
      ruc:      config.ruc,
      ambiente: config.ambiente,
      estab:    config.establecimiento,
      ptoEmi:   config.puntoEmision,
      secuencial,
    });

    const numeroRetencion = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

    // Calcular total retenido
    const totalRetenido = impuestos.reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);

    // Generar XML
    const { xml: xmlGenerado } = sri.generarXMLRetencion({
      claveAcceso,
      secuencial,
      fechaEmision,
      periodoFiscal,
      tipoIdentificacionProveedor: tipoIdentificacionFinal,
      identificacionProveedor: identificacionFinal,
      razonSocialProveedor: razonSocialFinal,
      tipoDocSustento: tipoDocSustentoFinal,
      numeroDocSustento: numeroDocSustentoFinal,
      fechaEmisionDocSustento: fechaEmisionDocSustentoFinal,
      impuestos,
      observaciones,
    }, config);

    // Guardar en BD
    const retencion = await prisma.$transaction(async (tx) => {
      const creada = await tx.retenciones.create({
        data: {
          empresaId: req.empresa.id,
          compraId: compra?.id || null,
          claveAcceso,
          numeroRetencion,
          secuencial: String(secuencial),
          rucEmisor: config.ruc,
          periodoFiscal,
          tipoIdentificacionProveedor: tipoIdentificacionFinal,
          identificacionProveedor: identificacionFinal,
          razonSocialProveedor: razonSocialFinal,
          tipoDocSustento: tipoDocSustentoFinal,
          numeroDocSustento: numeroDocSustentoFinal,
          fechaEmisionDocSustento: new Date(fechaEmisionDocSustentoFinal),
          impuestos,
          totalRetenido: parseFloat(totalRetenido.toFixed(2)),
          fechaEmision,
          estadoSri:   'PENDIENTE_FIRMA',
          xmlGenerado,
          emisorId:    req.usuario.id,
          observaciones,
        },
      });

      if (compra?.id) {
        await sincronizarRetencionesCompra(compra.id, tx);
      }

      return creada;
    });

    // Generar RIDE preliminar (sin autorización)
    try {
      const pdfFilename = `retencion-${claveAcceso}.pdf`;
      const pdfPath     = path.join(DIR_RETENCIONES, pdfFilename);
      await sri.generarRIDERetencion(retencion, config, pdfPath);
      await prisma.retenciones.update({
        where: { id: retencion.id },
        data:  { pdfUrl: `/uploads/retenciones/${pdfFilename}` },
      });
    } catch (pdfErr) {
      console.error('Error generando RIDE retención:', pdfErr.message);
    }

    // Procesar asíncronamente (firma + SRI)
    procesarRetencionEnSRI(retencion.id, xmlGenerado, config);

    const retencionActual = await prisma.retenciones.findUnique({ where: { id: retencion.id } });
    res.status(201).json({ ok: true, data: retencionActual });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/retenciones/:id/pdf — Descargar RIDE PDF
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const ret = await prisma.retenciones.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
    });
    if (!ret) return res.status(404).json({ ok: false, error: 'Retención no encontrada' });

    const config = await getConfigSRI(req.empresa.id);
    const pdfFilename = `retencion-${ret.claveAcceso}.pdf`;
    const pdfPath     = path.join(DIR_RETENCIONES, pdfFilename);

    // Regenerar si no existe
    if (!fs.existsSync(pdfPath)) {
      await sri.generarRIDERetencion(ret, config, pdfPath);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/retenciones/:id/xml — Descargar XML
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:id/xml', async (req, res) => {
  try {
    const ret = await prisma.retenciones.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
    });
    if (!ret) return res.status(404).json({ ok: false, error: 'Retención no encontrada' });

    const xmlContent = ret.xmlAutorizado || ret.xmlFirmado || ret.xmlGenerado;
    if (!xmlContent) return res.status(404).json({ ok: false, error: 'XML no disponible' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="retencion-${ret.claveAcceso}.xml"`);
    res.send(xmlContent);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/retenciones/:id/reenviar — Reintentar envío al SRI
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/reenviar', async (req, res) => {
  try {
    const ret = await prisma.retenciones.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
    });
    if (!ret) return res.status(404).json({ ok: false, error: 'Retención no encontrada' });
    if (ret.estadoSri === 'AUTORIZADO') return res.status(400).json({ ok: false, error: 'La retención ya está autorizada' });
    if (ret.anulada) return res.status(400).json({ ok: false, error: 'La retención está anulada' });

    const config = await getConfigSRI(req.empresa.id);
    const xmlParaFirmar = ret.xmlGenerado;
    if (!xmlParaFirmar) return res.status(400).json({ ok: false, error: 'No hay XML generado para reenviar' });

    await prisma.retenciones.update({
      where: { id: ret.id },
      data:  { estadoSri: 'PENDIENTE_FIRMA' },
    });

    procesarRetencionEnSRI(ret.id, xmlParaFirmar, config);

    res.json({ ok: true, mensaje: 'Reenvío iniciado. El estado se actualizará en breve.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/retenciones/:id/anular — Anular retención
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/anular', async (req, res) => {
  try {
    const { motivo } = req.body;
    if (!motivo) return res.status(400).json({ ok: false, error: 'El motivo de anulación es requerido' });

    const ret = await prisma.retenciones.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
    });
    if (!ret) return res.status(404).json({ ok: false, error: 'Retención no encontrada' });
    if (ret.anulada) return res.status(400).json({ ok: false, error: 'La retención ya está anulada' });

    await prisma.$transaction(async (tx) => {
      await tx.retenciones.update({
        where: { id: ret.id },
        data:  { anulada: true, estadoSri: 'ANULADO', observaciones: `ANULADO: ${motivo}` },
      });

      if (ret.compraId) {
        await sincronizarRetencionesCompra(ret.compraId, tx);
      }
    });

    if (REVERSOS_ANULACION_HABILITADOS) {
      try {
        await crearAsientoReversoRetencionAnulada({
          retencionId: ret.id,
          usuarioId: req.usuario.id,
          fecha: new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento reverso por anulación de retención:', contErr.message);
      }
    }

    res.json({ ok: true, mensaje: 'Retención anulada correctamente' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/retenciones/catalogos/impuestos — Catálogos de retenciones
// ─────────────────────────────────────────────────────────────────────────────
router.get('/catalogos/impuestos', async (req, res) => {
  try {
    res.json({
      ok: true,
      data: {
        renta: Object.entries(sri.CODIGOS_RETENCION_RENTA).map(([cod, v]) => ({
          codigo: '1',
          codigoPorcentaje: cod,
          descripcion: v.descripcion,
          porcentaje: v.porcentaje,
        })),
        iva: Object.entries(sri.CODIGOS_RETENCION_IVA).map(([cod, v]) => ({
          codigo: '2',
          codigoPorcentaje: cod,
          descripcion: v.descripcion,
          porcentaje: v.porcentaje,
        })),
        tiposDocSustento: [
          { codigo: '01', descripcion: 'Factura' },
          { codigo: '02', descripcion: 'Nota de Venta' },
          { codigo: '03', descripcion: 'Liquidación de Compra' },
          { codigo: '04', descripcion: 'Nota de Crédito' },
          { codigo: '05', descripcion: 'Nota de Débito' },
          { codigo: '06', descripcion: 'Guía de Remisión' },
          { codigo: '07', descripcion: 'Comprobante de Retención' },
          { codigo: '08', descripcion: 'Doc. emitido por Inst. del Estado' },
          { codigo: '09', descripcion: 'Factura especial sector bancario' },
        ],
        tiposIdentificacion: [
          { codigo: '04', descripcion: 'RUC' },
          { codigo: '05', descripcion: 'Cédula de Identidad' },
          { codigo: '06', descripcion: 'Pasaporte' },
          { codigo: '08', descripcion: 'Identificación Exterior' },
        ],
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
