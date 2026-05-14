import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { CAPACIDADES_PLAN } from '../../utils/sistema';
import './ConfiguracionSistema.css';

const PLANES = [
  {
    key: 'lite',
    label: 'Lite',
    sublabel: 'Gratis',
    color: '#F9A825',
    descripcion: 'Facturación electrónica básica para RIMPE Negocio Popular.',
    limites: '100 comprobantes/año · 1 usuario',
    modulos: ['Facturas electrónicas', 'Notas de Venta', 'Clientes / Productos'],
  },
  {
    key: 'medium',
    label: 'Medium',
    sublabel: 'Pyme',
    color: '#7C3AED',
    descripcion: 'Facturación + operaciones de punto de venta e inventario.',
    limites: '1.000 comprobantes/año · 3 usuarios',
    modulos: ['Todo lo de Lite', 'Caja Diaria', 'POS', 'Inventario', 'Compras', 'Talento Humano'],
  },
  {
    key: 'pro',
    label: 'Pro',
    sublabel: 'Empresarial',
    color: '#1976D2',
    descripcion: 'Suite completa con contabilidad, tributario y multiempresa.',
    limites: 'Ilimitado · Usuarios ilimitados',
    modulos: ['Todo lo de Medium', 'Retenciones', 'Liquidaciones de Compra', 'ATS', 'Reportes Tributarios', 'Contabilidad', 'Multiempresa'],
  },
];

const FORM_INICIAL = {
  tipoSistema: 'pro',
  modoOperacion: 'monoempresa',
  cajaNombre: 'Caja General',
  cajaDiariaHabilitada: true,
  cierreCajaObligatorio: false,
  posHabilitado: false,
  documentoPosDefault: 'factura',
  impresionAutoReciboPos: false,
  impresoraKiosko: '',
  inventarioHabilitado: false,
  permitirStockNegativo: false,
  comprasHabilitadas: true,
  contabilidadHabilitada: true,
  retencionesHabilitadas: true,
  liquidacionesHabilitadas: true,
  atsHabilitado: true,
  talentoHumanoHabilitado: false,
  sbuEcuador: '460.00',
};

export default function ConfiguracionSistema() {
  const { sistema, setSistema, recargarSistema } = useAuth();
  const [form, setForm] = useState(FORM_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [probandoSmtp, setProbandoSmtp] = useState(false);

  useEffect(() => {
    let ignore = false;
    const cargar = async () => {
      try {
        const res = await api.get('/configuracion-sistema');
        if (!ignore && res.data?.success) {
          setForm({ ...FORM_INICIAL, ...res.data.data });
          setSistema(res.data.data);
        }
      } catch (error) {
        toast.error(error.response?.data?.mensaje || 'No se pudo cargar la configuración del sistema');
      } finally {
        if (!ignore) setCargando(false);
      }
    };
    cargar();
    return () => { ignore = true; };
  }, [setSistema]);

  useEffect(() => {
    if (sistema) {
      setForm((prev) => ({ ...prev, ...sistema }));
      setCargando(false);
    }
  }, [sistema]);

  // Al cambiar plan: fuerza los módulos según capacidades
  const cambiarPlan = (nuevoPlan) => {
    const caps = CAPACIDADES_PLAN[nuevoPlan] || CAPACIDADES_PLAN.pro;
    setForm((prev) => ({
      ...prev,
      tipoSistema: nuevoPlan,
      // Cada módulo: lo que tenía AND lo que el plan permite
      cajaDiariaHabilitada:     caps.cajaDiariaHabilitada     && prev.cajaDiariaHabilitada,
      posHabilitado:            caps.posHabilitado            && prev.posHabilitado,
      inventarioHabilitado:     caps.inventarioHabilitado     && prev.inventarioHabilitado,
      comprasHabilitadas:       caps.comprasHabilitadas       && prev.comprasHabilitadas,
      contabilidadHabilitada:   caps.contabilidadHabilitada   && prev.contabilidadHabilitada,
      retencionesHabilitadas:   caps.retencionesHabilitadas   && prev.retencionesHabilitadas,
      liquidacionesHabilitadas: caps.liquidacionesHabilitadas && prev.liquidacionesHabilitadas,
      atsHabilitado:            caps.atsHabilitado            && prev.atsHabilitado,
      talentoHumanoHabilitado:  caps.talentoHumanoHabilitado  && prev.talentoHumanoHabilitado,
    }));
  };

  const actualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const res = await api.put('/configuracion-sistema', form);
      setSistema(res.data.data);
      await recargarSistema();
      toast.success('Configuración del sistema actualizada');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo guardar la configuración');
    } finally {
      setGuardando(false);
    }
  };

  const handleProbarSmtp = async () => {
    setProbandoSmtp(true);
    try {
      const res = await api.post('/configuracion-sistema/test-email');
      toast.success(res.data.mensaje || 'Email de prueba enviado');
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al enviar email de prueba');
    } finally {
      setProbandoSmtp(false);
    }
  };

  if (cargando) return <div className="syscfg-loading">Cargando configuración del sistema...</div>;

  const planActual = form.tipoSistema || 'pro';
  const caps = CAPACIDADES_PLAN[planActual] || CAPACIDADES_PLAN.pro;

  const modulos = [
    { key: 'cajaDiariaHabilitada',     label: 'Caja Diaria' },
    { key: 'posHabilitado',            label: 'POS' },
    { key: 'inventarioHabilitado',     label: 'Inventario' },
    { key: 'comprasHabilitadas',       label: 'Compras' },
    { key: 'contabilidadHabilitada',   label: 'Contabilidad' },
    { key: 'retencionesHabilitadas',   label: 'Retenciones' },
    { key: 'liquidacionesHabilitadas', label: 'Liquidaciones' },
    { key: 'atsHabilitado',            label: 'ATS' },
    { key: 'talentoHumanoHabilitado',  label: 'Talento Humano' },
  ];

  return (
    <div className="syscfg-page">
      <div className="syscfg-header">
        <div>
          <h1>Configuración del Sistema</h1>
          <p>Selecciona el plan y ajusta los módulos habilitados para esta empresa.</p>
        </div>
      </div>

      <form className="syscfg-grid" onSubmit={handleSubmit}>

        {/* ── Selector de Plan ──────────────────────────────────────────────── */}
        <section className="syscfg-card syscfg-card-wide">
          <h2>Plan del sistema</h2>
          <div className="syscfg-planes">
            {PLANES.map((plan) => (
              <button
                key={plan.key}
                type="button"
                className={`syscfg-plan-card ${planActual === plan.key ? 'selected' : ''}`}
                style={{ '--plan-color': plan.color }}
                onClick={() => cambiarPlan(plan.key)}
              >
                <div className="syscfg-plan-header">
                  <span className="syscfg-plan-label" style={{ color: plan.color }}>{plan.label}</span>
                  <span className="syscfg-plan-sublabel">{plan.sublabel}</span>
                </div>
                <p className="syscfg-plan-desc">{plan.descripcion}</p>
                <p className="syscfg-plan-limites">{plan.limites}</p>
                <ul className="syscfg-plan-modulos">
                  {plan.modulos.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </button>
            ))}
          </div>
        </section>

        {/* ── Modo operación ───────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Modo de operación</h2>
          <label className="syscfg-field">
            <span>Modo</span>
            <select
              value={form.modoOperacion}
              onChange={(e) => actualizar('modoOperacion', e.target.value)}
              disabled={planActual !== 'pro'}
            >
              <option value="monoempresa">Monoempresa</option>
              <option value="multiempresa">Multiempresa (solo Pro)</option>
            </select>
          </label>
          <p className="syscfg-note">
            Multiempresa solo está disponible en el plan Pro.
          </p>
        </section>

        {/* ── Caja ─────────────────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Caja</h2>
          <label className="syscfg-field">
            <span>Nombre de la caja principal</span>
            <input
              value={form.cajaNombre}
              onChange={(e) => actualizar('cajaNombre', e.target.value)}
              placeholder="Caja General"
              disabled={!caps.cajaDiariaHabilitada}
            />
          </label>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.cajaDiariaHabilitada}
              onChange={(e) => actualizar('cajaDiariaHabilitada', e.target.checked)}
              disabled={!caps.cajaDiariaHabilitada}
            />
            <span>Habilitar caja diaria{!caps.cajaDiariaHabilitada ? ' — no disponible en Lite' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.cierreCajaObligatorio}
              onChange={(e) => actualizar('cierreCajaObligatorio', e.target.checked)}
              disabled={!form.cajaDiariaHabilitada || !caps.cajaDiariaHabilitada}
            />
            <span>Cierre de caja obligatorio</span>
          </label>
        </section>

        {/* ── POS ──────────────────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Punto de Venta (POS)</h2>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.posHabilitado}
              onChange={(e) => actualizar('posHabilitado', e.target.checked)}
              disabled={!caps.posHabilitado}
            />
            <span>Habilitar módulo POS{!caps.posHabilitado ? ' — requiere Medium o Pro' : ''}</span>
          </label>
          <label className="syscfg-field">
            <span>Documento predeterminado en POS</span>
            <select
              value={form.documentoPosDefault}
              onChange={(e) => actualizar('documentoPosDefault', e.target.value)}
              disabled={!form.posHabilitado || !caps.posHabilitado}
            >
              <option value="factura">Factura</option>
              <option value="nota_venta">Nota de Venta</option>
            </select>
          </label>
        </section>

        {/* ── Impresión y kiosko ─────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Impresión y kiosko</h2>
          <p className="syscfg-note">
            El navegador no detecta impresoras automáticamente. Esta sección define cómo debe comportarse la impresión
            del POS en almacenamiento, kiosko o dispositivos móviles.
          </p>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.impresionAutoReciboPos}
              onChange={(e) => actualizar('impresionAutoReciboPos', e.target.checked)}
            />
            <span>Autoabrir el recibo POS al emitir</span>
          </label>
          <label className="syscfg-field">
            <span>Impresora sugerida para kiosko</span>
            <input
              value={form.impresoraKiosko || ''}
              onChange={(e) => actualizar('impresoraKiosko', e.target.value)}
              placeholder="EPSON TM-T20 / impresora del kiosko"
            />
          </label>
        </section>

        {/* ── Inventario ───────────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Inventario</h2>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.inventarioHabilitado}
              onChange={(e) => actualizar('inventarioHabilitado', e.target.checked)}
              disabled={!caps.inventarioHabilitado}
            />
            <span>Habilitar control de inventario{!caps.inventarioHabilitado ? ' — requiere Medium o Pro' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.permitirStockNegativo}
              onChange={(e) => actualizar('permitirStockNegativo', e.target.checked)}
              disabled={!form.inventarioHabilitado || !caps.inventarioHabilitado}
            />
            <span>Permitir ventas con stock negativo</span>
          </label>
        </section>

        {/* ── Módulos avanzados ─────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Módulos avanzados</h2>

          <label className="syscfg-check">
            <input type="checkbox" checked={form.comprasHabilitadas}
              onChange={(e) => actualizar('comprasHabilitadas', e.target.checked)}
              disabled={!caps.comprasHabilitadas} />
            <span>Compras{!caps.comprasHabilitadas ? ' — requiere Medium o Pro' : ''}</span>
          </label>

          <label className="syscfg-check">
            <input type="checkbox" checked={form.retencionesHabilitadas}
              onChange={(e) => actualizar('retencionesHabilitadas', e.target.checked)}
              disabled={!caps.retencionesHabilitadas} />
            <span>Retenciones{!caps.retencionesHabilitadas ? ' — solo Pro' : ''}</span>
          </label>

          <label className="syscfg-check">
            <input type="checkbox" checked={form.liquidacionesHabilitadas}
              onChange={(e) => actualizar('liquidacionesHabilitadas', e.target.checked)}
              disabled={!caps.liquidacionesHabilitadas} />
            <span>Liquidaciones de compra{!caps.liquidacionesHabilitadas ? ' — solo Pro' : ''}</span>
          </label>

          <label className="syscfg-check">
            <input type="checkbox" checked={form.atsHabilitado}
              onChange={(e) => actualizar('atsHabilitado', e.target.checked)}
              disabled={!caps.atsHabilitado} />
            <span>ATS{!caps.atsHabilitado ? ' — solo Pro' : ''}</span>
          </label>

          <label className="syscfg-check">
            <input type="checkbox" checked={form.contabilidadHabilitada}
              onChange={(e) => actualizar('contabilidadHabilitada', e.target.checked)}
              disabled={!caps.contabilidadHabilitada} />
            <span>Contabilidad{!caps.contabilidadHabilitada ? ' — solo Pro' : ''}</span>
          </label>
        </section>

        {/* ── Talento Humano ───────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Talento Humano</h2>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.talentoHumanoHabilitado}
              onChange={(e) => actualizar('talentoHumanoHabilitado', e.target.checked)}
              disabled={!caps.talentoHumanoHabilitado}
            />
            <span>
              Habilitar Talento Humano (RRHH, Nómina, Ausencias)
              {!caps.talentoHumanoHabilitado ? ' — requiere Medium o Pro' : ''}
            </span>
          </label>

          <div className="syscfg-row" style={{ marginTop: '1rem' }}>
            <div className="syscfg-field">
              <label>SBU Ecuador (Salario Básico Unificado)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={form.sbuEcuador}
                  onChange={(e) => actualizar('sbuEcuador', e.target.value)}
                  style={{ maxWidth: '140px' }}
                  disabled={!caps.talentoHumanoHabilitado}
                  placeholder="460.00"
                />
              </div>
              <small className="syscfg-hint">
                Se usa para calcular el décimo cuarto proporcional en la nómina. Actualizar cada año según resolución ministerial.
              </small>
            </div>
          </div>
        </section>

        {/* ── SMTP / Correo electrónico ────────────────────────────────────── */}
        <section className="syscfg-card syscfg-card-wide">
          <h2>📧 Correo Electrónico (SMTP)</h2>
          <div className="syscfg-grid">
            <div className="syscfg-field">
              <p style={{ margin: '0 0 .5rem', fontSize: '.9rem', color: '#475569', lineHeight: '1.5' }}>
                Configura las variables de entorno en Railway para habilitar el envío de correos:
                <code style={{ display: 'block', background: '#f1f5f9', padding: '.5rem .75rem', borderRadius: '.4rem', marginTop: '.4rem', fontSize: '.82rem', lineHeight: '1.7' }}>
                  SMTP_HOST = smtp.gmail.com<br />
                  SMTP_PORT = 587<br />
                  SMTP_SECURE = false<br />
                  SMTP_USER = tucorreo@gmail.com<br />
                  SMTP_PASS = contraseña-de-app<br />
                  SMTP_FROM = AELA ERP &lt;tucorreo@gmail.com&gt;<br />
                  SMTP_SOPORTE = soporte@tudominio.com
                </code>
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleProbarSmtp}
                disabled={probandoSmtp}
                style={{ marginTop: '.75rem' }}
              >
                {probandoSmtp ? '⏳ Enviando...' : '✉️ Enviar email de prueba'}
              </button>
              <small className="syscfg-hint" style={{ display: 'block', marginTop: '.4rem' }}>
                Si SMTP no está configurado, el botón te indicará qué variables agregar.
                El email de prueba se envía a tu correo registrado en el sistema.
              </small>
            </div>
          </div>
        </section>

        {/* ── Resumen ───────────────────────────────────────────────────────── */}
        <section className="syscfg-card syscfg-card-wide">
          <h2>Resumen</h2>
          <div className="syscfg-badges">
            <span className={`syscfg-badge plan-${planActual}`}>{planActual.toUpperCase()}</span>
            <span className="syscfg-badge mode">
              {form.modoOperacion === 'multiempresa' ? 'MULTIEMPRESA' : 'MONOEMPRESA'}
            </span>
            {modulos.map((modulo) => (
              <span key={modulo.key} className={`syscfg-badge ${form[modulo.key] ? 'on' : 'off'}`}>
                {modulo.label}
              </span>
            ))}
          </div>
        </section>

        <div className="syscfg-actions">
          <button type="submit" className="btn-primary" disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </div>
  );
}
