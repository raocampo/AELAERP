import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import { abrirBlobEnNuevaPestana, descargarExcel } from '../../utils/exportCsv';
import '../Bancos/Bancos.css';

const METODOS_PAGO = ['efectivo', 'transferencia', 'cheque', 'tarjeta'];

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Abrir PDF (recibo) en nueva pestaña, con auth ────────────────────────────
async function abrirRecibo(cobroId) {
  try {
    await abrirBlobEnNuevaPestana(api, `/cxc/cobros/${cobroId}/recibo`);
  } catch {
    alert('No se pudo generar el recibo');
  }
}

function useBancos() {
  const [bancos, setBancos] = useState([]);
  useEffect(() => {
    api.get('/bancos').then((r) => setBancos(r.data?.data || [])).catch(() => {});
  }, []);
  return bancos;
}

// ─── Modal Registrar Cobro ────────────────────────────────────
function ModalCobro({ factura, onClose, onSaved }) {
  const [form, setForm] = useState({
    monto: String(factura.saldoPendiente),
    metodoPago: 'efectivo',
    fecha: new Date().toISOString().slice(0, 10),
    bancoId: '', chequeId: '', referencia: '', observaciones: '',
  });
  const bancos = useBancos();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const res = await api.post('/cxc/cobros', { ...form, facturaId: factura.id });
      const cobroId = res.data?.data?.id;
      onSaved();
      if (cobroId) abrirRecibo(cobroId);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar el cobro');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal">
        <h2>Registrar Cobro</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted, #64748b)' }}>
          Factura {factura.numeroFactura} — {factura.razonSocialComprador}<br />
          Saldo pendiente: <strong>${formatMoney(factura.saldoPendiente)}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" name="monto" value={form.monto} onChange={handleChange} required max={factura.saldoPendiente} />
            </div>
            <div className="form-group">
              <label>Fecha *</label>
              <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Método de pago *</label>
              <select name="metodoPago" value={form.metodoPago} onChange={handleChange}>
                {METODOS_PAGO.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {form.metodoPago !== 'efectivo' && (
              <div className="form-group">
                <label>Banco</label>
                <select name="bancoId" value={form.bancoId} onChange={handleChange}>
                  <option value="">— Seleccione —</option>
                  {bancos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Referencia</label>
              <input name="referencia" value={form.referencia} onChange={handleChange} placeholder="# transferencia / comprobante" />
            </div>
            <div className="form-group full-col">
              <label>Observaciones</label>
              <input name="observaciones" value={form.observaciones} onChange={handleChange} />
            </div>
          </div>
          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Registrando...' : 'Registrar cobro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab Vigentes / Canceladas ─────────────────────────────────
function TabFacturas({ estado, onCobrar }) {
  const [facturas, setFacturas] = useState([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get(`/cxc/${estado}`);
      setFacturas(r.data?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [estado]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div>
      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando...</p>
      ) : facturas.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">💰</div>
          <p>{estado === 'vigentes' ? 'No hay facturas con saldo pendiente' : 'No hay facturas canceladas'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>Factura</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Cobrado</th>
                <th style={{ textAlign: 'right' }}>N. Créd.</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                {estado === 'vigentes' && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.id}>
                  <td style={{ fontWeight: 600 }}>{f.numeroFactura}</td>
                  <td>{f.razonSocialComprador}</td>
                  <td>{formatFechaCorta(f.fechaEmision)}</td>
                  <td style={{ textAlign: 'right' }}>${formatMoney(f.importeTotal)}</td>
                  <td style={{ textAlign: 'right' }}>${formatMoney(f.cobrado)}</td>
                  <td style={{ textAlign: 'right', color: parseFloat(f.notaCredito || 0) > 0 ? '#dc2626' : undefined }}>
                    {parseFloat(f.notaCredito || 0) > 0 ? `-$${formatMoney(f.notaCredito)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${formatMoney(f.saldoPendiente)}</td>
                  {estado === 'vigentes' && (
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={() => onCobrar(f)}>Registrar cobro</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Historial ──────────────────────────────────────────────
function TabHistorial() {
  const [cobros, setCobros] = useState([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get('/cxc/cobros');
      setCobros(r.data?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const anular = async (id) => {
    const motivo = window.prompt('Motivo de anulación (opcional):') || '';
    if (!window.confirm('¿Anular este cobro? Se generará el reverso contable.')) return;
    try {
      await api.patch(`/cxc/cobros/${id}/anular`, { motivo });
      cargar();
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al anular el cobro');
    }
  };

  return (
    <div>
      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando...</p>
      ) : cobros.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">🧾</div>
          <p>Sin cobros registrados</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>N° Recibo</th>
                <th>Fecha</th>
                <th>Factura</th>
                <th>Método</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cobros.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.numero}</td>
                  <td>{formatFechaCorta(c.fecha)}</td>
                  <td>{c.factura?.numeroFactura} — {c.factura?.razonSocialComprador}</td>
                  <td>{c.metodoPago}{c.banco ? ` (${c.banco.nombre})` : ''}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${formatMoney(c.monto)}</td>
                  <td>{c.anulado ? <span style={{ color: 'var(--color-danger)' }}>Anulado</span> : 'Activo'}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => abrirRecibo(c.id)} style={{ marginRight: 6 }}>🧾 Recibo</button>
                    {!c.anulado && <button className="btn btn-danger btn-sm" onClick={() => anular(c.id)}>Anular</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TabProximamente({ nombre }) {
  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted,#64748b)' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🚧</div>
      <h3 style={{ margin: '0 0 0.5rem', color: '#1e293b' }}>{nombre}</h3>
      <p style={{ margin: 0 }}>Este módulo estará disponible próximamente.</p>
    </div>
  );
}

// ─── Tab Importar Cobros ────────────────────────────────────────
async function _descargarPlantillaCobros() {
  try {
    await descargarExcel(api, '/cxc/cobros/importar/plantilla', {}, 'plantilla-cobros.xlsx');
  } catch {
    alert('No se pudo descargar la plantilla');
  }
}

function TabImportarCobros() {
  const [archivo, setArchivo] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const importar = async () => {
    if (!archivo) return;
    setProcesando(true); setError(''); setResultado(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const res = await api.post('/cxc/cobros/importar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResultado(res.data?.data);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al importar');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="movimientos-section">
      <div style={{ maxWidth: 640 }}>
        <h3 style={{ margin: '0 0 .35rem' }}>Importar cobros desde Excel</h3>
        <p style={{ margin: '0 0 1.25rem', fontSize: '.88rem', color: 'var(--color-text-muted,#64748b)' }}>
          Registra múltiples cobros a la vez subiendo un archivo Excel. Descarga la plantilla, completa las filas y súbela.
        </p>

        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={_descargarPlantillaCobros}>
            ⬇ Descargar plantilla
          </button>
          <span style={{ fontSize: '.82rem', color: 'var(--color-text-muted,#64748b)' }}>
            Columnas: Número Factura, Monto, Fecha, Método de Pago, Referencia, Observaciones
          </span>
        </div>

        <div
          style={{
            border: `2px dashed ${archivo ? '#86efac' : 'var(--color-border,#e2e8f0)'}`,
            borderRadius: '.75rem', padding: '2rem', textAlign: 'center', marginBottom: '1rem',
            cursor: 'pointer', background: archivo ? '#f0fdf4' : 'var(--color-bg-alt,#f8fafc)',
            transition: 'border-color .2s, background .2s',
          }}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={(e) => { setArchivo(e.target.files[0] || null); setResultado(null); setError(''); }}
          />
          {archivo ? (
            <>
              <div style={{ fontSize: '2rem', marginBottom: '.35rem' }}>📄</div>
              <div style={{ fontWeight: 600 }}>{archivo.name}</div>
              <div style={{ fontSize: '.82rem', color: 'var(--color-text-muted,#64748b)' }}>
                {(archivo.size / 1024).toFixed(1)} KB — Clic para cambiar
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '2rem', marginBottom: '.35rem' }}>📁</div>
              <div style={{ fontWeight: 600 }}>Seleccionar archivo</div>
              <div style={{ fontSize: '.82rem', color: 'var(--color-text-muted,#64748b)' }}>.xlsx, .xls, .csv</div>
            </>
          )}
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '.5rem', padding: '.65rem .85rem', marginBottom: '.75rem', color: '#991b1b', fontSize: '.88rem' }}>
            {error}
          </div>
        )}

        <button
          className="btn btn-primary" style={{ width: '100%' }}
          disabled={!archivo || procesando}
          onClick={importar}
        >
          {procesando ? 'Procesando…' : '⬆ Importar cobros'}
        </button>

        {resultado && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 130, padding: '1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '.6rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#16a34a' }}>{resultado.totalExitosas}</div>
                <div style={{ fontSize: '.82rem', color: '#166534' }}>Cobros registrados</div>
              </div>
              {resultado.totalErrores > 0 && (
                <div style={{ flex: 1, minWidth: 130, padding: '1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '.6rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#dc2626' }}>{resultado.totalErrores}</div>
                  <div style={{ fontSize: '.82rem', color: '#991b1b' }}>Filas con error</div>
                </div>
              )}
            </div>

            {resultado.exitosas?.length > 0 && (
              <>
                <h4 style={{ margin: '0 0 .5rem', color: '#16a34a', fontSize: '.95rem' }}>✅ Cobros registrados</h4>
                <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
                  <table className="movimientos-tabla">
                    <thead><tr><th>Fila</th><th>Factura</th><th>N° Recibo</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
                    <tbody>
                      {resultado.exitosas.map((e) => (
                        <tr key={e.fila}>
                          <td>{e.fila}</td>
                          <td>{e.numeroFactura}</td>
                          <td style={{ fontWeight: 600 }}>{e.numero}</td>
                          <td style={{ textAlign: 'right' }}>${formatMoney(e.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {resultado.errores?.length > 0 && (
              <>
                <h4 style={{ margin: '0 0 .5rem', color: '#dc2626', fontSize: '.95rem' }}>❌ Filas con error</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table className="movimientos-tabla">
                    <thead><tr><th>Fila</th><th>Factura</th><th>Monto</th><th>Error</th></tr></thead>
                    <tbody>
                      {resultado.errores.map((e) => (
                        <tr key={e.fila}>
                          <td>{e.fila}</td>
                          <td>{e.numeroFactura}</td>
                          <td style={{ textAlign: 'right' }}>{e.monto ? `$${formatMoney(e.monto)}` : '—'}</td>
                          <td style={{ color: '#dc2626', fontSize: '.85rem' }}>{e.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab Cheques Recibidos ─────────────────────────────────────
const ESTADOS_CHEQUE = ['PENDIENTE', 'DEPOSITADO', 'PROTESTADO', 'ANULADO'];
const ESTADO_COLOR = {
  PENDIENTE: '#2563eb',
  DEPOSITADO: '#16a34a',
  PROTESTADO: '#dc2626',
  ANULADO: '#94a3b8',
};

function ModalCheque({ onClose, onSaved }) {
  const [form, setForm] = useState({
    numero: '', banco: '', monto: '', fecha: new Date().toISOString().slice(0, 10),
    fechaRecepcion: new Date().toISOString().slice(0, 10), fechaDeposito: '',
    clienteNombre: '', observaciones: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post('/cxc/cheques', { ...form, monto: parseFloat(form.monto) });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar el cheque');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal">
        <h2>Registrar Cheque Recibido</h2>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>N° Cheque *</label>
              <input name="numero" value={form.numero} onChange={handleChange} placeholder="Ej: 00123456" required />
            </div>
            <div className="form-group">
              <label>Banco emisor *</label>
              <input name="banco" value={form.banco} onChange={handleChange} placeholder="Ej: Banco Pichincha" required />
            </div>
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" name="monto" value={form.monto} onChange={handleChange} required min="0.01" />
            </div>
            <div className="form-group">
              <label>Fecha del cheque *</label>
              <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Fecha de recepción *</label>
              <input type="date" name="fechaRecepcion" value={form.fechaRecepcion} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Fecha de depósito prevista</label>
              <input type="date" name="fechaDeposito" value={form.fechaDeposito} onChange={handleChange} />
            </div>
            <div className="form-group full-col">
              <label>Cliente / Girador</label>
              <input name="clienteNombre" value={form.clienteNombre} onChange={handleChange} placeholder="Nombre del cliente que emite el cheque" />
            </div>
            <div className="form-group full-col">
              <label>Observaciones</label>
              <input name="observaciones" value={form.observaciones} onChange={handleChange} />
            </div>
          </div>
          {error && <p style={{ color: 'var(--color-danger,#dc2626)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Registrando...' : 'Registrar cheque'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TabChequesRecibidos() {
  const [cheques, setCheques] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('');
  const [modalNuevo, setModalNuevo] = useState(false);
  const [actualizando, setActualizando] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = filtroEstado ? `?estado=${filtroEstado}` : '';
      const r = await api.get(`/cxc/cheques${params}`);
      setCheques(r.data?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarEstado = async (cheque, nuevoEstado) => {
    const confirmMsg = nuevoEstado === 'DEPOSITADO'
      ? `¿Marcar cheque #${cheque.numero} como DEPOSITADO?`
      : nuevoEstado === 'PROTESTADO'
        ? `¿Marcar cheque #${cheque.numero} como PROTESTADO (rebotado)?`
        : `¿Anular cheque #${cheque.numero}?`;
    if (!window.confirm(confirmMsg)) return;
    setActualizando(cheque.id);
    try {
      const extra = nuevoEstado === 'DEPOSITADO' ? { fechaDeposito: new Date().toISOString().slice(0, 10) } : {};
      await api.patch(`/cxc/cheques/${cheque.id}/estado`, { estado: nuevoEstado, ...extra });
      await cargar();
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al actualizar estado');
    } finally {
      setActualizando(null);
    }
  };

  const totalPendiente = cheques.filter((c) => c.estado === 'PENDIENTE').reduce((s, c) => s + c.monto, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.88rem' }}
        >
          <option value="">Todos los estados</option>
          {ESTADOS_CHEQUE.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button className="btn btn-primary" onClick={() => setModalNuevo(true)}>+ Registrar Cheque</button>
        {totalPendiente > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.88rem', color: '#2563eb', fontWeight: 600 }}>
            Pendiente total: ${totalPendiente.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted,#64748b)' }}>Cargando...</p>
      ) : cheques.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">🏦</div>
          <p>No hay cheques registrados{filtroEstado ? ` con estado "${filtroEstado}"` : ''}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>N° Cheque</th>
                <th>Banco</th>
                <th>Cliente / Girador</th>
                <th>Fecha Cheque</th>
                <th>Fecha Depósito</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((c) => (
                <tr key={c.id} style={{ opacity: c.estado === 'ANULADO' ? 0.55 : 1 }}>
                  <td style={{ fontWeight: 600 }}>{c.numero}</td>
                  <td>{c.banco}</td>
                  <td>{c.clienteNombre || '—'}</td>
                  <td>{formatFechaCorta(c.fecha)}</td>
                  <td>{c.fechaDeposito ? formatFechaCorta(c.fechaDeposito) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    ${c.monto.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: ESTADO_COLOR[c.estado] || '#64748b' }}>
                      {c.estado}
                    </span>
                  </td>
                  <td>
                    {c.estado === 'PENDIENTE' && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ marginRight: 4 }}
                          disabled={actualizando === c.id}
                          onClick={() => cambiarEstado(c, 'DEPOSITADO')}
                        >
                          Depositar
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ marginRight: 4 }}
                          disabled={actualizando === c.id}
                          onClick={() => cambiarEstado(c, 'PROTESTADO')}
                        >
                          Protestar
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={actualizando === c.id}
                          onClick={() => cambiarEstado(c, 'ANULADO')}
                        >
                          Anular
                        </button>
                      </>
                    )}
                    {c.estado === 'DEPOSITADO' && (
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={actualizando === c.id}
                        onClick={() => cambiarEstado(c, 'PROTESTADO')}
                      >
                        Marcar protestado
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalNuevo && (
        <ModalCheque
          onClose={() => setModalNuevo(false)}
          onSaved={() => { setModalNuevo(false); cargar(); }}
        />
      )}
    </div>
  );
}

// ─── Tab Reportes CxC ──────────────────────────────────────────
function TabReportesCxC() {
  const [vista, setVista] = useState('antiguedad');
  const [antiguedad, setAntiguedad] = useState(null);
  const [cargandoAnt, setCargandoAnt] = useState(false);
  const [clientesList, setClientesList] = useState([]);
  const [cargandoClientes, setCargandoClientes] = useState(false);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [estadoCuenta, setEstadoCuenta] = useState(null);
  const [cargandoEc, setCargandoEc] = useState(false);

  useEffect(() => {
    if (vista === 'antiguedad' && !antiguedad) {
      setCargandoAnt(true);
      api.get('/cxc/reporte/antiguedad').then((r) => setAntiguedad(r.data?.data || null)).catch(() => {}).finally(() => setCargandoAnt(false));
    }
    if (vista === 'estado-cuenta' && clientesList.length === 0) {
      setCargandoClientes(true);
      api.get('/cxc/reporte/estado-cuenta').then((r) => setClientesList(r.data?.data || [])).catch(() => {}).finally(() => setCargandoClientes(false));
    }
  }, [vista]); // eslint-disable-line

  const verEstadoCuenta = async (cliente) => {
    setClienteSeleccionado(cliente);
    if (!cliente.clienteId) return;
    setCargandoEc(true);
    try {
      const r = await api.get(`/cxc/reporte/estado-cuenta?clienteId=${cliente.clienteId}`);
      setEstadoCuenta(r.data?.data || null);
    } catch (e) { console.error(e); }
    finally { setCargandoEc(false); }
  };

  const RANGOS = [
    { key: 'd0_30', label: '0 – 30 días' },
    { key: 'd31_60', label: '31 – 60 días' },
    { key: 'd61_90', label: '61 – 90 días' },
    { key: 'd91_mas', label: '> 90 días' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button className={`bancos-tab ${vista === 'antiguedad' ? 'active' : ''}`} onClick={() => setVista('antiguedad')}>
          📊 Antigüedad de saldos
        </button>
        <button className={`bancos-tab ${vista === 'estado-cuenta' ? 'active' : ''}`} onClick={() => setVista('estado-cuenta')}>
          📋 Estado de cuenta por cliente
        </button>
      </div>

      {vista === 'antiguedad' && (
        <div>
          {cargandoAnt ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando reporte...</p>
          ) : !antiguedad ? null : (
            <>
              <div className="saldo-resumen" style={{ marginBottom: '1.25rem' }}>
                {RANGOS.map((r) => (
                  <div key={r.key} className="saldo-item">
                    <div className="saldo-item-label">{r.label}</div>
                    <div className="saldo-item-valor" style={{ color: antiguedad.totales[r.key] > 0 ? (r.key === 'd91_mas' ? '#dc2626' : r.key === 'd61_90' ? '#d97706' : '#2563eb') : 'inherit' }}>
                      ${parseFloat(antiguedad.totales[r.key] || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
                <div className="saldo-item">
                  <div className="saldo-item-label">TOTAL</div>
                  <div className="saldo-item-valor" style={{ fontWeight: 800 }}>
                    ${parseFloat(antiguedad.totalGeneral || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {RANGOS.map((r) => antiguedad.detalle[r.key]?.length > 0 && (
                <div key={r.key} style={{ marginBottom: '1.5rem' }}>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.5rem', color: r.key === 'd91_mas' ? '#dc2626' : r.key === 'd61_90' ? '#d97706' : '#1e293b' }}>
                    {r.label} ({antiguedad.detalle[r.key].length} facturas)
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="movimientos-tabla">
                      <thead>
                        <tr>
                          <th>Factura</th><th>Cliente</th><th>Fecha emisión</th><th>Días</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ textAlign: 'right' }}>Cobrado</th>
                          <th style={{ textAlign: 'right' }}>N. Créd.</th>
                          <th style={{ textAlign: 'right' }}>Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {antiguedad.detalle[r.key].map((f) => (
                          <tr key={f.id}>
                            <td style={{ fontWeight: 600 }}>{f.numeroFactura}</td>
                            <td>{f.razonSocialComprador}</td>
                            <td>{formatFechaCorta(f.fechaEmision)}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600, color: r.key === 'd91_mas' ? '#dc2626' : 'inherit' }}>{f.diasVencidos}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(f.importeTotal).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(f.cobrado).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>{parseFloat(f.notaCredito || 0) > 0 ? `-$${parseFloat(f.notaCredito).toFixed(2)}` : '—'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>${parseFloat(f.saldoPendiente).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {vista === 'estado-cuenta' && (
        <div style={{ display: 'grid', gridTemplateColumns: clienteSeleccionado ? 'minmax(180px, 280px) 1fr' : '1fr', gap: '1rem', minWidth: 0 }}>
          <div>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Clientes con saldo</h3>
            {cargandoClientes ? (
              <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.85rem' }}>Cargando...</p>
            ) : clientesList.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.85rem' }}>Sin saldos pendientes</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {clientesList.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => verEstadoCuenta(c)}
                    style={{
                      textAlign: 'left', padding: '0.6rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '6px',
                      background: clienteSeleccionado?.identificacion === c.identificacion ? 'var(--color-primary-50, #eff6ff)' : 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c.razonSocial}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #64748b)' }}>{c.identificacion}</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#2563eb', marginTop: '0.25rem' }}>
                      ${parseFloat(c.saldoTotal).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {clienteSeleccionado && (
            <div>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                Estado de cuenta — {clienteSeleccionado.razonSocial}
              </h3>
              {cargandoEc ? (
                <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.85rem' }}>Cargando...</p>
              ) : estadoCuenta ? (
                <>
                  <h4 style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.4rem', color: '#475569' }}>Facturas</h4>
                  <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                    <table className="movimientos-tabla">
                      <thead>
                        <tr>
                          <th>Factura</th><th>Fecha</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ textAlign: 'right' }}>Cobrado</th>
                          <th style={{ textAlign: 'right' }}>N. Créd.</th>
                          <th style={{ textAlign: 'right' }}>Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estadoCuenta.facturas.map((f) => (
                          <tr key={f.id}>
                            <td style={{ fontWeight: 600 }}>{f.numeroFactura}</td>
                            <td>{formatFechaCorta(f.fechaEmision)}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(f.importeTotal).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(f.cobrado).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>{parseFloat(f.notaCredito || 0) > 0 ? `-$${parseFloat(f.notaCredito).toFixed(2)}` : '—'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: f.saldoPendiente > 0 ? '#2563eb' : '#16a34a' }}>
                              ${parseFloat(f.saldoPendiente).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {estadoCuenta.cobros.length > 0 && (
                    <>
                      <h4 style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.4rem', color: '#475569' }}>Cobros registrados</h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="movimientos-tabla">
                          <thead>
                            <tr><th>N° Recibo</th><th>Fecha</th><th>Método</th><th style={{ textAlign: 'right' }}>Monto</th></tr>
                          </thead>
                          <tbody>
                            {estadoCuenta.cobros.map((c) => (
                              <tr key={c.id}>
                                <td style={{ fontWeight: 600 }}>{c.numero}</td>
                                <td>{formatFechaCorta(c.fecha)}</td>
                                <td>{c.metodoPago}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }} className="monto-debe">
                                  ${parseFloat(c.monto).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab Anticipos de Clientes ───────────────────────────────────
function ModalAnticipo({ onClose, onSaved }) {
  const [form, setForm] = useState({
    nombreCliente: '', monto: '', fecha: new Date().toISOString().slice(0, 10),
    metodoPago: 'efectivo', referencia: '', observaciones: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post('/anticipos/clientes', { ...form, monto: parseFloat(form.monto) });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar el anticipo');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal" style={{ maxWidth: 480 }}>
        <div className="bancos-modal-header">
          <h3>Registrar anticipo de cliente</h3>
          <button className="bancos-modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Cliente *</label>
            <input name="nombreCliente" value={form.nombreCliente} onChange={handleChange}
              placeholder="Nombre o razón social" required
              style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Monto *</label>
              <input name="monto" type="number" min="0.01" step="0.01" value={form.monto} onChange={handleChange} required
                placeholder="0.00"
                style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Fecha *</label>
              <input name="fecha" type="date" value={form.fecha} onChange={handleChange} required
                style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Método de pago *</label>
            <select name="metodoPago" value={form.metodoPago} onChange={handleChange} required
              style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', boxSizing: 'border-box' }}>
              {METODOS_PAGO.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Referencia</label>
            <input name="referencia" value={form.referencia} onChange={handleChange}
              placeholder="N° transferencia, cheque…"
              style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Observaciones</label>
            <textarea name="observaciones" value={form.observaciones} onChange={handleChange} rows={2}
              style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          {error && <p style={{ margin: 0, color: '#dc2626', fontSize: '.85rem' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '.25rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn btn-primary">
              {guardando ? 'Registrando…' : 'Registrar anticipo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalAnularAnticipo({ anticipo, endpoint, onClose, onSaved }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.patch(`${endpoint}/${anticipo.id}/anular`, { motivo });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo anular');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal" style={{ maxWidth: 400 }}>
        <div className="bancos-modal-header">
          <h3>Anular anticipo {anticipo.numero}</h3>
          <button className="bancos-modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <p style={{ margin: 0, fontSize: '.9rem' }}>
            Se anulará el anticipo de <strong>${formatMoney(anticipo.monto)}</strong> de <strong>{anticipo.nombreCliente || anticipo.nombreProveedor}</strong> y se revertirá el asiento contable.
          </p>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Motivo de anulación</label>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
              style={{ width: '100%', padding: '.45rem .6rem', border: '1px solid #cbd5e1', borderRadius: '.4rem', fontSize: '.9rem', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          {error && <p style={{ margin: 0, color: '#dc2626', fontSize: '.85rem' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
            <button type="submit" disabled={guardando} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: '.4rem', padding: '.45rem 1rem', cursor: 'pointer', fontSize: '.9rem' }}>
              {guardando ? 'Anulando…' : 'Anular anticipo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TabAnticiposCliente() {
  const [anticipos, setAnticipos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [verTodos, setVerTodos] = useState(false);
  const [modalRegistrar, setModalRegistrar] = useState(false);
  const [modalAnular, setModalAnular] = useState(null);
  const [refresco, setRefresco] = useState(0);

  useEffect(() => {
    setCargando(true);
    api.get(`/anticipos/clientes${verTodos ? '/historial' : ''}`)
      .then((r) => setAnticipos(r.data?.data || []))
      .catch(() => setAnticipos([]))
      .finally(() => setCargando(false));
  }, [verTodos, refresco]);

  const totalSaldo = anticipos.reduce((s, a) => s + parseFloat(a.saldoPendiente || 0), 0);

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Anticipos de clientes</h3>
          {!verTodos && anticipos.length > 0 && (
            <p style={{ margin: '.2rem 0 0', fontSize: '.82rem', color: '#64748b' }}>
              {anticipos.length} anticipo{anticipos.length !== 1 ? 's' : ''} con saldo — Total: <strong>${formatMoney(totalSaldo)}</strong>
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" style={{ fontSize: '.82rem' }} onClick={() => setVerTodos((v) => !v)}>
            {verTodos ? 'Solo pendientes' : 'Ver historial'}
          </button>
          <button className="btn btn-primary" onClick={() => setModalRegistrar(true)}>+ Nuevo anticipo</button>
        </div>
      </div>

      {cargando ? (
        <p style={{ color: '#94a3b8', fontSize: '.9rem' }}>Cargando…</p>
      ) : anticipos.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '.6rem' }}>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '.9rem' }}>
            {verTodos ? 'No hay anticipos registrados' : 'No hay anticipos con saldo pendiente'}
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>N° Anticipo</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Método</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {anticipos.map((a) => (
                <tr key={a.id} style={{ opacity: a.anulado ? 0.5 : 1 }}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{a.numero}</td>
                  <td>{a.nombreCliente}</td>
                  <td>{formatFechaCorta(a.fecha)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{a.metodoPago}</td>
                  <td style={{ textAlign: 'right' }}>${formatMoney(a.monto)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: parseFloat(a.saldoPendiente) > 0 ? '#16a34a' : '#94a3b8' }}>
                    ${formatMoney(a.saldoPendiente)}
                  </td>
                  <td>
                    {a.anulado
                      ? <span style={{ background: '#fef2f2', color: '#991b1b', borderRadius: '999px', padding: '.1rem .6rem', fontSize: '.78rem', fontWeight: 600 }}>Anulado</span>
                      : parseFloat(a.saldoPendiente) <= 0
                        ? <span style={{ background: '#f0fdf4', color: '#166534', borderRadius: '999px', padding: '.1rem .6rem', fontSize: '.78rem', fontWeight: 600 }}>Aplicado</span>
                        : <span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: '999px', padding: '.1rem .6rem', fontSize: '.78rem', fontWeight: 600 }}>Pendiente</span>
                    }
                  </td>
                  <td>
                    {!a.anulado && (
                      <button onClick={() => setModalAnular(a)}
                        style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: '.35rem', padding: '.2rem .6rem', fontSize: '.78rem', cursor: 'pointer' }}>
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalRegistrar && (
        <ModalAnticipo
          onClose={() => setModalRegistrar(false)}
          onSaved={() => { setModalRegistrar(false); setRefresco((n) => n + 1); }}
        />
      )}
      {modalAnular && (
        <ModalAnularAnticipo
          anticipo={modalAnular}
          endpoint="/anticipos/clientes"
          onClose={() => setModalAnular(null)}
          onSaved={() => { setModalAnular(null); setRefresco((n) => n + 1); }}
        />
      )}
    </div>
  );
}

// ─── CuentasPorCobrarHub — componente principal ─────────────────
export default function CuentasPorCobrarHub() {
  const [tabActivo, setTabActivo] = useState('vigentes');
  const [modalCobro, setModalCobro] = useState(null);
  const [refresco, setRefresco] = useState(0);

  const tabs = [
    { id: 'vigentes',   label: 'Cuentas vigentes' },
    { id: 'canceladas', label: 'Cuentas canceladas' },
    { id: 'historial',  label: 'Historial de cobros' },
    { id: 'anticipos',  label: 'Anticipos' },
    { id: 'cheques',    label: 'Cheques' },
    { id: 'ordenes',    label: 'Órdenes de pago' },
    { id: 'importar',   label: 'Importar' },
    { id: 'reportes',   label: 'Reportes' },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="bancos-header">
        <h1>💰 Cuentas por Cobrar</h1>
      </div>

      <div className="bancos-tabs" style={{ flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.id} className={`bancos-tab ${tabActivo === t.id ? 'active' : ''}`} onClick={() => setTabActivo(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tabActivo === 'vigentes'   && <TabFacturas estado="vigentes"   onCobrar={setModalCobro} key={`vig-${refresco}`} />}
      {tabActivo === 'canceladas' && <TabFacturas estado="canceladas" key={`can-${refresco}`} />}
      {tabActivo === 'historial'  && <TabHistorial key={`hist-${refresco}`} />}
      {tabActivo === 'anticipos'  && <TabAnticiposCliente key={`ant-${refresco}`} />}
      {tabActivo === 'cheques'    && <TabChequesRecibidos key={`chq-${refresco}`} />}
      {tabActivo === 'ordenes'    && <TabProximamente nombre="Órdenes de pago" />}
      {tabActivo === 'importar'   && <TabImportarCobros key={`imp-${refresco}`} />}
      {tabActivo === 'reportes'   && <TabReportesCxC />}

      {modalCobro && (
        <ModalCobro
          factura={modalCobro}
          onClose={() => setModalCobro(null)}
          onSaved={() => { setModalCobro(null); setRefresco((n) => n + 1); }}
        />
      )}
    </div>
  );
}
