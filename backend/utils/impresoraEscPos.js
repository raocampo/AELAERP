// ============================================================
// AELA — Utilidad ESC/POS para impresoras térmicas de red
// Protocolo: TCP directo al puerto 9100 (estándar ESC/POS)
// Compatibilidad: Epson, Star, Bixolon, SNBC, Sewoo y genéricas
// ============================================================
const net = require('net');

// ── Constantes ESC/POS ───────────────────────────────────────
const ESC = 0x1B;
const GS  = 0x1D;
const LF  = 0x0A;

const CMD = {
  INIT:          Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:    Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:  Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT:   Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON:       Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:      Buffer.from([ESC, 0x45, 0x00]),
  DOUBLE_ON:     Buffer.from([GS,  0x21, 0x11]),
  DOUBLE_OFF:    Buffer.from([GS,  0x21, 0x00]),
  FEED_1:        Buffer.from([ESC, 0x64, 0x01]),
  FEED_3:        Buffer.from([ESC, 0x64, 0x03]),
  CUT_FULL:      Buffer.from([GS,  0x56, 0x41, 0x03]),
  // Pulso cajón de dinero (pin 2, t1=50ms, t2=250ms)
  OPEN_DRAWER:   Buffer.from([ESC, 0x70, 0x00, 0x19, 0xFA]),
};

// ── Helpers ──────────────────────────────────────────────────
function linea(texto = '') {
  return Buffer.from(texto + '\n', 'utf8');
}

function separador(chars) {
  return linea('-'.repeat(chars));
}

/** Línea con texto a izquierda y valor a derecha, columna fija */
function lineaCol(lbl, val, chars) {
  const espacio = chars - lbl.length - val.length;
  if (espacio <= 0) return linea(`${lbl} ${val}`.substring(0, chars));
  return linea(lbl + ' '.repeat(espacio) + val);
}

function truncar(str, max) {
  return (str || '').substring(0, max);
}

// ── Generador de recibo ───────────────────────────────────────
/**
 * @param {object} doc  - Datos del documento (nota_venta o factura)
 * @param {object} emp  - Datos de la empresa (razonSocial, ruc, direccion…)
 * @param {number} ancho - 58 o 80 (mm) → 32 o 42 chars por línea
 * @param {boolean} abrirCajon
 * @returns {Buffer}
 */
function generarRecibo(doc, emp, ancho = 80, abrirCajon = false) {
  const chars = ancho === 58 ? 32 : 42;
  const sep   = separador(chars);
  const parts = [];

  const add = (...items) => items.forEach(i => parts.push(i));

  // ── Encabezado empresa ──
  add(CMD.INIT);
  if (abrirCajon) add(CMD.OPEN_DRAWER); // abrir cajón ANTES de imprimir
  add(CMD.ALIGN_CENTER);
  add(CMD.BOLD_ON, CMD.DOUBLE_ON);
  add(linea(truncar(emp.nombreComercial || emp.razonSocial, chars - 2)));
  add(CMD.DOUBLE_OFF, CMD.BOLD_OFF);
  add(linea(`RUC: ${emp.ruc || ''}`));
  if (emp.dirMatriz)    add(linea(truncar(emp.dirMatriz, chars - 2)));
  if (emp.telefono)     add(linea(`Tel: ${emp.telefono}`));
  if (emp.emailFactura) add(linea(truncar(emp.emailFactura, chars - 2)));

  // ── Tipo y número de documento ──
  add(sep);
  add(CMD.BOLD_ON);
  const tipoLabel = doc.tipo === 'factura' ? 'FACTURA ELECTRÓNICA' : 'NOTA DE VENTA';
  add(linea(tipoLabel.padStart(Math.floor((chars + tipoLabel.length) / 2))));
  const numDoc = doc.numeroFactura || doc.numeroNota || '---';
  add(linea(numDoc.padStart(Math.floor((chars + numDoc.length) / 2))));
  add(CMD.BOLD_OFF);
  add(sep);

  // ── Datos cliente ──
  add(CMD.ALIGN_LEFT);
  const fecha = doc.fechaEmision ? doc.fechaEmision.toString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  add(linea(`Fecha  : ${fecha}`));
  const cliente = doc.razonSocialComprador || doc.razonSocial || 'CONSUMIDOR FINAL';
  const idCliente = doc.identificacionComprador || doc.identificacion || '9999999999999';
  add(linea(`Cliente: ${truncar(cliente, chars - 9)}`));
  add(linea(`RUC/CI : ${idCliente}`));
  add(sep);

  // ── Detalle de items ──
  const detalles = (() => {
    try { return typeof doc.detalles === 'string' ? JSON.parse(doc.detalles) : (doc.detalles || []); }
    catch { return []; }
  })();

  const lblAncho = chars === 32 ? 16 : 22;
  const hdr = 'DESCRIPCION'.padEnd(lblAncho) + 'CANT'.padStart(5) + 'TOTAL'.padStart(chars - lblAncho - 5);
  add(linea(hdr));
  add(sep);

  for (const item of detalles) {
    const nombre = truncar(item.descripcion || item.nombre || '', lblAncho);
    const cant   = String(Number(item.cantidad || 1)).padStart(5);
    const subtLin = (Number(item.cantidad || 1) * Number(item.precioUnitario || 0)).toFixed(2);
    const total  = ('$' + subtLin).padStart(chars - lblAncho - 5);
    add(linea(nombre.padEnd(lblAncho) + cant + total));
    // Segunda línea con precio unitario
    const precUnit = `  $${Number(item.precioUnitario || 0).toFixed(2)} c/u`;
    add(linea(precUnit));
  }

  add(sep);

  // ── Totales ──
  add(CMD.ALIGN_RIGHT);
  const subtotal = Number(doc.subtotal || doc.subtotal0 || 0) +
                   Number(doc.subtotal15 || 0) + Number(doc.subtotal5 || 0);
  if (subtotal > 0) add(lineaCol('Subtotal:', `$${subtotal.toFixed(2)}`, chars));

  const iva = Number(doc.totalIva || 0);
  if (iva > 0) add(lineaCol('IVA:', `$${iva.toFixed(2)}`, chars));

  const total = Number(doc.importeTotal || doc.total || 0);
  add(CMD.BOLD_ON);
  add(lineaCol('TOTAL:', `$${total.toFixed(2)}`, chars));
  add(CMD.BOLD_OFF);

  const formaPago = doc.formaPago ||
    (() => { try { const p = typeof doc.pagos === 'string' ? JSON.parse(doc.pagos) : doc.pagos; return p?.[0]?.formaPago || ''; } catch { return ''; } })();
  if (formaPago) add(lineaCol('Forma pago:', formaPago, chars));

  // ── Pie ──
  add(CMD.ALIGN_CENTER);
  add(sep);
  add(CMD.FEED_1);
  add(linea('¡Gracias por su compra!'));
  add(linea('Documento autorizado por el SRI'));
  if (doc.numeroAutorizacion) {
    add(linea(`Auth: ${truncar(doc.numeroAutorizacion, chars - 6)}`));
  }
  add(CMD.FEED_3);
  add(CMD.CUT_FULL);

  return Buffer.concat(parts);
}

// ── Etiquetas de producto con código de barras ─────────────────
/**
 * Genera el bloque ESC/POS de un código de barras Code128 nativo (comando
 * GS k, subset B — soporta ASCII completo). La impresora lo rasteriza ella
 * misma; no requiere generar ni enviar una imagen.
 * @param {string} data - valor a codificar (codigoAuxiliar o codigoPrincipal del producto)
 * @param {object} opciones - { alturaPx, anchoModulo (2-6), mostrarTexto }
 */
function generarBarcode128(data, { alturaPx = 80, anchoModulo = 2, mostrarTexto = true } = {}) {
  const texto = String(data || '').trim();
  if (!texto) return Buffer.alloc(0);

  // Subset B de Code128 vía selector "{B" — soporta letras, números y símbolos ASCII.
  const datos = Buffer.concat([Buffer.from([0x7B, 0x42]), Buffer.from(texto, 'ascii')]);

  return Buffer.concat([
    Buffer.from([GS, 0x68, Math.max(1, Math.min(255, alturaPx))]),  // GS h n — altura del barcode
    Buffer.from([GS, 0x77, Math.max(2, Math.min(6, anchoModulo))]), // GS w n — ancho de módulo
    Buffer.from([GS, 0x48, mostrarTexto ? 0x02 : 0x00]),            // GS H n — HRI (texto legible) debajo
    Buffer.from([GS, 0x6B, 0x49, datos.length]),                    // GS k m n — Code128 (m=73), n bytes de datos
    datos,
  ]);
}

/**
 * Genera el ticket de etiqueta de un producto (nombre + precio + barcode),
 * repetido `copias` veces con corte de papel entre cada una.
 * @param {object} producto - { codigoPrincipal, codigoAuxiliar, nombre, precioUnitario }
 * @param {object} opciones - { ancho: 58|80, copias }
 */
function generarEtiquetaProducto(producto, { ancho = 58, copias = 1 } = {}) {
  const chars  = ancho === 58 ? 32 : 42;
  const codigo = producto.codigoAuxiliar || producto.codigoPrincipal;
  const parts  = [];

  for (let i = 0; i < Math.max(1, copias); i++) {
    parts.push(
      CMD.INIT,
      CMD.ALIGN_CENTER,
      CMD.BOLD_ON,
      linea(truncar(producto.nombre || '', chars)),
      CMD.BOLD_OFF,
      linea(`$${Number(producto.precioUnitario || 0).toFixed(2)}`),
      generarBarcode128(codigo, { alturaPx: ancho === 58 ? 50 : 70, anchoModulo: 2 }),
      CMD.FEED_3,
      CMD.CUT_FULL,
    );
  }

  return Buffer.concat(parts);
}

// ── Envío TCP ─────────────────────────────────────────────────
/**
 * Envía un buffer ESC/POS a la impresora por TCP.
 * @param {string} ip
 * @param {number} puerto  (default 9100)
 * @param {Buffer} buffer
 * @param {number} timeoutMs
 */
function enviarTCP(ip, puerto = 9100, buffer, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: ip, port: puerto });

    client.setTimeout(timeoutMs);

    client.on('connect', () => {
      client.write(buffer, () => {
        // Esperar un poco para que la impresora procese antes de cerrar
        setTimeout(() => { client.end(); resolve(); }, 300);
      });
    });

    client.on('timeout', () => {
      client.destroy();
      reject(new Error(`Timeout al conectar con la impresora ${ip}:${puerto}`));
    });

    client.on('error', (err) => {
      client.destroy();
      reject(new Error(`Error de red: ${err.message}`));
    });
  });
}

// ── API pública ───────────────────────────────────────────────
/**
 * Imprime un recibo en la impresora de red.
 */
async function imprimirRecibo(doc, emp, config) {
  const { ip, puerto = 9100, ancho = 80, cajaDinero = false } = config;
  if (!ip) throw new Error('IP de impresora no configurada');
  const buf = generarRecibo(doc, emp, ancho, cajaDinero);
  await enviarTCP(ip, puerto, buf);
}

/**
 * Abre el cajón de dinero (sin imprimir recibo).
 */
async function abrirCajon(ip, puerto = 9100) {
  if (!ip) throw new Error('IP de impresora no configurada');
  const buf = Buffer.concat([CMD.INIT, CMD.OPEN_DRAWER, CMD.FEED_1]);
  await enviarTCP(ip, puerto, buf);
}

/**
 * Prueba de conexión (envía init + feed, no imprime texto).
 */
async function probarConexion(ip, puerto = 9100) {
  if (!ip) throw new Error('Ingresa la IP de la impresora');
  const buf = Buffer.concat([CMD.INIT, CMD.FEED_1]);
  await enviarTCP(ip, puerto, buf, 5000);
}

/**
 * Envía un buffer ESC/POS ya armado a la impresora (uso genérico —
 * etiquetas de producto, o cualquier ticket que no sea un recibo de venta).
 */
async function imprimirBuffer(ip, puerto = 9100, buffer) {
  if (!ip) throw new Error('IP de impresora no configurada');
  await enviarTCP(ip, puerto, buffer);
}

module.exports = {
  imprimirRecibo, abrirCajon, probarConexion, generarRecibo,
  generarBarcode128, generarEtiquetaProducto, imprimirBuffer,
};
