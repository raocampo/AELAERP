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
  const [usuario,             setUsuario]             = useState(null);
  const [empresa,             setEmpresa]             = useState(null);
  const [sistema,             setSistema]             = useState(null);
  const [cargando,            setCargando]            = useState(true);
  const [empresasDisponibles, setEmpresasDisponibles] = useState([]);
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

  const cargarEmpresasDisponibles = useCallback(async () => {
    try {
      const res = await api.get('/empresas/mis-empresas');
      if (res.data?.success) setEmpresasDisponibles(res.data.data || []);
    } catch {
      // sin acceso a múltiples empresas — no es error crítico
    }
  }, []);

  const persistirSesion = useCallback(async ({ token, usuario: usuarioSesion, empresa: empresaSesion = null, tenantSlug = null }) => {
    localStorage.setItem('aela_token', token);
    localStorage.setItem('token', token);
    localStorage.setItem('aela_usuario', JSON.stringify(usuarioSesion));
    if (tenantSlug) {
      localStorage.setItem('aela_tenant_slug', tenantSlug);
    } else {
      localStorage.removeItem('aela_tenant_slug');
    }
    setUsuario(usuarioSesion);

    if (empresaSesion) {
      setEmpresa(empresaSesion);
      localStorage.setItem('aela_empresa', JSON.stringify(empresaSesion));
      await recargarSistema(empresaSesion);
      cargarEmpresasDisponibles();
      return;
    }

    try {
      const empRes = await api.get('/empresas/mi-empresa');
      if (empRes.data.success) {
        setEmpresa(empRes.data.data);
        localStorage.setItem('aela_empresa', JSON.stringify(empRes.data.data));
        await recargarSistema(empRes.data.data);
        cargarEmpresasDisponibles();
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
  }, [edition, modoEnv, recargarSistema, cargarEmpresasDisponibles]);

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
    // Guardar slug ANTES de limpiar — no es un secreto, es un identificador
    // de enrutamiento que permite volver al portal correcto tras la sesión
    const slug = localStorage.getItem('aela_tenant_slug');
    localStorage.removeItem('aela_token');
    localStorage.removeItem('token');
    localStorage.removeItem('aela_usuario');
    localStorage.removeItem('aela_empresa');
    localStorage.removeItem('aela_sistema');
    // aela_tenant_slug se mantiene intencionalmente para redirigir al portal correcto
    setUsuario(null);
    setEmpresa(null);
    setSistema(null);
    setEmpresasDisponibles([]);
    if (porInactividad) {
      toast('Sesión cerrada por inactividad. Vuelve a iniciar sesión.', { icon: '🔒', duration: 6000 });
      // Redirigir al portal del tenant, no al portal genérico de CorpSimtelec
      const destino = slug ? `/${slug}` : '/login';
      window.location.assign(destino);
    }
  }, []);

  const cambiarEmpresa = useCallback(async (empresaId) => {
    try {
      const res = await api.post('/auth/cambiar-empresa', { empresaId });
      if (!res.data.success) throw new Error(res.data.mensaje || 'Error al cambiar empresa');
      const { token, empresa: nuevaEmpresa, tenantSlug, usuario: datosUsuario } = res.data;
      localStorage.setItem('aela_token', token);
      localStorage.setItem('token', token);
      if (tenantSlug) {
        localStorage.setItem('aela_tenant_slug', tenantSlug);
      } else {
        localStorage.removeItem('aela_tenant_slug');
      }
      // Actualizar el rol efectivo para esta empresa en state y localStorage
      if (datosUsuario?.rol) {
        const usuarioActual = JSON.parse(localStorage.getItem('aela_usuario') || '{}');
        const usuarioActualizado = { ...usuarioActual, rol: datosUsuario.rol };
        setUsuario(usuarioActualizado);
        localStorage.setItem('aela_usuario', JSON.stringify(usuarioActualizado));
      }
      setEmpresa(nuevaEmpresa);
      localStorage.setItem('aela_empresa', JSON.stringify(nuevaEmpresa));
      await recargarSistema(nuevaEmpresa);
      cargarEmpresasDisponibles();
      toast.success(`Empresa activa: ${nuevaEmpresa.nombreComercial || nuevaEmpresa.razonSocial}`);
      return { success: true };
    } catch (err) {
      toast.error(err.response?.data?.mensaje || err.message || 'Error al cambiar empresa');
      return { success: false };
    }
  }, [recargarSistema, cargarEmpresasDisponibles]);

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
      empresasDisponibles, cambiarEmpresa, cargarEmpresasDisponibles,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
