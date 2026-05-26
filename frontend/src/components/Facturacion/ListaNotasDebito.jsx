// ====================================
// LISTA DE NOTAS DE DÉBITO (tipo 05)
// frontend/src/components/Facturacion/ListaNotasDebito.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { formatFechaCorta } from '../../utils/fecha';
import { IcPDF, IcReenviar, IcAnular } from '../../utils/icons';
import './ListaNotasDebito.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

const BADGE = {
  PENDIENTE_FIRMA:        { label: 'Pendiente Firma',  cls: 'badge-warning' },
  ENVIADO:                { label: 'Enviado',           cls: 'badge-info' },
  FIRMADO_PENDIENTE_ENVIO:{ label: 'En Cola (offline)', cls: 'badge-warning' },
  AUTORIZADO:             { label: 'Autorizado',        cls: 'badge-success' },
  RECHAZADO:              { label: 'Rechazado',         cls: 'badge-danger' },
  ERROR:                  { label: 'Error',             cls: 'badge-danger' },
};

function fmtFecha(d) {
  if (!d) return '-';
  return formatFechaCorta(d);
}

export default function ListaNotasDebito() {
  const navigate = useNavigate();
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [filtros, setFiltros] = useState({ fechaDesde: '', fechaHasta: '', estado: '' });

  const cargar = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const params = { page: pg, limit: 15, ...filtros };
      const { data } = await axios.get(`${API}/notas-debito`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      setItems(data.data || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
      setPage(pg);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al cargar notas de débito');
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(1); }, [cargar]);

  const handleFiltro = (e) => setFiltros((p) => ({ ...p, [e.target.name]: e.target.value }));

  const reenviar = async (id) => {
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      await axios.post(`${API}/notas-debito/${id}/reenviar`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      cargar(page);
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al reenviar');
    }
  };

  const anular = async (id) => {
    const motivo = prompt('Motivo de anulación:');
    if (!motivo) return;
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      await axios.delete(`${API}/notas-debito/${id}/anular`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { motivo },
      });
      cargar(page);
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al anular');
    }
  };

  return (
    <div className="lista-container">
      <div className="lista-header">
        <h2>Notas de Débito</h2>
        <button className="btn-primary" onClick={() => navigate('/notas-debito/nueva')}>
          + Nueva Nota de Débito
        </button>
      </div>

      {/* Filtros */}
      <div className="filtros-bar">
        <input type="date" name="fechaDesde" value={filtros.fechaDesde} onChange={handleFiltro} placeholder="Desde" />
        <input type="date" name="fechaHasta" value={filtros.fechaHasta} onChange={handleFiltro} placeholder="Hasta" />
        <select name="estado" value={filtros.estado} onChange={handleFiltro}>
          <option value="">Todos los estados</option>
          {Object.entries(BADGE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button className="btn-secondary" onClick={() => cargar(1)}>Buscar</button>
      </div>

      {error && <div className="alert-danger">{error}</div>}

      {loading ? (
        <div className="loading-text">Cargando...</div>
      ) : (
        <>
          <div className="tabla-wrapper">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Comprador</th>
                  <th>Doc. Sustento</th>
                  <th>Total</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>Sin registros</td></tr>
                )}
                {items.map((nd) => {
                  const badge = BADGE[nd.estadoSri] || { label: nd.estadoSri, cls: 'badge-secondary' };
                  return (
                    <tr key={nd.id}>
                      <td>{nd.numero}</td>
                      <td>{nd.razonSocialComprador}<br /><small style={{ color: '#94a3b8' }}>{nd.identificacionComprador}</small></td>
                      <td>{nd.numeroDocSustento}</td>
                      <td style={{ fontWeight: 600 }}>${parseFloat(nd.valorTotal).toFixed(2)}</td>
                      <td>{fmtFecha(nd.fechaEmision)}</td>
                      <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                      <td>
                        <div className="tbl-acciones">
                          {nd.pdfUrl && (
                            <a href={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5600'}${nd.pdfUrl}`}
                              target="_blank" rel="noreferrer" className="btn-icon ic-pdf" title="Ver PDF">
                              <IcPDF/>
                            </a>
                          )}
                          {['PENDIENTE_FIRMA','RECHAZADO','ERROR','FIRMADO_PENDIENTE_ENVIO'].includes(nd.estadoSri) && (
                            <button className="btn-icon ic-reenviar" onClick={() => reenviar(nd.id)} title="Reenviar al SRI">
                              <IcReenviar/>
                            </button>
                          )}
                          {!nd.anulada && nd.estadoSri !== 'AUTORIZADO' && (
                            <button className="btn-icon ic-anular" onClick={() => anular(nd.id)} title="Anular">
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
          </div>

          {/* Paginación */}
          <div className="paginacion">
            <span>Total: {total}</span>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button key={p} className={`btn-page ${p === page ? 'active' : ''}`} onClick={() => cargar(p)}>{p}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
