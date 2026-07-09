// ====================================
// LISTA DE RETENCIONES RECIBIDAS
// frontend/src/components/Facturacion/ListaRetencionesRecibidas.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import { IcXML } from '../../utils/icons';
import './ListaRetenciones.css';

const TIPO_LABEL = { '1': 'Renta', '2': 'IVA', '4': 'IVA', '6': 'LRTI Art.97', '7': 'ISD' };

function extraerNumero(claveAcceso) {
  if (!claveAcceso || claveAcceso.length < 39) return '-';
  return `${claveAcceso.substring(24, 27)}-${claveAcceso.substring(27, 30)}-${claveAcceso.substring(30, 39)}`;
}

function ModalDetalles({ retencion, onClose }) {
  const detalles = retencion.detalles || [];
  const total = (Number(retencion.totalRetencionIva) + Number(retencion.totalRetencionRenta)).toFixed(2);
  return (
    <div className="ret-modal-overlay" onClick={onClose}>
      <div className="ret-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>
          Retención {extraerNumero(retencion.claveAcceso)}
        </h3>
        <p style={{ margin: '0 0 8px', fontSize: '0.88rem', color: '#64748b' }}>
          <strong>Agente:</strong> {retencion.razonSocialAgente} — RUC {retencion.rucAgente}
        </p>
        {retencion.numDocSustento && (
          <p style={{ margin: '0 0 12px', fontSize: '0.88rem', color: '#64748b' }}>
            <strong>Doc. sustento:</strong> {retencion.numDocSustento}
          </p>
        )}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>Tipo</th>
              <th style={{ padding: '4px 6px' }}>Código</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Base imponible</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>%</th>
              <th style={{ padding: '4px 6px', textAlign: 'right' }}>Valor retenido</th>
            </tr>
          </thead>
          <tbody>
            {detalles.map((d, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '4px 6px' }}>{TIPO_LABEL[d.codigo] || `Cód.${d.codigo}`}</td>
                <td style={{ padding: '4px 6px' }}>{d.codigoRetencion || '-'}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>${Number(d.baseImponible || 0).toFixed(2)}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{d.porcentajeRetener}%</td>
                <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 600 }}>${Number(d.valorRetener || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ padding: '6px', textAlign: 'right', fontWeight: 700, borderTop: '2px solid #e2e8f0' }}>Total retenido:</td>
              <td style={{ padding: '6px', textAlign: 'right', fontWeight: 700, color: '#dc2626', borderTop: '2px solid #e2e8f0' }}>${total}</td>
            </tr>
          </tfoot>
        </table>
        {retencion.observaciones && (
          <p style={{ marginTop: 12, fontSize: '0.85rem', color: '#64748b' }}>
            <strong>Obs:</strong> {retencion.observaciones}
          </p>
        )}
        <div className="ret-modal-btns">
          <button className="btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

export default function ListaRetencionesRecibidas() {
  const [registros, setRegistros] = useState([]);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [modalDetalle, setModalDetalle] = useState(null);

  const [filtros, setFiltros] = useState({
    desde: '', hasta: '', agente: '', incluirAnuladas: false,
  });

  const cargar = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: pg, limit: 15, ...filtros, incluirAnuladas: filtros.incluirAnuladas ? 'true' : 'false' };
      const { data } = await api.get('/retenciones-recibidas', { params });
      setRegistros(data.data || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setPage(pg);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cargar retenciones recibidas');
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(1); }, [cargar]);

  const handleFiltro = (e) => {
    const { name, value, type, checked } = e.target;
    setFiltros(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const descargarXML = async (id, clave) => {
    try {
      const resp = await api.get(`/retenciones-recibidas/${id}/xml`, { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `ret-rec-${clave}.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error al descargar XML: ' + (err.response?.data?.error || err.message));
    }
  };

  const sumaIva   = registros.reduce((s, r) => s + Number(r.totalRetencionIva || 0), 0);
  const sumaRenta = registros.reduce((s, r) => s + Number(r.totalRetencionRenta || 0), 0);

  return (
    <div className="ret-container">
      <div className="ret-header">
        <div>
          <h1 className="ret-title">Retenciones Recibidas</h1>
          <p className="ret-subtitle">Comprobantes de retención emitidos por clientes (agentes de retención)</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="ret-filtros">
        <input type="date" name="desde" value={filtros.desde} onChange={handleFiltro} className="ret-input" />
        <input type="date" name="hasta" value={filtros.hasta} onChange={handleFiltro} className="ret-input" />
        <input type="text" name="agente" value={filtros.agente} onChange={handleFiltro} className="ret-input" placeholder="Buscar agente..." />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
          <input type="checkbox" name="incluirAnuladas" checked={filtros.incluirAnuladas} onChange={handleFiltro} />
          Ver anuladas
        </label>
        <button className="btn-primary" onClick={() => cargar(1)}>Buscar</button>
      </div>

      {error && <div className="ret-error">{error}</div>}

      {/* Totales */}
      {registros.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: '0.88rem' }}>
          <span style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 6, padding: '4px 12px' }}>
            Ret. Renta: <strong>${sumaRenta.toFixed(2)}</strong>
          </span>
          <span style={{ background: '#dbeafe', border: '1px solid #60a5fa', borderRadius: 6, padding: '4px 12px' }}>
            Ret. IVA: <strong>${sumaIva.toFixed(2)}</strong>
          </span>
          <span style={{ background: '#dcfce7', border: '1px solid #4ade80', borderRadius: 6, padding: '4px 12px' }}>
            Total: <strong>${(sumaRenta + sumaIva).toFixed(2)}</strong>
          </span>
        </div>
      )}

      {/* Tabla */}
      <div className="ret-tabla-wrap">
        {loading ? (
          <div className="ret-loading">Cargando...</div>
        ) : registros.length === 0 ? (
          <div className="ret-empty">No se encontraron retenciones recibidas. Impórtalas desde el Buzón SRI.</div>
        ) : (
          <table className="ret-tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Agente (RUC)</th>
                <th>Agente (Nombre)</th>
                <th>Doc. Sustento</th>
                <th style={{ textAlign: 'right' }}>Ret. Renta</th>
                <th style={{ textAlign: 'right' }}>Ret. IVA</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registros.map(r => {
                const totalRet = (Number(r.totalRetencionIva) + Number(r.totalRetencionRenta)).toFixed(2);
                return (
                  <tr key={r.id} className={r.anulada ? 'ret-row-anulada' : ''}>
                    <td className="ret-numero">{extraerNumero(r.claveAcceso)}</td>
                    <td>{formatFechaCorta(r.fechaEmision)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.rucAgente}</td>
                    <td className="ret-proveedor">{r.razonSocialAgente}</td>
                    <td style={{ fontSize: '0.82rem' }}>{r.numDocSustento || '-'}</td>
                    <td style={{ textAlign: 'right' }}>${Number(r.totalRetencionRenta).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>${Number(r.totalRetencionIva).toFixed(2)}</td>
                    <td className="ret-total">${totalRet}</td>
                    <td>
                      {r.anulada
                        ? <span className="ret-badge badge-secondary">Anulada</span>
                        : <span className="ret-badge badge-success">Vigente</span>}
                    </td>
                    <td>
                      <div className="tbl-acciones">
                        <button className="btn-icon" title="Ver detalles" style={{ fontSize: '1rem' }}
                          onClick={() => setModalDetalle(r)}>
                          🔍
                        </button>
                        {r.xmlAutorizado !== null && (
                          <button className="btn-icon ic-xml" title="Descargar XML"
                            onClick={() => descargarXML(r.id, r.claveAcceso)}>
                            <IcXML />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Paginación */}
      {pages > 1 && (
        <div className="ret-paginacion">
          <span className="ret-total-info">Total: {total} retenciones</span>
          <div className="ret-paginas">
            <button disabled={page <= 1} onClick={() => cargar(page - 1)} className="btn-secondary btn-sm">‹ Ant.</button>
            <span>Página {page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => cargar(page + 1)} className="btn-secondary btn-sm">Sig. ›</button>
          </div>
        </div>
      )}

      {modalDetalle && <ModalDetalles retencion={modalDetalle} onClose={() => setModalDetalle(null)} />}
    </div>
  );
}
