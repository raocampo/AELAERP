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

export function inyectarTokenEnConfig(config, storage = globalThis.localStorage) {
  if (!config.headers) config.headers = {};
  const token = storage?.getItem('aela_token') || storage?.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const tenantSlug = storage?.getItem('aela_tenant_slug');
  if (tenantSlug) config.headers['X-Tenant-Slug'] = tenantSlug;
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
  if (err.response?.status === 402 && err.response?.data?.codigo === 'TRIAL_EXPIRADO') {
    // Mostrar modal de trial expirado vía evento global
    window.dispatchEvent(new CustomEvent('aela:trial-expirado'));
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
