import { useState, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import AuthContext from '../../context/auth-context';
import { parseFechaLocal, formatFechaCorta, hoyLocal } from '../../utils/fecha';
import DropZone from '../shared/DropZone';
import './BuzonSRI.css';

const TIPO_COLORES = {
  'Factura': 'factura',
  'Liquidación de Compra': 'liquidacion',
  'Comprobante de Retención': 'retencion',
  'Nota de Crédito': 'nc',
  'Nota de Débito': 'nd',
};

const ESTADO_LABELS = {
  nuevo: { label: 'Nuevo', cls: 'chip-nuevo' },
  existe: { label: 'Ya existe', cls: 'chip-existe' },
  error: { label: 'Error', cls: 'chip-error' },
};

function formatFechaEc(fechaStr) {
  if (!fechaStr) return '—';
  const partes = String(fechaStr).split('/');
  if (partes.length === 3) return `${partes[0]}/${partes[1]}/${partes[2]}`;
  return formatFechaCorta(fechaStr);
}

// Helper: hoy y hace 30 días en formato yyyy-mm-dd
function hoyISO() { return hoyLocal(); }
function hace30DiasISO() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const TIPOS_COMP_SRI = [
  { value: 'TODOS',                   label: 'Todos los tipos' },
  { value: '01',                      label: 'Facturas' },
  { value: '03',                      label: 'Liquidaciones de compra' },
  { value: '04',                      label: 'Notas de crédito' },
  { value: '05',                      label: 'Notas de débito' },
  { value: '07',                      label: 'Comprobantes de retención' },
];

function esErrorCredencialesSri(err) {
  const msg = err.response?.data?.mensaje || err.message || '';
  return /credenciales|contraseña|password|clave.*incorrect/i.test(msg);
}

function esErrorBrowserNoDisponible(err) {
  const msg = err.response?.data?.mensaje || err.message || '';
  return /BROWSER_UNAVAILABLE|no se pudo iniciar el navegador|chromium|chrome/i.test(msg);
}

// Inicia el job y hace polling hasta completar (evita el timeout de 60 s de Railway)
async function consultarSriAutomatico(payload, onProgreso) {
  const { data: inicio } = await api.post('/buzon/sri/consultar', payload);
  if (!inicio.jobId) return { data: inicio }; // respuesta directa inesperada

  const MAX_INTENTOS = 80; // máx ~4 min de polling (80 × 3 s)
  for (let i = 0; i < MAX_INTENTOS; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: estado } = await api.get(`/buzon/sri/job/${inicio.jobId}`);
    if (onProgreso) onProgreso(estado.mensaje || 'Procesando...');
    if (estado.status === 'done') return { data: estado };
    if (estado.status === 'error') {
      const err = new Error(estado.mensaje || 'Error en la consulta');
      err.response = { data: { mensaje: estado.mensaje, erroresConsulta: estado.erroresConsulta } };
      throw err;
    }
    // status === 'pending' → continuar esperando
  }
  throw new Error('Tiempo de espera agotado. El scraper tardó más de 4 minutos.');
}

export default function BuzonSRI() {
  const navigate = useNavigate();
  const { empresa } = useContext(AuthContext);

  const [tab, setTab] = useState('descarga');
  const [paso, setPaso] = useState(1);

  // ── Estado descarga automática ────────────────────────────
  const [dmIdentificacion, setDmIdentificacion] = useState(() => empresa?.ruc || empresa?.identificacion || '');
  const [dmPassword,       setDmPassword]       = useState('');
  const [dmFechaDesde,     setDmFechaDesde]     = useState(hace30DiasISO);
  const [dmFechaHasta,     setDmFechaHasta]     = useState(hoyISO);
  const [dmTipo,           setDmTipo]           = useState('TODOS');
  const [dmConsultando,    setDmConsultando]    = useState(false);
  const [dmProgreso,       setDmProgreso]       = useState('');
  const [dmResultados,     setDmResultados]     = useState([]);
  const [dmSeleccionados,  setDmSeleccionados]  = useState(new Set());
  const [dmPaso,           setDmPaso]           = useState(1);
  const [dmResumen,        setDmResumen]        = useState(null);
  const [dmImportando,     setDmImportando]     = useState(false);

  const [textareaClaves, setTextareaClaves] = useState('');
  const [consultando, setConsultando] = useState(false);
  const [resultadosConsulta, setResultadosConsulta] = useState([]);

  const [seleccionados, setSeleccionados] = useState(new Set());
  const [opciones, setOpciones] = useState({
    registraInventario: false,
    creaProductos: false,
    registraCaja: false,
  });

  const [importando, setImportando] = useState(false);
  const [resumenImport, setResumenImport] = useState(null);

  const [archivoZip, setArchivoZip] = useState(null);
  const [importandoZip, setImportandoZip] = useState(false);
  const [resumenZip, setResumenZip] = useState(null);

  const [archivosXml, setArchivosXml]     = useState([]);
  const [importandoXml, setImportandoXml] = useState(false);
  const [resumenXml, setResumenXml]       = useState(null);

  const [archivoTxt, setArchivoTxt]       = useState(null);
  const [txtInfo, setTxtInfo]             = useState(null); // { total, claves }

  const [historial, setHistorial]             = useState(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const [diagnostico, setDiagnostico]         = useState(null);
  const [corrDiagnostico, setCorrDiagnostico] = useState(false);

  // ── Parsear archivo TXT del portal SRI ──────────────────────
  // El SRI descarga archivos TXT/CSV con claves de acceso de 49 dígitos.
  // Se extraen con regex y se cargan en el textarea de claves.
  const leerTxt = (file) => {
    if (!file) return;
    setArchivoTxt(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const contenido = e.target.result || '';
      // Extraer todas las secuencias de exactamente 49 dígitos numéricos
      const clavesEncontradas = [...new Set(
        (contenido.match(/\b\d{49}\b/g) || [])
      )];
      setTxtInfo({ total: clavesEncontradas.length, claves: clavesEncontradas });
      if (clavesEncontradas.length === 0) {
        toast.error('No se encontraron claves de acceso (49 dígitos) en el archivo.');
      } else {
        toast.success(`${clavesEncontradas.length} clave(s) encontrada(s) en el archivo.`);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const cargarClavesDeseTxt = () => {
    if (!txtInfo?.claves?.length) return;
    setTextareaClaves(txtInfo.claves.join('\n'));
    setTab('claves'); // cambiar a la pestaña de claves manuales
    toast.success(`${txtInfo.claves.length} clave(s) cargadas. Revisa y haz clic en "Consultar".`);
  };

  const importarXml = async () => {
    if (archivosXml.length === 0) { toast.error('Selecciona uno o más archivos XML'); return; }
    setImportandoXml(true);
    try {
      const fd = new FormData();
      archivosXml.forEach((f) => fd.append('archivos', f));
      fd.append('opciones', JSON.stringify(opciones));
      const res = await api.post('/buzon/importar-xml', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResumenXml(res.data);
      toast.success(`${res.data.resumen?.creados || 0} documento(s) importado(s) desde XML`);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al procesar los XML');
    } finally {
      setImportandoXml(false);
    }
  };



  const parsearClaves = () => textareaClaves
    .split(/[\n,;]+/)
    .map((c) => c.replace(/\s+/g, '').trim())
    .filter((c) => c.length === 49);

  const [avisoSri, setAvisoSri] = useState(null);

  const consultarClaves = async () => {
    const claves = parsearClaves();
    if (claves.length === 0) { toast.error('Ingresa al menos una clave de acceso válida (49 dígitos)'); return; }
    if (claves.length > 50) { toast.error('Máximo 50 claves por lote'); return; }
    setConsultando(true);
    setAvisoSri(null);
    try {
      const res = await api.post('/buzon/consultar', { claves });
      const resultados = res.data?.resultados || [];
      setResultadosConsulta(resultados);
      setSeleccionados(new Set(resultados.filter((r) => r.estado === 'nuevo').map((r) => r.clave)));
      setAvisoSri(res.data?.avisoSri || null);
      setPaso(2);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al consultar el SRI');
    } finally {
      setConsultando(false);
    }
  };

  const toggleSeleccion = (clave) => {
    setSeleccionados((prev) => { const s = new Set(prev); s.has(clave) ? s.delete(clave) : s.add(clave); return s; });
  };

  const toggleTodos = () => {
    const nuevos = resultadosConsulta.filter((r) => r.estado === 'nuevo').map((r) => r.clave);
    setSeleccionados(seleccionados.size === nuevos.length ? new Set() : new Set(nuevos));
  };

  const importarSeleccionados = async () => {
    const items = [...seleccionados].map((clave) => ({ clave }));
    if (items.length === 0) { toast.error('Selecciona al menos un documento'); return; }
    setImportando(true);
    try {
      const res = await api.post('/buzon/importar', { items, opciones });
      setResumenImport(res.data);
      setPaso(3);
      toast.success(`${res.data.resumen?.creados || 0} documento(s) importado(s)`);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al importar');
    } finally {
      setImportando(false);
    }
  };

  const reiniciar = () => { setTextareaClaves(''); setResultadosConsulta([]); setSeleccionados(new Set()); setResumenImport(null); setAvisoSri(null); setPaso(1); };

  const importarZip = async () => {
    if (!archivoZip) { toast.error('Selecciona un archivo ZIP'); return; }
    setImportandoZip(true);
    try {
      const fd = new FormData();
      fd.append('archivo', archivoZip);
      fd.append('opciones', JSON.stringify(opciones));
      const res = await api.post('/buzon/importar-zip', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResumenZip(res.data);
      toast.success(`${res.data.resumen?.creados || 0} documento(s) importado(s) desde ZIP`);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al procesar el ZIP');
    } finally {
      setImportandoZip(false);
    }
  };

  // ── Handlers descarga automática ─────────────────────────
  const dmConsultar = async () => {
    if (!dmIdentificacion.trim()) { toast.error('Ingresa tu RUC o cédula del portal SRI'); return; }
    if (!dmPassword.trim())       { toast.error('Ingresa tu clave del portal SRI'); return; }
    if (!dmFechaDesde || !dmFechaHasta) { toast.error('Selecciona el rango de fechas'); return; }
    setDmConsultando(true);
    setDmProgreso('Iniciando...');
    try {
      const res = await consultarSriAutomatico(
        {
          identificacion:  dmIdentificacion.trim(),
          password:        dmPassword,
          fechaDesde:      dmFechaDesde,
          fechaHasta:      dmFechaHasta,
          tipoComprobante: dmTipo,
        },
        (msg) => setDmProgreso(msg),
      );
      const resultados = res.data?.resultados || [];
      setDmResultados(resultados);
      setDmSeleccionados(new Set(resultados.filter((r) => r.estado === 'nuevo').map((r) => r.clave)));
      setDmPaso(2);
      if (resultados.length === 0) toast('No se encontraron comprobantes en ese período.', { icon: 'ℹ️' });
      else toast.success(`${res.data.nuevos} nuevos de ${res.data.total} comprobantes encontrados`);
    } catch (err) {
      if (esErrorBrowserNoDisponible(err)) {
        toast.error(
          'La descarga automática no está disponible en este momento (navegador no iniciado). ' +
          'Descarga el ZIP desde srienlinea.sri.gob.ec y usa la pestaña "Importar ZIP".',
          { duration: 8000 }
        );
      } else if (esErrorCredencialesSri(err)) {
        toast.error(err.response?.data?.mensaje || 'Credenciales del portal SRI incorrectas.');
      } else {
        toast.error(err.response?.data?.mensaje || 'Error al consultar el portal SRI');
      }
    } finally {
      setDmConsultando(false);
      setDmProgreso('');
    }
  };

  const dmToggle = (clave) => {
    setDmSeleccionados((prev) => { const s = new Set(prev); s.has(clave) ? s.delete(clave) : s.add(clave); return s; });
  };

  const dmToggleTodos = () => {
    const nuevos = dmResultados.filter((r) => r.estado === 'nuevo').map((r) => r.clave);
    setDmSeleccionados(dmSeleccionados.size === nuevos.length ? new Set() : new Set(nuevos));
  };

  const dmImportar = async () => {
    const items = [...dmSeleccionados].map((clave) => ({ clave }));
    if (items.length === 0) { toast.error('Selecciona al menos un documento'); return; }
    setDmImportando(true);
    try {
      const res = await api.post('/buzon/importar', { items, opciones });
      setDmResumen(res.data);
      setDmPaso(3);
      toast.success(`${res.data.resumen?.creados || 0} documento(s) importado(s)`);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al importar');
    } finally {
      setDmImportando(false);
    }
  };

  const dmReiniciar = () => {
    setDmPassword(''); setDmResultados([]); setDmSeleccionados(new Set()); setDmResumen(null); setDmPaso(1);
  };

  const ejecutarDiagnostico = async () => {
    setCorrDiagnostico(true);
    setDiagnostico(null);
    try {
      const res = await api.get('/buzon/sri/diagnostico');
      setDiagnostico(res.data?.data || null);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al ejecutar diagnóstico');
    } finally {
      setCorrDiagnostico(false);
    }
  };

  const cargarHistorial = useCallback(async () => {
    setCargandoHistorial(true);
    try {
      const res = await api.get('/buzon/historial');
      setHistorial(res.data?.data);
    } catch { toast.error('No se pudo cargar el historial'); }
    finally { setCargandoHistorial(false); }
  }, []);

  const handleTabChange = (t) => { setTab(t); if (t === 'historial' && !historial) cargarHistorial(); };

  const nuevosCount = resultadosConsulta.filter((r) => r.estado === 'nuevo').length;

  return (
    <div className="buzon-page">
      <div className="buzon-header">
        <div>
          <h1>📥 Buzón SRI</h1>
          <p>Importa documentos electrónicos recibidos: facturas de proveedores, retenciones de clientes, notas de crédito y débito.</p>
        </div>
        <button
          className="btn-secondary"
          onClick={ejecutarDiagnostico}
          disabled={corrDiagnostico}
          title="Verifica la conexión con el portal SRI y el estado de Chrome"
        >
          {corrDiagnostico ? '⏳ Verificando…' : '🔍 Diagnóstico SRI'}
        </button>
      </div>

      {diagnostico && (
        <div className="buzon-diagnostico">
          <h4>🔍 Diagnóstico de conexión SRI</h4>
          <div className="buzon-diag-checks">
            {diagnostico.checks?.map((c, i) => (
              <div key={i} className={`buzon-diag-check ${c.ok ? 'ok' : 'fail'}`}>
                <span className="buzon-diag-icon">{c.ok ? '✅' : '❌'}</span>
                <div>
                  <strong>{c.tipo}</strong>
                  {c.url && <span className="buzon-diag-url"> {c.url.replace('https://srienlinea.sri.gob.ec', '')}</span>}
                  {c.nota && <div className="buzon-diag-nota">{c.nota}</div>}
                  {c.version && <div className="buzon-diag-nota">Chrome: {c.version}</div>}
                  {c.error && <div className="buzon-diag-error">{c.error}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="buzon-diag-resumen">
            {(() => {
              const portalOk  = diagnostico.checks?.find(c => c.tipo === 'SRI-Portal')?.ok;
              const chromeOk  = diagnostico.checks?.find(c => c.tipo === 'Chrome')?.ok;
              if (portalOk && chromeOk)
                return '✅ Portal SRI accesible y Chrome listo — la descarga automática debería funcionar.';
              if (portalOk && !chromeOk)
                return '🟡 Portal SRI accesible pero Chrome no está disponible en el servidor. Usa "Importar TXT del SRI".';
              if (!portalOk)
                return '🔴 No se puede acceder al portal SRI. Usa "Importar TXT del SRI" o "Importar ZIP".';
              return '🟡 Estado parcial — prueba la descarga automática.';
            })()}
          </div>
          <button className="btn-secondary" style={{ marginTop: '.5rem', fontSize: '.8rem' }} onClick={() => setDiagnostico(null)}>Cerrar</button>
        </div>
      )}

      <div className="buzon-tabs-bar">
        <button className={`buzon-tab ${tab === 'descarga' ? 'active' : ''}`} onClick={() => handleTabChange('descarga')}>🔗 Descarga automática SRI</button>
        <button className={`buzon-tab ${tab === 'txt' ? 'active' : ''}`} onClick={() => handleTabChange('txt')}>📄 Importar TXT del SRI</button>
        <button className={`buzon-tab ${tab === 'claves' ? 'active' : ''}`} onClick={() => handleTabChange('claves')}>Por claves de acceso</button>
        <button className={`buzon-tab ${tab === 'zip' ? 'active' : ''}`} onClick={() => handleTabChange('zip')}>Importar ZIP</button>
        <button className={`buzon-tab ${tab === 'xml' ? 'active' : ''}`} onClick={() => handleTabChange('xml')}>Importar XML</button>
        <button className={`buzon-tab ${tab === 'historial' ? 'active' : ''}`} onClick={() => handleTabChange('historial')}>Historial</button>
      </div>

      {/* ── TAB DESCARGA AUTOMÁTICA ───────────────────────── */}
      {tab === 'descarga' && (
        <div className="buzon-card">

          {/* PASO 1 — Credenciales + filtros */}
          {dmPaso === 1 && (
            <div className="buzon-step">
              <h2 className="buzon-step-title">Descarga automática de comprobantes del SRI</h2>
              <p className="buzon-step-hint">
                Ingresa tus credenciales del portal <strong>srienlinea.sri.gob.ec</strong> y el período a consultar.
                El sistema obtendrá automáticamente las claves de todos los comprobantes recibidos.
              </p>

              <div className="buzon-credentials-note">
                🔒 Tus credenciales se usan únicamente para consultar el portal SRI y no se almacenan.
              </div>

              <div className="buzon-sri-aviso">
                <strong>🤖 Modo automático:</strong> El sistema navega el portal SRI en segundo plano con un navegador automático (Puppeteer/Chromium). El proceso puede tardar entre 30 y 90 segundos.
                Si falla, descarga el ZIP manualmente desde{' '}
                <strong>srienlinea.sri.gob.ec → Comprobantes electrónicos → Recibidos → Descargar XML</strong>{' '}
                e impórtalo en la pestaña <strong>Importar ZIP</strong>.
              </div>

              <div className="buzon-form-grid">
                <div className="buzon-form-field">
                  <label>RUC / Cédula (portal SRI)</label>
                  <input
                    type="text"
                    className="buzon-input"
                    placeholder="Ej: 1713175071001"
                    value={dmIdentificacion}
                    onChange={(e) => setDmIdentificacion(e.target.value)}
                    maxLength={13}
                  />
                </div>
                <div className="buzon-form-field">
                  <label>Clave del portal SRI</label>
                  <input
                    type="password"
                    className="buzon-input"
                    placeholder="Contraseña de srienlinea.sri.gob.ec"
                    value={dmPassword}
                    onChange={(e) => setDmPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="buzon-form-field">
                  <label>Fecha desde</label>
                  <input type="date" className="buzon-input" value={dmFechaDesde} onChange={(e) => setDmFechaDesde(e.target.value)} />
                </div>
                <div className="buzon-form-field">
                  <label>Fecha hasta</label>
                  <input type="date" className="buzon-input" value={dmFechaHasta} onChange={(e) => setDmFechaHasta(e.target.value)} />
                </div>
                <div className="buzon-form-field buzon-form-field--full">
                  <label>Tipo de comprobante</label>
                  <select className="buzon-input" value={dmTipo} onChange={(e) => setDmTipo(e.target.value)}>
                    {TIPOS_COMP_SRI.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="buzon-step-actions">
                <button
                  className="btn-primary"
                  onClick={dmConsultar}
                  disabled={dmConsultando || !dmIdentificacion.trim() || !dmPassword.trim()}
                >
                  {dmConsultando ? `🤖 ${dmProgreso || 'Navegando el portal SRI...'}` : 'Consultar portal SRI →'}
                </button>
              </div>
            </div>
          )}

          {/* PASO 2 — Revisión y selección */}
          {dmPaso === 2 && (
            <div className="buzon-step">
              <h2 className="buzon-step-title">Paso 2 — Selecciona los comprobantes a importar</h2>
              <p className="buzon-step-hint">
                Se encontraron <strong>{dmResultados.length}</strong> comprobante(s).
                Los marcados como <span style={{ color: '#22C55E', fontWeight: 600 }}>Nuevo</span> no están en el sistema aún.
              </p>

              {dmResultados.some((r) => r.tipoCod === '01' || r.tipoCod === '03') && (
                <div className="buzon-opciones">
                  <strong>Opciones para facturas:</strong>
                  <label><input type="checkbox" checked={opciones.registraInventario} onChange={(e) => setOpciones((p) => ({ ...p, registraInventario: e.target.checked }))} /> Registrar entrada de inventario</label>
                  <label><input type="checkbox" checked={opciones.creaProductos} onChange={(e) => setOpciones((p) => ({ ...p, creaProductos: e.target.checked }))} /> Crear productos faltantes</label>
                  <label><input type="checkbox" checked={opciones.registraCaja} onChange={(e) => setOpciones((p) => ({ ...p, registraCaja: e.target.checked }))} /> Registrar egreso en caja</label>
                </div>
              )}

              <div className="buzon-table-wrap">
                <table className="buzon-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={dmSeleccionados.size === dmResultados.filter((r) => r.estado === 'nuevo').length && dmResultados.some((r) => r.estado === 'nuevo')}
                          onChange={dmToggleTodos}
                        />
                      </th>
                      <th>Tipo</th>
                      <th>Emisor / Agente</th>
                      <th>Fecha</th>
                      <th>Total</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dmResultados.map((r) => {
                      const estadoInfo = ESTADO_LABELS[r.estado] || { label: r.estado, cls: '' };
                      const tipoColor  = TIPO_COLORES[r.tipo] || '';
                      return (
                        <tr key={r.clave} className={r.estado === 'nuevo' && dmSeleccionados.has(r.clave) ? 'row-selected' : ''}>
                          <td>
                            {r.estado === 'nuevo' && (
                              <input type="checkbox" checked={dmSeleccionados.has(r.clave)} onChange={() => dmToggle(r.clave)} />
                            )}
                          </td>
                          <td><span className={`buzon-tipo-chip ${tipoColor}`}>{r.tipo || r.preview?.tipo || '—'}</span></td>
                          <td>
                            <div className="buzon-emisor">
                              <span>{r.preview?.emisorNombre || '—'}</span>
                              <small>{r.preview?.emisorRuc || ''}</small>
                            </div>
                          </td>
                          <td>{formatFechaEc(r.preview?.fecha)}</td>
                          <td className="buzon-total">
                            {r.preview?.total != null ? `$${Number(r.preview.total).toFixed(2)}` : '—'}
                          </td>
                          <td>
                            <span className={`buzon-estado-chip ${estadoInfo.cls}`}>{estadoInfo.label}</span>
                            {r.error && <small className="buzon-error-msg"> {r.error}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="buzon-step-actions">
                <button className="btn-secondary" onClick={dmReiniciar}>← Volver</button>
                <span className="buzon-count-hint">{dmSeleccionados.size} seleccionado(s)</span>
                <button
                  className="btn-primary"
                  onClick={dmImportar}
                  disabled={dmImportando || dmSeleccionados.size === 0}
                >
                  {dmImportando ? 'Importando...' : `Importar ${dmSeleccionados.size} documento(s)`}
                </button>
              </div>
            </div>
          )}

          {/* PASO 3 — Resultado importación */}
          {dmPaso === 3 && dmResumen && (
            <div className="buzon-step">
              <h2 className="buzon-step-title">✅ Importación completada</h2>
              <div className="buzon-resumen">
                <div className="buzon-resumen-card buzon-resumen--verde"><span>{dmResumen.resumen?.creados || 0}</span><small>Importados</small></div>
                <div className="buzon-resumen-card buzon-resumen--gris"><span>{dmResumen.resumen?.omitidos || 0}</span><small>Ya existían</small></div>
                <div className="buzon-resumen-card buzon-resumen--rojo"><span>{dmResumen.resumen?.errores || 0}</span><small>Con error</small></div>
              </div>
              {dmResumen.resultados?.some((r) => r.estado === 'error') && (
                <div className="buzon-errores-list">
                  <strong>Documentos con error:</strong>
                  {dmResumen.resultados.filter((r) => r.estado === 'error').map((r) => (
                    <div key={r.clave} className="buzon-error-item"><code>{r.clave}</code> — {r.error}</div>
                  ))}
                </div>
              )}
              <div className="buzon-step-actions">
                <button className="btn-secondary" onClick={dmReiniciar}>Nueva descarga</button>
                <button className="btn-primary" onClick={() => navigate('/compras')}>Ver en Compras</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB CLAVES ────────────────────────────────────── */}
      {tab === 'claves' && (
        <div className="buzon-card">
          {paso === 1 && (
            <div className="buzon-step">
              <h2 className="buzon-step-title">Paso 1 — Ingresa las claves de acceso</h2>
              <p className="buzon-step-hint">Pega las claves de acceso (49 dígitos) de los documentos recibidos, una por línea o separadas por comas. Máximo 50 por lote.</p>
              <textarea
                className="buzon-textarea"
                rows={8}
                placeholder={"2404202601179218540900110010010000001541234567811\n2404202601179218540900110010010000001641234567812"}
                value={textareaClaves}
                onChange={(e) => setTextareaClaves(e.target.value)}
              />
              <div className="buzon-step-actions">
                <span className="buzon-count-hint">{parsearClaves().length} clave(s) válidas detectadas</span>
                <button className="btn-primary" onClick={consultarClaves} disabled={consultando || parsearClaves().length === 0}>
                  {consultando ? 'Consultando SRI...' : 'Consultar en SRI →'}
                </button>
              </div>
            </div>
          )}

          {paso === 2 && (
            <div className="buzon-step">
              <h2 className="buzon-step-title">Paso 2 — Revisión de documentos</h2>
              <p className="buzon-step-hint">
                <strong>{nuevosCount} nuevo(s)</strong> de {resultadosConsulta.length} clave(s) consultadas. Selecciona los que deseas importar.
              </p>

              {avisoSri && (
                <div className="buzon-alerta-warning" style={{ marginBottom: '1rem' }}>
                  <strong>⚠️ Servicio SRI no disponible</strong><br />
                  {avisoSri}
                </div>
              )}

              {resultadosConsulta.some((r) => r.tipoCod === '01' || r.tipoCod === '03') && (
                <div className="buzon-opciones">
                  <strong>Opciones para facturas:</strong>
                  <label><input type="checkbox" checked={opciones.registraInventario} onChange={(e) => setOpciones((p) => ({ ...p, registraInventario: e.target.checked }))} /> Registrar entrada de inventario</label>
                  <label><input type="checkbox" checked={opciones.creaProductos} onChange={(e) => setOpciones((p) => ({ ...p, creaProductos: e.target.checked }))} /> Crear productos faltantes</label>
                  <label><input type="checkbox" checked={opciones.registraCaja} onChange={(e) => setOpciones((p) => ({ ...p, registraCaja: e.target.checked }))} /> Registrar egreso en caja</label>
                </div>
              )}

              <div className="buzon-table-wrap">
                <table className="buzon-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" checked={seleccionados.size === nuevosCount && nuevosCount > 0} onChange={toggleTodos} /></th>
                      <th>Tipo</th><th>Emisor / Agente</th><th>Fecha</th><th>Total</th><th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultadosConsulta.map((r) => {
                      const estadoInfo = ESTADO_LABELS[r.estado] || { label: r.estado, cls: '' };
                      const tipoColor = TIPO_COLORES[r.tipo] || '';
                      return (
                        <tr key={r.clave} className={r.estado === 'nuevo' && seleccionados.has(r.clave) ? 'row-selected' : ''}>
                          <td>{r.estado === 'nuevo' && <input type="checkbox" checked={seleccionados.has(r.clave)} onChange={() => toggleSeleccion(r.clave)} />}</td>
                          <td><span className={`buzon-tipo-chip ${tipoColor}`}>{r.tipo || '—'}</span></td>
                          <td>
                            <div className="buzon-emisor">
                              <span>{r.preview?.emisorNombre || '—'}</span>
                              <small>{r.preview?.emisorRuc || ''}</small>
                            </div>
                          </td>
                          <td>{formatFechaEc(r.preview?.fecha)}</td>
                          <td className="buzon-total">{r.preview?.total != null ? `$${Number(r.preview.total).toFixed(2)}` : '—'}</td>
                          <td>
                            <span className={`buzon-estado-chip ${estadoInfo.cls}`}>{estadoInfo.label}</span>
                            {r.error && <small className="buzon-error-msg"> {r.error}</small>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="buzon-step-actions">
                <button className="btn-secondary" onClick={reiniciar}>← Volver</button>
                <span className="buzon-count-hint">{seleccionados.size} seleccionado(s)</span>
                <button className="btn-primary" onClick={importarSeleccionados} disabled={importando || seleccionados.size === 0}>
                  {importando ? 'Importando...' : `Importar ${seleccionados.size} documento(s)`}
                </button>
              </div>
            </div>
          )}

          {paso === 3 && resumenImport && (
            <div className="buzon-step">
              <h2 className="buzon-step-title">✅ Importación completada</h2>
              <div className="buzon-resumen">
                <div className="buzon-resumen-card buzon-resumen--verde"><span>{resumenImport.resumen?.creados || 0}</span><small>Importados</small></div>
                <div className="buzon-resumen-card buzon-resumen--gris"><span>{resumenImport.resumen?.omitidos || 0}</span><small>Ya existían</small></div>
                <div className="buzon-resumen-card buzon-resumen--rojo"><span>{resumenImport.resumen?.errores || 0}</span><small>Con error</small></div>
              </div>
              {resumenImport.resultados?.some((r) => r.estado === 'error') && (
                <div className="buzon-errores-list">
                  <strong>Documentos con error:</strong>
                  {resumenImport.resultados.filter((r) => r.estado === 'error').map((r) => (
                    <div key={r.clave} className="buzon-error-item"><code>{r.clave}</code> — {r.error}</div>
                  ))}
                </div>
              )}
              <div className="buzon-step-actions">
                <button className="btn-secondary" onClick={reiniciar}>Nueva importación</button>
                <button className="btn-primary" onClick={() => navigate('/compras')}>Ver en Compras</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB TXT DEL PORTAL SRI ───────────────────────── */}
      {tab === 'txt' && (
        <div className="buzon-card">
          <div className="buzon-step">
            <h2 className="buzon-step-title">Importar desde archivo TXT del portal SRI</h2>
            <p className="buzon-step-hint">
              El portal SRI en línea permite descargar un reporte en formato <strong>.txt</strong> o <strong>.csv</strong>
              con el listado de comprobantes electrónicos recibidos. AELA extrae automáticamente las
              <strong> claves de acceso</strong> de ese archivo y las importa al sistema.
            </p>

            <div className="buzon-txt-instrucciones">
              <h4>¿Cómo obtener el archivo TXT del SRI?</h4>
              <ol>
                <li>Ingresa a <strong>srienlinea.sri.gob.ec</strong> con tu RUC y contraseña.</li>
                <li>Ve a <strong>Comprobantes Electrónicos → Documentos Recibidos</strong>.</li>
                <li>Filtra por rango de fechas y tipo de documento.</li>
                <li>Haz clic en <strong>Descargar</strong> o <strong>Exportar</strong> (TXT / CSV).</li>
                <li>Sube ese archivo aquí.</li>
              </ol>
              <div className="buzon-txt-nota">
                💡 El archivo puede tener extensión <code>.txt</code>, <code>.csv</code> o <code>.prn</code>.
                AELA busca automáticamente todos los números de 49 dígitos (claves de acceso) dentro del archivo.
              </div>
            </div>

            <DropZone
              accept=".txt,.csv,.prn,text/plain,text/csv"
              icon="📄"
              label="Arrastra o selecciona el archivo TXT / CSV del SRI"
              sublabel="Acepta .txt  .csv  .prn"
              files={archivoTxt ? [archivoTxt] : []}
              onChange={([f]) => { setArchivoTxt(f || null); setTxtInfo(null); if (f) leerTxt(f); }}
              style={{ marginTop: '1.25rem' }}
            />

            {txtInfo && (
              <div className="buzon-txt-resultado" style={{ marginTop: '1rem' }}>
                {txtInfo.total === 0 ? (
                  <div className="buzon-alerta-warning">
                    ⚠️ No se encontraron claves de acceso en el archivo. Verifica que sea el archivo correcto del portal SRI.
                  </div>
                ) : (
                  <>
                    <div className="buzon-alerta-ok">
                      ✅ Se encontraron <strong>{txtInfo.total}</strong> clave(s) de acceso en el archivo.
                    </div>
                    <ul className="buzon-txt-claves-preview">
                      {txtInfo.claves.slice(0, 5).map((c) => (
                        <li key={c}><code>{c.slice(0, 20)}…</code></li>
                      ))}
                      {txtInfo.total > 5 && <li style={{ color: '#64748b' }}>…y {txtInfo.total - 5} más</li>}
                    </ul>
                    {txtInfo.total > 50 && (
                      <div className="buzon-alerta-warning" style={{ marginTop: '.5rem' }}>
                        ⚠️ El archivo tiene {txtInfo.total} claves. Se cargarán las primeras 50 (límite por lote).
                        Divide la importación en varios lotes.
                      </div>
                    )}
                    <button
                      className="btn-primary"
                      style={{ marginTop: '1rem' }}
                      onClick={() => {
                        const clavesLote = txtInfo.claves.slice(0, 50);
                        setTextareaClaves(clavesLote.join('\n'));
                        handleTabChange('claves');
                        toast.success(`${clavesLote.length} clave(s) cargadas en el panel de claves. Haz clic en "Consultar".`);
                      }}
                    >
                      Cargar {Math.min(txtInfo.total, 50)} claves → Continuar importación
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB ZIP ───────────────────────────────────────── */}
      {tab === 'zip' && (
        <div className="buzon-card">
          <div className="buzon-step">
            <h2 className="buzon-step-title">Importar desde ZIP</h2>
            <p className="buzon-step-hint">Sube un archivo <strong>.zip</strong> con los XMLs descargados del portal SRI. Máximo 50 archivos XML.</p>
            <DropZone
              accept=".zip"
              icon="🗜️"
              label="Arrastra o selecciona el archivo ZIP"
              sublabel="Acepta .zip con XMLs del portal SRI"
              files={archivoZip ? [archivoZip] : []}
              onChange={([f]) => { setArchivoZip(f || null); setResumenZip(null); }}
            />
            <div className="buzon-opciones">
              <strong>Opciones para facturas:</strong>
              <label><input type="checkbox" checked={opciones.registraInventario} onChange={(e) => setOpciones((p) => ({ ...p, registraInventario: e.target.checked }))} /> Registrar entrada de inventario</label>
              <label><input type="checkbox" checked={opciones.creaProductos} onChange={(e) => setOpciones((p) => ({ ...p, creaProductos: e.target.checked }))} /> Crear productos faltantes</label>
              <label><input type="checkbox" checked={opciones.registraCaja} onChange={(e) => setOpciones((p) => ({ ...p, registraCaja: e.target.checked }))} /> Registrar egreso en caja</label>
            </div>
            <div className="buzon-step-actions">
              <button className="btn-primary" onClick={importarZip} disabled={importandoZip || !archivoZip}>
                {importandoZip ? 'Procesando ZIP...' : 'Importar ZIP'}
              </button>
            </div>
            {resumenZip && (
              <div className="buzon-zip-resultado">
                <div className="buzon-resumen">
                  <div className="buzon-resumen-card buzon-resumen--verde"><span>{resumenZip.resumen?.creados || 0}</span><small>Importados</small></div>
                  <div className="buzon-resumen-card buzon-resumen--gris"><span>{resumenZip.resumen?.omitidos || 0}</span><small>Ya existían</small></div>
                  <div className="buzon-resumen-card buzon-resumen--rojo"><span>{resumenZip.resumen?.errores || 0}</span><small>Con error</small></div>
                </div>
                {resumenZip.resultados?.length > 0 && (
                  <div className="buzon-errores-list" style={{ marginTop: '.75rem' }}>
                    <strong style={{ fontSize: '.82rem', color: '#475569' }}>Detalle por archivo:</strong>
                    {resumenZip.resultados.map((r) => {
                      const color = r.estado === 'creado' ? '#16a34a' : r.estado === 'omitido' ? '#64748b' : '#dc2626';
                      const icon  = r.estado === 'creado' ? '✅' : r.estado === 'omitido' ? '⏭' : '❌';
                      return (
                        <div key={r.clave || r.archivo} className="buzon-error-item" style={{ color }}>
                          {icon} <code>{r.archivo}</code>
                          {r.tipo && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>{r.tipo}</span>}
                          {r.estado === 'omitido' && <span style={{ marginLeft: 6 }}>— Ya existía</span>}
                          {r.estado === 'error' && <span style={{ marginLeft: 6 }}>— {r.error}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB XML ───────────────────────────────────────── */}
      {tab === 'xml' && (
        <div className="buzon-card">
          <div className="buzon-step">
            <h2 className="buzon-step-title">Importar archivos XML</h2>
            <p className="buzon-step-hint">
              Sube uno o varios archivos <strong>.xml</strong> descargados individualmente desde el portal SRI.
              Admite facturas, liquidaciones, retenciones y notas de crédito/débito. Máximo {50} archivos.
            </p>
            <DropZone
              accept=".xml"
              multiple
              icon="📋"
              label="Arrastra o selecciona archivos XML"
              sublabel="Acepta múltiples .xml del portal SRI (máx. 50)"
              files={archivosXml}
              onChange={(fs) => { setArchivosXml(fs); setResumenXml(null); }}
            />
            {archivosXml.length > 0 && (
              <ul className="buzon-xml-lista">
                {archivosXml.map((f, i) => <li key={i}>📄 {f.name}</li>)}
              </ul>
            )}
            <div className="buzon-opciones">
              <strong>Opciones para facturas:</strong>
              <label><input type="checkbox" checked={opciones.registraInventario} onChange={(e) => setOpciones((p) => ({ ...p, registraInventario: e.target.checked }))} /> Registrar entrada de inventario</label>
              <label><input type="checkbox" checked={opciones.creaProductos} onChange={(e) => setOpciones((p) => ({ ...p, creaProductos: e.target.checked }))} /> Crear productos faltantes</label>
              <label><input type="checkbox" checked={opciones.registraCaja} onChange={(e) => setOpciones((p) => ({ ...p, registraCaja: e.target.checked }))} /> Registrar egreso en caja</label>
            </div>
            <div className="buzon-step-actions">
              <button className="btn-primary" onClick={importarXml} disabled={importandoXml || archivosXml.length === 0}>
                {importandoXml ? 'Procesando XML...' : `Importar ${archivosXml.length || ''} XML`}
              </button>
            </div>
            {resumenXml && (
              <div className="buzon-zip-resultado">
                <div className="buzon-resumen">
                  <div className="buzon-resumen-card buzon-resumen--verde"><span>{resumenXml.resumen?.creados || 0}</span><small>Importados</small></div>
                  <div className="buzon-resumen-card buzon-resumen--gris"><span>{resumenXml.resumen?.omitidos || 0}</span><small>Ya existían</small></div>
                  <div className="buzon-resumen-card buzon-resumen--rojo"><span>{resumenXml.resumen?.errores || 0}</span><small>Con error</small></div>
                </div>
                {resumenXml.resultados?.length > 0 && (
                  <div className="buzon-errores-list" style={{ marginTop: '.75rem' }}>
                    <strong style={{ fontSize: '.82rem', color: '#475569' }}>Detalle por archivo:</strong>
                    {resumenXml.resultados.map((r, i) => {
                      const color = r.estado === 'creado' ? '#16a34a' : r.estado === 'omitido' ? '#64748b' : '#dc2626';
                      const icon  = r.estado === 'creado' ? '✅' : r.estado === 'omitido' ? '⏭' : '❌';
                      return (
                        <div key={i} className="buzon-error-item" style={{ color }}>
                          {icon} <code>{r.archivo}</code>
                          {r.tipo && <span style={{ marginLeft: 6, fontStyle: 'italic' }}>{r.tipo}</span>}
                          {r.estado === 'omitido' && <span style={{ marginLeft: 6 }}>— Ya existía</span>}
                          {r.estado === 'error' && <span style={{ marginLeft: 6 }}>— {r.error}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB HISTORIAL ─────────────────────────────────── */}
      {tab === 'historial' && (
        <div className="buzon-card">
          {cargandoHistorial ? (
            <div className="buzon-loading">Cargando historial...</div>
          ) : historial ? (
            <div className="buzon-historial">
              <section>
                <h3>Facturas / Liquidaciones recibidas (via Buzón)</h3>
                {historial.facturas?.length > 0 ? (
                  <table className="buzon-hist-table">
                    <thead><tr><th>N° Factura</th><th>Proveedor</th><th>Fecha</th><th>Total</th></tr></thead>
                    <tbody>{historial.facturas.map((f) => (
                      <tr key={f.id}>
                        <td>{f.numeroFactura}</td>
                        <td>{f.razonSocialProveedor}</td>
                        <td>{formatFechaCorta(f.fechaEmision)}</td>
                        <td>${Number(f.importeTotal || 0).toFixed(2)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="buzon-empty">Sin facturas importadas por Buzón SRI.</p>}
              </section>

              <section>
                <h3>Retenciones recibidas</h3>
                {historial.retenciones?.length > 0 ? (
                  <table className="buzon-hist-table">
                    <thead><tr><th>Agente de Retención</th><th>Fecha</th><th>Ret. IVA</th><th>Ret. Renta</th></tr></thead>
                    <tbody>{historial.retenciones.map((r) => (
                      <tr key={r.id}>
                        <td>{r.razonSocialAgente}</td>
                        <td>{formatFechaCorta(r.fechaEmision)}</td>
                        <td>${Number(r.totalRetencionIva || 0).toFixed(2)}</td>
                        <td>${Number(r.totalRetencionRenta || 0).toFixed(2)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="buzon-empty">Sin retenciones recibidas registradas.</p>}
              </section>

              <section>
                <h3>Notas de Crédito / Débito recibidas</h3>
                {historial.docsOtros?.length > 0 ? (
                  <table className="buzon-hist-table">
                    <thead><tr><th>Tipo</th><th>Emisor</th><th>Fecha</th><th>Total</th></tr></thead>
                    <tbody>{historial.docsOtros.map((d) => (
                      <tr key={d.id}>
                        <td>{d.tipoDescripcion}</td>
                        <td>{d.razonSocialEmisor}</td>
                        <td>{formatFechaCorta(d.fechaEmision)}</td>
                        <td>${Number(d.importeTotal || 0).toFixed(2)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                ) : <p className="buzon-empty">Sin notas de crédito/débito registradas.</p>}
              </section>

              <div className="buzon-historial-actions">
                <button className="btn-secondary" onClick={cargarHistorial}>↺ Actualizar</button>
              </div>
            </div>
          ) : (
            <p className="buzon-empty">No se pudo cargar el historial.</p>
          )}
        </div>
      )}
    </div>
  );
}
