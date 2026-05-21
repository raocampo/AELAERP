// ====================================
// LISTA DE COMPROBANTES DE RETENCIÓN
// frontend/src/components/Facturacion/ListaRetenciones.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatFechaCorta } from '../../utils/fecha';
import './ListaRetenciones.css';

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:5600'}/api`;

const BADGE = {
  PENDIENTE_FIRMA: { label: 'Pendiente Firma', cls: 'badge-warning' },
  ENVIADO:         { label: 'Enviado',          cls: 'badge-info' },
  AUTORIZADO:      { label: 'Autorizado',        cls: 'badge-success' },
  RECHAZADO:       { label: 'Rechazado',         cls: 'badge-danger' },
  ERROR:           { label: 'Error',             cls: 'badge-danger' },
  ANULADO:         { label: 'Anulado',           cls: 'badge-secondary' },
};

export default function ListaRetenciones() {
  const navigate = useNavigate();

  const [retenciones, setRetenciones] = useState([]);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  const [filtros, setFiltros] = useState({ fechaDesde: '', fechaHasta: '', estado: '', proveedor: '' });

  const [modalAnular, setModalAnular]   = useState(null); // id de la retención
  const [motivoAnular, setMotivoAnular] = useState('');

  const cargar = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const params = { page: pg, limit: 15, ...filtros };
      const { data } = await axios.get(`${API}/retenciones`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      setRetenciones(data.data || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setPage(pg);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cargar retenciones');
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(1); }, [cargar]);

  const handleFiltro = (e) => {
    setFiltros(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const descargarPDF = async (id, numero) => {
    try {
      const token = localStorage.getItem('token');
      const resp  = await axios.get(`${API}/retenciones/${id}/pdf`, {
        headers:      { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url  = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `retencion-${numero}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error al descargar PDF: ' + (err.response?.data?.error || err.message));
    }
  };

  const descargarXML = async (id, numero) => {
    try {
      const token = localStorage.getItem('token');
      const resp  = await axios.get(`${API}/retenciones/${id}/xml`, {
        headers:      { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url  = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `retencion-${numero}.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error al descargar XML: ' + (err.response?.data?.error || err.message));
    }
  };

  const reenviar = async (id) => {
    if (!window.confirm('¿Reenviar esta retención al SRI?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API}/retenciones/${id}/reenviar`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert('Reenvío iniciado. El estado se actualizará en breve.');
      cargar(page);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const anular = async () => {
    if (!motivoAnular.trim()) { alert('Ingrese el motivo de anulación'); return; }
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API}/retenciones/${modalAnular}/anular`, { motivo: motivoAnular }, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setModalAnular(null);
      setMotivoAnular('');
      cargar(page);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const fmtFecha = (f) => f ? formatFechaCorta(f) : '-';

  return (
    <div className="ret-container">
      {/* Encabezado */}
      <div className="ret-header">
        <div>
          <h1 className="ret-title">Comprobantes de Retención</h1>
          <p className="ret-subtitle">Gestión de retenciones electrónicas SRI (tipo 07)</p>
        </div>
        <button className="btn-nuevo-ret" onClick={() => navigate('/retenciones/nueva')}>
          + Nueva Retención
        </button>
      </div>

      {/* Filtros */}
      <div className="ret-filtros">
        <input
          type="date" name="fechaDesde" value={filtros.fechaDesde}
          onChange={handleFiltro} className="ret-input" placeholder="Desde"
        />
        <input
          type="date" name="fechaHasta" value={filtros.fechaHasta}
          onChange={handleFiltro} className="ret-input" placeholder="Hasta"
        />
        <select name="estado" value={filtros.estado} onChange={handleFiltro} className="ret-input">
          <option value="">Todos los estados</option>
          {Object.entries(BADGE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          type="text" name="proveedor" value={filtros.proveedor}
          onChange={handleFiltro} className="ret-input" placeholder="Buscar proveedor..."
        />
        <button className="btn-buscar-ret" onClick={() => cargar(1)}>Buscar</button>
      </div>

      {error && <div className="ret-error">{error}</div>}

      {/* Tabla */}
      <div className="ret-tabla-wrap">
        {loading ? (
          <div className="ret-loading">Cargando...</div>
        ) : retenciones.length === 0 ? (
          <div className="ret-empty">No se encontraron comprobantes de retención.</div>
        ) : (
          <table className="ret-tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Identificación</th>
                <th>Período</th>
                <th>Total Ret.</th>
                <th>Estado SRI</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {retenciones.map(ret => {
                const badge = BADGE[ret.estadoSri] || { label: ret.estadoSri, cls: 'badge-secondary' };
                return (
                  <tr key={ret.id} className={ret.anulada ? 'ret-row-anulada' : ''}>
                    <td className="ret-numero">{ret.numeroRetencion}</td>
                    <td>{fmtFecha(ret.fechaEmision)}</td>
                    <td className="ret-proveedor">{ret.razonSocialProveedor}</td>
                    <td>{ret.identificacionProveedor}</td>
                    <td>{ret.periodoFiscal}</td>
                    <td className="ret-total">${parseFloat(ret.totalRetenido).toFixed(2)}</td>
                    <td><span className={`ret-badge ${badge.cls}`}>{badge.label}</span></td>
                    <td>
                      <div className="ret-acciones">
                        <button
                          className="btn-ret btn-pdf"
                          onClick={() => descargarPDF(ret.id, ret.numeroRetencion)}
                          title="Descargar PDF RIDE"
                        >PDF</button>
                        <button
                          className="btn-ret btn-xml"
                          onClick={() => descargarXML(ret.id, ret.numeroRetencion)}
                          title="Descargar XML"
                        >XML</button>
                        {!ret.anulada && ret.estadoSri !== 'AUTORIZADO' && (
                          <button
                            className="btn-ret btn-reenviar"
                            onClick={() => reenviar(ret.id)}
                            title="Reenviar al SRI"
                          >Reenviar</button>
                        )}
                        {!ret.anulada && (
                          <button
                            className="btn-ret btn-anular"
                            onClick={() => { setModalAnular(ret.id); setMotivoAnular(''); }}
                            title="Anular"
                          >Anular</button>
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
            <button disabled={page <= 1} onClick={() => cargar(page - 1)} className="btn-pag">‹ Ant.</button>
            <span>Página {page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => cargar(page + 1)} className="btn-pag">Sig. ›</button>
          </div>
        </div>
      )}

      {/* Modal anulación */}
      {modalAnular && (
        <div className="ret-modal-overlay">
          <div className="ret-modal" onClick={e => e.stopPropagation()}>
            <h3>Anular Retención</h3>
            <p>Ingrese el motivo de anulación:</p>
            <textarea
              value={motivoAnular}
              onChange={e => setMotivoAnular(e.target.value)}
              rows={3}
              className="ret-textarea"
              placeholder="Motivo de anulación..."
            />
            <div className="ret-modal-btns">
              <button className="btn-cancel-modal" onClick={() => setModalAnular(null)}>Cancelar</button>
              <button className="btn-confirm-anular" onClick={anular}>Confirmar Anulación</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
