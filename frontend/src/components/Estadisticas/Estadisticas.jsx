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
      <small>Efectivo {fmt(d.efectivo)} · Bancos {fmt(d.banco)}</small>
      <small>{d.comprobantes} comprobante{d.comprobantes === 1 ? '' : 's'}</small>
    </div>
  );
}

export default function Estadisticas() {
  const [anio, setAnio] = useState(anioActual());
  const [data, setData] = useState(null);
  const [productos, setProductos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    const [ventasRes, productosRes] = await Promise.allSettled([
      api.get('/estadisticas/ventas-mensuales', { params: { anio } }),
      api.get('/estadisticas/top-productos', { params: { anio, limit: 10 } }),
    ]);
    if (ventasRes.status === 'fulfilled') {
      setData(ventasRes.value.data?.data || null);
    } else {
      setError(ventasRes.reason?.response?.data?.mensaje || 'No se pudieron cargar las estadísticas');
      setData(null);
    }
    // El top de productos es un complemento — si falla, no bloquea el resto.
    setProductos(productosRes.status === 'fulfilled' ? productosRes.value.data?.data?.productos || [] : []);
    setCargando(false);
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
            {(() => {
              if (data.variacionPct === null || data.variacionPct === undefined) {
                return (
                  <div className="est-metric">
                    <span>vs {data.anioAnterior}</span>
                    <strong>—</strong>
                    <small>Sin ventas en {data.anioAnterior}</small>
                  </div>
                );
              }
              const sube = data.variacionPct >= 0;
              const color = sube ? '#16a34a' : '#dc2626';
              const delta = Math.abs(data.totalAnio - data.totalAnioAnterior);
              return (
                <div className="est-metric" style={{ borderLeftColor: color }}>
                  <span>vs {data.anioAnterior}</span>
                  <strong style={{ color }}>{sube ? '+' : '-'}{Math.abs(data.variacionPct)}%</strong>
                  <small>{sube ? `${fmt(delta)} más` : `${fmt(delta)} menos`}</small>
                </div>
              );
            })()}
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
                  <Bar dataKey="efectivo" stackId="ventas" fill="#7C3AED" name="Efectivo" />
                  <Bar dataKey="banco" stackId="ventas" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={48} name="Bancos" />
                </BarChart>
              </ResponsiveContainer>
              <div className="est-chart-legend">
                <span><i style={{ background: '#7C3AED' }} /> Efectivo</span>
                <span><i style={{ background: '#2563eb' }} /> Bancos</span>
              </div>
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
                    <th>Efectivo</th>
                    <th>Bancos</th>
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
                      <td>{fmt(m.efectivo)}</td>
                      <td>{fmt(m.banco)}</td>
                      <td className="est-td-total">{fmt(m.ventasTotal)}</td>
                      <td>{m.comprobantes}</td>
                      <td>{fmt(m.ticketPromedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="est-card">
            <h2>Top 10 productos del año</h2>
            {!productos?.length ? (
              <div className="est-empty">Sin ventas de productos todavía en {anio}.</div>
            ) : (
              <div className="est-table-wrap">
                <table className="est-table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productos.map((p) => (
                      <tr key={p.codigo || p.descripcion}>
                        <td>{p.descripcion}</td>
                        <td>{p.cantidad}</td>
                        <td className="est-td-total">{fmt(p.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
