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
  'aela_tenant_slug',
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

export function redirigirALogin(location = globalThis.window?.location) {
  if (!location) return;
  if (typeof location.assign === 'function') {
    location.assign('/login');
    return;
  }
  location.href = '/login';
}

export function manejarErrorApi(err, {
  storage = globalThis.localStorage,
  location = globalThis.window?.location,
} = {}) {
  if (err.response?.status === 401) {
    limpiarSesion(storage);
    redirigirALogin(location);
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
