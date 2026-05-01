import { describe, expect, it, vi } from 'vitest';
import {
  SESSION_STORAGE_KEYS,
  inyectarTokenEnConfig,
  limpiarSesion,
  redirigirALogin,
  manejarErrorApi,
} from './api';

function crearStorageMock(inicial = {}) {
  const data = new Map(Object.entries(inicial));
  return {
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    removeItem: vi.fn((key) => {
      data.delete(key);
    }),
  };
}

describe('api service helpers', () => {
  it('inyecta el token disponible en los headers', () => {
    const storage = crearStorageMock({ aela_token: 'abc123' });
    const config = inyectarTokenEnConfig({ headers: {} }, storage);

    expect(config.headers.Authorization).toBe('Bearer abc123');
  });

  it('limpia todas las claves de sesión conocidas', () => {
    const storage = crearStorageMock({
      aela_token: 'a',
      token: 'b',
      aela_usuario: 'c',
      aela_empresa: 'd',
      aela_sistema: 'e',
    });

    limpiarSesion(storage);

    expect(storage.removeItem).toHaveBeenCalledTimes(SESSION_STORAGE_KEYS.length);
    expect(storage.removeItem).toHaveBeenCalledWith('aela_token');
    expect(storage.removeItem).toHaveBeenCalledWith('aela_sistema');
  });

  it('redirige al login usando assign cuando está disponible', () => {
    const location = { assign: vi.fn() };

    redirigirALogin(location);

    expect(location.assign).toHaveBeenCalledWith('/login');
  });

  it('maneja 401 limpiando sesión y redirigiendo', async () => {
    const storage = crearStorageMock({ aela_token: 'abc123' });
    const location = { assign: vi.fn() };
    const error = { response: { status: 401 } };

    await expect(manejarErrorApi(error, { storage, location })).rejects.toBe(error);
    expect(storage.removeItem).toHaveBeenCalledTimes(SESSION_STORAGE_KEYS.length);
    expect(location.assign).toHaveBeenCalledWith('/login');
  });

  it('no limpia sesión cuando el error no es 401', async () => {
    const storage = crearStorageMock({ aela_token: 'abc123' });
    const location = { assign: vi.fn() };
    const error = { response: { status: 500 } };

    await expect(manejarErrorApi(error, { storage, location })).rejects.toBe(error);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
  });
});
