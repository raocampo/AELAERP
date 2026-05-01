const https  = require('https');
const prisma = require('../config/prisma');

function requestSri(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          data,
        });
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function consultarContribuyenteSri(ruc) {
  const endpoints = [
    `https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumeroRuc?numeroRuc=${ruc}`,
    `https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerRuc?numeroRuc=${ruc}`,
  ];

  for (const url of endpoints) {
    const respuesta = await requestSri(url);
    if (!respuesta?.ok || !respuesta.data) continue;
    try {
      return JSON.parse(respuesta.data);
    } catch {
      continue;
    }
  }

  return null;
}

async function verificarExistenciaContribuyenteSri(ruc) {
  const respuesta = await requestSri(
    `https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/existePorNumeroRuc?numeroRuc=${ruc}`
  );

  if (!respuesta?.ok) return null;

  const texto = String(respuesta.data || '').trim().toLowerCase();
  if (texto === 'true') return true;
  if (texto === 'false') return false;
  return null;
}

function parsearContribuyenteSri(datos, identificacionOriginal) {
  if (!datos) return null;

  const contribuyente = datos.contribuyente || datos;
  if (!contribuyente || !contribuyente.razonSocial) return null;

  let direccion = null;
  if (Array.isArray(contribuyente.direcciones) && contribuyente.direcciones.length > 0) {
    direccion = contribuyente.direcciones[0].direccionCompleta || contribuyente.direcciones[0].calle || null;
  }

  const resumenRegimen = [
    contribuyente.regimen,
    contribuyente.claseContribuyente,
    contribuyente.tipoContribuyente,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const valorSiNo = (valor) => {
    if (valor === true || valor === false) return valor;
    return String(valor || '').trim().toUpperCase() === 'SI';
  };

  return {
    tipoIdentificacion: identificacionOriginal?.length === 10 ? '05' : '04',
    identificacion: identificacionOriginal || contribuyente.numeroRuc || null,
    ruc: contribuyente.numeroRuc || identificacionOriginal || null,
    razonSocial: contribuyente.razonSocial?.trim().toUpperCase() || '',
    nombreComercial: contribuyente.nombreComercial?.trim() || null,
    direccion,
    estado: contribuyente.estadoContribuyente || null,
    contribuyenteEspecial:
      contribuyente.contribuyenteEspecial ||
      contribuyente.numResolucionContribuyenteEspecial ||
      null,
    contribuyenteRimpe: resumenRegimen.includes('rimpe'),
    negocioPopular: resumenRegimen.includes('negocio popular'),
    obligadoContabilidad: valorSiNo(
      contribuyente.obligadoContabilidad || contribuyente.obligadoLlevarContabilidad,
    ),
    agenteRetencion:
      contribuyente.agenteRetencion ||
      contribuyente.resolucionAgenteRetencion ||
      null,
    email: contribuyente.email || contribuyente.correoElectronico || null,
    telefono: contribuyente.telefono || null,
  };
}

// ─── Consulta catastro local (BD PostgreSQL) ─────────────────────────────────
// Retorna objeto compatible con parsearContribuyenteSri, o null si no existe.
// El catastro se carga con: node scripts/importarCatastroSRI.js
async function consultarCatastroLocal(identificacion) {
  try {
    // Para cédulas (10 dígitos), el RUC en el catastro es cédula + "001"
    const rucBusqueda = identificacion.length === 10
      ? `${identificacion}001`
      : identificacion;

    const row = await prisma.contribuyentes_sri.findUnique({
      where: { ruc: rucBusqueda },
    });

    if (!row) return null;

    return {
      tipoIdentificacion:   identificacion.length === 10 ? '05' : '04',
      identificacion,
      ruc:                  row.ruc,
      razonSocial:          row.razonSocial,
      nombreComercial:      row.nombreComercial || null,
      direccion:            null, // los CSVs del SRI no incluyen dirección detallada
      estado:               row.estado,
      contribuyenteEspecial: row.claseContribuyente === 'ESPECIAL' ? 'SI' : null,
      contribuyenteRimpe:   (row.claseContribuyente || '').toLowerCase().includes('rimpe'),
      negocioPopular:       (row.claseContribuyente || '').toLowerCase().includes('negocio popular'),
      obligadoContabilidad: row.obligadoContabilidad,
      agenteRetencion:      null,
      email:                null,
      telefono:             null,
      fuenteLocal:          true, // marca que viene del catastro local
    };
  } catch {
    return null;
  }
}

async function obtenerEmpresaSri(ruc) {
  const rucLimpio = String(ruc || '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(rucLimpio)) return null;

  const datos = await consultarContribuyenteSri(rucLimpio);
  return parsearContribuyenteSri(datos, rucLimpio);
}

function construirConfiguracionSriBase(empresa, datosSri = null) {
  const direccionBase = datosSri?.direccion || empresa?.direccion || 'POR DEFINIR';

  return {
    empresaId: empresa.id,
    ruc: empresa.ruc,
    razonSocial: datosSri?.razonSocial || empresa.razonSocial,
    nombreComercial: datosSri?.nombreComercial || empresa.nombreComercial || null,
    dirMatriz: direccionBase,
    dirEstablecimiento: direccionBase,
    establecimiento: '001',
    puntoEmision: '001',
    ambiente: 1,
    contribuyenteEspecial: datosSri?.contribuyenteEspecial || null,
    contribuyenteRimpe: Boolean(datosSri?.contribuyenteRimpe),
    negocioPopular: Boolean(datosSri?.negocioPopular),
    obligadoContabilidad: Boolean(datosSri?.obligadoContabilidad),
    agenteRetencion: datosSri?.agenteRetencion || null,
    tipoCertificado: 'archivo',
    emailNotificaciones: empresa.email || datosSri?.email || null,
    telefono: empresa.telefono || datosSri?.telefono || null,
    activo: true,
  };
}

async function asegurarConfiguracionSriEmpresa(tx, empresa, datosSri = null) {
  const existente = await tx.configuracion_sri.findFirst({
    where: { empresaId: empresa.id },
  });

  if (existente) {
    return existente;
  }

  return tx.configuracion_sri.create({
    data: construirConfiguracionSriBase(empresa, datosSri),
  });
}

module.exports = {
  consultarContribuyenteSri,
  verificarExistenciaContribuyenteSri,
  parsearContribuyenteSri,
  consultarCatastroLocal,
  obtenerEmpresaSri,
  construirConfiguracionSriBase,
  asegurarConfiguracionSriEmpresa,
};
