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

// El SRI descontinuó `obtenerPorNumeroRuc` (devuelve 404 desde ~2026) sin aviso
// público. El endpoint vigente es `obtenerPorNumerosRuc` (con "s", nótese el
// plural) con el parámetro `ruc` (no `numeroRuc`), y responde un ARRAY (no un
// objeto suelto). Ya no incluye dirección ni nombre comercial — esos datos
// ahora viven en el endpoint separado `Establecimiento/consultarPorNumeroRuc`,
// que se consulta en paralelo y se combina en un solo objeto compatible con
// parsearContribuyenteSri() (verificado empíricamente 2026-07-23 contra RUCs reales).
async function consultarContribuyenteSri(ruc) {
  const [consolidadoResp, establecimientoResp] = await Promise.all([
    requestSri(`https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/ConsolidadoContribuyente/obtenerPorNumerosRuc?&ruc=${ruc}`),
    requestSri(`https://srienlinea.sri.gob.ec/sri-catastro-sujeto-servicio-internet/rest/Establecimiento/consultarPorNumeroRuc?numeroRuc=${ruc}`),
  ]);

  let consolidado = null;
  if (consolidadoResp?.ok && consolidadoResp.data) {
    try {
      const lista = JSON.parse(consolidadoResp.data);
      consolidado = Array.isArray(lista) ? (lista[0] || null) : lista;
    } catch {
      consolidado = null;
    }
  }
  if (!consolidado) return null;

  let establecimientos = [];
  if (establecimientoResp?.ok && establecimientoResp.data) {
    try {
      const lista = JSON.parse(establecimientoResp.data);
      establecimientos = Array.isArray(lista) ? lista : [];
    } catch {
      establecimientos = [];
    }
  }
  const matriz = establecimientos.find((e) => String(e.matriz || '').toUpperCase() === 'SI') || establecimientos[0] || null;

  return {
    ...consolidado,
    nombreComercial: matriz?.nombreFantasiaComercial || null,
    direcciones: matriz?.direccionCompleta ? [{ direccionCompleta: matriz.direccionCompleta }] : [],
  };
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
    estado: contribuyente.estadoContribuyente || contribuyente.estadoContribuyenteRuc || null,
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
// Busca primero en contribuyentes_sri (CSVs del SRI), luego en directorio_global
// (catálogo acumulado de importaciones y creaciones manuales).
async function consultarCatastroLocal(identificacion) {
  try {
    // 1. Buscar en contribuyentes_sri (RUCs del SRI — solo 13 dígitos)
    // Para cédulas (10 dígitos), el RUC en el catastro es cédula + "001"
    const rucBusqueda = identificacion.length === 10
      ? `${identificacion}001`
      : identificacion;

    const row = await prisma.contribuyentes_sri.findUnique({
      where: { ruc: rucBusqueda },
    });

    if (row) {
      return {
        tipoIdentificacion:    identificacion.length === 10 ? '05' : '04',
        identificacion,
        ruc:                   row.ruc,
        razonSocial:           row.razonSocial,
        nombreComercial:       row.nombreComercial || null,
        direccion:             null, // los CSVs del SRI no incluyen dirección detallada
        estado:                row.estado,
        contribuyenteEspecial: row.claseContribuyente === 'ESPECIAL' ? 'SI' : null,
        contribuyenteRimpe:    (row.claseContribuyente || '').toLowerCase().includes('rimpe'),
        negocioPopular:        (row.claseContribuyente || '').toLowerCase().includes('negocio popular'),
        obligadoContabilidad:  row.obligadoContabilidad,
        agenteRetencion:       null,
        email:                 null,
        telefono:              null,
        fuenteLocal:           true,
      };
    }

    // 2. Fallback: directorio_global (acumula importaciones + creaciones manuales)
    //    Cubre cédulas, pasaportes e IDs que no están en el catastro SRI.
    const dir = await prisma.directorio_global.findUnique({
      where: { identificacion },
    });

    if (dir) {
      return {
        tipoIdentificacion:    dir.tipoIdentificacion,
        identificacion,
        ruc:                   null,
        razonSocial:           dir.razonSocial,
        nombreComercial:       dir.nombreComercial || null,
        direccion:             dir.direccion || null,
        estado:                'ACTIVO',
        contribuyenteEspecial: null,
        contribuyenteRimpe:    false,
        negocioPopular:        false,
        obligadoContabilidad:  false,
        agenteRetencion:       null,
        email:                 dir.email || null,
        telefono:              dir.telefono || null,
        fuenteLocal:           true,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// Mismo patrón que clientes.js/proveedores.js al buscar un contribuyente:
// catastro local primero (instantáneo, funciona offline, ~6.8M RUCs precargados
// desde CSVs del SRI), y solo si no está ahí se recurre a la API en vivo del SRI.
async function obtenerEmpresaSri(ruc) {
  const rucLimpio = String(ruc || '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(rucLimpio)) return null;

  const catastroLocal = await consultarCatastroLocal(rucLimpio);
  if (catastroLocal) return catastroLocal;

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
