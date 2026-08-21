// ====================================
// routes/mesas.js — AELA
// Mesas y Comandas (módulo restaurante). El pedido se toma aquí por mesa y
// se envía a cocina por partes; al COBRAR se crea una factura o nota de
// venta REAL con el POST /facturas o POST /notas-venta que YA existe (el
// frontend hace esa llamada directamente, igual que PuntoVenta.jsx) — este
// archivo solo hace de "pre-cuenta" y después enlaza el documento ya creado
// vía POST /comandas/:id/cerrar. No reimplementa nada de la emisión SRI.
// ====================================
const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { requiereModulo } = require('../middleware/modulos');
const { generarTicketCocina, imprimirBuffer } = require('../utils/impresoraEscPos');
const bwipjs = require('bwip-js');

router.use(proteger);
router.use(requiereModulo('restauranteHabilitado'));

// GET /api/mesas/menu/qr?url=... — PNG del código QR del menú digital
// público, para que el dueño lo descargue/imprima y lo pegue en las mesas.
// bwip-js ya es dependencia (mismo generador que el barcode del RIDE).
router.get('/menu/qr', autorizarPermiso('mesas.administrar'), async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    if (!url) return res.status(400).json({ success: false, mensaje: 'Falta la URL a codificar' });

    const png = await bwipjs.toBuffer({
      bcid: 'qrcode',
      text: url,
      scale: 6,
      includetext: false,
    });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (error) {
    console.error('GET /mesas/menu/qr:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el código QR' });
  }
});

function parseItems(comanda) {
  return typeof comanda.items === 'string' ? JSON.parse(comanda.items || '[]') : (comanda.items || []);
}

function calcularTotales(items) {
  let subtotal = 0;
  let totalIva = 0;
  for (const it of items) {
    const cant   = Number(it.cantidad) || 0;
    const precio = Number(it.precioUnitario) || 0;
    const base   = cant * precio;
    subtotal += base;
    const pct = Number(it.ivaPorcentaje) || 0;
    if (pct > 0) totalIva += base * (pct / 100);
  }
  subtotal = Number(subtotal.toFixed(2));
  totalIva = Number(totalIva.toFixed(2));
  return { subtotal, totalIva, total: Number((subtotal + totalIva).toFixed(2)) };
}

// ─── MESAS ──────────────────────────────────────────────────────────────────

// Permisos combinados (OR) — ver comentario en utils/roles.js sobre el
// split mesas.gestionar (rol general) / mesas.tomarPedido (mesero) /
// mesas.cobrar (cajero) / mesas.cocina (cocina).
const P_VER        = ['mesas.gestionar', 'mesas.tomarPedido', 'mesas.cobrar', 'mesas.cocina'];
const P_TOMAR       = ['mesas.gestionar', 'mesas.tomarPedido'];
const P_COBRAR      = ['mesas.gestionar', 'mesas.cobrar'];
const P_COCINA      = ['mesas.gestionar', 'mesas.cocina'];
const P_SERVICIO    = ['mesas.gestionar', 'mesas.tomarPedido', 'mesas.cobrar'];

// GET /api/mesas/llamadas/pendientes — llamadas de servicio sin atender
// (botón "Llamar mesero" del menú digital por QR), más antiguas primero.
router.get('/llamadas/pendientes', autorizarPermiso(P_SERVICIO), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const llamadas = await prisma.restaurante_llamadas.findMany({
      where: { empresaId, estado: 'PENDIENTE' },
      include: { mesa: { select: { nombre: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: llamadas });
  } catch (error) {
    console.error('GET /mesas/llamadas/pendientes:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener las llamadas de servicio' });
  }
});

// POST /api/mesas/llamadas/:id/atender
router.post('/llamadas/:id/atender', autorizarPermiso(P_SERVICIO), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    const llamada = await prisma.restaurante_llamadas.findFirst({ where: { id, empresaId } });
    if (!llamada) return res.status(404).json({ success: false, mensaje: 'Llamada no encontrada' });

    await prisma.restaurante_llamadas.update({
      where: { id },
      data: { estado: 'ATENDIDA', atendidaEn: new Date(), atendidaPor: req.usuario.id },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('POST /mesas/llamadas/:id/atender:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo marcar la llamada como atendida' });
  }
});

// GET /api/mesas — mapa de mesas con resumen de su comanda abierta (si tiene)
router.get('/', autorizarPermiso(P_VER), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const mesas = await prisma.restaurante_mesas.findMany({
      where: { empresaId, activo: true },
      orderBy: { nombre: 'asc' },
    });

    const comandasAbiertas = await prisma.restaurante_comandas.findMany({
      where: { empresaId, estado: 'ABIERTA', mesaId: { in: mesas.map((m) => m.id) } },
    });
    const porMesa = new Map(comandasAbiertas.map((c) => [c.mesaId, c]));

    const data = mesas.map((m) => {
      const comanda = porMesa.get(m.id);
      if (!comanda) return { ...m, comanda: null };
      const items = parseItems(comanda);
      // Cuentas separadas: el total que se muestra en el mapa de mesas es lo
      // que FALTA por cobrar, no el consumo total (ya se cobró parte).
      const totales = calcularTotales(items.filter((it) => !it.facturado));
      return {
        ...m,
        comanda: {
          id: comanda.id,
          numeroComensales: comanda.numeroComensales,
          abiertaEn: comanda.abiertaEn,
          cantidadItems: items.length,
          pendientesCocina: items.filter((it) => !it.enviadoCocina).length,
          tieneCuentaDividida: items.some((it) => it.facturado),
          ...totales,
        },
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /mesas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener las mesas' });
  }
});

// POST /api/mesas — crear mesa (solo administración del local)
router.post('/', autorizarPermiso('mesas.administrar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { nombre, capacidad } = req.body || {};
    if (!nombre?.trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre de la mesa es requerido' });
    }

    const mesa = await prisma.restaurante_mesas.create({
      data: {
        empresaId,
        nombre: nombre.trim(),
        capacidad: capacidad ? parseInt(capacidad, 10) : null,
      },
    });
    res.status(201).json({ success: true, data: mesa });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Ya existe una mesa con ese nombre' });
    }
    console.error('POST /mesas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo crear la mesa' });
  }
});

// PUT /api/mesas/:id — editar mesa
router.put('/:id', autorizarPermiso('mesas.administrar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    const { nombre, capacidad, activo } = req.body || {};

    const mesa = await prisma.restaurante_mesas.findFirst({ where: { id, empresaId } });
    if (!mesa) return res.status(404).json({ success: false, mensaje: 'Mesa no encontrada' });

    const data = {};
    if (nombre !== undefined) data.nombre = String(nombre).trim();
    if (capacidad !== undefined) data.capacidad = capacidad ? parseInt(capacidad, 10) : null;
    if (activo !== undefined) data.activo = Boolean(activo);

    const actualizada = await prisma.restaurante_mesas.update({ where: { id }, data });
    res.json({ success: true, data: actualizada });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Ya existe una mesa con ese nombre' });
    }
    console.error('PUT /mesas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar la mesa' });
  }
});

// DELETE /api/mesas/:id — solo si nunca tuvo comandas (si ya tuvo, desactivar en su lugar)
router.delete('/:id', autorizarPermiso('mesas.administrar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const mesa = await prisma.restaurante_mesas.findFirst({ where: { id, empresaId } });
    if (!mesa) return res.status(404).json({ success: false, mensaje: 'Mesa no encontrada' });

    const tieneHistorial = await prisma.restaurante_comandas.count({ where: { mesaId: id } });
    if (tieneHistorial > 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Esta mesa ya tiene comandas registradas — desactívala en vez de eliminarla',
      });
    }

    await prisma.restaurante_mesas.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Mesa eliminada' });
  } catch (error) {
    console.error('DELETE /mesas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo eliminar la mesa' });
  }
});

// ─── COMANDAS ───────────────────────────────────────────────────────────────

// GET /api/mesas/:id/comanda — comanda abierta de la mesa (o null)
router.get('/:id/comanda', autorizarPermiso(P_VER), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const mesaId = parseInt(req.params.id, 10);

    const comanda = await prisma.restaurante_comandas.findFirst({
      where: { empresaId, mesaId, estado: 'ABIERTA' },
      include: { mesa: true, mesero: { select: { id: true, nombre: true } } },
    });
    if (!comanda) return res.json({ success: true, data: null });

    const items = parseItems(comanda);
    // Cuentas separadas: total/subtotal/totalIva reflejan lo PENDIENTE por
    // cobrar (mismo criterio que el mapa de mesas); totalFacturado es lo que
    // ya se cobró en documentos anteriores de esta misma comanda.
    res.json({
      success: true,
      data: {
        ...comanda,
        items,
        ...calcularTotales(items.filter((it) => !it.facturado)),
        totalFacturado: calcularTotales(items.filter((it) => it.facturado)).total,
      },
    });
  } catch (error) {
    console.error('GET /mesas/:id/comanda:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener la comanda' });
  }
});

// POST /api/mesas/:id/comanda — abrir una comanda nueva (la mesa debe estar LIBRE)
router.post('/:id/comanda', autorizarPermiso(P_TOMAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const mesaId = parseInt(req.params.id, 10);
    const { numeroComensales, observaciones } = req.body || {};

    const mesa = await prisma.restaurante_mesas.findFirst({ where: { id: mesaId, empresaId, activo: true } });
    if (!mesa) return res.status(404).json({ success: false, mensaje: 'Mesa no encontrada' });
    if (mesa.estado === 'OCUPADA') {
      return res.status(400).json({ success: false, mensaje: 'La mesa ya tiene una comanda abierta' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const comanda = await tx.restaurante_comandas.create({
        data: {
          empresaId,
          mesaId,
          items: [],
          numeroComensales: numeroComensales ? parseInt(numeroComensales, 10) : null,
          observaciones: observaciones?.trim() || null,
          meseroId: req.usuario.id,
        },
      });
      await tx.restaurante_mesas.update({ where: { id: mesaId }, data: { estado: 'OCUPADA' } });
      return comanda;
    });

    res.status(201).json({ success: true, data: resultado });
  } catch (error) {
    console.error('POST /mesas/:id/comanda:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo abrir la comanda' });
  }
});

// PUT /api/mesas/comandas/:id — reemplaza la lista de ítems (agregar/quitar/editar)
router.put('/comandas/:id', autorizarPermiso(P_TOMAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    const { items } = req.body || {};

    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, mensaje: 'items debe ser un arreglo' });
    }

    const comanda = await prisma.restaurante_comandas.findFirst({ where: { id, empresaId } });
    if (!comanda) return res.status(404).json({ success: false, mensaje: 'Comanda no encontrada' });
    if (comanda.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, mensaje: 'Esta comanda ya está cerrada' });
    }

    // Preservar el estado enviadoCocina/listoCocina de los ítems que ya
    // existían — el mesero puede reordenar/editar cantidades sin que se
    // vuelvan a marcar como "nuevos" para cocina. Los ítems ya FACTURADOS
    // (cuentas separadas) son de solo lectura desde acá: se restauran tal
    // cual estaban aunque el request los traiga editados, y si el request
    // los omite (el cajero los filtró de la vista editable) se agregan de
    // vuelta igual — nunca se pierde ni se altera un ítem ya cobrado
    // editando la comanda.
    const itemsAnteriores = parseItems(comanda);
    const clave = (it) => `${it.codigoPrincipal}||${it.nota || ''}`;
    const itemsNormalizados = items.map((it) => {
      const previo = itemsAnteriores.find((p) => p.codigoPrincipal === it.codigoPrincipal && p.nota === it.nota);
      if (previo?.facturado) return previo; // solo lectura, ignora cualquier edición entrante
      return {
        codigoPrincipal: String(it.codigoPrincipal || ''),
        descripcion: String(it.descripcion || ''),
        cantidad: Number(it.cantidad) || 0,
        precioUnitario: Number(it.precioUnitario) || 0,
        ivaPorcentaje: Number(it.ivaPorcentaje) || 0,
        nota: it.nota?.trim() || null,
        enviadoCocina: previo ? Boolean(previo.enviadoCocina) : false,
        enviadoCocinaEn: previo?.enviadoCocinaEn || null,
        listoCocina: previo ? Boolean(previo.listoCocina) : false,
        listoCocinaEn: previo?.listoCocinaEn || null,
        facturado: false,
        facturadoEn: null,
        documentoTipo: null,
        documentoId: null,
      };
    }).filter((it) => it.codigoPrincipal && it.cantidad > 0);
    // Ítems ya facturados que el request omitió (la vista editable del
    // cajero no los muestra) — se reincorporan sin tocar.
    const clavesIncluidas = new Set(itemsNormalizados.map(clave));
    for (const p of itemsAnteriores) {
      if (p.facturado && !clavesIncluidas.has(clave(p))) itemsNormalizados.push(p);
    }

    const actualizada = await prisma.restaurante_comandas.update({
      where: { id },
      data: { items: itemsNormalizados },
    });

    res.json({ success: true, data: { ...actualizada, items: itemsNormalizados, ...calcularTotales(itemsNormalizados) } });
  } catch (error) {
    console.error('PUT /mesas/comandas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar la comanda' });
  }
});

// POST /api/mesas/comandas/:id/enviar-cocina — imprime solo los ítems nuevos
router.post('/comandas/:id/enviar-cocina', autorizarPermiso(P_TOMAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const comanda = await prisma.restaurante_comandas.findFirst({
      where: { id, empresaId },
      include: { mesa: true },
    });
    if (!comanda) return res.status(404).json({ success: false, mensaje: 'Comanda no encontrada' });
    if (comanda.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, mensaje: 'Esta comanda ya está cerrada' });
    }

    const items = parseItems(comanda);
    const nuevos = items.filter((it) => !it.enviadoCocina);
    if (nuevos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay ítems nuevos para enviar a cocina' });
    }

    const ahora = new Date();
    const itemsActualizados = items.map((it) => (
      it.enviadoCocina ? it : { ...it, enviadoCocina: true, enviadoCocinaEn: ahora }
    ));
    await prisma.restaurante_comandas.update({ where: { id }, data: { items: itemsActualizados } });

    // Imprimir — best effort: si falla la impresora, la comanda ya quedó
    // marcada como enviada (el mesero sigue tomando pedidos), pero se avisa
    // del fallo para que avise a cocina de otra forma.
    let impreso = false;
    let mensajeImpresion = null;
    // motivo distingue "no hay impresora configurada" (esperado, no es un
    // error — el pedido igual queda guardado y marcado como enviado) de un
    // fallo real de conexión con la impresora (sí hay que avisarlo como error).
    let motivo = 'OK';
    try {
      const cfg = req.configuracionSistema;
      const ip = cfg?.impresoraCocinaHabilitada ? cfg.impresoraCocinaIp : null;
      if (ip) {
        const buffer = generarTicketCocina(comanda.mesa, nuevos, {
          ancho: cfg.impresoraAncho || 80,
          numeroComensales: comanda.numeroComensales,
          mesero: req.usuario.nombre,
        });
        await imprimirBuffer(ip, cfg.impresoraCocinaPuerto || 9100, buffer);
        impreso = true;
      } else {
        motivo = 'NO_CONFIGURADA';
        mensajeImpresion = 'Pedido guardado. No tienes una impresora de cocina configurada — avisa a cocina de otra forma.';
      }
    } catch (errImpresion) {
      motivo = 'ERROR_IMPRESION';
      mensajeImpresion = `Pedido guardado, pero no se pudo imprimir: ${errImpresion.message}`;
    }

    res.json({
      success: true,
      impreso,
      motivo,
      mensaje: impreso ? `${nuevos.length} ítem(s) enviados a cocina` : mensajeImpresion,
      data: { items: itemsActualizados },
    });
  } catch (error) {
    console.error('POST /mesas/comandas/:id/enviar-cocina:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo enviar a cocina' });
  }
});

// GET /api/mesas/cocina/pendientes — cola de cocina: ítems ya enviados y aún
// no marcados como listos, de todas las comandas abiertas, más antiguos
// primero. Complementa (no reemplaza) el ticket ESC/POS impreso — pensada
// para el rol "cocina", que hoy no tiene ninguna pantalla propia.
router.get('/cocina/pendientes', autorizarPermiso(P_COCINA), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const comandas = await prisma.restaurante_comandas.findMany({
      where: { empresaId, estado: 'ABIERTA' },
      include: { mesa: true },
    });

    const pendientes = [];
    for (const c of comandas) {
      for (const it of parseItems(c)) {
        if (it.enviadoCocina && !it.listoCocina) {
          pendientes.push({
            comandaId: c.id,
            mesaId: c.mesaId,
            mesaNombre: c.mesa.nombre,
            codigoPrincipal: it.codigoPrincipal,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            nota: it.nota,
            enviadoCocinaEn: it.enviadoCocinaEn,
          });
        }
      }
    }
    pendientes.sort((a, b) => new Date(a.enviadoCocinaEn) - new Date(b.enviadoCocinaEn));

    res.json({ success: true, data: pendientes });
  } catch (error) {
    console.error('GET /mesas/cocina/pendientes:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener la cola de cocina' });
  }
});

// POST /api/mesas/comandas/:id/items/listo — marca un ítem como listo.
// Identifica el ítem por (codigoPrincipal, nota) — mismo criterio de
// identidad que ya usa PUT /comandas/:id para no depender del índice del
// arreglo, que puede correrse si el mesero edita la comanda al mismo tiempo.
router.post('/comandas/:id/items/listo', autorizarPermiso(P_COCINA), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    const { codigoPrincipal, nota } = req.body || {};

    const comanda = await prisma.restaurante_comandas.findFirst({ where: { id, empresaId } });
    if (!comanda) return res.status(404).json({ success: false, mensaje: 'Comanda no encontrada' });
    if (comanda.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, mensaje: 'Esta comanda ya está cerrada' });
    }

    const items = parseItems(comanda);
    const notaBuscada = nota?.trim() || null;
    const idx = items.findIndex((it) => it.codigoPrincipal === codigoPrincipal && (it.nota || null) === notaBuscada);
    if (idx === -1) return res.status(404).json({ success: false, mensaje: 'Ítem no encontrado en la comanda' });

    items[idx] = { ...items[idx], listoCocina: true, listoCocinaEn: new Date() };
    await prisma.restaurante_comandas.update({ where: { id }, data: { items } });

    res.json({ success: true, data: { items } });
  } catch (error) {
    console.error('POST /mesas/comandas/:id/items/listo:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo marcar el ítem como listo' });
  }
});

// POST /api/mesas/comandas/:id/cerrar — enlaza la factura/nota de venta ya
// creada (por el POS reutilizado) y, si cubre TODOS los ítems pendientes,
// libera la mesa. Cuentas separadas: `indices` (opcional) limita el cobro a
// un subconjunto de ítems (por posición en el arreglo, tal como lo ve el
// cajero al armar esa cuenta) — los demás quedan pendientes en la MISMA
// comanda para cobrarse después con otro documento. Sin `indices`, cobra
// todos los ítems aún no facturados (comportamiento de siempre).
router.post('/comandas/:id/cerrar', autorizarPermiso(P_COBRAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    const { tipo, documentoId, indices } = req.body || {};

    if (!['factura', 'nota_venta'].includes(tipo) || !documentoId) {
      return res.status(400).json({ success: false, mensaje: 'tipo y documentoId son requeridos' });
    }

    const comanda = await prisma.restaurante_comandas.findFirst({ where: { id, empresaId } });
    if (!comanda) return res.status(404).json({ success: false, mensaje: 'Comanda no encontrada' });
    if (comanda.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, mensaje: 'Esta comanda ya está cerrada' });
    }

    // Verificar que el documento exista y pertenezca a esta empresa antes de enlazarlo.
    const docId = parseInt(documentoId, 10);
    const doc = tipo === 'factura'
      ? await prisma.facturas.findFirst({ where: { id: docId, empresaId } })
      : await prisma.notas_venta.findFirst({ where: { id: docId, empresaId } });
    if (!doc) return res.status(404).json({ success: false, mensaje: 'El documento indicado no existe' });

    const items = parseItems(comanda);
    const pendientesIdx = items.reduce((acc, it, i) => { if (!it.facturado) acc.push(i); return acc; }, []);
    if (pendientesIdx.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Todos los ítems de esta comanda ya están facturados' });
    }

    let indicesACobrar = pendientesIdx;
    if (Array.isArray(indices) && indices.length > 0) {
      const invalidos = indices.filter((i) => !pendientesIdx.includes(i));
      if (invalidos.length > 0) {
        return res.status(400).json({ success: false, mensaje: 'Alguno de los ítems seleccionados ya fue facturado o no existe' });
      }
      indicesACobrar = indices;
    }

    const ahora = new Date();
    const itemsActualizados = items.map((it, i) => (
      indicesACobrar.includes(i)
        ? { ...it, facturado: true, facturadoEn: ahora, documentoTipo: tipo, documentoId: docId }
        : it
    ));
    const quedanPendientes = itemsActualizados.some((it) => !it.facturado);

    const resultado = await prisma.$transaction(async (tx) => {
      const actualizada = await tx.restaurante_comandas.update({
        where: { id },
        data: quedanPendientes
          ? { items: itemsActualizados }
          : {
              items: itemsActualizados,
              estado: 'CERRADA',
              cerradaEn: ahora,
              // Con un solo documento (caso normal) queda enlazado aquí para
              // consultas rápidas; en una cuenta dividida en varios
              // documentos, este campo queda con el ÚLTIMO que la cerró — el
              // detalle completo de qué pagó cada ítem vive en items[].
              facturaId: tipo === 'factura' ? docId : null,
              notaVentaId: tipo === 'nota_venta' ? docId : null,
            },
      });
      if (!quedanPendientes) {
        await tx.restaurante_mesas.update({ where: { id: comanda.mesaId }, data: { estado: 'LIBRE' } });
      }
      return actualizada;
    });

    const totalRestante = calcularTotales(itemsActualizados.filter((it) => !it.facturado)).total;
    res.json({
      success: true,
      data: { ...resultado, items: itemsActualizados },
      mesaLiberada: !quedanPendientes,
      totalRestante,
      mensaje: quedanPendientes
        ? `Cobrado — quedan $${totalRestante.toFixed(2)} pendientes en la mesa`
        : 'Mesa cobrada y liberada',
    });
  } catch (error) {
    console.error('POST /mesas/comandas/:id/cerrar:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cerrar la comanda' });
  }
});

// POST /api/mesas/comandas/:id/anular — cierra sin cobrar (mesa se va sin consumir, error, etc.)
router.post('/comandas/:id/anular', autorizarPermiso(P_COBRAR), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);
    const { motivo } = req.body || {};

    const comanda = await prisma.restaurante_comandas.findFirst({ where: { id, empresaId } });
    if (!comanda) return res.status(404).json({ success: false, mensaje: 'Comanda no encontrada' });
    if (comanda.estado !== 'ABIERTA') {
      return res.status(400).json({ success: false, mensaje: 'Esta comanda ya está cerrada' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.restaurante_comandas.update({
        where: { id },
        data: { estado: 'ANULADA', cerradaEn: new Date(), motivoAnulacion: motivo?.trim() || null },
      });
      await tx.restaurante_mesas.update({ where: { id: comanda.mesaId }, data: { estado: 'LIBRE' } });
    });

    res.json({ success: true, mensaje: 'Comanda anulada y mesa liberada' });
  } catch (error) {
    console.error('POST /mesas/comandas/:id/anular:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo anular la comanda' });
  }
});

// ─── REPORTES GERENCIALES ───────────────────────────────────────────────────

const P_REPORTES = ['mesas.gestionar', 'mesas.cobrar'];

function _rangoFechas(query) {
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const desde = query.desde ? new Date(query.desde) : inicioMes;
  const hasta = query.hasta ? new Date(query.hasta) : new Date();
  hasta.setHours(23, 59, 59, 999);
  return { desde, hasta };
}

// GET /api/mesas/reportes/ventas?desde=&hasta=&agruparPor=mesa|mesero|hora
// Ventas de comandas CERRADAS, recalculadas desde los ítems (no desde
// facturaId/notaVentaId, que en una cuenta dividida por ítems solo guarda el
// ÚLTIMO documento que la cerró) — así el reporte cuadra sin importar si el
// cobro fue de una vez o dividido.
router.get('/reportes/ventas', autorizarPermiso(P_REPORTES), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const agruparPor = ['mesa', 'mesero', 'hora'].includes(req.query.agruparPor) ? req.query.agruparPor : 'mesa';
    const { desde, hasta } = _rangoFechas(req.query);

    const comandas = await prisma.restaurante_comandas.findMany({
      where: { empresaId, estado: 'CERRADA', cerradaEn: { gte: desde, lte: hasta } },
      include: { mesa: { select: { nombre: true } }, mesero: { select: { id: true, nombre: true } } },
    });

    const grupos = new Map();
    for (const c of comandas) {
      const totales = calcularTotales(parseItems(c));
      let clave, etiqueta;
      if (agruparPor === 'mesero') {
        clave = c.meseroId || 0;
        etiqueta = c.mesero?.nombre || 'Sin asignar';
      } else if (agruparPor === 'hora') {
        const hora = c.cerradaEn ? new Date(c.cerradaEn).getHours() : 0;
        clave = hora;
        etiqueta = `${String(hora).padStart(2, '0')}:00 - ${String((hora + 1) % 24).padStart(2, '0')}:00`;
      } else {
        clave = c.mesaId;
        etiqueta = c.mesa?.nombre || `Mesa ${c.mesaId}`;
      }
      const g = grupos.get(clave) || { etiqueta, cantidadComandas: 0, subtotal: 0, totalIva: 0, total: 0 };
      g.cantidadComandas += 1;
      g.subtotal += totales.subtotal;
      g.totalIva += totales.totalIva;
      g.total += totales.total;
      grupos.set(clave, g);
    }

    const data = [...grupos.entries()]
      .map(([clave, g]) => ({
        clave,
        ...g,
        subtotal: Number(g.subtotal.toFixed(2)),
        totalIva: Number(g.totalIva.toFixed(2)),
        total: Number(g.total.toFixed(2)),
      }))
      .sort((a, b) => (agruparPor === 'hora' ? a.clave - b.clave : b.total - a.total));

    const totalGeneral = Number(data.reduce((acc, g) => acc + g.total, 0).toFixed(2));
    res.json({ success: true, data, totalGeneral, cantidadComandas: comandas.length, agruparPor, desde, hasta });
  } catch (error) {
    console.error('GET /mesas/reportes/ventas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte de ventas' });
  }
});

// GET /api/mesas/reportes/punto-equilibrio?desde=&hasta=
// Punto de equilibrio mensual: costosFijosMensuales (configurado por el
// dueño) / margen de contribución (1 - costo variable como % de ventas,
// calculado con costoUnitario de cada producto vendido en el período). No
// es contabilidad de costos completa (no reparte costos fijos indirectos
// por producto) — es la estimación estándar de punto de equilibrio en
// dólares de venta mensual que necesita el negocio para no perder.
router.get('/reportes/punto-equilibrio', autorizarPermiso(P_REPORTES), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { desde, hasta } = _rangoFechas(req.query);

    const config = await prisma.configuracion_sistema.findUnique({ where: { empresaId }, select: { costosFijosMensuales: true } });
    const costosFijosMensuales = Number(config?.costosFijosMensuales || 0);

    const comandas = await prisma.restaurante_comandas.findMany({
      where: { empresaId, estado: 'CERRADA', cerradaEn: { gte: desde, lte: hasta } },
      select: { items: true },
    });
    const todosLosItems = comandas.flatMap((c) => parseItems(c));
    const codigos = [...new Set(todosLosItems.map((it) => it.codigoPrincipal).filter(Boolean))];
    const productos = await prisma.productos_servicios.findMany({
      where: { empresaId, codigoPrincipal: { in: codigos } },
      select: { codigoPrincipal: true, costoUnitario: true },
    });
    const costoPorCodigo = new Map(productos.map((p) => [p.codigoPrincipal, Number(p.costoUnitario || 0)]));

    let ventasNetas = 0;
    let costoVariableTotal = 0;
    for (const it of todosLosItems) {
      const cant = Number(it.cantidad) || 0;
      ventasNetas += cant * (Number(it.precioUnitario) || 0);
      costoVariableTotal += cant * (costoPorCodigo.get(it.codigoPrincipal) || 0);
    }

    if (!costosFijosMensuales) {
      return res.json({
        success: true,
        configurado: false,
        mensaje: 'Configura tus costos fijos mensuales (arriendo, sueldos administrativos, servicios) para calcular el punto de equilibrio.',
      });
    }
    if (ventasNetas <= 0) {
      return res.json({
        success: true,
        configurado: true,
        costosFijosMensuales,
        mensaje: 'No hay ventas en el período seleccionado para estimar el costo variable.',
      });
    }

    const ratioCostoVariable = Number((costoVariableTotal / ventasNetas).toFixed(4));
    const margenContribucion = Number((1 - ratioCostoVariable).toFixed(4));
    const ticketPromedio = comandas.length > 0 ? Number((ventasNetas / comandas.length).toFixed(2)) : 0;

    if (margenContribucion <= 0) {
      return res.json({
        success: true,
        configurado: true,
        costosFijosMensuales,
        ratioCostoVariable,
        margenContribucion,
        mensaje: 'El costo variable iguala o supera el precio de venta en este período — revisa tus precios o costos antes de fiarte del punto de equilibrio.',
      });
    }

    const puntoEquilibrioVentas = Number((costosFijosMensuales / margenContribucion).toFixed(2));
    const puntoEquilibrioComandas = ticketPromedio > 0 ? Math.ceil(puntoEquilibrioVentas / ticketPromedio) : null;

    res.json({
      success: true,
      configurado: true,
      costosFijosMensuales,
      ratioCostoVariable,
      margenContribucion,
      ticketPromedio,
      puntoEquilibrioVentas,
      puntoEquilibrioComandas,
      ventasNetasPeriodo: Number(ventasNetas.toFixed(2)),
      desde, hasta,
    });
  } catch (error) {
    console.error('GET /mesas/reportes/punto-equilibrio:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo calcular el punto de equilibrio' });
  }
});

module.exports = router;
