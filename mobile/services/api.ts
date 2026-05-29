import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://aelaerp-production.up.railway.app/api';

export const STORAGE_KEYS = {
  TOKEN: 'aela_token',
  USUARIO: 'aela_usuario',
  EMPRESA: 'aela_empresa',
  SISTEMA: 'aela_sistema',
  TENANT_SLUG: 'aela_tenant_slug',
} as const;

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.TOKEN);
}

export async function getTenantSlug(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.TENANT_SLUG);
}

export async function clearSession(): Promise<void> {
  await Promise.all(Object.values(STORAGE_KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  const tenantSlug = await getTenantSlug();
  if (!config.headers) config.headers = {} as typeof config.headers;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (tenantSlug) config.headers['X-Tenant-Slug'] = tenantSlug;
  return config;
});

export default api;
