// ====================================
// RUTAS: DECLARACIONES TRIBUTARIAS SRI
// backend/routes/declaraciones.js
//
// Formulario 104 — IVA mensual
// Formulario 103 — Retenciones en la Fuente mensual
// Formulario 101 — IR anual (resumen, no sustituto oficial)
//
// Fuentes de datos:
//   F104: facturas + notas_credito + facturas_compra + retenciones
//   F103: retenciones (comprobantes de retención emitidos)
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

router.use(proteger);
router.use(autorizarPermiso('tributario.reportes'));

// ─── Helpers de rango de fechas ────────────────────────────────────────────────
function rangoMes(anio, mes) {
  const desde = new Date(anio, mes - 1, 1, 0, 0, 0);
  const hasta = new Date(anio, mes, 0, 23, 59, 59, 999);
  return { desde, hasta };
}

function rangoAnio(anio) {
  return {
    desde: new Date(anio, 0, 1, 0, 0, 0),
    hasta: new Date(anio, 11, 31, 23, 59, 59, 999),
  };
}

function d(v) { return parseFloat(v || 0); }

// ─── GET /f104 — Formulario 104 IVA Mensual ────────────────────────────────────
// Query: ?anio=2025&mes=3
router.get('/f104', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const { desde, hasta } = rangoMes(anio, mes);
    const empresaId = req.empresa.id;
    const filtroFecha = { gte: desde, lte: hasta };

    // ── VENTAS ──────────────────────────────────────────────────────────────────
    const db = req.prisma || prisma;

    const facturas = await db.facturas.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: {
        subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true,
        totalIva: true, importeTotal: true,
        notas_credito: {
          select: {
            totalSinImpuestos: true, totalIva: true, importeTotal: true,
          },
        },
      },
    });

    let ventasSubtotal0  = 0;
    let ventasSubtotal5  = 0;
    let ventasSubtotal12 = 0;
    let ventasSubtotal15 = 0;
    let ventasIva        = 0;
    let ncSubtotal       = 0;
    let ncIva            = 0;

    facturas.forEach((f) => {
      ventasSubtotal0  += d(f.subtotal0);
      ventasSubtotal5  += d(f.subtotal5);
      ventasSubtotal12 += d(f.subtotal12);
      ventasSubtotal15 += d(f.subtotal15);
      ventasIva        += d(f.totalIva);
      f.notas_credito?.forEach((nc) => {
        ncSubtotal += d(nc.totalSinImpuestos);
        ncIva      += d(nc.totalIva);
      });
    });

    // Ventas netas (descontando notas de crédito del período)
    const _totBaseVentas = ventasSubtotal0 + ventasSubtotal5 + ventasSubtotal12 + ventasSubtotal15 + 0.001;
    const ventasNetas0  = Math.max(0, parseFloat((ventasSubtotal0  - ncSubtotal * (ventasSubtotal0  / _totBaseVentas)).toFixed(2)));
    const ventasNetas5  = Math.max(0, parseFloat((ventasSubtotal5  - ncSubtotal * (ventasSubtotal5  / _totBaseVentas)).toFixed(2)));
    const ventasNetas12 = Math.max(0, parseFloat((ventasSubtotal12 - ncSubtotal * (ventasSubtotal12 / _totBaseVentas)).toFixed(2)));
    const ventasNetas15 = Math.max(0, parseFloat((ventasSubtotal15 - ncSubtotal * (ventasSubtotal15 / _totBaseVentas)).toFixed(2)));
    const ivaVentasNeto = parseFloat((ventasIva - ncIva).toFixed(2));

    // ── COMPRAS ─────────────────────────────────────────────────────────────────
    // Reglas de inclusión en el F104:
    //   1. Excluir si receptorEsRuc === false (facturadas a cédula personal, no al RUC)
    //   2. Excluir si esGastoPersonal === true (alimentación, salud, etc. — persona natural)
    //   3. receptorEsRuc null (compras manuales/históricas sin XML) SÍ se incluye.
    const compras = await db.facturas_compra.findMany({
      where: {
        empresaId,
        fechaEmision:    filtroFecha,
        anulada:         false,
        esGastoPersonal: { not: true },
        OR: [{ receptorEsRuc: null }, { receptorEsRuc: true }],
      },
      select: {
        subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true,
        totalIva: true, importeTotal: true, retencionIVA: true,
      },
    });

    // Contar cuántas facturas de gastos personales fueron excluidas (para info al usuario)
    const gastosPersonalesExcluidos = await db.facturas_compra.count({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false, esGastoPersonal: true },
    });

    let comprasSubtotal0  = 0;
    let comprasSubtotal5  = 0;
    let comprasSubtotal12 = 0;
    let comprasSubtotal15 = 0;
    let ivaCompras        = 0;
    let retencionIvaCompras = 0;

    compras.forEach((c) => {
      comprasSubtotal0  += d(c.subtotal0);
      comprasSubtotal5  += d(c.subtotal5);
      comprasSubtotal12 += d(c.subtotal12);
      comprasSubtotal15 += d(c.subtotal15);
      ivaCompras        += d(c.totalIva);
      retencionIvaCompras += d(c.retencionIVA);
    });

    // ── LIQUIDACIONES DE COMPRA ─────────────────────────────────────────────────
    const liquidaciones = await db.liquidaciones_compra.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: { subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true },
    });

    let liqSubtotal0 = 0, liqSubtotal5 = 0, liqSubtotal12 = 0, liqSubtotal15 = 0, liqIva = 0;
    liquidaciones.forEach((l) => {
      liqSubtotal0  += d(l.subtotal0);
      liqSubtotal5  += d(l.subtotal5);
      liqSubtotal12 += d(l.subtotal12);
      liqSubtotal15 += d(l.subtotal15);
      liqIva        += d(l.totalIva);
    });

    const comprasExcluidasCedula = await db.facturas_compra.count({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false, receptorEsRuc: false },
    });

    // ── RETENCIONES DE IVA QUE LE HAN SIDO EFECTUADAS (recibidas de clientes) ───
    // Ojo: esto NO es lo mismo que las retenciones que la empresa EMITE a sus
    // proveedores (tabla `retenciones`, se declaran en el F103 como una
    // obligación aparte — dinero que hay que remitir al SRI, no un crédito
    // propio). Lo que sí reduce el IVA a pagar en el F104 es la retención que
    // los CLIENTES (agentes de retención) le practican a la empresa al pagarle
    // sus ventas — eso vive en `retenciones_recibidas` (casillero 605/699 del
    // formulario real).
    const retencionesRecibidas = await db.retenciones_recibidas.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: { totalRetencionIva: true, detalles: true },
    });

    let retencionIVA30 = 0, retencionIVA70 = 0, retencionIVA100 = 0, retencionIVAOtro = 0;
    retencionesRecibidas.forEach((ret) => {
      const detalles = Array.isArray(ret.detalles) ? ret.detalles : [];
      detalles.forEach((det) => {
        // codigo: 1=Renta, 2/4/6=IVA (ver buzon.js parsearRetencionRecibida)
        if (!['2', '4', '6'].includes(String(det.codigo))) return;
        const valor = d(det.valorRetener);
        const pct = Math.round(d(det.porcentajeRetener));
        if (pct === 30) retencionIVA30 += valor;
        else if (pct === 70) retencionIVA70 += valor;
        else if (pct === 100) retencionIVA100 += valor;
        else retencionIVAOtro += valor;
      });
    });

    // ── NC RECIBIDAS DE PROVEEDORES ──────────────────────────────────────────────
    // Almacenadas en docs_recibidos_otros con tipoDocumento='04'. Solo tienen
    // importeTotal; el IVA se extrae del xmlAutorizado si está disponible.
    // Reducen el crédito fiscal de IVA (casillero 521/523 del F104 real).
    function extractIvaDeNcXml(xml) {
      if (!xml) return 0;
      let total = 0;
      const bloques = xml.match(/<totalImpuesto>[\s\S]*?<\/totalImpuesto>/g) || [];
      for (const b of bloques) {
        if (!/<codigo>2<\/codigo>/.test(b)) continue; // código 2 = IVA
        const m = b.match(/<valor>([\d.]+)<\/valor>/);
        if (m) total += parseFloat(m[1]) || 0;
      }
      return parseFloat(total.toFixed(2));
    }

    const ncReci = await db.docs_recibidos_otros.findMany({
      where: { empresaId, tipoDocumento: '04', fechaEmision: filtroFecha },
      select: { importeTotal: true, xmlAutorizado: true },
    });

    let ncReciIva = 0, ncReciSubtotal = 0;
    ncReci.forEach((nc) => {
      const iva = extractIvaDeNcXml(nc.xmlAutorizado);
      ncReciIva      += iva;
      ncReciSubtotal += Math.max(0, d(nc.importeTotal) - iva);
    });
    ncReciIva      = parseFloat(ncReciIva.toFixed(2));
    ncReciSubtotal = parseFloat(ncReciSubtotal.toFixed(2));

    // ── CRÉDITO TRIBUTARIO ARRASTRADO DEL MES ANTERIOR ──────────────────────────
    // No se calcula automáticamente encadenando meses (el saldo oficial ante el
    // SRI puede no coincidir con lo que este sistema calcularía solo, p.ej. si
    // la empresa empezó a usar AELA a mitad de año). El usuario lo ingresa una
    // vez por período en PUT /f104/credito-anterior y queda guardado.
    const creditoGuardado = await db.declaraciones_credito_iva.findUnique({
      where: { empresaId_anio_mes: { empresaId, anio, mes } },
    });
    const creditoTributarioAnterior = creditoGuardado ? d(creditoGuardado.creditoTributarioAnterior) : 0;

    // ── CÁLCULO FINAL ────────────────────────────────────────────────────────────
    const ivaGenerado    = parseFloat(ivaVentasNeto.toFixed(2));
    const ivaCreditoFiscal = parseFloat((ivaCompras + liqIva - ncReciIva).toFixed(2));
    const ivaRetenidoClientes = parseFloat((retencionIVA30 + retencionIVA70 + retencionIVA100 + retencionIVAOtro).toFixed(2));
    const ivaACobrarPagar = parseFloat((ivaGenerado - ivaCreditoFiscal - ivaRetenidoClientes - creditoTributarioAnterior).toFixed(2));

    const f104 = {
      periodo: { anio, mes },
      ventas: {
        subtotal0:      parseFloat(ventasSubtotal0.toFixed(2)),
        subtotal5:      parseFloat(ventasSubtotal5.toFixed(2)),
        subtotal12:     parseFloat(ventasSubtotal12.toFixed(2)),
        subtotal15:     parseFloat(ventasSubtotal15.toFixed(2)),
        ivaVentas:      parseFloat(ventasIva.toFixed(2)),
        notasCredito:   { subtotal: parseFloat(ncSubtotal.toFixed(2)), iva: parseFloat(ncIva.toFixed(2)) },
        subtotalNeto0:  ventasNetas0,
        subtotalNeto5:  ventasNetas5,
        subtotalNeto12: ventasNetas12,
        subtotalNeto15: ventasNetas15,
        ivaGenerado,
      },
      compras: {
        subtotal0:           parseFloat(comprasSubtotal0.toFixed(2)),
        subtotal5:           parseFloat(comprasSubtotal5.toFixed(2)),
        subtotal12:          parseFloat(comprasSubtotal12.toFixed(2)),
        subtotal15:          parseFloat(comprasSubtotal15.toFixed(2)),
        ivaCompras:          parseFloat(ivaCompras.toFixed(2)),
        liquidaciones:       { subtotal0: parseFloat(liqSubtotal0.toFixed(2)), subtotal5: parseFloat(liqSubtotal5.toFixed(2)), subtotal12: parseFloat(liqSubtotal12.toFixed(2)), subtotal15: parseFloat(liqSubtotal15.toFixed(2)), iva: parseFloat(liqIva.toFixed(2)) },
        ncRecibidas:         { subtotal: ncReciSubtotal, iva: ncReciIva, cantidad: ncReci.length },
        ivaCreditoFiscal,
      },
      retenciones: {
        iva30:   parseFloat(retencionIVA30.toFixed(2)),
        iva70:   parseFloat(retencionIVA70.toFixed(2)),
        iva100:  parseFloat(retencionIVA100.toFixed(2)),
        otro:    parseFloat(retencionIVAOtro.toFixed(2)),
        totalRetenido: ivaRetenidoClientes,
      },
      resultado: {
        creditoTributarioAnterior,
        creditoTributarioGuardado: !!creditoGuardado,
        ivaACobrarPagar,
        estado: ivaACobrarPagar > 0 ? 'A_PAGAR' : ivaACobrarPagar < 0 ? 'CREDITO_TRIBUTARIO' : 'CERO',
      },
      meta: {
        cantidadFacturas:    facturas.length,
        cantidadCompras:     compras.length,
        cantidadLiquidaciones: liquidaciones.length,
        cantidadRetencionesRecibidas: retencionesRecibidas.length,
        comprasExcluidasCedula,
        gastosPersonalesExcluidos,
        // Desglose para mostrar al usuario de dónde viene cada valor
        desglose: {
          facturasCompra0:    parseFloat(comprasSubtotal0.toFixed(2)),
          facturasCompra15:   parseFloat(comprasSubtotal15.toFixed(2)),
          liquidaciones0:     parseFloat(liqSubtotal0.toFixed(2)),
          liquidaciones15:    parseFloat(liqSubtotal15.toFixed(2)),
        },
      },
    };

    res.json({ ok: true, data: f104 });
  } catch (err) {
    console.error('Error F104:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── PUT /f104/credito-anterior — guardar el crédito tributario arrastrado ─────
// Body: { anio, mes, creditoTributarioAnterior }
router.put('/f104/credito-anterior', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa.id;
    const anio = parseInt(req.body.anio);
    const mes  = parseInt(req.body.mes);
    const valor = d(req.body.creditoTributarioAnterior);

    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Período inválido' });
    }
    if (valor < 0) {
      return res.status(400).json({ ok: false, mensaje: 'El crédito tributario no puede ser negativo' });
    }

    await db.declaraciones_credito_iva.upsert({
      where: { empresaId_anio_mes: { empresaId, anio, mes } },
      update: { creditoTributarioAnterior: valor, usuarioId: req.usuario?.id || null },
      create: { empresaId, anio, mes, creditoTributarioAnterior: valor, usuarioId: req.usuario?.id || null },
    });

    res.json({ ok: true, data: { anio, mes, creditoTributarioAnterior: valor } });
  } catch (err) {
    console.error('Error PUT /f104/credito-anterior:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /f103 — Formulario 103 Retenciones en la Fuente mensual ───────────────
// Query: ?anio=2025&mes=3
router.get('/f103', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const { desde, hasta } = rangoMes(anio, mes);
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;
    const filtroFecha = { gte: desde, lte: hasta };

    const retenciones = await db.retenciones.findMany({
      where: {
        empresaId,
        fechaEmision: filtroFecha,
        estadoSri: { in: ['AUTORIZADO', 'FIRMADO_PENDIENTE_ENVIO', 'RECHAZADO'] },
      },
      select: {
        id: true,
        claveAcceso: true,
        numeroRetencion: true,
        identificacionProveedor: true,
        razonSocialProveedor: true,
        impuestos: true,
        estadoSri: true,
        fechaEmision: true,
      },
    });

    // Agregar por código de retención
    const porCodigo = {};

    retenciones.forEach((ret) => {
      const impuestos = typeof ret.impuestos === 'string'
        ? JSON.parse(ret.impuestos) : (ret.impuestos || []);

      impuestos.forEach((imp) => {
        if (imp.tipo !== 'RENTA' && imp.tipo !== 'renta') return;
        const cod = imp.codigoRetencion;
        if (!porCodigo[cod]) {
          porCodigo[cod] = {
            codigo:           cod,
            descripcion:      imp.descripcion || `Retención ${cod}`,
            porcentaje:       parseFloat(imp.porcentaje || 0),
            baseImponible:    0,
            valorRetenido:    0,
            cantidad:         0,
          };
        }
        porCodigo[cod].baseImponible += d(imp.baseImponible);
        porCodigo[cod].valorRetenido += d(imp.valorRetenido);
        porCodigo[cod].cantidad++;
      });
    });

    const detalle = Object.values(porCodigo).sort((a, b) => a.codigo.localeCompare(b.codigo));
    const totalRetenido = parseFloat(detalle.reduce((acc, r) => acc + r.valorRetenido, 0).toFixed(2));

    // Tabla resumen de proveedores
    const porProveedor = {};
    retenciones.forEach((ret) => {
      const id = ret.identificacionProveedor;
      if (!porProveedor[id]) {
        porProveedor[id] = {
          identificacion: id,
          razonSocial:    ret.razonSocialProveedor,
          comprobantes:   0,
          totalRetenido:  0,
        };
      }
      porProveedor[id].comprobantes++;
      const impuestos = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
      impuestos.forEach((imp) => {
        if (imp.tipo === 'RENTA' || imp.tipo === 'renta') {
          porProveedor[id].totalRetenido += d(imp.valorRetenido);
        }
      });
    });

    const f103 = {
      periodo: { anio, mes },
      detallePorCodigo: detalle,
      totalRetenido,
      cantidadComprobantes: retenciones.length,
      proveedores: Object.values(porProveedor).sort((a, b) => b.totalRetenido - a.totalRetenido),
      meta: {
        comprobantesAutorizados: retenciones.filter((r) => r.estadoSri === 'AUTORIZADO').length,
        comprobantesPendientes:  retenciones.filter((r) => r.estadoSri === 'FIRMADO_PENDIENTE_ENVIO').length,
      },
    };

    res.json({ ok: true, data: f103 });
  } catch (err) {
    console.error('Error F103:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /f101 — Resumen anual (datos para IR) ─────────────────────────────────
// Query: ?anio=2025
router.get('/f101', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoAnio(anio);
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;
    const filtroFecha = { gte: desde, lte: hasta };

    const [facturas, compras, retenciones] = await Promise.all([
      db.facturas.aggregate({
        where: { empresaId, fechaEmision: filtroFecha, anulada: false },
        _sum:   { importeTotal: true, totalIva: true },
        _count: { id: true },
      }),
      db.facturas_compra.aggregate({
        where: { empresaId, fechaEmision: filtroFecha, anulada: false, OR: [{ receptorEsRuc: null }, { receptorEsRuc: true }] },
        _sum:   { importeTotal: true, totalIva: true },
        _count: { id: true },
      }),
      db.retenciones.aggregate({
        where: { empresaId, fechaEmision: filtroFecha, estadoSri: 'AUTORIZADO' },
        _count: { id: true },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        anio,
        ingresos: {
          totalFacturado: d(facturas._sum.importeTotal),
          totalIvaVentas: d(facturas._sum.totalIva),
          cantidadFacturas: facturas._count.id,
        },
        gastos: {
          totalCompras: d(compras._sum.importeTotal),
          totalIvaCompras: d(compras._sum.totalIva),
          cantidadCompras: compras._count.id,
        },
        retenciones: {
          cantidadComprobantes: retenciones._count.id,
        },
        nota: 'Este resumen es orientativo. Consulte a un contador para el llenado oficial del F101.',
      },
    });
  } catch (err) {
    console.error('Error F101:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /disponibles — Períodos con datos ─────────────────────────────────────
router.get('/disponibles', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;

    // Obtener meses con facturas
    const facturas = await db.facturas.groupBy({
      by: ['fechaEmision'],
      where: { empresaId, anulada: false },
      _count: { id: true },
    });

    const periodos = new Set();
    facturas.forEach((f) => {
      const d = new Date(f.fechaEmision);
      periodos.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });

    res.json({
      ok: true,
      data: Array.from(periodos).sort().reverse(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

module.exports = router;
