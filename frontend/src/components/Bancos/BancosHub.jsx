import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';
import ComprobantesView from './ComprobantesView';
import { formatFechaCorta } from '../../utils/fecha';
import './Bancos.css';

const TIPOS_CUENTA = ['CORRIENTE', 'AHORROS'];
const TIPOS_MOV = ['DEPOSITO', 'RETIRO', 'TRANSFERENCIA_IN', 'TRANSFERENCIA_OUT', 'NOTA_DEBITO', 'NOTA_CREDITO', 'AJUSTE'];
const ESTADOS_CHEQUE = ['PENDIENTE', 'COBRADO', 'ANULADO', 'PROTESTADO'];

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(d) {
  if (!d) return '';
  return formatFechaCorta(d);
}

// Cuentas del Plan de Cuentas que aceptan movimiento — usado por los selectores
// de "cuenta contable" (ModalCuenta) y "cuenta contrapartida" (Movimiento/Cheque).
function useCuentasContables() {
  const [cuentas, setCuentas] = useState([]);
  useEffect(() => {
    api.get('/contabilidad/plan-cuentas', { params: { activo: true, soloMovimiento: true } })
      .then((r) => setCuentas(r.data?.data?.flat || []))
      .catch((err) => console.error('No se pudo cargar el plan de cuentas:', err.response?.data?.mensaje || err.message));
  }, []);
  return cuentas;
}

// ─── Modal Cuenta ───────────────────────────────────────────
function ModalCuenta({ cuenta, onClose, onSaved }) {
  const [form, setForm] = useState({
    nombre: '', banco: '', tipoCuenta: 'CORRIENTE',
    numeroCuenta: '', titular: '', saldoInicial: '0', cuentaContableId: '',
  });
  const cuentasContables = useCuentasContables();
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
        cuentaContableId: cuenta.cuentaContableId ? String(cuenta.cuentaContableId) : '',
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
    <div className="bancos-modal-overlay" >
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
            <div className="form-group">
              <label>Saldo inicial</label>
              <input name="saldoInicial" type="number" step="0.01" value={form.saldoInicial} onChange={handleChange} />
              {cuenta?.id && (
                <small style={{ color: 'var(--color-warning, #b45309)', fontSize: '0.78rem' }}>
                  ⚠ Cambiar el saldo inicial recalcula el saldo actual. Usar solo para corregir errores de carga.
                </small>
              )}
            </div>
            <div className="form-group full-col">
              <label>Cuenta contable (Plan de Cuentas)</label>
              <select name="cuentaContableId" value={form.cuentaContableId} onChange={handleChange}>
                <option value="">— Sin vincular —</option>
                {cuentasContables.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
              <small style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.78rem' }}>
                {cuentasContables.length === 0
                  ? 'No hay cuentas disponibles que acepten movimiento. Crea primero la cuenta del banco en Contabilidad → Plan de Cuentas.'
                  : 'Enlaza esta cuenta bancaria con su cuenta contable en el Plan de Cuentas para que los movimientos y conciliaciones se reflejen correctamente en la contabilidad.'}
              </small>
            </div>
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
    tipo: 'DEPOSITO', concepto: '', referencia: '', debe: '', haber: '', observaciones: '', cuentaContrapartidaId: '',
  });
  const cuentasContables = useCuentasContables();
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
    <div className="bancos-modal-overlay" >
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
            <div className="form-group full-col">
              <label>Cuenta contrapartida (opcional)</label>
              <select name="cuentaContrapartidaId" value={form.cuentaContrapartidaId} onChange={handleChange}>
                <option value="">— No generar asiento contable —</option>
                {cuentasContables.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
              <small style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.78rem' }}>
                Si eliges una cuenta, se genera el asiento contable automáticamente
                (banco vs. esta cuenta). Si la dejas vacía, el movimiento queda
                registrado igual pero sin asiento.
              </small>
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
    fechaVencimiento: '', monto: '', concepto: '', proveedorId: '', cuentaContrapartidaId: '',
  });
  const [proveedores, setProveedores] = useState([]);
  const cuentasContables = useCuentasContables();
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
    <div className="bancos-modal-overlay" >
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
            <div className="form-group full-col">
              <label>Cuenta contrapartida (opcional)</label>
              <select name="cuentaContrapartidaId" value={form.cuentaContrapartidaId} onChange={handleChange}>
                <option value="">— No generar asiento contable —</option>
                {cuentasContables.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
              <small style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '0.78rem' }}>
                Ej. la cuenta de Cuentas por Pagar del proveedor o el gasto que este
                cheque está pagando. Si la dejas vacía, no se genera asiento.
              </small>
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

const TAB_TIPO_MOV = {
  ingreso: 'DEPOSITO',
  pago: 'RETIRO',
  credito: 'NOTA_CREDITO',
  debito: 'NOTA_DEBITO',
};

const TAB_LABELS = {
  libro: 'Libro de Bancos',
  ingreso: 'Comprobantes de Ingreso',
  pago: 'Comprobantes de Pago',
  credito: 'Notas de Crédito Bancarias',
  debito: 'Notas de Débito Bancarias',
};

// ─── Tab Movimientos ─────────────────────────────────────────
function TabMovimientos({ cuenta, initialTipo = '' }) {
  const [movimientos, setMovimientos] = useState([]);
  const [saldo, setSaldo] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [modalMov, setModalMov] = useState(false);
  const [filtros, setFiltros] = useState({ fechaDesde: '', fechaHasta: '', tipo: initialTipo });

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
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando movimientos...</p>
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
                <th>N° Comprobante</th>
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
                  <td style={{ fontSize: '0.8rem', fontWeight: 600 }}>{m.numero || '—'}</td>
                  <td>{formatDate(m.fecha)}</td>
                  <td>
                    <span className={`tipo-badge tipo-${m.tipo}`}>{m.tipo.replace(/_/g, ' ')}</span>
                  </td>
                  <td>{m.concepto}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)' }}>{m.referencia || '—'}</td>
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
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando cheques...</p>
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
                  <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #64748b)' }}>{c.concepto || '—'}</td>
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
  const location = useLocation();
  const urlTab = new URLSearchParams(location.search).get('tab') || 'cuentas';
  const movTipoFiltro = TAB_TIPO_MOV[urlTab] || '';
  const viewLabel = TAB_LABELS[urlTab] || 'Cuentas Bancarias';

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

  // Comprobantes bancarios van en su propia vista
  const tipoComprobante = { ingreso: 'INGRESO', pago: 'PAGO', credito: 'CREDITO', debito: 'DEBITO' }[urlTab];
  if (tipoComprobante) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <ComprobantesView tipo={tipoComprobante} key={urlTab} />
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="bancos-header">
        <h1>🏦 {viewLabel}</h1>
        <button className="btn btn-primary" onClick={() => { setCuentaEditar(null); setModalCuenta(true); }}>
          + Nueva Cuenta
        </button>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando cuentas bancarias...</p>
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
                  {c.cuentaContable ? (
                    <div className="banco-card-info" style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                      📎 {c.cuentaContable.codigo} — {c.cuentaContable.nombre}
                    </div>
                  ) : (
                    <div className="banco-card-info" style={{ fontSize: '0.75rem', color: 'var(--color-warning, #b45309)' }}>
                      ⚠ Sin cuenta contable vinculada
                    </div>
                  )}
                  <div className={`banco-card-saldo ${saldoActual < 0 ? 'negativo' : ''}`}>
                    ${formatMoney(saldoActual)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detalle de cuenta seleccionada */}
          {cuentaSeleccionada && (
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1.25rem' }}>
              <div style={{ marginBottom: '0.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{cuentaSeleccionada.nombre}</h2>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted, #64748b)' }}>
                  {cuentaSeleccionada.banco} · {cuentaSeleccionada.tipoCuenta} · {cuentaSeleccionada.numeroCuenta}
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                  {cuentaSeleccionada.cuentaContable
                    ? <span style={{ color: 'var(--color-text-muted, #64748b)' }}>📎 Cuenta contable: {cuentaSeleccionada.cuentaContable.codigo} — {cuentaSeleccionada.cuentaContable.nombre}</span>
                    : <span style={{ color: 'var(--color-warning, #b45309)' }}>⚠ Sin cuenta contable vinculada — edítala para enlazarla al Plan de Cuentas</span>}
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

              {tabActivo === 'movimientos' && <TabMovimientos cuenta={cuentaSeleccionada} key={`mov-${cuentaSeleccionada.id}-${urlTab}`} initialTipo={movTipoFiltro} />}
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
