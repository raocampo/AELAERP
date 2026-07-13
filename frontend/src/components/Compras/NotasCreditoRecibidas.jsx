import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { parseFechaLocal } from '../../utils/fecha';

function fmtFecha(valor) {
  if (!valor) return 'Sin fecha';
  const fecha = parseFechaLocal(valor);
  return Number.isNaN(fecha.getTime()) ? 'Sin fecha' : fecha.toLocaleDateString('es-EC');
}

function fmtMoneda(valor) {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(Number(valor || 0));
}

const FILTROS_INICIALES = { busqueda: '', fechaDesde: '', fechaHasta: '', page: 1 };

export default function NotasCreditoRecibidas() {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [xmlModal, setXmlModal] = useState(null);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    api.get('/compras/notas-credito', { params: filtros })
      .then((r) => {
        if (!ignore) {
          setItems(r.data?.data || []);
          setTotal(r.data?.total || 0);
          setPages(Math.ceil((r.data?.total || 0) / (r.data?.limit || 50)) || 1);
        }
      })
      .catch((err) => { if (!ignore) toast.error(err.response?.data?.mensaje || 'Error al cargar notas de crédito'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [filtros]);

  const actualizarFiltro = (campo, valor) =>
    setFiltros((prev) => ({ ...prev, [campo]: valor, ...(campo !== 'page' ? { page: 1 } : {}) }));

  const totalMonto = items.reduce((s, i) => s + Number(i.importeTotal || 0), 0);

  return (
    <div className="compras-page">
      <div className="compras-header">
        <div>
          <h1>Notas de Crédito Recibidas</h1>
          <p>Notas de crédito emitidas por proveedores y recibidas en el buzón SRI (tipo comprobante 04).</p>
        </div>
        <div className="compras-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/compras')}>Volver a Compras</button>
        </div>
      </div>

      {/* KPIs */}
      <section className="compras-summary">
        <article className="compras-summary-card"><span>Total registros</span><strong>{total}</strong></article>
        <article className="compras-summary-card"><span>Total período</span><strong>{fmtMoneda(totalMonto)}</strong></article>
      </section>

      {/* Filtros */}
      <section className="compras-filtros-panel">
        <input
          className="compras-filtro-input"
          placeholder="Buscar proveedor, RUC o clave..."
          value={filtros.busqueda}
          onChange={(e) => actualizarFiltro('busqueda', e.target.value)}
        />
        <input
          type="date"
          className="compras-filtro-input"
          value={filtros.fechaDesde}
          onChange={(e) => actualizarFiltro('fechaDesde', e.target.value)}
          title="Desde"
        />
        <input
          type="date"
          className="compras-filtro-input"
          value={filtros.fechaHasta}
          onChange={(e) => actualizarFiltro('fechaHasta', e.target.value)}
          title="Hasta"
        />
        <button className="btn-secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar</button>
      </section>

      {/* Tabla */}
      <section className="compras-card">
        {loading ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Cargando...</p>
        ) : items.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📭</p>
            <p>No hay notas de crédito recibidas de proveedores.</p>
            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Las notas de crédito se importan desde el Buzón SRI (documentos tipo 04).
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="compras-tabla">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Proveedor</th>
                  <th>RUC Emisor</th>
                  <th>Clave / Autorización</th>
                  <th style={{ textAlign: 'right' }}>Importe</th>
                  <th>Registrada</th>
                  <th>XML</th>
                </tr>
              </thead>
              <tbody>
                {items.map((nc) => (
                  <tr key={nc.id}>
                    <td>{fmtFecha(nc.fechaEmision)}</td>
                    <td style={{ fontWeight: 600 }}>{nc.razonSocialEmisor}</td>
                    <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{nc.rucEmisor}</td>
                    <td style={{ fontSize: '0.78rem', color: '#64748b', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {nc.claveAcceso}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoneda(nc.importeTotal)}</td>
                    <td style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {nc.createdAt ? fmtFecha(nc.createdAt) : '—'}
                    </td>
                    <td>
                      {nc.xmlAutorizado ? (
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                          onClick={() => setXmlModal(nc.xmlAutorizado)}
                        >
                          Ver XML
                        </button>
                      ) : (
                        <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {pages > 1 && (
          <div className="compras-paginacion">
            <button
              className="btn-secondary"
              disabled={filtros.page <= 1}
              onClick={() => actualizarFiltro('page', filtros.page - 1)}
            >
              ← Anterior
            </button>
            <span>Página {filtros.page} de {pages}</span>
            <button
              className="btn-secondary"
              disabled={filtros.page >= pages}
              onClick={() => actualizarFiltro('page', filtros.page + 1)}
            >
              Siguiente →
            </button>
          </div>
        )}
      </section>

      {/* Modal XML */}
      {xmlModal && (
        <div className="dc-modal-overlay" onClick={() => setXmlModal(null)}>
          <div className="dc-modal" style={{ maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
            <h3>XML Autorizado</h3>
            <pre style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.75rem', fontSize: '0.72rem', overflowX: 'auto', maxHeight: 500 }}>
              {xmlModal}
            </pre>
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <button className="btn-secondary" onClick={() => setXmlModal(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
