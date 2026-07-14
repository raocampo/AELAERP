import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { parseFechaLocal } from '../../utils/fecha';
import { IcXML } from '../../utils/icons';
import './ListaCompras.css';
import './DetalleCompra.css';

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
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="compras-header">
        <div>
          <h1>Notas de Crédito Recibidas</h1>
          <p>Notas de crédito emitidas por proveedores y recibidas en el buzón SRI (tipo comprobante 04).</p>
        </div>
        <div className="compras-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/compras')}>Volver a Compras</button>
        </div>
      </div>

      {/* ── KPIs ────────────────────────────────────────────────── */}
      <section className="compras-summary">
        <article className="compras-summary-card"><span>Total registros</span><strong>{total}</strong></article>
        <article className="compras-summary-card compras-summary-card--iva"><span>Total período</span><strong>{fmtMoneda(totalMonto)}</strong></article>
      </section>

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <section className="compras-filtros">
        <input
          placeholder="Buscar proveedor, RUC o clave de acceso"
          value={filtros.busqueda}
          onChange={(e) => actualizarFiltro('busqueda', e.target.value)}
        />
        <input
          type="date"
          value={filtros.fechaDesde}
          onChange={(e) => actualizarFiltro('fechaDesde', e.target.value)}
          title="Desde"
        />
        <input
          type="date"
          value={filtros.fechaHasta}
          onChange={(e) => actualizarFiltro('fechaHasta', e.target.value)}
          title="Hasta"
        />
        <button className="btn-secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar</button>
      </section>

      {/* ── Paginación superior ──────────────────────────────────── */}
      {pages > 1 && (
        <div className="compras-pagination">
          <button className="btn-secondary" disabled={filtros.page <= 1} onClick={() => actualizarFiltro('page', filtros.page - 1)}>← Anterior</button>
          <span className="compras-pagination-info">Página <strong>{filtros.page}</strong> de <strong>{pages}</strong> — mostrando {items.length} de {total} registros</span>
          <button className="btn-secondary" disabled={filtros.page >= pages} onClick={() => actualizarFiltro('page', filtros.page + 1)}>Siguiente →</button>
        </div>
      )}

      {/* ── Tabla ────────────────────────────────────────────────── */}
      <section className="compras-card">
        {loading ? (
          <div className="compras-empty">Cargando notas de crédito...</div>
        ) : items.length === 0 ? (
          <div className="compras-empty">
            No hay notas de crédito recibidas de proveedores. Se importan automáticamente desde
            el Buzón SRI (documentos tipo 04).
          </div>
        ) : (
          <div className="compras-table-wrap">
            <table className="compras-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Proveedor</th>
                  <th className="compras-col-auth">Clave / Autorización</th>
                  <th>Importe</th><th>Recibida</th><th>XML</th>
                </tr>
              </thead>
              <tbody>
                {items.map((nc) => (
                  <tr key={nc.id}>
                    <td data-label="Fecha">{fmtFecha(nc.fechaEmision)}</td>
                    <td data-label="Proveedor">
                      <div className="compras-provider">
                        <strong>{nc.razonSocialEmisor}</strong>
                        <span>{nc.rucEmisor}</span>
                      </div>
                    </td>
                    <td data-label="Clave / Autorización" className="compras-col-auth compras-auth-cell">
                      {nc.claveAcceso
                        ? <span title={nc.claveAcceso}>{nc.claveAcceso}</span>
                        : <span className="compras-muted">—</span>}
                    </td>
                    <td data-label="Importe"><strong>{fmtMoneda(nc.importeTotal)}</strong></td>
                    <td data-label="Recibida">
                      {nc.createdAt ? fmtFecha(nc.createdAt) : <span className="compras-muted">—</span>}
                    </td>
                    <td data-label="XML">
                      {nc.xmlAutorizado ? (
                        <button className="btn-icon" title="Ver XML autorizado" onClick={() => setXmlModal(nc.xmlAutorizado)}>
                          <IcXML />
                        </button>
                      ) : (
                        <span className="compras-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="compras-pagination compras-pagination--bottom">
            <button className="btn-secondary" disabled={filtros.page <= 1} onClick={() => actualizarFiltro('page', filtros.page - 1)}>← Anterior</button>
            <span className="compras-pagination-info">Página <strong>{filtros.page}</strong> de <strong>{pages}</strong></span>
            <button className="btn-secondary" disabled={filtros.page >= pages} onClick={() => actualizarFiltro('page', filtros.page + 1)}>Siguiente →</button>
          </div>
        )}
      </section>

      {/* ── Modal XML ────────────────────────────────────────────── */}
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
