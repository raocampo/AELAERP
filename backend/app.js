// ====================================
// AELA — Configuración de la app Express
// backend/app.js
// ====================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Combina FRONTEND_URL y CORS_EXTRA_ORIGINS para facilitar dominios personalizados
    const base   = (process.env.FRONTEND_URL       || 'http://localhost:5174').split(',').map(s => s.trim());
    const extra  = (process.env.CORS_EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowed = [...new Set([...base, ...extra])];
    // En desarrollo permitir cualquier origen localhost/127.0.0.1
    if (!origin || process.env.NODE_ENV !== 'production') return callback(null, true);
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origen no permitido → ${origin}`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const authRoutes = require('./routes/auth');
const usuariosRoutes = require('./routes/usuarios');
const clientesRoutes = require('./routes/clientes');
const proveedoresRoutes = require('./routes/proveedores');
const productosRoutes = require('./routes/productos');
const comprasRoutes = require('./routes/compras');
const facturasRoutes = require('./routes/facturas');
const retencionesRoutes = require('./routes/retenciones');
const liquidacionesRoutes = require('./routes/liquidacionesCompra');
const atsRoutes = require('./routes/ats');
const contabilidadRoutes = require('./routes/contabilidad');
const empresasRoutes = require('./routes/empresas');
const notasVentaRoutes = require('./routes/notasVenta');
const configuracionSistemaRoutes = require('./routes/configuracionSistema');
const cajaRoutes = require('./routes/caja');
const inventarioRoutes = require('./routes/inventario');
const registroRoutes = require('./routes/registro');
const syncRoutes = require('./routes/sync');
const notasDebitoRoutes = require('./routes/notasDebito');
const declaracionesRoutes = require('./routes/declaraciones');
const buzonRoutes = require('./routes/buzon');
const guiasRemisionRoutes = require('./routes/guiasRemision');
const bancosRoutes = require('./routes/bancos');
const comprobantesBancariosRoutes = require('./routes/comprobantes-bancarios');
const cxcRoutes = require('./routes/cxc');
const cxpRoutes = require('./routes/cxp');
const cajaChicaRoutes = require('./routes/cajaChica');
const anticiposRoutes = require('./routes/anticipos');
const transportistasRoutes = require('./routes/transportistas');
const talentoHumanoRoutes = require('./routes/talentoHumano');
const puntosEmisionRoutes = require('./routes/puntosEmision');
const superAdminRoutes    = require('./routes/superAdmin');
const impresoraRoutes     = require('./routes/impresora');
const utilidadesRoutes    = require('./routes/utilidades');
const proformasRoutes             = require('./routes/proformas');
const retencionesRecibidasRoutes  = require('./routes/retenciones-recibidas');
const { soloMediumOPro, soloPro } = require('./middleware/edition');
const { contarPendientes } = require('./utils/colaSRI');
const { proteger } = require('./middleware/auth');
const { resolverTenant } = require('./middleware/tenant');
const prismaModule        = require('./config/prisma');

// 1. Resolver tenant → inyecta req.prisma con el cliente de la BD del tenant
app.use(resolverTenant);

// 2. Si el tenant fue resuelto, activar su cliente como contexto global de prisma
//    para este request. Así todos los módulos que hacen require('./config/prisma')
//    obtienen automáticamente el cliente correcto sin necesidad de usar req.prisma.
app.use((req, _res, next) => {
  if (req.prisma && req.prisma !== prismaModule._globalClient) {
    prismaModule.runWithClient(req.prisma, next);
  } else {
    next();
  }
});

app.use('/api/registro', registroRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/empresas', empresasRoutes);
app.use('/api/configuracion-sistema', configuracionSistemaRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/proveedores', soloMediumOPro, proveedoresRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/compras', soloMediumOPro, comprasRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/impresora', impresoraRoutes);
app.use('/api/caja', cajaRoutes);
app.use('/api/facturas', facturasRoutes);
app.use('/api/notas-venta', notasVentaRoutes);
app.use('/api/retenciones', soloPro, retencionesRoutes);
app.use('/api/liquidaciones', soloPro, liquidacionesRoutes);
app.use('/api/liquidaciones-compra', soloPro, liquidacionesRoutes);
app.use('/api/ats', soloPro, atsRoutes);
app.use('/api/contabilidad', soloPro, contabilidadRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/notas-debito', notasDebitoRoutes);
app.use('/api/declaraciones', soloPro, declaracionesRoutes);
app.use('/api/buzon', soloMediumOPro, buzonRoutes);
app.use('/api/retenciones-recibidas', soloMediumOPro, retencionesRecibidasRoutes);
app.use('/api/guias-remision', soloMediumOPro, guiasRemisionRoutes);
app.use('/api/transportistas', soloMediumOPro, transportistasRoutes);
app.use('/api/bancos', bancosRoutes);
app.use('/api/comprobantes-bancarios', comprobantesBancariosRoutes);
app.use('/api/cxc', cxcRoutes);
app.use('/api/cxp', cxpRoutes);
app.use('/api/caja-chica', cajaChicaRoutes);
app.use('/api/anticipos', anticiposRoutes);
app.use('/api/talento-humano', soloMediumOPro, talentoHumanoRoutes);
app.use('/api/puntos-emision', puntosEmisionRoutes);
app.use('/api/super-admin',   superAdminRoutes);
app.use('/api/utilidades',    utilidadesRoutes);
app.use('/api/proformas',     proformasRoutes);

app.get('/api/cola-sri/estado', proteger, async (req, res) => {
  try {
    const empresaId = req.empresa?.id || (req.query.empresaId ? parseInt(req.query.empresaId, 10) : undefined);
    const pendientes = await contarPendientes(empresaId);
    res.json({ ok: true, pendientes });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    mensaje: '🧾 AELA API — ERP de Comprobantes Fiscales Inteligentes',
    version: '1.0.0',
    ambiente: process.env.NODE_ENV || 'development',
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, status: 'healthy', ts: Date.now() });
});

app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({
    success: false,
    mensaje: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

module.exports = app;
