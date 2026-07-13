// ====================================
// RUTAS: WebService Externo — AELA ERP
// /api/ext/v1/*
//
// Permite a sistemas externos (ej. AVALAB, laboratorios, POS de terceros)
// integrarse con AELA ERP vía API REST autenticada con API key.
//
// Autenticación: header X-API-Key = key generada desde el panel SuperAdmin
// La key identifica el tenant destino; no se necesita X-Tenant-Slug.
//
// Endpoints:
//   GET  /api/ext/v1/status              — Health check / info del tenant
//   POST /api/ext/v1/clientes            — Crear o actualizar cliente
//   POST /api/ext/v1/facturas            — Crear factura (modo borrador o directa)
//   GET  /api/ext/v1/facturas/:id        — Estado de una factura
//   POST /api/ext/v1/pagos               — Registrar pago de factura
// ====================================

const express         = require('express');
const router          = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');
const { getTenantPrisma } = require('../config/prismaTenant');

// ─── Middleware: autenticación por API key ────────────────────────────────────
async function autenticarApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Se requiere header X-API-Key' });
  }

  const master = getPrismaMaster();
  if (!master) {
    return res.status(503).json({ success: false, error: 'Modo monoinstancia: WebService no disponible' });
  }

  try {
    // Buscar tenant cuyo brandConfig.apiKey coincide
    const tenants = await master.tenants.findMany({
      where: { estado: 'activo' },
      select: { id: true, slug: true, plan: true, estado: true,
                dbName: true, dbHost: true, dbPort: true, dbUser: true, dbPass: true,
                brandConfig: true },
    });

    const tenant = tenants.find(t => {
      const bc = t.brandConfig;
      return bc && typeof bc === 'object' && bc.apiKey === apiKey;
    });

    if (!tenant) {
      return res.status(401).json({ success: false, error: 'API key inválida o revocada' });
    }

    req.tenant = tenant;
    req.prisma = await getTenantPrisma(tenant);
    next();
  } catch (err) {
    console.error('[ext] Error auth apikey:', err.message);
    res.status(500).json({ success: false, error: 'Error interno de autenticación' });
  }
}

router.use(autenticarApiKey);

// ─── GET /api/ext/v1/status ──────────────────────────────────────────────────
// Health check — confirma que la key es válida y devuelve info básica del tenant
router.get('/status', async (req, res) => {
  try {
    const empresa = await req.prisma.empresas.findFirst({ select: { razonSocial: true, ruc: true } });
    res.json({
      success: true,
      tenant:  req.tenant.slug,
      empresa: empresa?.razonSocial || null,
      ruc:     empresa?.ruc || null,
      version: '1.0',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/clientes ───────────────────────────────────────────────
// Crear o actualizar un cliente por identificación (cédula / RUC / pasaporte)
// Body: { identificacion, razonSocial, tipoIdentificacion?, email?, telefono?, direccion? }
router.post('/clientes', async (req, res) => {
  const { identificacion, razonSocial, tipoIdentificacion, email, telefono, direccion } = req.body;
  if (!identificacion || !razonSocial) {
    return res.status(400).json({ success: false, error: 'identificacion y razonSocial son requeridos' });
  }

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada en este tenant' });

    const tipoId = tipoIdentificacion || (identificacion.length === 13 ? 'RUC' : identificacion.length === 10 ? 'CEDULA' : 'PASAPORTE');

    const cliente = await req.prisma.clientes.upsert({
      where: { identificacion_empresaId: { identificacion: String(identificacion), empresaId: empresa.id } },
      update: {
        razonSocial: String(razonSocial),
        email:       email     ? String(email).toLowerCase()   : undefined,
        telefono:    telefono  ? String(telefono)              : undefined,
        direccion:   direccion ? String(direccion)             : undefined,
      },
      create: {
        empresaId:          empresa.id,
        identificacion:     String(identificacion),
        razonSocial:        String(razonSocial),
        tipoIdentificacion: tipoId,
        email:              email     ? String(email).toLowerCase() : null,
        telefono:           telefono  ? String(telefono)            : null,
        direccion:          direccion ? String(direccion)           : null,
      },
    });

    res.status(201).json({ success: true, data: { id: cliente.id, identificacion: cliente.identificacion } });
  } catch (err) {
    console.error('[ext] POST /clientes:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/facturas ───────────────────────────────────────────────
// Crear una factura de venta en AELA desde un sistema externo.
// Body: {
//   clienteIdentificacion: string,        — cédula/RUC del cliente
//   clienteRazonSocial: string,
//   fecha?: string (ISO),                 — default: hoy
//   items: [{ descripcion, cantidad, precioUnitario, descuento?, codigoSri? }],
//   formaPago?: string,                   — 'efectivo' | 'transferencia' | ...
//   observaciones?: string,
//   referencia?: string,                  — ID o número del sistema externo (AVALAB)
// }
router.post('/facturas', async (req, res) => {
  const { clienteIdentificacion, clienteRazonSocial, fecha, items, formaPago, observaciones, referencia } = req.body;

  if (!clienteIdentificacion || !clienteRazonSocial) {
    return res.status(400).json({ success: false, error: 'clienteIdentificacion y clienteRazonSocial son requeridos' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items es requerido y no puede estar vacío' });
  }

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada' });

    // Upsert cliente
    const tipoId = clienteIdentificacion.length === 13 ? 'RUC' : clienteIdentificacion.length === 10 ? 'CEDULA' : 'PASAPORTE';
    const cliente = await req.prisma.clientes.upsert({
      where: { identificacion_empresaId: { identificacion: String(clienteIdentificacion), empresaId: empresa.id } },
      update: { razonSocial: String(clienteRazonSocial) },
      create: {
        empresaId:          empresa.id,
        identificacion:     String(clienteIdentificacion),
        razonSocial:        String(clienteRazonSocial),
        tipoIdentificacion: tipoId,
      },
    });

    // Calcular totales
    const lineas = items.map(it => {
      const cantidad       = parseFloat(it.cantidad)       || 1;
      const precioUnitario = parseFloat(it.precioUnitario) || 0;
      const descuento      = parseFloat(it.descuento)      || 0;
      const subtotal       = cantidad * precioUnitario - descuento;
      const iva            = it.aplicaIva !== false ? subtotal * 0.15 : 0;
      return { ...it, cantidad, precioUnitario, descuento, subtotal, iva };
    });

    const subtotal0   = lineas.filter(l => l.aplicaIva === false).reduce((s, l) => s + l.subtotal, 0);
    const subtotal15  = lineas.filter(l => l.aplicaIva !== false).reduce((s, l) => s + l.subtotal, 0);
    const totalIva    = lineas.reduce((s, l) => s + l.iva, 0);
    const totalGeneral = subtotal0 + subtotal15 + totalIva;

    // Obtener siguiente secuencial
    const config = await req.prisma.configuracion_sri.findFirst({ where: { empresaId: empresa.id } });
    const establecimiento = config?.establecimiento || '001';
    const puntoEmision    = config?.puntoEmision    || '001';
    const ultimaFactura   = await req.prisma.facturas.findFirst({
      where:   { empresaId: empresa.id },
      orderBy: { secuencial: 'desc' },
      select:  { secuencial: true },
    });
    const siguiente = (ultimaFactura?.secuencial || 0) + 1;
    const numero = `${establecimiento}-${puntoEmision}-${String(siguiente).padStart(9, '0')}`;

    const factura = await req.prisma.facturas.create({
      data: {
        empresaId:     empresa.id,
        clienteId:     cliente.id,
        numero,
        secuencial:    siguiente,
        fecha:         fecha ? new Date(fecha) : new Date(),
        subtotal0,
        subtotal15,
        totalIva,
        totalGeneral,
        formaPago:     formaPago || 'efectivo',
        observaciones: observaciones || null,
        referencia:    referencia    || null,
        estadoSri:     'PENDIENTE_FIRMA',
        estado:        'EMITIDA',
        fuente:        'webservice',
        detalles: {
          create: lineas.map(l => ({
            descripcion:    String(l.descripcion),
            cantidad:       l.cantidad,
            precioUnitario: l.precioUnitario,
            descuento:      l.descuento,
            subtotal:       l.subtotal,
            iva:            l.iva,
            codigoSri:      l.codigoSri || null,
          })),
        },
      },
      select: { id: true, numero: true, totalGeneral: true, estadoSri: true },
    });

    res.status(201).json({ success: true, data: factura });
  } catch (err) {
    console.error('[ext] POST /facturas:', err.message);
    // Detectar campo faltante en el schema (Prisma unknown field)
    if (err.message.includes('Unknown argument') || err.message.includes('Invalid')) {
      return res.status(400).json({ success: false, error: 'Datos inválidos: ' + err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/ext/v1/facturas/:id ────────────────────────────────────────────
// Estado y datos básicos de una factura creada via WebService
router.get('/facturas/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

    const factura = await req.prisma.facturas.findUnique({
      where:  { id },
      select: { id: true, numero: true, fecha: true, totalGeneral: true, estadoSri: true, estado: true, referencia: true },
    });

    if (!factura) return res.status(404).json({ success: false, error: 'Factura no encontrada' });
    res.json({ success: true, data: factura });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/pagos ──────────────────────────────────────────────────
// Registrar un pago sobre una factura existente
// Body: { facturaId, monto, formaPago, referencia?, fecha? }
router.post('/pagos', async (req, res) => {
  const { facturaId, monto, formaPago, referencia, fecha } = req.body;
  if (!facturaId || !monto) {
    return res.status(400).json({ success: false, error: 'facturaId y monto son requeridos' });
  }

  try {
    const factura = await req.prisma.facturas.findUnique({ where: { id: parseInt(facturaId, 10) } });
    if (!factura) return res.status(404).json({ success: false, error: 'Factura no encontrada' });

    const empresa = await req.prisma.empresas.findFirst();

    const pago = await req.prisma.pagos_factura.create({
      data: {
        facturaId:   factura.id,
        empresaId:   empresa.id,
        monto:       parseFloat(monto),
        formaPago:   formaPago || 'efectivo',
        referencia:  referencia || null,
        fecha:       fecha ? new Date(fecha) : new Date(),
        fuente:      'webservice',
      },
    });

    res.status(201).json({ success: true, data: { id: pago.id, monto: pago.monto } });
  } catch (err) {
    console.error('[ext] POST /pagos:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
