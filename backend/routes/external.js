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
//   GET  /api/ext/v1/facturas            — Listar facturas registradas (por rango de fechas)
//   POST /api/ext/v1/facturas/verificar  — Cuáles claves de acceso ya están / faltan
//   GET  /api/ext/v1/facturas/:id        — Estado y saldo de una factura (id o claveAcceso)
//   POST /api/ext/v1/facturas/anular     — Anular una factura (anulada en el SRI)
//   POST /api/ext/v1/notas-credito       — Registrar nota de crédito ya autorizada
//   GET  /api/ext/v1/bancos              — Cuentas bancarias para los cobros
//   POST /api/ext/v1/pagos               — Registrar cobro (idempotente por idPagoExterno)
//   POST /api/ext/v1/pagos/anular        — Anular un cobro
//   GET  /api/ext/v1/log                 — Bitácora de llamadas a esta API
//
// Bitácora: cada llamada no-GET queda en la tabla ext_api_log (SQL crudo,
// creada por applySchemaFixes.js) — permite saber si un comprobante llegó a
// enviarse y con qué error, sin depender de los logs de Railway.
// ====================================

const express         = require('express');
const router          = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');
const { getTenantPrisma } = require('../config/prismaTenant');
const prismaModule    = require('../config/prisma');
const { parsearNumeroFactura } = require('../utils/importarFacturasHistoricas');
const {
  crearAsientoFacturaAutorizada,
  crearAsientoCobroCliente,
  crearAsientoReversoCobroCliente,
  crearAsientoNotaCreditoEmitida,
  crearAsientoReversoFacturaAnulada,
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

// Clave de acceso SRI: 49 dígitos
const esClaveAcceso = (v) => /^\d{49}$/.test(String(v || '').trim());

// Líneas y totales por tarifa de IVA (0 / 5 / 15), igual que el resto del sistema
function calcularLineas(items) {
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
  return { lineas, subtotal0, subtotal5, subtotal15, totalIva, importeTotal };
}

// Ubica la factura por id de AELA, clave de acceso o número (001-001-000012345).
async function buscarFactura(db, empresaId, { facturaId, claveAcceso, numeroFactura }) {
  if (facturaId !== undefined && facturaId !== null && facturaId !== '') {
    const id = parseInt(facturaId, 10);
    if (isNaN(id)) return null;
    return db.facturas.findFirst({ where: { id, empresaId } });
  }
  if (claveAcceso) {
    return db.facturas.findFirst({ where: { claveAcceso: String(claveAcceso).trim(), empresaId } });
  }
  if (numeroFactura) {
    const n = parsearNumeroFactura(numeroFactura);
    if (!n) return null;
    return db.facturas.findFirst({
      where: { empresaId, establecimiento: n.estab, puntoEmision: n.ptoEmi, secuencial: n.secuencial },
      orderBy: { id: 'desc' },
    });
  }
  return null;
}

// Saldo = total − cobros vigentes − notas de crédito autorizadas (igual que CxC)
async function calcularSaldo(db, factura) {
  const [cob, nc] = await Promise.all([
    db.cobros_cliente.aggregate({
      where: { empresaId: factura.empresaId, facturaId: factura.id, anulado: false },
      _sum: { monto: true },
    }),
    db.notas_credito.aggregate({
      where: { empresaId: factura.empresaId, facturaId: factura.id, estadoSri: 'AUTORIZADO', anulada: false },
      _sum: { importeTotal: true },
    }),
  ]);
  const totalCobrado      = round2(Number(cob._sum.monto || 0));
  const totalNotasCredito = round2(Number(nc._sum.importeTotal || 0));
  return {
    totalCobrado, totalNotasCredito,
    saldo: round2(Number(factura.importeTotal) - totalCobrado - totalNotasCredito),
  };
}

// Banco destino de un cobro no-efectivo: el indicado, el configurado por
// defecto para la API (brandConfig.extBancoId del tenant) o, si la empresa
// tiene una sola cuenta activa, esa. Si no, null (cuenta contable genérica).
async function resolverBanco(db, empresaId, tenant, bancoId) {
  if (bancoId !== undefined && bancoId !== null && bancoId !== '') {
    const id = parseInt(bancoId, 10);
    const b = isNaN(id) ? null : await db.bancos.findFirst({ where: { id, empresaId, activo: true } });
    if (!b) throw Object.assign(new Error('bancoId no existe o está inactivo (ver GET /bancos)'), { status: 400 });
    return b.id;
  }
  const porDefecto = parseInt(tenant?.brandConfig?.extBancoId, 10);
  if (!isNaN(porDefecto)) {
    const b = await db.bancos.findFirst({ where: { id: porDefecto, empresaId, activo: true } });
    if (b) return b.id;
  }
  const activos = await db.bancos.findMany({ where: { empresaId, activo: true }, select: { id: true }, take: 2 });
  return activos.length === 1 ? activos[0].id : null;
}

// Referencia legible para la bitácora: el identificador del comprobante
function referenciaLog(req) {
  const b = req.body || {};
  const v = b.idPagoExterno || b.claveAcceso || b.facturaClaveAcceso || b.numeroFactura
    || b.numeroNotaCredito || b.facturaId || req.params?.id || null;
  return v === null ? null : String(v).slice(0, 120);
}

// Guarda cada llamada (salvo consultas GET) en ext_api_log al terminar la respuesta.
function registrarEnBitacora(req, res) {
  if (req.method === 'GET') return;
  const inicio = Date.now();
  let errorMsg = null;
  const jsonOriginal = res.json.bind(res);
  res.json = (body) => {
    if (body && body.success === false && body.error) errorMsg = String(body.error).slice(0, 2000);
    return jsonOriginal(body);
  };
  res.on('finish', () => {
    const ruta = String(req.originalUrl || req.url).slice(0, 200);
    req.prisma.$executeRaw`
      INSERT INTO ext_api_log ("metodo", "ruta", "status", "referencia", "error", "duracionMs")
      VALUES (${req.method}, ${ruta}, ${res.statusCode}, ${referenciaLog(req)}, ${errorMsg}, ${Date.now() - inicio})
    `.catch((e) => console.error('[ext] bitácora:', e.message));
  });
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
    registrarEnBitacora(req, res);
    // Las funciones contables que no reciben `db` usan el prisma de contexto:
    // activarlo con este tenant (app.js no puede, la key se resuelve aquí).
    prismaModule.runWithClient(req.prisma, next);
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
      version: '1.1',
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

    const { lineas, subtotal0, subtotal5, subtotal15, totalIva, importeTotal } = calcularLineas(items);

    const creada = await req.prisma.facturas.create({
      data: {
        empresaId:                   empresa.id,
        claveAcceso:                 String(claveAcceso),
        numeroFactura:               numeroFactura,
        secuencial:                  numParseado.secuencial,
        establecimiento:             numParseado.estab,
        puntoEmision:                numParseado.ptoEmi,
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

// ─── GET /api/ext/v1/facturas ────────────────────────────────────────────────
// Lista las facturas registradas en AELA en un rango de fechas de emisión,
// para que el sistema externo concilie y reenvíe lo que falte.
// Query: desde=YYYY-MM-DD (requerido), hasta=YYYY-MM-DD (default: hoy)
router.get('/facturas', async (req, res) => {
  const desde = new Date(`${req.query.desde}T00:00:00-05:00`);
  const hasta = new Date(`${req.query.hasta || new Date().toISOString().slice(0, 10)}T23:59:59.999-05:00`);
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    return res.status(400).json({ success: false, error: 'desde (YYYY-MM-DD) es requerido; hasta es opcional' });
  }
  if (hasta - desde > 92 * 86400000) {
    return res.status(400).json({ success: false, error: 'El rango máximo es de 92 días' });
  }
  try {
    const facturas = await req.prisma.facturas.findMany({
      where: { fechaEmision: { gte: desde, lte: hasta } },
      select: {
        id: true, claveAcceso: true, numeroFactura: true, fechaEmision: true,
        importeTotal: true, anulada: true, origenRegistro: true,
      },
      orderBy: [{ fechaEmision: 'asc' }, { id: 'asc' }],
    });
    res.json({ success: true, total: facturas.length, data: facturas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/facturas/verificar ─────────────────────────────────────
// Body: { clavesAcceso: [string, ...] } (máx. 1000)
// Responde cuáles ya están registradas en AELA y cuáles faltan.
router.post('/facturas/verificar', async (req, res) => {
  const claves = Array.isArray(req.body?.clavesAcceso)
    ? [...new Set(req.body.clavesAcceso.map(c => String(c || '').trim()).filter(Boolean))]
    : null;
  if (!claves || claves.length === 0) {
    return res.status(400).json({ success: false, error: 'clavesAcceso (arreglo no vacío) es requerido' });
  }
  if (claves.length > 1000) {
    return res.status(400).json({ success: false, error: 'Máximo 1000 claves por llamada' });
  }
  try {
    const encontradas = await req.prisma.facturas.findMany({
      where: { claveAcceso: { in: claves } },
      select: { id: true, claveAcceso: true, numeroFactura: true, importeTotal: true, anulada: true },
    });
    const set = new Set(encontradas.map(f => f.claveAcceso));
    res.json({
      success: true,
      registradas: encontradas,
      faltantes: claves.filter(c => !set.has(c)),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/facturas/anular ────────────────────────────────────────
// Marca como anulada una factura que el emisor ANULÓ EN EL SRI (no una
// corrección con nota de crédito: para eso, POST /notas-credito) y reversa su
// asiento. Si tiene cobros vigentes, primero hay que anularlos (POST /pagos/anular).
// Body: { facturaId | claveAcceso | numeroFactura, motivo }
router.post('/facturas/anular', async (req, res) => {
  const { facturaId, claveAcceso, numeroFactura, motivo } = req.body || {};
  if (!facturaId && !claveAcceso && !numeroFactura) {
    return res.status(400).json({ success: false, error: 'Indique facturaId, claveAcceso o numeroFactura' });
  }
  if (!motivo || !String(motivo).trim()) {
    return res.status(400).json({ success: false, error: 'motivo es requerido' });
  }
  try {
    const empresa = await req.prisma.empresas.findFirst();
    const factura = await buscarFactura(req.prisma, empresa.id, { facturaId, claveAcceso, numeroFactura });
    if (!factura) return res.status(404).json({ success: false, error: 'Factura no encontrada' });
    if (factura.anulada) {
      return res.status(200).json({ success: true, data: { id: factura.id, numeroFactura: factura.numeroFactura, anulada: true }, mensaje: 'Ya estaba anulada' });
    }

    const cobros = await req.prisma.cobros_cliente.findMany({
      where: { empresaId: empresa.id, facturaId: factura.id, anulado: false },
      select: { id: true, numero: true, monto: true, idExterno: true },
    });
    if (cobros.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'La factura tiene cobros vigentes; anúlelos primero con POST /pagos/anular',
        cobros,
      });
    }

    await req.prisma.facturas.update({
      where: { id: factura.id },
      data: { anulada: true, estadoSri: 'ANULADO', motivoAnulacion: String(motivo).slice(0, 500) },
    });

    let asientoOk = false;
    try {
      const r = await crearAsientoReversoFacturaAnulada({ facturaId: factura.id, usuarioId: null, fecha: new Date() });
      asientoOk = !!r.asiento;
    } catch (contErr) {
      console.error(`[ext] Reverso anulación factura ${factura.id}:`, contErr.message);
    }
    res.json({ success: true, data: { id: factura.id, numeroFactura: factura.numeroFactura, anulada: true, asientoOk } });
  } catch (err) {
    console.error('[ext] POST /facturas/anular:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/ext/v1/facturas/:id ────────────────────────────────────────────
// Estado, saldo y cobros de una factura. :id = id de AELA o clave de acceso.
router.get('/facturas/:id', async (req, res) => {
  try {
    const empresa = await req.prisma.empresas.findFirst();
    const param = String(req.params.id).trim();
    const factura = esClaveAcceso(param)
      ? await buscarFactura(req.prisma, empresa.id, { claveAcceso: param })
      : (/^\d+$/.test(param) ? await buscarFactura(req.prisma, empresa.id, { facturaId: param }) : null);
    if (!factura) return res.status(404).json({ success: false, error: 'Factura no encontrada' });

    const { saldo, totalCobrado, totalNotasCredito } = await calcularSaldo(req.prisma, factura);
    const cobros = await req.prisma.cobros_cliente.findMany({
      where: { empresaId: empresa.id, facturaId: factura.id },
      select: { id: true, numero: true, fecha: true, monto: true, metodoPago: true, referencia: true, idExterno: true, anulado: true },
      orderBy: { id: 'asc' },
    });
    res.json({
      success: true,
      data: {
        id: factura.id, claveAcceso: factura.claveAcceso, numeroFactura: factura.numeroFactura,
        fechaEmision: factura.fechaEmision, importeTotal: factura.importeTotal,
        estadoSri: factura.estadoSri, anulada: factura.anulada, origenRegistro: factura.origenRegistro,
        totalCobrado, totalNotasCredito, saldo, cobros,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/notas-credito ──────────────────────────────────────────
// Registra una nota de crédito YA autorizada por el SRI que modifica una
// factura registrada. Idempotente por claveAcceso. Reduce el saldo por cobrar
// y genera el asiento de reverso de ventas/IVA.
// Body: {
//   claveAcceso, numeroAutorizacion?, numeroNotaCredito ("001-001-000000094"),
//   fechaEmision, motivo,
//   facturaClaveAcceso | facturaId | numeroFacturaAfectada,   — factura modificada
//   items: [{ descripcion, cantidad, precioUnitario, descuento?, ivaPorcentaje? }]
// }
router.post('/notas-credito', async (req, res) => {
  const {
    claveAcceso, numeroAutorizacion, numeroNotaCredito, fechaEmision, motivo,
    facturaClaveAcceso, facturaId, numeroFacturaAfectada, items,
  } = req.body || {};

  if (!claveAcceso || !numeroNotaCredito || !fechaEmision) {
    return res.status(400).json({ success: false, error: 'claveAcceso, numeroNotaCredito y fechaEmision son requeridos' });
  }
  if (!motivo || !String(motivo).trim()) {
    return res.status(400).json({ success: false, error: 'motivo es requerido' });
  }
  if (!facturaClaveAcceso && !facturaId && !numeroFacturaAfectada) {
    return res.status(400).json({ success: false, error: 'Indique la factura modificada: facturaClaveAcceso, facturaId o numeroFacturaAfectada' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: 'items es requerido y no puede estar vacío' });
  }
  const num = parsearNumeroFactura(numeroNotaCredito);
  if (!num) return res.status(400).json({ success: false, error: 'numeroNotaCredito debe tener formato "001-001-000000094"' });
  const fecha = new Date(fechaEmision);
  if (isNaN(fecha.getTime())) return res.status(400).json({ success: false, error: 'fechaEmision inválida' });

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada en este tenant' });

    const existente = await req.prisma.notas_credito.findUnique({
      where: { claveAcceso: String(claveAcceso) },
      select: { id: true, numeroNC: true, importeTotal: true, facturaId: true, estadoSri: true },
    });
    if (existente) {
      return res.status(200).json({ success: true, data: existente, mensaje: 'Ya existía, se devuelve la nota de crédito registrada' });
    }

    const factura = await buscarFactura(req.prisma, empresa.id, {
      facturaId, claveAcceso: facturaClaveAcceso, numeroFactura: numeroFacturaAfectada,
    });
    if (!factura) {
      return res.status(404).json({ success: false, error: 'Factura modificada no encontrada en AELA (envíela primero con POST /facturas)' });
    }
    if (factura.anulada) return res.status(400).json({ success: false, error: 'La factura modificada está anulada' });

    const { lineas, subtotal0, subtotal5, subtotal15, totalIva, importeTotal } = calcularLineas(items);
    const { totalNotasCredito } = await calcularSaldo(req.prisma, factura);
    const disponible = round2(Number(factura.importeTotal) - totalNotasCredito);
    if (importeTotal > disponible + 0.01) {
      return res.status(400).json({
        success: false,
        error: `La nota de crédito ($${importeTotal.toFixed(2)}) excede lo no acreditado de la factura ($${disponible.toFixed(2)})`,
      });
    }

    const nc = await req.prisma.notas_credito.create({
      data: {
        empresaId:                   empresa.id,
        claveAcceso:                 String(claveAcceso),
        numeroNC:                    `${num.estab}-${num.ptoEmi}-${num.secuencial}`,
        secuencial:                  num.secuencial,
        establecimiento:             num.estab,
        puntoEmision:                num.ptoEmi,
        facturaId:                   factura.id,
        numeroFacturaAfectada:       factura.numeroFactura,
        claveAccesoFacturaAfectada:  factura.claveAcceso || null,
        tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
        identificacionComprador:     factura.identificacionComprador,
        razonSocialComprador:        factura.razonSocialComprador,
        motivoModificacion:          String(motivo).slice(0, 300),
        fechaEmision:                fecha,
        fechaEmisionDocSustento:     factura.fechaEmision,
        totalSinImpuestos:           round2(subtotal0 + subtotal5 + subtotal15),
        totalIva,
        importeTotal,
        detalles:                    lineas,
        estadoSri:                   'AUTORIZADO',
        numeroAutorizacion:          numeroAutorizacion || String(claveAcceso),
        fechaAutorizacion:           fecha,
      },
      select: { id: true, numeroNC: true, importeTotal: true, facturaId: true, estadoSri: true },
    });

    let asientoOk = false;
    try {
      const r = await crearAsientoNotaCreditoEmitida({ notaCreditoId: nc.id, usuarioId: null, fecha });
      asientoOk = !!r.asiento;
    } catch (contErr) {
      console.error(`[ext] Asiento NC ${nc.id}:`, contErr.message);
    }
    res.status(201).json({ success: true, data: { ...nc, asientoOk } });
  } catch (err) {
    console.error('[ext] POST /notas-credito:', err.message);
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, error: 'Ya existe una nota de crédito con esa clave de acceso' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/ext/v1/bancos ──────────────────────────────────────────────────
// Cuentas bancarias activas — el `id` es el bancoId opcional de POST /pagos.
router.get('/bancos', async (req, res) => {
  try {
    const bancos = await req.prisma.bancos.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, banco: true, tipoCuenta: true, numeroCuenta: true },
      orderBy: { id: 'asc' },
    });
    const porDefecto = parseInt(req.tenant?.brandConfig?.extBancoId, 10);
    res.json({ success: true, bancoPorDefecto: isNaN(porDefecto) ? null : porDefecto, data: bancos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/pagos ──────────────────────────────────────────────────
// Registrar un cobro sobre una factura ya registrada (mismo subledger que usa
// Cuentas por Cobrar — cobros_cliente — no una tabla aparte).
// Body: {
//   facturaId | claveAcceso | numeroFactura,   — uno de los tres (requerido)
//   monto, metodoPago, referencia?, fecha?,
//   idPagoExterno?,  — id del pago en el sistema externo: con él la llamada es
//                      idempotente (reintentar no duplica el cobro)
//   bancoId?,        — destino de transferencia/tarjeta/cheque (GET /bancos)
// }
// metodoPago: 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta'
router.post('/pagos', async (req, res) => {
  const { facturaId, claveAcceso, numeroFactura, monto, metodoPago, referencia, fecha, idPagoExterno, bancoId } = req.body || {};
  const montoNum = round2(monto);
  if (!facturaId && !claveAcceso && !numeroFactura) {
    return res.status(400).json({ success: false, error: 'Indique la factura: facturaId, claveAcceso o numeroFactura' });
  }
  if (!(montoNum > 0)) {
    return res.status(400).json({ success: false, error: 'monto (> 0) es requerido' });
  }
  const metodo = String(metodoPago || '').trim().toLowerCase();
  if (!METODOS_VALIDOS.includes(metodo)) {
    return res.status(400).json({ success: false, error: `metodoPago debe ser uno de: ${METODOS_VALIDOS.join(', ')}` });
  }
  const fechaCobro = fecha ? new Date(fecha) : new Date();
  if (isNaN(fechaCobro.getTime())) {
    return res.status(400).json({ success: false, error: 'fecha inválida' });
  }
  const idExterno = idPagoExterno !== undefined && idPagoExterno !== null && String(idPagoExterno).trim()
    ? String(idPagoExterno).trim().slice(0, 100) : null;

  try {
    const empresa = await req.prisma.empresas.findFirst();
    if (!empresa) return res.status(400).json({ success: false, error: 'No hay empresa configurada en este tenant' });

    if (idExterno) {
      const previo = await req.prisma.cobros_cliente.findFirst({
        where: { empresaId: empresa.id, idExterno },
        select: { id: true, numero: true, monto: true, facturaId: true, anulado: true },
      });
      if (previo) {
        return res.status(200).json({ success: true, data: previo, mensaje: 'Ya existía, se devuelve el cobro registrado' });
      }
    }

    const bancoDestino = metodo === 'efectivo' ? null : await resolverBanco(req.prisma, empresa.id, req.tenant, bancoId);

    const cobro = await req.prisma.$transaction(async (tx) => {
      const factura = await buscarFactura(tx, empresa.id, { facturaId, claveAcceso, numeroFactura });
      if (!factura) throw Object.assign(new Error('Factura no encontrada (envíela primero con POST /facturas)'), { status: 404 });
      if (factura.anulada) throw Object.assign(new Error('La factura está anulada'), { status: 400 });

      await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${factura.id} FOR UPDATE`;

      const { saldo } = await calcularSaldo(tx, factura);
      if (montoNum > saldo + 0.01) {
        throw Object.assign(new Error(`El monto excede el saldo pendiente ($${saldo.toFixed(2)})`), { status: 400 });
      }

      const numero = await siguienteNumeroGenerico({ modelo: 'cobros_cliente', prefijo: 'REC', empresaId: empresa.id, fecha: fechaCobro, tx });
      const nuevo = await tx.cobros_cliente.create({
        data: {
          empresaId: empresa.id, facturaId: factura.id, clienteId: factura.clienteId || null,
          numero, fecha: fechaCobro, monto: montoNum, metodoPago: metodo,
          bancoId: bancoDestino,
          referencia: referencia ? String(referencia).slice(0, 100) : null,
          idExterno,
        },
      });
      await crearAsientoCobroCliente({ cobroId: nuevo.id, usuarioId: null, fecha: fechaCobro, db: tx });
      return nuevo;
    });

    res.status(201).json({ success: true, data: { id: cobro.id, numero: cobro.numero, monto: cobro.monto, facturaId: cobro.facturaId, bancoId: cobro.bancoId } });
  } catch (err) {
    console.error('[ext] POST /pagos:', err.message);
    if (err.code === 'P2002' && idExterno) {
      return res.status(409).json({ success: false, error: 'Ya existe un cobro con ese idPagoExterno (reintente: devolverá el existente)' });
    }
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/ext/v1/pagos/anular ───────────────────────────────────────────
// Body: { id | idPagoExterno, motivo? } — reversa el asiento y el movimiento bancario.
router.post('/pagos/anular', async (req, res) => {
  const { id, idPagoExterno, motivo } = req.body || {};
  if (!id && !idPagoExterno) {
    return res.status(400).json({ success: false, error: 'Indique id (de AELA) o idPagoExterno' });
  }
  try {
    const empresa = await req.prisma.empresas.findFirst();
    const where = id
      ? { id: parseInt(id, 10) || -1, empresaId: empresa.id }
      : { idExterno: String(idPagoExterno).trim(), empresaId: empresa.id };
    const cobro = await req.prisma.cobros_cliente.findFirst({ where });
    if (!cobro) return res.status(404).json({ success: false, error: 'Cobro no encontrado' });
    if (cobro.anulado) {
      return res.status(200).json({ success: true, data: { id: cobro.id, numero: cobro.numero, anulado: true }, mensaje: 'Ya estaba anulado' });
    }
    await req.prisma.$transaction(async (tx) => {
      await crearAsientoReversoCobroCliente({ cobroId: cobro.id, usuarioId: null, db: tx });
      await tx.cobros_cliente.update({
        where: { id: cobro.id },
        data: { anulado: true, motivoAnulacion: motivo ? String(motivo).slice(0, 500) : null, fechaAnulacion: new Date() },
      });
    });
    res.json({ success: true, data: { id: cobro.id, numero: cobro.numero, anulado: true } });
  } catch (err) {
    console.error('[ext] POST /pagos/anular:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/ext/v1/log ─────────────────────────────────────────────────────
// Últimas llamadas registradas (no-GET). Query: limite (≤500, default 100),
// soloErrores=1, referencia=<clave/idPago> para buscar un comprobante.
router.get('/log', async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 100, 1), 500);
  const soloErrores = req.query.soloErrores === '1' || req.query.soloErrores === 'true';
  const referencia = req.query.referencia ? String(req.query.referencia).trim() : null;
  try {
    const filas = await req.prisma.$queryRaw`
      SELECT "id", "createdAt", "metodo", "ruta", "status", "referencia", "error", "duracionMs"
      FROM ext_api_log
      WHERE (${soloErrores} = false OR "status" >= 400)
        AND (${referencia}::text IS NULL OR "referencia" = ${referencia})
      ORDER BY "id" DESC
      LIMIT ${limite}
    `;
    res.json({ success: true, data: filas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
