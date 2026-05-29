// ====================================
// PANEL SUPER-ADMIN SaaS — AELA
// Standalone: no usa Layout ni AuthContext
// Accede a /api/super-admin/* con SUPER_ADMIN_KEY
// ====================================

import { useState, useEffect, useCallback } from 'react';
import './PanelSuperAdmin.css';

const API = import.meta.env.VITE_API_URL || '/api';
const SESSION_KEY = 'aela_sa_key';

const ESTADO_LABELS = {
  activo:       { label: 'Activo',       cls: 'sa-badge--activo' },
  provisioning: { label: 'Provisioning', cls: 'sa-badge--provisioning' },
  suspendido:   { label: 'Suspendido',   cls: 'sa-badge--suspendido' },
  vencido:      { label: 'Vencido',      cls: 'sa-badge--vencido' },
  error:        { label: 'Error',        cls: 'sa-badge--error' },
};

const PLAN_LABELS = { lite: 'Lite', medium: 'Medium', pro: 'Pro' };

function Badge({ estado }) {
  const cfg = ESTADO_LABELS[estado] || { label: estado, cls: '' };
  return <span className={`sa-badge ${cfg.cls}`}>{cfg.label}</span>;
}

function StatCard({ label, value, color }) {
  return (
    <div className="sa-stat-card" style={{ borderTopColor: color }}>
      <div className="sa-stat-value" style={{ color }}>{value}</div>
      <div className="sa-stat-label">{label}</div>
    </div>
  );
}

// ─── Hook API super-admin ─────────────────────────────────────────────────────
function useSaApi(clave) {
  const call = useCallback(async (method, path, body) => {
    const res = await fetch(`${API}/super-admin${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${clave}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.mensaje || 'Error');
    return json.data;
  }, [clave]);

  return {
    get:  (path)         => call('GET',    path),
    put:  (path, body)   => call('PUT',    path, body),
    post: (path, body)   => call('POST',   path, body),
  };
}

// ─── Modal editar tenant ──────────────────────────────────────────────────────
function ModalEditar({ tenant, onGuardar, onCerrar }) {
  const [form, setForm] = useState({
    plan:             tenant.plan            || 'lite',
    estado:           tenant.estado          || 'activo',
    nombreContacto:   tenant.nombreContacto  || '',
    emailContacto:    tenant.emailContacto   || '',
    telefonoContacto: tenant.telefonoContacto || '',
    fechaVencimiento: tenant.fechaVencimiento
      ? new Date(tenant.fechaVencimiento).toISOString().slice(0, 10)
      : '',
    esTrial:   tenant.esTrial   || false,
    autoRenovar: tenant.autoRenovar || false,
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="sa-modal-overlay" onClick={onCerrar}>
      <div className="sa-modal" onClick={e => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h3>Editar tenant: <strong>{tenant.slug}</strong></h3>
          <button className="sa-modal-close" onClick={onCerrar}>✕</button>
        </div>

        <div className="sa-modal-body">
          <div className="sa-form-row">
            <label>Plan</label>
            <select value={form.plan} onChange={e => set('plan', e.target.value)}>
              <option value="lite">Lite</option>
              <option value="medium">Medium</option>
              <option value="pro">Pro</option>
            </select>
          </div>

          <div className="sa-form-row">
            <label>Estado</label>
            <select value={form.estado} onChange={e => set('estado', e.target.value)}>
              <option value="activo">Activo</option>
              <option value="suspendido">Suspendido</option>
              <option value="vencido">Vencido</option>
              <option value="provisioning">Provisioning</option>
            </select>
          </div>

          <div className="sa-form-row">
            <label>Fecha vencimiento</label>
            <input type="date" value={form.fechaVencimiento}
              onChange={e => set('fechaVencimiento', e.target.value)} />
          </div>

          <div className="sa-form-row">
            <label>Nombre contacto</label>
            <input type="text" value={form.nombreContacto}
              onChange={e => set('nombreContacto', e.target.value)} />
          </div>

          <div className="sa-form-row">
            <label>Email contacto</label>
            <input type="email" value={form.emailContacto}
              onChange={e => set('emailContacto', e.target.value)} />
          </div>

          <div className="sa-form-row">
            <label>Teléfono</label>
            <input type="text" value={form.telefonoContacto}
              onChange={e => set('telefonoContacto', e.target.value)} />
          </div>

          <div className="sa-form-row sa-form-row--checks">
            <label className="sa-check">
              <input type="checkbox" checked={form.esTrial}
                onChange={e => set('esTrial', e.target.checked)} />
              Es trial
            </label>
            <label className="sa-check">
              <input type="checkbox" checked={form.autoRenovar}
                onChange={e => set('autoRenovar', e.target.checked)} />
              Auto-renovar
            </label>
          </div>
        </div>

        <div className="sa-modal-footer">
          <button className="btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primary" onClick={() => onGuardar(form)}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal nueva suscripción ──────────────────────────────────────────────────
function ModalSuscripcion({ tenant, onGuardar, onCerrar }) {
  const [form, setForm] = useState({
    plan: tenant.plan || 'lite',
    periodo: 'mensual',
    monto: '',
    fechaFin: '',
    pagoReferencia: '',
    proveedor: 'manual',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="sa-modal-overlay" onClick={onCerrar}>
      <div className="sa-modal" onClick={e => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h3>Nueva suscripción: <strong>{tenant.slug}</strong></h3>
          <button className="sa-modal-close" onClick={onCerrar}>✕</button>
        </div>

        <div className="sa-modal-body">
          <div className="sa-form-row">
            <label>Plan</label>
            <select value={form.plan} onChange={e => set('plan', e.target.value)}>
              <option value="lite">Lite</option>
              <option value="medium">Medium</option>
              <option value="pro">Pro</option>
            </select>
          </div>

          <div className="sa-form-row">
            <label>Período</label>
            <select value={form.periodo} onChange={e => set('periodo', e.target.value)}>
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
            </select>
          </div>

          <div className="sa-form-row">
            <label>Monto (USD)</label>
            <input type="number" step="0.01" min="0" value={form.monto}
              onChange={e => set('monto', e.target.value)} placeholder="0.00" />
          </div>

          <div className="sa-form-row">
            <label>Fecha de vencimiento</label>
            <input type="date" value={form.fechaFin}
              onChange={e => set('fechaFin', e.target.value)} />
          </div>

          <div className="sa-form-row">
            <label>Referencia de pago</label>
            <input type="text" value={form.pagoReferencia}
              onChange={e => set('pagoReferencia', e.target.value)}
              placeholder="Transferencia, comprobante, etc." />
          </div>

          <div className="sa-form-row">
            <label>Proveedor</label>
            <select value={form.proveedor} onChange={e => set('proveedor', e.target.value)}>
              <option value="manual">Manual</option>
              <option value="stripe">Stripe</option>
              <option value="payphone">PayPhone</option>
              <option value="paypal">PayPal</option>
            </select>
          </div>
        </div>

        <div className="sa-modal-footer">
          <button className="btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primary" onClick={() => onGuardar(form)}>Registrar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel principal ──────────────────────────────────────────────────────────
export default function PanelSuperAdmin() {
  const [clave, setClave]         = useState(() => sessionStorage.getItem(SESSION_KEY) || '');
  const [claveInput, setClaveInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [autenticado, setAutenticado] = useState(false);

  const [stats, setStats]         = useState(null);
  const [tenants, setTenants]     = useState([]);
  const [cargando, setCargando]   = useState(false);
  const [error, setError]         = useState('');
  const [busqueda, setBusqueda]   = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroPlan, setFiltroPlan]     = useState('');

  const [modalEditar, setModalEditar]   = useState(null);
  const [modalSus, setModalSus]         = useState(null);
  const [guardando, setGuardando]       = useState(false);
  const [msg, setMsg]                   = useState('');

  const api = useSaApi(clave);

  // Verificar si la clave guardada en sesión sigue siendo válida
  useEffect(() => {
    if (!clave) return;
    fetch(`${API}/super-admin/stats`, {
      headers: { Authorization: `Bearer ${clave}` },
    })
      .then(r => r.json())
      .then(j => { if (j.success) setAutenticado(true); })
      .catch(() => {});
  }, []);

  const handleLogin = async () => {
    setLoginError('');
    try {
      const res = await fetch(`${API}/super-admin/verificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave: claveInput }),
      });
      const json = await res.json();
      if (json.success) {
        sessionStorage.setItem(SESSION_KEY, claveInput);
        setClave(claveInput);
        setAutenticado(true);
      } else {
        setLoginError(json.mensaje || 'Clave incorrecta');
      }
    } catch {
      setLoginError('Error de conexión con el servidor');
    }
  };

  const cargarDatos = useCallback(async () => {
    if (!autenticado) return;
    setCargando(true);
    setError('');
    try {
      const [s, t] = await Promise.all([
        api.get('/stats'),
        api.get('/tenants'),
      ]);
      setStats(s);
      setTenants(t);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [autenticado, api]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const flash = (texto) => {
    setMsg(texto);
    setTimeout(() => setMsg(''), 3000);
  };

  const handleGuardarEdicion = async (form) => {
    setGuardando(true);
    try {
      await api.put(`/tenants/${modalEditar.id}`, form);
      flash('Tenant actualizado');
      setModalEditar(null);
      cargarDatos();
    } catch (err) {
      alert(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleGuardarSuscripcion = async (form) => {
    setGuardando(true);
    try {
      await api.post(`/tenants/${modalSus.id}/suscripciones`, form);
      flash('Suscripción registrada');
      setModalSus(null);
      cargarDatos();
    } catch (err) {
      alert(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const toggleEstado = async (t) => {
    const nuevoEstado = t.estado === 'suspendido' ? 'activo' : 'suspendido';
    try {
      await api.put(`/tenants/${t.id}`, { estado: nuevoEstado });
      flash(`Tenant ${nuevoEstado}`);
      cargarDatos();
    } catch (err) {
      alert(err.message);
    }
  };

  const cerrarSesion = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setClave('');
    setAutenticado(false);
  };

  // ── Pantalla de login ────────────────────────────────────────────────────────
  if (!autenticado) {
    return (
      <div className="sa-login-wrapper">
        <div className="sa-login-box">
          <div className="sa-login-logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="#6d28d9"/>
              <text x="8" y="28" fontSize="22" fontWeight="800" fill="white">A</text>
            </svg>
            <div>
              <div className="sa-login-title">AELA ERP</div>
              <div className="sa-login-subtitle">Panel Admin SaaS</div>
            </div>
          </div>

          <div className="sa-form-row">
            <label>Clave de administración</label>
            <input
              type="password"
              value={claveInput}
              onChange={e => setClaveInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="SUPER_ADMIN_KEY"
              autoFocus
            />
          </div>

          {loginError && <div className="sa-login-error">{loginError}</div>}

          <button className="btn-primary sa-login-btn" onClick={handleLogin}>
            Ingresar
          </button>
        </div>
      </div>
    );
  }

  // ── Filtrado ─────────────────────────────────────────────────────────────────
  const tenantsFiltrados = tenants.filter(t => {
    const q = busqueda.toLowerCase();
    const matchQ = !q ||
      t.slug.toLowerCase().includes(q) ||
      (t.nombreContacto || '').toLowerCase().includes(q) ||
      (t.emailContacto  || '').toLowerCase().includes(q);
    const matchE = !filtroEstado || t.estado === filtroEstado;
    const matchP = !filtroPlan  || t.plan   === filtroPlan;
    return matchQ && matchE && matchP;
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────────
  return (
    <div className="sa-wrapper">
      {/* Header */}
      <header className="sa-header">
        <div className="sa-header-brand">
          <svg width="32" height="32" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="8" fill="#6d28d9"/>
            <text x="8" y="28" fontSize="22" fontWeight="800" fill="white">A</text>
          </svg>
          <div>
            <span className="sa-header-title">AELA ERP</span>
            <span className="sa-header-sub">Panel Admin SaaS</span>
          </div>
        </div>
        <div className="sa-header-actions">
          {msg && <span className="sa-flash">{msg}</span>}
          <button className="btn-secondary sa-btn-sm" onClick={cargarDatos} disabled={cargando}>
            {cargando ? 'Actualizando…' : '↻ Actualizar'}
          </button>
          <button className="btn-danger sa-btn-sm" onClick={cerrarSesion}>Cerrar sesión</button>
        </div>
      </header>

      <main className="sa-main">
        {error && <div className="sa-error-banner">{error}</div>}

        {/* Stats */}
        {stats && (
          <div className="sa-stats-row">
            <StatCard label="Total tenants"  value={stats.total}        color="#6d28d9" />
            <StatCard label="Activos"         value={stats.activos}      color="#16a34a" />
            <StatCard label="Trial"           value={stats.trial}        color="#d97706" />
            <StatCard label="Suspendidos"     value={stats.suspendidos}  color="#dc2626" />
            <StatCard label="Vencidos"        value={stats.vencidos}     color="#94a3b8" />
            <StatCard label="Provisioning"    value={stats.provisioning} color="#0284c7" />
          </div>
        )}

        {/* Filtros */}
        <div className="sa-filters">
          <input
            className="sa-search"
            type="text"
            placeholder="Buscar por slug, nombre o email…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="trial">Trial</option>
            <option value="provisioning">Provisioning</option>
            <option value="suspendido">Suspendido</option>
            <option value="vencido">Vencido</option>
          </select>
          <select value={filtroPlan} onChange={e => setFiltroPlan(e.target.value)}>
            <option value="">Todos los planes</option>
            <option value="lite">Lite</option>
            <option value="medium">Medium</option>
            <option value="pro">Pro</option>
          </select>
        </div>

        {/* Tabla */}
        {cargando && !tenants.length ? (
          <div className="sa-loading">Cargando tenants…</div>
        ) : (
          <div className="sa-table-wrapper">
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Slug / Acceso</th>
                  <th>Contacto</th>
                  <th>Plan</th>
                  <th>Estado</th>
                  <th>Vencimiento</th>
                  <th>Registro</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {tenantsFiltrados.length === 0 && (
                  <tr><td colSpan={7} className="sa-empty">No hay tenants que coincidan</td></tr>
                )}
                {tenantsFiltrados.map(t => (
                  <tr key={t.id} className={t.estado === 'suspendido' ? 'sa-row--suspendido' : ''}>
                    <td>
                      <div className="sa-slug">{t.slug}</div>
                      <div className="sa-db-name">{t.dbName}</div>
                    </td>
                    <td>
                      <div>{t.nombreContacto || <span className="sa-empty-val">—</span>}</div>
                      <div className="sa-email">{t.emailContacto || ''}</div>
                      <div className="sa-tel">{t.telefonoContacto || ''}</div>
                    </td>
                    <td>
                      <span className={`sa-plan sa-plan--${t.plan}`}>
                        {PLAN_LABELS[t.plan] || t.plan}
                      </span>
                      {t.esTrial && <span className="sa-trial-tag">Trial</span>}
                    </td>
                    <td><Badge estado={t.estado} /></td>
                    <td>
                      {t.fechaVencimiento
                        ? new Date(t.fechaVencimiento).toLocaleDateString('es-EC')
                        : <span className="sa-empty-val">—</span>}
                    </td>
                    <td>
                      {new Date(t.createdAt).toLocaleDateString('es-EC')}
                    </td>
                    <td>
                      <div className="sa-actions">
                        <button
                          className="btn-secondary sa-btn-xs"
                          onClick={() => setModalEditar(t)}
                          title="Editar"
                        >✏️ Editar</button>
                        <button
                          className="btn-secondary sa-btn-xs"
                          onClick={() => setModalSus(t)}
                          title="Nueva suscripción"
                        >💳 Suscripción</button>
                        <button
                          className={`sa-btn-xs ${t.estado === 'suspendido' ? 'btn-primary' : 'btn-danger'}`}
                          onClick={() => toggleEstado(t)}
                          title={t.estado === 'suspendido' ? 'Activar' : 'Suspender'}
                        >
                          {t.estado === 'suspendido' ? '▶ Activar' : '⏸ Suspender'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modales */}
      {modalEditar && (
        <ModalEditar
          tenant={modalEditar}
          onGuardar={handleGuardarEdicion}
          onCerrar={() => setModalEditar(null)}
        />
      )}
      {modalSus && (
        <ModalSuscripcion
          tenant={modalSus}
          onGuardar={handleGuardarSuscripcion}
          onCerrar={() => setModalSus(null)}
        />
      )}

      {guardando && (
        <div className="sa-modal-overlay">
          <div className="sa-saving">Guardando…</div>
        </div>
      )}
    </div>
  );
}
