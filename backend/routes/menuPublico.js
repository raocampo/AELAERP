// ====================================
// routes/menuPublico.js — AELA
// Menú digital por QR (módulo Mesas y Comandas) — SIN autenticación, para
// que cualquier cliente que escanee el QR de su mesa lo vea desde su
// celular sin necesitar cuenta ni login. GET es de SOLO LECTURA: no crea ni
// modifica nada — el pedido lo sigue tomando el mesero como siempre. La
// única excepción es POST /:empresaId/llamar-mesero (llamada de servicio),
// que sigue sin requerir sesión por el mismo motivo (el cliente no tiene
// cuenta) pero sí escribe una fila.
//
// El tenant se resuelve igual que cualquier otra ruta (X-Tenant-Slug vía
// resolverTenant en app.js, ya montado globalmente) — el frontend público
// pasa el slug explícito leído de la URL (/menu/:slug/:empresaId), NO del
// localStorage de sesión, para no interferir con una sesión de admin que
// pueda estar abierta en el mismo navegador (ver MenuPublico.jsx).
// ====================================
const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');

// GET /api/menu-publico/:empresaId
router.get('/:empresaId', async (req, res) => {
  try {
    const empresaId = parseInt(req.params.empresaId, 10);
    if (!empresaId) return res.status(400).json({ success: false, mensaje: 'empresaId inválido' });

    const db = req.prisma || prisma;

    // Sin req.empresa (no hay login) — el módulo se valida a mano contra el
    // empresaId de la URL, no con requiereModulo() que asume una sesión.
    const cfgSistema = await db.configuracion_sistema.findUnique({
      where: { empresaId },
      select: { restauranteHabilitado: true },
    });
    if (!cfgSistema?.restauranteHabilitado) {
      return res.status(404).json({ success: false, mensaje: 'Menú no disponible' });
    }

    const mesaId = parseInt(req.query.mesa, 10) || null;
    const [empresa, cfgSri, productos, mesa] = await Promise.all([
      db.empresas.findFirst({ where: { id: empresaId }, select: { id: true, razonSocial: true, nombreComercial: true } }),
      db.configuracion_sri.findFirst({ where: { empresaId }, select: { nombreComercial: true, logoUrl: true } }),
      db.productos_servicios.findMany({
        where: { empresaId, activo: true, visibleEnMenu: true },
        select: {
          id: true, nombre: true, precioUnitario: true, tarifaIva: true,
          categoriaMenu: true, descripcionMenu: true, imagenMenuUrl: true, ordenMenu: true,
        },
        orderBy: [{ categoriaMenu: 'asc' }, { ordenMenu: 'asc' }, { nombre: 'asc' }],
      }),
      mesaId
        ? db.restaurante_mesas.findFirst({ where: { id: mesaId, empresaId, activo: true }, select: { id: true, nombre: true } })
        : Promise.resolve(null),
    ]);

    if (!empresa) return res.status(404).json({ success: false, mensaje: 'Restaurante no encontrado' });

    // Agrupar por categoría en el servidor — el frontend solo pinta.
    const categorias = [];
    const porCategoria = new Map();
    for (const p of productos) {
      const nombreCat = p.categoriaMenu?.trim() || 'Otros';
      if (!porCategoria.has(nombreCat)) {
        const cat = { nombre: nombreCat, items: [] };
        porCategoria.set(nombreCat, cat);
        categorias.push(cat);
      }
      porCategoria.get(nombreCat).items.push({
        id: p.id,
        nombre: p.nombre,
        descripcion: p.descripcionMenu || null,
        imagenUrl: p.imagenMenuUrl || null,
        precio: Number(p.precioUnitario || 0),
      });
    }

    res.json({
      success: true,
      data: {
        restaurante: {
          nombre: cfgSri?.nombreComercial || empresa.nombreComercial || empresa.razonSocial,
          logoUrl: cfgSri?.logoUrl || null,
        },
        categorias,
        mesa: mesa || null,
      },
    });
  } catch (error) {
    console.error('GET /menu-publico/:empresaId:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar el menú' });
  }
});

// POST /api/menu-publico/:empresaId/llamar-mesero — el único punto de
// ESCRITURA de todo este archivo (ver comentario de cabecera: el resto es
// solo lectura). Sigue sin sesión — cualquiera con el QR de su mesa puede
// llamarlo, mismo modelo de confianza que tocar un timbre físico en la
// mesa. Idempotente contra spam: si ya hay una llamada PENDIENTE para esa
// mesa, no crea una segunda.
router.post('/:empresaId/llamar-mesero', async (req, res) => {
  try {
    const empresaId = parseInt(req.params.empresaId, 10);
    const mesaId = parseInt(req.body?.mesaId, 10);
    if (!empresaId || !mesaId) {
      return res.status(400).json({ success: false, mensaje: 'Faltan datos de la mesa' });
    }

    const db = req.prisma || prisma;
    const cfgSistema = await db.configuracion_sistema.findUnique({ where: { empresaId }, select: { restauranteHabilitado: true } });
    if (!cfgSistema?.restauranteHabilitado) {
      return res.status(404).json({ success: false, mensaje: 'Función no disponible' });
    }

    const mesa = await db.restaurante_mesas.findFirst({ where: { id: mesaId, empresaId, activo: true } });
    if (!mesa) return res.status(404).json({ success: false, mensaje: 'Mesa no encontrada' });

    const yaPendiente = await db.restaurante_llamadas.findFirst({ where: { empresaId, mesaId, estado: 'PENDIENTE' } });
    if (yaPendiente) {
      return res.json({ success: true, mensaje: 'Ya avisamos al mesero — está en camino' });
    }

    await db.restaurante_llamadas.create({ data: { empresaId, mesaId } });
    res.json({ success: true, mensaje: 'Mesero avisado' });
  } catch (error) {
    console.error('POST /menu-publico/:empresaId/llamar-mesero:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo avisar al mesero' });
  }
});

module.exports = router;
