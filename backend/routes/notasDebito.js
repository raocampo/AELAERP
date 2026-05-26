// ====================================
// RUTAS: NOTAS DE DÉBITO SRI (tipo 05)
// backend/routes/notasDebito.js
// ====================================

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const prisma  = require('../config/prisma');
const sri     = require('../utils/sri');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { esErrorConectividad } = require('../utils/colaSRI');
const { construirConfiguracionSriBase } = require('../utils/sriContribuyente');
const { getCertBuffer, tieneCertificado } = require('../utils/certUtils');
const { enviarDocumentoFiscal } = require('../utils/email');

router.use(proteger);
router.use(autorizarPermiso('facturacion.emitir'));

const DIR_NOTAS_DEBITO = path.join(__dirname, '..', 'uploads', 'notas_debito');
if (!fs.existsSync(DIR_NOTAS_DEBITO)) fs.mkdirSync(DIR_NOTAS_DEBITO, { recursive: true });

// ─── Configuración SRI ─────────────────────────────────────────────────────────
async function getConfigSRI(empresaId) {
  const config = await prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
  if (!config) {
    const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
    if (empresa) return construirConfiguracionSriBase(empresa);
    throw new Error('No hay configuración SRI activa.');
  }
  return config;
}

// ─── Helper SRI ────────────────────────────────────────────────────────────────
async function procesarNotaDebitoEnSRI(ndId, xmlGenerado, config) {
  try {
    if (config.tipoCertificado === 'token') return;
    if (!tieneCertificado(config)) return;

    const p12Buffer  = getCertBuffer(config);
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, config.claveCertificado || '');

    await prisma.notas_debito.update({
      where: { id: ndId },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.notas_debito.update({
        where: { id: ndId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const nd = await prisma.notas_debito.findUnique({ where: { id: ndId } });
    const autorizacion = await sri.autorizarComprobanteSRI(nd.claveAcceso, config.ambiente);

    if (autorizacion.autorizado) {
      const pdfFilename = `nd-${nd.claveAcceso}.pdf`;
      const pdfPath = path.join(DIR_NOTAS_DEBITO, pdfFilename);
      await sri.generarRIDENotaDebito({ ...nd, motivos: nd.motivos }, config, pdfPath);

      await prisma.notas_debito.update({
        where: { id: ndId },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado || xmlFirmado,
          pdfUrl:             `/uploads/notas_debito/${pdfFilename}`,
          mensajesSri:        { autorizacion: autorizacion.estado },
        },
      });

      // Buscar email del comprador en la tabla clientes
      const clienteND = await prisma.clientes.findFirst({
        where:  { empresaId: nd.empresaId, identificacion: nd.identificacionComprador },
        select: { email: true },
      }).catch(() => null);
      if (clienteND?.email) {
        enviarDocumentoFiscal({
          tipo:                  'NOTA_DEBITO',
          numero:                nd.numero,
          email:                 clienteND.email,
          pdfPath,
          razonSocialEmisor:     config.razonSocial,
          nombreComercialEmisor: config.nombreComercial,
          logoUrl:               config.logoUrl,
          razonSocialComprador:  nd.razonSocialComprador,
          fecha:                 nd.fechaEmision,
          total:                 nd.valorTotal,
          claveAcceso:           nd.claveAcceso,
          numeroAutorizacion:    autorizacion.numeroAutorizacion,
        }).catch(err => console.error('[email] ND:', err.message));
      }
    } else {
      await prisma.notas_debito.update({
        where: { id: ndId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: autorizacion },
      });
    }
  } catch (err) {
    console.error('Error procesando ND en SRI:', err.message);
    const nuevoEstado = esErrorConectividad(err) ? 'FIRMADO_PENDIENTE_ENVIO' : 'ERROR';
    await prisma.notas_debito.update({
      where: { id: ndId },
      data:  { estadoSri: nuevoEstado, mensajesSri: { error: err.message, code: err.code } },
    }).catch(() => {});
  }
}

// ─── GET / — Lista con filtros ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, estado, page = 1, limit = 20 } = req.query;
    const where = { empresaId: req.empresa.id, anulada: false };

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

    const [total, items] = await Promise.all([
      prisma.notas_debito.count({ where }),
      prisma.notas_debito.findMany({
        where,
        orderBy: { fechaEmision: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
    ]);

    res.json({ ok: true, data: items, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const nd = await prisma.notas_debito.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nd) return res.status(404).json({ ok: false, mensaje: 'Nota de débito no encontrada' });
    res.json({ ok: true, data: nd });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── POST / — Crear nota de débito ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      tipoIdentificacionComprador,
      identificacionComprador,
      razonSocialComprador,
      codDocSustento = '01',
      numeroDocSustento,
      fechaEmisionDocSustento,
      motivos,
      ivaPorcentaje = 15,
      observaciones,
    } = req.body;

    if (!motivos?.length) {
      return res.status(400).json({ ok: false, mensaje: 'Debe especificar al menos un motivo' });
    }
    if (!numeroDocSustento) {
      return res.status(400).json({ ok: false, mensaje: 'Número de documento sustento requerido' });
    }

    const config = await getConfigSRI(req.empresa.id);

    // Calcular secuencial (respeta secuencial inicial configurado)
    const lastND = await prisma.notas_debito.findFirst({
      where: { empresaId: req.empresa.id },
      orderBy: { secuencial: 'desc' },
      select: { secuencial: true },
    });
    const maxEnBD_nd = lastND ? (parseInt(lastND.secuencial, 10) || 0) : 0;
    const { siguienteSecuencial: nextSec_nd } = require('../utils/secuenciales');
    const secuencialNum_nd = await nextSec_nd(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD_nd, 'secInicialNotaDebito'
    );
    const secuencial = String(secuencialNum_nd).padStart(9, '0');

    const fechaEmision = new Date();
    const claveAcceso  = sri.generarClaveAcceso({
      fecha:      fechaEmision,
      tipoCod:    sri.TIPO_COMPROBANTE.NOTA_DEBITO,
      ruc:        config.ruc,
      ambiente:   config.ambiente,
      estab:      config.establecimiento,
      ptoEmi:     config.puntoEmision,
      secuencial,
    });

    const numero = `${String(config.establecimiento).padStart(3,'0')}-${String(config.puntoEmision).padStart(3,'0')}-${secuencial}`;

    // Calcular totales
    const totalSinImpuestos = parseFloat(
      motivos.reduce((acc, m) => acc + parseFloat(m.valor || 0), 0).toFixed(2)
    );
    const ivaRate   = parseInt(ivaPorcentaje) || 15;
    const IVA_TARIFA = sri.IVA_TARIFA;
    const totalIva  = parseFloat((totalSinImpuestos * (IVA_TARIFA[ivaRate] ?? 0)).toFixed(2));
    const valorTotal = parseFloat((totalSinImpuestos + totalIva).toFixed(2));

    const { xml, totales } = sri.generarXMLNotaDebito({
      claveAcceso,
      secuencial,
      fechaEmision,
      tipoIdentificacionComprador,
      identificacionComprador,
      razonSocialComprador,
      codDocSustento,
      numeroDocSustento,
      fechaEmisionDocSustento: new Date(fechaEmisionDocSustento),
      motivos,
      ivaPorcentaje: ivaRate,
    }, config);

    const nd = await prisma.notas_debito.create({
      data: {
        empresaId:                  req.empresa.id,
        claveAcceso,
        numero,
        secuencial,
        rucEmisor:                  config.ruc,
        codDocSustento,
        numeroDocSustento,
        fechaEmisionDocSustento:    new Date(fechaEmisionDocSustento),
        tipoIdentificacionComprador,
        identificacionComprador,
        razonSocialComprador,
        motivos,
        ivaPorcentaje:              ivaRate,
        totalSinImpuestos,
        totalIva,
        valorTotal,
        estadoSri:                  'PENDIENTE_FIRMA',
        xmlGenerado:                xml,
        fechaEmision,
        emisorId:                   req.usuario.id,
        observaciones,
      },
    });

    // Procesar con SRI en background
    procesarNotaDebitoEnSRI(nd.id, xml, config).catch((e) =>
      console.error('SRI ND background:', e.message)
    );

    res.status(201).json({ ok: true, data: nd });
  } catch (err) {
    console.error('Error crear ND:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── POST /:id/reenviar — Reenviar al SRI ─────────────────────────────────────
router.post('/:id/reenviar', async (req, res) => {
  try {
    const nd = await prisma.notas_debito.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nd) return res.status(404).json({ ok: false, mensaje: 'No encontrada' });
    if (['AUTORIZADO', 'ANULADO'].includes(nd.estadoSri)) {
      return res.status(400).json({ ok: false, mensaje: `No se puede reenviar una ND ${nd.estadoSri}` });
    }

    const config = await getConfigSRI(req.empresa.id);
    await procesarNotaDebitoEnSRI(nd.id, nd.xmlGenerado, config);
    const actualizada = await prisma.notas_debito.findUnique({ where: { id: nd.id } });
    res.json({ ok: true, data: actualizada });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── DELETE /:id/anular ────────────────────────────────────────────────────────
router.delete('/:id/anular', async (req, res) => {
  try {
    const nd = await prisma.notas_debito.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nd) return res.status(404).json({ ok: false, mensaje: 'No encontrada' });
    if (nd.anulada) return res.status(400).json({ ok: false, mensaje: 'Ya está anulada' });

    await prisma.notas_debito.update({
      where: { id: nd.id },
      data:  { anulada: true, motivoAnulacion: req.body.motivo || 'Anulada por el usuario' },
    });
    res.json({ ok: true, mensaje: 'Nota de débito anulada' });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

module.exports = router;
