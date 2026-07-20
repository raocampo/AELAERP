// ====================================
// LAYOUT — AELA
// Sidebar adaptativo con menús agrupados y colapsables según plan (lite/medium/pro).
// Los módulos de planes superiores se muestran bloqueados (🔒)
// y al hacer click abren el UpgradeModal con comparativo de planes.
// ====================================

import { useState, useEffect, Component } from 'react';
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
import api from '../../services/api';
import './Layout.css';

/** ErrorBoundary local para el Outlet — captura errores de módulos sin romper el layout */
class OutletErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(err, info) {
    console.error('[AELA Outlet]', err, info?.componentStack);
    // Chunk load error = deploy nuevo con hashes distintos; recarga automática una vez
    const isChunkError = /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(err?.message || '');
    if (isChunkError && !sessionStorage.getItem('aela_chunk_reload')) {
      sessionStorage.setItem('aela_chunk_reload', '1');
      window.location.reload();
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, textAlign: 'center', color: '#ef4444' }}>
          <p style={{ fontWeight: 700 }}>⚠️ Error al cargar el módulo</p>
          <p style={{ fontSize: 13, color: '#64748b', margin: '8px 0 16px' }}>
            {this.state.error?.message || 'Error inesperado'}
          </p>
          <button
            className="btn-primary"
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

/** Hook: consulta cada 60s los comprobantes pendientes de envío al SRI */
function usePendientesSRI() {
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    const fetchPendientes = async () => {
      const token      = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const tenantSlug = localStorage.getItem('aela_tenant_slug');
      if (!token) return;
      try {
        const headers = { Authorization: `Bearer ${token}` };
        if (tenantSlug) headers['X-Tenant-Slug'] = tenantSlug;
        const res = await fetch(`${API_URL}/cola-sri/estado`, { headers });
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
  { to: '/ayuda',     icon: '❓', label: 'Ayuda' },
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
      { to: '/facturas',                    icon: '🧾', label: 'Facturas',              planMin: 'medium', permiso: 'facturacion.ver', modulo: 'facturacionHabilitada' },
      { to: '/facturas/importar-historicas', icon: '📥', label: 'Importar históricas',   planMin: 'medium', permiso: 'facturacion.emitir', modulo: 'facturacionHabilitada' },
      { to: '/proformas',                   icon: '📋', label: 'Proformas',             permiso: 'proformas.gestionar' },
      { to: '/notas-venta',     icon: '🗒️', label: 'Notas de Venta',    permiso: 'notasVenta.gestionar', modulo: 'facturacionHabilitada' },
      { to: '/notas-debito',    icon: '🔴', label: 'Notas de Débito',   planMin: 'pro',    permiso: 'facturacion.emitir', modulo: 'facturacionHabilitada' },
      { to: '/guias-remision',  icon: '🚚', label: 'Guías de Remisión', planMin: 'medium', permiso: 'facturacion.ver', modulo: 'facturacionHabilitada' },
      { to: '/caja',            icon: '💵', label: 'Caja Diaria',       permiso: 'caja.ver', modulo: 'cajaDiariaHabilitada' },
    ],
  },
  {
    id: 'compras',
    icon: '🛒',
    label: 'Compras',
    items: [
      { to: '/compras',       icon: '🛒', label: 'Compras',       permiso: 'compras.gestionar',       modulo: 'comprasHabilitadas' },
      { to: '/compras/importar-historicas', icon: '📥', label: 'Importar históricas', planMin: 'medium', permiso: 'compras.gestionar', modulo: 'comprasHabilitadas' },
      { to: '/liquidaciones', icon: '📄', label: 'Liquidaciones', planMin: 'pro',    permiso: 'liquidaciones.gestionar', modulo: 'liquidacionesHabilitadas' },
      { to: '/buzon',         icon: '📥', label: 'Buzón SRI',     planMin: 'medium', permiso: 'compras.gestionar',       modulo: 'buzonSriHabilitado' },
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
      { to: '/proveedores', icon: '🏬', label: 'Proveedores', permiso: 'compras.gestionar', modulo: 'comprasHabilitadas' },
    ],
  },
  {
    id: 'tributario',
    icon: '🏛️',
    label: 'Tributario',
    items: [
      { to: '/retenciones',           icon: '📋', label: 'Retenciones emitidas',  planMin: 'pro',    permiso: 'retenciones.gestionar', modulo: 'retencionesHabilitadas' },
      { to: '/retenciones-recibidas', icon: '📥', label: 'Retenciones recibidas', planMin: 'medium', permiso: 'compras.gestionar', modulo: 'tributarioHabilitado' },
      { to: '/ats',                   icon: '📁', label: 'ATS',                   planMin: 'pro',    permiso: 'tributario.reportes', modulo: 'atsHabilitado' },
      { to: '/declaraciones',        icon: '🏛️', label: 'Declaraciones',        planMin: 'pro', permiso: 'tributario.reportes', modulo: 'tributarioHabilitado' },
      { to: '/reportes-tributarios', icon: '📈', label: 'Reportes Tributarios', planMin: 'pro', permiso: 'tributario.reportes', modulo: 'tributarioHabilitado' },
    ],
  },
  {
    id: 'contabilidad',
    icon: '💼',
    label: 'Contabilidad',
    items: [
      { to: '/contabilidad',       icon: '💼', label: 'Contabilidad',        planMin: 'pro',    permiso: 'contabilidad.ver', modulo: 'contabilidadHabilitada' },
      { to: '/cuentas-por-cobrar', icon: '💰', label: 'Cuentas por Cobrar',  planMin: 'medium', permiso: 'cxc.ver', modulo: 'contabilidadHabilitada' },
      { to: '/cuentas-por-pagar',  icon: '💳', label: 'Cuentas por Pagar',   planMin: 'medium', permiso: 'cxp.ver', modulo: 'contabilidadHabilitada' },
      { to: '/caja-chica',         icon: '💵', label: 'Caja Chica',          planMin: 'medium', permiso: 'cajaChica.ver', modulo: 'contabilidadHabilitada' },
    ],
  },
  {
    id: 'bancos',
    icon: '🏦',
    label: 'Bancos',
    items: [
      { to: '/bancos',             icon: '🏦', label: 'Cuentas Bancarias',       planMin: 'medium', permiso: 'bancos.ver', modulo: 'bancosHabilitado' },
      { to: '/bancos?tab=libro',   icon: '📋', label: 'Libro de Bancos',         planMin: 'medium', permiso: 'bancos.ver', modulo: 'bancosHabilitado' },
      { to: '/bancos?tab=ingreso', icon: '⬇️', label: 'Comprobantes de Ingreso', planMin: 'medium', permiso: 'bancos.gestionar', modulo: 'bancosHabilitado' },
      { to: '/bancos?tab=pago',    icon: '⬆️', label: 'Comprobantes de Pago',    planMin: 'medium', permiso: 'bancos.gestionar', modulo: 'bancosHabilitado' },
      { to: '/bancos?tab=credito', icon: '✚',  label: 'Notas de Crédito',        planMin: 'medium', permiso: 'bancos.gestionar', modulo: 'bancosHabilitado' },
      { to: '/bancos?tab=debito',  icon: '−',  label: 'Notas de Débito',         planMin: 'medium', permiso: 'bancos.gestionar', modulo: 'bancosHabilitado' },
    ],
  },
  {
    id: 'configuracion',
    icon: '⚙️',
    label: 'Configuración',
    items: [
      { to: '/configuracion-sri',          icon: '⚙️', label: 'Config SRI',    permiso: 'sri.configurar' },
      { to: '/configuracion-sistema',      icon: '🛠️', label: 'Config Sistema', permiso: 'sistema.configurar' },
      { to: '/configuracion/utilidades',   icon: '📊', label: 'Utilidades',     permiso: 'sistema.configurar' },
      { to: '/suscripcion',               icon: '💳', label: 'Mi Suscripción',  permiso: 'sistema.configurar' },
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
      { to: '/talento-humano/departamentos', icon: '🏢', label: 'Departamentos', planMin: 'medium', permiso: 'rrhh.gestionar', modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/cargos',        icon: '📋', label: 'Cargos',        planMin: 'medium', permiso: 'rrhh.gestionar', modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/empleados',     icon: '👤', label: 'Empleados',     planMin: 'medium', permiso: 'rrhh.ver',      modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/ausencias',     icon: '📅', label: 'Ausencias',     planMin: 'medium', permiso: 'rrhh.ver',      modulo: 'talentoHumanoHabilitado' },
      { to: '/talento-humano/nomina',        icon: '💰', label: 'Nómina / Rol de Pagos', planMin: 'medium', permiso: 'rrhh.nomina', modulo: 'talentoHumanoHabilitado' },
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
    const match = grupo.items.some((item) => {
      const itemPath = item.to.split('?')[0];
      return pathname === itemPath || pathname.startsWith(itemPath + '/');
    });
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
  const [offline, setOffline]       = useState(!navigator.onLine);
  const [swUpdate, setSwUpdate]     = useState(false);
  const [trialExpirado, setTrialExpirado] = useState(false);
  const [planVencido, setPlanVencido]     = useState(null);
  const [clienteLogo, setClienteLogo] = useState(null);
  const pendientesSRI = usePendientesSRI();

  // Cargar logo del cliente desde la configuración SRI
  useEffect(() => {
    api.get('/auth/branding')
      .then(res => { if (res.data?.data?.logoUrl) setClienteLogo(res.data.data.logoUrl); })
      .catch(() => {});
  }, [empresa?.id]);

  // ── Sidebar colapsable — persiste en localStorage (mobile siempre expandido) ─
  const [sidebarColapsado, setSidebarColapsado] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return false;
    return localStorage.getItem('aela_sidebar_colapsado') === 'true';
  });
  const toggleSidebar = () => {
    setSidebarColapsado((prev) => {
      localStorage.setItem('aela_sidebar_colapsado', String(!prev));
      return !prev;
    });
  };

  // ── Sidebar mobile (drawer overlay) ─────────────────────────────────────────
  const [sidebarMobileAbierto, setSidebarMobileAbierto] = useState(false);
  const cerrarSidebarMobile = () => setSidebarMobileAbierto(false);

  // Cerrar sidebar mobile al navegar
  useEffect(() => {
    cerrarSidebarMobile();
  }, [location.pathname]);

  // Al redimensionar a mobile, forzar sidebar expandido y cerrar drawer
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarColapsado(false);
        setSidebarMobileAbierto(false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    const onOnline    = () => setOffline(false);
    const onOffline   = () => setOffline(true);
    const onSwUpdate  = () => setSwUpdate(true);
    const onTrialExp  = () => setTrialExpirado(true);
    const onPlanVenc  = (e) => setPlanVencido({ mensaje: e.detail?.mensaje });
    window.addEventListener('online',              onOnline);
    window.addEventListener('offline',             onOffline);
    window.addEventListener('aela:sw-update',      onSwUpdate);
    window.addEventListener('aela:trial-expirado', onTrialExp);
    window.addEventListener('aela:plan-vencido',   onPlanVenc);
    return () => {
      window.removeEventListener('online',              onOnline);
      window.removeEventListener('offline',             onOffline);
      window.removeEventListener('aela:sw-update',      onSwUpdate);
      window.removeEventListener('aela:trial-expirado', onTrialExp);
      window.removeEventListener('aela:plan-vencido',   onPlanVenc);
    };
  }, []);

  const handleLogout = () => {
    const slug = localStorage.getItem('aela_tenant_slug');
    logout();
    // Volver al portal del tenant, no al genérico de CorpSimtelec
    navigate(slug ? `/${slug}` : '/login');
  };

  return (
    <div className={`layout-root${sidebarColapsado ? ' sidebar-is-colapsado' : ''}`}>

      {/* ── BACKDROP MOBILE (cierra el sidebar al tocar fuera) ── */}
      {sidebarMobileAbierto && (
        <div className="sidebar-mobile-backdrop" onClick={cerrarSidebarMobile} />
      )}

      {/* ── SIDEBAR ── */}
      <aside className={`sidebar${sidebarColapsado ? ' colapsado' : ''}${sidebarMobileAbierto ? ' mobile-abierto' : ''}`}>

        {/* Brand — clic colapsa/expande según estado */}
        <div
          className="sidebar-brand sidebar-brand-clickable"
          onClick={toggleSidebar}
          title={sidebarColapsado ? 'Expandir menú' : 'Colapsar menú'}
        >
          <div className="sidebar-brand-logo">
            {clienteLogo ? (
              <img src={clienteLogo} alt="Logo" className="sidebar-client-logo" />
            ) : (
              <svg width="32" height="32" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                <rect width="64" height="64" rx="14" fill="white" fillOpacity="0.15"/>
                <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" strokeWidth="2.5"/>
                <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
                <circle cx="32" cy="29" r="4.5" fill="white"/>
              </svg>
            )}
            {!sidebarColapsado && (
              <div className="sidebar-brand-nombres">
                {empresa?.nombreComercial ? (
                  <>
                    <span className="sidebar-client-nombre">{empresa.nombreComercial}</span>
                    {empresa.razonSocial && empresa.razonSocial !== empresa.nombreComercial && (
                      <span className="sidebar-client-razon">{empresa.razonSocial}</span>
                    )}
                  </>
                ) : (
                  <span className="sidebar-client-nombre">{empresa?.razonSocial || 'AELA'}</span>
                )}
                <span className="sidebar-sub">AELA ERP by CorpSimtelec</span>
              </div>
            )}
          </div>
          {!sidebarColapsado && (
            <span className={`sidebar-plan-badge ${esLite ? 'lite' : esMedium ? 'medium' : 'pro'}`}>
              {planLabel}
            </span>
          )}
        </div>

        {/* Modo empresa */}
        {!sidebarColapsado && (
          <div className="sidebar-empresa">
            <small>{modoMulti ? 'Modo multiempresa' : 'Modo monoempresa'}</small>
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
            if (item.permiso && !tienePermiso(usuario?.rol, item.permiso, usuario?.permisosExtra)) return null;
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
                const sinPermiso   = item.permiso && !tienePermiso(usuario?.rol, item.permiso, usuario?.permisosExtra);
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
            const isActive = itemsProcesados.some((item) => {
              const itemPath = item.to.split('?')[0];
              return location.pathname === itemPath || location.pathname.startsWith(itemPath + '/');
            });

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
                          className={() => {
                            const itemPath = item.to.split('?')[0];
                            const itemSearch = item.to.includes('?') ? '?' + item.to.split('?')[1] : '';
                            const pathMatch = location.pathname === itemPath || location.pathname.startsWith(itemPath + '/');
                            const searchMatch = !itemSearch || location.search === itemSearch;
                            return `sidebar-sublink ${pathMatch && searchMatch ? 'active' : ''}`;
                          }}
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
        {/* Hamburguesa — solo visible en mobile */}
        <button
          className="sidebar-hamburger"
          onClick={() => setSidebarMobileAbierto(true)}
          aria-label="Abrir menú"
        >
          <span /><span /><span />
        </button>
        <TrialBanner empresa={empresa} />
        <div className="layout-topbar">
          <QuickBar />
          <NavLink to="/ayuda" className="layout-help-btn" title="Ayuda del sistema">
            ❓ Ayuda
          </NavLink>
        </div>
        <OutletErrorBoundary>
          <Outlet />
        </OutletErrorBoundary>
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

      {/* ── MODAL TRIAL EXPIRADO ── */}
      {trialExpirado && (
        <div className="modal-trial-expirado-overlay">
          <div className="modal-trial-expirado">
            <div className="modal-trial-icon">⏰</div>
            <h2>Tu período de prueba ha terminado</h2>
            <p>
              El período de 15 días de prueba de tu plan <strong>{empresa?.plan?.toUpperCase()}</strong> ha vencido.
              Contacta a soporte para activar tu suscripción y continuar usando AELA.
            </p>
            <a
              href="mailto:soporte@aela.ec?subject=Activar suscripción AELA"
              className="btn-primary"
            >
              Contactar soporte
            </a>
            <button className="btn-secondary" onClick={handleLogout}>Cerrar sesión</button>
          </div>
        </div>
      )}

      {/* ── MODAL PLAN VENCIDO ── */}
      {planVencido && (
        <div className="modal-trial-expirado-overlay">
          <div className="modal-trial-expirado">
            <div className="modal-trial-icon">📅</div>
            <h2>Tu suscripción ha vencido</h2>
            <p>
              {planVencido.mensaje || 'Tu plan ha vencido. Por favor renueva tu suscripción para continuar usando AELA.'}
            </p>
            <a
              href="mailto:soporte@aela.ec?subject=Renovar suscripción AELA"
              className="btn-primary"
            >
              Renovar suscripción
            </a>
            <button className="btn-secondary" onClick={handleLogout}>Cerrar sesión</button>
          </div>
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

// ─── Banner de prueba (Medium / Pro en trial) ────────────────────────────────
function TrialBanner({ empresa }) {
  if (!empresa?.esTrial || !empresa?.trialExpiresAt) return null;

  const ahora    = new Date();
  const expira   = new Date(empresa.trialExpiresAt);
  const diasMs   = expira - ahora;
  const dias     = Math.max(0, Math.ceil(diasMs / (1000 * 60 * 60 * 24)));
  const planName = empresa.plan?.toUpperCase() || 'MEDIUM';

  if (dias === 0 && diasMs <= 0) return null; // expirado — el backend devuelve 402

  const urgente = dias <= 3;

  return (
    <div className={`banner-trial${urgente ? ' banner-trial-urgente' : ''}`}>
      <span className="banner-trial-icon">⏱</span>
      <span className="banner-trial-texto">
        <strong>Prueba {planName}</strong> — {dias > 0
          ? `${dias} día${dias !== 1 ? 's' : ''} restante${dias !== 1 ? 's' : ''}`
          : 'último día'}
        . Contáctanos para activar tu suscripción.
      </span>
    </div>
  );
}
