// ====================================
// RUTAS: GESTIÓN DE EMPRESAS
// backend/routes/empresas.js
// Solo accesible en MODO_EMPRESA=multi o para el admin en mono
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, soloAdmin } = require('../middleware/auth');
const {
  asegurarConfiguracionSriEmpresa,
  obtenerEmpresaSri,
} = require('../utils/sriContribuyente');
const {
  asegurarConfiguracionSistemaEmpresa,
  obtenerModoOperacionGlobal,
} = require('../utils/configuracionSistema');
const { sembrarPlanCuentasBase } = require('../utils/planCuentasBase');

// GET /api/empresas — listar todas (super-admin)
router.get('/', proteger, soloAdmin, async (req, res) => {
  try {
    const empresas = await prisma.empresas.findMany({
      orderBy: { razonSocial: 'asc' },
      include: {
        _count: { select: { usuarios: true, facturas: true } },
      },
    });
    res.json({ success: true, data: empresas });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al listar empresas' });
  }
});

// GET /api/empresas/mis-empresas — todas las empresas a las que el usuario tiene acceso
// Incluye su empresa default + las registradas en usuario_empresas
router.get('/mis-empresas', proteger, async (req, res) => {
  try {
    const CAMPOS_EMPRESA = { id: true, ruc: true, razonSocial: true, nombreComercial: true, plan: true, activo: true, esMatriz: true, parentEmpresaId: true };

    const [defaultEmpresa, accesos] = await Promise.all([
      prisma.empresas.findUnique({ where: { id: req.usuario.empresaId }, select: CAMPOS_EMPRESA }),
      prisma.usuario_empresas.findMany({
        where: { usuarioId: req.usuario.id },
        include: { empresa: { select: CAMPOS_EMPRESA } },
      }),
    ]);

    const empresasMap = new Map();
    if (defaultEmpresa) {
      empresasMap.set(defaultEmpresa.id, { ...defaultEmpresa, esDefault: true, rol: req.usuario.rol });
    }
    for (const acceso of accesos) {
      if (!empresasMap.has(acceso.empresaId)) {
        empresasMap.set(acceso.empresaId, { ...acceso.empresa, esDefault: false, rol: acceso.rol });
      }
    }

    res.json({
      success: true,
      data: Array.from(empresasMap.values()),
      empresaActivaId: req.empresa.id,
    });
  } catch (err) {
    console.error('Error mis-empresas:', err);
    res.status(500).json({ success: false, mensaje: 'Error al obtener empresas del usuario' });
  }
});

// GET /api/empresas/mi-empresa — empresa del usuario autenticado
router.get('/mi-empresa', proteger, async (req, res) => {
  try {
    const empresa = await prisma.empresas.findUnique({
      where: { id: req.empresa.id },
    });
    if (!empresa) return res.status(404).json({ success: false, mensaje: 'Empresa no encontrada' });
    res.json({ success: true, data: empresa });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener empresa' });
  }
});

// GET /api/empresas/consultar-sri/:ruc — validar datos de empresa en SRI
router.get('/consultar-sri/:ruc', proteger, soloAdmin, async (req, res) => {
  try {
    const ruc = String(req.params.ruc || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(ruc)) {
      return res.status(400).json({ success: false, mensaje: 'El RUC debe tener 13 dígitos' });
    }

    const empresaSri = await obtenerEmpresaSri(ruc);
    if (!empresaSri) {
      return res.json({
        success: true,
        encontrado: false,
        mensaje: 'No se encontró información en el SRI para ese RUC',
      });
    }

    res.json({
      success: true,
      encontrado: true,
      data: empresaSri,
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al consultar el SRI' });
  }
});

// GET /api/empresas/estadisticas — indicadores del dashboard
router.get('/estadisticas', proteger, async (req, res) => {
  try {
    const ahora      = new Date();
    const inicioAño  = new Date(ahora.getFullYear(), 0, 1);
    const finAño     = new Date(ahora.getFullYear(), 11, 31, 23, 59, 59);
    const inicioMes  = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const finMes     = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0, 23, 59, 59);
    const hoyInicio  = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const eId        = req.empresa.id;

    const [
      facturasAño, notasVentaAño,
      facturasRes, notasVentaRes,
      comprasRes,
      clientes, productos, proveedores,
      stockBajoItems,
      cajaHoy,
    ] = await Promise.all([
      // Conteo anual
      prisma.facturas.count({
        where: { empresaId: eId, anulada: false, fechaEmision: { gte: inicioAño, lte: finAño } },
      }),
      prisma.notas_venta.count({
        where: { empresaId: eId, anulada: false, fechaEmision: { gte: inicioAño, lte: finAño } },
      }),

      // Ventas del mes (suma importeTotal / total)
      prisma.facturas.aggregate({
        where: { empresaId: eId, anulada: false, fechaEmision: { gte: inicioMes, lte: finMes } },
        _sum: { importeTotal: true },
        _count: { id: true },
      }),
      prisma.notas_venta.aggregate({
        where: { empresaId: eId, anulada: false, fechaEmision: { gte: inicioMes, lte: finMes } },
        _sum: { total: true },
        _count: { id: true },
      }),

      // Compras del mes
      prisma.facturas_compra.aggregate({
        where: { empresaId: eId, anulada: false, fechaEmision: { gte: inicioMes, lte: finMes } },
        _sum: { importeTotal: true },
        _count: { id: true },
      }),

      // Maestros
      prisma.clientes.count({ where: { empresaId: eId, activo: true } }),
      prisma.productos_servicios.count({ where: { empresaId: eId, activo: true } }),
      prisma.proveedores.count({ where: { empresaId: eId, activo: true } }).catch(() => 0),

      // Stock bajo (placeholder — se sobreescribe con raw query abajo)
      Promise.resolve(0),

      // Caja abierta hoy
      prisma.cajas_diarias.findFirst({
        where: { empresaId: eId, fechaOperacion: { gte: hoyInicio }, estado: 'ABIERTA' },
        include: {
          movimientos: { select: { tipo: true, monto: true } },
        },
      }),
    ]);

    // Calcular saldo de caja hoy
    let saldoCajaHoy = null;
    if (cajaHoy) {
      const totalIngresos = cajaHoy.movimientos
        .filter((m) => m.tipo === 'INGRESO')
        .reduce((s, m) => s + Number(m.monto), 0);
      const totalEgresos = cajaHoy.movimientos
        .filter((m) => m.tipo === 'EGRESO')
        .reduce((s, m) => s + Number(m.monto), 0);
      saldoCajaHoy = Number(cajaHoy.montoApertura) + totalIngresos - totalEgresos;
    }

    // Stock bajo: usar raw query si prisma no soporta comparación de columnas
    let stockBajoCount = 0;
    try {
      const raw = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS total
        FROM productos_servicios
        WHERE "empresaId" = ${eId}
          AND activo = true
          AND inventariable = true
          AND "stockActual" <= COALESCE("stockMinimo", 0)
      `;
      stockBajoCount = raw[0]?.total ?? 0;
    } catch {
      stockBajoCount = 0;
    }

    const ventasMes  = Number(facturasRes._sum.importeTotal ?? 0) + Number(notasVentaRes._sum.total ?? 0);
    const comprasMes = Number(comprasRes._sum.importeTotal ?? 0);
    const limite     = req.empresa.factAnualesMax;

    res.json({
      success: true,
      data: {
        año: ahora.getFullYear(),
        mes: ahora.getMonth() + 1,

        // Anual
        facturas: facturasAño,
        notasVenta: notasVentaAño,
        totalComprobantes: facturasAño + notasVentaAño,
        limiteAnual: limite,
        restantes: limite ? Math.max(0, limite - (facturasAño + notasVentaAño)) : null,

        // Mes actual
        ventasMes,
        facturasMes: facturasRes._count.id,
        notasVentaMes: notasVentaRes._count.id,
        comprasMes,
        comprasMesCount: comprasRes._count.id,

        // Maestros
        clientes,
        productos,
        proveedores,

        // Inventario y caja
        stockBajo: stockBajoCount,
        saldoCajaHoy,
        cajaNombre: cajaHoy?.nombreCaja ?? null,

        plan: req.empresa.plan,
      },
    });
  } catch (err) {
    console.error('Error estadísticas:', err);
    res.status(500).json({ success: false, mensaje: 'Error al obtener estadísticas' });
  }
});

// POST /api/empresas — crear empresa (solo admin, modo multi)
router.post('/', proteger, soloAdmin, async (req, res) => {
  try {
    const modoOperacion = await obtenerModoOperacionGlobal(prisma);
    if (modoOperacion !== 'multiempresa') {
      return res.status(403).json({ success: false, mensaje: 'Crear empresas solo disponible en modo multiempresa' });
    }
    const { ruc, razonSocial, nombreComercial, direccion, email, telefono, plan, crearConfiguracionSri } = req.body;
    if (!ruc || !razonSocial) {
      return res.status(400).json({ success: false, mensaje: 'RUC y razón social son requeridos' });
    }

    const rucLimpio = String(ruc).replace(/\D/g, '');
    if (!/^\d{13}$/.test(rucLimpio)) {
      return res.status(400).json({ success: false, mensaje: 'El RUC debe tener 13 dígitos' });
    }

    const planFinal = plan === 'lite' ? 'lite' : 'full';
    const empresaSri = await obtenerEmpresaSri(rucLimpio);

    const empresa = await prisma.$transaction(async (tx) => {
      const creada = await tx.empresas.create({
        data: {
          ruc: rucLimpio,
          razonSocial: empresaSri?.razonSocial || razonSocial.trim(),
          nombreComercial: empresaSri?.nombreComercial || nombreComercial?.trim() || null,
          direccion: empresaSri?.direccion || direccion?.trim() || null,
          email: email?.trim().toLowerCase() || null,
          telefono: telefono?.trim() || empresaSri?.telefono || null,
          plan: planFinal,
          factAnualesMax: planFinal === 'lite' ? 100 : null,
        },
      });

      if (crearConfiguracionSri !== false) {
        await asegurarConfiguracionSriEmpresa(tx, creada, empresaSri);
      }
      await asegurarConfiguracionSistemaEmpresa(creada, tx);
      await sembrarPlanCuentasBase(tx, creada.id);

      return creada;
    });

    res.status(201).json({ success: true, data: empresa });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: 'Ya existe una empresa con ese RUC' });
    }
    res.status(500).json({ success: false, mensaje: 'Error al crear empresa' });
  }
});

// PUT /api/empresas/:id — actualizar empresa
router.put('/:id', proteger, soloAdmin, async (req, res) => {
  try {
    const { razonSocial, nombreComercial, direccion, email, telefono, plan, activo } = req.body;
    const data = {};
    if (razonSocial !== undefined)     data.razonSocial     = razonSocial;
    if (nombreComercial !== undefined) data.nombreComercial = nombreComercial;
    if (direccion !== undefined)       data.direccion       = direccion;
    if (email !== undefined)           data.email           = email?.toLowerCase();
    if (telefono !== undefined)        data.telefono        = telefono;
    if (activo !== undefined)          data.activo          = activo;
    if (plan !== undefined) {
      data.plan = plan === 'lite' ? 'lite' : 'full';
      data.factAnualesMax = data.plan === 'lite' ? 100 : null;
    }

    const empresa = await prisma.$transaction(async (tx) => {
      const actualizada = await tx.empresas.update({ where: { id: parseInt(req.params.id, 10) }, data });
      if (plan !== undefined) {
        const dataConfig = { tipoSistema: actualizada.plan };
        if (actualizada.plan === 'lite') {
          dataConfig.comprasHabilitadas = false;
          dataConfig.contabilidadHabilitada = false;
          dataConfig.retencionesHabilitadas = false;
          dataConfig.liquidacionesHabilitadas = false;
          dataConfig.atsHabilitado = false;
        }

        await tx.configuracion_sistema.updateMany({
          where: { empresaId: actualizada.id },
          data: dataConfig,
        });
      }
      return actualizada;
    });
    res.json({ success: true, data: empresa });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al actualizar empresa' });
  }
});

module.exports = router;
