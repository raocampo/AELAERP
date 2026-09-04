// ====================================
// RUTAS: ESTADÍSTICAS DE VENTAS
// backend/routes/estadisticas.js
// ====================================

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { diaCalendarioEC } = require('../utils/fechas');
const { round2 } = require('../utils/contabilidad');

router.use(proteger);
// En modo monoinstancia resolverTenant (app.js) no inyecta req.prisma —
// solo lo hace para tenants SaaS resueltos. Sin este fallback (mismo
// patrón que empresas.js/cajaChica.js/cxc.js/cxp.js) req.prisma queda
// undefined y explota en el primer .facturas.findMany() — exactamente
// el error que tiró en Railway (modo MONOEMPRESA).
router.use((req, _res, next) => { req.prisma = req.prisma || prisma; next(); });

// Mismo criterio de "venta real" que backend/routes/empresas.js (Dashboard) —
// excluye rechazadas, en proceso de firma/envío, con error, etc.
const ESTADOS_FACTURA_VALIDOS = ['AUTORIZADO', 'HISTORICO'];
const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// GET /api/estadisticas/ventas-mensuales?anio=2026
// Ventas del año (Factura + Nota de Venta) agrupadas por mes calendario.
router.get('/ventas-mensuales', autorizarPermiso('estadisticas.ver'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const anio = parseInt(req.query.anio, 10) || Number(diaCalendarioEC().slice(0, 4));
    const inicio = new Date(`${anio}-01-01T00:00:00.000Z`);
    const fin    = new Date(`${anio + 1}-01-01T00:00:00.000Z`);

    const [facturas, notas] = await Promise.all([
      req.prisma.facturas.findMany({
        where: {
          empresaId, anulada: false,
          estadoSri: { in: ESTADOS_FACTURA_VALIDOS },
          fechaEmision: { gte: inicio, lt: fin },
        },
        select: { importeTotal: true, fechaEmision: true },
      }),
      req.prisma.notas_venta.findMany({
        where: { empresaId, anulada: false, fechaEmision: { gte: inicio, lt: fin } },
        select: { total: true, fechaEmision: true },
      }),
    ]);

    const meses = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1,
      nombre: NOMBRES_MES[i],
      ventasFacturas: 0,
      ventasNotas: 0,
      ventasTotal: 0,
      comprobantes: 0,
      ticketPromedio: 0,
    }));

    // fechaEmision es un campo "solo-fecha" (medianoche UTC exacta
    // representando el día calendario, ver el comentario de cabecera de
    // utils/fechas.js) — getUTCMonth() lee el mes real sin pasar por la
    // zona horaria del proceso (Railway corre en UTC), a diferencia de
    // getMonth() que reinterpretaría según la hora local del servidor.
    facturas.forEach((f) => {
      const m = meses[f.fechaEmision.getUTCMonth()];
      m.ventasFacturas += Number(f.importeTotal || 0);
      m.comprobantes += 1;
    });
    notas.forEach((n) => {
      const m = meses[n.fechaEmision.getUTCMonth()];
      m.ventasNotas += Number(n.total || 0);
      m.comprobantes += 1;
    });
    meses.forEach((m) => {
      m.ventasFacturas = round2(m.ventasFacturas);
      m.ventasNotas = round2(m.ventasNotas);
      m.ventasTotal = round2(m.ventasFacturas + m.ventasNotas);
      m.ticketPromedio = m.comprobantes > 0 ? round2(m.ventasTotal / m.comprobantes) : 0;
    });

    const totalAnio = round2(meses.reduce((a, m) => a + m.ventasTotal, 0));
    const comprobantesAnio = meses.reduce((a, m) => a + m.comprobantes, 0);
    const ticketPromedioAnio = comprobantesAnio > 0 ? round2(totalAnio / comprobantesAnio) : 0;

    res.json({
      success: true,
      data: { anio, meses, totalAnio, comprobantesAnio, ticketPromedioAnio },
    });
  } catch (error) {
    console.error('GET /estadisticas/ventas-mensuales:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron cargar las estadísticas de ventas' });
  }
});

module.exports = router;
