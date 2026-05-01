// ====================================
// LISTA DE GUÍAS DE REMISIÓN — AELA
// frontend/src/components/GuiasRemision/ListaGuiasRemision.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './GuiasRemision.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

const ESTADO_BADGE = {
  NO_ENVIADA: { label: 'No enviada', cls: 'badge-muted' },
  PENDIENTE:  { label: 'Pendiente',  cls: 'badge-warning' },
  AUTORIZADA: { label: 'Autorizada', cls: 'badge-success' },
  RECHAZADA:  { label: 'Rechazada',  cls: 'badge-danger' },
  ANULADA:    { label: 'Anulada',    cls: 'badge-danger' },
};

export default function ListaGuiasRemision() {
  const navigate = useNavigate();

  const [guias,    setGuias]    = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [pagina,   setPagina]   = useState(1);

  const [filtros, setFiltros] = useState({
    busqueda:   '',
    fechaDesde: '',
    fechaHasta: '',
    estado:     'TODOS',
  });

  const cargar = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const params = new URLSearchParams({ page, limit: 50 });
      if (filtros.busqueda)   params.set('busqueda',   filtros.busqueda);
      if (filtros.fechaDesde) params.set('fechaDesde', filtros.fechaDesde);
      if (filtros.fechaHasta) params.set('fechaHasta', filtros.fechaHasta);
      if (filtros.estado !== 'TODOS') params.set('estado', filtros.estado);

      const res  = await fetch(`${API_URL}/guias-remision?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.mensaje || 'Error al cargar guías');
      setGuias(data.guias || []);
      setTotal(data.total  || 0);
      setPagina(page);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(1); }, [cargar]);

  const handleFiltro = (campo, valor) => {
    setFiltros((f) => ({ ...f, [campo]: valor }));
  };

  const handleAnular = async (id, numero) => {
    if (!window.confirm(`¿Anular la guía ${numero}? Esta acción no se puede deshacer.`)) return;
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const res   = await fetch(`${API_URL}/guias-remision/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.mensaje);
      cargar(pagina);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const handleEnviarSRI = async (id, numero) => {
    if (!window.confirm(`¿Enviar la guía ${numero} al SRI?`)) return;
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const res   = await fetch(`${API_URL}/guias-remision/${id}/enviar-sri`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.mensaje);
      alert(`Resultado: ${data.mensaje}`);
      cargar(pagina);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const fmtFecha = (iso) =>
    iso ? new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

  return (
    <div className="gr-container">
      {/* ── Encabezado ── */}
      <div className="gr-header">
        <div className="gr-header-left">
          <h1 className="gr-titulo">Guías de Remisión</h1>
          <span className="gr-count">{total} documento{total !== 1 ? 's' : ''}</span>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/guias-remision/nueva')}
        >
          ➕ Nueva Guía
        </button>
      </div>

      {/* ── Filtros ── */}
      <div className="gr-filtros">
        <input
          type="text"
          className="gr-input"
          placeholder="Buscar por destinatario, RUC, motivo…"
          value={filtros.busqueda}
          onChange={(e) => handleFiltro('busqueda', e.target.value)}
        />
        <input
          type="date"
          className="gr-input"
          value={filtros.fechaDesde}
          onChange={(e) => handleFiltro('fechaDesde', e.target.value)}
          title="Desde"
        />
        <input
          type="date"
          className="gr-input"
          value={filtros.fechaHasta}
          onChange={(e) => handleFiltro('fechaHasta', e.target.value)}
          title="Hasta"
        />
        <select
          className="gr-select"
          value={filtros.estado}
          onChange={(e) => handleFiltro('estado', e.target.value)}
        >
          <option value="TODOS">Todos los estados</option>
          <option value="NO_ENVIADA">No enviada</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="AUTORIZADA">Autorizada</option>
          <option value="RECHAZADA">Rechazada</option>
          <option value="ANULADA">Anulada</option>
        </select>
        <button className="btn btn-secondary btn-sm" onClick={() => cargar(1)}>
          🔍 Buscar
        </button>
      </div>

      {/* ── Error / Loading ── */}
      {error   && <div className="gr-alert gr-alert-danger">{error}</div>}
      {loading && <div className="gr-loading">Cargando guías…</div>}

      {/* ── Tabla ── */}
      {!loading && (
        <div className="gr-table-wrap">
          <table className="gr-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Ini. Transporte</th>
                <th>Destinatario</th>
                <th>Motivo</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {guias.length === 0 ? (
                <tr>
                  <td colSpan={6} className="gr-empty">
                    No hay guías de remisión registradas
                  </td>
                </tr>
              ) : (
                guias.map((g) => {
                  const badge = ESTADO_BADGE[g.estadoSRI] || ESTADO_BADGE.NO_ENVIADA;
                  return (
                    <tr key={g.id} className={g.anulada ? 'gr-row-anulada' : ''}>
                      <td className="gr-numero">{g.numero}</td>
                      <td>{fmtFecha(g.fechaIniTransporte)}</td>
                      <td>
                        <div className="gr-destinatario">{g.nombreDestinatario}</div>
                        <div className="gr-ruc">{g.rucDestinatario}</div>
                      </td>
                      <td className="gr-motivo">{g.motivoTraslado}</td>
                      <td>
                        <span className={`gr-badge ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="gr-acciones">
                        <button
                          className="btn btn-icon"
                          title="Ver detalle"
                          onClick={() => navigate(`/guias-remision/${g.id}`)}
                        >
                          👁️
                        </button>
                        {!g.anulada && g.estadoSRI === 'NO_ENVIADA' && (
                          <>
                            <button
                              className="btn btn-icon"
                              title="Editar"
                              onClick={() => navigate(`/guias-remision/${g.id}/editar`)}
                            >
                              ✏️
                            </button>
                            <button
                              className="btn btn-icon"
                              title="Enviar al SRI"
                              onClick={() => handleEnviarSRI(g.id, g.numero)}
                            >
                              📤
                            </button>
                            <button
                              className="btn btn-icon danger"
                              title="Anular"
                              onClick={() => handleAnular(g.id, g.numero)}
                            >
                              🗑️
                            </button>
                          </>
                        )}
                        {!g.anulada && g.estadoSRI === 'RECHAZADA' && (
                          <button
                            className="btn btn-icon"
                            title="Reintentar envío al SRI"
                            onClick={() => handleEnviarSRI(g.id, g.numero)}
                          >
                            🔄
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Paginación ── */}
      {total > 50 && (
        <div className="gr-paginacion">
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagina <= 1}
            onClick={() => cargar(pagina - 1)}
          >
            ← Anterior
          </button>
          <span>Página {pagina} de {Math.ceil(total / 50)}</span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={pagina >= Math.ceil(total / 50)}
            onClick={() => cargar(pagina + 1)}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  );
}
