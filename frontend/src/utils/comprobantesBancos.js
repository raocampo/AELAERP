// Abre en una pestaña nueva el PDF del comprobante (ingreso / egreso / nota de
// crédito / débito / ajuste) — mismo patrón que el Recibo de Cobro de CxC.
import api from '../services/api';
import { abrirBlobEnNuevaPestana } from './exportCsv';

async function abrir(endpoint) {
  try {
    await abrirBlobEnNuevaPestana(api, endpoint);
  } catch {
    alert('No se pudo generar el comprobante');
  }
}

// Movimiento del Libro de Bancos (movimientos_bancarios).
export const abrirComprobanteMovimiento = (movimientoId) =>
  abrir(`/bancos/movimientos/${movimientoId}/comprobante`);

// Comprobante de la pestaña Comprobantes de Ingreso / Pago / Crédito / Débito.
export const abrirComprobanteBancario = (comprobanteId) =>
  abrir(`/comprobantes-bancarios/${comprobanteId}/pdf`);
