// ====================================
// LAYOUT — AELA
// Sidebar adaptativo con menús agrupados y colapsables según plan (lite/medium/pro).
// Los módulos de planes superiores se muestran bloqueados (🔒)
// y al hacer click abren el UpgradeModal con comparativo de planes.
// ====================================

import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { obtenerRolLabel, tienePermiso } from '../../utils/roles';
import {
  moduloDeshabilitadoPorConfiguracion,
  planBloqueadoPorRequisito,
} from '../../utils/sistema';
import UpgradeModal from '../Upgrade/UpgradeModal';
import CambiarPassword from '../Auth/CambiarPassword';
import QuickBar from './QuickBar';
import EmpresaSwitcher from './EmpresaSwitcher';
import './Layout.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

/** Hook: consulta cada 60s los comprobantes pendientes de envío al SRI */
function usePendientesSRI() {
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    const fetchPendientes = async () => {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await fetch(`${API_URL}/cola-sri/estado`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setPendientes(data.pendientes?.total ?? 0);
        }
      } catch {
        // Mantener el ultimo valor conocido si la consulta falla temporalmente.
      }
    };

    fetchPendientes();
    const id = setInterval(fetchPendientes, 60_000);
    return () => clearInterval(id);
  }, []);

  return pendientes;
}

// ─── Ítems independientes (fuera de grupos) ───────────────────────────────────
const ITEMS_SUELTOS = [
  { to: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { to: '/pos',       icon: '🛍️', label: 'POS', permiso: 'pos.usar', modulo: 'posHabilitado' },
];

// ─── Grupos de menú con subítems ─────────────────────────────────────────────
// planMin: plan mínimo requerido ('lite' = todos, 'medium', 'pro')
// modulo:  clave en el objeto `sistema` (si es false, ocultar aunque el plan lo permita)
// soloMulti: solo visible en modo multiempresa
const GRUPOS_MENU = [
  {
    id: 'ventas',
    icon: '📊',
    label: 'Ventas',
    items: [
      { to: '/facturas',        icon: '🧾', label: 'Facturas',           planMin: 'medium', permiso: 'facturacion.ver' },
      { to: '/notas-venta',     icon: '🗒️', label: 'Notas de Venta',    permiso: 'notasVenta.gestionar' },
      { to: '/notas-debito',    icon: '🔴', label: 'Notas de Débito',   planMin: 'pro',    permiso: 'facturacion.emitir' },
      { to: '/guias-remision',  icon: '🚚', label: 'Guías de Remisión', planMin: 'medium', permiso: 'facturacion.ver' },
      { to: '/caja',            icon: '💵', label: 'Caja Diaria',       permiso: 'caja.ver', modulo: 'cajaDiariaHabilitada' },
    ],
  },
  {
    id: 'compras',
    icon: '🛒',
    label: 'Compras',
    items: [
      { to: '/compras',       icon: '🛒', label: 'Compras',       planMin: 'medium', permiso: 'compras.gestionar',       modulo: 'comprasHabilitadas' },
      { to: '/liquidaciones', icon: '📄', label: 'Liquidaciones', planMin: 'pro',    permiso: 'liquidaciones.gestionar', modulo: 'liquidacionesHabilitadas' },
      { to: '/buzon',         icon: '📥', label: 'Buzón SRI',     planMin: 'medium', permiso: 'compras.gestionar',       modulo: 'comprasHabilitadas' },
    ],
  },
  {
    id: 'inventario',
    icon: '📦',
    label: 'Inventario',
    items: [
      { to: '/productos',  icon: '📦', label: 'Productos',  permiso: 'productos.ver' },
      { to: '/inventario', icon: '📚', label: 'Inventario', permiso: 'inventario.ver', modulo: 'inventarioHabilitado' },
    ],
  },
  {
    id: 'clientes-proveedores',
    icon: '👥',
    label: 'Clientes y Proveedores',
    items: [
      { to: '/clientes',    icon: '👤', label: 'Clientes',    permiso: 'clientes.gestionar' },
      { to: '/proveedores', icon: '🏬', label: 'Proveedores', planMin: 'medium', permiso: 'compras.gestionar', modulo: 'comprasHabilitadas' },
    ],
  },
  {
    id: 'tributario',
    icon: '🏛️',
    label: 'Tributario',
    items: [
      { to: '/retenciones',          icon: '📋', label: 'Retenciones',         planMin: 'pro', permiso: 'retenciones.gestionar',  modulo: 'retencionesHabilitadas' },
      { to: '/ats',                  icon: '📁', label: 'ATS',                  planMin: 'pro', permiso: 'tributario.reportes',    modulo: 'atsHabilitado' },
      { to: '/declaraciones',        icon: '🏛️', label: 'Declaraciones',        planMin: 'pro', permiso: 'tributario.reportes' },
      { to: '/reportes-tributarios', icon: '📈', label: 'Reportes Tributarios', planMin: 'pro', permiso: 'tributario.reportes' },
    ],
  },
  {
    id: 'contabilidad',
    icon: '💼',
    label: 'Contabilidad',
    items: [
      { to: '/contabilidad', icon: '💼', label: 'Contabilidad', planMin: 'pro',    permiso: 'contabilidad.ver', modulo: 'contabilidadHabilitada' },
      { to: '/bancos',       icon: '🏦', label: 'Bancos',       planMin: 'medium', permiso: 'bancos.ver' },
    ],
  },
  {
    id: 'configuracion',
    icon: '⚙️',
    label: 'Configuración',
    items: [
      { to: '/configuracion-sri',     icon: '⚙️', label: 'Config SRI',    permiso: 'sri.configurar' },
      { to: '/configuracion-sistema', icon: '🛠️', label: 'Config Sistema', permiso: 'sistema.configurar' },
    ],
  },
  {
    id: 'talento-humano',
    icon: '👔',
    label: 'Talento Humano',
    planMin: 'medium',
    modulo: 'talentoHumanoHabilitado',
    items: [
      { to: '/talento-humano',               icon: '👔', label: 'Resumen',       planMin: 'medium', permiso: 'rrhh.ver',      modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/empleados',     icon: '👤', label: 'Empleados',     planMin: 'medium', permiso: 'rrhh.ver',      modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/departamentos', icon: '🏢', label: 'Departamentos', planMin: 'medium', permiso: 'rrhh.gestionar', modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/cargos',        icon: '📋', label: 'Cargos',        planMin: 'medium', permiso: 'rrhh.gestionar', modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/nomina',        icon: '💰', label: 'Nómina',        planMin: 'medium', permiso: 'rrhh.nomina',    modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/ausencias',     icon: '📅', label: 'Ausencias',     planMin: 'medium', permiso: 'rrhh.ver',      modulo: 'talentoHumanoHabilitado' },
    ],
  },
  {
    id: 'administracion',
    icon: '🔑',
    label: 'Administración',
    items: [
      { to: '/usuarios', icon: '👤', label: 'Usuarios', permiso: 'usuarios.gestionar' },
      { to: '/empresas', icon: '🏢', label: 'Empresas', permiso: 'empresas.gestionar' },
    ],
  },
];

/** Devuelve el id del grupo que contiene la ruta activa (null si es ítem suelto) */
function grupoDeRuta(pathname) {
  for (const grupo of GRUPOS_MENU) {
    const match = grupo.items.some(
      (item) => pathname === item.to || pathname.startsWith(item.to + '/')
    );
    if (match) return grupo.id;
  }
  return null;
}

export default function Layout() {
  const { usuario, empresa, sistema, logout, esLite, esMedium, modoMulti, planLabel } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [upgradeTarget, setUpgradeTarget] = useState(null); // { planRequerido, moduloPath }
  const [mostrarCambiarPassword, setMostrarCambiarPassword] = useState(false);
  const [offline, setOffline]     = useState(!navigator.onLine);
  const [swUpdate, setSwUpdate]   = useState(false);
  const pendientesSRI = usePendientesSRI();

  // ── Sidebar colapsable — persiste en localStorage ──────────────────────────
  const [sidebarColapsado, setSidebarColapsado] = useState(() => {
    return localStorage.getItem('aela_sidebar_colapsado') === 'true';
  });
  const toggleSidebar = () => {
    setSidebarColapsado((prev) => {
      localStorage.setItem('aela_sidebar_colapsado', String(!prev));
      return !prev;
    });
  };

  // Estado de apertura por grupo; abre el grupo activo al cargar (null si es ítem suelto)
  const [gruposAbiertos, setGruposAbiertos] = useState(() => {
    const activo = grupoDeRuta(location.pathname);
    return Object.fromEntries(GRUPOS_MENU.map((g) => [g.id, g.id === activo]));
  });

  // Auto-abrir el grupo cuando se navega a una ruta que pertenece a un grupo
  useEffect(() => {
    const activo = grupoDeRuta(location.pathname);
    if (activo) setGruposAbiertos((prev) => ({ ...prev, [activo]: true }));
  }, [location.pathname]);

  const toggleGrupo = (id) =>
    setGruposAbiertos((prev) => ({ ...prev, [id]: !prev[id] }));

  useEffect(() => {
    const onOnline  = () => setOffline(false);
    const onOffline = () => setOffline(true);
    const onSwUpdate = () => setSwUpdate(true);
    window.addEventListener('online',   onOnline);
    window.addEventListener('offline',  onOffline);
    window.addEventListener('aela:sw-update', onSwUpdate);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('aela:sw-update', onSwUpdate);
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`layout-root${sidebarColapsado ? ' sidebar-is-colapsado' : ''}`}>

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar${sidebarColapsado ? ' colapsado' : ''}`}>

        {/* Brand — clic colapsa/expande según estado */}
        <div
          className="sidebar-brand sidebar-brand-clickable"
          onClick={toggleSidebar}
          title={sidebarColapsado ? 'Expandir menú' : 'Colapsar menú'}
        >
          <div className="sidebar-brand-logo">
            <svg width="32" height="32" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
              <rect width="64" height="64" rx="14" fill="white" fillOpacity="0.15"/>
              <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" strokeWidth="2.5"/>
              <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
              <circle cx="32" cy="29" r="4.5" fill="white"/>
            </svg>
            {!sidebarColapsado && (
              <div>
                <span className="sidebar-sigla">AELA</span>
                <span className="sidebar-sub">ERP Ecuador</span>
              </div>
            )}
          </div>
          {!sidebarColapsado && (
            <span className={`sidebar-plan-badge ${esLite ? 'lite' : esMedium ? 'medium' : 'pro'}`}>
              {planLabel}
            </span>
          )}
        </div>

        {/* Empresa */}
        {!sidebarColapsado && (
          <div className="sidebar-empresa">
            {empresa?.razonSocial || 'Empresa activa'}
            <small style={{ display: 'block', color: '#94a3b8', marginTop: 4 }}>
              {modoMulti ? 'Modo multiempresa' : 'Modo monoempresa'}
            </small>
          </div>
        )}

        {/* Selector de empresa activa (macro empresa — solo si hay ≥2 empresas) */}
        {!sidebarColapsado && <EmpresaSwitcher />}

        {/* Badge: comprobantes pendientes de envío al SRI */}
        {pendientesSRI > 0 && !sidebarColapsado && (
          <div className="sidebar-cola-sri-badge" title="Comprobantes firmados esperando envío al SRI (sin internet)">
            <span className="cola-sri-icon">⏳</span>
            <span>{pendientesSRI} pendiente{pendientesSRI !== 1 ? 's' : ''} SRI</span>
            <span className="cola-sri-hint">Se enviarán cuando vuelva el internet</span>
          </div>
        )}
        {pendientesSRI > 0 && sidebarColapsado && (
          <div className="sidebar-cola-sri-dot" title={`${pendientesSRI} comprobantes pendientes SRI`}>⏳</div>
        )}

        {/* Nav con ítems sueltos + grupos colapsables */}
        <nav className="sidebar-nav">

          {/* ── Ítems independientes (Dashboard y POS) ── */}
          {ITEMS_SUELTOS.map((item) => {
            if (item.modulo && moduloDeshabilitadoPorConfiguracion(item, sistema)) return null;
            if (item.permiso && !tienePermiso(usuario?.rol, item.permiso)) return null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-link sidebar-link-solo ${isActive ? 'active' : ''}`}
                title={sidebarColapsado ? item.label : undefined}
              >
                <span className="sidebar-item-icon">{item.icon}</span>
                {!sidebarColapsado && <span>{item.label}</span>}
              </NavLink>
            );
          })}

          {/* ── Separador visual entre ítems sueltos y grupos ── */}
          <div className="sidebar-solo-separator" />

          {GRUPOS_MENU.map((grupo) => {

            // ── Procesar ítems del grupo ──
            const itemsProcesados = grupo.items
              .filter((item) => {
                if (item.soloMulti && !modoMulti) return false;
                return true;
              })
              .map((item) => {
                const bloqueado    = planBloqueadoPorRequisito(item.planMin, { esLite, esMedium });
                const deshabilitado = !bloqueado && moduloDeshabilitadoPorConfiguracion(item, sistema);
                const sinPermiso   = item.permiso && !tienePermiso(usuario?.rol, item.permiso);
                return { ...item, bloqueado, deshabilitado, sinPermiso };
              })
              .filter((item) => {
                if (item.sinPermiso && !item.bloqueado) return false;
                if (item.deshabilitado) return false;
                return true;
              });

            // Ocultar el grupo si no tiene ningún ítem visible
            if (itemsProcesados.length === 0) return null;

            const isOpen   = !!gruposAbiertos[grupo.id];
            const isActive = itemsProcesados.some(
              (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
            );

            // En modo colapsado: mostrar solo el icono del grupo; clic expande el sidebar
            if (sidebarColapsado) {
              return (
                <button
                  key={grupo.id}
                  className={`sidebar-group-header sidebar-group-icon-only ${isActive ? 'active' : ''}`}
                  onClick={toggleSidebar}
                  title={grupo.label}
                >
                  <span className="sidebar-group-icon">{grupo.icon}</span>
                </button>
              );
            }

            return (
              <div key={grupo.id} className="sidebar-group">
                <button
                  className={`sidebar-group-header ${isActive ? 'active' : ''}`}
                  onClick={() => toggleGrupo(grupo.id)}
                  aria-expanded={isOpen}
                >
                  <span className="sidebar-group-icon">{grupo.icon}</span>
                  <span className="sidebar-group-label">{grupo.label}</span>
                  <span className={`sidebar-group-arrow ${isOpen ? 'open' : ''}`}>▾</span>
                </button>

                {isOpen && (
                  <div className="sidebar-group-items">
                    {itemsProcesados.map((item) => {
                      if (item.bloqueado) {
                        return (
                          <ItemBloqueado
                            key={item.to}
                            item={item}
                            onUpgrade={setUpgradeTarget}
                            sub
                          />
                        );
                      }
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          className={({ isActive: active }) => `sidebar-sublink ${active ? 'active' : ''}`}
                        >
                          {item.icon} {item.label}
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Banner límite Lite */}
        {esLite && empresa?.factAnualesMax && !sidebarColapsado && (
          <LimiteBanner empresa={empresa} />
        )}

        {/* Footer usuario */}
        <div className="sidebar-footer">
          {!sidebarColapsado ? (
            <>
              <div className="sidebar-usuario">{usuario?.nombre}</div>
              <div className="sidebar-rol">{obtenerRolLabel(usuario?.rol)}</div>
              <button className="sidebar-cambiar-pass" onClick={() => setMostrarCambiarPassword(true)}>
                🔑 Cambiar contraseña
              </button>
              <button className="sidebar-logout" onClick={handleLogout}>Cerrar sesión</button>
            </>
          ) : (
            <button
              className="sidebar-logout sidebar-logout-icon"
              onClick={handleLogout}
              title="Cerrar sesión"
            >
              🚪
            </button>
          )}
        </div>
      </aside>

      {/* ── CONTENIDO ── */}
      <main className={`layout-main${sidebarColapsado ? ' sidebar-main-colapsado' : ''}`}>
        <QuickBar />
        <Outlet />
      </main>

      {/* ── MODAL UPGRADE ── */}
      {upgradeTarget && (
        <UpgradeModal
          planRequerido={upgradeTarget.planRequerido}
          moduloPath={upgradeTarget.moduloPath}
          onClose={() => setUpgradeTarget(null)}
        />
      )}

      {/* ── MODAL CAMBIAR CONTRASEÑA ── */}
      {mostrarCambiarPassword && (
        <CambiarPassword onClose={() => setMostrarCambiarPassword(false)} />
      )}

      {/* ── BANNER OFFLINE ── */}
      {offline && (
        <div className="banner-offline" role="status">
          Sin conexión — Puedes seguir trabajando. Los datos se sincronizarán al volver el internet.
        </div>
      )}

      {/* ── TOAST ACTUALIZACIÓN SW ── */}
      {swUpdate && (
        <div className="toast-sw-update" role="alert">
          <span>Nueva versión disponible.</span>
          <button onClick={() => window.location.reload()}>Actualizar ahora</button>
          <button onClick={() => setSwUpdate(false)}>Después</button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componente: item bloqueado ──────────────────────────────────────────
function ItemBloqueado({ item, onUpgrade, sub = false }) {
  return (
    <button
      className={sub ? 'sidebar-sublink-locked' : 'sidebar-link-locked'}
      onClick={() => onUpgrade({ planRequerido: item.planMin, moduloPath: item.to })}
      title={`Requiere plan ${item.planMin === 'medium' ? 'Medium' : 'Pro'}`}
    >
      <span>{item.icon} {item.label}</span>
      <span className="sidebar-link-locked-icon">🔒</span>
    </button>
  );
}

// ─── Banner de límite anual (solo Lite) ──────────────────────────────────────
function LimiteBanner({ empresa }) {
  return (
    <div className="sidebar-limite-banner">
      <span>Plan Lite</span>
      <span>Máx {empresa.factAnualesMax} comprobantes/año</span>
      <span>Máx 100 productos</span>
    </div>
  );
}
