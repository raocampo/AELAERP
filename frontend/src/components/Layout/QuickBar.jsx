// QuickBar — Barra de accesos rápidos contextual
// Muestra hasta 5 acciones relevantes según la ruta activa.
// El usuario puede navegar directamente desde aquí sin usar el sidebar.

import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { tienePermiso } from '../../utils/roles';
import './QuickBar.css';

// Cada entrada: { label, icon, to, permiso?, planMin?, modulo? }
const QUICK_LINKS = {
  '/dashboard': [
    { label: 'Nueva Factura',  icon: '🧾', to: '/facturas/nueva',   permiso: 'facturacion.emitir', planMin: 'medium' },
    { label: 'Nueva Compra',   icon: '🛒', to: '/compras/nueva',    permiso: 'compras.gestionar',  planMin: 'medium' },
    { label: 'Nuevo Cliente',  icon: '👤', to: '/clientes',          permiso: 'clientes.gestionar' },
    { label: 'Nota de Venta',  icon: '🗒️', to: '/notas-venta/nueva', permiso: 'notasVenta.gestionar' },
    { label: 'Buzón SRI',      icon: '📥', to: '/buzon',            permiso: 'compras.gestionar',  planMin: 'medium' },
  ],
  '/facturas': [
    { label: 'Nueva Factura',    icon: '➕', to: '/facturas/nueva',    permiso: 'facturacion.emitir' },
    { label: 'Guía Remisión',    icon: '🚚', to: '/guias-remision',    permiso: 'facturacion.ver' },
    { label: 'Notas de Débito',  icon: '🔴', to: '/notas-debito',      permiso: 'facturacion.emitir', planMin: 'pro' },
    { label: 'Retenciones',      icon: '📋', to: '/retenciones',       permiso: 'retenciones.gestionar', planMin: 'pro' },
    { label: 'ATS',              icon: '📁', to: '/ats',               permiso: 'tributario.reportes',   planMin: 'pro' },
  ],
  '/compras': [
    { label: 'Nueva Compra',     icon: '➕', to: '/compras/nueva',     permiso: 'compras.gestionar' },
    { label: 'Proveedores',      icon: '🏬', to: '/proveedores',       permiso: 'compras.gestionar' },
    { label: 'Buzón SRI',        icon: '📥', to: '/buzon',             permiso: 'compras.gestionar' },
    { label: 'Liquidaciones',    icon: '📄', to: '/liquidaciones',     permiso: 'liquidaciones.gestionar', planMin: 'pro' },
    { label: 'Retenciones',      icon: '📋', to: '/retenciones',       permiso: 'retenciones.gestionar',   planMin: 'pro' },
  ],
  '/notas-venta': [
    { label: 'Nueva Nota',       icon: '➕', to: '/notas-venta/nueva', permiso: 'notasVenta.gestionar' },
    { label: 'Clientes',         icon: '👤', to: '/clientes',          permiso: 'clientes.gestionar' },
    { label: 'POS',              icon: '🛍️', to: '/pos',               permiso: 'pos.usar' },
    { label: 'Productos',        icon: '📦', to: '/productos',         permiso: 'productos.ver' },
  ],
  '/clientes': [
    { label: 'Nuevo Cliente',    icon: '➕', to: '/clientes',          permiso: 'clientes.gestionar' },
    { label: 'Nueva Factura',    icon: '🧾', to: '/facturas/nueva',    permiso: 'facturacion.emitir', planMin: 'medium' },
    { label: 'Nota de Venta',    icon: '🗒️', to: '/notas-venta/nueva', permiso: 'notasVenta.gestionar' },
    { label: 'Hub Financiero',   icon: '📊', to: '/finanzas',          permiso: 'facturacion.ver',    planMin: 'medium' },
  ],
  '/proveedores': [
    { label: 'Nueva Compra',     icon: '➕', to: '/compras/nueva',     permiso: 'compras.gestionar' },
    { label: 'Compras',          icon: '🛒', to: '/compras',           permiso: 'compras.gestionar' },
    { label: 'Buzón SRI',        icon: '📥', to: '/buzon',             permiso: 'compras.gestionar' },
  ],
  '/productos': [
    { label: 'Nuevo Producto',   icon: '➕', to: '/productos',         permiso: 'productos.gestionar' },
    { label: 'Inventario',       icon: '📚', to: '/inventario',        permiso: 'inventario.ver' },
    { label: 'POS',              icon: '🛍️', to: '/pos',               permiso: 'pos.usar' },
  ],
  '/inventario': [
    { label: 'Productos',        icon: '📦', to: '/productos',         permiso: 'productos.ver' },
    { label: 'POS',              icon: '🛍️', to: '/pos',               permiso: 'pos.usar' },
    { label: 'Nuevo Producto',   icon: '➕', to: '/productos',         permiso: 'productos.gestionar' },
  ],
  '/retenciones': [
    { label: 'Nueva Retención',  icon: '➕', to: '/retenciones/nueva', permiso: 'retenciones.gestionar' },
    { label: 'Facturas',         icon: '🧾', to: '/facturas',          permiso: 'facturacion.ver' },
    { label: 'ATS',              icon: '📁', to: '/ats',               permiso: 'tributario.reportes' },
    { label: 'Declaraciones',    icon: '🏛️', to: '/declaraciones',     permiso: 'tributario.reportes' },
  ],
  '/contabilidad': [
    { label: 'Nuevo Asiento',    icon: '➕', to: '/contabilidad',      permiso: 'contabilidad.gestionar' },
    { label: 'Bancos',           icon: '🏦', to: '/bancos',             permiso: 'bancos.ver', planMin: 'medium' },
    { label: 'Reportes',         icon: '📈', to: '/reportes-tributarios', permiso: 'tributario.reportes' },
    { label: 'Declaraciones',    icon: '🏛️', to: '/declaraciones',      permiso: 'tributario.reportes' },
  ],
  '/bancos': [
    { label: 'Contabilidad',     icon: '💼', to: '/contabilidad',       permiso: 'contabilidad.ver', planMin: 'pro' },
    { label: 'Compras',          icon: '🛒', to: '/compras',            permiso: 'compras.gestionar' },
    { label: 'Proveedores',      icon: '🏬', to: '/proveedores',        permiso: 'compras.gestionar' },
  ],
  '/buzon': [
    { label: 'Compras',          icon: '🛒', to: '/compras',           permiso: 'compras.gestionar' },
    { label: 'Retenciones',      icon: '📋', to: '/retenciones',       permiso: 'retenciones.gestionar', planMin: 'pro' },
    { label: 'Proveedores',      icon: '🏬', to: '/proveedores',       permiso: 'compras.gestionar' },
  ],
};

// Mapa de nivel mínimo de plan a peso numérico
const PLAN_PESO = { lite: 0, medium: 1, pro: 2 };

export default function QuickBar() {
  const { pathname } = useLocation();
  const navigate    = useNavigate();
  const { usuario, esLite, esMedium } = useAuth();

  // Buscar el prefijo más largo que coincida
  const baseKey = Object.keys(QUICK_LINKS)
    .filter((k) => pathname === k || pathname.startsWith(k + '/') || pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];

  if (!baseKey) return null;

  const planPeso = esLite ? 0 : esMedium ? 1 : 2;

  const links = (QUICK_LINKS[baseKey] || []).filter((l) => {
    if (l.permiso && !tienePermiso(usuario?.rol, l.permiso)) return false;
    if (l.planMin && PLAN_PESO[l.planMin] > planPeso) return false;
    return true;
  });

  if (links.length === 0) return null;

  return (
    <nav className="quickbar" aria-label="Acciones rápidas">
      <span className="quickbar-label">Accesos rápidos</span>
      {links.map((l) => (
        <button
          key={l.to}
          className="quickbar-btn"
          onClick={() => navigate(l.to)}
          title={l.label}
        >
          <span className="quickbar-icon">{l.icon}</span>
          {l.label}
        </button>
      ))}
    </nav>
  );
}
