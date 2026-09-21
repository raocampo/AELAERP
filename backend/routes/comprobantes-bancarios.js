const router = require('express').Router();
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const prisma = require('../config/prisma');
const {
  enviarComprobanteBancarioPdf, CATEGORIA_POR_TIPO_COMPROBANTE, fmtMoney,
} = require('../utils/comprobanteBancarioPdf');
const { crearAsientoContable } = require('../utils/contabilidad');

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
        cuentas: cuentas.map((c) => ({
          id: Number(c.id), notas: c.notas, valor: parseFloat(c.valor || 0),
          cuentaContableId: c.cuentaContableId ? Number(c.cuentaContableId) : null,
          codigo: c.codigo, cuentaNombre: c.cuenta_nombre,
        })),
        pagos: pagos.map((p) => ({
          id: Number(p.id), tipoPago: p.tipoPago, valor: parseFloat(p.valor || 0),
          cuentaContableId: p.cuentaContableId ? Number(p.cuentaContableId) : null,
          codigo: p.codigo, cuentaNombre: p.cuenta_nombre, notas: p.notas,
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
        SELECT cbp."tipoPago", cbp.valor, cbp.notas, pc.codigo, pc.nombre AS cuenta_nombre
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
          [p.codigo ? `${p.codigo} ${p.cuenta_nombre || ''}`.trim() : '', p.notas].filter(Boolean).join(' — '),
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
          INSERT INTO "comprobantes_bancarios_pagos" ("comprobanteId", "tipoPago", valor, "cuentaContableId", notas)
          VALUES (${compId}, ${p.tipoPago || 'EFECTIVO'}, ${Number(p.valor || 0)}, ${pcId}, ${p.notas || null})
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

      // Asiento contable automático — requiere la cuenta bancaria vinculada
      // a una cuenta del Plan de Cuentas Y que cada línea de "Cuentas"
      // tenga su propia cuenta contable. Si falta algo, el comprobante se
      // crea igual (como antes) pero sin contabilizar — se avisa al
      // usuario para que complete la configuración.
      let asiento = false;
      if (total > 0) {
        const banco = cbId ? await tx.bancos.findFirst({ where: { id: cbId, empresaId } }) : null;
        const cuentasCompletas = cuentas.length > 0 && cuentas.every((c) => c.cuentaContableId);

        if (!cbId) {
          advertenciaContable = 'No se generó el asiento contable: el comprobante no tiene cuenta bancaria asignada.';
        } else if (!banco?.cuentaContableId) {
          advertenciaContable = 'No se generó el asiento contable: la cuenta bancaria no tiene una cuenta contable vinculada (Bancos → editar cuenta).';
        } else if (!cuentasCompletas) {
          advertenciaContable = 'No se generó el asiento contable: falta la cuenta contable en una o más líneas de "Cuentas".';
        } else {
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
            fecha: fechaDate,
            descripcion: `Comprobante ${tipo} ${numero}: ${concep}`,
            tipo: 'COMPROBANTE_BANCO',
            referencia: `COMPROBANTE-${compId}`,
            usuarioId,
            tx,
            detalles: detallesAsiento,
          });

          await tx.$queryRaw`UPDATE "comprobantes_bancarios" SET "asientoId" = ${asientoCreado.id}, "updatedAt" = NOW() WHERE id = ${compId}`;
          if (movId) await tx.movimientos_bancarios.update({ where: { id: movId }, data: { asientoId: asientoCreado.id } });
          asiento = true;
        }
      }

      return { comprobanteId: compId, asientoCreado: asiento };
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
    const id = parseInt(req.params.id, 10);

    const rows = await prisma.$queryRaw`
      SELECT * FROM "comprobantes_bancarios" WHERE id = ${id} AND "empresaId" = ${empresaId}
    `;
    if (!rows.length) return res.status(404).json({ success: false, mensaje: 'Comprobante no encontrado' });
    if (rows[0].estado === 'ANULADO') return res.status(400).json({ success: false, mensaje: 'Ya está anulado' });

    await prisma.$queryRaw`
      UPDATE "comprobantes_bancarios" SET estado = 'ANULADO', "updatedAt" = NOW() WHERE id = ${id}
    `;

    const movId = rows[0].movimientoId ? Number(rows[0].movimientoId) : null;
    if (movId) {
      await prisma.$queryRaw`
        UPDATE "movimientos_bancarios"
        SET concepto = CONCAT('[ANULADO] ', concepto), "updatedAt" = NOW()
        WHERE id = ${movId}
      `;
    }

    res.json({ success: true, mensaje: 'Comprobante anulado' });
  } catch (error) {
    console.error('POST /comprobantes-bancarios/:id/anular:', error);
    res.status(500).json({ success: false, mensaje: 'Error al anular comprobante' });
  }
});

module.exports = router;
