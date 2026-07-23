// ============================================================
//  AELA — Buzón SRI: utilidades de parseo e importación
//  backend/utils/buzon.js
//
//  Funciones para recibir documentos electrónicos emitidos
//  por terceros y autorizados por el SRI, y registrarlos en
//  las tablas correspondientes de la empresa receptora.
// ============================================================

const { XMLParser } = require('fast-xml-parser');
const prisma = require('../config/prisma');

const XML_OPTIONS = {
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  cdataPropName: '__cdata',
};

// ─── Tipos de documento por código SRI ──────────────────────
const TIPOS_DOCUMENTO = {
  '01': { nombre: 'Factura', destino: 'facturas_compra' },
  '03': { nombre: 'Liquidación de Compra', destino: 'facturas_compra' },
  '04': { nombre: 'Nota de Crédito', destino: 'docs_recibidos_otros' },
  '05': { nombre: 'Nota de Débito', destino: 'docs_recibidos_otros' },
  '07': { nombre: 'Comprobante de Retención', destino: 'retenciones_recibidas' },
};

// ─── Helpers ────────────────────────────────────────────────
function limpiar(valor) {
  return String(valor || '').trim();
}

function toNum(valor, fallback = 0) {
  const n = Number(String(valor || '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function ensureArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parsearFecha(texto) {
  if (!texto) return new Date();
  const partes = String(texto).split('/');
  if (partes.length === 3) {
    return new Date(`${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}T00:00:00`);
  }
  return new Date(texto);
}

// ─── 1. Detectar tipo desde clave de acceso ─────────────────
/**
 * Los dígitos 9-10 (1-indexed) de la clave de acceso de 49 dígitos
 * indican el tipo de comprobante SRI.
 */
function detectarTipoDesdeClaveAcceso(clave) {
  const c = limpiar(clave);
  if (c.length !== 49) return null;
  const cod = c.substring(8, 10); // posiciones 9-10 (base 1) = índices 8-9
  return TIPOS_DOCUMENTO[cod] ? { cod, ...TIPOS_DOCUMENTO[cod] } : null;
}

// ─── 2. Extraer XML interno desde respuesta autorizada ──────
function extraerXmlPrincipal(xmlString) {
  const cdataMatch = xmlString.match(/<comprobante><!\[CDATA\[([\s\S]*?)\]\]><\/comprobante>/i);
  if (cdataMatch) return cdataMatch[1];
  const compMatch = xmlString.match(/<comprobante>([\s\S]*?)<\/comprobante>/i);
  return compMatch ? compMatch[1] : xmlString;
}

function extraerNumeroAutorizacion(xmlString) {
  const m = xmlString.match(/<numeroAutorizacion>([^<]+)<\/numeroAutorizacion>/i);
  return m ? m[1] : null;
}

function extraerFechaAutorizacion(xmlString) {
  const m = xmlString.match(/<fechaAutorizacion>([^<]+)<\/fechaAutorizacion>/i);
  if (!m) return null;
  try { return new Date(m[1]); } catch { return null; }
}

// ─── 3. Extraer RUC/cédula del receptor desde el XML ────────
/**
 * Cada tipo de documento SRI identifica al receptor en un campo diferente.
 * Devuelve solo dígitos para facilitar la comparación.
 */
function extraerIdentificacionReceptorXml(xmlString, tipoDoc) {
  try {
    const xmlPrincipal = extraerXmlPrincipal(xmlString);
    const parser = new XMLParser(XML_OPTIONS);
    const parsed = parser.parse(xmlPrincipal);
    let idReceptor = '';

    if (tipoDoc === '01' || tipoDoc === '03') {
      const doc = parsed?.factura || parsed?.liquidacionCompra || parsed;
      const info = doc?.infoFactura || doc?.infoLiquidacionCompra || {};
      idReceptor = limpiar(info?.identificacionComprador || '');
    } else if (tipoDoc === '07') {
      const doc = parsed?.comprobanteRetencion || parsed;
      const info = doc?.infoCompRetencion || doc?.infoRetencion || {};
      idReceptor = limpiar(info?.identificacionSujetoRetenido || '');
    } else if (tipoDoc === '04' || tipoDoc === '05') {
      const doc = parsed?.notaCredito || parsed?.notaDebito || Object.values(parsed || {})[0] || {};
      const info = doc?.infoNotaCredito || doc?.infoNotaDebito || {};
      idReceptor = limpiar(info?.identificacionComprador || info?.identificacionProveedor || '');
    }

    return idReceptor.replace(/\D/g, '');
  } catch {
    return '';
  }
}

// Compara RUC/cédula tolerando que el mismo contribuyente
// puede aparecer como cédula (10 dígitos) o RUC (cédula + 001 = 13 dígitos)
function rucCoincide(rucEmpresa, idReceptor) {
  if (!rucEmpresa || !idReceptor) return true; // sin datos no bloqueamos
  const e = rucEmpresa.replace(/\D/g, '');
  const r = idReceptor.replace(/\D/g, '');
  if (e === r) return true;
  // cedula → RUC: '0912345678' vs '0912345678001'
  if (e.length === 13 && r.length === 10 && e.startsWith(r)) return true;
  if (r.length === 13 && e.length === 10 && r.startsWith(e)) return true;
  return false;
}

// ─── 4. Parsear Retención Recibida (tipo 07) ─────────────────
/**
 * Parsea el XML de un comprobante de retención emitido por un
 * cliente (agente de retención) dirigido a la empresa receptora.
 */
function parsearRetencionRecibida(xmlAutorizado, xmlEnvuelto) {
  const xmlPrincipal = extraerXmlPrincipal(xmlEnvuelto || xmlAutorizado);
  const parser = new XMLParser(XML_OPTIONS);
  const parsed = parser.parse(xmlPrincipal);
  const doc = parsed?.comprobanteRetencion || parsed;
  const infoTrib = doc?.infoTributaria || {};
  const infoRet = doc?.infoCompRetencion || doc?.infoRetencion || {};

  let totalRetencionIva = 0;
  let totalRetencionRenta = 0;
  const detalles = [];
  let numDocSustento = null;

  function acumular(codigo, valorRetener, extra) {
    const detalle = {
      codigo,
      codigoRetencion: limpiar(extra.codigoRetencion),
      porcentajeRetener: toNum(extra.porcentajeRetener || extra.porcentaje, 0),
      valorRetener,
      baseImponible: toNum(extra.baseImponible, 0),
      numDocSustento: extra.numDocSustento || null,
      fechaEmisionDocSustento: extra.fechaEmisionDocSustento || null,
    };
    detalles.push(detalle);
    if (!numDocSustento) numDocSustento = detalle.numDocSustento;
    if (codigo === '1') totalRetencionRenta += valorRetener;
    else if (codigo === '2' || codigo === '4' || codigo === '6') totalRetencionIva += valorRetener;
    else totalRetencionRenta += valorRetener; // ISD u otro
  }

  // El tag real del SRI para el monto es <valorRetenido> en ambas versiones
  // del schema (mismo que usa este sistema al emitir, ver sri.js). valorRetener
  // /valor quedan como fallback tolerante ante variaciones de algún emisor.
  const valorDe = (o) => toNum(o.valorRetenido ?? o.valorRetener ?? o.valor, 0);

  // Schema v2.0.0 (el más común en la práctica): las retenciones van
  // anidadas por documento sustento — docsSustento.docSustento[].retenciones.retencion[]
  const docsSustento = ensureArray(doc?.docsSustento?.docSustento);
  if (docsSustento.length > 0) {
    for (const ds of docsSustento) {
      const numDoc = limpiar(ds.numDocSustento || '') || null;
      const fechaDoc = limpiar(ds.fechaEmisionDocSustento || '') || null;
      const retenciones = ensureArray(ds?.retenciones?.retencion);
      for (const ret of retenciones) {
        acumular(limpiar(ret.codigo), valorDe(ret), { ...ret, numDocSustento: numDoc, fechaEmisionDocSustento: fechaDoc });
      }
    }
  } else {
    // Schema v1.0.0 (formato plano, el mismo que genera sri.js): impuestos.impuesto[]
    const impuestos = ensureArray(doc?.impuestos?.impuesto);
    for (const imp of impuestos) {
      acumular(limpiar(imp.codigo), valorDe(imp), {
        ...imp,
        numDocSustento: limpiar(imp.numDocSustento || imp.numeroDocSustento || '') || null,
        fechaEmisionDocSustento: limpiar(imp.fechaEmisionDocSustento || '') || null,
      });
    }
  }

  return {
    rucAgente: limpiar(infoTrib.ruc || ''),
    razonSocialAgente: limpiar(infoTrib.razonSocial || ''),
    fechaEmision: parsearFecha(infoRet.fechaEmision || infoTrib.fechaEmision || ''),
    numDocSustento,
    totalRetencionIva: Number(totalRetencionIva.toFixed(4)),
    totalRetencionRenta: Number(totalRetencionRenta.toFixed(4)),
    detalles,
    xmlAutorizado: xmlAutorizado || xmlPrincipal,
  };
}

// ─── 4. Parsear documento otro (NC/ND recibida — básico) ──────
function parsearDocOtro(xmlAutorizado, xmlEnvuelto, tipoDoc) {
  const xmlPrincipal = extraerXmlPrincipal(xmlEnvuelto || xmlAutorizado);
  const parser = new XMLParser(XML_OPTIONS);
  const parsed = parser.parse(xmlPrincipal);
  const doc = parsed?.notaCredito || parsed?.notaDebito || Object.values(parsed || {})[0] || {};
  const infoTrib = doc?.infoTributaria || {};
  const infoDoc = doc?.infoNotaCredito || doc?.infoNotaDebito || doc?.info || {};

  const tipo = TIPOS_DOCUMENTO[tipoDoc] || { nombre: 'Documento' };
  return {
    tipoDocumento: tipoDoc,
    tipoDescripcion: tipo.nombre,
    rucEmisor: limpiar(infoTrib.ruc || ''),
    razonSocialEmisor: limpiar(infoTrib.razonSocial || ''),
    fechaEmision: parsearFecha(infoDoc.fechaEmision || ''),
    importeTotal: toNum(infoDoc.totalComprobante || infoDoc.valorModificacion || 0, 0),
    xmlAutorizado: xmlAutorizado || xmlPrincipal,
  };
}

// ─── 5. Importar documento recibido (routing por tipo) ───────
/**
 * Importa un documento al modelo correspondiente según su tipo.
 * Ejecuta dentro de la transacción `tx` que se pasa como parámetro.
 *
 * Para facturas/liquidaciones (01, 03): reutiliza parsearFacturaCompraDesdeXml
 * Para retenciones recibidas (07): crea registro en retenciones_recibidas
 * Para NC/ND (04, 05): crea registro en docs_recibidos_otros
 *
 * @returns {{ accion: 'creado'|'omitido', modelo: string, id?: number }}
 */
async function importarDocumentoRecibido({
  tx,
  empresaId,
  usuarioId,
  tipoDoc,
  xmlAutorizado,
  xmlEnvuelto,
  claveAcceso,
  numeroAutorizacion,
  fechaAutorizacion,
  opcionesFactura = {},
}) {
  const modelo = TIPOS_DOCUMENTO[tipoDoc]?.destino;
  if (!modelo) throw new Error(`Tipo de documento no soportado: ${tipoDoc}`);

  // ── Validar que el documento pertenece al RUC de la empresa ──
  // De paso, se determina si llegó dirigido al RUC (13 dígitos) o a la
  // cédula (10 dígitos) de la empresa/persona — para efectos tributarios
  // solo lo dirigido al RUC es deducible/genera crédito de IVA, aunque el
  // SRI trate ambos como el mismo contribuyente para persona natural.
  const xmlParaValidar = xmlAutorizado || xmlEnvuelto;
  let receptorEsRuc = null;
  if (xmlParaValidar) {
    const idReceptor = extraerIdentificacionReceptorXml(xmlParaValidar, tipoDoc);
    if (idReceptor) {
      const emp = await tx.empresas.findUnique({ where: { id: empresaId }, select: { ruc: true, razonSocial: true } });
      if (emp && !rucCoincide(emp.ruc, idReceptor)) {
        throw new Error(
          `El documento está dirigido a ${idReceptor}, pero la empresa activa es ${emp.razonSocial} (RUC ${emp.ruc}). No se puede importar.`
        );
      }
      if (idReceptor.length === 13) receptorEsRuc = true;
      else if (idReceptor.length === 10) receptorEsRuc = false;
    }
  }

  // ── Facturas y Liquidaciones ─────────────────────────────
  if (modelo === 'facturas_compra') {
    const { parsearFacturaCompraDesdeXml } = require('./importacionProductos');

    const xmlParaParsear = xmlEnvuelto || xmlAutorizado;
    const datos = parsearFacturaCompraDesdeXml(xmlParaParsear);

    // Verificar duplicado
    const existente = await tx.facturas_compra.findFirst({
      where: {
        empresaId,
        OR: [
          ...(claveAcceso ? [{ claveAcceso }] : []),
          {
            identificacionProveedor: datos.proveedor.identificacionProveedor,
            numeroFactura: datos.comprobante.numeroFactura,
          },
        ],
      },
      select: { id: true },
    });
    if (existente) return { accion: 'omitido', modelo, motivo: 'Ya existe', id: existente.id };

    // Resolver proveedor
    let proveedorId = null;
    if (datos.proveedor.identificacionProveedor) {
      const prov = await tx.proveedores.findFirst({
        where: { empresaId, identificacion: datos.proveedor.identificacionProveedor },
        select: { id: true },
      });
      proveedorId = prov?.id || null;
    }

    // Crear compra
    const nuevaCompra = await tx.facturas_compra.create({
      data: {
        empresaId,
        emisorId: usuarioId || null,
        proveedorId,
        tipoIdentificacionProveedor: datos.proveedor.tipoIdentificacionProveedor || '04',
        identificacionProveedor: datos.proveedor.identificacionProveedor,
        razonSocialProveedor: datos.proveedor.razonSocialProveedor,
        nombreComercialProveedor: datos.proveedor.nombreComercialProveedor || null,
        direccionProveedor: datos.proveedor.direccionProveedor || null,
        numeroFactura: datos.comprobante.numeroFactura,
        numeroAutorizacion: numeroAutorizacion || datos.comprobante.numeroAutorizacion || null,
        claveAcceso: claveAcceso || datos.comprobante.claveAcceso || null,
        fechaEmision: datos.comprobante.fechaEmision || new Date(),
        subtotal0: datos.totales.subtotal0,
        subtotal5: datos.totales.subtotal5 || 0,
        subtotal15: datos.totales.subtotal15,
        totalDescuento: datos.totales.totalDescuento,
        totalIva: datos.totales.totalIva,
        importeTotal: datos.totales.importeTotal,
        detalles: datos.detalles,
        pagos: datos.pagos,
        origenRegistro: 'BUZON_SRI',
        xmlOrigen: datos.xmlOrigen || null,
        receptorEsRuc,
      },
    });

    // Inventario y caja opcionales (igual que compras manuales)
    const { registraInventario = false, creaProductos = false, registraCaja = false } = opcionesFactura;
    let movimientosInventario = 0;

    if ((registraInventario || creaProductos) && datos.detalles?.length) {
      const { aplicarMovimientoInventario } = require('./inventario');
      const { resolverOMarcarPendiente, registrarItemCompraPendiente } = require('./comprasInventario');
      const { obtenerConfiguracionSistemaOperativa } = require('./configuracionSistema');

      const configOperativa = await obtenerConfiguracionSistemaOperativa(empresaId, tx);
      const prefijosRegalo = configOperativa?.prefijosRegaloCompras;

      for (const det of datos.detalles) {
        const resolucion = await resolverOMarcarPendiente({
          tx,
          empresaId,
          detalle: det,
          detallesTodos: datos.detalles,
          crearProductosFaltantes: creaProductos,
          actualizarProductosExistentes: false, // comportamiento histórico: este flujo no actualizaba productos ya existentes
          prefijosRegalo,
        });

        if (resolucion.pendiente) {
          await registrarItemCompraPendiente({ tx, empresaId, compraId: nuevaCompra.id, detalle: det, prefijoDetectado: resolucion.prefijoDetectado });
          continue;
        }

        const prod = resolucion.producto;
        if (prod && registraInventario && prod.inventariable !== false) {
          await aplicarMovimientoInventario({
            tx,
            empresaId,
            productoId: prod.id,
            usuarioId,
            tipo: 'ENTRADA',
            deltaCantidad: toNum(det.cantidad, 0),
            referencia: `BUZON-${nuevaCompra.id}`,
            observacion: resolucion.esRegaloMatcheado
              ? `Entrada por regalo/combo — Buzón SRI: ${datos.comprobante.numeroFactura}`
              : `Entrada por Buzón SRI: ${datos.comprobante.numeroFactura}`,
            // Ítem regalo/combo emparejado (costo $0): NO pasar costoUnitario
            // para no sobreescribir el costo real del producto con $0.
            ...(resolucion.esRegaloMatcheado ? {} : { costoUnitario: det.precioUnitario || 0 }),
          });
          movimientosInventario += 1;
        }
      }
    }

    if (movimientosInventario > 0 || registraInventario) {
      await tx.facturas_compra.update({
        where: { id: nuevaCompra.id },
        data: { registraInventario: registraInventario || false, movimientosInventario },
      });
    }

    if (registraCaja && datos.totales.importeTotal > 0) {
      const { registrarMovimientoCaja } = require('./caja');
      await registrarMovimientoCaja({
        tx,
        empresaId,
        usuarioId,
        tipo: 'EGRESO',
        monto: datos.totales.importeTotal,
        descripcion: `Pago compra ${datos.comprobante.numeroFactura} (Buzón SRI)`,
        referencia: `COMPRA-${nuevaCompra.id}`,
      });
      await tx.facturas_compra.update({
        where: { id: nuevaCompra.id },
        data: { egresoCajaRegistrado: true },
      });
    }

    return { accion: 'creado', modelo, id: nuevaCompra.id };
  }

  // ── Retención recibida (07) ──────────────────────────────
  if (modelo === 'retenciones_recibidas') {
    const existente = await tx.retenciones_recibidas.findFirst({
      where: { empresaId, claveAcceso },
      select: { id: true },
    });
    if (existente) return { accion: 'omitido', modelo, motivo: 'Ya existe', id: existente.id };

    const datos = parsearRetencionRecibida(xmlAutorizado, xmlEnvuelto);

    // Intentar vincular a factura emitida por el número de doc sustento
    let facturaId = null;
    if (datos.numDocSustento) {
      const facturaVinculada = await tx.facturas.findFirst({
        where: { empresaId, numeroFactura: datos.numDocSustento },
        select: { id: true },
      });
      facturaId = facturaVinculada?.id || null;
    }

    const nueva = await tx.retenciones_recibidas.create({
      data: {
        empresaId,
        claveAcceso,
        numeroAutorizacion: numeroAutorizacion || null,
        fechaAutorizacion: fechaAutorizacion || null,
        rucAgente: datos.rucAgente,
        razonSocialAgente: datos.razonSocialAgente,
        fechaEmision: datos.fechaEmision,
        numDocSustento: datos.numDocSustento || null,
        totalRetencionIva: datos.totalRetencionIva,
        totalRetencionRenta: datos.totalRetencionRenta,
        facturaId,
        detalles: datos.detalles,
        xmlAutorizado: datos.xmlAutorizado || null,
      },
    });

    return { accion: 'creado', modelo, id: nueva.id };
  }

  // ── NC / ND recibidas (04, 05) ───────────────────────────
  if (modelo === 'docs_recibidos_otros') {
    const existente = await tx.docs_recibidos_otros.findFirst({
      where: { empresaId, claveAcceso },
      select: { id: true },
    });
    if (existente) return { accion: 'omitido', modelo, motivo: 'Ya existe', id: existente.id };

    const datos = parsearDocOtro(xmlAutorizado, xmlEnvuelto, tipoDoc);

    const nuevo = await tx.docs_recibidos_otros.create({
      data: {
        empresaId,
        claveAcceso,
        tipoDocumento: tipoDoc,
        tipoDescripcion: datos.tipoDescripcion,
        numeroAutorizacion: numeroAutorizacion || null,
        fechaEmision: datos.fechaEmision,
        rucEmisor: datos.rucEmisor,
        razonSocialEmisor: datos.razonSocialEmisor,
        importeTotal: datos.importeTotal,
        xmlAutorizado: datos.xmlAutorizado || null,
      },
    });

    return { accion: 'creado', modelo, id: nuevo.id };
  }

  throw new Error(`Destino desconocido para tipo: ${tipoDoc}`);
}

module.exports = {
  detectarTipoDesdeClaveAcceso,
  parsearRetencionRecibida,
  parsearDocOtro,
  importarDocumentoRecibido,
  extraerIdentificacionReceptorXml,
  TIPOS_DOCUMENTO,
};
