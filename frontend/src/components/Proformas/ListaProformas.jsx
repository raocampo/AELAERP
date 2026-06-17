// ====================================
// COMPONENTE: LISTA DE PROFORMAS
// frontend/src/components/Proformas/ListaProformas.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './ListaProformas.css';

const ESTADOS = [
  { valor: '',           label: 'Todos',      color: '#64748b', bg: '#f1f5f9' },
  { valor: 'BORRADOR',   label: 'Borrador',   color: '#64748b', bg: '#f1f5f9' },
  { valor: 'ENVIADA',    label: 'Enviada',    color: '#2563eb', bg: '#dbeafe' },
  { valor: 'ACEPTADA',   label: 'Aceptada',   color: '#16a34a', bg: '#dcfce7' },
  { valor: 'RECHAZADA',  label: 'Rechazada',  color: '#dc2626', bg: '#fee2e2' },
  { valor: 'CONVERTIDA', label: 'Convertida', color: '#7c3aed', bg: '#ede9fe' },
  { valor: 'ANULADA',    label: 'Anulada',    color: '#374151', bg: '#e5e7eb' },
];

function BadgeEstado({ estado }) {
  const cfg = ESTADOS.find(e => e.valor === estado) || ESTADOS[0];
  return (
    <span className="prf-badge" style={{ color: cfg.color, background: cfg.bg }}>
      {cfg.label}
    </span>
  );
}

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonto(v) {
  return `$${parseFloat(v || 0).toFixed(2)}`;
}

export default function ListaProformas() {
  const navigate = useNavigate();
  const [proformas, setProformas] = useState([]);
  const [total,     setTotal]     = useState(0);
  const [cargando,  setCargando]  = useState(true);
  const [filtros, setFiltros] = useState({ q: '', estado: '', page: 1 });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams();
      if (filtros.q)      params.set('q',      filtros.q);
      if (filtros.estado) params.set('estado', filtros.estado);
      params.set('page',  filtros.page);
      params.set('limit', 25);
      const res = await api.get(`/proformas?${params}`);
      setProformas(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch {
      toast.error('Error al cargar proformas');
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleFiltro = (campo, valor) => setFiltros(f => ({ ...f, [campo]: valor, page: 1 }));

  return (
    <div className="prf-lista-container">
      {/* Header */}
      <div className="prf-lista-header">
        <div>
          <h1>📋 Proformas</h1>
          <p className="prf-lista-subtitle">Cotizaciones y presupuestos</p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/proformas/nueva')}>
          + Nueva Proforma
        </button>
      </div>

      {/* Filtros */}
      <div className="prf-filtros">
        <input
          className="prf-filtro-search"
          placeholder="🔍 Buscar por cliente o número..."
          value={filtros.q}
          onChange={e => handleFiltro('q', e.target.value)}
        />
        <div className="prf-filtro-estados">
          {ESTADOS.map(e => (
            <button
              key={e.valor}
              className={`prf-filtro-btn ${filtros.estado === e.valor ? 'activo' : ''}`}
              onClick={() => handleFiltro('estado', e.valor)}
              style={filtros.estado === e.valor ? { color: e.color, borderColor: e.color, background: e.bg } : {}}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      {cargando ? (
        <div className="prf-loading">Cargando proformas...</div>
      ) : proformas.length === 0 ? (
        <div className="prf-vacio">
          <p>📋 No hay proformas</p>
          <button className="btn-primary" onClick={() => navigate('/proformas/nueva')}>
            Crear primera proforma
          </button>
        </div>
      ) : (
        <>
          <div className="prf-tabla-wrap">
            <table className="prf-tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Vigencia hasta</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {proformas.map(p => (
                  <tr key={p.id} onClick={() => navigate(`/proformas/${p.id}`)} className="prf-fila">
                    <td className="prf-numero">{p.numero}</td>
                    <td className="prf-cliente">
                      <span className="prf-cliente-nombre">{p.razonsocial || p.razonSocial}</span>
                      <span className="prf-cliente-id">{p.identificacion}</span>
                    </td>
                    <td className="prf-monto">{fmtMonto(p.importetotal || p.importeTotal)}</td>
                    <td><BadgeEstado estado={p.estado} /></td>
                    <td>{fmtFecha(p.vigenciahasta || p.vigenciaHasta)}</td>
                    <td>{fmtFecha(p.createdat || p.createdAt)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="prf-acciones">
                        <button className="prf-btn-ver" onClick={() => navigate(`/proformas/${p.id}`)}>
                          Ver
                        </button>
                        {p.estado === 'BORRADOR' && (
                          <button className="prf-btn-editar" onClick={() => navigate(`/proformas/${p.id}/editar`)}>
                            Editar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="prf-paginacion">
            <span className="prf-total-txt">{total} proforma{total !== 1 ? 's' : ''}</span>
            <div className="prf-pag-btns">
              <button disabled={filtros.page <= 1} onClick={() => handleFiltro('page', filtros.page - 1)}>‹ Ant</button>
              <span>Pág. {filtros.page}</span>
              <button disabled={proformas.length < 25} onClick={() => handleFiltro('page', filtros.page + 1)}>Sig ›</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
