import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { capacidadesModulos } from '../../utils/sistema';
import { usbDisponible, conectarImpresoraUSB, reconectarImpresoraUSB, enviarBufferUSB } from '../../utils/impresoraUsb';
import './ConfiguracionSistema.css';

const IMPRESORA_INICIAL = {
  impresoraModo: 'ninguna',
  impresoraIp: '',
  impresoraPuerto: 9100,
  impresoraAncho: 80,
  cajaDineroHabilitada: false,
};

const PLANES = {
  lite: {
    label: 'Lite', sublabel: 'Gratis', color: '#F9A825',
    descripcion: 'Facturación, POS, Caja y Compras (ingreso manual) para RIMPE Negocio Popular.',
    limites: '100 comprobantes/año · 1 usuario · 200 productos',
    modulos: ['Facturas', 'Notas de Venta', 'Caja Diaria', 'POS', 'Compras (manual)', 'Inventario', 'Clientes / Productos'],
  },
  medium: {
    label: 'Medium', sublabel: 'Pyme', color: '#7C3AED',
    descripcion: 'Todo lo de Lite, sin tope de productos, más importación masiva y Talento Humano.',
    limites: '1.000 comprobantes/año · 3 usuarios · productos ilimitados',
    modulos: ['Todo lo de Lite', 'Buzón SRI', 'Importación masiva (compras/proveedores)', 'Talento Humano'],
  },
  pro: {
    label: 'Pro', sublabel: 'Empresarial', color: '#1976D2',
    descripcion: 'Suite completa con contabilidad, tributario y multiempresa opcional.',
    limites: 'Ilimitado · Usuarios ilimitados',
    modulos: ['Todo lo de Medium', 'Retenciones', 'Liquidaciones de Compra', 'ATS', 'Tributario', 'Bancos', 'Contabilidad', 'Multiempresa (opcional)'],
  },
};

const FORM_INICIAL = {
  tipoSistema: 'pro',
  modoOperacion: 'monoempresa',
  cajaNombre: 'Caja General',
  facturacionHabilitada: true,
  cajaDiariaHabilitada: true,
  cierreCajaObligatorio: false,
  posHabilitado: false,
  documentoPosDefault: 'factura',
  impresionAutoReciboPos: false,
  impresoraKiosko: '',
  inventarioHabilitado: false,
  permitirStockNegativo: false,
  sucursalesHabilitado: false,
  prefijosRegaloCompras: ['P-', 'M-', 'OBQ-', 'COMBO-', 'REGALO-', 'BONI-'],
  comprasHabilitadas: true,
  buzonSriHabilitado: true,
  contabilidadHabilitada: true,
  retencionesHabilitadas: true,
  liquidacionesHabilitadas: true,
  atsHabilitado: true,
  tributarioHabilitado: true,
  bancosHabilitado: true,
  talentoHumanoHabilitado: false,
  sbuEcuador: '480.00',
};

export default function ConfiguracionSistema() {
  const { sistema, setSistema, recargarSistema, empresa } = useAuth();
  const [form, setForm] = useState(FORM_INICIAL);
  const [guardando, setGuardando] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [probandoSmtp, setProbandoSmtp] = useState(false);
  const [smtpAbierto, setSmtpAbierto] = useState(false);
  const [nuevoPrefijo, setNuevoPrefijo] = useState('');

  // Impresora térmica ESC/POS — configuración propia, guardada vía
  // /impresora/config (no vía el PUT genérico de /configuracion-sistema).
  const [impCfg, setImpCfg] = useState(IMPRESORA_INICIAL);
  const [guardandoImpresora, setGuardandoImpresora] = useState(false);
  const [probandoImpresora, setProbandoImpresora] = useState(false);
  const [usbInfo, setUsbInfo] = useState(null);

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

  useEffect(() => {
    let ignore = false;
    api.get('/impresora/config')
      .then((res) => {
        if (ignore || !res.data?.success) return;
        const datos = { ...IMPRESORA_INICIAL, ...res.data.data };
        setImpCfg(datos);
        // Reconexión silenciosa si ya se autorizó el dispositivo antes en
        // este navegador — no vuelve a pedir permiso.
        if (datos.impresoraModo === 'usb') {
          reconectarImpresoraUSB().then((info) => { if (!ignore && info) setUsbInfo(info); }).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { ignore = true; };
  }, []);

  const actualizarImp = (campo, valor) => setImpCfg((prev) => ({ ...prev, [campo]: valor }));

  const guardarImpresora = async () => {
    setGuardandoImpresora(true);
    try {
      await api.put('/impresora/config', {
        ...impCfg,
        impresoraHabilitada: impCfg.impresoraModo !== 'ninguna',
      });
      toast.success('Configuración de impresora guardada');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo guardar la configuración de impresora');
    } finally {
      setGuardandoImpresora(false);
    }
  };

  const conectarUsb = async () => {
    try {
      const info = await conectarImpresoraUSB();
      setUsbInfo(info);
      toast.success(`Impresora USB conectada: ${info.nombre}`);
    } catch (error) {
      toast.error(error.message || 'No se pudo conectar la impresora USB');
    }
  };

  const probarImpresion = async () => {
    setProbandoImpresora(true);
    try {
      if (impCfg.impresoraModo === 'usb') {
        const res = await api.get('/impresora/prueba/generar', {
          params: { ancho: impCfg.impresoraAncho },
          responseType: 'arraybuffer',
        });
        await enviarBufferUSB(res.data);
        toast.success('Ticket de prueba enviado a la impresora USB');
      } else if (impCfg.impresoraModo === 'red') {
        await api.post('/impresora/test', { ip: impCfg.impresoraIp, puerto: impCfg.impresoraPuerto });
        toast.success('Conexión con la impresora de red exitosa');
      }
    } catch (error) {
      toast.error(error.response?.data?.mensaje || error.message || 'Error al probar la impresora');
    } finally {
      setProbandoImpresora(false);
    }
  };

  const actualizar = (campo, valor) => setForm((prev) => ({ ...prev, [campo]: valor }));

  const agregarPrefijo = () => {
    const p = nuevoPrefijo.trim().toUpperCase();
    if (!p) return;
    if ((form.prefijosRegaloCompras || []).includes(p)) { setNuevoPrefijo(''); return; }
    actualizar('prefijosRegaloCompras', [...(form.prefijosRegaloCompras || []), p]);
    setNuevoPrefijo('');
  };

  const quitarPrefijo = (p) => {
    actualizar('prefijosRegaloCompras', (form.prefijosRegaloCompras || []).filter((x) => x !== p));
  };

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
  const planInfo   = PLANES[planActual] || PLANES.pro;
  const caps       = capacidadesModulos({ ...empresa, plan: planActual });

  const modulos = [
    { key: 'facturacionHabilitada',    label: 'Facturación' },
    { key: 'cajaDiariaHabilitada',     label: 'Caja Diaria' },
    { key: 'posHabilitado',            label: 'POS' },
    { key: 'inventarioHabilitado',     label: 'Inventario' },
    { key: 'comprasHabilitadas',       label: 'Compras' },
    { key: 'buzonSriHabilitado',       label: 'Buzón SRI' },
    { key: 'contabilidadHabilitada',   label: 'Contabilidad' },
    { key: 'retencionesHabilitadas',   label: 'Retenciones' },
    { key: 'liquidacionesHabilitadas', label: 'Liquidaciones' },
    { key: 'atsHabilitado',            label: 'ATS' },
    { key: 'tributarioHabilitado',     label: 'Tributario' },
    { key: 'bancosHabilitado',         label: 'Bancos' },
    { key: 'talentoHumanoHabilitado',  label: 'Talento Humano' },
  ];

  return (
    <div className="syscfg-page">
      <div className="syscfg-header">
        <div>
          <h1>Configuración del Sistema</h1>
          <p>Ajusta los módulos y preferencias operativas de tu empresa.</p>
        </div>
      </div>

      <form className="syscfg-grid" onSubmit={handleSubmit}>

        {/* ── Plan activo (solo lectura) ─────────────────────────────────── */}
        <section className="syscfg-card syscfg-card-wide">
          <h2>Plan del sistema</h2>
          <div className="syscfg-plan-activo" style={{ '--plan-color': planInfo.color }}>
            <div className="syscfg-plan-activo-left">
              <div className="syscfg-plan-activo-header">
                <span className="syscfg-plan-label" style={{ color: planInfo.color }}>{planInfo.label}</span>
                <span className="syscfg-plan-sublabel">{planInfo.sublabel}</span>
              </div>
              <p className="syscfg-plan-desc">{planInfo.descripcion}</p>
              <p className="syscfg-plan-limites">{planInfo.limites}</p>
              <ul className="syscfg-plan-modulos">
                {planInfo.modulos.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
            <div className="syscfg-plan-activo-lock">
              <span className="syscfg-lock-icon">🔒</span>
              <p>El plan es gestionado por el administrador del sistema.</p>
              <p>Para realizar un cambio de plan, contacta a soporte.</p>
            </div>
          </div>
        </section>

        {/* ── Modo de operación ─────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Modo de operación</h2>
          {planActual === 'pro' ? (
            <div>
              <div className="syscfg-modo-opciones">
                <label className={`syscfg-modo-opcion ${form.modoOperacion === 'monoempresa' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="modoOperacion"
                    value="monoempresa"
                    checked={form.modoOperacion === 'monoempresa'}
                    onChange={() => actualizar('modoOperacion', 'monoempresa')}
                  />
                  <span className="syscfg-modo-icon">🏪</span>
                  <span className="syscfg-modo-label">Monoempresa</span>
                  <span className="syscfg-modo-desc">Una sola empresa</span>
                </label>
                <label className={`syscfg-modo-opcion ${form.modoOperacion === 'multiempresa' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="modoOperacion"
                    value="multiempresa"
                    checked={form.modoOperacion === 'multiempresa'}
                    onChange={() => actualizar('modoOperacion', 'multiempresa')}
                  />
                  <span className="syscfg-modo-icon">🏢</span>
                  <span className="syscfg-modo-label">Multiempresa</span>
                  <span className="syscfg-modo-desc">Varias empresas desde una cuenta</span>
                </label>
              </div>
              <p className="syscfg-note" style={{ marginTop: '0.6rem' }}>
                Puedes cambiar el modo en cualquier momento. En multiempresa aparece el selector de empresa en el menú lateral.
              </p>
            </div>
          ) : (
            <div className="syscfg-readonly-block">
              <span className="syscfg-badge syscfg-badge-modo">
                {form.modoOperacion === 'multiempresa' ? '🏢 Multiempresa' : '🏪 Monoempresa'}
              </span>
              <p className="syscfg-note syscfg-readonly-nota">
                🔒 El modo multiempresa requiere plan Pro.
              </p>
            </div>
          )}
        </section>

        {/* ── Caja ──────────────────────────────────────────────────────── */}
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
            <span>Habilitar caja diaria{!caps.cajaDiariaHabilitada ? ' — no incluido en tu plan' : ''}</span>
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

        {/* ── POS ───────────────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Punto de Venta (POS)</h2>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.posHabilitado}
              onChange={(e) => actualizar('posHabilitado', e.target.checked)}
              disabled={!caps.posHabilitado}
            />
            <span>Habilitar módulo POS{!caps.posHabilitado ? ' — no incluido en tu plan' : ''}</span>
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

        {/* ── Sucursales y Puntos de Venta ─────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Sucursales y Puntos de Venta</h2>
          <p className="syscfg-note">
            Para negocios con más de una sucursal, o más de una caja registradora
            emitiendo bajo el mismo punto de emisión SRI. Si tu negocio tiene una
            sola caja, déjalo desactivado — no cambia nada en tu flujo actual.
          </p>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.sucursalesHabilitado}
              onChange={(e) => actualizar('sucursalesHabilitado', e.target.checked)}
            />
            <span>Habilitar Sucursales y Puntos de Venta (multi-caja)</span>
          </label>
        </section>

        {/* ── Impresión y kiosko ────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Impresión y kiosko</h2>
          <p className="syscfg-note">
            El navegador no detecta impresoras automáticamente. Esta sección define cómo debe comportarse la impresión del POS en almacenamiento, kiosko o dispositivos móviles.
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

          {/* ── Impresora térmica ESC/POS (etiquetas y cajón de dinero) ── */}
          <div className="syscfg-subsection">
            <h3>Impresora térmica (etiquetas y cajón de dinero)</h3>
            <p className="syscfg-note">
              El recibo principal del POS ya se imprime por PDF con cualquier
              impresora instalada en tu equipo — esto es solo para las
              etiquetas con código de barras y el cajón de dinero, que
              necesitan comandos directos a la impresora.
            </p>

            <label className="syscfg-field">
              <span>Conexión</span>
              <select
                value={impCfg.impresoraModo}
                onChange={(e) => actualizarImp('impresoraModo', e.target.value)}
              >
                <option value="ninguna">Sin impresora térmica</option>
                <option value="red">Red (IP fija)</option>
                {usbDisponible() && <option value="usb">USB (conectada a este equipo)</option>}
              </select>
              {!usbDisponible() && (
                <span className="syscfg-hint">
                  Este navegador no soporta impresión por USB (WebUSB) — usa Chrome, Edge u Opera para esa opción.
                </span>
              )}
            </label>

            {impCfg.impresoraModo === 'red' && (
              <div className="syscfg-inline-fields">
                <label className="syscfg-field">
                  <span>IP de la impresora</span>
                  <input
                    value={impCfg.impresoraIp || ''}
                    onChange={(e) => actualizarImp('impresoraIp', e.target.value)}
                    placeholder="192.168.1.100"
                  />
                </label>
                <label className="syscfg-field">
                  <span>Puerto</span>
                  <input
                    type="number"
                    value={impCfg.impresoraPuerto}
                    onChange={(e) => actualizarImp('impresoraPuerto', parseInt(e.target.value, 10) || 9100)}
                  />
                </label>
              </div>
            )}

            {impCfg.impresoraModo === 'usb' && (
              <div className="syscfg-usb-box">
                <button type="button" className="btn-secondary" onClick={conectarUsb}>
                  🔌 Conectar impresora USB
                </button>
                <span className={`syscfg-badge ${usbInfo ? 'on' : 'off'}`}>
                  {usbInfo ? `Conectada: ${usbInfo.nombre}` : 'No conectada en esta sesión'}
                </span>
                <p className="syscfg-hint">
                  El navegador te pedirá elegir el dispositivo la primera vez — después lo recuerda
                  automáticamente en este equipo/navegador. Si no aparece en la lista, revisa que el
                  cable esté conectado y que Windows no la tenga bloqueada con su propio driver.
                </p>
              </div>
            )}

            {impCfg.impresoraModo !== 'ninguna' && (
              <>
                <label className="syscfg-field">
                  <span>Ancho de papel</span>
                  <select
                    value={impCfg.impresoraAncho}
                    onChange={(e) => actualizarImp('impresoraAncho', parseInt(e.target.value, 10))}
                  >
                    <option value={58}>58mm</option>
                    <option value={80}>80mm</option>
                  </select>
                </label>
                <label className="syscfg-check">
                  <input
                    type="checkbox"
                    checked={impCfg.cajaDineroHabilitada}
                    onChange={(e) => actualizarImp('cajaDineroHabilitada', e.target.checked)}
                  />
                  <span>Cajón de dinero conectado a la impresora</span>
                </label>

                <div className="syscfg-inline-actions">
                  <button type="button" className="btn-secondary" onClick={probarImpresion} disabled={probandoImpresora}>
                    {probandoImpresora ? 'Probando...' : '🖨️ Probar impresión'}
                  </button>
                  <button type="button" className="btn-primary" onClick={guardarImpresora} disabled={guardandoImpresora}>
                    {guardandoImpresora ? 'Guardando...' : 'Guardar impresora'}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Inventario ────────────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Inventario</h2>
          <label className="syscfg-check">
            <input
              type="checkbox"
              checked={form.inventarioHabilitado}
              onChange={(e) => actualizar('inventarioHabilitado', e.target.checked)}
              disabled={!caps.inventarioHabilitado}
            />
            <span>Habilitar control de inventario{!caps.inventarioHabilitado ? ' — no incluido en tu plan' : ''}</span>
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

          <label style={{ display: 'block', marginTop: '0.75rem' }}>
            Prefijos de regalo/combo en compras
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.4rem' }}>
              Ítems facturados a $0.00 con un código que empieza con alguno de estos prefijos
              (ej. "P-1043664" ligado al producto real "1043664") suman su cantidad al producto
              real en vez de crear uno nuevo. Si el prefijo no coincide con ninguno de la lista,
              el ítem queda en "Obsequios pendientes" para asignarlo manualmente.
            </div>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
            {(form.prefijosRegaloCompras || []).map((p) => (
              <span key={p} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 999,
                padding: '0.2rem 0.6rem', fontSize: '0.85rem',
              }}>
                {p}
                <button type="button" onClick={() => quitarPrefijo(p)} style={{
                  border: 'none', background: 'transparent', cursor: 'pointer', color: '#6366f1', fontWeight: 'bold',
                }}>×</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              placeholder="Nuevo prefijo, ej. OFERTA-"
              value={nuevoPrefijo}
              onChange={(e) => setNuevoPrefijo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarPrefijo(); } }}
            />
            <button type="button" className="btn-secondary" onClick={agregarPrefijo}>Agregar</button>
          </div>
        </section>

        {/* ── Módulos avanzados ─────────────────────────────────────────── */}
        <section className="syscfg-card">
          <h2>Módulos avanzados</h2>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.facturacionHabilitada}
              onChange={(e) => actualizar('facturacionHabilitada', e.target.checked)}
              disabled={!caps.facturacionHabilitada} />
            <span>Facturación (Facturas, Notas de Venta, Notas de Débito, Guías de Remisión){!caps.facturacionHabilitada ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.comprasHabilitadas}
              onChange={(e) => actualizar('comprasHabilitadas', e.target.checked)}
              disabled={!caps.comprasHabilitadas} />
            <span>Compras{!caps.comprasHabilitadas ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.buzonSriHabilitado}
              onChange={(e) => actualizar('buzonSriHabilitado', e.target.checked)}
              disabled={!caps.buzonSriHabilitado} />
            <span>Buzón SRI{!caps.buzonSriHabilitado ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.retencionesHabilitadas}
              onChange={(e) => actualizar('retencionesHabilitadas', e.target.checked)}
              disabled={!caps.retencionesHabilitadas} />
            <span>Retenciones{!caps.retencionesHabilitadas ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.liquidacionesHabilitadas}
              onChange={(e) => actualizar('liquidacionesHabilitadas', e.target.checked)}
              disabled={!caps.liquidacionesHabilitadas} />
            <span>Liquidaciones de compra{!caps.liquidacionesHabilitadas ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.atsHabilitado}
              onChange={(e) => actualizar('atsHabilitado', e.target.checked)}
              disabled={!caps.atsHabilitado} />
            <span>ATS{!caps.atsHabilitado ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.tributarioHabilitado}
              onChange={(e) => actualizar('tributarioHabilitado', e.target.checked)}
              disabled={!caps.tributarioHabilitado} />
            <span>Tributario (Declaraciones, Retenciones recibidas, Reportes){!caps.tributarioHabilitado ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.contabilidadHabilitada}
              onChange={(e) => actualizar('contabilidadHabilitada', e.target.checked)}
              disabled={!caps.contabilidadHabilitada} />
            <span>Contabilidad (incluye CxC, CxP, Caja Chica){!caps.contabilidadHabilitada ? ' — no incluido en tu plan' : ''}</span>
          </label>
          <label className="syscfg-check">
            <input type="checkbox" checked={form.bancosHabilitado}
              onChange={(e) => actualizar('bancosHabilitado', e.target.checked)}
              disabled={!caps.bancosHabilitado} />
            <span>Bancos{!caps.bancosHabilitado ? ' — no incluido en tu plan' : ''}</span>
          </label>
        </section>

        {/* ── Talento Humano ────────────────────────────────────────────── */}
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
              {!caps.talentoHumanoHabilitado ? ' — no incluido en tu plan' : ''}
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
                  placeholder="480.00"
                />
              </div>
              <small className="syscfg-hint">
                Se usa para calcular el décimo cuarto proporcional en la nómina. Actualizar cada año según resolución ministerial.
              </small>
            </div>
          </div>
        </section>

        {/* ── SMTP / Correo (colapsible) ─────────────────────────────────── */}
        <section className="syscfg-card syscfg-card-wide">
          <button
            type="button"
            className="syscfg-accordion-toggle"
            onClick={() => setSmtpAbierto((v) => !v)}
            aria-expanded={smtpAbierto}
          >
            <span>📧 Correo Electrónico</span>
            <span className={`syscfg-accordion-arrow ${smtpAbierto ? 'open' : ''}`}>▾</span>
          </button>

          {smtpAbierto && (
            <div className="syscfg-accordion-body">
              <p className="syscfg-note" style={{ marginBottom: '.75rem' }}>
                El correo electrónico se configura a nivel del servidor (variables de entorno en Railway).
                Todos los tenants comparten el mismo servidor de envío. Para verificar que funciona,
                usa el botón de prueba.
              </p>
              <code className="syscfg-code-block">
                SMTP_HOST = smtp.gmail.com<br />
                SMTP_PORT = 587<br />
                SMTP_USER = tucorreo@gmail.com<br />
                SMTP_PASS = contraseña-de-app (o re_xxxx para Resend)<br />
                SMTP_FROM = AELA ERP &lt;tucorreo@gmail.com&gt;
              </code>
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
                El email de prueba se envía a tu correo registrado en el sistema.
              </small>
            </div>
          )}
        </section>

        {/* ── Resumen ───────────────────────────────────────────────────── */}
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
