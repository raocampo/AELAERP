// ============================================================
//  AELA — Buzón SRI: rutas de importación en lote
//  backend/routes/buzon.js
//
//  POST /api/buzon/consultar   → preview de N claves
//  POST /api/buzon/importar    → importación confirmada
//  POST /api/buzon/importar-zip → ZIP de XMLs
// ============================================================

const express = require('express');
const multer  = require('multer');
const AdmZip  = require('adm-zip');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { requiereModulo } = require('../middleware/modulos');
const { obtenerXmlDesdeAutorizacion } = require('../utils/importacionProductos');
const {
  detectarTipoDesdeClaveAcceso,
  importarDocumentoRecibido,
  TIPOS_DOCUMENTO,
} = require('../utils/buzon');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const MAX_CLAVES_LOTE = 50;

router.use(proteger);
router.use(requiereModulo('comprasHabilitadas'));
router.use(autorizarPermiso('compras.gestionar'));

// ─── Normalizar clave ────────────────────────────────────────
function limpiarClave(texto) {
  return String(texto || '').replace(/\s+/g, '').trim();
}

// ─── Verificar si ya existe en BD ───────────────────────────
async function yaExisteEnBd(empresaId, clave, tipoDoc) {
  if (!clave) return false;
  const destino = TIPOS_DOCUMENTO[tipoDoc]?.destino;
  if (destino === 'facturas_compra') {
    const r = await prisma.facturas_compra.findFirst({ where: { empresaId, claveAcceso: clave }, select: { id: true } });
    return r ? r.id : false;
  }
  if (destino === 'retenciones_recibidas') {
    const r = await prisma.retenciones_recibidas.findFirst({ where: { empresaId, claveAcceso: clave }, select: { id: true } });
    return r ? r.id : false;
  }
  if (destino === 'docs_recibidos_otros') {
    const r = await prisma.docs_recibidos_otros.findFirst({ where: { empresaId, claveAcceso: clave }, select: { id: true } });
    return r ? r.id : false;
  }
  return false;
}

// ─── Obtener preview básico del XML (sin parseo pesado) ──────
function previewDeXml(xmlEnvuelto, tipoDoc) {
  const rucMatch   = xmlEnvuelto?.match(/<ruc>([^<]+)<\/ruc>/i);
  const rsMatch    = xmlEnvuelto?.match(/<razonSocial>([^<]+)<\/razonSocial>/i);
  const fechaMatch = xmlEnvuelto?.match(/<fechaEmision>([^<]+)<\/fechaEmision>/i);
  const totalMatch = xmlEnvuelto?.match(/<importeTotal>([^<]+)<\/importeTotal>/i)
    || xmlEnvuelto?.match(/<totalComprobante>([^<]+)<\/totalComprobante>/i)
    || xmlEnvuelto?.match(/<importe_total>([^<]+)<\/importe_total>/i);

  return {
    emisorRuc:    rucMatch   ? rucMatch[1].trim()   : null,
    emisorNombre: rsMatch    ? rsMatch[1].trim()     : null,
    fecha:        fechaMatch ? fechaMatch[1].trim()  : null,
    total:        totalMatch ? Number(totalMatch[1]) || 0 : 0,
    tipo:         TIPOS_DOCUMENTO[tipoDoc]?.nombre || tipoDoc,
  };
}

// ─── POST /consultar ─────────────────────────────────────────
router.post('/consultar', async (req, res) => {
  try {
    const { claves = [] } = req.body || {};
    const empresaId = req.empresa.id;

    const clavesLimpias = [...new Set(
      claves.map(limpiarClave).filter((c) => c.length === 49)
    )].slice(0, MAX_CLAVES_LOTE);

    if (clavesLimpias.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se proporcionaron claves de acceso válidas (49 dígitos)' });
    }

    const resultados = [];

    for (const clave of clavesLimpias) {
      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ clave, estado: 'error', error: 'Tipo de documento no reconocido en la clave' });
        continue;
      }

      // ¿Ya existe?
      const idExistente = await yaExisteEnBd(empresaId, clave, tipo.cod);
      if (idExistente) {
        resultados.push({ clave, estado: 'existe', tipo: tipo.nombre, idExistente });
        continue;
      }

      // Consultar SRI
      try {
        const respSRI = await obtenerXmlDesdeAutorizacion(clave);
        const preview = previewDeXml(respSRI.xml, tipo.cod);
        resultados.push({
          clave,
          estado: 'nuevo',
          tipo: tipo.nombre,
          tipoCod: tipo.cod,
          destino: tipo.destino,
          preview,
          numeroAutorizacion: respSRI.numeroAutorizacion,
          ambiente: respSRI.ambiente,
          // El XML no se devuelve al cliente por tamaño; se re-consultará al importar
        });
      } catch (err) {
        resultados.push({ clave, estado: 'error', tipo: tipo.nombre, error: err.message || 'No se pudo obtener el XML del SRI' });
      }
    }

    res.json({ success: true, total: clavesLimpias.length, resultados });
  } catch (error) {
    console.error('Error en /buzon/consultar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al consultar el SRI' });
  }
});

// ─── POST /importar ──────────────────────────────────────────
router.post('/importar', async (req, res) => {
  try {
    const { items = [], opciones = {} } = req.body || {};
    const empresaId  = req.empresa.id;
    const usuarioId  = req.usuario?.id || null;

    if (items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se enviaron documentos a importar' });
    }
    if (items.length > MAX_CLAVES_LOTE) {
      return res.status(400).json({ success: false, mensaje: `Máximo ${MAX_CLAVES_LOTE} documentos por lote` });
    }

    const resultados = [];

    for (const item of items) {
      const clave = limpiarClave(item.clave);
      if (!clave || clave.length !== 49) {
        resultados.push({ clave, estado: 'error', error: 'Clave inválida' });
        continue;
      }

      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ clave, estado: 'error', error: 'Tipo de documento no reconocido' });
        continue;
      }

      try {
        // Re-consultar SRI para obtener XML fresco
        const respSRI = await obtenerXmlDesdeAutorizacion(clave);

        const resultado = await prisma.$transaction(async (tx) => {
          return importarDocumentoRecibido({
            tx,
            empresaId,
            usuarioId,
            tipoDoc: tipo.cod,
            xmlAutorizado: respSRI.xml,
            xmlEnvuelto: respSRI.xml,
            claveAcceso: clave,
            numeroAutorizacion: respSRI.numeroAutorizacion || clave,
            fechaAutorizacion: null,
            opcionesFactura: opciones,
          });
        });

        resultados.push({ clave, tipo: tipo.nombre, estado: resultado.accion, id: resultado.id, motivo: resultado.motivo });
      } catch (err) {
        console.error(`[Buzón] Error importando ${clave}:`, err.message);
        resultados.push({ clave, tipo: tipo.nombre, estado: 'error', error: err.message });
      }
    }

    const creados  = resultados.filter((r) => r.estado === 'creado').length;
    const omitidos = resultados.filter((r) => r.estado === 'omitido').length;
    const errores  = resultados.filter((r) => r.estado === 'error').length;

    res.json({ success: true, resumen: { creados, omitidos, errores }, resultados });
  } catch (error) {
    console.error('Error en /buzon/importar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al importar los documentos' });
  }
});

// ─── POST /importar-zip ──────────────────────────────────────
router.post('/importar-zip', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });
    }

    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const opciones  = req.body?.opciones ? JSON.parse(req.body.opciones || '{}') : {};

    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ success: false, mensaje: 'El archivo no es un ZIP válido' });
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.xml'));
    if (entries.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'El ZIP no contiene archivos XML' });
    }
    if (entries.length > MAX_CLAVES_LOTE) {
      return res.status(400).json({ success: false, mensaje: `El ZIP contiene ${entries.length} archivos. Máximo ${MAX_CLAVES_LOTE} por lote.` });
    }

    const resultados = [];

    for (const entry of entries) {
      const xmlString = entry.getData().toString('utf8');
      const filename  = entry.name;

      // Extraer clave de acceso del XML (infoTributaria/claveAcceso)
      const claveMatch = xmlString.match(/<claveAcceso>([^<]{49})<\/claveAcceso>/i);
      const clave = claveMatch ? claveMatch[1].trim() : null;

      if (!clave) {
        resultados.push({ archivo: filename, estado: 'error', error: 'No se encontró clave de acceso (49 dígitos) en el XML' });
        continue;
      }

      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ archivo: filename, clave, estado: 'error', error: 'Tipo de documento no reconocido' });
        continue;
      }

      try {
        const resultado = await prisma.$transaction(async (tx) => {
          return importarDocumentoRecibido({
            tx,
            empresaId,
            usuarioId,
            tipoDoc: tipo.cod,
            xmlAutorizado: xmlString,
            xmlEnvuelto: xmlString,
            claveAcceso: clave,
            numeroAutorizacion: clave,
            fechaAutorizacion: null,
            opcionesFactura: opciones,
          });
        });

        resultados.push({ archivo: filename, clave, tipo: tipo.nombre, estado: resultado.accion, id: resultado.id, motivo: resultado.motivo });
      } catch (err) {
        console.error(`[Buzón ZIP] Error importando ${filename}:`, err.message);
        resultados.push({ archivo: filename, clave, tipo: tipo.nombre, estado: 'error', error: err.message });
      }
    }

    const creados  = resultados.filter((r) => r.estado === 'creado').length;
    const omitidos = resultados.filter((r) => r.estado === 'omitido').length;
    const errores  = resultados.filter((r) => r.estado === 'error').length;

    res.json({ success: true, resumen: { creados, omitidos, errores, totalArchivos: entries.length }, resultados });
  } catch (error) {
    console.error('Error en /buzon/importar-zip:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar el archivo ZIP' });
  }
});

// ─── GET /historial ──────────────────────────────────────────
router.get('/historial', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { tipo = 'todos', page = 1, limit = 30 } = req.query;
    const take = parseInt(limit, 10) || 30;
    const skip = ((parseInt(page, 10) || 1) - 1) * take;

    const [facturas, retenciones, docsOtros] = await Promise.all([
      (tipo === 'todos' || tipo === 'facturas') ? prisma.facturas_compra.findMany({
        where: { empresaId, origenRegistro: 'BUZON_SRI' },
        orderBy: { createdAt: 'desc' },
        take: tipo === 'todos' ? 10 : take,
        select: { id: true, numeroFactura: true, razonSocialProveedor: true, fechaEmision: true, importeTotal: true, createdAt: true },
      }) : Promise.resolve([]),
      (tipo === 'todos' || tipo === 'retenciones') ? prisma.retenciones_recibidas.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
        take: tipo === 'todos' ? 10 : take,
        select: { id: true, claveAcceso: true, razonSocialAgente: true, fechaEmision: true, totalRetencionIva: true, totalRetencionRenta: true, createdAt: true },
      }) : Promise.resolve([]),
      (tipo === 'todos' || tipo === 'otros') ? prisma.docs_recibidos_otros.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
        take: tipo === 'todos' ? 10 : take,
        select: { id: true, claveAcceso: true, tipoDescripcion: true, razonSocialEmisor: true, fechaEmision: true, importeTotal: true, createdAt: true },
      }) : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: { facturas, retenciones, docsOtros },
    });
  } catch (error) {
    console.error('Error en /buzon/historial:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener el historial' });
  }
});

module.exports = router;
