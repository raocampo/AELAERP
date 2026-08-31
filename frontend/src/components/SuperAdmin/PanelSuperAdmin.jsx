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
  { key: 'facturacionHabilitada',    label: 'Facturación (Facturas, Notas Venta/Débito, Guías Remisión)' },
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
  lite:   ['facturacionHabilitada', 'cajaDiariaHabilitada', 'posHabilitado', 'inventarioHabilitado', 'comprasHabilitadas'],
  medium: ['facturacionHabilitada', 'cajaDiariaHabilitada', 'posHabilitado', 'inventarioHabilitado', 'comprasHabilitadas', 'buzonSriHabilitado', 'tributarioHabilitado', 'bancosHabilitado', 'talentoHumanoHabilitado'],
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
    maxSucursales:       tenant.maxSucursales ?? '',
    maxCajas:            tenant.maxCajas      ?? '',
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
            <select value={form.estado} onChange={e => set('estado', e.target.value)} disabled={!form.esTrial}>
              <option value="activo">Activo</option>
              <option value="suspendido">Suspendido</option>
              <option value="vencido">Vencido</option>
              <option value="provisioning">Provisioning</option>
            </select>
            {!form.esTrial && (
              <small className="sa-hint-block">
                Con un plan pago (no trial) el estado se calcula solo a partir de la fecha de
                vencimiento. Para suspender o reactivar usa el botón "⏸ Suspender" / "▶ Activar"
                de la lista, no este selector.
              </small>
            )}
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
            <label>Límite de sucursales / cajas <span className="sa-hint">(independiente del plan)</span></label>
            <div className="sa-form-row--checks">
              <input type="number" min="0" style={{ maxWidth: 100 }}
                placeholder="Ilimitado" value={form.maxSucursales}
                onChange={e => set('maxSucursales', e.target.value)} />
              <span className="sa-hint">sucursales</span>
              <input type="number" min="0" style={{ maxWidth: 100 }}
                placeholder="Ilimitado" value={form.maxCajas}
                onChange={e => set('maxCajas', e.target.value)} />
              <span className="sa-hint">cajas</span>
            </div>
            <small className="sa-hint-block">
              Vacío = ilimitado (comportamiento normal). Setear un número bloquea que el cliente cree
              más sucursales/cajas de las contratadas — usar para diferenciar planes que incluyan
              multi-caja (ej. "Negocio: hasta 2 sucursales / 4 cajas").
            </small>
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
            maxSucursales: form.maxSucursales === '' ? null : parseInt(form.maxSucursales, 10),
            maxCajas:      form.maxCajas      === '' ? null : parseInt(form.maxCajas, 10),
          })}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal crear cliente ──────────────────────────────────────────────────────
// Equivalente autenticado del formulario público de /registro — para cuando el
// operador da de alta un cliente él mismo en vez de mandarlo a la web.
function ModalCrearTenant({ api, onCrear, onCerrar }) {
  const [form, setForm] = useState({
    nombreEmpresa: '', nombreContacto: '', emailContacto: '', telefonoContacto: '',
    plan: 'lite', slugForzado: '', esTrial: false,
  });
  const [modulosPersonalizados, setModulosPersonalizados] = useState(false);
  const [modulosContratados, setModulosContratados] = useState([]);

  // Crear empresa + usuario admin en el mismo paso — por defecto activado: el
  // flujo normal del operador es entregar usuario/contraseña ya listos, sin
  // que el cliente tenga que pasar por la pantalla de configuración inicial.
  const [crearAdminAhora, setCrearAdminAhora] = useState(true);
  const [empresaForm, setEmpresaForm] = useState({
    ruc: '', razonSocial: '', nombreComercial: '', direccion: '', telefono: '', emailEmpresa: '',
  });
  const [adminForm, setAdminForm] = useState({ nombre: '', username: '', email: '', password: '' });
  const [consultandoSri, setConsultandoSri] = useState(false);
  const [mensajeSri, setMensajeSri] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setEmp = (k, v) => setEmpresaForm(f => ({ ...f, [k]: v }));
  const setAdm = (k, v) => setAdminForm(f => ({ ...f, [k]: v }));
  const toggleModulo = (key) => setModulosContratados((m) =>
    m.includes(key) ? m.filter((x) => x !== key) : [...m, key]
  );

  const consultarSri = async (rucIngresado) => {
    const rucLimpio = String(rucIngresado || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(rucLimpio)) { setMensajeSri(''); return; }
    setConsultandoSri(true);
    setMensajeSri('');
    try {
      const s = await api.get(`/consultar-sri/${rucLimpio}`);
      if (s?.encontrado) {
        setEmpresaForm(f => ({
          ...f,
          ruc: s.ruc || f.ruc,
          razonSocial: s.razonSocial || f.razonSocial,
          nombreComercial: s.nombreComercial || f.nombreComercial,
          direccion: s.direccion || f.direccion,
        }));
        setMensajeSri(`✓ Encontrada (${s.fuente === 'local' ? 'catastro local' : 'SRI en línea'}): ${s.razonSocial}`);
        return;
      }
      setMensajeSri('No se encontró en el catastro ni en el SRI — completa los datos a mano.');
    } catch (err) {
      setMensajeSri(err.message || 'No se pudo consultar el SRI.');
    } finally {
      setConsultandoSri(false);
    }
  };

  return (
    <div className="sa-modal-overlay" onClick={onCerrar}>
      <div className="sa-modal" onClick={e => e.stopPropagation()}>
        <div className="sa-modal-header">
          <h3>Crear cliente</h3>
          <button className="sa-modal-close" onClick={onCerrar}>✕</button>
        </div>

        <div className="sa-modal-body">
          <div className="sa-form-row">
            <label>Nombre de la empresa <span className="sa-hint">*</span></label>
            <input type="text" value={form.nombreEmpresa}
              onChange={e => set('nombreEmpresa', e.target.value)}
              placeholder="Razón social o nombre comercial" autoFocus />
          </div>

          <div className="sa-form-row">
            <label>URL de acceso <span className="sa-hint">(opcional — se genera del nombre si se deja vacío)</span></label>
            <input type="text" value={form.slugForzado}
              onChange={e => set('slugForzado', e.target.value)}
              placeholder="ej: cobijando-tus-suenos" />
          </div>

          <div className="sa-form-row">
            <label>Plan</label>
            <select value={form.plan} onChange={e => set('plan', e.target.value)}>
              <option value="lite">Lite</option>
              <option value="medium">Medium</option>
              <option value="pro">Pro</option>
            </select>
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
              Desmarcado: el cliente ve los módulos del plan elegido arriba (comportamiento normal).
              Marcado: elige exactamente qué módulos ve este cliente desde el inicio.
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

          <div className="sa-form-row sa-form-row--checks">
            <label className="sa-check">
              <input type="checkbox" checked={form.esTrial}
                onChange={e => set('esTrial', e.target.checked)} />
              Es trial (15 días)
            </label>
          </div>

          <div className="sa-form-row">
            <label className="sa-check">
              <input type="checkbox" checked={crearAdminAhora}
                onChange={e => setCrearAdminAhora(e.target.checked)} />
              Crear empresa y usuario administrador ahora
            </label>
            <small className="sa-hint-block">
              Marcado (recomendado): entregas usuario y contraseña ya listos — el cliente nunca ve la
              pantalla de configuración inicial. Desmarcado: el tenant queda creado pero vacío, como en
              el registro público — alguien debe entrar a la URL de acceso y completarlo a mano.
            </small>
          </div>

          {crearAdminAhora && (
            <>
              <div className="sa-form-row sa-form-row--checks" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.75rem', marginTop: '.25rem' }}>
                <strong style={{ fontSize: '.85rem' }}>Datos de la empresa</strong>
              </div>

              <div className="sa-form-row">
                <label>RUC <span className="sa-hint">*</span></label>
                <input type="text" value={empresaForm.ruc} maxLength={13}
                  onChange={e => setEmp('ruc', e.target.value)}
                  onBlur={e => consultarSri(e.target.value)}
                  placeholder="1791234567001" />
                {consultandoSri && <span className="sa-hint">⏳ Consultando SRI…</span>}
                {mensajeSri && !consultandoSri && <small className="sa-hint-block">{mensajeSri}</small>}
              </div>

              <div className="sa-form-row">
                <label>Razón social <span className="sa-hint">*</span></label>
                <input type="text" value={empresaForm.razonSocial}
                  onChange={e => setEmp('razonSocial', e.target.value)} />
              </div>

              <div className="sa-form-row">
                <label>Nombre comercial</label>
                <input type="text" value={empresaForm.nombreComercial}
                  onChange={e => setEmp('nombreComercial', e.target.value)} />
              </div>

              <div className="sa-form-row">
                <label>Dirección</label>
                <input type="text" value={empresaForm.direccion}
                  onChange={e => setEmp('direccion', e.target.value)} />
              </div>

              <div className="sa-form-row">
                <label>Teléfono empresa</label>
                <input type="text" value={empresaForm.telefono}
                  onChange={e => setEmp('telefono', e.target.value)} />
              </div>

              <div className="sa-form-row">
                <label>Email empresa</label>
                <input type="email" value={empresaForm.emailEmpresa}
                  onChange={e => setEmp('emailEmpresa', e.target.value)} />
              </div>

              <div className="sa-form-row sa-form-row--checks" style={{ borderTop: '1px solid #e2e8f0', paddingTop: '.75rem', marginTop: '.25rem' }}>
                <strong style={{ fontSize: '.85rem' }}>Usuario administrador</strong>
              </div>

              <div className="sa-form-row">
                <label>Nombre completo <span className="sa-hint">*</span></label>
                <input type="text" value={adminForm.nombre}
                  onChange={e => setAdm('nombre', e.target.value)} />
              </div>

              <div className="sa-form-row">
                <label>Usuario <span className="sa-hint">*</span></label>
                <input type="text" value={adminForm.username}
                  onChange={e => setAdm('username', e.target.value)}
                  placeholder="ej: admin.cobijando" />
              </div>

              <div className="sa-form-row">
                <label>Email admin</label>
                <input type="email" value={adminForm.email}
                  onChange={e => setAdm('email', e.target.value)} />
              </div>

              <div className="sa-form-row">
                <label>Contraseña <span className="sa-hint">* (mín. 8 caracteres — se le entrega al cliente)</span></label>
                <input type="text" value={adminForm.password}
                  onChange={e => setAdm('password', e.target.value)}
                  style={{ fontFamily: 'monospace' }} />
              </div>
            </>
          )}

          <small className="sa-hint-block">
            Esto crea la base de datos del cliente y lo deja activo de inmediato (tarda unos segundos).
          </small>
        </div>

        <div className="sa-modal-footer">
          <button className="btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primary" onClick={() => onCrear({
            ...form,
            modulosContratados: modulosPersonalizados ? modulosContratados : undefined,
            admin: crearAdminAhora ? adminForm : undefined,
            empresa: crearAdminAhora ? empresaForm : undefined,
            adminPasswordParaMostrar: crearAdminAhora ? adminForm.password : undefined,
          })}>Crear cliente</button>
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
  const [modalCrear, setModalCrear]     = useState(false);
  const [modalCreado, setModalCreado]   = useState(null); // { slug, urlAcceso }
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

  const handleCrearTenant = async (form) => {
    if (!form.nombreEmpresa?.trim()) {
      alert('El nombre de la empresa es requerido');
      return;
    }
    // El backend nunca devuelve la contraseña — se retiene acá localmente
    // (nunca se envía al servidor) solo para poder mostrarla una vez más
    // junto al usuario en el modal de resultado, igual que la API key.
    const { adminPasswordParaMostrar, ...payload } = form;
    setGuardando(true);
    try {
      const data = await api.post('/tenants', payload);
      setModalCrear(false);
      setModalCreado({ ...data, adminPassword: adminPasswordParaMostrar });
      flash('Cliente creado');
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
          <button className="btn-primary sa-btn-sm" onClick={() => setModalCrear(true)}>
            + Crear cliente
          </button>
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
                      {(t.maxSucursales != null || t.maxCajas != null) && (
                        <div className="sa-api-badge" title="Límite de sucursales/cajas seteado desde SuperAdmin">
                          🏬 {t.maxSucursales ?? '∞'} suc. / 🖥️ {t.maxCajas ?? '∞'} cajas
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
      {modalCrear && (
        <ModalCrearTenant
          api={api}
          onCrear={handleCrearTenant}
          onCerrar={() => setModalCrear(false)}
        />
      )}
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

      {/* Modal cliente creado */}
      {modalCreado && (
        <div className="sa-modal-overlay" onClick={() => setModalCreado(null)}>
          <div className="sa-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="sa-modal-header">
              <h3>Cliente creado — <strong>{modalCreado.slug}</strong></h3>
              <button className="sa-modal-close" onClick={() => setModalCreado(null)}>✕</button>
            </div>
            <div className="sa-modal-body">
              {modalCreado.usuarioCreado ? (
                <>
                  <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Empresa y usuario admin ya creados. Entrega esto al cliente — no se vuelve a mostrar
                    la contraseña después de cerrar esta ventana.
                  </p>
                  <div className="sa-apikey-display" style={{ marginBottom: 8 }}>
                    <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{modalCreado.urlAcceso}</code>
                  </div>
                  <div className="sa-apikey-display" style={{ marginBottom: 8 }}>
                    <code style={{ fontSize: 13 }}>Usuario: {modalCreado.usuarioCreado.username}</code>
                  </div>
                  <div className="sa-apikey-display">
                    <code style={{ fontSize: 13 }}>Contraseña: {modalCreado.adminPassword}</code>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    La base de datos del cliente ya está lista. Comparte esta URL para que complete la
                    configuración inicial (RUC, usuario admin) — es el mismo paso que haría alguien que se
                    registra desde la web.
                  </p>
                  <div className="sa-apikey-display">
                    <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{modalCreado.urlAcceso}</code>
                  </div>
                </>
              )}
              {modalCreado.bootstrapError && (
                <p style={{ marginTop: 10, fontSize: 12.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '.5rem .65rem' }}>
                  ⚠️ El tenant se creó, pero no se pudo crear la empresa/usuario admin automáticamente:
                  {' '}{modalCreado.bootstrapError} Completa el primer acceso manualmente entrando a la URL de acceso.
                </p>
              )}
            </div>
            <div className="sa-modal-footer">
              <button className="btn-primary" onClick={() => {
                const texto = modalCreado.usuarioCreado
                  ? `${modalCreado.urlAcceso}\nUsuario: ${modalCreado.usuarioCreado.username}\nContraseña: ${modalCreado.adminPassword}`
                  : modalCreado.urlAcceso;
                navigator.clipboard?.writeText(texto);
                flash('Copiado al portapapeles');
              }}>📋 Copiar</button>
              <button className="btn-secondary" onClick={() => setModalCreado(null)}>Cerrar</button>
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
