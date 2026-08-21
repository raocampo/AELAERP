import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './Restaurante.css';

function primerDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hoy() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReportesRestaurante() {
  const [tab, setTab] = useState('ventas'); // 'ventas' | 'equilibrio'
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoy());
  const [agruparPor, setAgruparPor] = useState('mesa');
  const [ventas, setVentas] = useState(null);
  const [equilibrio, setEquilibrio] = useState(null);
  const [loading, setLoading] = useState(true);

  const cargarVentas = () => {
    setLoading(true);
    api.get('/mesas/reportes/ventas', { params: { desde, hasta, agruparPor } })
      .then((r) => setVentas(r.data))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'No se pudo cargar el reporte de ventas'))
      .finally(() => setLoading(false));
  };

  const cargarEquilibrio = () => {
    setLoading(true);
    api.get('/mesas/reportes/punto-equilibrio', { params: { desde, hasta } })
      .then((r) => setEquilibrio(r.data))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'No se pudo calcular el punto de equilibrio'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (tab === 'ventas') cargarVentas(); else cargarEquilibrio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, desde, hasta, agruparPor]);

  return (
    <div className="rest-page">
      <div className="rest-header">
        <div>
          <h1>📊 Reportes</h1>
          <p>Ventas por mesa, mesero o franja horaria, y punto de equilibrio del negocio.</p>
        </div>
      </div>

      <div className="rest-reportes-tabs">
        <button className={tab === 'ventas' ? 'active' : ''} onClick={() => setTab('ventas')}>Ventas</button>
        <button className={tab === 'equilibrio' ? 'active' : ''} onClick={() => setTab('equilibrio')}>Punto de equilibrio</button>
      </div>

      <div className="rest-filters">
        <label>
          <span>Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          <span>Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        {tab === 'ventas' && (
          <label>
            <span>Agrupar por</span>
            <select value={agruparPor} onChange={(e) => setAgruparPor(e.target.value)}>
              <option value="mesa">Mesa</option>
              <option value="mesero">Mesero</option>
              <option value="hora">Franja horaria</option>
            </select>
          </label>
        )}
      </div>

      {loading ? (
        <div className="rest-empty">Cargando...</div>
      ) : tab === 'ventas' ? (
        <>
          <div className="rest-kpis">
            <div className="rest-kpi"><span>Comandas cerradas</span><strong>{ventas?.cantidadComandas ?? 0}</strong></div>
            <div className="rest-kpi"><span>Ventas totales</span><strong>${(ventas?.totalGeneral ?? 0).toFixed(2)}</strong></div>
          </div>
          {!ventas?.data?.length ? (
            <div className="rest-empty">Sin ventas cerradas en el período seleccionado.</div>
          ) : (
            <table className="rest-reportes-tabla">
              <thead>
                <tr>
                  <th>{agruparPor === 'mesa' ? 'Mesa' : agruparPor === 'mesero' ? 'Mesero' : 'Franja horaria'}</th>
                  <th>Comandas</th>
                  <th>Subtotal</th>
                  <th>IVA</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {ventas.data.map((g) => (
                  <tr key={g.clave}>
                    <td>{g.etiqueta}</td>
                    <td>{g.cantidadComandas}</td>
                    <td>${g.subtotal.toFixed(2)}</td>
                    <td>${g.totalIva.toFixed(2)}</td>
                    <td><strong>${g.total.toFixed(2)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <div className="rest-equilibrio">
          {!equilibrio?.configurado ? (
            <div className="rest-empty">{equilibrio?.mensaje || 'Configura tus costos fijos mensuales en Configuración del Sistema → Mesas y Comandas.'}</div>
          ) : !equilibrio?.puntoEquilibrioVentas ? (
            <div className="rest-empty">{equilibrio?.mensaje || 'No hay suficiente información para calcular el punto de equilibrio.'}</div>
          ) : (
            <>
              <div className="rest-kpis">
                <div className="rest-kpi"><span>Costos fijos mensuales</span><strong>${equilibrio.costosFijosMensuales.toFixed(2)}</strong></div>
                <div className="rest-kpi"><span>Margen de contribución</span><strong>{(equilibrio.margenContribucion * 100).toFixed(1)}%</strong></div>
                <div className="rest-kpi"><span>Ticket promedio</span><strong>${equilibrio.ticketPromedio.toFixed(2)}</strong></div>
              </div>
              <div className="rest-equilibrio-resultado">
                <div>
                  <span>Punto de equilibrio (ventas/mes)</span>
                  <strong>${equilibrio.puntoEquilibrioVentas.toFixed(2)}</strong>
                </div>
                {equilibrio.puntoEquilibrioComandas && (
                  <div>
                    <span>Equivale a ~</span>
                    <strong>{equilibrio.puntoEquilibrioComandas} comandas/mes</strong>
                  </div>
                )}
              </div>
              <p className="rest-equilibrio-nota">
                Costo variable estimado en {(equilibrio.ratioCostoVariable * 100).toFixed(1)}% de las ventas, calculado
                con el costo unitario de cada producto vendido en el período ({desde} a {hasta}, ventas netas: $
                {equilibrio.ventasNetasPeriodo?.toFixed(2)}). No reemplaza un análisis de costos completo — es una
                estimación estándar de punto de equilibrio.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
