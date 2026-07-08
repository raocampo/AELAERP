import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import './CajaChica.css';

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFecha(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const TIPO_LABEL = {
  APERTURA: 'Apertura',
  GASTO: 'Gasto / Vale',
  REPOSICION: 'Reposición',
  INCREMENTO: 'Incremento',
  DISMINUCION: 'Disminución',
  CIERRE: 'Cierre',
};

const TIPO_SIGNO = {
  APERTURA: '+', REPOSICION: '+', INCREMENTO: '+',
  GASTO: '-', DISMINUCION: '-', CIERRE: '',
};

function useCuentasContables() {
  const [cuentas, setCuentas] = useState([]);
  useEffect(() => {
    api.get('/contabilidad/plan-cuentas', { params: { activo: true, soloMovimiento: true } })
      .then((r) => setCuentas(r.data?.data?.flat || []))
      .catch(() => {});
  }, []);
  return cuentas;
}

function useUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  useEffect(() => {
    api.get('/usuarios').then((r) => setUsuarios(r.data?.data || [])).catch(() => {});
  }, []);
  return usuarios;
}

// ─── Modal Nuevo Fondo ───────────────────────────────────────────────────────
function ModalNuevoFondo({ onClose, onSaved }) {
  const cuentas = useCuentasContables();
  const usuarios = useUsuarios();
  const [form, setForm] = useState({
    codigo: '', nombre: '', montoFondo: '', responsableId: '',
    cuentaFondoId: '', cuentaContrapartidaId: '', observaciones: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handle = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post('/caja-chica', {
        ...form,
        montoFondo: parseFloat(form.montoFondo),
        responsableId: form.responsableId || null,
        cuentaFondoId: form.cuentaFondoId || null,
        cuentaContrapartidaId: form.cuentaContrapartidaId || null,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al crear el fondo');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cc-modal-overlay" onClick={onClose}>
      <div className="cc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-header">
          <h3>Nuevo Fondo de Caja Chica</h3>
          <button className="cc-modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="cc-form">
          <div className="cc-form-row">
            <label>
              Código *
              <input name="codigo" value={form.codigo} onChange={handle} placeholder="CC-001" required maxLength={20} />
            </label>
            <label>
              Monto del fondo *
              <input name="montoFondo" type="number" step="0.01" min="0.01" value={form.montoFondo} onChange={handle} placeholder="0.00" required />
            </label>
          </div>
          <label>
            Nombre *
            <input name="nombre" value={form.nombre} onChange={handle} placeholder="Caja Chica Oficina Principal" required maxLength={150} />
          </label>
          <label>
            Responsable / Custodio
            <select name="responsableId" value={form.responsableId} onChange={handle}>
              <option value="">— Sin asignar —</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <div className="cc-form-row">
            <label>
              Cuenta Caja Chica (plan de cuentas)
              <select name="cuentaFondoId" value={form.cuentaFondoId} onChange={handle}>
                <option value="">— Default: 1.1.01.002 —</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}
              </select>
            </label>
            <label>
              Cuenta Contrapartida (banco/caja)
              <select name="cuentaContrapartidaId" value={form.cuentaContrapartidaId} onChange={handle}>
                <option value="">— Default: 1.1.01.001 —</option>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>)}
              </select>
            </label>
          </div>
          <label>
            Observaciones
            <textarea name="observaciones" value={form.observaciones} onChange={handle} rows={2} />
          </label>
          {error && <p className="cc-error">{error}</p>}
          <div className="cc-form-actions">
            <button type="button" className="cc-btn cc-btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="cc-btn cc-btn-primary" disabled={guardando}>
              {guardando ? 'Creando...' : '✓ Crear fondo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Registrar Gasto ───────────────────────────────────────────────────
function ModalGasto({ cajaChicaId, saldoDisponible, onClose, onSaved }) {
  const cuentas = useCuentasContables();
  const [form, setForm] = useState({ monto: '', concepto: '', nroComprobante: '', proveedor: '', cuentaGastoId: '', centroCostoId: '', fecha: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handle = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post(`/caja-chica/${cajaChicaId}/gastos`, {
        ...form,
        monto: parseFloat(form.monto),
        cuentaGastoId: form.cuentaGastoId || null,
        fecha: form.fecha || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al registrar el gasto');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cc-modal-overlay" onClick={onClose}>
      <div className="cc-modal cc-modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-header">
          <h3>Registrar Gasto / Vale</h3>
          <button className="cc-modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="cc-saldo-hint">Saldo disponible: <strong>${formatMoney(saldoDisponible)}</strong></p>
        <form onSubmit={handleSubmit} className="cc-form">
          <div className="cc-form-row">
            <label>
              Monto *
              <input name="monto" type="number" step="0.01" min="0.01" max={saldoDisponible} value={form.monto} onChange={handle} placeholder="0.00" required />
            </label>
            <label>
              Fecha
              <input name="fecha" type="date" value={form.fecha} onChange={handle} />
            </label>
          </div>
          <label>
            Concepto *
            <input name="concepto" value={form.concepto} onChange={handle} placeholder="Ej: Materiales de oficina" required maxLength={300} />
          </label>
          <div className="cc-form-row">
            <label>
              N° Comprobante
              <input name="nroComprobante" value={form.nroComprobante} onChange={handle} placeholder="001-001-000000123" maxLength={50} />
            </label>
            <label>
              Proveedor
              <input name="proveedor" value={form.proveedor} onChange={handle} placeholder="Nombre del proveedor" maxLength={200} />
            </label>
          </div>
          <label>
            Cuenta de Gasto (para el asiento de reposición)
            <select name="cuentaGastoId" value={form.cuentaGastoId} onChange={handle}>
              <option value="">— Gastos Varios (genérico) —</option>
              {cuentas.filter((c) => c.tipo?.toUpperCase() === 'GASTO').map((c) => (
                <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
              ))}
            </select>
          </label>
          {error && <p className="cc-error">{error}</p>}
          <div className="cc-form-actions">
            <button type="button" className="cc-btn cc-btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="cc-btn cc-btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : '✓ Registrar gasto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Acción simple (Reponer / Incrementar / Disminuir) ─────────────────
function ModalAccion({ titulo, accion, cajaChicaId, totalPendiente, saldoDisponible, onClose, onSaved }) {
  const [form, setForm] = useState({ monto: totalPendiente ? String(totalPendiente) : '', descripcion: '', fecha: '' });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  const handle = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.post(`/caja-chica/${cajaChicaId}/${accion}`, {
        monto: parseFloat(form.monto),
        descripcion: form.descripcion || undefined,
        fecha: form.fecha || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al procesar la operación');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cc-modal-overlay" onClick={onClose}>
      <div className="cc-modal cc-modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-header">
          <h3>{titulo}</h3>
          <button className="cc-modal-close" onClick={onClose}>✕</button>
        </div>
        {accion === 'reponer' && totalPendiente > 0 && (
          <p className="cc-saldo-hint">Total de gastos pendientes: <strong>${formatMoney(totalPendiente)}</strong></p>
        )}
        {accion === 'disminuir' && (
          <p className="cc-saldo-hint">Saldo disponible: <strong>${formatMoney(saldoDisponible)}</strong></p>
        )}
        <form onSubmit={handleSubmit} className="cc-form">
          {accion !== 'reponer' && (
            <label>
              Monto *
              <input name="monto" type="number" step="0.01" min="0.01" value={form.monto} onChange={handle} placeholder="0.00" required />
            </label>
          )}
          <div className="cc-form-row">
            <label>
              Descripción
              <input name="descripcion" value={form.descripcion} onChange={handle} placeholder="Motivo..." />
            </label>
            <label>
              Fecha
              <input name="fecha" type="date" value={form.fecha} onChange={handle} />
            </label>
          </div>
          {error && <p className="cc-error">{error}</p>}
          <div className="cc-form-actions">
            <button type="button" className="cc-btn cc-btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="cc-btn cc-btn-primary" disabled={guardando}>
              {guardando ? 'Procesando...' : `✓ ${titulo}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Vista detalle de un fondo ────────────────────────────────────────────────
function FondoDetalle({ fondoId, empresaId, onVolver, onRefreshLista }) {
  const [fondo, setFondo] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(null); // 'gasto' | 'reponer' | 'incrementar' | 'disminuir'
  const [cerrando, setCerrando] = useState(false);
  const [toast, setToast] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get(`/caja-chica/${fondoId}`);
      setFondo(r.data.data);
    } catch {
      // silencioso
    } finally {
      setCargando(false);
    }
  }, [fondoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const onAccionFin = (msg) => {
    setModal(null);
    setToast(msg);
    cargar();
    onRefreshLista();
    setTimeout(() => setToast(''), 3500);
  };

  const handleAnularVale = async (movId) => {
    const motivo = window.prompt('Motivo de anulación (opcional):');
    if (motivo === null) return;
    try {
      await api.patch(`/caja-chica/${fondoId}/gastos/${movId}/anular`, { motivo });
      cargar();
      setToast('Vale anulado');
      setTimeout(() => setToast(''), 2500);
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al anular');
    }
  };

  const handleCerrar = async () => {
    if (!window.confirm('¿Cerrar definitivamente este fondo? Esta acción no se puede revertir.')) return;
    setCerrando(true);
    try {
      await api.patch(`/caja-chica/${fondoId}/cerrar`);
      onAccionFin('Fondo cerrado');
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al cerrar');
    } finally {
      setCerrando(false);
    }
  };

  if (cargando) return <div className="cc-loading">Cargando fondo...</div>;
  if (!fondo) return <div className="cc-error-block">No se pudo cargar el fondo</div>;

  const activo = fondo.estado === 'ACTIVO';
  const pct = fondo.montoFondo > 0
    ? Math.min(100, Math.round((fondo.saldoDisponible / fondo.montoFondo) * 100))
    : 0;

  return (
    <div className="cc-detalle">
      {toast && <div className="cc-toast">{toast}</div>}

      <div className="cc-detalle-header">
        <button className="cc-btn-volver" onClick={onVolver}>← Volver</button>
        <div className="cc-detalle-titulo">
          <h2>{fondo.codigo} — {fondo.nombre}</h2>
          <span className={`cc-badge cc-badge-${fondo.estado.toLowerCase()}`}>{fondo.estado}</span>
        </div>
      </div>

      <div className="cc-detalle-cards">
        <div className="cc-stat-card">
          <span className="cc-stat-label">Fondo autorizado</span>
          <span className="cc-stat-value">${formatMoney(fondo.montoFondo)}</span>
        </div>
        <div className="cc-stat-card cc-stat-highlight">
          <span className="cc-stat-label">Saldo disponible</span>
          <span className="cc-stat-value">${formatMoney(fondo.saldoDisponible)}</span>
          <div className="cc-progress-bar">
            <div className="cc-progress-fill" style={{ width: `${pct}%`, background: pct < 25 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#22c55e' }} />
          </div>
          <span className="cc-stat-pct">{pct}%</span>
        </div>
        <div className="cc-stat-card">
          <span className="cc-stat-label">Pendiente reponer</span>
          <span className="cc-stat-value cc-stat-warn">${formatMoney(fondo.totalPendienteReponer)}</span>
        </div>
        <div className="cc-stat-card">
          <span className="cc-stat-label">Responsable</span>
          <span className="cc-stat-value cc-stat-sm">{fondo.responsable?.nombre || '—'}</span>
        </div>
      </div>

      {activo && (
        <div className="cc-acciones">
          <button className="cc-btn cc-btn-primary" onClick={() => setModal('gasto')}>+ Registrar gasto</button>
          <button
            className="cc-btn cc-btn-success"
            disabled={fondo.totalPendienteReponer <= 0}
            onClick={() => setModal('reponer')}
          >
            ↑ Reponer fondo {fondo.totalPendienteReponer > 0 ? `($${formatMoney(fondo.totalPendienteReponer)})` : ''}
          </button>
          <button className="cc-btn cc-btn-secondary" onClick={() => setModal('incrementar')}>↑ Incrementar</button>
          <button className="cc-btn cc-btn-secondary" onClick={() => setModal('disminuir')}>↓ Disminuir</button>
          <button className="cc-btn cc-btn-danger" onClick={handleCerrar} disabled={cerrando}>
            {cerrando ? 'Cerrando...' : '✕ Cerrar fondo'}
          </button>
        </div>
      )}

      <div className="cc-movimientos">
        <h3>Historial de movimientos</h3>
        {fondo.movimientos.length === 0 ? (
          <p className="cc-vacio">Sin movimientos</p>
        ) : (
          <table className="cc-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>Comprobante</th>
                <th>Proveedor</th>
                <th>Monto</th>
                <th>Asiento</th>
                <th>Estado</th>
                {activo && <th></th>}
              </tr>
            </thead>
            <tbody>
              {fondo.movimientos.map((m) => (
                <tr key={m.id} className={m.anulado ? 'cc-row-anulado' : ''}>
                  <td className="cc-mono">{m.numero || `#${m.id}`}</td>
                  <td>{formatFecha(m.fecha)}</td>
                  <td>
                    <span className={`cc-badge cc-tipo-${m.tipo.toLowerCase()}`}>
                      {TIPO_LABEL[m.tipo] || m.tipo}
                    </span>
                  </td>
                  <td>{m.concepto}</td>
                  <td className="cc-mono">{m.nroComprobante || '—'}</td>
                  <td>{m.proveedor || '—'}</td>
                  <td className={`cc-monto ${TIPO_SIGNO[m.tipo] === '+' ? 'cc-positivo' : TIPO_SIGNO[m.tipo] === '-' ? 'cc-negativo' : ''}`}>
                    {TIPO_SIGNO[m.tipo]}{formatMoney(m.monto)}
                  </td>
                  <td>
                    {m.asiento
                      ? <span className="cc-asiento-link" title={m.asiento.numero}>✓ {m.asiento.numero}</span>
                      : <span className="cc-sin-asiento">—</span>}
                  </td>
                  <td>
                    {m.anulado
                      ? <span className="cc-badge cc-badge-anulado">Anulado</span>
                      : <span className="cc-badge cc-badge-ok">Activo</span>}
                  </td>
                  {activo && (
                    <td>
                      {!m.anulado && m.tipo === 'GASTO' && (
                        <button className="cc-btn-anular" onClick={() => handleAnularVale(m.id)}>Anular</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal === 'gasto' && (
        <ModalGasto
          cajaChicaId={fondoId}
          saldoDisponible={fondo.saldoDisponible}
          onClose={() => setModal(null)}
          onSaved={() => onAccionFin('Gasto registrado')}
        />
      )}
      {modal === 'reponer' && (
        <ModalAccion
          titulo="Reponer fondo"
          accion="reponer"
          cajaChicaId={fondoId}
          totalPendiente={fondo.totalPendienteReponer}
          saldoDisponible={fondo.saldoDisponible}
          onClose={() => setModal(null)}
          onSaved={() => onAccionFin('Reposición registrada con asiento contable')}
        />
      )}
      {modal === 'incrementar' && (
        <ModalAccion
          titulo="Incrementar fondo"
          accion="incrementar"
          cajaChicaId={fondoId}
          saldoDisponible={fondo.saldoDisponible}
          onClose={() => setModal(null)}
          onSaved={() => onAccionFin('Fondo incrementado')}
        />
      )}
      {modal === 'disminuir' && (
        <ModalAccion
          titulo="Disminuir fondo"
          accion="disminuir"
          cajaChicaId={fondoId}
          saldoDisponible={fondo.saldoDisponible}
          onClose={() => setModal(null)}
          onSaved={() => onAccionFin('Fondo disminuido')}
        />
      )}
    </div>
  );
}

// ─── Hub principal ────────────────────────────────────────────────────────────
export default function CajaChicaHub() {
  const [tab, setTab] = useState('activos');
  const [fondos, setFondos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [showNuevo, setShowNuevo] = useState(false);
  const [fondoSeleccionado, setFondoSeleccionado] = useState(null);
  const [toast, setToast] = useState('');

  const cargarFondos = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.get('/caja-chica');
      setFondos(r.data.data || []);
    } catch {
      // silencioso
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargarFondos(); }, [cargarFondos]);

  if (fondoSeleccionado) {
    return (
      <FondoDetalle
        fondoId={fondoSeleccionado}
        onVolver={() => setFondoSeleccionado(null)}
        onRefreshLista={cargarFondos}
      />
    );
  }

  const fondosActivos = fondos.filter((f) => f.estado === 'ACTIVO');
  const fondosCerrados = fondos.filter((f) => f.estado === 'CERRADO');
  const lista = tab === 'activos' ? fondosActivos : fondosCerrados;

  return (
    <div className="cc-hub">
      {toast && <div className="cc-toast">{toast}</div>}

      <div className="cc-hub-header">
        <div>
          <h1 className="cc-hub-title">Caja Chica</h1>
          <p className="cc-hub-subtitle">Fondos fijos de efectivo para gastos menores</p>
        </div>
        <button className="cc-btn cc-btn-primary" onClick={() => setShowNuevo(true)}>
          + Nuevo fondo
        </button>
      </div>

      <div className="cc-tabs">
        <button className={`cc-tab ${tab === 'activos' ? 'active' : ''}`} onClick={() => setTab('activos')}>
          Fondos activos <span className="cc-tab-count">{fondosActivos.length}</span>
        </button>
        <button className={`cc-tab ${tab === 'cerrados' ? 'active' : ''}`} onClick={() => setTab('cerrados')}>
          Fondos cerrados <span className="cc-tab-count">{fondosCerrados.length}</span>
        </button>
      </div>

      {cargando ? (
        <div className="cc-loading">Cargando fondos...</div>
      ) : lista.length === 0 ? (
        <div className="cc-vacio-block">
          <p>{tab === 'activos' ? 'No hay fondos activos.' : 'No hay fondos cerrados.'}</p>
          {tab === 'activos' && (
            <button className="cc-btn cc-btn-primary" onClick={() => setShowNuevo(true)}>Crear primer fondo</button>
          )}
        </div>
      ) : (
        <div className="cc-fondos-grid">
          {lista.map((f) => {
            const pct = f.montoFondo > 0
              ? Math.min(100, Math.round((f.saldoDisponible / f.montoFondo) * 100))
              : 0;
            return (
              <div key={f.id} className="cc-fondo-card" onClick={() => setFondoSeleccionado(f.id)}>
                <div className="cc-fondo-card-header">
                  <div>
                    <span className="cc-fondo-codigo">{f.codigo}</span>
                    <span className={`cc-badge cc-badge-${f.estado.toLowerCase()}`}>{f.estado}</span>
                  </div>
                  <span className="cc-fondo-responsable">{f.responsable?.nombre || 'Sin responsable'}</span>
                </div>
                <h3 className="cc-fondo-nombre">{f.nombre}</h3>
                <div className="cc-fondo-montos">
                  <div>
                    <span className="cc-fondo-label">Fondo</span>
                    <span className="cc-fondo-monto">${formatMoney(f.montoFondo)}</span>
                  </div>
                  <div>
                    <span className="cc-fondo-label">Disponible</span>
                    <span className={`cc-fondo-monto ${pct < 25 ? 'cc-low' : ''}`}>${formatMoney(f.saldoDisponible)}</span>
                  </div>
                </div>
                <div className="cc-progress-bar">
                  <div
                    className="cc-progress-fill"
                    style={{ width: `${pct}%`, background: pct < 25 ? '#ef4444' : pct < 50 ? '#f59e0b' : '#22c55e' }}
                  />
                </div>
                <span className="cc-fondo-pct">{pct}% disponible</span>
                {f.fechaCierre && <p className="cc-fondo-cerrado-en">Cerrado: {formatFecha(f.fechaCierre)}</p>}
              </div>
            );
          })}
        </div>
      )}

      {showNuevo && (
        <ModalNuevoFondo
          onClose={() => setShowNuevo(false)}
          onSaved={() => {
            setShowNuevo(false);
            cargarFondos();
            setToast('Fondo creado y apertura registrada');
            setTimeout(() => setToast(''), 3000);
          }}
        />
      )}
    </div>
  );
}
