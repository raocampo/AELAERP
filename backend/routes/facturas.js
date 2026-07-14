// ====================================
// RUTAS: FACTURACIÓN ELECTRÓNICA SRI — AELA
// backend/routes/facturas.js
// ====================================

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const prisma  = require('../config/prisma');
const sri     = require('../utils/sri');
const { registrarAuditoria } = require('../utils/auditoria');
const {
  crearAsientoFacturaAutorizada,
  crearAsientoCostoVentaFactura,
  crearAsientoNotaCreditoEmitida,
  crearAsientoReversoFacturaAnulada,
} = require('../utils/contabilidad');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { construirConfiguracionSriBase } = require('../utils/sriContribuyente');
const { siguienteSecuencial } = require('../utils/secuenciales');
const { registrarMovimientoCaja } = require('../utils/caja');
const { aplicarMovimientosVentaDesdeDetalles } = require('../utils/inventario');
const { esErrorConectividad } = require('../utils/colaSRI');
const { getCertBuffer, tieneCertificado, getCertInfo } = require('../utils/certUtils');
const { enviarDocumentoFiscal } = require('../utils/email');

// Aplicar autenticación JWT a todas las rutas
router.use(proteger);

// Detecta si un mensajesSri contiene el error 90 "LIMITE DE INTENTOS"
function tieneError90SRI(msj) {
  if (!msj) return false;
  const arr = msj.mensajes || msj.recepcion?.mensajes || [];
  if (!Array.isArray(arr)) return false;
  return arr.some(m => String(m.identificador) === '90' || String(m.mensaje || '').includes('LIMITE DE INTENTOS'));
}

const permitirConfigurarSri = autorizarPermiso('sri.configurar');
const permitirVerFacturacion = autorizarPermiso('facturacion.ver');
const permitirEmitirFacturacion = autorizarPermiso('facturacion.emitir');
const permitirAnularFacturacion = autorizarPermiso('facturacion.anular');
const permitirReportesTributarios = autorizarPermiso('tributario.reportes');

// ─── Carpetas necesarias ────────────────────────────────────────────────────
const DIR_FACTURAS      = path.join(__dirname, '..', 'uploads', 'facturas');
const DIR_CERTIFICADOS  = path.join(__dirname, '..', 'uploads', 'certificados');
const DIR_LOGOS         = path.join(__dirname, '..', 'uploads', 'logos');
[DIR_FACTURAS, DIR_CERTIFICADOS, DIR_LOGOS].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Multer para .p12 ───────────────────────────────────────────────────────
const storageCert = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DIR_CERTIFICADOS),
  filename:    (req, file, cb) => cb(null, `certificado-${Date.now()}.p12`),
});
const uploadCert = multer({
  storage: storageCert,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.p12', '.pfx'].includes(ext)) cb(null, true);
    else cb(new Error('Solo se aceptan archivos .p12 o .pfx'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ─── Multer para logo (memoria → base64 en BD, sin escribir a disco) ─────────
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) cb(null, true);
    else cb(new Error('Solo se aceptan imágenes (png, jpg, jpeg, gif, webp)'));
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

// ─── Helper: obtener configuración SRI activa ────────────────────────────────
// db opcional: pasa req.prisma en rutas con multer para evitar pérdida de AsyncLocalStorage
async function getConfigSRI(empresaId, db = prisma) {
  return db.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
}

async function getConfigSRIEditable(empresaId, db = prisma) {
  const existente = await getConfigSRI(empresaId, db);
  if (existente) return existente;

  const empresa = await db.empresas.findUnique({
    where: { id: empresaId },
  });
  if (!empresa) return null;

  return construirConfiguracionSriBase(empresa);
}

// ─── Helper: enriquecer/crear cliente con datos manuales de la factura ───────
// Llamado en background después de crear la factura. Garantiza que los datos
// que el usuario completó manualmente (email, teléfono, dirección) queden en
// la tabla clientes para futuras búsquedas, y que la factura quede vinculada
// aunque el clienteId no viniera del formulario (caso requiereDatosManuales).
async function enriquecerClienteDesdeFactura(empresaId, facturaId, datos) {
  const { clienteId, tipoIdentificacion, identificacion, razonSocial, email, telefono, direccion } = datos;

  // No aplica a Consumidor Final ni pasaportes sin RUC/cédula
  if (!identificacion || identificacion === '9999999999999' || tipoIdentificacion === '07') return;

  try {
    if (clienteId) {
      // Cliente ya existía: rellenar solo los campos que estén vacíos
      const existente = await prisma.clientes.findUnique({ where: { id: clienteId } });
      if (!existente) return;

      const update = {};
      if (!existente.email    && email)    update.email    = email;
      if (!existente.telefono && telefono) update.telefono = telefono;
      if (!existente.direccion&& direccion)update.direccion= direccion;

      if (Object.keys(update).length > 0) {
        await prisma.clientes.update({ where: { id: clienteId }, data: update });
      }
    } else {
      // Sin clienteId: buscar por identificación o crear nuevo
      const existente = await prisma.clientes.findFirst({
        where: { empresaId, identificacion },
      });

      let guardado;
      if (existente) {
        const update = {};
        if (!existente.email    && email)    update.email    = email;
        if (!existente.telefono && telefono) update.telefono = telefono;
        if (!existente.direccion&& direccion)update.direccion= direccion;
        if (Object.keys(update).length > 0) {
          await prisma.clientes.update({ where: { id: existente.id }, data: update });
        }
        guardado = existente;
      } else {
        guardado = await prisma.clientes.create({
          data: {
            empresaId,
            tipoIdentificacion,
            identificacion,
            razonSocial,
            email:    email    || null,
            telefono: telefono || null,
            direccion:direccion|| null,
          },
        });
      }

      // Vincular la factura al cliente recién creado/encontrado
      await prisma.facturas.update({
        where: { id: facturaId },
        data: { clienteId: guardado.id },
      });
    }
  } catch (err) {
    console.error('[Cliente] Error al enriquecer desde factura:', err?.message);
  }
}

// ─── Helper: ejecutar flujo SRI completo ────────────────────────────────────
async function procesarFacturaEnSRI(facturaId, xmlGenerado, config) {
  try {
    // Si usa token físico, el usuario firma manualmente — no procesar aquí
    if (config.tipoCertificado === 'token') {
      return; // Queda en PENDIENTE_FIRMA hasta que el usuario suba el XML firmado
    }
    // Leer certificado P12 (archivo en disco o base64 en BD)
    if (!tieneCertificado(config)) {
      console.error(`[SRI] Factura #${facturaId}: certificado P12 no disponible (archivo no existe y sin base64 en BD). Re-suba el certificado en Configuración SRI.`);
      return; // Queda en PENDIENTE_FIRMA
    }

    const p12Buffer = getCertBuffer(config);
    const claveP12  = config.claveCertificado || '';

    // Firmar
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, claveP12);
    await prisma.facturas.update({
      where: { id: facturaId },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    // Enviar al SRI
    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.facturas.update({
        where: { id: facturaId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    // Autorizar — el SRI necesita unos segundos para procesar tras la recepción.
    // Reintentar hasta 5 veces con pausa de 4 s entre intentos.
    const factura = await prisma.facturas.findUnique({ where: { id: facturaId } });
    let autorizacion = null;
    for (let intento = 0; intento < 5; intento++) {
      if (intento > 0) await new Promise(r => setTimeout(r, 4000));
      autorizacion = await sri.autorizarComprobanteSRI(factura.claveAcceso, config.ambiente);
      // Si hay resultado concluyente (autorizado o mensajes de error reales), salir del loop
      if (autorizacion.autorizado || (autorizacion.mensajes && autorizacion.mensajes.length > 0)) break;
    }

    if (autorizacion.autorizado) {
      // Generar RIDE PDF
      const pdfPath = path.join(DIR_FACTURAS, `factura-${facturaId}.pdf`);
      await sri.generarRIDEFactura(
        { ...factura, xmlAutorizado: autorizacion.xmlAutorizado },
        config,
        pdfPath
      );
      const pdfUrl = `/uploads/facturas/factura-${facturaId}.pdf`;

      await prisma.facturas.update({
        where: { id: facturaId },
        data: {
          estadoSri:         'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado,
          mensajesSri:        { autorizacion: autorizacion.estado },
          pdfUrl,
        },
      });

      try {
        await crearAsientoFacturaAutorizada({
          facturaId,
          usuarioId: factura.emisorId,
          fecha: factura.fechaEmision || new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento automático de factura:', contErr.message);
      }

      try {
        await crearAsientoCostoVentaFactura({
          facturaId,
          usuarioId: factura.emisorId,
          fecha: factura.fechaEmision || new Date(),
        });
      } catch (contErr) {
        console.error('Error creando asiento de costo de ventas:', contErr.message);
      }

      if (factura.emailComprador) {
        enviarDocumentoFiscal({
          tipo:                  'FACTURA',
          numero:                factura.numeroFactura,
          email:                 factura.emailComprador,
          pdfPath,
          razonSocialEmisor:     factura.razonSocialEmisor,
          nombreComercialEmisor: config.nombreComercial,
          logoUrl:               config.logoUrl,
          razonSocialComprador:  factura.razonSocialComprador,
          fecha:                 factura.fechaEmision,
          total:                 factura.importeTotal,
          claveAcceso:           factura.claveAcceso,
          numeroAutorizacion:    autorizacion.numeroAutorizacion,
        }).catch(err => console.error('[email] Factura:', err.message));
      }
    } else {
      // Si hay mensajes de rechazo reales del SRI → RECHAZADO definitivo
      // Si la respuesta está vacía (SRI aún procesando) → FIRMADO_PENDIENTE_ENVIO para reintento
      const esRechazoReal = autorizacion.mensajes && autorizacion.mensajes.length > 0;
      await prisma.facturas.update({
        where: { id: facturaId },
        data: {
          estadoSri:   esRechazoReal ? 'RECHAZADO' : 'FIRMADO_PENDIENTE_ENVIO',
          mensajesSri: { recepcion, autorizacion: autorizacion.mensajes },
        },
      });
    }
  } catch (err) {
    console.error('Error en flujo SRI:', err.message);
    const nuevoEstado = esErrorConectividad(err) ? 'FIRMADO_PENDIENTE_ENVIO' : 'RECHAZADO';
    if (nuevoEstado === 'FIRMADO_PENDIENTE_ENVIO') {
      console.log(`[SRI] Factura #${facturaId} queda en cola — sin internet (${err.code || err.message})`);
    }
    await prisma.facturas.update({
      where: { id: facturaId },
      data:  { estadoSri: nuevoEstado, mensajesSri: { error: err.message, code: err.code } },
    }).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FLUJO SRI: NOTA DE CRÉDITO
// Espejo de procesarFacturaEnSRI pero para el modelo notas_credito.
// ────────────────────────────────────────────────────────────────────────────
async function procesarNCEnSRI(ncId, xmlGenerado, config) {
  try {
    if (config.tipoCertificado === 'token') return; // firma manual
    if (!tieneCertificado(config)) {
      console.error(`[SRI] NC #${ncId}: certificado P12 no disponible. Re-suba el certificado en Configuración SRI.`);
      return;
    }

    const p12Buffer = getCertBuffer(config);
    const claveP12  = config.claveCertificado || '';

    // Firmar
    const xmlFirmado = sri.firmarXML(xmlGenerado, p12Buffer, claveP12);
    await prisma.notas_credito.update({
      where: { id: ncId },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    // Enviar al SRI
    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      await prisma.notas_credito.update({
        where: { id: ncId },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    // Autorizar — hasta 5 reintentos con pausa de 4 s
    const nc = await prisma.notas_credito.findUnique({ where: { id: ncId } });
    let autorizacion = null;
    for (let intento = 0; intento < 5; intento++) {
      if (intento > 0) await new Promise(r => setTimeout(r, 4000));
      autorizacion = await sri.autorizarComprobanteSRI(nc.claveAcceso, config.ambiente);
      if (autorizacion.autorizado || (autorizacion.mensajes && autorizacion.mensajes.length > 0)) break;
    }

    if (autorizacion.autorizado) {
      const pdfPath = path.join(DIR_FACTURAS, `nc-${ncId}.pdf`);
      await sri.generarRIDENotaCredito(
        { ...nc, xmlAutorizado: autorizacion.xmlAutorizado },
        config,
        pdfPath
      );
      await prisma.notas_credito.update({
        where: { id: ncId },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado,
          mensajesSri:        { autorizacion: autorizacion.estado },
          pdfUrl:             `/uploads/facturas/nc-${ncId}.pdf`,
        },
      });

      // Obtener email del comprador desde la factura relacionada
      let emailNC = null;
      if (nc.facturaId) {
        const factRel = await prisma.facturas.findUnique({
          where:  { id: nc.facturaId },
          select: { emailComprador: true },
        });
        emailNC = factRel?.emailComprador || null;
      }
      if (emailNC) {
        enviarDocumentoFiscal({
          tipo:                  'NOTA_CREDITO',
          numero:                nc.numeroNC,
          email:                 emailNC,
          pdfPath,
          razonSocialEmisor:     config.razonSocial,
          nombreComercialEmisor: config.nombreComercial,
          logoUrl:               config.logoUrl,
          razonSocialComprador:  nc.razonSocialComprador,
          fecha:                 nc.fechaEmision,
          total:                 nc.importeTotal,
          claveAcceso:          nc.claveAcceso,
          numeroAutorizacion:   autorizacion.numeroAutorizacion,
        }).catch(err => console.error('[email] NC:', err.message));
      }
    } else {
      const esRechazoReal = autorizacion.mensajes && autorizacion.mensajes.length > 0;
      await prisma.notas_credito.update({
        where: { id: ncId },
        data: {
          estadoSri:   esRechazoReal ? 'RECHAZADO' : 'FIRMADO_PENDIENTE_ENVIO',
          mensajesSri: { recepcion, autorizacion: autorizacion.mensajes },
        },
      });
    }
  } catch (err) {
    console.error('Error en flujo SRI (NC):', err.message);
    const nuevoEstado = esErrorConectividad(err) ? 'FIRMADO_PENDIENTE_ENVIO' : 'RECHAZADO';
    await prisma.notas_credito.update({
      where: { id: ncId },
      data:  { estadoSri: nuevoEstado, mensajesSri: { error: err.message, code: err.code } },
    }).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ADMIN — Transferencia de certificado entre tenants
// Solo admin. Copia el cert del tenant actual a otro tenant y lo borra del actual.
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas/configuracion/mover-cert?to=<slug>&dry=1
// Usa pg directo (no Prisma master) para funcionar en modo MONOEMPRESA también.
router.get('/configuracion/mover-cert', autorizarPermiso('sri.configurar'), async (req, res) => {
  const toTenantSlug = req.query.to;
  const dryRun = req.query.dry === '1' || req.query.dry === 'true';
  if (!toTenantSlug) return res.status(400).json({ ok: false, error: 'Falta toTenantSlug' });

  const { Client } = require('pg');

  try {
    // 1. Leer cert de la empresa actual (vía Prisma del tenant actual)
    const configActual = await getConfigSRI(req.empresa.id);
    if (!configActual?.certificadoP12Data) {
      return res.status(400).json({ ok: false, error: 'La empresa actual no tiene certificado almacenado' });
    }
    const certInfoActual = getCertInfo(configActual);

    // 2. Buscar el tenant destino en aela_master vía pg directo
    const mainUrl = process.env.DATABASE_URL;
    const masterDb = new Client({ connectionString: mainUrl });
    await masterDb.connect();
    const { rows: tenantRows } = await masterDb.query(
      `SELECT "dbName","dbHost","dbPort","dbUser","dbPass"
       FROM aela_master.tenants WHERE slug=$1 AND estado='activo' LIMIT 1`,
      [toTenantSlug]
    );
    await masterDb.end();

    if (!tenantRows.length) {
      return res.status(404).json({ ok: false, error: `Tenant '${toTenantSlug}' no encontrado en aela_master` });
    }

    // 3. Construir URL de la BD destino
    const u  = new URL(mainUrl);
    const t  = tenantRows[0];
    const pass = t.dbPass ? t.dbPass : decodeURIComponent(u.password);
    const host = t.dbHost || u.hostname;
    const port = t.dbPort || u.port || 5432;
    const user = t.dbUser || u.username;
    const toUrl = `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${t.dbName}`;

    // 4. Leer configuracion_sri del destino
    const toDb = new Client({ connectionString: toUrl });
    await toDb.connect();
    const { rows: cfgRows } = await toDb.query(
      `SELECT id, "ruc", "razonSocial", "certificadoP12Data"
       FROM configuracion_sri ORDER BY id LIMIT 1`
    );
    if (!cfgRows.length) {
      await toDb.end();
      return res.status(400).json({ ok: false, error: `El tenant '${toTenantSlug}' no tiene configuracion_sri — configura primero el RUC.` });
    }
    const cfgDestino = cfgRows[0];
    const certInfoDestino = cfgDestino.certificadoP12Data
      ? getCertInfo({ certificadoP12Data: cfgDestino.certificadoP12Data, claveCertificado: '' })
      : { estado: 'SIN_CERTIFICADO' };

    if (dryRun) {
      await toDb.end();
      return res.json({
        ok: true, dryRun: true,
        origen:  { empresa: req.empresa.razonSocial, certCN: certInfoActual.cn, certHasta: certInfoActual.validoHasta },
        destino: { tenant: toTenantSlug, empresa: cfgDestino.razonSocial, certActual: certInfoDestino.cn || null },
        accion:  'Copiar cert al destino y borrar del origen',
      });
    }

    // 5. Escribir cert en destino
    await toDb.query(
      `UPDATE configuracion_sri
       SET "certificadoP12Data"=$1,"claveCertificado"=$2,"certificadoP12"=NULL,"updatedAt"=NOW()
       WHERE id=$3`,
      [configActual.certificadoP12Data, configActual.claveCertificado, cfgDestino.id]
    );
    await toDb.end();

    // 6. Limpiar cert del origen (vía Prisma del tenant actual)
    await prisma.configuracion_sri.update({
      where: { id: configActual.id },
      data:  { certificadoP12Data: null, certificadoP12: null, claveCertificado: null },
    });

    res.json({
      ok:      true,
      mensaje: `Cert "${certInfoActual.cn}" transferido a ${toTenantSlug}. Esta empresa quedó sin certificado — sube el .p12 correcto.`,
      certTransferido: { cn: certInfoActual.cn, validoHasta: certInfoActual.validoHasta },
    });
  } catch (err) {
    console.error('[configuracion/mover-cert]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN SRI
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas/configuracion/cert-status — accesible a cualquier usuario autenticado (para el Dashboard)
router.get('/configuracion/cert-status', async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.json({ ok: true, certInfo: { estado: 'SIN_CERTIFICADO' } });
    const certInfo = getCertInfo(config);
    res.json({ ok: true, certInfo });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/configuracion
router.get('/configuracion', permitirConfigurarSri, async (req, res) => {
  try {
    const config   = await getConfigSRIEditable(req.empresa.id);
    const certInfo = getCertInfo(config);
    res.json({ ok: true, data: config, certInfo });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/facturas/configuracion
router.put('/configuracion', permitirConfigurarSri, async (req, res) => {
  try {
    const {
      ruc, razonSocial, nombreComercial, dirMatriz, dirEstablecimiento,
      establecimiento, puntoEmision, ambiente, contribuyenteEspecial,
      contribuyenteRimpe, negocioPopular,
      obligadoContabilidad, agenteRetencion, emailNotificaciones, telefono,
      tipoCertificado,
    } = req.body;

    const fields = {
      empresaId:            req.empresa.id,
      ruc, razonSocial, nombreComercial, dirMatriz, dirEstablecimiento,
      establecimiento:      establecimiento || '001',
      puntoEmision:         puntoEmision    || '001',
      ambiente:             parseInt(ambiente) || 1,
      contribuyenteEspecial: contribuyenteEspecial || null,
      contribuyenteRimpe:   !!contribuyenteRimpe,
      negocioPopular:       !!negocioPopular,
      obligadoContabilidad: !!obligadoContabilidad,
      agenteRetencion:      agenteRetencion || null,
      emailNotificaciones:  emailNotificaciones || null,
      telefono:             telefono || null,
      tipoCertificado:      ['archivo', 'token'].includes(tipoCertificado) ? tipoCertificado : 'archivo',
      activo:               true,
    };

    const existing = await getConfigSRI(req.empresa.id);
    let config;
    if (existing) {
      config = await prisma.configuracion_sri.update({ where: { id: existing.id }, data: fields });
    } else {
      config = await prisma.configuracion_sri.create({ data: fields });
    }

    await prisma.empresas.update({
      where: { id: req.empresa.id },
      data: {
        ruc,
        razonSocial,
        nombreComercial: nombreComercial || null,
        direccion: dirMatriz || null,
        email: emailNotificaciones || null,
        telefono: telefono || null,
      },
    });

    await registrarAuditoria({ usuarioId: req.usuario.id, accion: 'UPDATE', tabla: 'configuracion_sri', registroId: config.id, req });
    res.json({ ok: true, data: config });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/logo
// Convierte la imagen a data URI (base64) y la guarda en la BD.
// Así el logo persiste aunque el servidor se reinicie o redeploy (Railway).
router.post('/configuracion/logo', permitirConfigurarSri, uploadLogo.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
  try {
    const db = req.prisma;
    const config = await getConfigSRI(req.empresa.id, db);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });

    // Construir data URI directamente desde el buffer en memoria
    const mime    = req.file.mimetype || 'image/png';
    const b64     = req.file.buffer.toString('base64');
    const logoUrl = `data:${mime};base64,${b64}`;

    await db.configuracion_sri.update({ where: { id: config.id }, data: { logoUrl } });
    res.json({ ok: true, data: { logoUrl } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/firma
router.post('/configuracion/firma', permitirConfigurarSri, uploadLogo.single('firma'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
  try {
    const db = req.prisma;
    const config = await getConfigSRI(req.empresa.id, db);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });
    const firmaUrl = `data:${req.file.mimetype || 'image/png'};base64,${req.file.buffer.toString('base64')}`;
    await db.configuracion_sri.update({ where: { id: config.id }, data: { firmaUrl } });
    res.json({ ok: true, data: { firmaUrl } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/sello
router.post('/configuracion/sello', permitirConfigurarSri, uploadLogo.single('sello'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió imagen' });
  try {
    const db = req.prisma;
    const config = await getConfigSRI(req.empresa.id, db);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });
    const selloUrl = `data:${req.file.mimetype || 'image/png'};base64,${req.file.buffer.toString('base64')}`;
    await db.configuracion_sri.update({ where: { id: config.id }, data: { selloUrl } });
    res.json({ ok: true, data: { selloUrl } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/certificado
router.post('/configuracion/certificado', permitirConfigurarSri, uploadCert.single('certificado'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo .p12' });

  try {
    const db = req.prisma;
    const config = await getConfigSRI(req.empresa.id, db);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });

    // Eliminar certificado anterior
    if (config.certificadoP12 && fs.existsSync(config.certificadoP12)) {
      fs.unlinkSync(config.certificadoP12);
    }

    const certB64 = req.file.buffer
      ? req.file.buffer.toString('base64')
      : fs.readFileSync(req.file.path).toString('base64');

    // Validar el cert ANTES de guardar — si la clave es incorrecta, rechazar con 400
    const certInfoPreview = getCertInfo({ certificadoP12Data: certB64, claveCertificado: req.body.clave || '' });
    if (certInfoPreview.estado === 'CLAVE_INCORRECTA') {
      return res.status(400).json({ ok: false, error: 'La contraseña del certificado es incorrecta. Verifica la clave del .p12.' });
    }
    if (certInfoPreview.estado === 'ERROR_PARSEO') {
      return res.status(400).json({ ok: false, error: `El archivo .p12 no se pudo leer: ${certInfoPreview.error || 'formato inválido'}` });
    }

    await db.configuracion_sri.update({
      where: { id: config.id },
      data: {
        certificadoP12:     req.file.path,
        certificadoP12Data: certB64,
        claveCertificado:   req.body.clave || '',
      },
    });

    const certInfo = certInfoPreview;

    // Detectar mismatch: ¿alguna palabra del CN del cert aparece en la razonSocial?
    let advertencia = null;
    if (certInfo.cn && config.razonSocial) {
      const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const certWords = normalize(certInfo.cn).split(/\s+/).filter(w => w.length > 3);
      const empresa   = normalize(config.razonSocial);
      const mismatch  = certWords.length > 0 && !certWords.some(w => empresa.includes(w));
      if (mismatch) {
        advertencia = `El CN del certificado "${certInfo.cn}" no coincide con la empresa "${config.razonSocial}". Verifica que subiste el .p12 correcto.`;
      }
    }

    res.json({ ok: true, data: { certificadoCargado: true, archivo: req.file.filename }, certInfo, advertencia });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/facturas/configuracion/certificado
router.delete('/configuracion/certificado', permitirConfigurarSri, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (config?.certificadoP12 && fs.existsSync(config.certificadoP12)) {
      fs.unlinkSync(config.certificadoP12);
    }
    await prisma.configuracion_sri.update({
      where: { id: config.id },
      data:  { certificadoP12: null, certificadoP12Data: null, claveCertificado: null },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// FACTURAS — CRUD
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas  — lista con filtros opcionales
// GET /api/facturas/exportar/xlsx — Excel de ventas con los mismos filtros que el listado
router.get('/exportar/xlsx', permitirVerFacturacion, async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { estado, fechaDesde, fechaHasta, busqueda } = req.query;
    const where = { empresaId: req.empresa.id };

    if (estado)    where.estadoSri = estado;
    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        where.fechaEmision.lte = hasta;
      }
    }
    if (busqueda) {
      where.OR = [
        { numeroFactura:         { contains: busqueda, mode: 'insensitive' } },
        { razonSocialComprador:  { contains: busqueda, mode: 'insensitive' } },
        { identificacionComprador: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const facturas = await prisma.facturas.findMany({
      where,
      orderBy: { fechaEmision: 'desc' },
      take: 5000,
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true, tipoIdentificacionComprador: true,
        subtotal0: true, subtotal5: true, subtotal15: true, totalIva: true, importeTotal: true,
        estadoSri: true, anulada: true, numeroAutorizacion: true,
        origenRegistro: true, createdAt: true,
      },
    });

    const fmtDate = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';
    const fmtNum  = (v) => Number(v || 0).toFixed(2);

    const headers = [
      'ID', 'Nro Factura', 'Fecha Emisión', 'Nro Autorización',
      'Cliente', 'CI/RUC', 'Tipo ID',
      'Subtotal 0%', 'Subtotal 5%', 'Subtotal 15%', 'IVA', 'Total',
      'Estado SRI', 'Anulada', 'Origen', 'Fecha Registro',
    ];

    const rows = facturas.map((f) => [
      f.id, f.numeroFactura, fmtDate(f.fechaEmision), f.numeroAutorizacion || '',
      f.razonSocialComprador, f.identificacionComprador, f.tipoIdentificacionComprador || '',
      fmtNum(f.subtotal0), fmtNum(f.subtotal5), fmtNum(f.subtotal15), fmtNum(f.totalIva), fmtNum(f.importeTotal),
      f.estadoSri || '', f.anulada ? 'Si' : 'No',
      f.origenRegistro || 'MANUAL', fmtDate(f.createdAt),
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 30 },
      { wch: 36 }, { wch: 14 }, { wch: 8 },
      { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 12 },
      { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Ventas');

    const buf   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ventas-${fecha}.xlsx"`);
    res.send(buf);
  } catch (error) {
    console.error('GET /facturas/exportar/xlsx:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.get('/', permitirVerFacturacion, async (req, res) => {
  try {
    const { estado, clienteId, fechaDesde, fechaHasta, busqueda } = req.query;
    const where = { empresaId: req.empresa.id };
    if (estado)    where.estadoSri = estado;
    if (clienteId) where.clienteId = parseInt(clienteId);
    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) where.fechaEmision.lte = new Date(fechaHasta);
    }
    if (busqueda) {
      where.OR = [
        { numeroFactura: { contains: busqueda, mode: 'insensitive' } },
        { razonSocialComprador: { contains: busqueda, mode: 'insensitive' } },
        { identificacionComprador: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const facturas = await prisma.facturas.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        importeTotal: true, estadoSri: true, anulada: true,
        numeroAutorizacion: true, pdfUrl: true, clienteId: true,
        createdAt: true,
      },
    });

    res.json({ ok: true, data: facturas });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id
router.get('/:id', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    res.json({ ok: true, data: factura });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas  — crear factura
router.post('/', permitirEmitirFacturacion, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) {
      return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI (RUC, razón social, etc.)' });
    }

    const {
      tipoIdentificacionComprador,
      identificacionComprador,
      razonSocialComprador,
      direccionComprador,
      emailComprador,
      telefonoComprador,
      detalles,
      pagos,
      propina,
      observaciones,
      clienteId,
      fechaEmision,
    } = req.body;

    // Validaciones mínimas
    if (!tipoIdentificacionComprador || !identificacionComprador || !razonSocialComprador) {
      return res.status(400).json({ ok: false, error: 'Faltan datos del comprador' });
    }
    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ ok: false, error: 'Debe incluir al menos un detalle' });
    }

    const detallesFinales = detalles;

    // Siguiente secuencial (respeta secuencial inicial si la empresa migró desde otro sistema)
    const lastFact = await prisma.facturas.findFirst({
      where: { empresaId: req.empresa.id, rucEmisor: config.ruc },
      orderBy: { secuencial: 'desc' },
    });
    const maxEnBD = lastFact ? (parseInt(String(lastFact.secuencial), 10) || 0) : 0;
    const secuencialNum = await siguienteSecuencial(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD, 'secInicialFactura'
    );
    const secuencial = String(secuencialNum).padStart(9, '0');

    const fecha = fechaEmision ? new Date(fechaEmision) : new Date();

    // Generar clave de acceso
    const claveAcceso = sri.generarClaveAcceso({
      fecha,
      tipoCod:    '01',
      ruc:        config.ruc,
      ambiente:   config.ambiente,
      estab:      config.establecimiento,
      ptoEmi:     config.puntoEmision,
      secuencial,
    });

    const numeroFactura = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

    // Generar XML
    const { xml, totales } = sri.generarXMLFactura({
      claveAcceso, secuencial, fechaEmision: fecha,
      tipoIdentificacionComprador, identificacionComprador,
      razonSocialComprador, direccionComprador, emailComprador, telefonoComprador,
      detalles: detallesFinales, pagos, propina, observaciones,
      vendedor: req.usuario.nombre || null,
    }, config);

    // Guardar en BD
    const pagosFinales = pagos || [{ formaPago: 'Efectivo', total: totales.importeTotal }];
    const factura = await prisma.$transaction(async (tx) => {
      const creada = await tx.facturas.create({
        data: {
          empresaId: req.empresa.id,
          claveAcceso,
          numeroFactura,
          secuencial,
          rucEmisor: config.ruc,
          razonSocialEmisor: config.razonSocial,
          tipoIdentificacionComprador,
          identificacionComprador,
          razonSocialComprador,
          direccionComprador: direccionComprador || null,
          emailComprador: emailComprador || null,
          telefonoComprador: telefonoComprador || null,
          clienteId: clienteId ? parseInt(clienteId, 10) : null,
          fechaEmision: fecha,
          subtotal0: totales.subtotal0,
          subtotal5: totales.subtotal5 || 0,
          subtotal15: totales.subtotal15,
          subtotalNoObjetoIva: 0,
          totalDescuento: totales.totalDescuento,
          totalIva: totales.totalIva,
          propina: totales.propina,
          importeTotal: totales.importeTotal,
          detalles: detallesFinales,
          pagos: pagosFinales,
          estadoSri: 'PENDIENTE_FIRMA',
          xmlGenerado: xml,
          observaciones: observaciones || null,
          vendedor: req.usuario.nombre || null,
          emisorId: req.usuario.id,
        },
      });

      await aplicarMovimientosVentaDesdeDetalles({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        detalles: detallesFinales,
        tipoDocumento: 'FACTURA',
        referencia: numeroFactura,
        metadata: { facturaId: creada.id },
      });

      const totalCaja = pagosFinales.reduce((acc, pago) => acc + Number(pago.total || 0), 0) || Number(totales.importeTotal || 0);
      await registrarMovimientoCaja({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha,
        tipo: 'VENTA_FACTURA',
        monto: totalCaja,
        descripcion: `Venta por factura ${numeroFactura}`,
        referencia: numeroFactura,
        categoria: pagosFinales.map((pago) => pago.formaPago).filter(Boolean).join(', ') || null,
        origenId: creada.id,
        metadata: { facturaId: creada.id, pagos: pagosFinales },
      });

      return creada;
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'CREATE',
      tabla: 'facturas', registroId: factura.id,
      datosNuevos: { numeroFactura, importeTotal: totales.importeTotal },
      req,
    });

    // Procesar en SRI y enriquecer cliente — ambos en background
    procesarFacturaEnSRI(factura.id, xml, config).catch(err => console.error('SRI background:', err));
    enriquecerClienteDesdeFactura(req.empresa.id, factura.id, {
      clienteId:         clienteId ? parseInt(clienteId, 10) : null,
      tipoIdentificacion:tipoIdentificacionComprador,
      identificacion:    identificacionComprador,
      razonSocial:       razonSocialComprador,
      email:             emailComprador,
      telefono:          telefonoComprador,
      direccion:         direccionComprador,
    });

    res.status(201).json({ ok: true, data: factura, mensaje: 'Factura creada. Procesando en SRI...' });
  } catch (err) {
    console.error('Error al crear factura:', err);
    if (/Stock insuficiente|Producto no encontrado/.test(err.message || '')) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/:id/reenviar — reintentar envío al SRI
router.post('/:id/reenviar', permitirEmitirFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    if (factura.estadoSri === 'AUTORIZADO') {
      return res.status(400).json({ ok: false, error: 'La factura ya está autorizada' });
    }

    // Si el rechazo fue por límite diario del SRI (error 90), encolar para mañana
    if (tieneError90SRI(factura.mensajesSri)) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(0, 5, 0, 0);
      const reintentarDesde = t.toISOString();
      await prisma.facturas.update({
        where: { id: factura.id },
        data: {
          estadoSri:   'FIRMADO_PENDIENTE_ENVIO',
          xmlFirmado:  null,
          mensajesSri: { reintentarDesde, limiteError: true },
        },
      });
      const updated = await prisma.facturas.findUnique({ where: { id: factura.id } });
      return res.json({
        ok: true,
        data: updated,
        mensaje: `Límite diario del SRI (error 90). La factura se reenviará automáticamente mañana a las 00:05.`,
      });
    }

    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Sin configuración SRI' });

    await procesarFacturaEnSRI(factura.id, factura.xmlGenerado || factura.xmlFirmado, config);
    const updated = await prisma.facturas.findUnique({ where: { id: factura.id } });
    const msj = updated.mensajesSri;
    const errDetalle = (() => {
      const msgs = msj?.mensajes || msj?.recepcion?.mensajes;
      if (!Array.isArray(msgs) || !msgs.length) return '';
      return ' — ' + msgs.map(m => m.identificador ? `${m.identificador}: ${m.mensaje}` : m.mensaje).join('; ');
    })();
    res.json({ ok: true, data: updated, mensaje: `Estado actual: ${updated.estadoSri}${errDetalle}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/:id/anular
// ─── Lógica SRI para anulación ────────────────────────────────────────────────
// El SRI Ecuador NO dispone de un endpoint de "anulación directa".
// Para facturas AUTORIZADAS: el procedimiento fiscal correcto es emitir una
// Nota de Crédito al 100% del valor. Esta NC se envía al SRI y compensa la factura.
// Para facturas NO autorizadas (PENDIENTE_FIRMA, RECHAZADO, ENVIADO, etc.):
// basta con marcarlas como ANULADO localmente (nunca fueron aceptadas por el SRI).
router.post('/:id/anular', permitirAnularFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
    if (factura.anulada) return res.status(400).json({ ok: false, error: 'La factura ya está anulada' });

    const motivo = req.body.motivo || 'Anulada por el emisor';
    let ncCreada = null;

    // ── Para facturas AUTORIZADAS: emitir NC total como mecanismo SRI ───────
    if (factura.estadoSri === 'AUTORIZADO') {
      const config = await getConfigSRI(req.empresa.id);
      if (!config) {
        return res.status(400).json({ ok: false, error: 'Configure primero el SRI para emitir la Nota de Crédito de anulación' });
      }

      // Obtener detalles y construir items de NC
      const detallesFact = Array.isArray(factura.detalles)
        ? factura.detalles
        : (typeof factura.detalles === 'string' ? JSON.parse(factura.detalles) : []);

      const detallesNC = detallesFact.map(d => ({
        descripcion:    d.descripcion,
        cantidad:       Number(d.cantidad)        || 1,
        precioUnitario: Number(d.precioUnitario)  || 0,
        ivaPorcentaje:  Number(d.ivaPorcentaje ?? d.porcentajeIva) || 0,
      }));

      if (!detallesNC.length) {
        return res.status(400).json({ ok: false, error: 'La factura no tiene detalles para incluir en la Nota de Crédito' });
      }

      // Siguiente secuencial de NC
      const lastNC = await prisma.notas_credito.findFirst({
        where: { empresaId: req.empresa.id },
        orderBy: { secuencial: 'desc' },
      });
      const maxEnBD_nc = lastNC ? (parseInt(String(lastNC.secuencial), 10) || 0) : 0;
      const secuencialNum_nc = await siguienteSecuencial(
        prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
        maxEnBD_nc, 'secInicialNotaCredito'
      );
      const secuencial = String(secuencialNum_nc).padStart(9, '0');

      const fecha = new Date();
      const claveAcceso = sri.generarClaveAcceso({
        fecha,
        tipoCod:    '04',
        ruc:        config.ruc,
        ambiente:   config.ambiente,
        estab:      config.establecimiento,
        ptoEmi:     config.puntoEmision,
        secuencial,
      });
      const numeroNC = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

      const { xml, totales } = sri.generarXMLNotaCredito({
        claveAcceso, secuencial, fechaEmision: fecha,
        tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
        identificacionComprador:     factura.identificacionComprador,
        razonSocialComprador:        factura.razonSocialComprador,
        numeroFacturaAfectada:       factura.numeroFactura,
        fechaEmisionDocSustento:     factura.fechaEmision,
        motivoModificacion:          motivo,
        detalles:                    detallesNC,
      }, config);

      ncCreada = await prisma.notas_credito.create({
        data: {
          empresaId:                   req.empresa.id,
          claveAcceso, numeroNC, secuencial,
          tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
          identificacionComprador:     factura.identificacionComprador,
          razonSocialComprador:        factura.razonSocialComprador,
          facturaId:                   factura.id,
          numeroFacturaAfectada:       factura.numeroFactura,
          fechaEmisionDocSustento:     factura.fechaEmision,
          motivoModificacion:          motivo,
          fechaEmision:                fecha,
          totalSinImpuestos:           totales.totalSinImpuestos,
          totalIva:                    totales.totalIva,
          importeTotal:                totales.importeTotal,
          detalles:                    detallesNC,
          estadoSri:                   'PENDIENTE_FIRMA',
          xmlGenerado:                 xml,
          emisorId:                    req.usuario.id,
        },
      });

      // Registrar asiento contable de la NC
      try {
        await crearAsientoNotaCreditoEmitida({
          notaCreditoId: ncCreada.id,
          usuarioId: req.usuario.id,
          fecha,
        });
      } catch (contErr) {
        console.error('Error creando asiento de NC por anulación:', contErr.message);
      }
    }

    // ── Marcar factura como ANULADO y revertir inventario/caja ──────────────
    const updated = await prisma.$transaction(async (tx) => {
      const anulada = await tx.facturas.update({
        where: { id: factura.id },
        data: {
          anulada: true,
          estadoSri: 'ANULADO',
          motivoAnulacion: motivo,
        },
      });

      await aplicarMovimientosVentaDesdeDetalles({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        detalles: factura.detalles || [],
        tipoDocumento: 'FACTURA',
        referencia: factura.numeroFactura,
        metadata: { facturaId: factura.id, anulado: true },
        revertir: true,
      });

      await registrarMovimientoCaja({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha: new Date(),
        tipo: 'ANULACION_FACTURA',
        monto: Number(factura.importeTotal || 0),
        descripcion: `Anulación de factura ${factura.numeroFactura}`,
        referencia: factura.numeroFactura,
        origenId: factura.id,
        metadata: { facturaId: factura.id },
      });

      return anulada;
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'UPDATE',
      tabla: 'facturas', registroId: factura.id,
      datosAnteriores: { estadoSri: factura.estadoSri },
      datosNuevos:     { estadoSri: 'ANULADO', motivoAnulacion: motivo, ncAnulacionId: ncCreada?.id },
      req,
    });

    try {
      await crearAsientoReversoFacturaAnulada({
        facturaId: factura.id,
        usuarioId: req.usuario.id,
        fecha: new Date(),
      });
    } catch (contErr) {
      console.error('Error creando asiento reverso por anulación:', contErr.message);
    }

    const mensaje = ncCreada
      ? `Factura anulada. Se emitió la Nota de Crédito ${ncCreada.numeroNC} (enviando al SRI…).`
      : 'Factura anulada correctamente (no estaba autorizada en el SRI).';

    res.json({ ok: true, data: updated, ncAnulacion: ncCreada, mensaje });

    // Firmar y enviar la NC al SRI de forma asíncrona (sin bloquear la respuesta)
    if (ncCreada && config) {
      setImmediate(() => procesarNCEnSRI(ncCreada.id, ncCreada.xmlGenerado, config));
    }
  } catch (err) {
    console.error('Error al anular factura:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id/pdf — descarga RIDE PDF
router.get('/:id/pdf', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const config  = await getConfigSRI(req.empresa.id);
    const pdfPath = path.join(DIR_FACTURAS, `factura-${factura.id}.pdf`);

    // Siempre regenerar: el logo o el estado de autorización pueden haber cambiado
    await sri.generarRIDEFactura(factura, config || {}, pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-${factura.numeroFactura}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id/recibo — recibo POS (pequeño, para impresora térmica)
router.get('/:id/recibo', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const config  = await getConfigSRI(req.empresa.id);
    const pdfPath = path.join(DIR_FACTURAS, `recibo-${factura.id}.pdf`);

    // Siempre regenerar (el recibo es pequeño y cambia si se autoriza)
    await sri.generarReciboPOS(factura, config || {}, pdfPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=recibo-${factura.numeroFactura}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/:id/xml — descarga XML
router.get('/:id/xml', permitirVerFacturacion, async (req, res) => {
  try {
    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const xml = factura.xmlAutorizado || factura.xmlFirmado || factura.xmlGenerado;
    if (!xml) return res.status(404).json({ ok: false, error: 'Sin XML disponible' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename=factura-${factura.numeroFactura}.xml`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// NOTAS DE CRÉDITO
// ────────────────────────────────────────────────────────────────────────────

// GET /api/facturas/notas-credito — lista
router.get('/notas-credito/lista', permitirVerFacturacion, async (req, res) => {
  try {
    const ncs = await prisma.notas_credito.findMany({
      where: { empresaId: req.empresa.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, data: ncs });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/notas-credito — emitir NC contra una factura
router.post('/notas-credito', permitirEmitirFacturacion, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero el SRI' });

    const {
      facturaId,
      motivoModificacion,
      detalles,
    } = req.body;

    if (!facturaId || !motivoModificacion || !detalles?.length) {
      return res.status(400).json({ ok: false, error: 'Faltan datos para la Nota de Crédito' });
    }

    const factura = await prisma.facturas.findFirst({
      where: { id: parseInt(facturaId, 10), empresaId: req.empresa.id },
    });
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura origen no encontrada' });
    if (factura.anulada) {
      return res.status(400).json({ ok: false, error: 'No se puede emitir Nota de Crédito sobre una factura anulada' });
    }

    // Siguiente secuencial de NC (respeta secuencial inicial configurado)
    const lastNC = await prisma.notas_credito.findFirst({
      where: { empresaId: req.empresa.id },
      orderBy: { secuencial: 'desc' },
    });
    const maxEnBD_nc = lastNC ? (parseInt(String(lastNC.secuencial), 10) || 0) : 0;
    const secuencialNum_nc = await siguienteSecuencial(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD_nc, 'secInicialNotaCredito'
    );
    const secuencial = String(secuencialNum_nc).padStart(9, '0');

    const fecha = new Date();
    const claveAcceso = sri.generarClaveAcceso({
      fecha,
      tipoCod:    '04',
      ruc:        config.ruc,
      ambiente:   config.ambiente,
      estab:      config.establecimiento,
      ptoEmi:     config.puntoEmision,
      secuencial,
    });
    const numeroNC = sri.formatearNumeroFactura(config.establecimiento, config.puntoEmision, secuencial);

    const { xml, totales } = sri.generarXMLNotaCredito({
      claveAcceso, secuencial, fechaEmision: fecha,
      tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
      identificacionComprador:     factura.identificacionComprador,
      razonSocialComprador:        factura.razonSocialComprador,
      numeroFacturaAfectada:       factura.numeroFactura,
      fechaEmisionDocSustento:     factura.fechaEmision,
      motivoModificacion,
      detalles,
    }, config);

    const nc = await prisma.notas_credito.create({
      data: {
        empresaId: req.empresa.id,
        claveAcceso, numeroNC, secuencial,
        tipoIdentificacionComprador: factura.tipoIdentificacionComprador,
        identificacionComprador:     factura.identificacionComprador,
        razonSocialComprador:        factura.razonSocialComprador,
        facturaId:                   factura.id,
        numeroFacturaAfectada:       factura.numeroFactura,
        fechaEmisionDocSustento:     factura.fechaEmision,
        motivoModificacion,
        fechaEmision:                fecha,
        totalSinImpuestos:           totales.totalSinImpuestos,
        totalIva:                    totales.totalIva,
        importeTotal:                totales.importeTotal,
        detalles,
        estadoSri:                   'PENDIENTE_FIRMA',
        xmlGenerado:                 xml,
        emisorId:                    req.usuario.id,
      },
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'CREATE',
      tabla: 'notas_credito', registroId: nc.id,
      datosNuevos: { numeroNC, facturaId },
      req,
    });

    try {
      await crearAsientoNotaCreditoEmitida({
        notaCreditoId: nc.id,
        usuarioId: req.usuario.id,
        fecha,
      });
    } catch (contErr) {
      console.error('Error creando asiento automático de nota de crédito:', contErr.message);
    }

    res.status(201).json({ ok: true, data: nc });

    // Firmar y enviar la NC al SRI de forma asíncrona
    setImmediate(() => procesarNCEnSRI(nc.id, xml, config));
  } catch (err) {
    console.error('Error al crear NC:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/facturas/notas-credito/:id/pdf
router.get('/notas-credito/:id/pdf', permitirVerFacturacion, async (req, res) => {
  try {
    const nc = await prisma.notas_credito.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!nc) return res.status(404).json({ ok: false, error: 'NC no encontrada' });

    const config  = await getConfigSRI(req.empresa.id);
    const pdfPath = path.join(DIR_FACTURAS, `nc-${nc.id}.pdf`);

    if (!fs.existsSync(pdfPath)) {
      await sri.generarRIDENotaCredito(nc, config || {}, pdfPath);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=nc-${nc.numeroNC}.pdf`);
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/notas-credito/:id/reenviar — reintento manual de firma/envío al SRI
router.post('/notas-credito/:id/reenviar', permitirEmitirFacturacion, async (req, res) => {
  try {
    const nc = await prisma.notas_credito.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!nc) return res.status(404).json({ ok: false, error: 'NC no encontrada' });
    if (nc.estadoSri === 'AUTORIZADO') {
      return res.status(400).json({ ok: false, error: 'La Nota de Crédito ya está autorizada por el SRI' });
    }

    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Sin configuración SRI' });

    // Procesar de forma síncrona (igual que factura reenviar) para devolver el estado real
    await procesarNCEnSRI(nc.id, nc.xmlGenerado || nc.xmlFirmado, config);
    const updated = await prisma.notas_credito.findUnique({ where: { id: nc.id } });
    const msjNc = updated.mensajesSri;
    const errDetalleNc = (() => {
      const msgs = msjNc?.mensajes || msjNc?.recepcion?.mensajes;
      if (!Array.isArray(msgs) || !msgs.length) return '';
      return ' — ' + msgs.map(m => m.identificador ? `${m.identificador}: ${m.mensaje}` : m.mensaje).join('; ');
    })();
    res.json({ ok: true, data: updated, mensaje: `Estado actual: ${updated.estadoSri}${errDetalleNc}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/facturas/reportes/tributario?mes=MM&anio=YYYY
// Resumen mensual para declaración de IVA (Formulario 104)
// Devuelve: facturas, notas de crédito y retenciones del período
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reportes/tributario', permitirReportesTributarios, async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const empresaId = req.empresa.id;

    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 0, 23, 59, 59, 999); // último día del mes
    const filtroFecha = { gte: desde, lte: hasta };

    // ── Facturas del período (ventas) ─────────────────────────────────────────
    const facturas = await db.facturas.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
        estadoSri: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Notas de crédito emitidas del período ─────────────────────────────────
    const notasCredito = await db.notas_credito.findMany({
      where: { empresaId, fechaEmision: filtroFecha },
      select: {
        id: true, numeroNC: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        totalSinImpuestos: true, totalIva: true, importeTotal: true,
        estadoSri: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Retenciones emitidas del período (a proveedores — obligación F103) ────
    const retenciones = await db.retenciones.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: {
        id: true, numeroRetencion: true, fechaEmision: true,
        razonSocialProveedor: true, identificacionProveedor: true,
        totalRetenido: true, estadoSri: true, impuestos: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Compras del período — mismos filtros que el F104 real ─────────────────
    // Excluye receptorEsRuc===false (facturado a cédula personal) y
    // esGastoPersonal===true; receptorEsRuc null (compras manuales/históricas
    // sin XML) sí se incluye. Ver declaraciones.js /f104 para el detalle.
    const compras = await db.facturas_compra.findMany({
      where: {
        empresaId, fechaEmision: filtroFecha, anulada: false,
        esGastoPersonal: { not: true },
        OR: [{ receptorEsRuc: null }, { receptorEsRuc: true }],
      },
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialProveedor: true, identificacionProveedor: true,
        subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Liquidaciones de compra del período (crédito fiscal adicional) ────────
    const liquidaciones = await db.liquidaciones_compra.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: { subtotal0: true, subtotal15: true, totalIva: true },
    });

    // ── Notas de crédito recibidas de proveedores del período (tipo SRI 04) ───
    const notasCreditoRecibidas = await db.docs_recibidos_otros.findMany({
      where: { empresaId, tipoDocumento: '04', fechaEmision: filtroFecha },
      select: {
        id: true, fechaEmision: true, razonSocialEmisor: true, rucEmisor: true,
        claveAcceso: true, importeTotal: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Retenciones que los clientes le practican a la empresa (crédito real
    //    del F104 — no confundir con `retenciones`, que la empresa emite a
    //    sus proveedores y es obligación del F103) ─────────────────────────
    const retencionesRecibidas = await db.retenciones_recibidas.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: { totalRetencionIva: true, totalRetencionRenta: true },
    });

    const d = (v) => parseFloat(v || 0);

    // ── Totales ────────────────────────────────────────────────────────────
    const totVentas = facturas.reduce((acc, f) => ({
      subtotal0:    acc.subtotal0    + d(f.subtotal0),
      subtotal15:   acc.subtotal15   + d(f.subtotal15),
      totalIva:     acc.totalIva     + d(f.totalIva),
      importeTotal: acc.importeTotal + d(f.importeTotal),
    }), { subtotal0: 0, subtotal15: 0, totalIva: 0, importeTotal: 0 });

    const totNC = notasCredito.reduce((acc, nc) => ({
      totalSinImpuestos: acc.totalSinImpuestos + d(nc.totalSinImpuestos),
      totalIva:          acc.totalIva          + d(nc.totalIva),
      importeTotal:      acc.importeTotal      + d(nc.importeTotal),
    }), { totalSinImpuestos: 0, totalIva: 0, importeTotal: 0 });

    const totCompras = compras.reduce((acc, c) => ({
      subtotal0:    acc.subtotal0    + d(c.subtotal0),
      subtotal15:   acc.subtotal15   + d(c.subtotal15),
      totalIva:     acc.totalIva     + d(c.totalIva),
      importeTotal: acc.importeTotal + d(c.importeTotal),
    }), { subtotal0: 0, subtotal15: 0, totalIva: 0, importeTotal: 0 });

    const totLiq = liquidaciones.reduce((acc, l) => ({
      subtotal0:  acc.subtotal0  + d(l.subtotal0),
      subtotal15: acc.subtotal15 + d(l.subtotal15),
      totalIva:   acc.totalIva   + d(l.totalIva),
    }), { subtotal0: 0, subtotal15: 0, totalIva: 0 });

    const totNCRecibidas = notasCreditoRecibidas.reduce((acc, nc) => ({
      importeTotal: acc.importeTotal + d(nc.importeTotal),
    }), { importeTotal: 0 });

    // Retención IVA/Renta emitida a proveedores (impuestos: [{codigo, valorRetenido}])
    let retencionIvaEmitida = 0;
    let retencionRentaEmitida = 0;
    retenciones.forEach(ret => {
      const imps = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
      imps.forEach(imp => {
        if (String(imp.codigo) === '2') retencionIvaEmitida += d(imp.valorRetenido);
        if (String(imp.codigo) === '1') retencionRentaEmitida += d(imp.valorRetenido);
      });
    });

    const retencionIvaRecibida = retencionesRecibidas.reduce((s, r) => s + d(r.totalRetencionIva), 0);
    const retencionRentaRecibida = retencionesRecibidas.reduce((s, r) => s + d(r.totalRetencionRenta), 0);

    // ── IVA a pagar/crédito, igual fórmula que Declaraciones → F104:
    //    IVA en ventas (neto de NC emitidas) - crédito fiscal de compras
    //    (compras + liquidaciones) - retenciones de IVA que los CLIENTES le
    //    practicaron a la empresa. Las retenciones EMITIDAS a proveedores son
    //    obligación del F103, no reducen este cálculo.
    const ivaVentasNeto     = parseFloat((totVentas.totalIva - totNC.totalIva).toFixed(2));
    const ivaCreditoFiscal  = parseFloat((totCompras.totalIva + totLiq.totalIva).toFixed(2));
    const ivaNeto = parseFloat((ivaVentasNeto - ivaCreditoFiscal - retencionIvaRecibida).toFixed(2));

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${String(mes).padStart(2,'0')}/${anio}` },
        facturas,
        notasCredito,
        retenciones,
        compras,
        liquidaciones,
        notasCreditoRecibidas,
        resumen: {
          ventas: {
            subtotal0:    parseFloat(totVentas.subtotal0.toFixed(2)),
            subtotal15:   parseFloat(totVentas.subtotal15.toFixed(2)),
            totalIva:     parseFloat(totVentas.totalIva.toFixed(2)),
            importeTotal: parseFloat(totVentas.importeTotal.toFixed(2)),
            cantidadFacturas: facturas.length,
          },
          notasCredito: {
            totalSinImpuestos: parseFloat(totNC.totalSinImpuestos.toFixed(2)),
            totalIva:          parseFloat(totNC.totalIva.toFixed(2)),
            importeTotal:      parseFloat(totNC.importeTotal.toFixed(2)),
            cantidad:          notasCredito.length,
          },
          compras: {
            subtotal0:    parseFloat(totCompras.subtotal0.toFixed(2)),
            subtotal15:   parseFloat(totCompras.subtotal15.toFixed(2)),
            totalIva:     parseFloat(totCompras.totalIva.toFixed(2)),
            importeTotal: parseFloat(totCompras.importeTotal.toFixed(2)),
            cantidad:     compras.length,
            liquidaciones: {
              subtotal0: parseFloat(totLiq.subtotal0.toFixed(2)),
              subtotal15: parseFloat(totLiq.subtotal15.toFixed(2)),
              totalIva:  parseFloat(totLiq.totalIva.toFixed(2)),
              cantidad:  liquidaciones.length,
            },
            ivaCreditoFiscal,
          },
          notasCreditoRecibidas: {
            importeTotal: parseFloat(totNCRecibidas.importeTotal.toFixed(2)),
            cantidad:     notasCreditoRecibidas.length,
          },
          retenciones: {
            retencionIvaCobrada:    parseFloat(retencionIvaEmitida.toFixed(2)),
            retencionRentaCobrada:  parseFloat(retencionRentaEmitida.toFixed(2)),
            cantidad:               retenciones.length,
          },
          retencionesRecibidas: {
            retencionIva:   parseFloat(retencionIvaRecibida.toFixed(2)),
            retencionRenta: parseFloat(retencionRentaRecibida.toFixed(2)),
            cantidad:       retencionesRecibidas.length,
          },
          ivaVentasNeto,
          ivaCreditoFiscal,
          ivaNeto, // IVA resultante a declarar (misma fórmula que F104, sin crédito tributario arrastrado)
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// IMPORTACIÓN MASIVA DE FACTURAS HISTÓRICAS
// ────────────────────────────────────────────────────────────────────────────

const {
  leerExcel,
  validarFila,
  construirDetalles,
  generarPlantilla,
} = require('../utils/importarFacturasHistoricas');
const { parsearFacturaXML } = require('../utils/importarFacturasVentaXML');
const AdmZip = require('adm-zip');
const { crearAsientoFacturaAutorizada: _crearAsientoXml } = require('../utils/contabilidad');

const uploadImportacion = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se aceptan archivos .xlsx, .xls o .csv'));
    }
  },
});

// Wrapper que convierte errores de multer en respuestas JSON
function multerImportacion(req, res, next) {
  uploadImportacion.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}

// Importación de ventas históricas desde XML autorizados (.zip) — para
// clientes que ya tienen a mano los XML descargados de srienlinea.sri.gob.ec,
// en vez de tener que re-teclear cada factura en la plantilla Excel.
const uploadImportacionZip = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.zip$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('Solo se acepta un archivo .zip con los XML'));
  },
});
function multerImportacionZip(req, res, next) {
  uploadImportacionZip.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    next();
  });
}

// Adapta el shape de parsearFacturaXML() al mismo "datos" que ya consume el
// wizard de vista previa (fecha/razonSocial/subtotalExento/subtotalGravado/
// ivaTotal/importeTotal/parsedNum/numeroAutorizacion) — misma tabla, sin
// tener que duplicar el frontend para el modo XML.
function adaptarDatosXmlAPreview(d) {
  return {
    fecha: d.fechaEmision,
    razonSocial: d.razonSocialComprador,
    descripcion: d.detalles.map((it) => it.descripcion).slice(0, 2).join(' / ') || 'Factura importada desde XML',
    subtotalExento: round2XmlImport(d.subtotal0 + d.subtotalNoObjetoIva),
    subtotalGravado: round2XmlImport(d.subtotal5 + d.subtotal15),
    ivaTotal: d.totalIva,
    importeTotal: d.importeTotal,
    parsedNum: { estab: d.numeroFactura.split('-')[0], ptoEmi: d.numeroFactura.split('-')[1], secuencial: d.secuencial },
    numeroAutorizacion: d.numeroAutorizacion,
    claveAcceso: d.claveAcceso,
  };
}
function round2XmlImport(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function leerXmlsDeZip(buffer) {
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((e) => !e.isDirectory && /\.xml$/i.test(e.entryName))
    .map((e) => ({ nombre: e.entryName, contenido: e.getData().toString('utf8') }));
}

// GET /api/facturas/importar/xml-plantilla — no hay plantilla que llenar;
// esto solo documenta el requisito para que el botón "Descargar" del wizard
// tenga a dónde apuntar en modo XML (devuelve las instrucciones como texto).
router.get('/importar/xml-instrucciones', (_req, res) => {
  res.json({
    ok: true,
    texto: 'Comprime en un .zip los XML autorizados de tus facturas de venta '
      + '(descargados de srienlinea.sri.gob.ec). Cada archivo debe ser el '
      + '<factura> autorizado tal cual — no hace falta llenar ninguna plantilla.',
  });
});

// POST /api/facturas/importar/xml-preview — valida el .zip sin importar
router.post('/importar/xml-preview', multerImportacionZip, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });

    const archivos = leerXmlsDeZip(req.file.buffer);
    if (archivos.length === 0) return res.status(400).json({ ok: false, error: 'El .zip no contiene archivos .xml' });
    if (archivos.length > 1000) return res.status(400).json({ ok: false, error: 'Máximo 1000 archivos por importación' });

    const resultado = archivos.map((a, idx) => {
      try {
        const datos = parsearFacturaXML(a.contenido);
        return { fila: idx + 1, archivo: a.nombre, valida: true, errores: [], datos: adaptarDatosXmlAPreview(datos) };
      } catch (err) {
        return { fila: idx + 1, archivo: a.nombre, valida: false, errores: [err.message], datos: null };
      }
    });

    const validas = resultado.filter((r) => r.valida).length;
    res.json({ ok: true, filas: resultado, validas, invalidas: resultado.length - validas, total: archivos.length });
  } catch (error) {
    console.error('POST /facturas/importar/xml-preview:', error);
    res.status(500).json({ ok: false, error: `Error al procesar el .zip: ${error.message}` });
  }
});

// POST /api/facturas/importar/xml-ejecutar — importa las facturas válidas del .zip
router.post('/importar/xml-ejecutar', multerImportacionZip, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });

    const db = req.prisma || prisma;
    const empresaId = req.empresa.id;

    const archivos = leerXmlsDeZip(req.file.buffer);
    if (archivos.length === 0) return res.status(400).json({ ok: false, error: 'El .zip no contiene archivos .xml' });
    if (archivos.length > 1000) return res.status(400).json({ ok: false, error: 'Máximo 1000 archivos por importación' });

    const importadas = [];
    const errores = [];

    for (const [idx, a] of archivos.entries()) {
      const filaNum = idx + 1;
      let d;
      try {
        d = parsearFacturaXML(a.contenido);
      } catch (err) {
        errores.push({ fila: filaNum, errores: [`${a.nombre}: ${err.message}`] });
        continue;
      }

      try {
        const existente = await db.facturas.findUnique({ where: { claveAcceso: d.claveAcceso }, select: { id: true } });
        if (existente) {
          errores.push({ fila: filaNum, errores: [`Ya existe una factura con esta clave de acceso (${a.nombre})`] });
          continue;
        }

        let cliente = null;
        try {
          cliente = await db.clientes.upsert({
            where: { empresaId_identificacion: { identificacion: d.identificacionComprador, empresaId } },
            update: {},
            create: {
              empresaId, identificacion: d.identificacionComprador, razonSocial: d.razonSocialComprador,
              tipoIdentificacion: d.tipoIdentificacionComprador,
            },
          });
        } catch { /* identificación no apta para clientes (consumidor final genérico) — sin vincular */ }

        const creada = await db.facturas.create({
          data: {
            empresaId, claveAcceso: d.claveAcceso, numeroFactura: d.numeroFactura, secuencial: d.secuencial,
            rucEmisor: d.rucEmisor, razonSocialEmisor: d.razonSocialEmisor,
            tipoIdentificacionComprador: d.tipoIdentificacionComprador,
            identificacionComprador: d.identificacionComprador, razonSocialComprador: d.razonSocialComprador,
            emailComprador: d.emailComprador, clienteId: cliente?.id || null,
            fechaEmision: d.fechaEmision,
            subtotal0: d.subtotal0, subtotal5: d.subtotal5, subtotal15: d.subtotal15,
            subtotalNoObjetoIva: d.subtotalNoObjetoIva, totalDescuento: d.totalDescuento,
            totalIva: d.totalIva, propina: d.propina, importeTotal: d.importeTotal,
            detalles: d.detalles, pagos: d.pagos,
            estadoSri: 'AUTORIZADO', numeroAutorizacion: d.numeroAutorizacion,
            origenRegistro: 'IMPORTACION',
          },
          select: { id: true, numeroFactura: true, importeTotal: true, estadoSri: true },
        });

        let asientoOk = false;
        try {
          const rAsiento = await _crearAsientoXml({ facturaId: creada.id, usuarioId: req.usuario.id, fecha: d.fechaEmision, db });
          asientoOk = !!rAsiento.asiento;
        } catch (contErr) {
          console.error(`[Importar XML] Asiento contable fila ${filaNum} (factura ${creada.id}):`, contErr.message);
        }

        importadas.push({
          fila: filaNum, id: creada.id, numeroFactura: creada.numeroFactura,
          total: parseFloat(creada.importeTotal), estadoSri: creada.estadoSri, asientoOk,
        });
      } catch (err) {
        if (err.code === 'P2002') {
          errores.push({ fila: filaNum, errores: [`Ya existe una factura con esa clave de acceso o número (${a.nombre})`] });
        } else {
          console.error(`[Importar XML] fila ${filaNum} (${a.nombre}):`, err.message);
          errores.push({ fila: filaNum, errores: [err.message] });
        }
      }
    }

    await registrarAuditoria({
      db, usuarioId: req.usuario.id, empresaId,
      accion: 'IMPORTAR_FACTURAS_HISTORICAS_XML', tabla: 'facturas',
      descripcion: `Importadas ${importadas.length} facturas desde XML. Errores: ${errores.length}`,
    });

    res.json({ ok: true, importadas: importadas.length, errores: errores.length, detalle: { importadas, errores } });
  } catch (error) {
    console.error('POST /facturas/importar/xml-ejecutar:', error);
    res.status(500).json({ ok: false, error: `Error en importación: ${error.message}` });
  }
});

// GET /api/facturas/importar/plantilla — descarga la plantilla Excel
router.get('/importar/plantilla', async (_req, res) => {
  try {
    const buffer = generarPlantilla();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-facturas-historicas.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/importar/preview — valida el archivo sin importar
// POST /api/facturas/importar/generar-asientos-faltantes — reparación retroactiva
// Facturas históricas importadas ANTES del fix que engancha crearAsientoFacturaAutorizada
// al import (2026-07-04) se quedaron sin asiento contable. En vez de forzar al
// usuario a reimportar el Excel (riesgo de duplicados, aunque la unicidad de
// claveAcceso los bloquearía), esto genera el asiento faltante directamente sobre
// las facturas que YA existen — es idempotente, no crea duplicados, no requiere
// el archivo original.
router.post('/importar/generar-asientos-faltantes', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa.id;

    const historicas = await db.facturas.findMany({
      where: { empresaId, origenRegistro: 'IMPORTACION' },
      select: { id: true, numeroFactura: true, fechaEmision: true },
      orderBy: { fechaEmision: 'asc' },
    });

    let creados = 0;
    let yaTenian = 0;
    const errores = [];

    for (const factura of historicas) {
      try {
        const r = await crearAsientoFacturaAutorizada({
          facturaId: factura.id,
          usuarioId: req.usuario.id,
          fecha: factura.fechaEmision,
          db,
        });
        if (r.creado) creados += 1; else yaTenian += 1;
      } catch (err) {
        errores.push({ numeroFactura: factura.numeroFactura, error: err.message });
      }
    }

    res.json({
      ok: true,
      totalFacturasHistoricas: historicas.length,
      asientosCreados: creados,
      yaTeniaAsiento: yaTenian,
      errores,
    });
  } catch (err) {
    console.error('[Importar] generar-asientos-faltantes:', err);
    res.status(500).json({ ok: false, error: `Error al generar asientos: ${err.message}` });
  }
});

router.post('/importar/preview', multerImportacion, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });

    const filas = leerExcel(req.file.buffer);
    if (filas.length === 0) return res.status(400).json({ ok: false, error: 'El archivo está vacío o no tiene datos en la primera hoja' });
    if (filas.length > 1000) return res.status(400).json({ ok: false, error: 'Máximo 1000 filas por importación' });

    const resultado = filas.map((raw, idx) => {
      const { valida, errores, datos } = validarFila(raw);
      return { fila: idx + 2, valida, errores, datos };
    });

    const validas   = resultado.filter(r => r.valida).length;
    const invalidas = resultado.length - validas;

    res.json({ ok: true, filas: resultado, validas, invalidas, total: filas.length });
  } catch (err) {
    console.error('[Importar] preview error:', err.message);
    res.status(500).json({ ok: false, error: `Error al procesar archivo: ${err.message}` });
  }
});

// POST /api/facturas/importar/ejecutar — importa las filas válidas
router.post('/importar/ejecutar', multerImportacion, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' });

    const db = req.prisma || prisma;

    // Usar req.prisma directamente para esquivar el AsyncLocalStorage roto por multer
    const config = await db.configuracion_sri.findFirst({
      where: { empresaId: req.empresa.id, activo: true },
    });
    if (!config?.ruc) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI (RUC, razón social) en Configuración SRI' });

    const filasRaw = leerExcel(req.file.buffer);
    if (filasRaw.length === 0) return res.status(400).json({ ok: false, error: 'El archivo está vacío' });
    if (filasRaw.length > 1000) return res.status(400).json({ ok: false, error: 'Máximo 1000 filas por importación' });

    // Obtener el secuencial más alto actual para asignar automáticamente
    const lastFact = await db.facturas.findFirst({
      where:   { empresaId: req.empresa.id, rucEmisor: config.ruc },
      orderBy: { secuencial: 'desc' },
      select:  { secuencial: true },
    });
    let secuencialAuto = lastFact ? (parseInt(lastFact.secuencial, 10) || 0) : 0;

    const importadas = [];
    const errores    = [];

    for (const [idx, raw] of filasRaw.entries()) {
      const filaNum = idx + 2;
      const { valida, errores: errs, datos } = validarFila(raw);

      if (!valida) {
        errores.push({ fila: filaNum, errores: errs });
        continue;
      }

      try {
        let secuencial, estab, ptoEmi;

        if (datos.parsedNum) {
          // Respetar numeración original del sistema anterior
          secuencial = datos.parsedNum.secuencial;
          estab      = datos.parsedNum.estab;
          ptoEmi     = datos.parsedNum.ptoEmi;
          const seqNum = parseInt(secuencial, 10);
          if (seqNum > secuencialAuto) secuencialAuto = seqNum;
        } else {
          // Asignar siguiente secuencial automático
          secuencialAuto++;
          secuencial = String(secuencialAuto).padStart(9, '0');
          estab      = config.establecimiento;
          ptoEmi     = config.puntoEmision;
        }

        // Clave de acceso: usar autorización del SRI si existe, sino generar
        const claveAcceso = datos.numeroAutorizacion
          ? datos.numeroAutorizacion
          : sri.generarClaveAcceso({
              fecha:    datos.fecha,
              tipoCod:  '01',
              ruc:      config.ruc,
              ambiente: config.ambiente,
              estab,
              ptoEmi,
              secuencial,
            });

        const numeroFactura = sri.formatearNumeroFactura(estab, ptoEmi, secuencial);

        // Verificar unicidad de clave de acceso
        const yaExiste = await db.facturas.findUnique({
          where:  { claveAcceso },
          select: { id: true, numeroFactura: true },
        });
        if (yaExiste) {
          errores.push({
            fila: filaNum,
            errores: [`Ya existe la factura ${yaExiste.numeroFactura} con esta clave de acceso`],
          });
          continue;
        }

        const detalles     = construirDetalles(datos);
        const estadoSri    = datos.numeroAutorizacion ? 'AUTORIZADO' : 'HISTORICO';

        // Determinar subtotal5 vs subtotal15 según tasa de IVA histórica
        const subtotal5  = datos.ivaPct === 5  ? datos.subtotalGravado : 0;
        const subtotal15 = datos.ivaPct !== 5  ? datos.subtotalGravado : 0;

        const creada = await db.facturas.create({
          data: {
            empresaId:                   req.empresa.id,
            claveAcceso,
            numeroFactura,
            secuencial,
            rucEmisor:                   config.ruc,
            razonSocialEmisor:           config.razonSocial,
            tipoIdentificacionComprador: datos.tipoId,
            identificacionComprador:     datos.identificacion,
            razonSocialComprador:        datos.razonSocial,
            emailComprador:              datos.email,
            fechaEmision:                datos.fecha,
            subtotal0:                   datos.subtotalExento,
            subtotal5,
            subtotal15,
            subtotalNoObjetoIva:         0,
            totalDescuento:              0,
            totalIva:                    datos.ivaTotal,
            propina:                     0,
            importeTotal:                datos.importeTotal,
            detalles,
            pagos: [{ formaPago: datos.formaPago, total: datos.importeTotal }],
            estadoSri,
            numeroAutorizacion:          datos.numeroAutorizacion || null,
            origenRegistro:              'IMPORTACION',
            observaciones:               datos.observaciones,
            emisorId:                    req.usuario.id,
          },
          select: { id: true, numeroFactura: true, importeTotal: true, estadoSri: true, fechaEmision: true },
        });

        // Las facturas históricas nunca pasan por autorización SRI (ese es el único
        // punto donde se generaba el asiento contable hasta ahora) — sin esto quedaban
        // completamente fuera del Libro Diario, sin forma de "enlazarlas" después.
        // No se toca inventario/costo de venta aquí: retroactivamente descontar stock
        // actual por una venta ya consumida hace tiempo podría dejarlo negativo o
        // incorrecto; el asiento de venta (ingreso) sí es seguro y es lo que el
        // contador espera ver en el diario.
        let asientoOk = false;
        try {
          const rAsiento = await crearAsientoFacturaAutorizada({ facturaId: creada.id, usuarioId: req.usuario.id, fecha: datos.fecha, db });
          asientoOk = !!rAsiento.asiento;
        } catch (contErr) {
          console.error(`[Importar] Asiento contable fila ${filaNum} (factura ${creada.id}):`, contErr.message);
        }

        importadas.push({
          fila:          filaNum,
          id:            creada.id,
          numeroFactura: creada.numeroFactura,
          total:         parseFloat(creada.importeTotal),
          estadoSri:     creada.estadoSri,
          asientoOk,
        });
      } catch (err) {
        console.error(`[Importar] fila ${filaNum}:`, err.message);
        errores.push({ fila: filaNum, errores: [err.message] });
      }
    }

    await registrarAuditoria({
      db,
      usuarioId:   req.usuario.id,
      empresaId:   req.empresa.id,
      accion:      'IMPORTAR_FACTURAS_HISTORICAS',
      tabla:       'facturas',
      descripcion: `Importadas ${importadas.length} facturas históricas. Errores: ${errores.length}`,
    });

    res.json({
      ok:        true,
      importadas: importadas.length,
      errores:    errores.length,
      detalle:   { importadas, errores },
    });
  } catch (err) {
    console.error('[Importar] error general:', err);
    res.status(500).json({ ok: false, error: `Error en importación: ${err.message}` });
  }
});

module.exports = router;
