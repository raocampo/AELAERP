const router = require('express').Router();
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const prisma = require('../config/prisma');
const {
  enviarComprobanteBancarioPdf, CATEGORIA_POR_TIPO_COMPROBANTE, fmtMoney,
} = require('../utils/comprobanteBancarioPdf');
const { crearAsientoContable, crearAsientoReversoComprobanteBancario } = require('../utils/contabilidad');

router.use(proteger);
router.use(soloMediumOPro);

const TIPOS_VALIDOS = ['INGRESO', 'PAGO', 'CREDITO', 'DEBITO'];
const PREFIJOS = { INGRESO: 'ING', PAGO: 'PAG', CREDITO: 'CRE', DEBITO: 'DEB' };
const TIPO_MOV  = { INGRESO: 'DEPOSITO', PAGO: 'RETIRO', CREDITO: 'NOTA_CREDITO', DEBITO: 'NOTA_DEBITO' };

async function generarNumero(tipo, empresaId, fecha) {
  const d = new Date(fecha);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const prefix = PREFIJOS[tipo] || 'CPB';
  const inicio = new Date(yyyy, d.getMonth(), 1);
  const fin    = new Date(yyyy, d.getMonth() + 1, 0, 23, 59, 59);
  const result = await prisma.$queryRaw`
    SELECT COUNT(*) AS cnt FROM "comprobantes_bancarios"
    WHERE "empresaId" = ${empresaId} AND tipo = ${tipo}
      AND fecha >= ${inicio} AND fecha <= ${fin}
  `;
  const seq = String(Number(result[0]?.cnt || 0) + 1).padStart(4, '0');
  return `${prefix}-${yyyy}${mm}-${seq}`;
}

// ── GET / ─────────────────────────────────────────────────────────
router.get('/', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { tipo, estado, desde, hasta, q } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  || '50',  10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    // Construir condiciones dinámicas vía Prisma raw template (seguro — no interpolamos strings del usuario directamente)
    let rows, conteo;

    // Nota: Para filtros dinámicos usamos un workaround con condicionales en la query
    rows = await prisma.$queryRaw`
      SELECT
        cb.id, cb.numero, cb.tipo, cb.subtipo, cb.fecha, cb.notas, cb.estado,
        cb.total, cb."empresaId", cb."cuentaBancariaId", cb."proveedorId", cb."movimientoId", cb."asientoId",
        p."razonSocial" AS prov_nombre, p.identificacion AS prov_ruc
      FROM "comprobantes_bancarios" cb
      LEFT JOIN "proveedores" p ON p.id = cb."proveedorId" AND p."empresaId" = ${empresaId}
      WHERE cb."empresaId" = ${empresaId}
        AND (${tipo   ?? null}::text IS NULL OR cb.tipo   = ${tipo   ?? ''})
        AND (${estado ?? null}::text IS NULL OR cb.estado = ${estado ?? ''})
        AND (${desde  ?? null}::text IS NULL OR cb.fecha >= ${desde  ? new Date(desde)  : new Date(0)})
        AND (${hasta  ?? null}::text IS NULL OR cb.fecha <= ${hasta  ? new Date(new Date(hasta).setHours(23,59,59)) : new Date()})
        AND (${q      ?? null}::text IS NULL OR cb.numero ILIKE ${'%' + (q ?? '') + '%'} OR cb.notas ILIKE ${'%' + (q ?? '') + '%'})
      ORDER BY cb.fecha DESC, cb.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    conteo = await prisma.$queryRaw`
      SELECT COUNT(*) AS total FROM "comprobantes_bancarios"
      WHERE "empresaId" = ${empresaId}
        AND (${tipo   ?? null}::text IS NULL OR tipo   = ${tipo   ?? ''})
        AND (${estado ?? null}::text IS NULL OR estado = ${estado ?? ''})
        AND (${desde  ?? null}::text IS NULL OR fecha >= ${desde  ? new Date(desde)  : new Date(0)})
        AND (${hasta  ?? null}::text IS NULL OR fecha <= ${hasta  ? new Date(new Date(hasta).setHours(23,59,59)) : new Date()})
    `;

    const total = Number(conteo[0]?.total || 0);
    const datos = rows.map((r) => ({
      id: Number(r.id), numero: r.numero, tipo: r.tipo, subtipo: r.subtipo,
      fecha: r.fecha, notas: r.notas, estado: r.estado,
      total: parseFloat(r.total || 0),
      cuentaBancariaId: r.cuentaBancariaId ? Number(r.cuentaBancariaId) : null,
      proveedor: r.prov_nombre ? { razonSocial: r.prov_nombre, identificacion: r.prov_ruc } : null,
      movimientoId: r.movimientoId ? Number(r.movimientoId) : null,
      asientoId: r.asientoId ? Number(r.asientoId) : null,
    }));

    res.json({ success: true, data: { items: datos, total, limit, offset } });
  } catch (error) {
    console.error('GET /comprobantes-bancarios:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener comprobantes' });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────
router.get('/:id', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const rows = await prisma.$queryRaw`
      SELECT cb.*, p."razonSocial" AS prov_nombre, p.identificacion AS prov_ruc
      FROM "comprobantes_bancarios" cb
      LEFT JOIN "proveedores" p ON p.id = cb."proveedorId"
      WHERE cb.id = ${id} AND cb."empresaId" = ${empresaId}
    `;
    if (!rows.length) return res.status(404).json({ success: false, mensaje: 'Comprobante no encontrado' });

    const cuentas = await prisma.$queryRaw`
      SELECT cbc.*, pc.codigo, pc.nombre AS cuenta_nombre
      FROM "comprobantes_bancarios_cuentas" cbc
      LEFT JOIN "plan_cuentas" pc ON pc.id = cbc."cuentaContableId"
      WHERE cbc."comprobanteId" = ${id}
      ORDER BY cbc.id
    `;
    const pagos = await prisma.$queryRaw`
      SELECT cbp.*, pc.codigo, pc.nombre AS cuenta_nombre
      FROM "comprobantes_bancarios_pagos" cbp
      LEFT JOIN "plan_cuentas" pc ON pc.id = cbp."cuentaContableId"
      WHERE cbp."comprobanteId" = ${id}
      ORDER BY cbp.id
    `;

    const r = rows[0];
    res.json({
      success: true,
      data: {
        id: Number(r.id), numero: r.numero, tipo: r.tipo, subtipo: r.subtipo,
        fecha: r.fecha, notas: r.notas, estado: r.estado, total: parseFloat(r.total || 0),
        cuentaBancariaId: r.cuentaBancariaId ? Number(r.cuentaBancariaId) : null,
        proveedorId: r.proveedorId ? Number(r.proveedorId) : null,
        proveedor: r.prov_nombre ? { razonSocial: r.prov_nombre, identificacion: r.prov_ruc } : null,
        movimientoId: r.movimientoId ? Number(r.movimientoId) : null,
        asientoId: r.asientoId ? Number(r.asientoId) : null,
        historialEdiciones: r.historialEdiciones || [],
        cuentas: cuentas.map((c) => ({
          id: Number(c.id), notas: c.notas, valor: parseFloat(c.valor || 0),
          cuentaContableId: c.cuentaContableId ? Number(c.cuentaContableId) : null,
          codigo: c.codigo, cuentaNombre: c.cuenta_nombre,
        })),
        pagos: pagos.map((p) => ({
          id: Number(p.id), tipoPago: p.tipoPago, valor: parseFloat(p.valor || 0),
          cuentaContableId: p.cuentaContableId ? Number(p.cuentaContableId) : null,
          codigo: p.codigo, cuentaNombre: p.cuenta_nombre, notas: p.notas, referencia: p.referencia || null,
        })),
      },
    });
  } catch (error) {
    console.error('GET /comprobantes-bancarios/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener comprobante' });
  }
});

// ── GET /:id/pdf ──────────────────────────────────────────────────
// Comprobante imprimible (mismo diseño que el Recibo de Cobro de CxC).
router.get('/:id/pdf', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const rows = await prisma.$queryRaw`
      SELECT * FROM "comprobantes_bancarios" WHERE id = ${id} AND "empresaId" = ${empresaId}
    `;
    if (!rows.length) return res.status(404).json({ success: false, mensaje: 'Comprobante no encontrado' });
    const cb = rows[0];

    const [cuentas, pagos, banco, proveedor, configSri, asiento] = await Promise.all([
      prisma.$queryRaw`
        SELECT cbc.notas, cbc.valor, pc.codigo, pc.nombre AS cuenta_nombre
        FROM "comprobantes_bancarios_cuentas" cbc
        LEFT JOIN "plan_cuentas" pc ON pc.id = cbc."cuentaContableId"
        WHERE cbc."comprobanteId" = ${id} ORDER BY cbc.id`,
      prisma.$queryRaw`
        SELECT cbp."tipoPago", cbp.valor, cbp.notas, cbp.referencia, pc.codigo, pc.nombre AS cuenta_nombre
        FROM "comprobantes_bancarios_pagos" cbp
        LEFT JOIN "plan_cuentas" pc ON pc.id = cbp."cuentaContableId"
        WHERE cbp."comprobanteId" = ${id} ORDER BY cbp.id`,
      cb.cuentaBancariaId
        ? prisma.bancos.findFirst({ where: { id: Number(cb.cuentaBancariaId), empresaId }, select: { banco: true, tipoCuenta: true, numeroCuenta: true } })
        : null,
      cb.proveedorId
        ? prisma.proveedores.findFirst({ where: { id: Number(cb.proveedorId), empresaId }, select: { razonSocial: true, identificacion: true } })
        : null,
      prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } }),
      cb.asientoId
        ? prisma.asientos_contables.findFirst({
          where: { id: Number(cb.asientoId), empresaId },
          select: { numero: true, detalles: { select: { debe: true, haber: true, cuenta: { select: { codigo: true, nombre: true } } } } },
        })
        : null,
    ]);

    const categoria = CATEGORIA_POR_TIPO_COMPROBANTE[cb.tipo] || 'AJUSTE';
    const esIngreso = categoria === 'INGRESO' || categoria === 'CREDITO';
    const filas = [
      [esIngreso ? 'Recibido de:' : 'Pagado a:', proveedor
        ? `${proveedor.razonSocial}${proveedor.identificacion ? ` (${proveedor.identificacion})` : ''}` : null, true],
      ['Cuenta bancaria:', banco ? `${banco.banco} — ${banco.tipoCuenta} ${banco.numeroCuenta}` : null],
      ['Subtipo:', cb.subtipo && cb.subtipo !== 'GENERAL' ? String(cb.subtipo).replace(/_/g, ' ') : null],
      ['Concepto:', cb.notas],
      ['Asiento contable:', asiento?.numero],
    ];
    const etiquetaPago = { EFECTIVO: 'Efectivo', CHEQUE: 'Cheque', TRANSFERENCIA: 'Transferencia', TARJETA: 'Tarjeta' };
    const tablas = [
      {
        titulo: 'Detalle',
        columnas: [{ titulo: 'Código', ancho: 80 }, { titulo: 'Cuenta / Nota' }, { titulo: 'Valor', ancho: 80, alinear: 'right' }],
        filas: cuentas.map((c) => [c.codigo || '', [c.cuenta_nombre, c.notas].filter(Boolean).join(' — '), fmtMoney(c.valor)]),
      },
      {
        titulo: 'Formas de pago',
        columnas: [{ titulo: 'Forma', ancho: 90 }, { titulo: 'Cuenta / Nota' }, { titulo: 'Valor', ancho: 80, alinear: 'right' }],
        filas: pagos.map((p) => [
          etiquetaPago[p.tipoPago] || p.tipoPago,
          [p.codigo ? `${p.codigo} ${p.cuenta_nombre || ''}`.trim() : '', p.referencia ? `Ref. ${p.referencia}` : null, p.notas]
            .filter(Boolean).join(' — '),
          fmtMoney(p.valor),
        ]),
      },
    ];

    await enviarComprobanteBancarioPdf(res, {
      categoria, numero: cb.numero, fecha: cb.fecha, anulado: cb.estado === 'ANULADO',
      monto: Number(cb.total || 0), filas, tablas,
    }, configSri, `Comprobante-${cb.numero}`);
  } catch (error) {
    console.error('GET /comprobantes-bancarios/:id/pdf:', error);
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'No se pudo generar el comprobante' });
  }
});

// Construye y crea el asiento contable de un comprobante (banco vs. cada
// línea de "Cuentas") — usado tanto al crear (POST /) como al corregir
// (PUT /:id), para no duplicar la lógica de débito/crédito. Requiere la
// cuenta bancaria vinculada a una cuenta del Plan de Cuentas Y que cada
// línea de "Cuentas" tenga su propia cuenta contable; si falta algo,
// no se crea el asiento (el caller decide qué hacer con la advertencia).
async function construirYCrearAsiento({ tx, empresaId, usuarioId, fecha, tipo, numero, concep, cuentaBancariaId, cuentas }) {
  const total = cuentas.reduce((s, c) => s + Number(c.valor || 0), 0);
  const esIngreso = ['INGRESO', 'CREDITO'].includes(tipo);
  if (!(total > 0)) return { asientoId: null, advertenciaContable: null };

  const banco = cuentaBancariaId ? await tx.bancos.findFirst({ where: { id: cuentaBancariaId, empresaId } }) : null;
  const cuentasCompletas = cuentas.length > 0 && cuentas.every((c) => c.cuentaContableId);

  if (!cuentaBancariaId) {
    return { asientoId: null, advertenciaContable: 'No se generó el asiento contable: el comprobante no tiene cuenta bancaria asignada.' };
  }
  if (!banco?.cuentaContableId) {
    return { asientoId: null, advertenciaContable: 'No se generó el asiento contable: la cuenta bancaria no tiene una cuenta contable vinculada (Bancos → editar cuenta).' };
  }
  if (!cuentasCompletas) {
    return { asientoId: null, advertenciaContable: 'No se generó el asiento contable: falta la cuenta contable en una o más líneas de "Cuentas".' };
  }

  const detallesAsiento = cuentas.map((c) => ({
    cuentaId: Number(c.cuentaContableId),
    descripcion: c.notas || concep,
    debe: esIngreso ? 0 : Number(c.valor || 0),
    haber: esIngreso ? Number(c.valor || 0) : 0,
  }));
  detallesAsiento.push({
    cuentaId: banco.cuentaContableId,
    descripcion: concep,
    debe: esIngreso ? total : 0,
    haber: esIngreso ? 0 : total,
  });

  const asientoCreado = await crearAsientoContable({
    empresaId,
    fecha,
    descripcion: `Comprobante ${tipo} ${numero}: ${concep}`,
    tipo: 'COMPROBANTE_BANCO',
    referencia: `COMPROBANTE-${numero}`,
    usuarioId,
    tx,
    detalles: detallesAsiento,
  });

  return { asientoId: asientoCreado.id, advertenciaContable: null };
}

// ── POST / ────────────────────────────────────────────────────────
router.post('/', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const { tipo, subtipo = 'GENERAL', fecha, notas, cuentaBancariaId, proveedorId, cuentas = [], pagos = [] } = req.body;

    if (!TIPOS_VALIDOS.includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: `Tipo inválido: ${tipo}` });
    }
    if (!fecha) return res.status(400).json({ success: false, mensaje: 'La fecha es requerida' });

    const total     = cuentas.reduce((s, c) => s + Number(c.valor || 0), 0);
    const numero    = await generarNumero(tipo, empresaId, fecha);
    const fechaDate = new Date(fecha);
    const cbId      = cuentaBancariaId ? parseInt(cuentaBancariaId, 10) : null;
    const provId    = proveedorId      ? parseInt(proveedorId, 10)      : null;
    const esIngreso = ['INGRESO', 'CREDITO'].includes(tipo);
    const concep    = notas || `${tipo} ${numero}`;

    let advertenciaContable = null;

    const { comprobanteId, asientoCreado } = await prisma.$transaction(async (tx) => {
      const result = await tx.$queryRaw`
        INSERT INTO "comprobantes_bancarios"
          (numero, tipo, subtipo, fecha, notas, estado, total, "empresaId", "cuentaBancariaId", "proveedorId", "creadoPorId", "createdAt", "updatedAt")
        VALUES (
          ${numero}, ${tipo}, ${subtipo}, ${fechaDate}, ${notas || null},
          'ARCHIVADO', ${total}, ${empresaId}, ${cbId}, ${provId}, ${usuarioId}, NOW(), NOW()
        )
        RETURNING id
      `;
      const compId = Number(result[0].id);

      for (const c of cuentas) {
        const ccId = c.cuentaContableId ? Number(c.cuentaContableId) : null;
        await tx.$queryRaw`
          INSERT INTO "comprobantes_bancarios_cuentas" ("comprobanteId", notas, valor, "cuentaContableId")
          VALUES (${compId}, ${c.notas || null}, ${Number(c.valor || 0)}, ${ccId})
        `;
      }

      for (const p of pagos) {
        const pcId = p.cuentaContableId ? Number(p.cuentaContableId) : null;
        await tx.$queryRaw`
          INSERT INTO "comprobantes_bancarios_pagos" ("comprobanteId", "tipoPago", valor, "cuentaContableId", notas, referencia)
          VALUES (${compId}, ${p.tipoPago || 'EFECTIVO'}, ${Number(p.valor || 0)}, ${pcId}, ${p.notas || null}, ${p.referencia || null})
        `;
      }

      // Crear movimiento bancario si hay cuenta bancaria
      let movId = null;
      if (cbId) {
        const tipoMov = TIPO_MOV[tipo];
        const debe    = esIngreso ? total : 0;
        const haber   = !esIngreso ? total : 0;

        const movRows = await tx.$queryRaw`
          INSERT INTO "movimientos_bancarios"
            ("bancoId", "empresaId", fecha, tipo, concepto, referencia, debe, haber, "createdAt", "updatedAt")
          VALUES (${cbId}, ${empresaId}, ${fechaDate}, ${tipoMov}, ${concep}, ${numero}, ${debe}, ${haber}, NOW(), NOW())
          RETURNING id
        `;
        movId = Number(movRows[0].id);
        await tx.$queryRaw`
          UPDATE "comprobantes_bancarios" SET "movimientoId" = ${movId}, "updatedAt" = NOW() WHERE id = ${compId}
        `;
      }

      // Asiento contable automático — ver construirYCrearAsiento(). Si falta
      // alguna cuenta contable, el comprobante se crea igual pero sin
      // contabilizar, avisando al usuario para que complete la configuración.
      const { asientoId, advertenciaContable: advertencia } = await construirYCrearAsiento({
        tx, empresaId, usuarioId, fecha: fechaDate, tipo, numero, concep, cuentaBancariaId: cbId, cuentas,
      });
      advertenciaContable = advertencia;

      if (asientoId) {
        await tx.$queryRaw`UPDATE "comprobantes_bancarios" SET "asientoId" = ${asientoId}, "updatedAt" = NOW() WHERE id = ${compId}`;
        if (movId) await tx.movimientos_bancarios.update({ where: { id: movId }, data: { asientoId } });
      }

      return { comprobanteId: compId, asientoCreado: Boolean(asientoId) };
    });

    res.status(201).json({
      success: true,
      mensaje: asientoCreado ? 'Comprobante creado y contabilizado' : 'Comprobante creado',
      advertenciaContable,
      data: { id: comprobanteId, numero },
    });
  } catch (error) {
    console.error('POST /comprobantes-bancarios:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'Error al crear comprobante' });
  }
});

// ── POST /:id/anular ──────────────────────────────────────────────
router.post('/:id/anular', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const id = parseInt(req.params.id, 10);

    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT * FROM "comprobantes_bancarios" WHERE id = ${id} AND "empresaId" = ${empresaId}
      `;
      if (!rows.length) throw Object.assign(new Error('Comprobante no encontrado'), { status: 404 });
      if (rows[0].estado === 'ANULADO') throw Object.assign(new Error('Ya está anulado'), { status: 400 });

      await tx.$queryRaw`
        UPDATE "comprobantes_bancarios" SET estado = 'ANULADO', "updatedAt" = NOW() WHERE id = ${id}
      `;

      const movId = rows[0].movimientoId ? Number(rows[0].movimientoId) : null;
      if (movId) {
        await tx.$queryRaw`
          UPDATE "movimientos_bancarios"
          SET concepto = CONCAT('[ANULADO] ', concepto), "updatedAt" = NOW()
          WHERE id = ${movId}
        `;
      }

      // El asiento contable original nunca se toca — se reversa con uno
      // nuevo (mismo patrón que anular una factura/nota de venta), para
      // que el rastro de auditoría quede completo en el Diario.
      if (rows[0].asientoId) {
        await crearAsientoReversoComprobanteBancario({
          asientoId: Number(rows[0].asientoId),
          motivo: `Anulación del comprobante ${rows[0].numero}`,
          usuarioId,
          db: tx,
        });
      }
    });

    res.json({ success: true, mensaje: 'Comprobante anulado' });
  } catch (error) {
    console.error('POST /comprobantes-bancarios/:id/anular:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'Error al anular comprobante' });
  }
});

// ── PUT /:id — corregir un comprobante ya guardado ────────────────
// Nunca edita el asiento contable existente: si el comprobante ya tenía
// uno, se reversa (crearAsientoReversoComprobanteBancario) y se crea uno
// nuevo con los datos corregidos — mismo principio que anular. El motivo
// de la corrección es obligatorio y queda en "historialEdiciones" para
// que quede visible por qué se cambió (ver ModalDetalleComprobante).
router.put('/:id', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const id = parseInt(req.params.id, 10);
    const {
      fecha, notas, cuentaBancariaId, proveedorId, cuentas = [], pagos = [], motivoEdicion,
    } = req.body;

    if (!motivoEdicion || !motivoEdicion.trim()) {
      return res.status(400).json({ success: false, mensaje: 'Debes indicar el motivo de la corrección' });
    }
    if (!fecha) return res.status(400).json({ success: false, mensaje: 'La fecha es requerida' });

    const cbId  = cuentaBancariaId ? parseInt(cuentaBancariaId, 10) : null;
    const provId = proveedorId ? parseInt(proveedorId, 10) : null;
    const fechaDate = new Date(fecha);
    const total = cuentas.reduce((s, c) => s + Number(c.valor || 0), 0);

    let advertenciaContable = null;

    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw`
        SELECT * FROM "comprobantes_bancarios" WHERE id = ${id} AND "empresaId" = ${empresaId}
      `;
      if (!rows.length) throw Object.assign(new Error('Comprobante no encontrado'), { status: 404 });
      const actual = rows[0];
      if (actual.estado === 'ANULADO') {
        throw Object.assign(new Error('No se puede editar un comprobante anulado'), { status: 400 });
      }

      const concep = notas || `${actual.tipo} ${actual.numero}`;

      // 1. Reversar el asiento anterior si existía — nunca se edita in situ.
      if (actual.asientoId) {
        await crearAsientoReversoComprobanteBancario({
          asientoId: Number(actual.asientoId),
          motivo: motivoEdicion.trim(),
          usuarioId,
          db: tx,
        });
      }

      // 2. Reemplazar las líneas de "Cuentas" y "Detalle de pagos".
      await tx.$queryRaw`DELETE FROM "comprobantes_bancarios_cuentas" WHERE "comprobanteId" = ${id}`;
      await tx.$queryRaw`DELETE FROM "comprobantes_bancarios_pagos" WHERE "comprobanteId" = ${id}`;
      for (const c of cuentas) {
        const ccId = c.cuentaContableId ? Number(c.cuentaContableId) : null;
        await tx.$queryRaw`
          INSERT INTO "comprobantes_bancarios_cuentas" ("comprobanteId", notas, valor, "cuentaContableId")
          VALUES (${id}, ${c.notas || null}, ${Number(c.valor || 0)}, ${ccId})
        `;
      }
      for (const p of pagos) {
        const pcId = p.cuentaContableId ? Number(p.cuentaContableId) : null;
        await tx.$queryRaw`
          INSERT INTO "comprobantes_bancarios_pagos" ("comprobanteId", "tipoPago", valor, "cuentaContableId", notas, referencia)
          VALUES (${id}, ${p.tipoPago || 'EFECTIVO'}, ${Number(p.valor || 0)}, ${pcId}, ${p.notas || null}, ${p.referencia || null})
        `;
      }

      // 3. Actualizar el comprobante y su historial de ediciones.
      await tx.$queryRaw`
        UPDATE "comprobantes_bancarios"
        SET fecha = ${fechaDate}, notas = ${notas || null}, "cuentaBancariaId" = ${cbId},
            "proveedorId" = ${provId}, total = ${total}, "asientoId" = NULL, "updatedAt" = NOW(),
            "historialEdiciones" = COALESCE("historialEdiciones", '[]'::jsonb) ||
              jsonb_build_array(jsonb_build_object(
                'fecha', NOW(), 'usuarioId', ${usuarioId}, 'motivo', ${motivoEdicion.trim()}
              ))
        WHERE id = ${id}
      `;

      // 4. El renglón del Libro de Bancos se corrige directo (no es un
      // asiento contable, solo el registro del movimiento).
      if (actual.movimientoId) {
        const tipoMov = TIPO_MOV[actual.tipo];
        const esIngreso = ['INGRESO', 'CREDITO'].includes(actual.tipo);
        await tx.$queryRaw`
          UPDATE "movimientos_bancarios"
          SET fecha = ${fechaDate}, concepto = ${concep}, tipo = ${tipoMov},
              debe = ${esIngreso ? total : 0}, haber = ${esIngreso ? 0 : total},
              "asientoId" = NULL, "updatedAt" = NOW()
          WHERE id = ${Number(actual.movimientoId)}
        `;
      }

      // 5. Crear el asiento nuevo con los datos ya corregidos.
      const { asientoId, advertenciaContable: advertencia } = await construirYCrearAsiento({
        tx, empresaId, usuarioId, fecha: fechaDate, tipo: actual.tipo, numero: actual.numero, concep,
        cuentaBancariaId: cbId, cuentas,
      });
      advertenciaContable = advertencia;

      if (asientoId) {
        await tx.$queryRaw`UPDATE "comprobantes_bancarios" SET "asientoId" = ${asientoId}, "updatedAt" = NOW() WHERE id = ${id}`;
        if (actual.movimientoId) {
          await tx.movimientos_bancarios.update({ where: { id: Number(actual.movimientoId) }, data: { asientoId } });
        }
      }
    });

    res.json({ success: true, mensaje: 'Comprobante corregido', advertenciaContable, data: { id } });
  } catch (error) {
    console.error('PUT /comprobantes-bancarios/:id:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'No se pudo corregir el comprobante' });
  }
});

module.exports = router;
