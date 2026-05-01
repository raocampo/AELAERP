import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import './Bancos.css';

const TIPOS_CUENTA = ['CORRIENTE', 'AHORROS'];
const TIPOS_MOV = ['DEPOSITO', 'RETIRO', 'TRANSFERENCIA_IN', 'TRANSFERENCIA_OUT', 'NOTA_DEBITO', 'NOTA_CREDITO', 'AJUSTE'];
const ESTADOS_CHEQUE = ['PENDIENTE', 'COBRADO', 'ANULADO', 'PROTESTADO'];

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Modal Cuenta ───────────────────────────────────────────
function ModalCuenta({ cuenta, onClose, onSaved }) {
  const [form, setForm] = useState({
    nombre: '', banco: '', tipoCuenta: 'CORRIENTE',
    numeroCuenta: '', titular: '', saldoInicial: '0',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (cuenta) {
      setForm({
        nombre: cuenta.nombre || '',
        banco: cuenta.banco || '',
        tipoCuenta: cuenta.tipoCuenta || 'CORRIENTE',
        numeroCuenta: cuenta.numeroCuenta || '',
        titular: cuenta.titular || '',
        saldoInicial: String(cuenta.saldoInicial ?? 0),
      });
    }
  }, [cuenta]);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      if (cuenta?.id) {
        await api.put(`/bancos/${cuenta.id}`, form);
      } else {
        await api.post('/bancos', form);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bancos-modal">
        <h2>{cuenta?.id ? 'Editar Cuenta Bancaria' : 'Nueva Cuenta Bancaria'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group full-col">
              <label>Nombre descriptivo *</label>
              <input name="nombre" value={form.nombre} onChange={handleChange} placeholder="Ej. Banco del Pacífico - Cta Cte" required />
            </div>
            <div className="form-group">
              <label>Institución bancaria *</label>
              <input name="banco" value={form.banco} onChange={handleChange} placeholder="Ej. Banco del Pacífico" required />
            </div>
            <div className="form-group">
              <label>Tipo de cuenta</label>
              <select name="tipoCuenta" value={form.tipoCuenta} onChange={handleChange}>
                {TIPOS_CUENTA.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Número de cuenta *</label>
              <input name="numeroCuenta" value={form.numeroCuenta} onChange={handleChange} placeholder="0000000000" required />
            </div>
            <div className="form-group">
              <label>Titular</label>
              <input name="titular" value={form.titular} onChange={handleChange} placeholder="Nombre del titular" />
            </div>
            {!cuenta?.id && (
              <div className="form-group">
                <label>Saldo inicial</label>
                <input name="saldoInicial" type="number" step="0.01" value={form.saldoInicial} onChange={handleChange} />
              </div>
            )}
          </div>
          {error && <p className="form-error" style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Movimiento ────────────────────────────────────────
function ModalMovimiento({ bancoId, onClose, onSaved }) {
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    tipo: 'DEPOSITO', concepto: '', referencia: '', debe: '', haber: '', observaciones: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post(`/bancos/${bancoId}/movimientos`, form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bancos-modal">
        <h2>Registrar Movimiento</h2>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>Fecha *</label>
              <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>Tipo *</label>
              <select name="tipo" value={form.tipo} onChange={handleChange}>
                {TIPOS_MOV.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="form-group full-col">
              <label>Concepto *</label>
              <input name="concepto" value={form.concepto} onChange={handleChange} placeholder="Descripción del movimiento" required />
            </div>
            <div className="form-group">
              <label>Referencia</label>
              <input name="referencia" value={form.referencia} onChange={handleChange} placeholder="# cheque / transferencia" />
            </div>
            <div className="form-group">
              <label>Valor Debe (+)</label>
              <input type="number" step="0.01" name="debe" value={form.debe} onChange={handleChange} placeholder="0.00" />
            </div>
            <div className="form-group">
              <label>Valor Haber (−)</label>
              <input type="number" step="0.01" name="haber" value={form.haber} onChange={handleChange} placeholder="0.00" />
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
              {guardando ? 'Registrando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Cheque ────────────────────────────────────────────
function ModalCheque({ bancoId, onClose, onSaved }) {
  const [form, setForm] = useState({
    numero: '', beneficiario: '', fecha: new Date().toISOString().slice(0, 10),
    fechaVencimiento: '', monto: '', concepto: '', proveedorId: '',
  });
  const [proveedores, setProveedores] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/proveedores?activo=true&limit=500').then((r) => setProveedores(r.data?.data || [])).catch(() => {});
  }, []);

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post(`/bancos/${bancoId}/cheques`, form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al emitir cheque');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="bancos-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bancos-modal">
        <h2>Emitir Cheque</h2>
        <form onSubmit={handleSubmit}>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>Nº Cheque *</label>
              <input name="numero" value={form.numero} onChange={handleChange} placeholder="001234" required />
            </div>
            <div className="form-group">
              <label>Fecha emisión *</label>
              <input type="date" name="fecha" value={form.fecha} onChange={handleChange} required />
            </div>
            <div className="form-group full-col">
              <label>Beneficiario *</label>
              <input name="beneficiario" value={form.beneficiario} onChange={handleChange} placeholder="Nombre del beneficiario" required />
            </div>
            <div className="form-group">
              <label>Monto *</label>
              <input type="number" step="0.01" name="monto" value={form.monto} onChange={handleChange} placeholder="0.00" required />
            </div>
            <div className="form-group">
              <label>Fecha vencimiento</label>
              <input type="date" name="fechaVencimiento" value={form.fechaVencimiento} onChange={handleChange} />
            </div>
            <div className="form-group full-col">
              <label>Concepto / detalle</label>
              <input name="concepto" value={form.concepto} onChange={handleChange} placeholder="Pago factura #..." />
            </div>
            <div className="form-group full-col">
              <label>Proveedor (opcional)</label>
              <select name="proveedorId" value={form.proveedorId} onChange={handleChange}>
                <option value="">— Sin proveedor —</option>
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.razonSocial}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Emitiendo...' : 'Emitir Cheque'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab Movimientos ─────────────────────────────────────────
function TabMovimientos({ cuenta }) {
  const [movimientos, setMovimientos] = useState([]);
  const [saldo, setSaldo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [modalMov, setModalMov] = useState(false);
  const [filtros, setFiltros] = useState({ fechaDesde: '', fechaHasta: '', tipo: '' });

  const cargar = useCallback(async () => {
    if (!cuenta) return;
    setCargando(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (filtros.fechaDesde) params.set('fechaDesde', filtros.fechaDesde);
      if (filtros.fechaHasta) params.set('fechaHasta', filtros.fechaHasta);
      if (filtros.tipo) params.set('tipo', filtros.tipo);
      const [rMov, rSaldo] = await Promise.all([
        api.get(`/bancos/${cuenta.id}/movimientos?${params}`),
        api.get(`/bancos/${cuenta.id}/saldo`),
      ]);
      setMovimientos(rMov.data?.data || []);
      setSaldo(rSaldo.data?.data || null);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [cuenta, filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!cuenta) return null;

  return (
    <div>
      {saldo && (
        <div className="saldo-resumen">
          <div className="saldo-item">
            <div className="saldo-item-label">Saldo Inicial</div>
            <div className="saldo-item-valor">${formatMoney(saldo.saldoInicial)}</div>
          </div>
          <div className="saldo-item">
            <div className="saldo-item-label">Total Ingresos</div>
            <div className="saldo-item-valor monto-debe">${formatMoney(saldo.totalDebe)}</div>
          </div>
          <div className="saldo-item">
            <div className="saldo-item-label">Total Egresos</div>
            <div className="saldo-item-valor monto-haber">${formatMoney(saldo.totalHaber)}</div>
          </div>
          <div className="saldo-item">
            <div className="saldo-item-label">Saldo Actual</div>
            <div className={`saldo-item-valor ${saldo.saldoActual < 0 ? 'saldo-negativo' : 'saldo-positivo'}`}>
              ${formatMoney(saldo.saldoActual)}
            </div>
          </div>
        </div>
      )}

      <div className="bancos-filtros">
        <input type="date" value={filtros.fechaDesde} onChange={(e) => setFiltros((f) => ({ ...f, fechaDesde: e.target.value }))} />
        <input type="date" value={filtros.fechaHasta} onChange={(e) => setFiltros((f) => ({ ...f, fechaHasta: e.target.value }))} />
        <select value={filtros.tipo} onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value }))}>
          <option value="">Todos los tipos</option>
          {TIPOS_MOV.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setModalMov(true)}>+ Movimiento</button>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)' }}>Cargando movimientos...</p>
      ) : movimientos.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">📋</div>
          <p>Sin movimientos registrados</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>Referencia</th>
                <th style={{ textAlign: 'right' }}>Debe (+)</th>
                <th style={{ textAlign: 'right' }}>Haber (−)</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.fecha)}</td>
                  <td>
                    <span className={`tipo-badge tipo-${m.tipo}`}>{m.tipo.replace(/_/g, ' ')}</span>
                  </td>
                  <td>{m.concepto}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{m.referencia || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {parseFloat(m.debe) > 0 ? <span className="monto-debe">${formatMoney(m.debe)}</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {parseFloat(m.haber) > 0 ? <span className="monto-haber">${formatMoney(m.haber)}</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={m.saldoAcumulado < 0 ? 'saldo-negativo' : 'saldo-positivo'}>
                      ${formatMoney(m.saldoAcumulado)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalMov && (
        <ModalMovimiento bancoId={cuenta.id} onClose={() => setModalMov(false)} onSaved={() => { setModalMov(false); cargar(); }} />
      )}
    </div>
  );
}

// ─── Tab Cheques ─────────────────────────────────────────────
function TabCheques({ cuenta }) {
  const [cheques, setCheques] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [modalCheque, setModalCheque] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState('');

  const cargar = useCallback(async () => {
    if (!cuenta) return;
    setCargando(true);
    try {
      const params = filtroEstado ? `?estado=${filtroEstado}` : '';
      const r = await api.get(`/bancos/${cuenta.id}/cheques${params}`);
      setCheques(r.data?.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [cuenta, filtroEstado]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarEstado = async (chequeId, nuevoEstado) => {
    try {
      await api.patch(`/bancos/cheques/${chequeId}/estado`, { estado: nuevoEstado });
      cargar();
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al cambiar estado');
    }
  };

  if (!cuenta) return null;

  return (
    <div>
      <div className="bancos-filtros">
        <select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS_CHEQUE.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button className="btn btn-primary btn-sm" onClick={() => setModalCheque(true)}>+ Emitir Cheque</button>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-secondary)' }}>Cargando cheques...</p>
      ) : cheques.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">🧾</div>
          <p>Sin cheques emitidos</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>Nº Cheque</th>
                <th>Fecha</th>
                <th>Beneficiario</th>
                <th>Concepto</th>
                <th style={{ textAlign: 'right' }}>Monto</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>#{c.numero}</td>
                  <td>{formatDate(c.fecha)}</td>
                  <td>{c.beneficiario}</td>
                  <td style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{c.concepto || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${formatMoney(c.monto)}</td>
                  <td>
                    <span className={`cheque-estado-badge estado-${c.estado}`}>{c.estado}</span>
                  </td>
                  <td>
                    {c.estado === 'PENDIENTE' && (
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button className="btn btn-success btn-sm" onClick={() => cambiarEstado(c.id, 'COBRADO')}>Cobrado</button>
                        <button className="btn btn-danger btn-sm" onClick={() => cambiarEstado(c.id, 'ANULADO')}>Anular</button>
                        <button className="btn btn-warning btn-sm" onClick={() => cambiarEstado(c.id, 'PROTESTADO')}>Protestado</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalCheque && (
        <ModalCheque bancoId={cuenta.id} onClose={() => setModalCheque(false)} onSaved={() => { setModalCheque(false); cargar(); }} />
      )}
    </div>
  );
}

// ─── BancosHub — componente principal ────────────────────────
export default function BancosHub() {
  const navigate = useNavigate();
  const [cuentas, setCuentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [cuentaSeleccionada, setCuentaSeleccionada] = useState(null);
  const [tabActivo, setTabActivo] = useState('movimientos');
  const [modalCuenta, setModalCuenta] = useState(false);
  const [cuentaEditar, setCuentaEditar] = useState(null);
  const [saldos, setSaldos] = useState({});

  const cargarCuentas = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get('/bancos');
      const lista = r.data?.data || [];
      setCuentas(lista);
      // Cargar saldos en paralelo
      const saldosResult = await Promise.allSettled(
        lista.map((c) => api.get(`/bancos/${c.id}/saldo`))
      );
      const saldosMap = {};
      saldosResult.forEach((res, i) => {
        if (res.status === 'fulfilled') {
          saldosMap[lista[i].id] = res.value.data?.data?.saldoActual ?? lista[i].saldoInicial;
        }
      });
      setSaldos(saldosMap);
      if (lista.length > 0 && !cuentaSeleccionada) {
        setCuentaSeleccionada(lista[0]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [cuentaSeleccionada]);

  useEffect(() => { cargarCuentas(); }, []); // eslint-disable-line

  const handleSeleccionar = (cuenta) => {
    setCuentaSeleccionada(cuenta);
    setTabActivo('movimientos');
  };

  const handleEditar = (e, cuenta) => {
    e.stopPropagation();
    setCuentaEditar(cuenta);
    setModalCuenta(true);
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="bancos-header">
        <h1>🏦 Cuentas Bancarias</h1>
        <button className="btn btn-primary" onClick={() => { setCuentaEditar(null); setModalCuenta(true); }}>
          + Nueva Cuenta
        </button>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-secondary)' }}>Cargando cuentas bancarias...</p>
      ) : cuentas.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">🏦</div>
          <p>No hay cuentas bancarias registradas.</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setModalCuenta(true)}>
            + Agregar primera cuenta
          </button>
        </div>
      ) : (
        <>
          {/* Grid de cuentas */}
          <div className="bancos-grid">
            {cuentas.map((c) => {
              const saldoActual = saldos[c.id] ?? c.saldoInicial;
              return (
                <div
                  key={c.id}
                  className={`banco-card ${cuentaSeleccionada?.id === c.id ? 'selected' : ''}`}
                  onClick={() => handleSeleccionar(c)}
                >
                  <div className="banco-card-header">
                    <div className="banco-card-nombre">{c.nombre}</div>
                    <span className="banco-card-tipo">{c.tipoCuenta}</span>
                    <div className="banco-card-actions">
                      <button className="btn btn-ghost btn-sm btn-icon" title="Editar" onClick={(e) => handleEditar(e, c)}>✏️</button>
                    </div>
                  </div>
                  <div className="banco-card-info">{c.banco} · {c.numeroCuenta}</div>
                  {c.titular && <div className="banco-card-info" style={{ fontSize: '0.78rem' }}>{c.titular}</div>}
                  <div className={`banco-card-saldo ${saldoActual < 0 ? 'negativo' : ''}`}>
                    ${formatMoney(saldoActual)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detalle de cuenta seleccionada */}
          {cuentaSeleccionada && (
            <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '1.25rem' }}>
              <div style={{ marginBottom: '0.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{cuentaSeleccionada.nombre}</h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  {cuentaSeleccionada.banco} · {cuentaSeleccionada.tipoCuenta} · {cuentaSeleccionada.numeroCuenta}
                </p>
              </div>

              <div className="bancos-tabs">
                <button className={`bancos-tab ${tabActivo === 'movimientos' ? 'active' : ''}`} onClick={() => setTabActivo('movimientos')}>
                  📊 Movimientos / Libro Mayor
                </button>
                <button className={`bancos-tab ${tabActivo === 'cheques' ? 'active' : ''}`} onClick={() => setTabActivo('cheques')}>
                  🧾 Cheques
                </button>
              </div>

              {tabActivo === 'movimientos' && <TabMovimientos cuenta={cuentaSeleccionada} key={`mov-${cuentaSeleccionada.id}`} />}
              {tabActivo === 'cheques'     && <TabCheques     cuenta={cuentaSeleccionada} key={`chq-${cuentaSeleccionada.id}`} />}
            </div>
          )}
        </>
      )}

      {modalCuenta && (
        <ModalCuenta
          cuenta={cuentaEditar}
          onClose={() => setModalCuenta(false)}
          onSaved={() => { setModalCuenta(false); setCuentaEditar(null); cargarCuentas(); }}
        />
      )}
    </div>
  );
}
