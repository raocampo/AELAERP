// ====================================
// Verificación automática del régimen tributario del EMISOR contra el SRI
// backend/utils/regimenSri.js
//
// El contribuyente puede cambiar de régimen (RIMPE Negocio Popular ⇄ RIMPE
// Emprendedor ⇄ Régimen General) o de obligación de llevar contabilidad sin
// avisar a AELA; si la configuración queda desactualizada, el XML y el RIDE
// salen con la leyenda equivocada (caso real 2026-11-13: Corp Simtelec pasó a
// GENERAL el 31/07/2026 y siguió facturando como "CONTRIBUYENTE RÉGIMEN RIMPE").
//
// Un worker (iniciarVerificacionRegimen) revisa cada empresa una vez al día
// —BD principal y cada tenant activo— contra el catastro público del SRI y,
// si difiere, actualiza configuracion_sri con los mismos efectos que el
// cambio manual (aplicarCambioRegimen) y deja constancia en regimenSriCambio
// para el aviso del Dashboard.
// ====================================

const prisma = require('../config/prisma');
const { getPrismaMaster } = require('../config/prismaMaster');
const { getTenantPrisma } = require('../config/prismaTenant');
const { consultarContribuyenteSri } = require('./sriContribuyente');
const { asegurarConfiguracionSistemaEmpresa } = require('./configuracionSistema');

const HORAS_ENTRE_VERIFICACIONES = 20;
const INTERVALO_MS = 6 * 60 * 60 * 1000; // cada 6 h revisa las que tengan > 20 h
const PAUSA_ENTRE_CONSULTAS_MS = 1500;   // no saturar el catastro del SRI

/**
 * Régimen según la respuesta del catastro (ConsolidadoContribuyente).
 * `regimen` es "GENERAL" o "RIMPE"; `categoria` es "NEGOCIO POPULAR" o
 * "EMPRENDEDOR" (null en GENERAL). Devuelve null si la respuesta no permite
 * decidir con certeza — en ese caso no se toca nada.
 */
function regimenDesdeSri(datos, rucEsperado) {
  if (!datos) return null;
  if (rucEsperado && String(datos.numeroRuc || '') !== String(rucEsperado)) return null;
  const regimen = String(datos.regimen || '').trim().toUpperCase();
  if (regimen !== 'GENERAL' && regimen !== 'RIMPE') return null;
  const categoria = String(datos.categoria || '').trim().toUpperCase();
  const contab = String(datos.obligadoLlevarContabilidad || '').trim().toUpperCase();
  return {
    contribuyenteRimpe: regimen === 'RIMPE',
    negocioPopular: regimen === 'RIMPE' && categoria.includes('NEGOCIO POPULAR'),
    obligadoContabilidad: contab === 'SI' ? true : contab === 'NO' ? false : null,
  };
}

function etiquetaRegimen({ contribuyenteRimpe, negocioPopular }) {
  if (!contribuyenteRimpe) return 'Régimen General';
  return negocioPopular ? 'RIMPE Negocio Popular' : 'RIMPE Emprendedor';
}

/**
 * Efectos de entrar o salir de Negocio Popular (compartido con el cambio
 * manual en PUT /api/facturas/configuracion):
 * 1. Documento predeterminado del POS: nota de venta en Negocio Popular,
 *    factura fuera de él.
 * 2. Precio de catálogo: Negocio Popular lo usa con IVA incluido; el resto
 *    como base sin IVA — se recalcula todo el catálogo en un UPDATE.
 */
async function aplicarCambioRegimen({ db, empresaId, eraPopular, ahoraPopular }) {
  if (!!eraPopular === !!ahoraPopular) return;
  const nuevoDefaultPos = ahoraPopular ? 'nota_venta' : 'factura';
  const configSistema = await asegurarConfiguracionSistemaEmpresa(empresaId, db);
  if (configSistema && configSistema.documentoPosDefault !== nuevoDefaultPos) {
    await db.configuracion_sistema.update({
      where: { empresaId },
      data: { documentoPosDefault: nuevoDefaultPos },
    });
  }
  if (ahoraPopular) {
    await db.$executeRaw`
      UPDATE productos_servicios
      SET "precioUnitario" = ROUND("precioUnitario" * (1 + "tarifaIva"::numeric / 100), 2)
      WHERE "empresaId" = ${empresaId}
    `;
  } else {
    await db.$executeRaw`
      UPDATE productos_servicios
      SET "precioUnitario" = ROUND("precioUnitario" / (1 + "tarifaIva"::numeric / 100), 2)
      WHERE "empresaId" = ${empresaId}
    `;
  }
}

/**
 * Compara una configuracion_sri con el SRI y la actualiza si cambió.
 * `consultar` es inyectable para pruebas. Devuelve { estado, cambios? }.
 */
async function sincronizarRegimenConfig({ db, config, consultar = consultarContribuyenteSri, ahora = new Date() }) {
  const ruc = String(config.ruc || '').trim();
  if (!/^\d{13}$/.test(ruc)) return { estado: 'sin_ruc' };

  const sri = regimenDesdeSri(await consultar(ruc), ruc);
  if (!sri) return { estado: 'sri_no_disponible' };

  const antes = {
    contribuyenteRimpe: !!config.contribuyenteRimpe,
    negocioPopular: !!config.negocioPopular,
    obligadoContabilidad: !!config.obligadoContabilidad,
  };
  const despues = {
    contribuyenteRimpe: sri.contribuyenteRimpe,
    negocioPopular: sri.negocioPopular,
    obligadoContabilidad: sri.obligadoContabilidad === null ? antes.obligadoContabilidad : sri.obligadoContabilidad,
  };
  const cambios = Object.keys(antes).filter((k) => antes[k] !== despues[k]);

  if (cambios.length === 0) {
    await db.configuracion_sri.update({ where: { id: config.id }, data: { regimenSriVerificadoEn: ahora } });
    return { estado: 'sin_cambios' };
  }

  await db.configuracion_sri.update({
    where: { id: config.id },
    data: {
      ...despues,
      regimenSriVerificadoEn: ahora,
      regimenSriCambio: {
        fecha: ahora.toISOString(),
        antes: { ...antes, regimen: etiquetaRegimen(antes) },
        despues: { ...despues, regimen: etiquetaRegimen(despues) },
        cambios,
      },
    },
  });
  await aplicarCambioRegimen({
    db, empresaId: config.empresaId,
    eraPopular: antes.negocioPopular, ahoraPopular: despues.negocioPopular,
  });
  return { estado: 'actualizado', cambios, antes, despues };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Revisa las configuraciones activas de una BD que no se verificaron en las
// últimas HORAS_ENTRE_VERIFICACIONES horas.
async function verificarRegimenEnDB(db, etiqueta, { forzar = false } = {}) {
  const limite = new Date(Date.now() - HORAS_ENTRE_VERIFICACIONES * 3600 * 1000);
  const configs = await db.configuracion_sri.findMany({
    where: {
      activo: true,
      ...(forzar ? {} : { OR: [{ regimenSriVerificadoEn: null }, { regimenSriVerificadoEn: { lt: limite } }] }),
    },
  });
  for (const config of configs) {
    try {
      const r = await sincronizarRegimenConfig({ db, config });
      if (r.estado === 'actualizado') {
        console.log(`[RegimenSRI] ${etiqueta} empresa ${config.empresaId} (${config.ruc}): ${etiquetaRegimen(r.antes)} -> ${etiquetaRegimen(r.despues)} [${r.cambios.join(', ')}]`);
      }
    } catch (err) {
      console.error(`[RegimenSRI] ${etiqueta} empresa ${config.empresaId}:`, err.message);
    }
    await esperar(PAUSA_ENTRE_CONSULTAS_MS);
  }
}

let _activo = false;
async function ejecutarVerificacionRegimen(opciones = {}) {
  if (_activo) return;
  _activo = true;
  try {
    await verificarRegimenEnDB(prisma, 'principal', opciones);
    const master = getPrismaMaster();
    if (master) {
      const tenants = await master.tenants.findMany({ where: { estado: 'activo' } });
      for (const tenant of tenants) {
        try {
          const db = await getTenantPrisma(tenant);
          await prisma.runWithClient(db, () => verificarRegimenEnDB(db, tenant.slug, opciones));
        } catch (err) {
          console.error(`[RegimenSRI] tenant "${tenant.slug}":`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[RegimenSRI] Error en ciclo:', err.message);
  } finally {
    _activo = false;
  }
}

let _intervalId = null;
function iniciarVerificacionRegimen() {
  if (_intervalId || process.env.DESACTIVAR_VERIFICACION_REGIMEN === '1') return;
  setTimeout(ejecutarVerificacionRegimen, 2 * 60 * 1000);
  _intervalId = setInterval(ejecutarVerificacionRegimen, INTERVALO_MS);
  console.log('[RegimenSRI] Verificación diaria del régimen contra el SRI iniciada');
}

module.exports = {
  regimenDesdeSri,
  etiquetaRegimen,
  aplicarCambioRegimen,
  sincronizarRegimenConfig,
  ejecutarVerificacionRegimen,
  iniciarVerificacionRegimen,
};
