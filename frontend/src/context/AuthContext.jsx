// ====================================
// AUTH CONTEXT — AELA
// Expone: usuario, empresa, edition, modoMulti
// ====================================

import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import AuthContext from './auth-context';
import toast from 'react-hot-toast';
import {
  construirSistemaFallback,
  crearEmpresaFallback,
  normalizarModoOperacion,
  resolverEstadoSistema,
} from '../utils/sistema';

const INACTIVIDAD_MS      = 30 * 60 * 1000; // 30 minutos → logout automático
const ADVERTENCIA_MS      = 25 * 60 * 1000; // 25 minutos → aviso previo

export function AuthProvider({ children }) {
  const [usuario,   setUsuario]   = useState(null);
  const [empresa,   setEmpresa]   = useState(null);
  const [sistema,   setSistema]   = useState(null);
  const [cargando,  setCargando]  = useState(true);
  const timerLogout   = useRef(null);
  const timerAviso    = useRef(null);
  const toastAvisoId  = useRef(null);

  // Leer config de entorno expuesta por Vite
  const edition = import.meta.env.VITE_EDITION || 'full';
  const modoEnv = normalizarModoOperacion(import.meta.env.VITE_MODO_EMPRESA || 'monoempresa');

  const recargarSistema = useCallback(async (empresaFallback) => {
    try {
      const res = await api.get('/configuracion-sistema');
      if (res.data?.success) {
        setSistema(res.data.data);
        localStorage.setItem('aela_sistema', JSON.stringify(res.data.data));
        return res.data.data;
      }
    } catch {
      // fallback local
    }

    const fallback = construirSistemaFallback(empresaFallback, {
      edition,
      modoOperacion: modoEnv,
    });
    setSistema(fallback);
    localStorage.setItem('aela_sistema', JSON.stringify(fallback));
    return fallback;
  }, [edition, modoEnv]);

  useEffect(() => {
    const usuarioGuardado = localStorage.getItem('aela_usuario');
    const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
    const empresaGuardada = localStorage.getItem('aela_empresa');
    const sistemaGuardado = localStorage.getItem('aela_sistema');

    if (usuarioGuardado && token) {
      const usuarioSesion = JSON.parse(usuarioGuardado);
      const empresaSesion = empresaGuardada ? JSON.parse(empresaGuardada) : null;
      const sistemaSesion = sistemaGuardado ? JSON.parse(sistemaGuardado) : null;

      setUsuario(usuarioSesion);
      if (empresaSesion) setEmpresa(empresaSesion);
      if (sistemaSesion) setSistema(sistemaSesion);
      recargarSistema(empresaSesion).catch(() => {});
    }

    setCargando(false);
  }, [recargarSistema]);

  const persistirSesion = useCallback(async ({ token, usuario: usuarioSesion, empresa: empresaSesion = null }) => {
    localStorage.setItem('aela_token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('aela_usuario', JSON.stringify(usuarioSesion));
    setUsuario(usuarioSesion);

    if (empresaSesion) {
      setEmpresa(empresaSesion);
      localStorage.setItem('aela_empresa', JSON.stringify(empresaSesion));
      await recargarSistema(empresaSesion);
      return;
    }

    try {
      const empRes = await api.get('/empresas/mi-empresa');
      if (empRes.data.success) {
        setEmpresa(empRes.data.data);
        localStorage.setItem('aela_empresa', JSON.stringify(empRes.data.data));
        await recargarSistema(empRes.data.data);
        return;
      }
    } catch {
      // Si no existe empresa en BD aún, usar valores de ENV
    }

    const empDefault = crearEmpresaFallback(edition);
    setEmpresa(empDefault);
    localStorage.setItem('aela_empresa', JSON.stringify(empDefault));
    const fallback = construirSistemaFallback(empDefault, {
      edition,
      modoOperacion: modoEnv,
    });
    setSistema(fallback);
    localStorage.setItem('aela_sistema', JSON.stringify(fallback));
  }, [edition, modoEnv, recargarSistema]);

  const login = async (credential, password) => {
    const res = await api.post('/auth/login', { login: credential, password });
    if (res.data.success) {
      await persistirSesion(res.data);
    }
    return res.data;
  };

  const bootstrap = async (payload) => {
    const res = await api.post('/auth/bootstrap', payload);
    if (res.data.success) {
      await persistirSesion(res.data);
    }
    return res.data;
  };

  const getBootstrapStatus = async () => {
    const res = await api.get('/auth/bootstrap-status');
    return res.data;
  };

  const logout = useCallback((porInactividad = false) => {
    clearTimeout(timerLogout.current);
    clearTimeout(timerAviso.current);
    if (toastAvisoId.current) toast.dismiss(toastAvisoId.current);
    localStorage.removeItem('aela_token');
    localStorage.removeItem('token');
    localStorage.removeItem('aela_usuario');
    localStorage.removeItem('aela_empresa');
    localStorage.removeItem('aela_sistema');
    setUsuario(null);
    setEmpresa(null);
    setSistema(null);
    if (porInactividad) {
      toast('Sesión cerrada por inactividad. Vuelve a iniciar sesión.', { icon: '🔒', duration: 6000 });
    }
  }, []);

  // ── Cierre automático por inactividad ──────────────────────────────────────
  const reiniciarTimerInactividad = useCallback(() => {
    clearTimeout(timerLogout.current);
    clearTimeout(timerAviso.current);
    if (toastAvisoId.current) toast.dismiss(toastAvisoId.current);

    timerAviso.current = setTimeout(() => {
      toastAvisoId.current = toast(
        'Tu sesión se cerrará en 5 minutos por inactividad.',
        { icon: '⏰', duration: 5 * 60 * 1000 }
      );
    }, ADVERTENCIA_MS);

    timerLogout.current = setTimeout(() => {
      logout(true);
    }, INACTIVIDAD_MS);
  }, [logout]);

  useEffect(() => {
    if (!usuario) return;

    const eventos = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const handler = () => reiniciarTimerInactividad();

    eventos.forEach((ev) => window.addEventListener(ev, handler, { passive: true }));
    reiniciarTimerInactividad();

    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, handler));
      clearTimeout(timerLogout.current);
      clearTimeout(timerAviso.current);
    };
  }, [usuario, reiniciarTimerInactividad]);

  // Helpers derivados
  const {
    tipoSistemaActual,
    modoOperacionActual,
    esLite,
    esMedium,
    esPro,
    esFull,
    modoMulti,
    planLabel,
  } = resolverEstadoSistema({
    sistema,
    empresa,
    edition,
    modoOperacion: modoEnv,
  });

  return (
    <AuthContext.Provider value={{
      usuario, empresa, cargando,
      sistema,
      edition, modoMulti,
      tipoSistemaActual, modoOperacionActual,
      esLite, esMedium, esPro, esFull, planLabel,
      login, bootstrap, getBootstrapStatus, logout,
      setEmpresa, setSistema, recargarSistema,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
