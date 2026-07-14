// ====================================
// RUTAS: WebService Externo — AELA ERP
// /api/ext/v1/*
//
// Permite a sistemas externos que YA emiten su propia factura electrónica
// autorizada por el SRI (ej. AVALAB — laboratorio clínico con su propio
// convenio de facturación electrónica) enviar a AELA los datos de esas
// facturas y sus cobros, para que AELA lleve la contabilidad. AELA NO
// autoriza estos comprobantes ante el SRI — ya llegan autorizados — por lo
// que el flujo espeja al de "Importar facturas históricas"
// (utils/importarFacturasHistoricas.js): inserta el registro con
// estadoSri='AUTORIZADO' y genera el asiento contable directamente, sin
// pasar por la cola de firma/envío SRI (utils/colaSRI.js).
//
// Autenticación: header X-API-Key = key generada desde el panel SuperAdmin
// La key identifica el tenant destino; no se necesita X-Tenant-Slug.
//
// Endpoints:
//   GET  /api/ext/v1/status              — Health check / info del tenant
//   POST /api/ext/v1/clientes            — Crear o actualizar cliente
//   POST /api/ext/v1/facturas            — Registrar factura ya autorizada por el SRI
//   GET  /api/ext/v1/facturas/:id        — Estado de una factura
//   POST /api/ext/v1/pagos               — Registrar cobro sobre una factura
// ====================================

const express         = require('express');
const router          = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');
const { getTenantPrisma } = require('../config/prismaTenant');
const { parsearNumeroFactura } = require('../utils/importarFacturasHistoricas');
const {
  crearAsientoFacturaAutorizada,
  crearAsientoCobroCliente,
  siguienteNumeroGenerico,
  round2,
} = require('../utils/contabilidad');

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'cheque', 'tarjeta'];

// SRI: 04=RUC, 05=Cédula, 06=Pasaporte, 07=Consumidor Final, 08=Id. exterior
function inferirTipoIdentificacion(identificacion) {
  const len = String(identificacion || '').length;
  if (len === 13) return '04';
  if (len === 10) return '05';
  return '06';
}

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
// tipoIdentificacion (si se envía): código SRI '04' RUC | '05' Cédula | '06' Pasaporte
router.post('/clientes', async (req, res) => {
  const { identificacion, razonSocial, tipoIdentificacion, email, telefono, direccion } = req.body;
  if (!identificacion || !razonSocial) {
    return res.status(400).json({ success: false, error: 'identificacion y razonSocial son requeridos' });
  }

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada en este tenant' });

    const tipoId = tipoIdentificacion || inferirTipoIdentificacion(identificacion);

    const cliente = await req.prisma.clientes.upsert({
      where: { empresaId_identificacion: { identificacion: String(identificacion), empresaId: empresa.id } },
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
// Registra una factura de venta YA autorizada por el SRI a nombre del sistema
// externo (AELA no la firma ni la envía al SRI — solo lleva la contabilidad).
// Body: {
//   claveAcceso: string,                  — clave de acceso SRI de 49 dígitos (requerido, idempotente)
//   numeroAutorizacion?: string,          — si difiere de claveAcceso (normalmente son iguales)
//   numeroFactura: string,                — formato "001-001-000012345" (requerido)
//   fechaEmision: string (ISO),           — requerido
//   clienteIdentificacion: string,        — cédula/RUC del cliente (requerido)
//   clienteRazonSocial: string,           — requerido
//   clienteTipoIdentificacion?: string,   — código SRI, se infiere de la longitud si se omite
//   clienteEmail?: string,
//   items: [{ descripcion, cantidad, precioUnitario, descuento?, ivaPorcentaje? }], — requerido, ivaPorcentaje: 0|5|15 (default 15)
//   observaciones?: string,
// }
router.post('/facturas', async (req, res) => {
  const {
    claveAcceso, numeroAutorizacion, numeroFactura, fechaEmision,
    clienteIdentificacion, clienteRazonSocial, clienteTipoIdentificacion, clienteEmail,
    items, observaciones,
  } = req.body;

  if (!claveAcceso || !numeroFactura || !fechaEmision) {
    return res.status(400).json({ success: false, error: 'claveAcceso, numeroFactura y fechaEmision son requeridos' });
  }
  if (!clienteIdentificacion || !clienteRazonSocial) {
    return res.status(400).json({ success: false, error: 'clienteIdentificacion y clienteRazonSocial son requeridos' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items es requerido y no puede estar vacío' });
  }
  const numParseado = parsearNumeroFactura(numeroFactura);
  if (!numParseado) {
    return res.status(400).json({ success: false, error: 'numeroFactura debe tener formato "001-001-000012345"' });
  }
  const fecha = new Date(fechaEmision);
  if (isNaN(fecha.getTime())) {
    return res.status(400).json({ success: false, error: 'fechaEmision inválida' });
  }

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada en este tenant' });

    // Idempotencia: si ya se registró esta clave de acceso, devolver la existente
    const existente = await req.prisma.facturas.findUnique({
      where:  { claveAcceso: String(claveAcceso) },
      select: { id: true, numeroFactura: true, importeTotal: true, estadoSri: true, fechaEmision: true },
    });
    if (existente) {
      return res.status(200).json({ success: true, data: existente, mensaje: 'Ya existía, se devuelve la factura registrada' });
    }

    const config = await req.prisma.configuracion_sri.findFirst({ where: { empresaId: empresa.id } });
    if (!config) return res.status(400).json({ success: false, error: 'La empresa no tiene Configuración SRI (ruc/razón social)' });

    const cliente = await req.prisma.clientes.upsert({
      where: { empresaId_identificacion: { identificacion: String(clienteIdentificacion), empresaId: empresa.id } },
      update: { razonSocial: String(clienteRazonSocial) },
      create: {
        empresaId:          empresa.id,
        identificacion:     String(clienteIdentificacion),
        razonSocial:        String(clienteRazonSocial),
        tipoIdentificacion: clienteTipoIdentificacion || inferirTipoIdentificacion(clienteIdentificacion),
        email:              clienteEmail ? String(clienteEmail).toLowerCase() : null,
      },
    });

    // Totales por tarifa de IVA (0 / 5 / 15), igual que el resto del sistema
    const lineas = items.map(it => {
      const cantidad       = parseFloat(it.cantidad)       || 1;
      const precioUnitario = parseFloat(it.precioUnitario) || 0;
      const descuento      = parseFloat(it.descuento)      || 0;
      const ivaPorcentaje  = [0, 5, 15].includes(Number(it.ivaPorcentaje)) ? Number(it.ivaPorcentaje) : 15;
      const subtotal       = round2(cantidad * precioUnitario - descuento);
      const iva            = round2(subtotal * (ivaPorcentaje / 100));
      return {
        codigoPrincipal: it.codigoSri || null,
        descripcion:     String(it.descripcion || 'Servicio'),
        cantidad, precioUnitario, descuento, ivaPorcentaje, subtotal, iva,
      };
    });

    const subtotal0  = round2(lineas.filter(l => l.ivaPorcentaje === 0).reduce((s, l) => s + l.subtotal, 0));
    const subtotal5  = round2(lineas.filter(l => l.ivaPorcentaje === 5).reduce((s, l) => s + l.subtotal, 0));
    const subtotal15 = round2(lineas.filter(l => l.ivaPorcentaje === 15).reduce((s, l) => s + l.subtotal, 0));
    const totalIva    = round2(lineas.reduce((s, l) => s + l.iva, 0));
    const importeTotal = round2(subtotal0 + subtotal5 + subtotal15 + totalIva);

    const creada = await req.prisma.facturas.create({
      data: {
        empresaId:                   empresa.id,
        claveAcceso:                 String(claveAcceso),
        numeroFactura:               numeroFactura,
        secuencial:                  numParseado.secuencial,
        rucEmisor:                   config.ruc,
        razonSocialEmisor:           config.razonSocial,
        tipoIdentificacionComprador: cliente.tipoIdentificacion,
        identificacionComprador:     cliente.identificacion,
        razonSocialComprador:        cliente.razonSocial,
        emailComprador:              clienteEmail || null,
        clienteId:                   cliente.id,
        fechaEmision:                fecha,
        subtotal0, subtotal5, subtotal15,
        totalIva,
        importeTotal,
        detalles:                    lineas,
        pagos:                       [],
        estadoSri:                   'AUTORIZADO',
        numeroAutorizacion:          numeroAutorizacion || String(claveAcceso),
        fechaAutorizacion:           fecha,
        origenRegistro:              'WEBSERVICE',
        observaciones:               observaciones || null,
      },
      select: { id: true, numeroFactura: true, importeTotal: true, estadoSri: true, fechaEmision: true },
    });

    // No bloquea la respuesta si falla — igual que la importación de históricas
    let asientoOk = false;
    try {
      const r = await crearAsientoFacturaAutorizada({ facturaId: creada.id, usuarioId: null, fecha, db: req.prisma });
      asientoOk = !!r.asiento;
    } catch (contErr) {
      console.error(`[ext] Asiento contable factura ${creada.id}:`, contErr.message);
    }

    res.status(201).json({ success: true, data: { ...creada, asientoOk } });
  } catch (err) {
    console.error('[ext] POST /facturas:', err.message);
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Ya existe una factura con esa clave de acceso o número' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/ext/v1/facturas/:id ────────────────────────────────────────────
// Estado y datos básicos de una factura registrada via WebService
router.get('/facturas/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

    const factura = await req.prisma.facturas.findUnique({
      where:  { id },
      select: {
        id: true, numeroFactura: true, fechaEmision: true, importeTotal: true,
        estadoSri: true, anulada: true, origenRegistro: true,
      },
    });

    if (!factura) return res.status(404).json({ success: false, error: 'Factura no encontrada' });
    res.json({ success: true, data: factura });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/pagos ──────────────────────────────────────────────────
// Registrar un cobro sobre una factura ya registrada (mismo subledger que usa
// Cuentas por Cobrar — cobros_cliente — no una tabla aparte).
// Body: { facturaId, monto, metodoPago, referencia?, fecha? }
// metodoPago: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta'
router.post('/pagos', async (req, res) => {
  const { facturaId, monto, metodoPago, referencia, fecha } = req.body;
  const montoNum = round2(monto);
  if (!facturaId || !(montoNum > 0)) {
    return res.status(400).json({ success: false, error: 'facturaId y monto (> 0) son requeridos' });
  }
  const metodo = String(metodoPago || '').trim().toLowerCase();
  if (!METODOS_VALIDOS.includes(metodo)) {
    return res.status(400).json({ success: false, error: `metodoPago debe ser uno de: ${METODOS_VALIDOS.join(', ')}` });
  }
  const fechaCobro = fecha ? new Date(fecha) : new Date();
  if (isNaN(fechaCobro.getTime())) {
    return res.status(400).json({ success: false, error: 'fecha inválida' });
  }

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada en este tenant' });

    const cobro = await req.prisma.$transaction(async (tx) => {
      const factura = await tx.facturas.findFirst({ where: { id: parseInt(facturaId, 10), empresaId: empresa.id } });
      if (!factura) throw Object.assign(new Error('Factura no encontrada'), { status: 404 });
      if (factura.anulada) throw Object.assign(new Error('La factura está anulada'), { status: 400 });

      await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${factura.id} FOR UPDATE`;

      const agg = await tx.cobros_cliente.aggregate({
        where: { empresaId: empresa.id, facturaId: factura.id, anulado: false },
        _sum: { monto: true },
      });
      const saldo = round2(factura.importeTotal - (agg._sum.monto || 0));
      if (montoNum > saldo + 0.01) {
        throw Object.assign(new Error(`El monto excede el saldo pendiente ($${saldo.toFixed(2)})`), { status: 400 });
      }

      const numero = await siguienteNumeroGenerico({ modelo: 'cobros_cliente', prefijo: 'REC', empresaId: empresa.id, fecha: fechaCobro, tx });
      const nuevo = await tx.cobros_cliente.create({
        data: {
          empresaId: empresa.id, facturaId: factura.id, clienteId: factura.clienteId || null,
          numero, fecha: fechaCobro, monto: montoNum, metodoPago: metodo,
          referencia: referencia || null,
        },
      });
      await crearAsientoCobroCliente({ cobroId: nuevo.id, usuarioId: null, fecha: fechaCobro, db: tx });
      return nuevo;
    });

    res.status(201).json({ success: true, data: { id: cobro.id, numero: cobro.numero, monto: cobro.monto } });
  } catch (err) {
    console.error('[ext] POST /pagos:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
