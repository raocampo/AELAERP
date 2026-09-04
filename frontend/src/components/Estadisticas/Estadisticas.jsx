// ====================================
// ESTADÍSTICAS — Ventas mensuales
// frontend/src/components/Estadisticas/Estadisticas.jsx
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import api from '../../services/api';
import { hoyLocal } from '../../utils/fecha';
import './Estadisticas.css';

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Mismo criterio de "año actual" usado en el resto del sistema esta sesión
// (diaCalendarioEC en el backend): hoyLocal() usa la hora LOCAL del
// navegador, nunca new Date().getFullYear() crudo (que en el servidor
// sería UTC, pero acá también evita depender de la hora del navegador tal
// cual si algún día se necesita mover esta lógica al backend).
const anioActual = () => Number(hoyLocal().slice(0, 4));

function TooltipMes({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="est-tooltip">
      <strong>{label}</strong>
      <span>{fmt(d.ventasTotal)}</span>
      <small>{d.comprobantes} comprobante{d.comprobantes === 1 ? '' : 's'}</small>
    </div>
  );
}

export default function Estadisticas() {
  const [anio, setAnio] = useState(anioActual());
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const res = await api.get('/estadisticas/ventas-mensuales', { params: { anio } });
      setData(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudieron cargar las estadísticas');
    } finally {
      setCargando(false);
    }
  }, [anio]);

  useEffect(() => { cargar(); }, [cargar]);

  const hoy = anioActual();
  const anios = Array.from({ length: 5 }, (_, i) => hoy - i);
  const mejorMes = data?.meses?.reduce((mejor, m) => (m.ventasTotal > (mejor?.ventasTotal || 0) ? m : mejor), null);

  return (
    <div className="est-root">
      <div className="est-header">
        <div>
          <h1>📈 Estadísticas</h1>
          <p>Ventas mensuales del año — Facturas y Notas de Venta combinadas.</p>
        </div>
        <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {error && <div className="est-error">{error}</div>}

      {cargando ? (
        <div className="est-empty">Cargando estadísticas...</div>
      ) : !data ? (
        <div className="est-empty">No se pudo cargar la información.</div>
      ) : (
        <>
          <div className="est-metrics">
            <div className="est-metric est-metric--purple">
              <span>Total {anio}</span>
              <strong>{fmt(data.totalAnio)}</strong>
              <small>{data.comprobantesAnio} comprobantes</small>
            </div>
            <div className="est-metric est-metric--green">
              <span>Ticket promedio</span>
              <strong>{fmt(data.ticketPromedioAnio)}</strong>
              <small>por comprobante</small>
            </div>
            <div className="est-metric est-metric--blue">
              <span>Mejor mes</span>
              <strong>{mejorMes && mejorMes.ventasTotal > 0 ? mejorMes.nombre : '—'}</strong>
              <small>{mejorMes && mejorMes.ventasTotal > 0 ? fmt(mejorMes.ventasTotal) : 'Sin ventas todavía'}</small>
            </div>
          </div>

          <div className="est-card">
            <h2>Ventas por mes</h2>
            <div className="est-chart">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.meses} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="nombre" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`} />
                  <Tooltip content={<TooltipMes />} cursor={{ fill: 'rgba(124, 58, 237, 0.06)' }} />
                  <Bar dataKey="ventasTotal" fill="#7C3AED" radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="est-card">
            <h2>Detalle mensual</h2>
            <div className="est-table-wrap">
              <table className="est-table">
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Facturas</th>
                    <th>Notas de venta</th>
                    <th>Total</th>
                    <th>Comprobantes</th>
                    <th>Ticket promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {data.meses.map((m) => (
                    <tr key={m.mes}>
                      <td>{m.nombre}</td>
                      <td>{fmt(m.ventasFacturas)}</td>
                      <td>{fmt(m.ventasNotas)}</td>
                      <td className="est-td-total">{fmt(m.ventasTotal)}</td>
                      <td>{m.comprobantes}</td>
                      <td>{fmt(m.ticketPromedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
