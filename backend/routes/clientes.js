// ====================================
// CLIENTES / PROVEEDORES
// backend/routes/clientes.js
// Equivale a "pacientes" en SUJAM pero para contexto universal
// ====================================

const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger } = require('../middleware/auth');
const {
  consultarContribuyenteSri,
  verificarExistenciaContribuyenteSri,
  parsearContribuyenteSri,
  consultarCatastroLocal,
} = require('../utils/sriContribuyente');
const {
  parsearBuffer,
  parsearClientes,
  generarPlantillaClientes,
} = require('../utils/importarExcel');
const { upsertDirectorio } = require('../utils/directorioGlobal');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/clientes
router.get('/', proteger, async (req, res) => {
  try {
    const { q, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      empresaId: req.empresa.id,
      ...(q ? {
        OR: [
          { identificacion:  { contains: q, mode: 'insensitive' } },
          { razonSocial:     { contains: q, mode: 'insensitive' } },
          { nombreComercial: { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [clientes, total] = await Promise.all([
      prisma.clientes.findMany({
        where,
        orderBy: { razonSocial: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.clientes.count({ where }),
    ]);

    res.json({ success: true, data: clientes, total });
  } catch (error) {
    console.error('Error al listar clientes:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar clientes' });
  }
});

// GET /api/clientes/buscar?q=texto  (autocomplete)
router.get('/buscar', proteger, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });

    const clientes = await prisma.clientes.findMany({
      where: {
        empresaId: req.empresa.id,
        activo: true,
        OR: [
          { identificacion:  { contains: q, mode: 'insensitive' } },
          { razonSocial:     { contains: q, mode: 'insensitive' } },
          { nombreComercial: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { razonSocial: 'asc' },
    });

    res.json({ success: true, data: clientes });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'Error en búsqueda' });
  }
});

// GET /api/clientes/sri/:identificacion
// Busca en BD; si no existe consulta SRI y guarda automáticamente
router.get('/sri/:identificacion', proteger, async (req, res) => {
  try {
    const { identificacion } = req.params;
    const id = identificacion.trim();

    // Validar formato: cédula (10) o RUC (13)
    if (!/^\d{10}$/.test(id) && !/^\d{13}$/.test(id)) {
      return res.status(400).json({ success: false, mensaje: 'Identificación inválida (10 dígitos cédula, 13 RUC)' });
    }

    // 1. Buscar en BD primero
    const existente = await prisma.clientes.findFirst({
      where: {
        empresaId: req.empresa.id,
        identificacion: id,
      },
    });
    if (existente) {
      return res.json({ success: true, fuente: 'bd', data: existente });
    }

    // 2. Catastro local (BD PostgreSQL cargada desde CSVs del SRI)
    //    Funciona 100% offline y es instantáneo.
    const catastroLocal = await consultarCatastroLocal(id);
    if (catastroLocal) {
      const cliente = await prisma.clientes.create({
        data: {
          empresaId:          req.empresa.id,
          tipoIdentificacion: catastroLocal.tipoIdentificacion,
          identificacion:     id,
          razonSocial:        catastroLocal.razonSocial,
          nombreComercial:    catastroLocal.nombreComercial,
          direccion:          catastroLocal.direccion || null,
          email:              catastroLocal.email || null,
          telefono:           catastroLocal.telefono || null,
        },
      });
      upsertDirectorio({
        identificacion:     id,
        tipoIdentificacion: catastroLocal.tipoIdentificacion,
        razonSocial:        catastroLocal.razonSocial,
        nombreComercial:    catastroLocal.nombreComercial,
        fuente:             catastroLocal.fuenteLocal ? 'sri_csv' : 'manual',
      });
      return res.json({
        success: true,
        fuente:    'catastro-local',
        estadoSRI: catastroLocal.estado,
        data:      cliente,
      });
    }

    // 3. API online del SRI (fallback si no está en el catastro local)
    const rucConsulta = id.length === 10 ? `${id}001` : id;
    const datosSRI    = await consultarContribuyenteSri(rucConsulta);
    const parsed      = parsearContribuyenteSri(datosSRI, id);

    if (parsed) {
      const cliente = await prisma.clientes.create({
        data: {
          empresaId:          req.empresa.id,
          tipoIdentificacion: parsed.tipoIdentificacion,
          identificacion:     id,
          razonSocial:        parsed.razonSocial,
          nombreComercial:    parsed.nombreComercial,
          direccion:          parsed.direccion,
          email:              parsed.email,
          telefono:           parsed.telefono,
        },
      });
      upsertDirectorio({
        identificacion:     id,
        tipoIdentificacion: parsed.tipoIdentificacion,
        razonSocial:        parsed.razonSocial,
        nombreComercial:    parsed.nombreComercial,
        direccion:          parsed.direccion,
        email:              parsed.email,
        telefono:           parsed.telefono,
        fuente:             'sri_api',
      });
      return res.json({ success: true, fuente: 'sri', data: cliente, estadoSRI: parsed.estado });
    }

    // 4. Verificar existencia en SRI (solo confirma si el RUC es válido)
    const existeEnSri = await verificarExistenciaContribuyenteSri(rucConsulta);

    // Verificar también si el RUC corresponde a otra empresa registrada en el sistema
    const empresaConocida = id.length === 13
      ? await prisma.empresas.findFirst({
          where: { ruc: id, activo: true },
          select: { razonSocial: true, nombreComercial: true, direccion: true, email: true, telefono: true },
        })
      : null;

    if (empresaConocida) {
      const cliente = await prisma.clientes.create({
        data: {
          empresaId:          req.empresa.id,
          tipoIdentificacion: '04',
          identificacion:     id,
          razonSocial:        empresaConocida.razonSocial,
          nombreComercial:    empresaConocida.nombreComercial || null,
          direccion:          empresaConocida.direccion || null,
          email:              empresaConocida.email || null,
          telefono:           empresaConocida.telefono || null,
        },
      });
      upsertDirectorio({
        identificacion:     id,
        tipoIdentificacion: '04',
        razonSocial:        empresaConocida.razonSocial,
        nombreComercial:    empresaConocida.nombreComercial,
        direccion:          empresaConocida.direccion,
        email:              empresaConocida.email,
        telefono:           empresaConocida.telefono,
        fuente:             'manual',
      });
      return res.json({
        success: true,
        fuente: 'empresa-local',
        data:   cliente,
        mensaje: 'Se encontraron datos locales para esta identificación',
      });
    }

    if (existeEnSri === true) {
      return res.json({
        success: true,
        encontrado: true,
        requiereDatosManuales: true,
        fuente: 'sri-validacion',
        mensaje: 'Identificación válida en el SRI — completa los datos manualmente.',
        data: {
          id: null,
          tipoIdentificacion: id.length === 10 ? '05' : '04',
          identificacion: id,
          razonSocial: '',
          direccion: '',
          email: '',
          telefono: '',
        },
      });
    }

    if (existeEnSri === false) {
      return res.json({
        success: true,
        encontrado: false,
        mensaje: 'No se encontró información en el SRI para esta identificación',
      });
    }

    // SRI completamente inaccesible
    return res.json({
      success: true,
      encontrado: false,
      servicioNoDisponible: true,
      mensaje: 'No fue posible consultar el SRI en este momento. Ingresa los datos manualmente.',
    });
  } catch (error) {
    console.error('Error consulta SRI:', error?.message, error?.code, error?.stack?.split('\n').slice(0, 3).join(' | '));
    res.status(500).json({
      success: false,
      mensaje: 'Error al consultar el SRI',
      debug: process.env.NODE_ENV !== 'production' ? (error?.message || String(error)) : undefined,
    });
  }
});

// GET /api/clientes/plantilla-excel
router.get('/plantilla-excel', proteger, (req, res) => {
  const buffer = generarPlantillaClientes();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_clientes.xlsx"');
  res.send(buffer);
});

// GET /api/clientes/:id
router.get('/:id', proteger, async (req, res) => {
  try {
    const cliente = await prisma.clientes.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!cliente) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });
    res.json({ success: true, data: cliente });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener cliente' });
  }
});

// POST /api/clientes
router.post('/', proteger, async (req, res) => {
  try {
    const { tipoIdentificacion, identificacion, razonSocial, nombreComercial, direccion, email, telefono } = req.body;

    if (!tipoIdentificacion || !identificacion || !razonSocial) {
      return res.status(400).json({
        success: false,
        mensaje: 'tipoIdentificacion, identificacion y razonSocial son requeridos',
      });
    }

    const cliente = await prisma.clientes.create({
      data: {
        empresaId: req.empresa.id,
        tipoIdentificacion,
        identificacion: identificacion.trim(),
        razonSocial: razonSocial.trim(),
        nombreComercial: nombreComercial?.trim() || null,
        direccion: direccion?.trim() || null,
        email: email?.trim().toLowerCase() || null,
        telefono: telefono?.trim() || null,
      },
    });

    upsertDirectorio({
      identificacion:     cliente.identificacion,
      tipoIdentificacion: cliente.tipoIdentificacion,
      razonSocial:        cliente.razonSocial,
      nombreComercial:    cliente.nombreComercial,
      direccion:          cliente.direccion,
      email:              cliente.email,
      telefono:           cliente.telefono,
      fuente:             'manual',
    });

    res.status(201).json({ success: true, data: cliente });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: 'Ya existe un cliente con esa identificación' });
    }
    res.status(500).json({ success: false, mensaje: 'Error al crear cliente' });
  }
});

// PUT /api/clientes/:id
router.put('/:id', proteger, async (req, res) => {
  try {
    const { razonSocial, nombreComercial, direccion, email, telefono, activo } = req.body;
    const actual = await prisma.clientes.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado' });

    const data = {};
    if (razonSocial !== undefined)     data.razonSocial     = razonSocial;
    if (nombreComercial !== undefined) data.nombreComercial = nombreComercial;
    if (direccion !== undefined)       data.direccion       = direccion;
    if (email !== undefined)           data.email           = email?.toLowerCase();
    if (telefono !== undefined)        data.telefono        = telefono;
    if (activo !== undefined)          data.activo          = activo;

    const cliente = await prisma.clientes.update({
      where: { id: actual.id },
      data,
    });
    res.json({ success: true, data: cliente });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'Error al actualizar cliente' });
  }
});

// POST /api/clientes/importar-excel
router.post('/importar-excel', proteger, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });
    }

    const empresaId = req.empresa.id;
    let rows;
    try {
      rows = parsearBuffer(req.file.buffer);
    } catch {
      return res.status(400).json({ success: false, mensaje: 'El archivo no es un Excel válido (.xlsx o .xls)' });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'El archivo está vacío o no tiene datos' });
    }

    const parsed = parsearClientes(rows);
    const validos = parsed.filter((r) => r.estado === 'ok');
    const omitidos = parsed.filter((r) => r.estado === 'omitido');

    const resultados = [];

    for (const item of validos) {
      // Siempre enriquecer el directorio global, independientemente de si el
      // cliente ya existe en esta empresa o no.
      upsertDirectorio({ ...item.data, fuente: 'importacion' });

      try {
        const existe = await prisma.clientes.findFirst({
          where: { empresaId, identificacion: item.data.identificacion },
          select: { id: true },
        });

        if (existe) {
          resultados.push({ fila: item.fila, identificacion: item.data.identificacion, razonSocial: item.data.razonSocial, estado: 'omitido', motivo: 'Ya existe' });
          continue;
        }

        await prisma.clientes.create({ data: { ...item.data, empresaId } });
        resultados.push({ fila: item.fila, identificacion: item.data.identificacion, razonSocial: item.data.razonSocial, estado: 'creado' });
      } catch (err) {
        resultados.push({ fila: item.fila, identificacion: item.data.identificacion, razonSocial: item.data.razonSocial, estado: 'error', motivo: err.message });
      }
    }

    for (const om of omitidos) {
      resultados.push({ fila: om.fila, identificacion: om.id || '', estado: 'omitido', motivo: om.motivo });
    }

    resultados.sort((a, b) => a.fila - b.fila);

    res.json({
      success: true,
      resumen: {
        total: rows.length,
        creados: resultados.filter((r) => r.estado === 'creado').length,
        omitidos: resultados.filter((r) => r.estado === 'omitido').length,
        errores: resultados.filter((r) => r.estado === 'error').length,
      },
      resultados,
    });
  } catch (error) {
    console.error('Error importar-excel clientes:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar el archivo' });
  }
});

module.exports = router;
