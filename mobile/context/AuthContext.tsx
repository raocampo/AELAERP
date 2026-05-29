import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import api, { clearSession, STORAGE_KEYS } from '../services/api';
import type { Empresa, Sistema, Usuario } from '../types';

interface AuthState {
  usuario: Usuario | null;
  empresa: Empresa | null;
  sistema: Sistema | null;
  cargando: boolean;
  empresasDisponibles: Empresa[];
  empresaConfirmada: boolean;
}

interface AuthActions {
  login: (credential: string, password: string) => Promise<{ success: boolean; mensaje?: string }>;
  logout: () => Promise<void>;
  confirmarEmpresa: (empresaId: number) => Promise<{ success: boolean; mensaje?: string }>;
  cambiarEmpresa: (empresaId: number) => Promise<{ success: boolean }>;
  recargarSistema: () => Promise<void>;
  cargarEmpresasDisponibles: () => Promise<void>;
}

const AuthContext = createContext<AuthState & AuthActions>({} as AuthState & AuthActions);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [sistema, setSistema] = useState<Sistema | null>(null);
  const [cargando, setCargando] = useState(true);
  const [empresasDisponibles, setEmpresasDisponibles] = useState<Empresa[]>([]);
  // false = acaba de hacer login, debe pasar por /empresa
  // true  = ya seleccionó empresa (o sesión restaurada)
  const [empresaConfirmada, setEmpresaConfirmada] = useState(false);

  const recargarSistema = useCallback(async () => {
    try {
      const res = await api.get('/configuracion-sistema');
      if (res.data?.success) {
        setSistema(res.data.data);
        await SecureStore.setItemAsync(STORAGE_KEYS.SISTEMA, JSON.stringify(res.data.data));
      }
    } catch {
      // usa sistema guardado
    }
  }, []);

  const cargarEmpresasDisponibles = useCallback(async () => {
    try {
      const res = await api.get('/empresas/mis-empresas');
      if (res.data?.success) setEmpresasDisponibles(res.data.data || []);
    } catch {
      // no crítico
    }
  }, []);

  // Restaurar sesión al iniciar la app
  useEffect(() => {
    (async () => {
      try {
        const [token, usuarioStr, empresaStr, sistemaStr] = await Promise.all([
          SecureStore.getItemAsync(STORAGE_KEYS.TOKEN),
          SecureStore.getItemAsync(STORAGE_KEYS.USUARIO),
          SecureStore.getItemAsync(STORAGE_KEYS.EMPRESA),
          SecureStore.getItemAsync(STORAGE_KEYS.SISTEMA),
        ]);

        if (token && usuarioStr) {
          setUsuario(JSON.parse(usuarioStr));
          if (empresaStr) setEmpresa(JSON.parse(empresaStr));
          if (sistemaStr) setSistema(JSON.parse(sistemaStr));
          // Sesión restaurada: empresa ya fue seleccionada antes
          setEmpresaConfirmada(true);
          recargarSistema().catch(() => {});
          cargarEmpresasDisponibles().catch(() => {});
        }
      } finally {
        setCargando(false);
      }
    })();
  }, [recargarSistema, cargarEmpresasDisponibles]);

  const persistirSesion = useCallback(async (data: {
    token: string;
    usuario: Usuario;
    empresa?: Empresa;
    tenantSlug?: string;
  }) => {
    await SecureStore.setItemAsync(STORAGE_KEYS.TOKEN, data.token);
    await SecureStore.setItemAsync(STORAGE_KEYS.USUARIO, JSON.stringify(data.usuario));
    if (data.tenantSlug) {
      await SecureStore.setItemAsync(STORAGE_KEYS.TENANT_SLUG, data.tenantSlug);
    }
    setUsuario(data.usuario);

    let emp = data.empresa;
    if (!emp) {
      try {
        const r = await api.get('/empresas/mi-empresa');
        if (r.data.success) emp = r.data.data;
      } catch { /* sin empresa aún */ }
    }
    if (emp) {
      setEmpresa(emp);
      await SecureStore.setItemAsync(STORAGE_KEYS.EMPRESA, JSON.stringify(emp));
    }

    await recargarSistema();
    // NO marcamos empresaConfirmada aquí: el usuario debe pasar por /empresa
  }, [recargarSistema]);

  const login = useCallback(async (credential: string, password: string) => {
    try {
      const res = await api.post('/auth/login', { login: credential, password });
      if (res.data.success) {
        setEmpresaConfirmada(false); // Fresco login → debe seleccionar empresa
        await persistirSesion(res.data);
        await cargarEmpresasDisponibles();
        return { success: true };
      }
      return { success: false, mensaje: res.data.mensaje || 'Credenciales incorrectas' };
    } catch (err: any) {
      return { success: false, mensaje: err.response?.data?.mensaje || 'Error de conexión' };
    }
  }, [persistirSesion, cargarEmpresasDisponibles]);

  // Confirmar empresa elegida en /empresa y entrar a la app
  const confirmarEmpresa = useCallback(async (empresaId: number) => {
    try {
      // Si es distinta a la actual, cambiar token
      if (empresa?.id !== empresaId) {
        const res = await api.post('/auth/cambiar-empresa', { empresaId });
        if (!res.data.success) return { success: false, mensaje: res.data.mensaje };
        const { token, empresa: nueva, tenantSlug } = res.data;
        await SecureStore.setItemAsync(STORAGE_KEYS.TOKEN, token);
        if (tenantSlug) await SecureStore.setItemAsync(STORAGE_KEYS.TENANT_SLUG, tenantSlug);
        setEmpresa(nueva);
        await SecureStore.setItemAsync(STORAGE_KEYS.EMPRESA, JSON.stringify(nueva));
        await recargarSistema();
      }
      setEmpresaConfirmada(true);
      return { success: true };
    } catch (err: any) {
      return { success: false, mensaje: err.response?.data?.mensaje || 'Error al seleccionar empresa' };
    }
  }, [empresa, recargarSistema]);

  const logout = useCallback(async () => {
    await clearSession();
    setUsuario(null);
    setEmpresa(null);
    setSistema(null);
    setEmpresasDisponibles([]);
    setEmpresaConfirmada(false);
  }, []);

  const cambiarEmpresa = useCallback(async (empresaId: number) => {
    try {
      const res = await api.post('/auth/cambiar-empresa', { empresaId });
      if (!res.data.success) return { success: false };
      const { token, empresa: nueva, tenantSlug } = res.data;
      await SecureStore.setItemAsync(STORAGE_KEYS.TOKEN, token);
      if (tenantSlug) await SecureStore.setItemAsync(STORAGE_KEYS.TENANT_SLUG, tenantSlug);
      setEmpresa(nueva);
      await SecureStore.setItemAsync(STORAGE_KEYS.EMPRESA, JSON.stringify(nueva));
      await recargarSistema();
      return { success: true };
    } catch {
      return { success: false };
    }
  }, [recargarSistema]);

  return (
    <AuthContext.Provider value={{
      usuario, empresa, sistema, cargando, empresasDisponibles, empresaConfirmada,
      login, logout, confirmarEmpresa, cambiarEmpresa, recargarSistema, cargarEmpresasDisponibles,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
