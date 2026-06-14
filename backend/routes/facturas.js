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
async function getConfigSRI(empresaId) {
  return prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
}

async function getConfigSRIEditable(empresaId) {
  const existente = await getConfigSRI(empresaId);
  if (existente) return existente;

  const empresa = await prisma.empresas.findUnique({
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
    const config = await getConfigSRI(req.empresa.id);
    if (!config) return res.status(400).json({ ok: false, error: 'Configure primero los datos del SRI' });

    // Construir data URI directamente desde el buffer en memoria
    const mime    = req.file.mimetype || 'image/png';
    const b64     = req.file.buffer.toString('base64');
    const logoUrl = `data:${mime};base64,${b64}`;

    await prisma.configuracion_sri.update({ where: { id: config.id }, data: { logoUrl } });
    res.json({ ok: true, data: { logoUrl } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/facturas/configuracion/certificado
router.post('/configuracion/certificado', permitirConfigurarSri, uploadCert.single('certificado'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo .p12' });

  try {
    const config = await getConfigSRI(req.empresa.id);
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

    await prisma.configuracion_sri.update({
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
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();

    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 0, 23, 59, 59, 999); // último día del mes

    // ── Facturas del período ──────────────────────────────────────────────────
    const facturas = await prisma.facturas.findMany({
      where: {
        empresaId: req.empresa.id,
        fechaEmision: { gte: desde, lte: hasta },
        anulada: false,
      },
      select: {
        id: true, numeroFactura: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
        estadoSri: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Notas de crédito del período ─────────────────────────────────────────
    const notasCredito = await prisma.notas_credito.findMany({
      where: { empresaId: req.empresa.id, fechaEmision: { gte: desde, lte: hasta } },
      select: {
        id: true, numeroNC: true, fechaEmision: true,
        razonSocialComprador: true, identificacionComprador: true,
        totalSinImpuestos: true, totalIva: true, importeTotal: true,
        estadoSri: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Retenciones del período ───────────────────────────────────────────────
    const retenciones = await prisma.retenciones.findMany({
      where: {
        empresaId: req.empresa.id,
        fechaEmision: { gte: desde, lte: hasta },
        anulada: false,
      },
      select: {
        id: true, numeroRetencion: true, fechaEmision: true,
        razonSocialProveedor: true, identificacionProveedor: true,
        totalRetenido: true, estadoSri: true, impuestos: true,
      },
      orderBy: { fechaEmision: 'asc' },
    });

    // ── Calcular totales de IVA (Formulario 104) ──────────────────────────────
    const totVentas = facturas.reduce((acc, f) => ({
      subtotal0:    acc.subtotal0    + parseFloat(f.subtotal0  || 0),
      subtotal15:   acc.subtotal15   + parseFloat(f.subtotal15 || 0),
      totalIva:     acc.totalIva     + parseFloat(f.totalIva   || 0),
      importeTotal: acc.importeTotal + parseFloat(f.importeTotal),
    }), { subtotal0: 0, subtotal15: 0, totalIva: 0, importeTotal: 0 });

    const totNC = notasCredito.reduce((acc, nc) => ({
      totalSinImpuestos: acc.totalSinImpuestos + parseFloat(nc.totalSinImpuestos || 0),
      totalIva:          acc.totalIva          + parseFloat(nc.totalIva          || 0),
      importeTotal:      acc.importeTotal      + parseFloat(nc.importeTotal),
    }), { totalSinImpuestos: 0, totalIva: 0, importeTotal: 0 });

    // Retención IVA cobrada (código 2)
    let retencionIvaCobrada = 0;
    let retencionRentaCobrada = 0;
    retenciones.forEach(ret => {
      const imps = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
      imps.forEach(imp => {
        if (String(imp.codigo) === '2') retencionIvaCobrada += parseFloat(imp.valorRetenido || 0);
        if (String(imp.codigo) === '1') retencionRentaCobrada += parseFloat(imp.valorRetenido || 0);
      });
    });

    // IVA a pagar = IVA cobrado en facturas - NC - Retenciones de IVA recibidas
    const ivaNeto = parseFloat((totVentas.totalIva - totNC.totalIva - retencionIvaCobrada).toFixed(2));

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${String(mes).padStart(2,'0')}/${anio}` },
        facturas,
        notasCredito,
        retenciones,
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
          retenciones: {
            retencionIvaCobrada:    parseFloat(retencionIvaCobrada.toFixed(2)),
            retencionRentaCobrada:  parseFloat(retencionRentaCobrada.toFixed(2)),
            cantidad:               retenciones.length,
          },
          ivaNeto, // IVA resultante a declarar
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
