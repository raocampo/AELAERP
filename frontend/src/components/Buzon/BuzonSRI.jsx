import { useState, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import AuthContext from '../../context/auth-context';
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
  try { return new Date(fechaStr).toLocaleDateString('es-EC'); } catch { return fechaStr; }
}

// Helper: hoy y hace 30 días en formato yyyy-mm-dd
function hoyISO() { return new Date().toISOString().slice(0, 10); }
function hace30DiasISO() {
  const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
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

async function consultarSriAutomatico(payload) {
  // Endpoint principal: scraper Puppeteer
  return api.post('/buzon/sri-scraper/consultar', payload);
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

  const [historial, setHistorial] = useState(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const parsearClaves = () => textareaClaves
    .split(/[\n,;]+/)
    .map((c) => c.replace(/\s+/g, '').trim())
    .filter((c) => c.length === 49);

  const consultarClaves = async () => {
    const claves = parsearClaves();
    if (claves.length === 0) { toast.error('Ingresa al menos una clave de acceso válida (49 dígitos)'); return; }
    if (claves.length > 50) { toast.error('Máximo 50 claves por lote'); return; }
    setConsultando(true);
    try {
      const res = await api.post('/buzon/consultar', { claves });
      const resultados = res.data?.resultados || [];
      setResultadosConsulta(resultados);
      setSeleccionados(new Set(resultados.filter((r) => r.estado === 'nuevo').map((r) => r.clave)));
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

  const reiniciar = () => { setTextareaClaves(''); setResultadosConsulta([]); setSeleccionados(new Set()); setResumenImport(null); setPaso(1); };

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
    try {
      const res = await consultarSriAutomatico({
        identificacion: dmIdentificacion.trim(),
        password:       dmPassword,
        fechaDesde:     dmFechaDesde,
        fechaHasta:     dmFechaHasta,
        tipoComprobante: dmTipo,
      });
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
      </div>

      <div className="buzon-tabs-bar">
        <button className={`buzon-tab ${tab === 'descarga' ? 'active' : ''}`} onClick={() => handleTabChange('descarga')}>Descarga automática SRI</button>
        <button className={`buzon-tab ${tab === 'claves' ? 'active' : ''}`} onClick={() => handleTabChange('claves')}>Por claves de acceso</button>
        <button className={`buzon-tab ${tab === 'zip' ? 'active' : ''}`} onClick={() => handleTabChange('zip')}>Importar ZIP</button>
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
                  {dmConsultando ? '🤖 Navegando el portal SRI... (puede tardar ~60 s)' : 'Consultar portal SRI →'}
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

      {/* ── TAB ZIP ───────────────────────────────────────── */}
      {tab === 'zip' && (
        <div className="buzon-card">
          <div className="buzon-step">
            <h2 className="buzon-step-title">Importar desde ZIP</h2>
            <p className="buzon-step-hint">Sube un archivo <strong>.zip</strong> con los XMLs descargados del portal SRI. Máximo 50 archivos XML.</p>
            <div className="buzon-upload-area">
              <label className="buzon-upload-label" htmlFor="zip-input">
                {archivoZip ? `📄 ${archivoZip.name}` : '📁 Haz clic para seleccionar archivo ZIP'}
              </label>
              <input id="zip-input" type="file" accept=".zip" style={{ display: 'none' }}
                onChange={(e) => { setArchivoZip(e.target.files[0] || null); setResumenZip(null); }} />
            </div>
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
                {resumenZip.resultados?.some((r) => r.estado === 'error') && (
                  <div className="buzon-errores-list">
                    {resumenZip.resultados.filter((r) => r.estado === 'error').map((r) => (
                      <div key={r.clave || r.archivo} className="buzon-error-item"><code>{r.archivo}</code> — {r.error}</div>
                    ))}
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
                        <td>{new Date(f.fechaEmision).toLocaleDateString('es-EC')}</td>
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
                        <td>{new Date(r.fechaEmision).toLocaleDateString('es-EC')}</td>
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
                        <td>{new Date(d.fechaEmision).toLocaleDateString('es-EC')}</td>
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
