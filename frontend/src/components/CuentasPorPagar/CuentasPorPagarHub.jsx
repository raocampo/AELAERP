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

function TabProximamente({ nombre }) {
  return (
    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted,#64748b)' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🚧</div>
      <h3 style={{ margin: '0 0 0.5rem', color: '#1e293b' }}>{nombre}</h3>
      <p style={{ margin: 0 }}>Este módulo estará disponible próximamente.</p>
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
        <div style={{ display: 'grid', gridTemplateColumns: provSeleccionado ? '280px 1fr' : '1fr', gap: '1rem' }}>
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

// ─── CuentasPorPagarHub — componente principal ──────────────────
export default function CuentasPorPagarHub() {
  const [tabActivo, setTabActivo] = useState('vigentes');
  const [modalPago, setModalPago] = useState(null);
  const [refresco, setRefresco] = useState(0);

  const tabs = [
    { id: 'vigentes',        label: 'Cuentas vigentes' },
    { id: 'canceladas',      label: 'Cuentas canceladas' },
    { id: 'historial',       label: 'Historial de pagos' },
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
      {tabActivo === 'tarjetas'       && <TabProximamente nombre="Tarjetas de crédito" />}
      {tabActivo === 'libro-tarjetas' && <TabProximamente nombre="Libro tarjetas de crédito" />}
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
