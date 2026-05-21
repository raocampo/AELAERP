import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { descargarCsv } from '../../utils/exportCsv';
import { parseFechaLocal } from '../../utils/fecha';
import './ListaCompras.css';

const FILTROS_INICIALES = {
  busqueda: '',
  fechaDesde: '',
  fechaHasta: '',
  tipoGasto: '',
};

const TIPO_GASTO_OPCIONES = [
  { value: '', label: 'Todos los tipos' },
  { value: 'SALUD', label: '🏥 Salud' },
  { value: 'EDUCACION', label: '📚 Educación' },
  { value: 'ALIMENTACION', label: '🍽 Alimentación' },
  { value: 'VIVIENDA', label: '🏠 Vivienda' },
  { value: 'VESTIMENTA', label: '👔 Vestimenta' },
  { value: 'TURISMO', label: '✈ Turismo' },
  { value: 'OTROS', label: '📦 Otros deducibles' },
  { value: 'SIN_CLASIFICAR', label: '⚠ Sin clasificar' },
];

function fmtFecha(valor) {
  if (!valor) return 'Sin fecha';
  const fecha = parseFechaLocal(valor);
  return Number.isNaN(fecha.getTime()) ? 'Sin fecha' : fecha.toLocaleDateString('es-EC');
}

function fmtMoneda(valor) {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(valor || 0));
}

export default function ListaCompras() {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    let ignore = false;

    const cargar = async () => {
      setLoading(true);
      try {
        const res = await api.get('/compras', { params: filtros });
        if (!ignore) {
          setItems(res.data?.data || []);
          setTotal(res.data?.total || 0);
        }
      } catch (error) {
        if (!ignore) toast.error(error.response?.data?.mensaje || 'No se pudo cargar el módulo de compras');
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    cargar();
    return () => { ignore = true; };
  }, [filtros]);

  const actualizarFiltro = (campo, valor) => {
    setFiltros((prev) => ({ ...prev, [campo]: valor }));
  };

  const exportarCsv = async () => {
    setExportando(true);
    try {
      const fecha = new Date().toISOString().slice(0, 10);
      await descargarCsv(api, '/compras/exportar/csv', filtros, `compras-${fecha}.csv`);
      toast.success('CSV exportado correctamente');
    } catch {
      toast.error('No se pudo exportar el CSV');
    } finally {
      setExportando(false);
    }
  };

  const totalCompras = items.reduce((acc, item) => acc + Number(item.importeTotal || 0), 0);
  const conInventario = items.filter((item) => item.movimientosInventario > 0).length;

  return (
    <div className="compras-page">
      <div className="compras-header">
        <div>
          <h1>Compras</h1>
          <p>Registro formal de facturas de compra con impacto opcional en productos, inventario y caja.</p>
        </div>
        <div className="compras-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/dashboard')}>Volver</button>
          <button className="btn-secondary" onClick={exportarCsv} disabled={exportando || items.length === 0}>
            {exportando ? 'Exportando…' : '⬇ CSV'}
          </button>
          <button className="btn-primary" onClick={() => navigate('/compras/nueva')}>Nueva compra</button>
        </div>
      </div>

      <section className="compras-summary">
        <article className="compras-summary-card">
          <span>Total registros</span>
          <strong>{total}</strong>
        </article>
        <article className="compras-summary-card">
          <span>Total visible</span>
          <strong>{fmtMoneda(totalCompras)}</strong>
        </article>
        <article className="compras-summary-card">
          <span>Con inventario</span>
          <strong>{conInventario}</strong>
        </article>
      </section>

      <section className="compras-filtros">
        <input
          value={filtros.busqueda}
          onChange={(e) => actualizarFiltro('busqueda', e.target.value)}
          placeholder="Buscar por proveedor, RUC o número"
        />
        <input
          type="date"
          value={filtros.fechaDesde}
          onChange={(e) => actualizarFiltro('fechaDesde', e.target.value)}
        />
        <input
          type="date"
          value={filtros.fechaHasta}
          onChange={(e) => actualizarFiltro('fechaHasta', e.target.value)}
        />
        <select
          value={filtros.tipoGasto}
          onChange={(e) => actualizarFiltro('tipoGasto', e.target.value)}
        >
          {TIPO_GASTO_OPCIONES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button className="btn-secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar</button>
      </section>

      <section className="compras-card">
        {loading ? (
          <div className="compras-empty">Cargando compras...</div>
        ) : items.length === 0 ? (
          <div className="compras-empty">
            No hay facturas de compra registradas todavía. Puedes empezar con una carga manual, XML o autorización SRI.
          </div>
        ) : (
          <div className="compras-table-wrap">
            <table className="compras-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Factura</th>
                  <th>Proveedor</th>
                  <th>Autorización</th>
                  <th>Total</th>
                  <th>Tipo Gasto</th>
                  <th>Origen</th>
                  <th>Operación</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{fmtFecha(item.fechaEmision)}</td>
                  <td>
                    <div>
                      <strong style={{ textDecoration: item.anulada ? 'line-through' : 'none', color: item.anulada ? '#94a3b8' : undefined }}>
                        {item.numeroFactura}
                      </strong>
                      {item.anulada && <span className="compras-chip anulada" style={{ marginLeft: 6 }}>Anulada</span>}
                    </div>
                  </td>
                    <td>
                      <div className="compras-provider">
                        <strong>{item.razonSocialProveedor}</strong>
                        <span>{item.identificacionProveedor}</span>
                      </div>
                    </td>
                    <td>{item.numeroAutorizacion || 'Sin autorización'}</td>
                    <td>{fmtMoneda(item.importeTotal)}</td>
                    <td>
                      {item.tipoGasto
                        ? <span className={`compras-chip tipo-gasto-${item.tipoGasto.toLowerCase()}`}>{item.tipoGasto}</span>
                        : <span className="compras-chip sin-clasificar">—</span>}
                    </td>
                    <td>
                      <span className={`compras-chip ${String(item.origenRegistro || '').toLowerCase()}`}>
                        {item.origenRegistro || 'MANUAL'}
                      </span>
                    </td>
                    <td>
                      <div className="compras-operacion">
                        <div className="compras-flags">
                          {item.movimientosInventario > 0 && <span className="compras-flag ok">Inventario</span>}
                          {item.egresoCajaRegistrado && <span className="compras-flag warn">Caja</span>}
                          {!item.egresoCajaRegistrado && item.movimientosInventario === 0 && <span className="compras-flag">Solo registro</span>}
                        </div>
                        <button
                          className="compras-link"
                          onClick={() => navigate(`/compras/${item.id}`)}
                        >
                          Ver detalle
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
