import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatFechaCorta } from '../../utils/fecha';
import './TalentoHumano.css';

const TIPOS = [
  { value: 'DECIMO_TERCERO', label: 'Décimo Tercero', icon: '🎄' },
  { value: 'DECIMO_CUARTO', label: 'Décimo Cuarto', icon: '🎒' },
  { value: 'UTILIDADES', label: 'Utilidades 15%', icon: '📈' },
  { value: 'LIQUIDACION', label: 'Liquidación de Haberes', icon: '🧾' },
];

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-EC', { minimumFractionDigits: 2 })}`;

const etiquetaTipo = (tipo) => TIPOS.find((t) => t.value === tipo)?.label || tipo;

const PagosEspeciales = () => {
  const hoy = new Date();
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [pagoSel, setPagoSel] = useState(null);
  const [detLoading, setDetLoading] = useState(false);
  const [modalGenerar, setModalGenerar] = useState(false);
  const [tipoGenerar, setTipoGenerar] = useState('DECIMO_TERCERO');
  const [anioGenerar, setAnioGenerar] = useState(hoy.getFullYear());
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (tipoFiltro) params.tipo = tipoFiltro;
      const r = await api.get('/talento-humano/nomina/especiales', { params });
      setPagos(r.data.data);
    } catch {
      toast.error('Error al cargar pagos especiales');
    } finally {
      setLoading(false);
    }
  }, [tipoFiltro]);

  useEffect(() => { cargar(); }, [cargar]);

  const verDetalle = async (id) => {
    setDetLoading(true);
    try {
      const r = await api.get(`/talento-humano/nomina/especiales/${id}`);
      setPagoSel(r.data.data);
    } catch {
      toast.error('Error al cargar detalle');
    } finally {
      setDetLoading(false);
    }
  };

  const generar = async (e) => {
    e.preventDefault();
    setGenerando(true);
    try {
      const path = tipoGenerar === 'UTILIDADES'
        ? '/talento-humano/nomina/especiales/generar-utilidades'
        : '/talento-humano/nomina/especiales/generar-decimo';
      const body = tipoGenerar === 'UTILIDADES'
        ? { anio: anioGenerar }
        : { tipo: tipoGenerar, anio: anioGenerar };
      await api.post(path, body);
      toast.success('Corrida generada en BORRADOR — revisa el detalle antes de pagar');
      setModalGenerar(false);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al generar la corrida');
    } finally {
      setGenerando(false);
    }
  };

  const pagar = async (pago) => {
    if (!confirm(`¿Registrar el pago de ${etiquetaTipo(pago.tipo)} ${pago.anio} por ${fmt(pago.totalPagado)}? Se generará el asiento contable y no se puede deshacer con un botón.`)) return;
    try {
      await api.patch(`/talento-humano/nomina/especiales/${pago.id}/pagar`);
      toast.success('Pago registrado — asiento generado en el Libro Diario');
      cargar();
      if (pagoSel?.id === pago.id) verDetalle(pago.id);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al registrar el pago');
    }
  };

  const eliminar = async (pago) => {
    if (!confirm('¿Eliminar esta corrida en borrador?')) return;
    try {
      await api.delete(`/talento-humano/nomina/especiales/${pago.id}`);
      toast.success('Eliminado');
      if (pagoSel?.id === pago.id) setPagoSel(null);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error');
    }
  };

  const aniosDisponibles = [];
  for (let a = hoy.getFullYear() + 1; a >= hoy.getFullYear() - 5; a--) aniosDisponibles.push(a);

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>🎁 Pagos Especiales</h1>
        <div className="th-toolbar">
          <select className="th-search" style={{ minWidth: 180 }} value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
          </select>
          <button className="btn-th-primary" onClick={() => setModalGenerar(true)}>+ Generar corrida</button>
        </div>
      </div>

      <p style={{ fontSize: '0.85rem', color: '#718096', marginTop: '-0.5rem', marginBottom: '1rem' }}>
        Décimo tercero/cuarto y liquidación descargan la provisión ya acumulada mes a mes en la nómina regular.
        Utilidades requiere que el ejercicio esté cerrado en Contabilidad. Liquidación de haberes se genera desde
        Empleados → 🧾 Liquidar.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: pagoSel ? '1fr 1.4fr' : '1fr', gap: '1rem' }}>
        <div>
          {loading ? (
            <div className="th-loading">Cargando…</div>
          ) : (
            <div className="th-table-wrapper">
              <table className="th-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Año</th>
                    <th>Empleados</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#a0aec0' }}>Sin corridas registradas</td></tr>
                  ) : pagos.map((p) => (
                    <tr key={p.id} style={{ cursor: 'pointer', background: pagoSel?.id === p.id ? 'var(--color-surface-alt,#f7fafc)' : '' }}>
                      <td onClick={() => verDetalle(p.id)}>{TIPOS.find((t) => t.value === p.tipo)?.icon} {etiquetaTipo(p.tipo)}</td>
                      <td onClick={() => verDetalle(p.id)}>{p.anio}</td>
                      <td onClick={() => verDetalle(p.id)}>{p._count?.detalles ?? '—'}</td>
                      <td onClick={() => verDetalle(p.id)}>{fmt(p.totalPagado)}</td>
                      <td onClick={() => verDetalle(p.id)}>
                        <span className={p.estado === 'PAGADA' ? 'badge-pagada' : 'badge-borrador'}>{p.estado}</span>
                      </td>
                      <td>
                        <div className="actions">
                          {p.estado === 'BORRADOR' && (
                            <>
                              <button className="btn-th-sm" onClick={() => pagar(p)}>💵 Pagar</button>
                              <button className="btn-th-danger" onClick={() => eliminar(p)}>🗑</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pagoSel && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                {etiquetaTipo(pagoSel.tipo)} {pagoSel.anio} — <span className={pagoSel.estado === 'PAGADA' ? 'badge-pagada' : 'badge-borrador'}>{pagoSel.estado}</span>
              </h2>
              <button className="btn-th-secondary" onClick={() => setPagoSel(null)}>✕ Cerrar</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--color-surface-alt,#f7fafc)', border: '1px solid var(--color-border,#e2e8f0)', borderRadius: 8, padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted,#718096)', textTransform: 'uppercase' }}>Período</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{formatFechaCorta(pagoSel.periodoDesde)} — {formatFechaCorta(pagoSel.periodoHasta)}</div>
              </div>
              <div style={{ background: 'var(--color-surface-alt,#f7fafc)', border: '1px solid var(--color-border,#e2e8f0)', borderRadius: 8, padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted,#718096)', textTransform: 'uppercase' }}>Total</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary,#3b82f6)' }}>{fmt(pagoSel.totalPagado)}</div>
              </div>
              <div style={{ background: 'var(--color-surface-alt,#f7fafc)', border: '1px solid var(--color-border,#e2e8f0)', borderRadius: 8, padding: '0.75rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted,#718096)', textTransform: 'uppercase' }}>Fecha de pago</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{pagoSel.fechaPago ? formatFechaCorta(pagoSel.fechaPago) : '—'}</div>
              </div>
            </div>

            {pagoSel.observaciones && (
              <p style={{ fontSize: '0.8rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '1rem' }}>
                {pagoSel.observaciones}
              </p>
            )}

            {detLoading ? <div className="th-loading">Cargando…</div> : (
              <div className="th-table-wrapper" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="th-table">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Base / Días</th>
                      <th>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagoSel.detalles?.map((d) => {
                      let comp = null;
                      try { comp = d.detalleJson ? JSON.parse(d.detalleJson) : null; } catch { comp = null; }
                      return (
                        <tr key={d.id}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{d.empleado.apellidos}, {d.empleado.nombres}</div>
                            {comp && (
                              <div style={{ fontSize: '0.72rem', color: '#a0aec0' }}>
                                {Object.entries(comp).map(([k, v]) => `${k}: ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td>{fmt(d.baseCalculo)}{d.diasBase != null ? ` · ${d.diasBase}d` : ''}</td>
                          <td style={{ fontWeight: 600 }}>{fmt(d.valor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {modalGenerar && (
        <div className="th-modal-overlay">
          <div className="th-modal">
            <h2>Generar corrida de pago</h2>
            <form onSubmit={generar}>
              <div className="th-form-grid">
                <div className="th-form-group">
                  <label>Tipo *</label>
                  <select value={tipoGenerar} onChange={(e) => setTipoGenerar(e.target.value)}>
                    {TIPOS.filter((t) => t.value !== 'LIQUIDACION').map((t) => (
                      <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="th-form-group">
                  <label>Año *</label>
                  <select value={anioGenerar} onChange={(e) => setAnioGenerar(parseInt(e.target.value))}>
                    {aniosDisponibles.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#718096' }}>
                {tipoGenerar === 'UTILIDADES'
                  ? 'Requiere que el ejercicio del año elegido ya esté cerrado en Contabilidad → Cierre y Estados.'
                  : 'Suma la provisión mensual ya acumulada en el período legal de acumulación del año elegido.'}
              </p>
              <div className="th-modal-actions">
                <button type="button" className="btn-th-secondary" onClick={() => setModalGenerar(false)}>Cancelar</button>
                <button type="submit" className="btn-th-primary" disabled={generando}>
                  {generando ? 'Generando…' : 'Generar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PagosEspeciales;
