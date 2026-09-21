// Abre en una pestaña nueva el PDF del comprobante (ingreso / egreso / nota de
// crédito / débito / ajuste) — mismo patrón que el Recibo de Cobro de CxC.
import api from '../services/api';
import { abrirBlobEnNuevaPestana, descargarPdf } from './exportCsv';

async function abrir(endpoint) {
  try {
    await abrirBlobEnNuevaPestana(api, endpoint);
  } catch {
    alert('No se pudo generar el comprobante');
  }
}

async function descargar(endpoint, filename) {
  try {
    await descargarPdf(api, endpoint, {}, filename);
  } catch {
    alert('No se pudo descargar el comprobante');
  }
}

// Movimiento del Libro de Bancos (movimientos_bancarios).
export const abrirComprobanteMovimiento = (movimientoId) =>
  abrir(`/bancos/movimientos/${movimientoId}/comprobante`);

// Comprobante de la pestaña Comprobantes de Ingreso / Pago / Crédito / Débito.
// "Ver/Imprimir" abre el PDF en una pestaña nueva (el navegador ya deja
// imprimir o guardar desde ahí); "Descargar" fuerza la descarga directa.
export const abrirComprobanteBancario = (comprobanteId) =>
  abrir(`/comprobantes-bancarios/${comprobanteId}/pdf`);

export const descargarComprobanteBancario = (comprobanteId, numero) =>
  descargar(`/comprobantes-bancarios/${comprobanteId}/pdf`, `Comprobante-${numero || comprobanteId}.pdf`);
