import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import './CajaDiaria.css';

const MOVIMIENTO_INICIAL = {
  tipo: 'INGRESO',
  monto: '',
  categoria: 'MANUAL',
  descripcion: '',
  referencia: '',
};

export default function CajaDiaria() {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState('apertura');
  const [resumen, setResumen] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [movimientoForm, setMovimientoForm] = useState(MOVIMIENTO_INICIAL);
  const [apertura, setApertura] = useState({ montoApertura: '', observacionesApertura: '' });
  const [cierre, setCierre] = useState({ montoCierreReal: '', observacionesCierre: '' });
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [resumenRes, historialRes] = await Promise.all([
        api.get('/caja/resumen', { params: { fecha } }),
        api.get('/caja/historial'),
      ]);
      const data = resumenRes.data?.data || null;
      setResumen(data);
      setHistorial(historialRes.data?.data || []);
      if (data?.resumen?.totalEsperado !== undefined) {
        setCierre((prev) => ({
          ...prev,
          montoCierreReal: prev.montoCierreReal || String(data.resumen.totalEsperado ?? ''),
        }));
      }
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo cargar la caja diaria');
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const registrarApertura = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.post('/caja/apertura', {
        fecha,
        montoApertura: Number(apertura.montoApertura || 0),
        observacionesApertura: apertura.observacionesApertura || undefined,
      });
      toast.success('Apertura de caja registrada');
      setApertura({ montoApertura: '', observacionesApertura: '' });
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo registrar la apertura');
    } finally {
      setGuardando(false);
    }
  };

  const registrarMovimiento = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.post('/caja/movimientos', {
        ...movimientoForm,
        fecha,
        monto: Number(movimientoForm.monto || 0),
      });
      toast.success('Movimiento de caja registrado');
      setMovimientoForm(MOVIMIENTO_INICIAL);
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo registrar el movimiento');
    } finally {
      setGuardando(false);
    }
  };

  const registrarCierre = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.post('/caja/cierre', {
        fecha,
        montoCierreReal: Number(cierre.montoCierreReal || 0),
        observacionesCierre: cierre.observacionesCierre || undefined,
      });
      toast.success('Caja cerrada correctamente');
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo cerrar la caja');
    } finally {
      setGuardando(false);
    }
  };

  const caja = resumen?.caja;
  const datos = resumen?.resumen;
  const movimientos = resumen?.movimientos || [];
  const tabs = [
    { key: 'apertura', label: 'Apertura' },
    { key: 'movimiento', label: 'Movimiento manual' },
    { key: 'cierre', label: 'Cierre' },
    { key: 'movimientos', label: 'Movimientos del día' },
    { key: 'historial', label: 'Historial reciente' },
  ];

  return (
    <div className="cash-page">
      <div className="cash-header">
        <div>
          <h1>Caja Diaria</h1>
          <p>Controla apertura, ventas del día, movimientos manuales y cierre operativo.</p>
        </div>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>

      {cargando ? (
        <div className="cash-empty">Cargando caja...</div>
      ) : (
        <>
          <div className="cash-kpis">
            <div className="cash-kpi"><span>Apertura</span><strong>${Number(datos?.montoApertura || 0).toFixed(2)}</strong></div>
            <div className="cash-kpi"><span>Ventas</span><strong>${Number(datos?.totalVentas || 0).toFixed(2)}</strong></div>
            <div className="cash-kpi"><span>Ingresos</span><strong>${Number(datos?.ingresosManuales || 0).toFixed(2)}</strong></div>
            <div className="cash-kpi"><span>Egresos</span><strong>${Number(datos?.egresosManuales || 0).toFixed(2)}</strong></div>
            <div className="cash-kpi"><span>Esperado</span><strong>${Number(datos?.totalEsperado || 0).toFixed(2)}</strong></div>
            <div className="cash-kpi"><span>Estado</span><strong>{caja?.estado || 'ABIERTA'}</strong></div>
            {datos?.diferenciaCierre !== null && datos?.diferenciaCierre !== undefined && (() => {
              const diff = Number(datos.diferenciaCierre);
              const label = diff > 0 ? 'Sobrante' : diff < 0 ? 'Faltante' : 'Cuadrado';
              const color = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#2563eb';
              return (
                <div className="cash-kpi">
                  <span>{label}</span>
                  <strong style={{ color }}>${Math.abs(diff).toFixed(2)}</strong>
                </div>
              );
            })()}
          </div>

          <section className="cash-card">
            <div className="cash-tabs">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={tab === item.key ? 'active' : ''}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'apertura' && (
              <>
                <h2>Apertura</h2>
                {!caja?.aperturaRegistrada ? (
                  <form className="cash-form" onSubmit={registrarApertura}>
                    <label>
                      <span>Monto de apertura</span>
                      <input type="number" min="0" step="0.01" value={apertura.montoApertura} onChange={(e) => setApertura((prev) => ({ ...prev, montoApertura: e.target.value }))} required />
                    </label>
                    <label>
                      <span>Observación</span>
                      <textarea rows="3" value={apertura.observacionesApertura} onChange={(e) => setApertura((prev) => ({ ...prev, observacionesApertura: e.target.value }))} />
                    </label>
                    <button type="submit" className="btn-primary" disabled={guardando}>Registrar apertura</button>
                  </form>
                ) : (
                  <div className="cash-status">
                    <strong>Apertura registrada</strong>
                    <span>${Number(caja?.montoApertura || 0).toFixed(2)}</span>
                    {caja?.observacionesApertura && <p>{caja.observacionesApertura}</p>}
                  </div>
                )}
              </>
            )}

            {tab === 'movimiento' && (
              <>
                <h2>Movimiento manual</h2>
                <form className="cash-form" onSubmit={registrarMovimiento}>
                  <label>
                    <span>Tipo</span>
                    <select value={movimientoForm.tipo} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, tipo: e.target.value }))}>
                      <option value="INGRESO">Ingreso</option>
                      <option value="EGRESO">Egreso</option>
                    </select>
                  </label>
                  <label>
                    <span>Monto</span>
                    <input type="number" min="0.01" step="0.01" value={movimientoForm.monto} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, monto: e.target.value }))} required />
                  </label>
                  <label>
                    <span>Categoría</span>
                    <input value={movimientoForm.categoria} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, categoria: e.target.value }))} />
                  </label>
                  <label>
                    <span>Referencia</span>
                    <input value={movimientoForm.referencia} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, referencia: e.target.value }))} />
                  </label>
                  <label>
                    <span>Descripción</span>
                    <textarea rows="3" value={movimientoForm.descripcion} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, descripcion: e.target.value }))} required />
                  </label>
                  <button type="submit" className="btn-secondary" disabled={guardando || caja?.estado === 'CERRADA'}>
                    Registrar movimiento
                  </button>
                </form>
              </>
            )}

            {tab === 'cierre' && (
              <>
                <h2>Cierre</h2>
                <form className="cash-form" onSubmit={registrarCierre}>
                  <label>
                    <span>Monto real de cierre</span>
                    <input type="number" min="0" step="0.01" value={cierre.montoCierreReal} onChange={(e) => setCierre((prev) => ({ ...prev, montoCierreReal: e.target.value }))} required />
                  </label>
                  <label>
                    <span>Observación</span>
                    <textarea rows="3" value={cierre.observacionesCierre} onChange={(e) => setCierre((prev) => ({ ...prev, observacionesCierre: e.target.value }))} />
                  </label>
                  {datos?.diferenciaCierre !== null && datos?.diferenciaCierre !== undefined && (() => {
                    const diff = Number(datos.diferenciaCierre);
                    const label = diff > 0 ? 'Sobrante' : diff < 0 ? 'Faltante' : 'Cuadrado';
                    const color = diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : '#2563eb';
                    return (
                      <p className="cash-note" style={{ color, fontWeight: 600 }}>
                        {label} registrado: ${Math.abs(diff).toFixed(2)}
                      </p>
                    );
                  })()}
                  <button type="submit" className="btn-primary" disabled={guardando || caja?.estado === 'CERRADA'}>
                    {caja?.estado === 'CERRADA' ? 'Caja cerrada' : 'Cerrar caja'}
                  </button>
                </form>
              </>
            )}

            {tab === 'movimientos' && (
              <>
                <h2>Movimientos del día</h2>
                <div className="cash-table-wrap">
                  <table className="cash-table">
                    <thead>
                      <tr>
                        <th>Hora</th>
                        <th>Tipo</th>
                        <th>Descripción</th>
                        <th>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimientos.map((movimiento) => (
                        <tr key={movimiento.id}>
                          <td>{new Date(movimiento.createdAt).toLocaleTimeString('es-EC')}</td>
                          <td>{movimiento.tipo}</td>
                          <td>{movimiento.descripcion || movimiento.referencia || 'Movimiento'}</td>
                          <td>${Number(movimiento.monto || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {movimientos.length === 0 && (
                        <tr><td colSpan="4" className="cash-empty">No hay movimientos registrados para este día.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {tab === 'historial' && (
              <>
                <h2>Historial reciente</h2>
                <div className="cash-table-wrap">
                  <table className="cash-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Estado</th>
                        <th>Apertura</th>
                        <th>Cierre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((item) => (
                        <tr key={item.id}>
                          <td>{formatFechaCorta(item.fechaOperacion)}</td>
                          <td>{item.estado}</td>
                          <td>${Number(item.montoApertura || 0).toFixed(2)}</td>
                          <td>{item.montoCierreReal === null || item.montoCierreReal === undefined ? 'Pendiente' : `$${Number(item.montoCierreReal).toFixed(2)}`}</td>
                        </tr>
                      ))}
                      {historial.length === 0 && (
                        <tr><td colSpan="4" className="cash-empty">Sin historial disponible.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
