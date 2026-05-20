import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { tienePermiso } from '../../utils/roles';
import './Dashboard.css';

const fmt = (n) =>
  n == null ? '–' : Number(n).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export default function Dashboard() {
  const { usuario, empresa, sistema, modoMulti, planLabel, esLite, esMedium } = useAuth();
  const [stats, setStats] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let ignore = false;
    api.get('/empresas/estadisticas')
      .then((res) => { if (!ignore && res.data?.success) setStats(res.data.data); })
      .catch(() => {})
      .finally(() => { if (!ignore) setCargando(false); });
    return () => { ignore = true; };
  }, []);

  const ahora = new Date();
  const mesLabel = `${MESES[ahora.getMonth()]} ${ahora.getFullYear()}`;

  // Quick links según plan y permisos
  const accesos = [
    { to: '/pos',         label: '🛍️ POS',             show: sistema?.posHabilitado && tienePermiso(usuario?.rol, 'pos.usar', usuario?.permisosExtra) },
    { to: '/caja',        label: '💵 Caja Diaria',     show: sistema?.cajaDiariaHabilitada && tienePermiso(usuario?.rol, 'caja.ver', usuario?.permisosExtra) },
    { to: '/notas-venta', label: '🗒️ Notas de Venta',  show: tienePermiso(usuario?.rol, 'notasVenta.gestionar', usuario?.permisosExtra) },
    { to: '/facturas',    label: '🧾 Facturas',         show: !esLite && tienePermiso(usuario?.rol, 'facturacion.ver', usuario?.permisosExtra) },
    { to: '/inventario',  label: '📚 Inventario',      show: sistema?.inventarioHabilitado && tienePermiso(usuario?.rol, 'inventario.ver', usuario?.permisosExtra) },
    { to: '/clientes',    label: '👤 Clientes',         show: tienePermiso(usuario?.rol, 'clientes.gestionar', usuario?.permisosExtra) },
    { to: '/productos',   label: '📦 Productos',        show: tienePermiso(usuario?.rol, 'productos.ver', usuario?.permisosExtra) },
    { to: '/compras',     label: '🛒 Compras',          show: sistema?.comprasHabilitadas && tienePermiso(usuario?.rol, 'compras.gestionar', usuario?.permisosExtra) },
    { to: '/retenciones', label: '📋 Retenciones',      show: sistema?.retencionesHabilitadas && tienePermiso(usuario?.rol, 'retenciones.gestionar', usuario?.permisosExtra) },
    { to: '/configuracion-sri',    label: '⚙️ Config SRI',     show: tienePermiso(usuario?.rol, 'sri.configurar') },
    { to: '/configuracion-sistema', label: '🛠️ Config Sistema', show: tienePermiso(usuario?.rol, 'sistema.configurar') },
  ].filter((item) => item.show);

  const modulos = [
    { label: 'Caja Diaria',   activo: Boolean(sistema?.cajaDiariaHabilitada) },
    { label: 'POS',           activo: Boolean(sistema?.posHabilitado) },
    { label: 'Inventario',    activo: Boolean(sistema?.inventarioHabilitado) },
    { label: 'Compras',       activo: Boolean(sistema?.comprasHabilitadas) },
    { label: 'Contabilidad',  activo: Boolean(sistema?.contabilidadHabilitada) },
    { label: 'Retenciones',   activo: Boolean(sistema?.retencionesHabilitadas) },
    { label: 'Liquidaciones', activo: Boolean(sistema?.liquidacionesHabilitadas) },
    { label: 'ATS',           activo: Boolean(sistema?.atsHabilitado) },
  ];

  // Barra límite anual
  const limiteAnual = stats?.limiteAnual ?? null;
  const totalComp   = stats?.totalComprobantes ?? 0;
  const pctUsado    = limiteAnual ? Math.min(Math.round((totalComp / limiteAnual) * 100), 100) : 0;
  const colorBarra  = pctUsado >= 90 ? '#ef4444' : pctUsado >= 70 ? '#f59e0b' : '#22c55e';

  const planColor = esLite ? '#F9A825' : esMedium ? '#7C3AED' : '#1976D2';

  // Alerta stock bajo
  const hayStockBajo = (stats?.stockBajo ?? 0) > 0;

  return (
    <div className="dash-root">
      {/* HERO */}
      <div className="dash-hero">
        <div>
          <h1 className="dash-titulo">Panel principal</h1>
          <p className="dash-bienvenida">
            {empresa?.razonSocial || 'AELA'} · Sesión de <strong>{usuario?.nombre}</strong>
          </p>
        </div>
        <div className="dash-plan" style={{ background: `${planColor}18`, color: planColor, borderColor: `${planColor}40` }}>
          {planLabel} · {modoMulti ? 'Multiempresa' : 'Monoempresa'}
        </div>
      </div>

      {/* MÉTRICAS DEL MES */}
      <p className="dash-section-label">Resumen de {mesLabel}</p>
      <div className="dash-metrics">
        <div className="dash-metric dash-metric--green">
          <span>Ventas del mes</span>
          <strong>{cargando ? '…' : `$${fmt(stats?.ventasMes)}`}</strong>
          <small>{cargando ? '' : `${(stats?.facturasMes ?? 0) + (stats?.notasVentaMes ?? 0)} comprobantes`}</small>
        </div>
        {sistema?.comprasHabilitadas && (
          <div className="dash-metric dash-metric--red">
            <span>Compras del mes</span>
            <strong>{cargando ? '…' : `$${fmt(stats?.comprasMes)}`}</strong>
            <small>{cargando ? '' : `${stats?.comprasMesCount ?? 0} facturas`}</small>
          </div>
        )}
        {sistema?.inventarioHabilitado && (
          <div className={`dash-metric ${hayStockBajo ? 'dash-metric--warn' : ''}`}>
            <span>Stock bajo mínimo</span>
            <strong>{cargando ? '…' : (stats?.stockBajo ?? 0)}</strong>
            <small>{hayStockBajo ? '⚠️ Reabastecer' : 'Sin alertas'}</small>
          </div>
        )}
        {sistema?.cajaDiariaHabilitada && (
          <div className="dash-metric dash-metric--blue">
            <span>{stats?.cajaNombre ?? 'Caja'} hoy</span>
            <strong>{cargando ? '…' : (stats?.saldoCajaHoy != null ? `$${fmt(stats.saldoCajaHoy)}` : 'Cerrada')}</strong>
            <small>{stats?.saldoCajaHoy != null ? 'Abierta' : 'Sin caja abierta'}</small>
          </div>
        )}
        <div className="dash-metric">
          <span>Facturas {ahora.getFullYear()}</span>
          <strong>{cargando ? '…' : (stats?.facturas ?? 0)}</strong>
          <small>Notas: {stats?.notasVenta ?? 0}</small>
        </div>
        <div className="dash-metric">
          <span>Clientes activos</span>
          <strong>{cargando ? '…' : (stats?.clientes ?? 0)}</strong>
          <small>Proveedores: {stats?.proveedores ?? 0}</small>
        </div>
        <div className="dash-metric">
          <span>Productos activos</span>
          <strong>{cargando ? '…' : (stats?.productos ?? 0)}</strong>
          {esLite && <small>Límite: 100</small>}
        </div>
      </div>

      {/* BARRA LÍMITE ANUAL */}
      {!cargando && limiteAnual && (
        <div className="dash-card dash-limite">
          <div className="dash-limite-header">
            <span>Comprobantes emitidos {ahora.getFullYear()}</span>
            <strong style={{ color: colorBarra }}>
              {totalComp} / {limiteAnual} ({pctUsado}%)
            </strong>
          </div>
          <div className="dash-barra-bg">
            <div className="dash-barra-fill" style={{ width: `${pctUsado}%`, background: colorBarra }} />
          </div>
          {pctUsado >= 90 && (
            <p className="dash-limite-aviso">
              ⚠️ Estás cerca del límite anual de tu plan {planLabel}. Considera actualizar a un plan superior.
            </p>
          )}
        </div>
      )}

      <div className="dash-grid">
        {/* EMPRESA */}
        <section className="dash-card">
          <h2>Empresa activa</h2>
          <div className="dash-list">
            <div><span>RUC</span><strong>{empresa?.ruc || 'Pendiente'}</strong></div>
            <div><span>Razón social</span><strong>{empresa?.razonSocial || 'Sin configurar'}</strong></div>
            <div><span>Plan</span><strong style={{ color: planColor }}>{planLabel}</strong></div>
            <div><span>Modo</span><strong>{modoMulti ? 'Multiempresa' : 'Monoempresa'}</strong></div>
            {limiteAnual && (
              <div><span>Límite anual</span><strong>{limiteAnual} comprobantes</strong></div>
            )}
          </div>
        </section>

        {/* MÓDULOS */}
        <section className="dash-card">
          <h2>Módulos activos</h2>
          <div className="dash-badges">
            {modulos.map((modulo) => (
              <span key={modulo.label} className={`dash-badge ${modulo.activo ? 'on' : 'off'}`}>
                {modulo.label}
              </span>
            ))}
          </div>
          <p className="dash-note">
            Activa o desactiva módulos desde{' '}
            <Link to="/configuracion-sistema" style={{ color: '#0f766e' }}>Configuración del Sistema</Link>.
          </p>
        </section>
      </div>

      {/* ACCESOS RÁPIDOS */}
      <section className="dash-card" style={{ marginTop: 18 }}>
        <h2>Accesos rápidos</h2>
        <div className="dash-links">
          {accesos.map((acceso) => (
            <Link key={acceso.to} to={acceso.to} className="dash-link">
              {acceso.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
