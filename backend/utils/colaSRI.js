// ============================================================
//  AELA — Cola SRI: Worker de reintentos automáticos
//  backend/utils/colaSRI.js
//
//  Cuando el internet falla durante el envío al SRI, los
//  comprobantes quedan en estado FIRMADO_PENDIENTE_ENVIO.
//  Este worker los reintenta cada 2 minutos automáticamente.
// ============================================================

const prisma = require('../config/prisma');
const sri    = require('./sri');
const fs     = require('fs');
const path   = require('path');
const { getCertBuffer, tieneCertificado } = require('./certUtils');

// ─── Helpers de error ──────────────────────────────────────

// Detecta error 90 "LIMITE DE INTENTOS NO AUTORIZADOS POR DIA"
function esLimiteError(mensajes) {
  if (!Array.isArray(mensajes)) return false;
  return mensajes.some(m =>
    String(m.identificador) === '90' ||
    String(m.mensaje || '').includes('LIMITE DE INTENTOS')
  );
}

// Mañana a las 00:05 AM (hora local del servidor)
function reintentarDesdeManana() {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(0, 5, 0, 0);
  return t.toISOString();
}

// ¿El comprobante está en espera por límite diario del SRI?
function estaEnEspera(msj) {
  if (!msj?.reintentarDesde) return false;
  return new Date(msj.reintentarDesde) > new Date();
}

// Errores que indican problema de conectividad (no rechazo SRI)
const ERRORES_CONECTIVIDAD = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET',
  'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED', 'EPIPE',
  'EAI_AGAIN', 'EADDRNOTAVAIL',
]);

/**
 * Detecta si un error es de conectividad (internet caído)
 * vs un rechazo real del SRI.
 */
function esErrorConectividad(err) {
  if (!err) return false;
  if (ERRORES_CONECTIVIDAD.has(err.code)) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('socket hang up') ||
         msg.includes('network') ||
         msg.includes('timeout') ||
         msg.includes('getaddrinfo') ||
         msg.includes('connect econnrefused');
}

// ─── Cache de configuraciones SRI por empresa ──────────────
const _configCache = new Map();

async function getConfigSRI(empresaId) {
  if (_configCache.has(empresaId)) return _configCache.get(empresaId);

  const config = await prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
  if (config) {
    _configCache.set(empresaId, config);
    // Invalidar cache cada 5 min para recoger cambios de certificado
    setTimeout(() => _configCache.delete(empresaId), 5 * 60 * 1000);
  }
  return config;
}

// ─── Reintento: Factura ─────────────────────────────────────
async function reintentarFactura(factura) {
  // Espera por límite diario del SRI (error 90)
  if (estaEnEspera(factura.mensajesSri)) {
    const hasta = factura.mensajesSri.reintentarDesde;
    console.log(`[ColaSRI] Factura #${factura.id} en espera hasta ${hasta} (límite SRI error 90)`);
    return;
  }

  const config = await getConfigSRI(factura.empresaId);
  if (!config || config.tipoCertificado === 'token') return;
  if (!tieneCertificado(config)) return;

  try {
    // Puede que ya esté firmada (xmlFirmado) o solo generada (xmlGenerado)
    let xmlFirmado = factura.xmlFirmado;
    if (!xmlFirmado) {
      const p12Buffer = getCertBuffer(config);
      xmlFirmado = sri.firmarXML(factura.xmlGenerado, p12Buffer, config.claveCertificado || '');
      await prisma.facturas.update({
        where: { id: factura.id },
        data:  { xmlFirmado, estadoSri: 'ENVIADO' },
      });
    } else {
      // El XML ya fue firmado y probablemente enviado (RECIBIDA por el SRI).
      // Intentar autorizar directamente antes de re-enviar.
      let autorizacionDirecta = null;
      for (let intento = 0; intento < 3; intento++) {
        if (intento > 0) await new Promise(r => setTimeout(r, 4000));
        autorizacionDirecta = await sri.autorizarComprobanteSRI(factura.claveAcceso, config.ambiente);
        if (autorizacionDirecta.autorizado || (autorizacionDirecta.mensajes && autorizacionDirecta.mensajes.length > 0)) break;
      }

      if (autorizacionDirecta && autorizacionDirecta.autorizado) {
        const DIR_FACTURAS = path.join(__dirname, '..', 'uploads', 'facturas');
        const pdfPath = path.join(DIR_FACTURAS, `factura-${factura.id}.pdf`);
        await sri.generarRIDEFactura(
          { ...factura, xmlAutorizado: autorizacionDirecta.xmlAutorizado },
          config,
          pdfPath
        );
        await prisma.facturas.update({
          where: { id: factura.id },
          data: {
            estadoSri:          'AUTORIZADO',
            numeroAutorizacion: autorizacionDirecta.numeroAutorizacion,
            fechaAutorizacion:  autorizacionDirecta.fechaAutorizacion,
            xmlAutorizado:      autorizacionDirecta.xmlAutorizado,
            mensajesSri:        { autorizacion: autorizacionDirecta.estado },
            pdfUrl:             `/uploads/facturas/factura-${factura.id}.pdf`,
          },
        });
        try {
          const { crearAsientoFacturaAutorizada } = require('./contabilidad');
          await crearAsientoFacturaAutorizada({ facturaId: factura.id, usuarioId: factura.emisorId, fecha: factura.fechaEmision || new Date() });
        } catch (_) {}
        console.log(`[ColaSRI] Factura #${factura.id} autorizada OK (autorización directa)`);
        return;
      }

      // No está autorizada aún — re-enviar al SRI (puede haber expirado o nunca llegó)
      await prisma.facturas.update({
        where: { id: factura.id },
        data:  { estadoSri: 'ENVIADO' },
      });
    }

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      const mensajes = recepcion.mensajes || recepcion.recepcion?.mensajes || [];
      if (esLimiteError(mensajes)) {
        const reintentar = reintentarDesdeManana();
        await prisma.facturas.update({
          where: { id: factura.id },
          data: {
            estadoSri:   'FIRMADO_PENDIENTE_ENVIO',
            xmlFirmado:  null, // re-firmar mañana con el cert correcto
            mensajesSri: { ...recepcion, reintentarDesde: reintentar, limiteError: true },
          },
        });
        console.log(`[ColaSRI] Factura #${factura.id} — error 90 SRI, reintentará ${reintentar}`);
        return;
      }
      await prisma.facturas.update({
        where: { id: factura.id },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const autorizacion_result = await sri.autorizarComprobanteSRI(factura.claveAcceso, config.ambiente);
    if (autorizacion_result.autorizado) {
      const DIR_FACTURAS = path.join(__dirname, '..', 'uploads', 'facturas');
      const pdfPath = path.join(DIR_FACTURAS, `factura-${factura.id}.pdf`);
      await sri.generarRIDEFactura(
        { ...factura, xmlAutorizado: autorizacion_result.xmlAutorizado },
        config,
        pdfPath
      );

      await prisma.facturas.update({
        where: { id: factura.id },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion: autorizacion_result.numeroAutorizacion,
          fechaAutorizacion:  autorizacion_result.fechaAutorizacion,
          xmlAutorizado:      autorizacion_result.xmlAutorizado,
          mensajesSri:        { autorizacion: autorizacion_result.estado },
          pdfUrl:             `/uploads/facturas/factura-${factura.id}.pdf`,
        },
      });

      // Asiento contable
      try {
        const { crearAsientoFacturaAutorizada } = require('./contabilidad');
        await crearAsientoFacturaAutorizada({
          facturaId: factura.id,
          usuarioId: factura.emisorId,
          fecha: factura.fechaEmision || new Date(),
        });
      } catch (_) {}

      console.log(`[ColaSRI] Factura #${factura.id} autorizada OK (reintento)`);
    } else {
      const esRechazoReal = autorizacion_result.mensajes && autorizacion_result.mensajes.length > 0;
      await prisma.facturas.update({
        where: { id: factura.id },
        data: {
          estadoSri: esRechazoReal ? 'RECHAZADO' : 'FIRMADO_PENDIENTE_ENVIO',
          mensajesSri: { recepcion, autorizacion: autorizacion_result.mensajes },
        },
      });
      if (esRechazoReal) console.log(`[ColaSRI] Factura #${factura.id} rechazada por SRI`);
    }
  } catch (err) {
    if (esErrorConectividad(err)) {
      // Volver a FIRMADO_PENDIENTE_ENVIO para reintentar después
      await prisma.facturas.update({
        where: { id: factura.id },
        data:  { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
      }).catch(() => {});
    } else {
      await prisma.facturas.update({
        where: { id: factura.id },
        data:  { estadoSri: 'ERROR', mensajesSri: { error: err.message } },
      }).catch(() => {});
      console.error(`[ColaSRI] Error no recuperable en factura #${factura.id}:`, err.message);
    }
  }
}

// ─── Reintento: Retención ───────────────────────────────────
async function reintentarRetencion(retencion) {
  if (estaEnEspera(retencion.mensajesSri)) {
    console.log(`[ColaSRI] Retención #${retencion.id} en espera hasta ${retencion.mensajesSri.reintentarDesde} (límite SRI error 90)`);
    return;
  }

  const config = await getConfigSRI(retencion.empresaId);
  if (!config || config.tipoCertificado === 'token') return;
  if (!tieneCertificado(config)) return;

  try {
    let xmlFirmado = retencion.xmlFirmado;
    if (!xmlFirmado) {
      const p12Buffer = getCertBuffer(config);
      xmlFirmado = sri.firmarXML(retencion.xmlGenerado, p12Buffer, config.claveCertificado || '');
    }

    await prisma.retenciones.update({
      where: { id: retencion.id },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      const mensajes = recepcion.mensajes || recepcion.recepcion?.mensajes || [];
      if (esLimiteError(mensajes)) {
        const reintentar = reintentarDesdeManana();
        await prisma.retenciones.update({
          where: { id: retencion.id },
          data: {
            estadoSri:   'FIRMADO_PENDIENTE_ENVIO',
            xmlFirmado:  null,
            mensajesSri: { ...recepcion, reintentarDesde: reintentar, limiteError: true },
          },
        });
        console.log(`[ColaSRI] Retención #${retencion.id} — error 90 SRI, reintentará ${reintentar}`);
        return;
      }
      await prisma.retenciones.update({
        where: { id: retencion.id },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const autorizacion = await sri.autorizarComprobanteSRI(retencion.claveAcceso, config.ambiente);
    if (autorizacion.autorizado) {
      const DIR_RETENCIONES = path.join(__dirname, '..', 'uploads', 'retenciones');
      const pdfFilename = `retencion-${retencion.claveAcceso}.pdf`;
      const pdfPath = path.join(DIR_RETENCIONES, pdfFilename);
      await sri.generarRIDERetencion(
        { ...retencion, numeroAutorizacion: autorizacion.numeroAutorizacion, fechaAutorizacion: autorizacion.fechaAutorizacion },
        config,
        pdfPath
      );

      await prisma.retenciones.update({
        where: { id: retencion.id },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado || xmlFirmado,
          pdfUrl:             `/uploads/retenciones/${pdfFilename}`,
          mensajesSri:        autorizacion.mensajes,
        },
      });

      try {
        const { crearAsientoRetencionAutorizada } = require('./contabilidad');
        await crearAsientoRetencionAutorizada({
          retencionId: retencion.id,
          usuarioId: retencion.emisorId,
          fecha: retencion.fechaEmision || new Date(),
        });
      } catch (_) {}

      console.log(`[ColaSRI] Retención #${retencion.id} autorizada OK (reintento)`);
    } else {
      await prisma.retenciones.update({
        where: { id: retencion.id },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: autorizacion },
      });
    }
  } catch (err) {
    if (esErrorConectividad(err)) {
      await prisma.retenciones.update({
        where: { id: retencion.id },
        data:  { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
      }).catch(() => {});
    } else {
      await prisma.retenciones.update({
        where: { id: retencion.id },
        data:  { estadoSri: 'ERROR', mensajesSri: { error: err.message } },
      }).catch(() => {});
      console.error(`[ColaSRI] Error no recuperable en retención #${retencion.id}:`, err.message);
    }
  }
}

// ─── Reintento: Liquidación de compra ───────────────────────
async function reintentarLiquidacion(liq) {
  if (estaEnEspera(liq.mensajesSri)) {
    console.log(`[ColaSRI] Liquidación #${liq.id} en espera hasta ${liq.mensajesSri.reintentarDesde} (límite SRI error 90)`);
    return;
  }

  const config = await getConfigSRI(liq.empresaId);
  if (!config || config.tipoCertificado === 'token') return;
  if (!tieneCertificado(config)) return;

  try {
    let xmlFirmado = liq.xmlFirmado;
    if (!xmlFirmado) {
      const p12Buffer = getCertBuffer(config);
      xmlFirmado = sri.firmarXML(liq.xmlGenerado, p12Buffer, config.claveCertificado || '');
    }

    await prisma.liquidaciones_compra.update({
      where: { id: liq.id },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      const mensajes = recepcion.mensajes || recepcion.recepcion?.mensajes || [];
      if (esLimiteError(mensajes)) {
        const reintentar = reintentarDesdeManana();
        await prisma.liquidaciones_compra.update({
          where: { id: liq.id },
          data: {
            estadoSri:   'FIRMADO_PENDIENTE_ENVIO',
            xmlFirmado:  null,
            mensajesSri: { ...recepcion, reintentarDesde: reintentar, limiteError: true },
          },
        });
        console.log(`[ColaSRI] Liquidación #${liq.id} — error 90 SRI, reintentará ${reintentar}`);
        return;
      }
      await prisma.liquidaciones_compra.update({
        where: { id: liq.id },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const autorizacion = await sri.autorizarComprobanteSRI(liq.claveAcceso, config.ambiente);
    if (autorizacion.autorizado) {
      await prisma.liquidaciones_compra.update({
        where: { id: liq.id },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado || xmlFirmado,
          mensajesSri:        autorizacion.mensajes,
        },
      });
      console.log(`[ColaSRI] Liquidación #${liq.id} autorizada OK (reintento)`);
    } else {
      await prisma.liquidaciones_compra.update({
        where: { id: liq.id },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: autorizacion },
      });
    }
  } catch (err) {
    if (esErrorConectividad(err)) {
      await prisma.liquidaciones_compra.update({
        where: { id: liq.id },
        data:  { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
      }).catch(() => {});
    } else {
      await prisma.liquidaciones_compra.update({
        where: { id: liq.id },
        data:  { estadoSri: 'ERROR', mensajesSri: { error: err.message } },
      }).catch(() => {});
    }
  }
}

// ─── Reintento: Nota de Débito ──────────────────────────────
async function reintentarNotaDebito(nd) {
  if (estaEnEspera(nd.mensajesSri)) {
    console.log(`[ColaSRI] Nota Débito #${nd.id} en espera hasta ${nd.mensajesSri.reintentarDesde} (límite SRI error 90)`);
    return;
  }

  const config = await getConfigSRI(nd.empresaId);
  if (!config || config.tipoCertificado === 'token') return;
  if (!tieneCertificado(config)) return;

  try {
    let xmlFirmado = nd.xmlFirmado;
    if (!xmlFirmado) {
      const p12Buffer = getCertBuffer(config);
      xmlFirmado = sri.firmarXML(nd.xmlGenerado, p12Buffer, config.claveCertificado || '');
    }

    await prisma.notas_debito.update({ where: { id: nd.id }, data: { xmlFirmado, estadoSri: 'ENVIADO' } });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      const mensajes = recepcion.mensajes || recepcion.recepcion?.mensajes || [];
      if (esLimiteError(mensajes)) {
        const reintentar = reintentarDesdeManana();
        await prisma.notas_debito.update({
          where: { id: nd.id },
          data: {
            estadoSri:   'FIRMADO_PENDIENTE_ENVIO',
            xmlFirmado:  null,
            mensajesSri: { ...recepcion, reintentarDesde: reintentar, limiteError: true },
          },
        });
        console.log(`[ColaSRI] Nota Débito #${nd.id} — error 90 SRI, reintentará ${reintentar}`);
        return;
      }
      await prisma.notas_debito.update({ where: { id: nd.id }, data: { estadoSri: 'RECHAZADO', mensajesSri: recepcion } });
      return;
    }

    const autorizacion = await sri.autorizarComprobanteSRI(nd.claveAcceso, config.ambiente);
    if (autorizacion.autorizado) {
      const DIR_ND = path.join(__dirname, '..', 'uploads', 'notas_debito');
      const pdfFilename = `nd-${nd.claveAcceso}.pdf`;
      await sri.generarRIDENotaDebito({ ...nd, motivos: nd.motivos }, config, path.join(DIR_ND, pdfFilename));
      await prisma.notas_debito.update({
        where: { id: nd.id },
        data: {
          estadoSri: 'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado || xmlFirmado,
          pdfUrl:             `/uploads/notas_debito/${pdfFilename}`,
          mensajesSri:        { autorizacion: autorizacion.estado },
        },
      });
      console.log(`[ColaSRI] Nota de Débito #${nd.id} autorizada OK (reintento)`);
    } else {
      await prisma.notas_debito.update({ where: { id: nd.id }, data: { estadoSri: 'RECHAZADO', mensajesSri: autorizacion } });
    }
  } catch (err) {
    if (esErrorConectividad(err)) {
      await prisma.notas_debito.update({ where: { id: nd.id }, data: { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' } }).catch(() => {});
    } else {
      await prisma.notas_debito.update({ where: { id: nd.id }, data: { estadoSri: 'ERROR', mensajesSri: { error: err.message } } }).catch(() => {});
    }
  }
}

// ─── Reintento: Nota de Crédito ─────────────────────────────
async function reintentarNotaCredito(nc) {
  if (estaEnEspera(nc.mensajesSri)) {
    console.log(`[ColaSRI] Nota Crédito #${nc.id} en espera hasta ${nc.mensajesSri.reintentarDesde} (límite SRI error 90)`);
    return;
  }

  const config = await getConfigSRI(nc.empresaId);
  if (!config || config.tipoCertificado === 'token') return;
  if (!tieneCertificado(config)) return;

  try {
    let xmlFirmado = nc.xmlFirmado;
    if (!xmlFirmado) {
      const p12Buffer = getCertBuffer(config);
      xmlFirmado = sri.firmarXML(nc.xmlGenerado, p12Buffer, config.claveCertificado || '');
    }

    await prisma.notas_credito.update({
      where: { id: nc.id },
      data:  { xmlFirmado, estadoSri: 'ENVIADO' },
    });

    const recepcion = await sri.enviarComprobanteSRI(xmlFirmado, config.ambiente);
    if (recepcion.estado !== 'RECIBIDA') {
      const mensajes = recepcion.mensajes || recepcion.recepcion?.mensajes || [];
      if (esLimiteError(mensajes)) {
        const reintentar = reintentarDesdeManana();
        await prisma.notas_credito.update({
          where: { id: nc.id },
          data: {
            estadoSri:   'FIRMADO_PENDIENTE_ENVIO',
            xmlFirmado:  null,
            mensajesSri: { ...recepcion, reintentarDesde: reintentar, limiteError: true },
          },
        });
        console.log(`[ColaSRI] Nota Crédito #${nc.id} — error 90 SRI, reintentará ${reintentar}`);
        return;
      }
      await prisma.notas_credito.update({
        where: { id: nc.id },
        data:  { estadoSri: 'RECHAZADO', mensajesSri: recepcion },
      });
      return;
    }

    const autorizacion = await sri.autorizarComprobanteSRI(nc.claveAcceso, config.ambiente);
    if (autorizacion.autorizado) {
      const DIR_FACTURAS = path.join(__dirname, '..', 'uploads', 'facturas');
      const pdfPath = path.join(DIR_FACTURAS, `nc-${nc.id}.pdf`);
      await sri.generarRIDENotaCredito(
        { ...nc, xmlAutorizado: autorizacion.xmlAutorizado },
        config,
        pdfPath
      );
      await prisma.notas_credito.update({
        where: { id: nc.id },
        data: {
          estadoSri:          'AUTORIZADO',
          numeroAutorizacion: autorizacion.numeroAutorizacion,
          fechaAutorizacion:  autorizacion.fechaAutorizacion,
          xmlAutorizado:      autorizacion.xmlAutorizado || xmlFirmado,
          pdfUrl:             `/uploads/facturas/nc-${nc.id}.pdf`,
          mensajesSri:        { autorizacion: autorizacion.estado },
        },
      });
      console.log(`[ColaSRI] Nota de Crédito #${nc.id} autorizada OK (reintento)`);
    } else {
      const esRechazoReal = autorizacion.mensajes && autorizacion.mensajes.length > 0;
      await prisma.notas_credito.update({
        where: { id: nc.id },
        data: {
          estadoSri:   esRechazoReal ? 'RECHAZADO' : 'FIRMADO_PENDIENTE_ENVIO',
          mensajesSri: autorizacion,
        },
      });
    }
  } catch (err) {
    if (esErrorConectividad(err)) {
      await prisma.notas_credito.update({
        where: { id: nc.id },
        data:  { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
      }).catch(() => {});
    } else {
      await prisma.notas_credito.update({
        where: { id: nc.id },
        data:  { estadoSri: 'ERROR', mensajesSri: { error: err.message } },
      }).catch(() => {});
      console.error(`[ColaSRI] Error no recuperable en NC #${nc.id}:`, err.message);
    }
  }
}

// ─── Ciclo principal del worker ─────────────────────────────
let _workerActivo = false;

async function ejecutarCiclo() {
  if (_workerActivo) return;
  _workerActivo = true;

  try {
    const [facturas, retenciones, liquidaciones, notasDebito, notasCredito] = await Promise.all([
      prisma.facturas.findMany({
        where:   { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
        select:  {
          id: true, empresaId: true, emisorId: true, claveAcceso: true,
          xmlGenerado: true, xmlFirmado: true, fechaEmision: true, mensajesSri: true,
        },
        orderBy: { createdAt: 'asc' },
        take:    20,
      }),
      prisma.retenciones.findMany({
        where:   { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
        select:  {
          id: true, empresaId: true, emisorId: true, claveAcceso: true,
          xmlGenerado: true, xmlFirmado: true, fechaEmision: true, mensajesSri: true,
        },
        orderBy: { createdAt: 'asc' },
        take:    20,
      }),
      prisma.liquidaciones_compra.findMany({
        where:   { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
        select:  {
          id: true, empresaId: true, claveAcceso: true,
          xmlGenerado: true, xmlFirmado: true, mensajesSri: true,
        },
        orderBy: { createdAt: 'asc' },
        take:    20,
      }),
      prisma.notas_debito.findMany({
        where:   { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
        select:  {
          id: true, empresaId: true, claveAcceso: true,
          xmlGenerado: true, xmlFirmado: true, motivos: true, mensajesSri: true,
        },
        orderBy: { createdAt: 'asc' },
        take:    20,
      }),
      prisma.notas_credito.findMany({
        where:   { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' },
        select:  {
          id: true, empresaId: true, claveAcceso: true,
          xmlGenerado: true, xmlFirmado: true, mensajesSri: true,
        },
        orderBy: { createdAt: 'asc' },
        take:    20,
      }),
    ]);

    const total = facturas.length + retenciones.length + liquidaciones.length + notasDebito.length + notasCredito.length;
    if (total > 0) {
      console.log(`[ColaSRI] Procesando ${total} comprobantes pendientes...`);
    }

    // Procesar secuencialmente para no sobrecargar el SRI
    for (const f of facturas)      await reintentarFactura(f);
    for (const r of retenciones)   await reintentarRetencion(r);
    for (const l of liquidaciones) await reintentarLiquidacion(l);
    for (const n of notasDebito)   await reintentarNotaDebito(n);
    for (const nc of notasCredito) await reintentarNotaCredito(nc);

  } catch (err) {
    console.error('[ColaSRI] Error en ciclo:', err.message);
  } finally {
    _workerActivo = false;
  }
}

// ─── Consulta de pendientes (para el badge del frontend) ────
async function contarPendientes(empresaId) {
  const where = { estadoSri: 'FIRMADO_PENDIENTE_ENVIO' };
  if (empresaId) {
    where.empresaId = empresaId;
  }

  const [facturas, retenciones, liquidaciones, notasDebito, notasCredito] = await Promise.all([
    prisma.facturas.count({ where }),
    prisma.retenciones.count({ where }),
    prisma.liquidaciones_compra.count({ where }),
    prisma.notas_debito.count({ where }),
    prisma.notas_credito.count({ where }),
  ]);

  return { facturas, retenciones, liquidaciones, notasDebito, notasCredito, total: facturas + retenciones + liquidaciones + notasDebito + notasCredito };
}

// ─── Iniciar worker ─────────────────────────────────────────
const INTERVALO_MS = 2 * 60 * 1000; // 2 minutos
let _intervalId = null;

function iniciarWorkerColaSRI() {
  if (_intervalId) return; // ya iniciado

  // Primera ejecución en 30 segundos (dar tiempo al servidor de arrancar)
  setTimeout(ejecutarCiclo, 30_000);

  _intervalId = setInterval(ejecutarCiclo, INTERVALO_MS);
  console.log('[ColaSRI] Worker iniciado — reintenta cada 2 minutos');
}

function detenerWorkerColaSRI() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    console.log('[ColaSRI] Worker detenido');
  }
}

module.exports = {
  iniciarWorkerColaSRI,
  detenerWorkerColaSRI,
  ejecutarCiclo,
  contarPendientes,
  esErrorConectividad,
};
