// ====================================
// PANEL SUPER-ADMIN SaaS — AELA
// Standalone: no usa Layout ni AuthContext
// Accede a /api/super-admin/* con SUPER_ADMIN_KEY
// ====================================

import { useState, useEffect, useCallback, useMemo } from 'react';
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
const TIPO_LABELS = { monoempresa: '1 empresa', multiempresa: 'Multi' };

// Catálogo de módulos — espejo de MODULOS_TODOS en backend/utils/configuracionSistema.js
const MODULOS_CATALOGO = [
  { key: 'cajaDiariaHabilitada',     label: 'Caja Diaria' },
  { key: 'posHabilitado',            label: 'POS' },
  { key: 'inventarioHabilitado',     label: 'Inventario' },
  { key: 'comprasHabilitadas',       label: 'Compras' },
  { key: 'buzonSriHabilitado',       label: 'Buzón SRI' },
  { key: 'contabilidadHabilitada',   label: 'Contabilidad (+ CxC/CxP/Caja Chica)' },
  { key: 'retencionesHabilitadas',   label: 'Retenciones emitidas' },
  { key: 'liquidacionesHabilitadas', label: 'Liquidaciones de compra' },
  { key: 'atsHabilitado',            label: 'ATS' },
  { key: 'tributarioHabilitado',     label: 'Tributario (Declaraciones/Ret. recibidas/Reportes)' },
  { key: 'bancosHabilitado',         label: 'Bancos' },
  { key: 'talentoHumanoHabilitado',  label: 'Talento Humano' },
];

// Presets rápidos — mismos módulos que capacidadesPlan() en el backend
const PRESETS_PLAN = {
  lite:   [],
  medium: ['cajaDiariaHabilitada', 'posHabilitado', 'inventarioHabilitado', 'comprasHabilitadas', 'buzonSriHabilitado', 'tributarioHabilitado', 'bancosHabilitado', 'talentoHumanoHabilitado'],
  pro:    MODULOS_CATALOGO.map((m) => m.key),
};

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

  // useMemo estabiliza la referencia del objeto — sin esto se crea uno nuevo en
  // cada render, lo que dispara cargarDatos en loop infinito (ERR_INSUFFICIENT_RESOURCES).
  return useMemo(() => ({
    get:    (path)       => call('GET',    path),
    put:    (path, body) => call('PUT',    path, body),
    post:   (path, body) => call('POST',   path, body),
    delete: (path)       => call('DELETE', path),
  }), [call]);
}

// ─── Modal editar tenant ──────────────────────────────────────────────────────
function ModalEditar({ tenant, onGuardar, onCerrar }) {
  const [form, setForm] = useState({
    plan:                tenant.plan            || 'lite',
    tipoInstancia:       tenant.tipoInstancia   || 'monoempresa',
    estado:              tenant.estado          || 'activo',
    nombreContacto:      tenant.nombreContacto  || '',
    emailContacto:       tenant.emailContacto   || '',
    telefonoContacto:    tenant.telefonoContacto || '',
    fechaVencimiento:    tenant.fechaVencimiento
      ? new Date(tenant.fechaVencimiento).toISOString().slice(0, 10)
      : '',
    esTrial:             tenant.esTrial      || false,
    autoRenovar:         tenant.autoRenovar  || false,
    dominioPersonalizado: (tenant.brandConfig?.dominio) || '',
  });
  // Módulos contratados: null = usar el techo derivado del plan (comportamiento
  // legado); array = techo personalizado, independiente del plan.
  const [modulosPersonalizados, setModulosPersonalizados] = useState(
    Array.isArray(tenant.modulosContratados)
  );
  const [modulosContratados, setModulosContratados] = useState(
    Array.isArray(tenant.modulosContratados) ? tenant.modulosContratados : []
  );

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleModulo = (key) => setModulosContratados((m) =>
    m.includes(key) ? m.filter((x) => x !== key) : [...m, key]
  );

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

          {form.plan === 'pro' && (
            <div className="sa-form-row">
              <label>Tipo de instancia <span className="sa-hint">(solo PRO)</span></label>
              <select value={form.tipoInstancia} onChange={e => set('tipoInstancia', e.target.value)}>
                <option value="monoempresa">Monoempresa (1 empresa)</option>
                <option value="multiempresa">Multiempresa (N empresas)</option>
              </select>
              <small className="sa-hint-block">
                Monoempresa: el cliente gestiona una sola empresa. Multiempresa: puede crear múltiples empresas dentro del mismo tenant.
              </small>
            </div>
          )}

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
            <label>Módulos contratados</label>
            <label className="sa-check">
              <input type="checkbox" checked={modulosPersonalizados}
                onChange={e => {
                  const activo = e.target.checked;
                  setModulosPersonalizados(activo);
                  if (activo && modulosContratados.length === 0) {
                    setModulosContratados(PRESETS_PLAN[form.plan] || []);
                  }
                }} />
              Techo personalizado (independiente del plan)
            </label>
            <small className="sa-hint-block">
              Desmarcado: el cliente ve los módulos del plan {PLAN_LABELS[form.plan]} (comportamiento
              normal). Marcado: elige exactamente qué módulos ve este cliente, sin importar el plan
              — para vender combos como "solo Contabilidad" o "solo Tributario + Buzón SRI".
            </small>

            {modulosPersonalizados && (
              <div className="sa-modulos-grid">
                <div className="sa-modulos-presets">
                  <span className="sa-hint">Aplicar preset:</span>
                  {['lite', 'medium', 'pro'].map((p) => (
                    <button key={p} type="button" className="btn-secondary sa-btn-xs"
                      onClick={() => setModulosContratados(PRESETS_PLAN[p])}>
                      {PLAN_LABELS[p]}
                    </button>
                  ))}
                </div>
                {MODULOS_CATALOGO.map((m) => (
                  <label key={m.key} className="sa-check sa-check--modulo">
                    <input type="checkbox" checked={modulosContratados.includes(m.key)}
                      onChange={() => toggleModulo(m.key)} />
                    {m.label}
                  </label>
                ))}
              </div>
            )}
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

          <div className="sa-form-row">
            <label>Dominio personalizado <span className="sa-hint">(marca blanca)</span></label>
            <input type="text" value={form.dominioPersonalizado}
              onChange={e => set('dominioPersonalizado', e.target.value)}
              placeholder="erp.miempresa.com (sin https://)" />
            <small className="sa-hint-block">
              El cliente accede desde su propio dominio — sin pasar por /slug.
              Requiere que su DNS apunte a Vercel y el dominio esté agregado en Vercel.
            </small>
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
          <button className="btn-primary" onClick={() => onGuardar({
            ...form,
            modulosContratados: modulosPersonalizados ? modulosContratados : null,
          })}>Guardar</button>
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
  const [pagosPendientes, setPagosPendientes] = useState([]);

  const [modalEditar, setModalEditar]   = useState(null);
  const [modalSus, setModalSus]         = useState(null);
  const [modalApiKey, setModalApiKey]   = useState(null); // { tenant, key }
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
      const [s, t, pp] = await Promise.all([
        api.get('/stats'),
        api.get('/tenants'),
        api.get('/pagos-pendientes').catch(() => []),
      ]);
      setStats(s);
      setTenants(t);
      setPagosPendientes(Array.isArray(pp) ? pp : []);
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

  const aprobarPago = async (pago) => {
    if (!window.confirm(`¿Aprobar pago de ${pago.tenant?.slug} — ${pago.plan}/${pago.periodo} $${pago.monto}?`)) return;
    try {
      await api.post(`/pagos/${pago.id}/aprobar`);
      flash('Suscripción activada');
      cargarDatos();
    } catch (err) {
      alert(err.message);
    }
  };

  const generarApiKey = async (t) => {
    try {
      const data = await api.post(`/tenants/${t.id}/apikey`);
      setModalApiKey({ tenant: t, key: data.apiKey });
      flash('API key generada');
      cargarDatos();
    } catch (err) {
      alert(err.message);
    }
  };

  const revocarApiKey = async (t) => {
    if (!window.confirm(`¿Revocar la API key de ${t.slug}? Esto desconectará integraciones activas.`)) return;
    try {
      await api.delete(`/tenants/${t.id}/apikey`);
      flash('API key revocada');
      cargarDatos();
    } catch (err) {
      alert(err.message);
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

        {/* Pagos pendientes de aprobación */}
        {pagosPendientes.length > 0 && (
          <div className="sa-pagos-pendientes">
            <h3>💳 Pagos pendientes de aprobación ({pagosPendientes.length})</h3>
            <table className="sa-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Plan / Período</th>
                  <th>Monto</th>
                  <th>Forma</th>
                  <th>Referencia</th>
                  <th>Fecha</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {pagosPendientes.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="sa-slug">{p.tenant?.slug}</div>
                      <div className="sa-email">{p.tenant?.emailContacto}</div>
                    </td>
                    <td>{p.plan} / {p.periodo}</td>
                    <td>${p.monto}</td>
                    <td>{p.proveedor}</td>
                    <td>{p.referencia || <span className="sa-empty-val">—</span>}</td>
                    <td>{new Date(p.createdAt).toLocaleDateString('es-EC')}</td>
                    <td>
                      <button className="btn-primary sa-btn-xs" onClick={() => aprobarPago(p)}>
                        ✓ Aprobar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  <th>Plan / Tipo</th>
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
                      {t.plan === 'pro' && (
                        <div className="sa-tipo-instancia">
                          {TIPO_LABELS[t.tipoInstancia] || t.tipoInstancia || '1 empresa'}
                        </div>
                      )}
                      {t.brandConfig?.apiKey && (
                        <div className="sa-api-badge" title={t.brandConfig.apiKey}>🔑 API activa</div>
                      )}
                      {Array.isArray(t.modulosContratados) && (
                        <div className="sa-api-badge" title={t.modulosContratados.join(', ') || '(ninguno)'}>
                          🧩 {t.modulosContratados.length} módulos
                        </div>
                      )}
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
                        {t.brandConfig?.apiKey ? (
                          <button
                            className="btn-danger sa-btn-xs"
                            onClick={() => revocarApiKey(t)}
                            title="Revocar API key"
                          >🔑 Revocar key</button>
                        ) : (
                          <button
                            className="btn-secondary sa-btn-xs"
                            onClick={() => generarApiKey(t)}
                            title="Generar API key para WebService"
                          >🔑 Generar key</button>
                        )}
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

      {/* Modal API key generada */}
      {modalApiKey && (
        <div className="sa-modal-overlay" onClick={() => setModalApiKey(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="sa-modal-header">
              <h3>API key generada — <strong>{modalApiKey.tenant.slug}</strong></h3>
              <button className="sa-modal-close" onClick={() => setModalApiKey(null)}>✕</button>
            </div>
            <div className="sa-modal-body">
              <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                Guarda esta key en un lugar seguro. No se mostrará de nuevo con el valor completo.
                El cliente debe enviarla en el header <code>X-API-Key</code> de cada request.
              </p>
              <div className="sa-apikey-display">
                <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{modalApiKey.key}</code>
              </div>
              <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                Endpoint base: <code>{window.location.origin}/api/ext/v1/</code>
              </p>
            </div>
            <div className="sa-modal-footer">
              <button className="btn-primary" onClick={() => {
                navigator.clipboard?.writeText(modalApiKey.key);
                flash('Copiado al portapapeles');
              }}>📋 Copiar</button>
              <button className="btn-secondary" onClick={() => setModalApiKey(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {guardando && (
        <div className="sa-modal-overlay">
          <div className="sa-saving">Guardando…</div>
        </div>
      )}
    </div>
  );
}
