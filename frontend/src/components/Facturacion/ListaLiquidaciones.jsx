// ====================================
// LISTA DE LIQUIDACIONES DE COMPRA
// frontend/src/components/Facturacion/ListaLiquidaciones.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatFechaCorta } from '../../utils/fecha';
import { IcPDF, IcXML, IcReenviar, IcAnular } from '../../utils/icons';
import './ListaLiquidaciones.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

const BADGE = {
  PENDIENTE_FIRMA: { label: 'Pendiente Firma', cls: 'badge-warning' },
  ENVIADO:         { label: 'Enviado',          cls: 'badge-info' },
  AUTORIZADO:      { label: 'Autorizado',        cls: 'badge-success' },
  RECHAZADO:       { label: 'Rechazado',         cls: 'badge-danger' },
  ERROR:           { label: 'Error',             cls: 'badge-danger' },
  ANULADO:         { label: 'Anulado',           cls: 'badge-secondary' },
};

export default function ListaLiquidaciones() {
  const navigate = useNavigate();

  const [liquidaciones, setLiquidaciones] = useState([]);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  const [filtros, setFiltros] = useState({ fechaDesde: '', fechaHasta: '', estado: '', proveedor: '' });
  const [modalAnular, setModalAnular]   = useState(null);
  const [motivoAnular, setMotivoAnular] = useState('');

  const cargar = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const params = { page: pg, limit: 15, ...filtros };
      const { data } = await axios.get(`${API}/liquidaciones`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      setLiquidaciones(data.data || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setPage(pg);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cargar liquidaciones');
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
      const resp  = await axios.get(`${API}/liquidaciones/${id}/pdf`, {
        headers:      { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url  = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `liquidacion-${numero}.pdf`);
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
      const resp  = await axios.get(`${API}/liquidaciones/${id}/xml`, {
        headers:      { Authorization: `Bearer ${token}` },
        responseType: 'blob',
      });
      const url  = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `liquidacion-${numero}.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error al descargar XML: ' + (err.response?.data?.error || err.message));
    }
  };

  const reenviar = async (id) => {
    if (!window.confirm('¿Reenviar esta liquidación al SRI?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API}/liquidaciones/${id}/reenviar`, {}, {
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
      await axios.post(`${API}/liquidaciones/${modalAnular}/anular`, { motivo: motivoAnular }, {
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
    <div className="liq-container">
      {/* Encabezado */}
      <div className="liq-header">
        <div>
          <h1 className="liq-title">Liquidaciones de Compra</h1>
          <p className="liq-subtitle">Comprobante electrónico tipo 03 — compras a personas naturales sin RUC</p>
        </div>
        <div className="liq-header-actions">
          <button className="btn-nav-liq" onClick={() => navigate('/compras')}>
            ← Volver a Compras
          </button>
          <button className="btn-nav-liq" onClick={() => navigate('/dashboard')}>
            Salir al Dashboard
          </button>
          <button className="btn-nueva-liq" onClick={() => navigate('/liquidaciones/nueva')}>
            + Nueva Liquidación
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="liq-filtros">
        <input
          type="date" name="fechaDesde" value={filtros.fechaDesde}
          onChange={handleFiltro} className="liq-input" placeholder="Desde"
        />
        <input
          type="date" name="fechaHasta" value={filtros.fechaHasta}
          onChange={handleFiltro} className="liq-input" placeholder="Hasta"
        />
        <select name="estado" value={filtros.estado} onChange={handleFiltro} className="liq-input">
          <option value="">Todos los estados</option>
          {Object.entries(BADGE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          type="text" name="proveedor" value={filtros.proveedor}
          onChange={handleFiltro} className="liq-input" placeholder="Buscar proveedor..."
        />
        <button className="btn-buscar-liq" onClick={() => cargar(1)}>Buscar</button>
      </div>

      {error && <div className="liq-error">{error}</div>}

      {/* Tabla */}
      <div className="liq-tabla-wrap">
        {loading ? (
          <div className="liq-loading">Cargando...</div>
        ) : liquidaciones.length === 0 ? (
          <div className="liq-empty">No se encontraron liquidaciones de compra.</div>
        ) : (
          <table className="liq-tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Identificación</th>
                <th>Total</th>
                <th>Estado SRI</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {liquidaciones.map(liq => {
                const badge = BADGE[liq.estadoSri] || { label: liq.estadoSri, cls: 'badge-secondary' };
                return (
                  <tr key={liq.id} className={liq.anulada ? 'liq-row-anulada' : ''}>
                    <td className="liq-numero">{liq.numeroLiquidacion}</td>
                    <td>{fmtFecha(liq.fechaEmision)}</td>
                    <td className="liq-proveedor">{liq.razonSocialProveedor}</td>
                    <td>{liq.identificacionProveedor}</td>
                    <td className="liq-total">${parseFloat(liq.importeTotal).toFixed(2)}</td>
                    <td><span className={`liq-badge ${badge.cls}`}>{badge.label}</span></td>
                    <td>
                      <div className="tbl-acciones">
                        <button className="btn-icon" title="Descargar PDF RIDE"
                          onClick={() => descargarPDF(liq.id, liq.numeroLiquidacion)}>
                          <IcPDF/>
                        </button>
                        <button className="btn-icon" title="Descargar XML"
                          onClick={() => descargarXML(liq.id, liq.numeroLiquidacion)}>
                          <IcXML/>
                        </button>
                        {!liq.anulada && liq.estadoSri !== 'AUTORIZADO' && (
                          <button className="btn-icon warning" title="Reenviar al SRI"
                            onClick={() => reenviar(liq.id)}>
                            <IcReenviar/>
                          </button>
                        )}
                        {!liq.anulada && (
                          <button className="btn-icon danger" title="Anular"
                            onClick={() => { setModalAnular(liq.id); setMotivoAnular(''); }}>
                            <IcAnular/>
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
        <div className="liq-paginacion">
          <span className="liq-total-info">Total: {total} liquidaciones</span>
          <div className="liq-paginas">
            <button disabled={page <= 1} onClick={() => cargar(page - 1)} className="btn-pag">‹ Ant.</button>
            <span>Página {page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => cargar(page + 1)} className="btn-pag">Sig. ›</button>
          </div>
        </div>
      )}

      {/* Modal anulación */}
      {modalAnular && (
        <div className="liq-modal-overlay">
          <div className="liq-modal" onClick={e => e.stopPropagation()}>
            <h3>Anular Liquidación</h3>
            <p>Ingrese el motivo de anulación:</p>
            <textarea
              value={motivoAnular}
              onChange={e => setMotivoAnular(e.target.value)}
              rows={3}
              className="liq-textarea"
              placeholder="Motivo de anulación..."
            />
            <div className="liq-modal-btns">
              <button className="btn-cancel-modal" onClick={() => setModalAnular(null)}>Cancelar</button>
              <button className="btn-confirm-anular" onClick={anular}>Confirmar Anulación</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
