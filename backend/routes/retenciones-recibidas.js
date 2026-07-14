// ====================================
// RUTAS: RETENCIONES RECIBIDAS (del Buzón SRI)
// backend/routes/retenciones-recibidas.js
// ====================================

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { parsearRetencionRecibida } = require('../utils/buzon');
const { leerExcel, validarFila, generarPlantilla } = require('../utils/importarRetencionesRecibidas');
const { crearAsientoRetencionRecibida } = require('../utils/contabilidad');
const { registrarAuditoria } = require('../utils/auditoria');

const upload = multer({ storage: multer.memoryStorage() });

router.use(proteger);
router.use(autorizarPermiso('compras.gestionar'));

// ─── Helper: where con filtros ────────────────────────────────
function buildWhereRR(empresaId, q) {
  const { desde, hasta, agente, incluirAnuladas } = q;
  const where = { empresaId };
  if (incluirAnuladas !== 'true') where.anulada = false;
  if (desde || hasta) {
    where.fechaEmision = {};
    if (desde) where.fechaEmision.gte = new Date(desde);
    if (hasta) { const h = new Date(hasta); h.setHours(23,59,59,999); where.fechaEmision.lte = h; }
  }
  if (agente) {
    where.OR = [
      { rucAgente: { contains: agente, mode: 'insensitive' } },
      { razonSocialAgente: { contains: agente, mode: 'insensitive' } },
    ];
  }
  return where;
}

// GET /api/retenciones-recibidas/exportar/xlsx
router.get('/exportar/xlsx', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;
    const XLSX = require('xlsx');
    const items = await db.retenciones_recibidas.findMany({
      where: buildWhereRR(empresaId, req.query),
      orderBy: { fechaEmision: 'desc' },
      take: 5000,
      select: {
        claveAcceso: true, rucAgente: true, razonSocialAgente: true,
        fechaEmision: true, numDocSustento: true,
        totalRetencionIva: true, totalRetencionRenta: true, anulada: true,
      },
    });

    function extraerNumero(ca) {
      if (!ca || ca.length < 39) return ca || '';
      return `${ca.substring(24,27)}-${ca.substring(27,30)}-${ca.substring(30,39)}`;
    }

    const fmtDate = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';
    const fmtNum  = (v) => Number(v || 0).toFixed(2);

    const headers = ['N° Retención', 'Fecha', 'Agente (Cliente)', 'RUC Agente', 'Doc. Sustento', 'Ret. IVA', 'Ret. Renta', 'Total', 'Anulada'];
    const rows    = items.map(r => {
      const totRet = Number(r.totalRetencionIva || 0) + Number(r.totalRetencionRenta || 0);
      return [extraerNumero(r.claveAcceso), fmtDate(r.fechaEmision), r.razonSocialAgente, r.rucAgente, r.numDocSustento || '', fmtNum(r.totalRetencionIva), fmtNum(r.totalRetencionRenta), fmtNum(totRet), r.anulada ? 'Si' : 'No'];
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 36 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Ret. Recibidas');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="retenciones-recibidas-${fecha}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error('GET /retenciones-recibidas/exportar/xlsx:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/retenciones-recibidas/exportar/pdf
router.get('/exportar/pdf', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;
    const PDFDocument = require('pdfkit');

    const [items, cfg] = await Promise.all([
      db.retenciones_recibidas.findMany({
        where: buildWhereRR(empresaId, req.query),
        orderBy: { fechaEmision: 'desc' },
        take: 5000,
        select: {
          claveAcceso: true, rucAgente: true, razonSocialAgente: true,
          fechaEmision: true, totalRetencionIva: true, totalRetencionRenta: true, anulada: true,
        },
      }),
      prisma.configuracion_sri.findFirst({ where: { empresaId }, select: { razonSocial: true, ruc: true } }),
    ]);

    function extraerNumero(ca) {
      if (!ca || ca.length < 39) return ca || '';
      return `${ca.substring(24,27)}-${ca.substring(27,30)}-${ca.substring(30,39)}`;
    }

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="retenciones-recibidas-${fecha}.pdf"`);

    const ML = 32, W = 531, ROWH = 14, NEGRO = '#1e293b', GRIS = '#64748b', VERDE = '#0f766e';
    const COLS = [
      { x: ML,      w: 110, label: 'N° Retención', align: 'left'  },
      { x: ML+110,  w: 52,  label: 'Fecha',        align: 'left'  },
      { x: ML+162,  w: 195, label: 'Agente',       align: 'left'  },
      { x: ML+357,  w: 72,  label: 'RUC Agente',   align: 'left'  },
      { x: ML+429,  w: 48,  label: 'Ret. IVA',     align: 'right' },
      { x: ML+477,  w: 54,  label: 'Ret. Renta',   align: 'right' },
    ];

    const doc = new PDFDocument({ size: 'A4', margins: { top: 32, bottom: 32, left: 32, right: 32 }, autoFirstPage: true });
    doc.pipe(res);

    let y = 32;
    doc.fontSize(12).font('Helvetica-Bold').fillColor(NEGRO).text(cfg?.razonSocial || '', ML, y, { width: W });
    y = doc.y + 2;
    doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(`RUC: ${cfg?.ruc || '—'}  |  Generado: ${new Date().toLocaleString('es-EC')}`, ML, y, { width: W });
    y = doc.y + 8;
    doc.fontSize(13).font('Helvetica-Bold').fillColor(VERDE).text('COMPROBANTES DE RETENCIÓN RECIBIDOS', ML, y, { width: W });
    y = doc.y + 4;
    doc.fontSize(7.5).font('Helvetica').fillColor(GRIS).text(`${items.length} registro(s)`, ML, y, { width: W });
    y = doc.y + 10;
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke(VERDE);
    y += 6;

    const drawColHeaders = () => {
      doc.rect(ML, y - 1, W, ROWH + 2).fill('#ecfeff');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(VERDE);
      COLS.forEach(c => doc.text(c.label, c.x, y, { width: c.w, align: c.align, lineBreak: false }));
      y += ROWH;
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.4).stroke('#94a3b8');
      y += 3;
    };
    drawColHeaders();

    const fmtDate = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';
    const fmtNum  = (v) => `$${Number(v || 0).toFixed(2)}`;

    let totIva = 0, totRenta = 0;
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      if (y > doc.page.height - 64) { doc.addPage(); y = 32; drawColHeaders(); }
      if (i % 2 === 1) doc.rect(ML, y - 1, W, ROWH + 1).fill('#f8fafc');
      doc.fontSize(7.5).font('Helvetica').fillColor(r.anulada ? '#94a3b8' : NEGRO);
      const cells = [extraerNumero(r.claveAcceso), fmtDate(r.fechaEmision), (r.razonSocialAgente || '').slice(0, 32), r.rucAgente, fmtNum(r.totalRetencionIva), fmtNum(r.totalRetencionRenta)];
      COLS.forEach((c, j) => doc.text(cells[j], c.x, y, { width: c.w, align: c.align, lineBreak: false }));
      y += ROWH;
      totIva   += Number(r.totalRetencionIva || 0);
      totRenta += Number(r.totalRetencionRenta || 0);
    }

    if (y > doc.page.height - 48) { doc.addPage(); y = 32; }
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.6).stroke('#94a3b8');
    y += 4;
    doc.rect(ML, y - 1, W, ROWH + 2).fill('#ecfeff');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(VERDE);
    COLS.forEach((c, i) => doc.text(i === 0 ? 'TOTALES' : (i === 4 ? fmtNum(totIva) : (i === 5 ? fmtNum(totRenta) : '')), c.x, y, { width: c.w, align: c.align, lineBreak: false }));
    doc.end();
  } catch (err) {
    console.error('GET /retenciones-recibidas/exportar/pdf:', err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── GET / — listar con filtros ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;
    const { page = 1, limit = 15, desde, hasta, agente, incluirAnuladas } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { empresaId };
    if (incluirAnuladas !== 'true') where.anulada = false;
    if (desde && hasta) {
      where.fechaEmision = { gte: new Date(desde), lte: new Date(hasta + 'T23:59:59') };
    } else if (desde) {
      where.fechaEmision = { gte: new Date(desde) };
    } else if (hasta) {
      where.fechaEmision = { lte: new Date(hasta + 'T23:59:59') };
    }
    if (agente) {
      where.OR = [
        { rucAgente: { contains: agente, mode: 'insensitive' } },
        { razonSocialAgente: { contains: agente, mode: 'insensitive' } },
      ];
    }

    const [total, datos] = await Promise.all([
      db.retenciones_recibidas.count({ where }),
      db.retenciones_recibidas.findMany({
        where,
        orderBy: { fechaEmision: 'desc' },
        skip,
        take: Number(limit),
        select: {
          id: true,
          claveAcceso: true,
          numeroAutorizacion: true,
          rucAgente: true,
          razonSocialAgente: true,
          fechaEmision: true,
          numDocSustento: true,
          totalRetencionIva: true,
          totalRetencionRenta: true,
          detalles: true,
          anulada: true,
          observaciones: true,
          facturaId: true,
        },
      }),
    ]);

    res.json({ data: datos, total, pages: Math.ceil(total / Number(limit)), page: Number(page) });
  } catch (err) {
    console.error('[retenciones-recibidas GET /]', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// IMPORTACIÓN MASIVA DESDE EXCEL (mismo patrón que /api/compras/importar —
// preview sin escribir, luego ejecutar solo las filas válidas). Registrado
// antes de /:id/xml a propósito: rutas estáticas primero, para que Express
// nunca intente matchear "importar" como si fuera un :id.
// ────────────────────────────────────────────────────────────────────────────

// GET /api/retenciones-recibidas/importar/plantilla
router.get('/importar/plantilla', (_req, res) => {
  try {
    const buffer = generarPlantilla();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-retenciones-recibidas.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// POST /api/retenciones-recibidas/importar/preview — valida sin escribir
router.post('/importar/preview', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió archivo' });

    const filas = leerExcel(req.file.buffer);
    if (filas.length === 0) return res.status(400).json({ success: false, mensaje: 'El archivo está vacío o no tiene datos en la primera hoja' });
    if (filas.length > 1000) return res.status(400).json({ success: false, mensaje: 'Máximo 1000 filas por importación' });

    const resultado = filas.map((raw, idx) => {
      const { valida, errores, datos } = validarFila(raw);
      return { fila: idx + 2, valida, errores, datos };
    });

    const validas = resultado.filter((r) => r.valida).length;
    res.json({ success: true, filas: resultado, validas, invalidas: resultado.length - validas, total: filas.length });
  } catch (error) {
    console.error('POST /retenciones-recibidas/importar/preview:', error);
    res.status(500).json({ success: false, mensaje: `Error al procesar archivo: ${error.message}` });
  }
});

// POST /api/retenciones-recibidas/importar/ejecutar — importa las filas válidas
router.post('/importar/ejecutar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió archivo' });

    const db = req.prisma || prisma;
    const empresaId = req.empresa.id;

    const filasRaw = leerExcel(req.file.buffer);
    if (filasRaw.length === 0) return res.status(400).json({ success: false, mensaje: 'El archivo está vacío' });
    if (filasRaw.length > 1000) return res.status(400).json({ success: false, mensaje: 'Máximo 1000 filas por importación' });

    const importadas = [];
    const errores = [];

    for (const [idx, raw] of filasRaw.entries()) {
      const filaNum = idx + 2;
      const { valida, errores: errs, datos } = validarFila(raw);

      if (!valida) {
        errores.push({ fila: filaNum, errores: errs });
        continue;
      }

      try {
        const existente = await db.retenciones_recibidas.findFirst({
          where: { empresaId, claveAcceso: datos.claveAcceso },
          select: { id: true },
        });
        if (existente) {
          errores.push({ fila: filaNum, errores: [`Ya existe una retención con esta clave de acceso (id ${existente.id})`] });
          continue;
        }

        let facturaId = null;
        if (datos.numDocSustento) {
          const f = await db.facturas.findFirst({ where: { empresaId, numeroFactura: datos.numDocSustento }, select: { id: true } });
          facturaId = f?.id || null;
        }

        const creada = await db.retenciones_recibidas.create({
          data: { empresaId, facturaId, ...datos },
          select: { id: true, claveAcceso: true, fechaEmision: true, totalRetencionIva: true, totalRetencionRenta: true },
        });

        let asientoOk = false;
        try {
          const rAsiento = await crearAsientoRetencionRecibida({ retencionRecibidaId: creada.id, usuarioId: req.usuario.id, fecha: datos.fechaEmision, db });
          asientoOk = !!rAsiento.asiento;
        } catch (contErr) {
          console.error(`[Importar retenciones] Asiento contable fila ${filaNum} (retención ${creada.id}):`, contErr.message);
        }

        importadas.push({
          fila: filaNum,
          id: creada.id,
          agente: datos.razonSocialAgente,
          total: parseFloat(creada.totalRetencionIva) + parseFloat(creada.totalRetencionRenta),
          asientoOk,
        });
      } catch (err) {
        console.error(`[Importar retenciones] fila ${filaNum}:`, err.message);
        errores.push({ fila: filaNum, errores: [err.message] });
      }
    }

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      empresaId,
      accion: 'IMPORTAR_RETENCIONES_RECIBIDAS',
      tabla: 'retenciones_recibidas',
      datosNuevos: { importadas: importadas.length, errores: errores.length },
    });

    res.json({ success: true, importadas: importadas.length, errores: errores.length, detalle: { importadas, errores } });
  } catch (error) {
    console.error('POST /retenciones-recibidas/importar/ejecutar:', error);
    res.status(500).json({ success: false, mensaje: `Error en importación: ${error.message}` });
  }
});

// ─── GET /:id/xml — descargar XML ──────────────────────────────
router.get('/:id/xml', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;
    const doc = await db.retenciones_recibidas.findFirst({
      where: { id: Number(req.params.id), empresaId },
      select: { xmlAutorizado: true, claveAcceso: true },
    });
    if (!doc) return res.status(404).json({ error: 'No encontrado' });
    if (!doc.xmlAutorizado) return res.status(404).json({ error: 'XML no disponible' });
    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="ret-rec-${doc.claveAcceso}.xml"`);
    res.send(doc.xmlAutorizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /recalcular — re-parsea el XML guardado y corrige totales ────
// Repara registros importados antes del fix de parseo: tag <valorRetenido>
// del SRI se leía como <valorRetener> (totales en $0.00), el schema v2.0.0
// anidado (docsSustento) no se soportaba, y fechaEmision caía en la fecha
// de importación en vez de la fecha real del comprobante.
// Idempotente: si el XML ya se parseaba bien, no cambia nada.
router.post('/recalcular', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;

    const registros = await db.retenciones_recibidas.findMany({
      where: { empresaId, xmlAutorizado: { not: null } },
      select: { id: true, xmlAutorizado: true },
    });

    let corregidos = 0;
    let errores = 0;

    for (const r of registros) {
      try {
        const datos = parsearRetencionRecibida(r.xmlAutorizado, r.xmlAutorizado);
        await db.retenciones_recibidas.update({
          where: { id: r.id },
          data: {
            totalRetencionIva: datos.totalRetencionIva,
            totalRetencionRenta: datos.totalRetencionRenta,
            detalles: datos.detalles,
            numDocSustento: datos.numDocSustento,
            fechaEmision: datos.fechaEmision,
          },
        });
        corregidos++;
      } catch (err) {
        console.error(`[retenciones-recibidas recalcular] id=${r.id}:`, err.message);
        errores++;
      }
    }

    res.json({ success: true, total: registros.length, corregidos, errores });
  } catch (err) {
    console.error('[retenciones-recibidas POST /recalcular]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
