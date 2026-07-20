const express = require('express');
const multer  = require('multer');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { requiereModulo } = require('../middleware/modulos');
const { soloFull } = require('../middleware/edition');
const {
  consultarContribuyenteSri,
  verificarExistenciaContribuyenteSri,
  parsearContribuyenteSri,
  consultarCatastroLocal,
} = require('../utils/sriContribuyente');
const {
  parsearBuffer,
  parsearProveedores,
  generarPlantillaProveedores,
} = require('../utils/importarExcel');
const { upsertDirectorio } = require('../utils/directorioGlobal');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function limpiarTexto(valor) {
  return String(valor || '').trim();
}

function mapProveedor(proveedor) {
  if (!proveedor) return proveedor;
  const comprasCount = proveedor._count?.compras ?? proveedor.comprasCount ?? 0;
  return {
    ...proveedor,
    comprasCount,
    _count: undefined,
  };
}

router.use(proteger);
router.use(requiereModulo('comprasHabilitadas'));
router.use(autorizarPermiso('compras.gestionar'));

router.get('/', async (req, res) => {
  try {
    const { q, ciudad, provincia, page = 1, limit = 50 } = req.query;
    const take = parseInt(limit, 10) || 50;
    const skip = ((parseInt(page, 10) || 1) - 1) * take;

    const where = {
      empresaId: req.empresa.id,
      ...(q ? {
        OR: [
          { identificacion: { contains: q, mode: 'insensitive' } },
          { razonSocial: { contains: q, mode: 'insensitive' } },
          { nombreComercial: { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
      ...(ciudad ? { ciudad: { contains: ciudad, mode: 'insensitive' } } : {}),
      ...(provincia ? { provincia: { contains: provincia, mode: 'insensitive' } } : {}),
    };

    const [proveedores, total] = await Promise.all([
      prisma.proveedores.findMany({
        where,
        orderBy: { razonSocial: 'asc' },
        skip,
        take,
        include: {
          _count: {
            select: { compras: true },
          },
        },
      }),
      prisma.proveedores.count({ where }),
    ]);

    res.json({
      success: true,
      data: proveedores.map(mapProveedor),
      total,
    });
  } catch (error) {
    console.error('Error al listar proveedores:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar proveedores' });
  }
});

router.get('/buscar', async (req, res) => {
  try {
    const q = limpiarTexto(req.query.q);
    if (q.length < 2) return res.json({ success: true, data: [] });

    const proveedores = await prisma.proveedores.findMany({
      where: {
        empresaId: req.empresa.id,
        activo: true,
        OR: [
          { identificacion: { contains: q, mode: 'insensitive' } },
          { razonSocial: { contains: q, mode: 'insensitive' } },
          { nombreComercial: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { razonSocial: 'asc' },
      take: 10,
    });

    res.json({ success: true, data: proveedores });
  } catch (error) {
    console.error('Error al buscar proveedores:', error);
    res.status(500).json({ success: false, mensaje: 'Error al buscar proveedores' });
  }
});

router.get('/sri/:identificacion', async (req, res) => {
  try {
    const id = limpiarTexto(req.params.identificacion);
    if (!/^\d{10}$/.test(id) && !/^\d{13}$/.test(id)) {
      return res.status(400).json({ success: false, mensaje: 'Identificación inválida (10 dígitos cédula, 13 RUC)' });
    }

    const existente = await prisma.proveedores.findFirst({
      where: {
        empresaId: req.empresa.id,
        identificacion: id,
      },
    });
    if (existente) {
      return res.json({ success: true, fuente: 'bd', data: existente });
    }

    const catastroLocal = await consultarCatastroLocal(id);
    if (catastroLocal) {
      const proveedor = await prisma.proveedores.create({
        data: {
          empresaId: req.empresa.id,
          tipoIdentificacion: catastroLocal.tipoIdentificacion,
          identificacion: id,
          razonSocial: catastroLocal.razonSocial,
          nombreComercial: catastroLocal.nombreComercial,
          direccion: null,
          email: null,
          telefono: null,
        },
      });
      return res.json({
        success: true,
        fuente: 'catastro-local',
        estadoSRI: catastroLocal.estado,
        data: proveedor,
      });
    }

    const rucConsulta = id.length === 10 ? `${id}001` : id;
    const datosSRI = await consultarContribuyenteSri(rucConsulta);
    const parsed = parsearContribuyenteSri(datosSRI, id);

    if (parsed) {
      const proveedor = await prisma.proveedores.create({
        data: {
          empresaId: req.empresa.id,
          tipoIdentificacion: parsed.tipoIdentificacion,
          identificacion: id,
          razonSocial: parsed.razonSocial,
          nombreComercial: parsed.nombreComercial,
          direccion: parsed.direccion,
          email: parsed.email,
          telefono: parsed.telefono,
        },
      });
      return res.json({ success: true, fuente: 'sri', data: proveedor, estadoSRI: parsed.estado });
    }

    const existeEnSri = await verificarExistenciaContribuyenteSri(rucConsulta);
    const empresaConocida = id.length === 13
      ? await prisma.empresas.findFirst({
          where: { ruc: id, activo: true },
          select: { razonSocial: true, nombreComercial: true, direccion: true, email: true, telefono: true },
        })
      : null;

    if (empresaConocida) {
      const proveedor = await prisma.proveedores.create({
        data: {
          empresaId: req.empresa.id,
          tipoIdentificacion: '04',
          identificacion: id,
          razonSocial: empresaConocida.razonSocial,
          nombreComercial: empresaConocida.nombreComercial || null,
          direccion: empresaConocida.direccion || null,
          email: empresaConocida.email || null,
          telefono: empresaConocida.telefono || null,
        },
      });
      return res.json({
        success: true,
        fuente: 'empresa-local',
        data: proveedor,
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
          nombreComercial: '',
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

    return res.json({
      success: true,
      encontrado: false,
      servicioNoDisponible: true,
      mensaje: 'No fue posible consultar el SRI en este momento. Ingresa los datos manualmente.',
    });
  } catch (error) {
    console.error('Error consulta SRI proveedor:', error?.message, error?.code);
    res.status(500).json({
      success: false,
      mensaje: 'Error al consultar el SRI',
      debug: process.env.NODE_ENV !== 'production' ? (error?.message || String(error)) : undefined,
    });
  }
});

// GET /api/proveedores/plantilla-excel
router.get('/plantilla-excel', proteger, (req, res) => {
  const buffer = generarPlantillaProveedores();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla_proveedores.xlsx"');
  res.send(buffer);
});

router.get('/:id', async (req, res) => {
  try {
    const proveedor = await prisma.proveedores.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
      include: {
        _count: {
          select: { compras: true },
        },
      },
    });

    if (!proveedor) {
      return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado' });
    }

    res.json({ success: true, data: mapProveedor(proveedor) });
  } catch (error) {
    console.error('Error al obtener proveedor:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener proveedor' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      tipoIdentificacion,
      identificacion,
      razonSocial,
      nombreComercial,
      direccion,
      ciudad,
      provincia,
      email,
      telefono,
      contactoNombre,
      banco,
      cuentaBancaria,
      observaciones,
    } = req.body || {};

    if (!limpiarTexto(tipoIdentificacion) || !limpiarTexto(identificacion) || !limpiarTexto(razonSocial)) {
      return res.status(400).json({
        success: false,
        mensaje: 'tipoIdentificacion, identificacion y razonSocial son requeridos',
      });
    }

    const proveedor = await prisma.proveedores.create({
      data: {
        empresaId: req.empresa.id,
        tipoIdentificacion: limpiarTexto(tipoIdentificacion),
        identificacion: limpiarTexto(identificacion),
        razonSocial: limpiarTexto(razonSocial),
        nombreComercial: limpiarTexto(nombreComercial) || null,
        direccion: limpiarTexto(direccion) || null,
        ciudad: limpiarTexto(ciudad) || null,
        provincia: limpiarTexto(provincia) || null,
        email: limpiarTexto(email).toLowerCase() || null,
        telefono: limpiarTexto(telefono) || null,
        contactoNombre: limpiarTexto(contactoNombre) || null,
        banco: limpiarTexto(banco) || null,
        cuentaBancaria: limpiarTexto(cuentaBancaria) || null,
        observaciones: limpiarTexto(observaciones) || null,
      },
    });

    upsertDirectorio({
      identificacion:     proveedor.identificacion,
      tipoIdentificacion: proveedor.tipoIdentificacion,
      razonSocial:        proveedor.razonSocial,
      nombreComercial:    proveedor.nombreComercial,
      direccion:          proveedor.direccion,
      email:              proveedor.email,
      telefono:           proveedor.telefono,
      fuente:             'manual',
    });

    res.status(201).json({ success: true, data: proveedor });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: 'Ya existe un proveedor con esa identificación' });
    }
    console.error('Error al crear proveedor:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear proveedor' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const proveedorActual = await prisma.proveedores.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
    });

    if (!proveedorActual) {
      return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado' });
    }

    const {
      razonSocial,
      nombreComercial,
      direccion,
      ciudad,
      provincia,
      email,
      telefono,
      contactoNombre,
      banco,
      cuentaBancaria,
      observaciones,
      activo,
    } = req.body || {};

    const data = {};
    if (razonSocial !== undefined) data.razonSocial = limpiarTexto(razonSocial);
    if (nombreComercial !== undefined) data.nombreComercial = limpiarTexto(nombreComercial) || null;
    if (direccion !== undefined) data.direccion = limpiarTexto(direccion) || null;
    if (ciudad !== undefined) data.ciudad = limpiarTexto(ciudad) || null;
    if (provincia !== undefined) data.provincia = limpiarTexto(provincia) || null;
    if (email !== undefined) data.email = limpiarTexto(email).toLowerCase() || null;
    if (telefono !== undefined) data.telefono = limpiarTexto(telefono) || null;
    if (contactoNombre !== undefined) data.contactoNombre = limpiarTexto(contactoNombre) || null;
    if (banco !== undefined) data.banco = limpiarTexto(banco) || null;
    if (cuentaBancaria !== undefined) data.cuentaBancaria = limpiarTexto(cuentaBancaria) || null;
    if (observaciones !== undefined) data.observaciones = limpiarTexto(observaciones) || null;
    if (activo !== undefined) data.activo = Boolean(activo);

    const proveedor = await prisma.proveedores.update({
      where: { id: proveedorActual.id },
      data,
    });

    res.json({ success: true, data: proveedor });
  } catch (error) {
    console.error('Error al actualizar proveedor:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar proveedor' });
  }
});

router.get('/:id/compras', async (req, res) => {
  try {
    const proveedorId = parseInt(req.params.id, 10);
    const proveedor = await prisma.proveedores.findFirst({
      where: { id: proveedorId, empresaId: req.empresa.id },
      select: { id: true },
    });
    if (!proveedor) return res.status(404).json({ success: false, mensaje: 'Proveedor no encontrado' });

    const compras = await prisma.facturas_compra.findMany({
      where: { proveedorId, empresaId: req.empresa.id },
      orderBy: { fechaEmision: 'desc' },
      take: 20,
      select: {
        id: true,
        numero: true,
        fechaEmision: true,
        importeTotal: true,
        estado: true,
        anulada: true,
      },
    });

    const resumen = await prisma.facturas_compra.aggregate({
      where: { proveedorId, empresaId: req.empresa.id, anulada: false },
      _sum: { importeTotal: true },
      _count: { id: true },
    });

    res.json({
      success: true,
      data: compras,
      totalCompras: resumen._count.id,
      montoTotal: Number(resumen._sum.importeTotal || 0),
    });
  } catch (error) {
    console.error('Error al obtener compras del proveedor:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener compras del proveedor' });
  }
});

// POST /api/proveedores/importar-excel — Medium/Pro (Lite es solo ingreso manual)
router.post('/importar-excel', proteger, soloFull, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });
    }

    const db = req.prisma;
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

    const parsed = parsearProveedores(rows);
    const validos  = parsed.filter((r) => r.estado === 'ok');
    const omitidos = parsed.filter((r) => r.estado === 'omitido');

    const resultados = [];

    for (const item of validos) {
      // Siempre enriquecer el directorio global
      upsertDirectorio({ ...item.data, fuente: 'importacion' });

      try {
        const existe = await db.proveedores.findFirst({
          where: { empresaId, identificacion: item.data.identificacion },
          select: { id: true },
        });

        if (existe) {
          resultados.push({ fila: item.fila, identificacion: item.data.identificacion, razonSocial: item.data.razonSocial, estado: 'omitido', motivo: 'Ya existe' });
          continue;
        }

        await db.proveedores.create({ data: { ...item.data, empresaId } });
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
    console.error('Error importar-excel proveedores:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar el archivo' });
  }
});

module.exports = router;
