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

// ─── CuentasPorPagarHub — componente principal ──────────────────
export default function CuentasPorPagarHub() {
  const [tabActivo, setTabActivo] = useState('vigentes');
  const [modalPago, setModalPago] = useState(null);
  const [refresco, setRefresco] = useState(0);

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="bancos-header">
        <h1>💳 Cuentas por Pagar</h1>
      </div>

      <div className="bancos-tabs">
        <button className={`bancos-tab ${tabActivo === 'vigentes' ? 'active' : ''}`} onClick={() => setTabActivo('vigentes')}>Vigentes</button>
        <button className={`bancos-tab ${tabActivo === 'canceladas' ? 'active' : ''}`} onClick={() => setTabActivo('canceladas')}>Canceladas</button>
        <button className={`bancos-tab ${tabActivo === 'historial' ? 'active' : ''}`} onClick={() => setTabActivo('historial')}>Historial de pagos</button>
      </div>

      {tabActivo === 'vigentes' && <TabCompras estado="vigentes" onPagar={setModalPago} key={`vig-${refresco}`} />}
      {tabActivo === 'canceladas' && <TabCompras estado="canceladas" key={`can-${refresco}`} />}
      {tabActivo === 'historial' && <TabHistorial key={`hist-${refresco}`} />}

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
