// ====================================
// RUTAS: ESTADÍSTICAS DE VENTAS
// backend/routes/estadisticas.js
// ====================================

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { diaCalendarioEC } = require('../utils/fechas');
const { calcularTotalesMensuales, calcularVariacionPct, acumularTopProductos } = require('../utils/estadisticas');

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

function rangoAnio(anio) {
  return {
    gte: new Date(`${anio}-01-01T00:00:00.000Z`),
    lt: new Date(`${anio + 1}-01-01T00:00:00.000Z`),
  };
}

function anioActualEC() {
  return Number(diaCalendarioEC().slice(0, 4));
}

async function obtenerTotalesDelAnio(req, anio) {
  const empresaId = req.empresa.id;
  const { gte, lt } = rangoAnio(anio);
  const [facturas, notas] = await Promise.all([
    req.prisma.facturas.findMany({
      where: { empresaId, anulada: false, estadoSri: { in: ESTADOS_FACTURA_VALIDOS }, fechaEmision: { gte, lt } },
      select: { importeTotal: true, fechaEmision: true, pagos: true },
    }),
    req.prisma.notas_venta.findMany({
      where: { empresaId, anulada: false, fechaEmision: { gte, lt } },
      select: { total: true, fechaEmision: true, formaPago: true, pagos: true },
    }),
  ]);
  return calcularTotalesMensuales(facturas, notas);
}

// GET /api/estadisticas/ventas-mensuales?anio=2026
// Ventas del año (Factura + Nota de Venta) agrupadas por mes calendario,
// con desglose efectivo/bancos y comparación contra el año anterior.
router.get('/ventas-mensuales', autorizarPermiso('estadisticas.ver'), async (req, res) => {
  try {
    const anio = parseInt(req.query.anio, 10) || anioActualEC();
    const anioAnterior = anio - 1;

    const [actual, anterior] = await Promise.all([
      obtenerTotalesDelAnio(req, anio),
      obtenerTotalesDelAnio(req, anioAnterior),
    ]);

    res.json({
      success: true,
      data: {
        anio,
        ...actual,
        anioAnterior,
        totalAnioAnterior: anterior.totalAnio,
        variacionPct: calcularVariacionPct(actual.totalAnio, anterior.totalAnio),
      },
    });
  } catch (error) {
    console.error('GET /estadisticas/ventas-mensuales:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron cargar las estadísticas de ventas' });
  }
});

// GET /api/estadisticas/top-productos?anio=2026&limit=10
// Productos más vendidos del año (por monto), a partir del JSON `detalles`
// de facturas/notas de venta — no existe tabla relacional de líneas de venta.
router.get('/top-productos', autorizarPermiso('estadisticas.ver'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const anio = parseInt(req.query.anio, 10) || anioActualEC();
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const { gte, lt } = rangoAnio(anio);

    const [facturas, notas] = await Promise.all([
      req.prisma.facturas.findMany({
        where: { empresaId, anulada: false, estadoSri: { in: ESTADOS_FACTURA_VALIDOS }, fechaEmision: { gte, lt } },
        select: { detalles: true },
      }),
      req.prisma.notas_venta.findMany({
        where: { empresaId, anulada: false, fechaEmision: { gte, lt } },
        select: { detalles: true },
      }),
    ]);

    const listasDeDetalles = [...facturas.map((f) => f.detalles), ...notas.map((n) => n.detalles)];
    const productos = acumularTopProductos(listasDeDetalles, limit);

    res.json({ success: true, data: { anio, productos } });
  } catch (error) {
    console.error('GET /estadisticas/top-productos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron cargar los productos más vendidos' });
  }
});

module.exports = router;
