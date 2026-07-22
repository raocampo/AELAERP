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

// ─── Modal Registrar Pago ─────────────────────────────────────
function ModalPago({ compra, onClose, onSaved }) {
  const [form, setForm] = useState({
    monto: String(compra.saldoPendiente),
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
      await api.post('/cxp/pagos', { ...form, compraId: compra.id });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar el pago');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal">
        <h2>Registrar Pago</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted, #64748b)' }}>
          Compra {compra.numeroFactura} — {compra.razonSocialProveedor}<br />
          Saldo pendiente: <strong>${formatMoney(compra.saldoPendiente)}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" name="monto" value={form.monto} onChange={handleChange} required max={compra.saldoPendiente} />
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
              {guardando ? 'Registrando...' : 'Registrar pago'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab Vigentes / Canceladas ─────────────────────────────────
function TabCompras({ estado, onPagar }) {
  const [compras, setCompras] = useState([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get(`/cxp/${estado}`);
      setCompras(r.data?.data || []);
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
      ) : compras.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">💳</div>
          <p>{estado === 'vigentes' ? 'No hay compras con saldo pendiente' : 'No hay compras canceladas'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>Compra</th>
                <th>Proveedor</th>
                <th>Fecha</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th style={{ textAlign: 'right' }}>Pagado</th>
                <th style={{ textAlign: 'right' }}>N. Créd.</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                {estado === 'vigentes' && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.numeroFactura}</td>
                  <td>{c.razonSocialProveedor}</td>
                  <td>{formatFechaCorta(c.fechaEmision)}</td>
                  <td style={{ textAlign: 'right' }}>${formatMoney(c.importeTotal)}</td>
                  <td style={{ textAlign: 'right' }}>${formatMoney(c.pagado)}</td>
                  <td style={{ textAlign: 'right', color: parseFloat(c.notaCredito || 0) > 0 ? '#dc2626' : undefined }}>
                    {parseFloat(c.notaCredito || 0) > 0 ? `-$${formatMoney(c.notaCredito)}` : '—'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${formatMoney(c.saldoPendiente)}</td>
                  {estado === 'vigentes' && (
                    <td>
                      <button className="btn btn-primary btn-sm" onClick={() => onPagar(c)}>Registrar pago</button>
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
  const [pagos, setPagos] = useState([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get('/cxp/pagos');
      setPagos(r.data?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const anular = async (id) => {
    const motivo = window.prompt('Motivo de anulación (opcional):') || '';
    if (!window.confirm('¿Anular este pago? Se generará el reverso contable.')) return;
    try {
      await api.patch(`/cxp/pagos/${id}/anular`, { motivo });
      cargar();
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al anular el pago');
    }
  };

  return (
    <div>
      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando...</p>
      ) : pagos.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">🧾</div>
          <p>Sin pagos registrados</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>N° Orden de pago</th>
                <th>Fecha</th>
                <th>Compra</th>
                <th>Método</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.numero}</td>
                  <td>{formatFechaCorta(p.fecha)}</td>
                  <td>{p.compra?.numeroFactura} — {p.compra?.razonSocialProveedor}</td>
                  <td>{p.metodoPago}{p.banco ? ` (${p.banco.nombre})` : ''}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${formatMoney(p.monto)}</td>
                  <td>{p.anulado ? <span style={{ color: 'var(--color-danger)' }}>Anulado</span> : 'Activo'}</td>
                  <td>
                    {!p.anulado && <button className="btn btn-danger btn-sm" onClick={() => anular(p.id)}>Anular</button>}
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

// ─── Tab Tarjetas de Crédito ────────────────────────────────────
function ModalNuevaTarjeta({ onClose, onSaved }) {
  const [form, setForm] = useState({ nombre: '', numero: '', banco: '', limiteCredito: '', corte: '20', vencimientoPago: '10' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post('/cxp/tarjetas', form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal">
        <h2>Nueva Tarjeta de Crédito</h2>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group full-col">
              <label>Nombre / Descripción *</label>
              <input name="nombre" value={form.nombre} onChange={handleChange} placeholder="Ej: Visa Corporativa Pichincha" required />
            </div>
            <div className="form-group">
              <label>Banco emisor *</label>
              <input name="banco" value={form.banco} onChange={handleChange} placeholder="Ej: Banco Pichincha" required />
            </div>
            <div className="form-group">
              <label>Últimos 4 dígitos</label>
              <input name="numero" value={form.numero} onChange={handleChange} placeholder="1234" maxLength={4} />
            </div>
            <div className="form-group">
              <label>Límite de crédito</label>
              <input type="number" step="0.01" name="limiteCredito" value={form.limiteCredito} onChange={handleChange} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Día de corte</label>
              <input type="number" name="corte" value={form.corte} onChange={handleChange} min="1" max="31" />
            </div>
            <div className="form-group">
              <label>Día de pago</label>
              <input type="number" name="vencimientoPago" value={form.vencimientoPago} onChange={handleChange} min="1" max="31" />
            </div>
          </div>
          {error && <p style={{ color: 'var(--color-danger,#dc2626)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar tarjeta'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalMovimiento({ tarjeta, onClose, onSaved }) {
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10), concepto: '', monto: '', tipo: 'CARGO', referencia: '', observaciones: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post(`/cxp/tarjetas/${tarjeta.id}/movimientos`, { ...form, monto: parseFloat(form.monto) });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal">
        <h2>Registrar Movimiento</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted,#64748b)' }}>
          {tarjeta.nombre} — {tarjeta.banco} {tarjeta.numero !== '****' ? `**** ${tarjeta.numero}` : ''}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>Tipo *</label>
              <select name="tipo" value={form.tipo} onChange={handleChange}>
                <option value="CARGO">CARGO (gasto)</option>
                <option value="PAGO">PAGO (abono tarjeta)</option>
                <option value="NOTA_CREDITO">NOTA DE CRÉDITO</option>
              </select>
            </div>
            <div className="form-group">
              <label>Fecha *</label>
              <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
            </div>
            <div className="form-group full-col">
              <label>Concepto *</label>
              <input name="concepto" value={form.concepto} onChange={handleChange} required placeholder="Descripción del movimiento" />
            </div>
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" name="monto" value={form.monto} onChange={handleChange} required min="0.01" />
            </div>
            <div className="form-group">
              <label>Referencia</label>
              <input name="referencia" value={form.referencia} onChange={handleChange} placeholder="# comprobante" />
            </div>
            <div className="form-group full-col">
              <label>Observaciones</label>
              <input name="observaciones" value={form.observaciones} onChange={handleChange} />
            </div>
          </div>
          {error && <p style={{ color: 'var(--color-danger,#dc2626)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Registrando...' : 'Registrar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TabTarjetasCredito() {
  const [tarjetas, setTarjetas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [modalNueva, setModalNueva] = useState(false);
  const [modalMov, setModalMov] = useState(null);
  const [movimientos, setMovimientos] = useState({});
  const [expandida, setExpandida] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get('/cxp/tarjetas');
      setTarjetas(r.data?.data || []);
    } catch (e) { console.error(e); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const verMovimientos = async (t) => {
    if (expandida === t.id) { setExpandida(null); return; }
    setExpandida(t.id);
    if (!movimientos[t.id]) {
      try {
        const r = await api.get(`/cxp/tarjetas/${t.id}/movimientos`);
        setMovimientos((prev) => ({ ...prev, [t.id]: r.data?.data || [] }));
      } catch (e) { console.error(e); }
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={() => setModalNueva(true)}>+ Nueva Tarjeta</button>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted,#64748b)' }}>Cargando...</p>
      ) : tarjetas.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">💳</div>
          <p>No hay tarjetas de crédito registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {tarjetas.map((t) => (
            <div key={t.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.9rem 1.25rem', background: t.activa ? '#f8fafc' : '#f1f5f9', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.97rem', color: '#1e293b' }}>{t.nombre}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>
                    {t.banco}{t.numero !== '****' ? ` — **** ${t.numero}` : ''} · Corte día {t.corte} · Pago día {t.vencimientoPago}
                  </div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 120 }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Saldo pendiente</div>
                  <div style={{ fontWeight: 800, color: t.saldo > 0 ? '#dc2626' : '#16a34a' }}>
                    ${t.saldo.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  {t.limiteCredito > 0 && (
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Límite: ${t.limiteCredito.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setModalMov(t)}>+ Movimiento</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => verMovimientos(t)}>
                    {expandida === t.id ? 'Ocultar' : 'Ver movimientos'}
                  </button>
                </div>
              </div>

              {expandida === t.id && (
                <div style={{ padding: '0.75rem 1.25rem 1rem', overflowX: 'auto' }}>
                  {(movimientos[t.id] || []).length === 0 ? (
                    <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Sin movimientos registrados</p>
                  ) : (
                    <table className="movimientos-tabla">
                      <thead>
                        <tr>
                          <th>Fecha</th><th>Concepto</th><th>Tipo</th>
                          <th style={{ textAlign: 'right' }}>Monto</th>
                          <th>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(movimientos[t.id] || []).map((m) => (
                          <tr key={m.id}>
                            <td>{formatFechaCorta(m.fecha)}</td>
                            <td>{m.concepto}</td>
                            <td><span style={{ color: m.tipo === 'CARGO' ? '#dc2626' : '#16a34a', fontWeight: 600, fontSize: '0.8rem' }}>{m.tipo}</span></td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: m.tipo === 'CARGO' ? '#dc2626' : '#16a34a' }}>
                              {m.tipo === 'CARGO' ? '+' : '-'}${m.monto.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{m.estado}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalNueva && (
        <ModalNuevaTarjeta
          onClose={() => setModalNueva(false)}
          onSaved={() => { setModalNueva(false); cargar(); }}
        />
      )}
      {modalMov && (
        <ModalMovimiento
          tarjeta={modalMov}
          onClose={() => setModalMov(null)}
          onSaved={() => {
            setMovimientos((prev) => { const n = { ...prev }; delete n[modalMov.id]; return n; });
            setModalMov(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

// ─── Tab Libro Tarjetas ─────────────────────────────────────────
function TabLibroTarjetas() {
  const [tarjetas, setTarjetas] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState({ tarjetaId: '', tipo: '', desde: '', hasta: '' });

  useEffect(() => {
    api.get('/cxp/tarjetas').then((r) => setTarjetas(r.data?.data || [])).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtros.tarjetaId) params.set('tarjetaId', filtros.tarjetaId);
      if (filtros.tipo)      params.set('tipo', filtros.tipo);
      if (filtros.desde)     params.set('desde', filtros.desde);
      if (filtros.hasta)     params.set('hasta', filtros.hasta);
      const r = await api.get(`/cxp/libro-tarjetas?${params.toString()}`);
      setMovimientos(r.data?.data || []);
    } catch (e) { console.error(e); }
    finally { setCargando(false); }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const totalCargos = movimientos.filter((m) => m.tipo === 'CARGO').reduce((s, m) => s + m.monto, 0);
  const totalPagos  = movimientos.filter((m) => m.tipo !== 'CARGO').reduce((s, m) => s + m.monto, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={filtros.tarjetaId}
          onChange={(e) => setFiltros((f) => ({ ...f, tarjetaId: e.target.value }))}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.88rem' }}
        >
          <option value="">Todas las tarjetas</option>
          {tarjetas.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
        <select
          value={filtros.tipo}
          onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value }))}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.88rem' }}
        >
          <option value="">Todos los tipos</option>
          <option value="CARGO">CARGOS</option>
          <option value="PAGO">PAGOS</option>
          <option value="NOTA_CREDITO">NOTAS DE CRÉDITO</option>
        </select>
        <input type="date" value={filtros.desde} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.88rem' }} />
        <input type="date" value={filtros.hasta} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '0.88rem' }} />

        {(totalCargos > 0 || totalPagos > 0) && (
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#64748b' }}>
            Cargos: <strong style={{ color: '#dc2626' }}>${totalCargos.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            {' · '}
            Pagos: <strong style={{ color: '#16a34a' }}>${totalPagos.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            {' · '}
            Saldo: <strong style={{ color: totalCargos - totalPagos > 0 ? '#dc2626' : '#16a34a' }}>
              ${(totalCargos - totalPagos).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </span>
        )}
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted,#64748b)' }}>Cargando...</p>
      ) : movimientos.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">📋</div>
          <p>No hay movimientos para el filtro seleccionado</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tarjeta</th>
                <th>Concepto</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{formatFechaCorta(m.fecha)}</td>
                  <td style={{ fontSize: '0.85rem' }}>{m.tarjetaNombre}</td>
                  <td>{m.concepto}</td>
                  <td>
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', color: m.tipo === 'CARGO' ? '#dc2626' : '#16a34a' }}>{m.tipo}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, color: m.tipo === 'CARGO' ? '#dc2626' : '#16a34a' }}>
                    {m.tipo === 'CARGO' ? '+' : '-'}${m.monto.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{m.estado}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Reportes CxP ──────────────────────────────────────────
function TabReportesCxP() {
  const [vista, setVista] = useState('antiguedad');
  const [antiguedad, setAntiguedad] = useState(null);
  const [cargandoAnt, setCargandoAnt] = useState(false);
  const [proveedoresList, setProveedoresList] = useState([]);
  const [cargandoProvs, setCargandoProvs] = useState(false);
  const [provSeleccionado, setProvSeleccionado] = useState(null);
  const [estadoCuenta, setEstadoCuenta] = useState(null);
  const [cargandoEc, setCargandoEc] = useState(false);

  useEffect(() => {
    if (vista === 'antiguedad' && !antiguedad) {
      setCargandoAnt(true);
      api.get('/cxp/reporte/antiguedad').then((r) => setAntiguedad(r.data?.data || null)).catch(() => {}).finally(() => setCargandoAnt(false));
    }
    if (vista === 'estado-cuenta' && proveedoresList.length === 0) {
      setCargandoProvs(true);
      api.get('/cxp/reporte/estado-cuenta').then((r) => setProveedoresList(r.data?.data || [])).catch(() => {}).finally(() => setCargandoProvs(false));
    }
  }, [vista]); // eslint-disable-line

  const verEstadoCuenta = async (prov) => {
    setProvSeleccionado(prov);
    if (!prov.proveedorId) return;
    setCargandoEc(true);
    try {
      const r = await api.get(`/cxp/reporte/estado-cuenta?proveedorId=${prov.proveedorId}`);
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
          📋 Estado de cuenta por proveedor
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
                    {r.label} ({antiguedad.detalle[r.key].length} compras)
                  </h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="movimientos-tabla">
                      <thead>
                        <tr>
                          <th>Compra</th><th>Proveedor</th><th>Fecha emisión</th><th>Días</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ textAlign: 'right' }}>Pagado</th>
                          <th style={{ textAlign: 'right' }}>N. Créd.</th>
                          <th style={{ textAlign: 'right' }}>Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {antiguedad.detalle[r.key].map((c) => (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 600 }}>{c.numeroFactura}</td>
                            <td>{c.razonSocialProveedor}</td>
                            <td>{formatFechaCorta(c.fechaEmision)}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600, color: r.key === 'd91_mas' ? '#dc2626' : 'inherit' }}>{c.diasVencidos}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(c.importeTotal).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(c.pagado).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>{parseFloat(c.notaCredito || 0) > 0 ? `-$${parseFloat(c.notaCredito).toFixed(2)}` : '—'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>${parseFloat(c.saldoPendiente).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
        <div style={{ display: 'grid', gridTemplateColumns: provSeleccionado ? 'minmax(180px, 280px) 1fr' : '1fr', gap: '1rem', minWidth: 0 }}>
          <div>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, margin: '0 0 0.75rem' }}>Proveedores con saldo</h3>
            {cargandoProvs ? (
              <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.85rem' }}>Cargando...</p>
            ) : proveedoresList.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.85rem' }}>Sin saldos pendientes</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {proveedoresList.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => verEstadoCuenta(p)}
                    style={{
                      textAlign: 'left', padding: '0.6rem 0.8rem', border: '1px solid #e2e8f0', borderRadius: '6px',
                      background: provSeleccionado?.identificacion === p.identificacion ? 'var(--color-primary-50, #eff6ff)' : 'white',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{p.razonSocial}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #64748b)' }}>{p.identificacion}</div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#dc2626', marginTop: '0.25rem' }}>
                      ${parseFloat(p.saldoTotal).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {provSeleccionado && (
            <div>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: '0 0 0.75rem' }}>
                Estado de cuenta — {provSeleccionado.razonSocial}
              </h3>
              {cargandoEc ? (
                <p style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.85rem' }}>Cargando...</p>
              ) : estadoCuenta ? (
                <>
                  <h4 style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.4rem', color: '#475569' }}>Compras</h4>
                  <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
                    <table className="movimientos-tabla">
                      <thead>
                        <tr>
                          <th>Compra</th><th>Fecha</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ textAlign: 'right' }}>Pagado</th>
                          <th style={{ textAlign: 'right' }}>N. Créd.</th>
                          <th style={{ textAlign: 'right' }}>Saldo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estadoCuenta.compras.map((c) => (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 600 }}>{c.numeroFactura}</td>
                            <td>{formatFechaCorta(c.fechaEmision)}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(c.importeTotal).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>${parseFloat(c.pagado).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td style={{ textAlign: 'right' }}>{parseFloat(c.notaCredito || 0) > 0 ? `-$${parseFloat(c.notaCredito).toFixed(2)}` : '—'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: c.saldoPendiente > 0 ? '#dc2626' : '#16a34a' }}>
                              ${parseFloat(c.saldoPendiente).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {estadoCuenta.pagos.length > 0 && (
                    <>
                      <h4 style={{ fontSize: '0.82rem', fontWeight: 700, margin: '0 0 0.4rem', color: '#475569' }}>Pagos registrados</h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table className="movimientos-tabla">
                          <thead>
                            <tr><th>N° Orden de pago</th><th>Fecha</th><th>Método</th><th style={{ textAlign: 'right' }}>Monto</th></tr>
                          </thead>
                          <tbody>
                            {estadoCuenta.pagos.map((p) => (
                              <tr key={p.id}>
                                <td style={{ fontWeight: 600 }}>{p.numero}</td>
                                <td>{formatFechaCorta(p.fecha)}</td>
                                <td>{p.metodoPago}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }} className="monto-haber">
                                  ${parseFloat(p.monto).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

// ─── Tab Anticipos a Proveedores ─────────────────────────────────
function ModalAnticipoProveedor({ onClose, onSaved }) {
  const [form, setForm] = useState({
    nombreProveedor: '', monto: '', fecha: new Date().toISOString().slice(0, 10),
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
      await api.post('/anticipos/proveedores', { ...form, monto: parseFloat(form.monto) });
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
          <h3>Registrar anticipo a proveedor</h3>
          <button className="bancos-modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '.82rem', marginBottom: '.2rem', fontWeight: 600 }}>Proveedor *</label>
            <input name="nombreProveedor" value={form.nombreProveedor} onChange={handleChange}
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

function ModalAnularAnticipoProveedor({ anticipo, onClose, onSaved }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.patch(`/anticipos/proveedores/${anticipo.id}/anular`, { motivo });
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
            Se anulará el anticipo de <strong>${formatMoney(anticipo.monto)}</strong> a <strong>{anticipo.nombreProveedor}</strong> y se revertirá el asiento contable.
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

function TabAnticiposProveedor() {
  const [anticipos, setAnticipos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [verTodos, setVerTodos] = useState(false);
  const [modalRegistrar, setModalRegistrar] = useState(false);
  const [modalAnular, setModalAnular] = useState(null);
  const [refresco, setRefresco] = useState(0);

  useEffect(() => {
    setCargando(true);
    api.get(`/anticipos/proveedores${verTodos ? '/historial' : ''}`)
      .then((r) => setAnticipos(r.data?.data || []))
      .catch(() => setAnticipos([]))
      .finally(() => setCargando(false));
  }, [verTodos, refresco]);

  const totalSaldo = anticipos.reduce((s, a) => s + parseFloat(a.saldoPendiente || 0), 0);

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Anticipos a proveedores</h3>
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
                <th>Proveedor</th>
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
                  <td>{a.nombreProveedor}</td>
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
        <ModalAnticipoProveedor
          onClose={() => setModalRegistrar(false)}
          onSaved={() => { setModalRegistrar(false); setRefresco((n) => n + 1); }}
        />
      )}
      {modalAnular && (
        <ModalAnularAnticipoProveedor
          anticipo={modalAnular}
          onClose={() => setModalAnular(null)}
          onSaved={() => { setModalAnular(null); setRefresco((n) => n + 1); }}
        />
      )}
    </div>
  );
}

// ─── CuentasPorPagarHub — componente principal ──────────────────
export default function CuentasPorPagarHub() {
  const [tabActivo, setTabActivo] = useState('vigentes');
  const [modalPago, setModalPago] = useState(null);
  const [refresco, setRefresco] = useState(0);

  const tabs = [
    { id: 'vigentes',        label: 'Cuentas vigentes' },
    { id: 'canceladas',      label: 'Cuentas canceladas' },
    { id: 'historial',       label: 'Historial de pagos' },
    { id: 'anticipos',       label: 'Anticipos' },
    { id: 'tarjetas',        label: 'Tarjetas de crédito' },
    { id: 'libro-tarjetas',  label: 'Libro tarjetas de crédito' },
    { id: 'reportes',        label: 'Reportes' },
  ];

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="bancos-header">
        <h1>💳 Cuentas por Pagar</h1>
      </div>

      <div className="bancos-tabs" style={{ flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.id} className={`bancos-tab ${tabActivo === t.id ? 'active' : ''}`} onClick={() => setTabActivo(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tabActivo === 'vigentes'       && <TabCompras estado="vigentes"   onPagar={setModalPago} key={`vig-${refresco}`} />}
      {tabActivo === 'canceladas'     && <TabCompras estado="canceladas" key={`can-${refresco}`} />}
      {tabActivo === 'historial'      && <TabHistorial key={`hist-${refresco}`} />}
      {tabActivo === 'anticipos'      && <TabAnticiposProveedor key={`ant-${refresco}`} />}
      {tabActivo === 'tarjetas'       && <TabTarjetasCredito />}
      {tabActivo === 'libro-tarjetas' && <TabLibroTarjetas />}
      {tabActivo === 'reportes'       && <TabReportesCxP />}

      {modalPago && (
        <ModalPago
          compra={modalPago}
          onClose={() => setModalPago(null)}
          onSaved={() => { setModalPago(null); setRefresco((n) => n + 1); }}
        />
      )}
    </div>
  );
}
