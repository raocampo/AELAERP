// ============================================================
// fecha.js — Utilidades de fecha para AELA ERP
//
// PROBLEMA: new Date("2026-05-21") parsea como UTC medianoche.
// En Ecuador (UTC-5) eso se convierte en "2026-05-20 19:00" → muestra el día anterior.
//
// SOLUCIÓN: Para strings de solo fecha (YYYY-MM-DD), construir con
// new Date(y, m-1, d) que usa la hora local del navegador.
// ============================================================

import { format as fnsFormat } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Parsea una fecha evitando el desfase UTC.
 * - "2026-05-21"                → new Date(2026, 4, 21) [local midnight]
 * - "2026-05-21T14:30:00.000Z"  → new Date(...) normal [tiene zona incluida]
 * @param {string|Date|null} fecha
 * @returns {Date}
 */
export function parseFechaLocal(fecha) {
  if (!fecha) return new Date();
  if (fecha instanceof Date) return fecha;
  const s = String(fecha).trim();
  // Solo fecha sin hora: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Con hora (ISO completo u otros formatos): el navegador aplica zona local
  return new Date(s);
}

/**
 * Formatea una fecha como dd/MM/yyyy evitando desfase UTC.
 * @param {string|Date|null} fecha
 * @param {string} fallback  Texto cuando fecha es inválida
 */
export function formatFechaCorta(fecha, fallback = '—') {
  if (!fecha) return fallback;
  try {
    const d = parseFechaLocal(fecha);
    if (Number.isNaN(d.getTime())) return fallback;
    return fnsFormat(d, 'dd/MM/yyyy');
  } catch {
    return fallback;
  }
}

/**
 * Formatea una fecha como "dd de MMMM de yyyy" en español.
 * Ej: "21 de mayo de 2026"
 */
export function formatFechaLarga(fecha, fallback = '—') {
  if (!fecha) return fallback;
  try {
    const d = parseFechaLocal(fecha);
    if (Number.isNaN(d.getTime())) return fallback;
    return fnsFormat(d, "dd 'de' MMMM 'de' yyyy", { locale: es });
  } catch {
    return fallback;
  }
}

/**
 * Formatea fecha+hora como dd/MM/yyyy HH:mm.
 * Para timestamps ISO completos (con zona incluida) es correcto usar new Date() directamente.
 */
export function formatFechaHora(fecha, fallback = '—') {
  if (!fecha) return fallback;
  try {
    const d = new Date(fecha); // timestamps ISO tienen zona → OK
    if (Number.isNaN(d.getTime())) return fallback;
    return fnsFormat(d, 'dd/MM/yyyy HH:mm');
  } catch {
    return fallback;
  }
}

/**
 * Devuelve la fecha de hoy como string YYYY-MM-DD (hora local).
 */
export function hoyLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Convierte cualquier valor de fecha a string YYYY-MM-DD (hora local).
 * Útil para inputs tipo "date".
 */
export function toInputFecha(fecha, fallback = '') {
  if (!fecha) return fallback;
  try {
    const d = parseFechaLocal(fecha);
    if (Number.isNaN(d.getTime())) return fallback;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  } catch {
    return fallback;
  }
}
