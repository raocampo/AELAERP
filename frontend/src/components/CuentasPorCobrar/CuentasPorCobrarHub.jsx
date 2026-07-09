import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import '../Bancos/Bancos.css';

const METODOS_PAGO = ['efectivo', 'transferencia', 'cheque', 'tarjeta'];

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      await api.post('/cxc/cobros', { ...form, facturaId: factura.id });
      onSaved();
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
        <div style={{ display: 'grid', gridTemplateColumns: clienteSeleccionado ? '280px 1fr' : '1fr', gap: '1rem' }}>
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

// ─── CuentasPorCobrarHub — componente principal ─────────────────
export default function CuentasPorCobrarHub() {
  const [tabActivo, setTabActivo] = useState('vigentes');
  const [modalCobro, setModalCobro] = useState(null);
  const [refresco, setRefresco] = useState(0);

  const tabs = [
    { id: 'vigentes',   label: 'Cuentas vigentes' },
    { id: 'canceladas', label: 'Cuentas canceladas' },
    { id: 'historial',  label: 'Historial de cobros' },
    { id: 'cheques',    label: 'Cheques' },
    { id: 'ordenes',    label: 'Órdenes de pago' },
    { id: 'recibos',    label: 'Recibos' },
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
      {tabActivo === 'cheques'    && <TabChequesRecibidos key={`chq-${refresco}`} />}
      {tabActivo === 'ordenes'    && <TabProximamente nombre="Órdenes de pago" />}
      {tabActivo === 'recibos'    && <TabProximamente nombre="Recibos" />}
      {tabActivo === 'importar'   && <TabProximamente nombre="Importar cobros" />}
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
