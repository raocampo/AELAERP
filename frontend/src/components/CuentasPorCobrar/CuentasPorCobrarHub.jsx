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
      {tabActivo === 'cheques'    && <TabProximamente nombre="Cheques recibidos" />}
      {tabActivo === 'ordenes'    && <TabProximamente nombre="Órdenes de pago" />}
      {tabActivo === 'recibos'    && <TabProximamente nombre="Recibos" />}
      {tabActivo === 'importar'   && <TabProximamente nombre="Importar cobros" />}
      {tabActivo === 'reportes'   && <TabProximamente nombre="Reportes de CxC" />}

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
