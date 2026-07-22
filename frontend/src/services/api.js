// ====================================
// API SERVICE — AELA
// frontend/src/services/api.js
// ====================================

import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';
export const SESSION_STORAGE_KEYS = [
  'aela_token',
  'token',
  'aela_usuario',
  'aela_empresa',
  'aela_sistema',
  // NOTA: aela_tenant_slug NO se limpia en logout — es un identificador de
  // enrutamiento, no un secreto. Se preserva para que el usuario regrese
  // automáticamente al login de su tenant tras expiración de sesión.
];

// Extrae el tenantSlug desde el payload JWT (sin verificar firma — solo lectura).
// El backend valida la firma; aquí solo necesitamos enrutar al tenant correcto.
function _slugDesdeJwt(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.tenantSlug ?? null;
  } catch {
    return null;
  }
}

// Arma Authorization + X-Tenant-Slug para un fetch() hecho a mano — usar
// SIEMPRE que no se pueda pasar por el axios `api` de abajo (ej. descargas de
// blob con <a download>, Service Worker, cola offline). Reutilizada por
// inyectarTokenEnConfig para no duplicar la lógica del slug en dos sitios.
// Un fetch() sin este header resuelve al tenant por defecto en el backend en
// vez del tenant del usuario, y la validación de sesión lo rechaza con
// TENANT_MISMATCH — este fue el bug real detrás de varios botones de
// PDF/XML/recibo que fallaban solo para empresas de un tenant multi-empresa.
export function headersConTenant(extra = {}, storage = globalThis.localStorage) {
  const headers = { ...extra };
  const token = storage?.getItem('aela_token') || storage?.getItem('token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    // Derivar el slug DESDE el JWT para que siempre coincida con el tenant
    // con el que el usuario inició sesión, independientemente de lo que tenga
    // localStorage. Esto evita que un slug residual de otro tenant provoque
    // que las requests lleguen a la BD equivocada (TENANT_MISMATCH / data leak).
    const slugDelJwt = _slugDesdeJwt(token);
    const slugFallback = storage?.getItem('aela_tenant_slug');
    const slugEfectivo = slugDelJwt ?? slugFallback;
    if (slugEfectivo) headers['X-Tenant-Slug'] = slugEfectivo;
  } else {
    // Sin token (login, registro) → usar slug de localStorage para resolver tenant
    const tenantSlug = storage?.getItem('aela_tenant_slug');
    if (tenantSlug) headers['X-Tenant-Slug'] = tenantSlug;
  }
  return headers;
}

export function inyectarTokenEnConfig(config, storage = globalThis.localStorage) {
  config.headers = headersConTenant(config.headers, storage);
  return config;
}

export function limpiarSesion(storage = globalThis.localStorage) {
  SESSION_STORAGE_KEYS.forEach((key) => storage?.removeItem(key));
}

export function redirigirALogin(location = globalThis.window?.location, storage = globalThis.localStorage) {
  if (!location) return;
  // Preservar el slug del tenant para que el usuario regrese a su portal
  const slug = storage?.getItem('aela_tenant_slug');
  const destino = slug ? `/${slug}` : '/login';
  if (typeof location.assign === 'function') {
    location.assign(destino);
    return;
  }
  location.href = destino;
}

export function manejarErrorApi(err, {
  storage = globalThis.localStorage,
  location = globalThis.window?.location,
} = {}) {
  if (err.response?.status === 401) {
    limpiarSesion(storage);
    redirigirALogin(location, storage); // slug aún está (no se limpia)
  }
  if (err.response?.status === 402) {
    const codigo = err.response?.data?.codigo;
    if (codigo === 'TRIAL_EXPIRADO') {
      window.dispatchEvent(new CustomEvent('aela:trial-expirado'));
    } else if (codigo === 'PLAN_VENCIDO' || codigo === 'TENANT_VENCIDO') {
      window.dispatchEvent(new CustomEvent('aela:plan-vencido', {
        detail: { mensaje: err.response?.data?.mensaje },
      }));
    }
  }
  return Promise.reject(err);
}

const api = axios.create({ baseURL: API_URL });

// Inyectar token JWT en cada petición
api.interceptors.request.use((config) => inyectarTokenEnConfig(config));

// Manejar 401 → redirigir al login
api.interceptors.response.use(
  (res) => res,
  (err) => manejarErrorApi(err)
);

export default api;
