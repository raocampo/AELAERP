// ====================================
// LISTA DE COMPROBANTES DE RETENCIÓN
// frontend/src/components/Facturacion/ListaRetenciones.jsx
// ====================================

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import { IcPDF, IcXML, IcReenviar, IcAnular, IcEditar } from '../../utils/icons';
import './ListaRetenciones.css';

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

  const [modalEditar, setModalEditar] = useState(null); // retención completa
  const [impuestosEdit, setImpuestosEdit] = useState([]);
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  const cargar = useCallback(async (pg = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = { page: pg, limit: 15, ...filtros };
      const { data } = await api.get('/retenciones', { params });
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
      const resp = await api.get(`/retenciones/${id}/pdf`, { responseType: 'blob' });
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
      const resp = await api.get(`/retenciones/${id}/xml`, { responseType: 'blob' });
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
      await api.post(`/retenciones/${id}/reenviar`, {});
      alert('Reenvío iniciado. El estado se actualizará en breve.');
      cargar(page);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const anular = async () => {
    if (!motivoAnular.trim()) { alert('Ingrese el motivo de anulación'); return; }
    try {
      await api.post(`/retenciones/${modalAnular}/anular`, { motivo: motivoAnular });
      setModalAnular(null);
      setMotivoAnular('');
      cargar(page);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    }
  };

  const abrirEditar = (ret) => {
    setModalEditar(ret);
    setImpuestosEdit((ret.impuestos || []).map((i) => ({ ...i })));
  };

  const cambiarImpuestoEdit = (index, campo, valor) => {
    setImpuestosEdit((prev) => prev.map((imp, i) => {
      if (i !== index) return imp;
      const actualizado = { ...imp, [campo]: valor };
      if (campo === 'baseImponible' || campo === 'porcentajeRetener') {
        const base = Number(campo === 'baseImponible' ? valor : actualizado.baseImponible) || 0;
        const pct = Number(campo === 'porcentajeRetener' ? valor : actualizado.porcentajeRetener) || 0;
        actualizado.valorRetenido = Number((base * pct / 100).toFixed(2));
      }
      return actualizado;
    }));
  };

  const guardarEdicion = async () => {
    setGuardandoEdit(true);
    try {
      await api.put(`/retenciones/${modalEditar.id}`, { impuestos: impuestosEdit });
      alert('Retención actualizada. Use "Reenviar" para firmarla y enviarla al SRI.');
      setModalEditar(null);
      cargar(page);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setGuardandoEdit(false);
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
        <button className="btn-primary" onClick={() => navigate('/retenciones/nueva')}>
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
        <button className="btn-primary" onClick={() => cargar(1)}>Buscar</button>
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
                      <div className="tbl-acciones">
                        <button className="btn-icon ic-pdf" title="Descargar PDF RIDE"
                          onClick={() => descargarPDF(ret.id, ret.numeroRetencion)}>
                          <IcPDF/>
                        </button>
                        <button className="btn-icon ic-xml" title="Descargar XML"
                          onClick={() => descargarXML(ret.id, ret.numeroRetencion)}>
                          <IcXML/>
                        </button>
                        {!ret.anulada && ret.estadoSri !== 'AUTORIZADO' && (
                          <button className="btn-icon ic-editar" title="Editar códigos/montos"
                            onClick={() => abrirEditar(ret)}>
                            <IcEditar/>
                          </button>
                        )}
                        {!ret.anulada && ret.estadoSri !== 'AUTORIZADO' && (
                          <button className="btn-icon ic-reenviar" title="Reenviar al SRI"
                            onClick={() => reenviar(ret.id)}>
                            <IcReenviar/>
                          </button>
                        )}
                        {!ret.anulada && (
                          <button className="btn-icon ic-anular" title="Anular"
                            onClick={() => { setModalAnular(ret.id); setMotivoAnular(''); }}>
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
        <div className="ret-paginacion">
          <span className="ret-total-info">Total: {total} retenciones</span>
          <div className="ret-paginas">
            <button disabled={page <= 1} onClick={() => cargar(page - 1)} className="btn-secondary btn-sm">‹ Ant.</button>
            <span>Página {page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => cargar(page + 1)} className="btn-secondary btn-sm">Sig. ›</button>
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
              <button className="btn-secondary" onClick={() => setModalAnular(null)}>Cancelar</button>
              <button className="btn-danger" onClick={anular}>Confirmar Anulación</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal editar códigos/montos */}
      {modalEditar && (
        <div className="ret-modal-overlay">
          <div className="ret-modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
            <h3>Editar retención {modalEditar.numeroRetencion}</h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Solo se puede editar mientras no esté autorizada por el SRI. Al guardar, deberás
              usar &quot;Reenviar&quot; para volver a firmarla y enviarla.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ padding: '0.3rem' }}>Código</th>
                  <th style={{ padding: '0.3rem', textAlign: 'right' }}>Base imponible</th>
                  <th style={{ padding: '0.3rem', textAlign: 'right' }}>% Retener</th>
                  <th style={{ padding: '0.3rem', textAlign: 'right' }}>Valor retenido</th>
                </tr>
              </thead>
              <tbody>
                {impuestosEdit.map((imp, index) => (
                  <tr key={index}>
                    <td style={{ padding: '0.3rem' }}>{imp.codigoPorcentaje || imp.codigo}</td>
                    <td style={{ padding: '0.3rem' }}>
                      <input type="number" step="0.01" value={imp.baseImponible}
                        onChange={(e) => cambiarImpuestoEdit(index, 'baseImponible', e.target.value)}
                        style={{ width: '100%', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '0.3rem' }}>
                      <input type="number" step="0.01" value={imp.porcentajeRetener}
                        onChange={(e) => cambiarImpuestoEdit(index, 'porcentajeRetener', e.target.value)}
                        style={{ width: '100%', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '0.3rem', textAlign: 'right' }}>${Number(imp.valorRetenido || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ret-modal-btns">
              <button className="btn-secondary" onClick={() => setModalEditar(null)} disabled={guardandoEdit}>Cancelar</button>
              <button className="btn-primary" onClick={guardarEdicion} disabled={guardandoEdit}>
                {guardandoEdit ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
