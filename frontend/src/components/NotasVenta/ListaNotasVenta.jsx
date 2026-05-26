// ====================================
// LISTA DE NOTAS DE VENTA — AELA
// frontend/src/components/NotasVenta/ListaNotasVenta.jsx
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatFechaCorta } from '../../utils/fecha';
import { IcVer, IcPDF, IcAnular } from '../../utils/icons';

export default function ListaNotasVenta() {
  const navigate = useNavigate();

  const [notas,      setNotas]      = useState([]);
  const [cargando,   setCargando]   = useState(true);
  const [busqueda,   setBusqueda]   = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [limiteInfo, setLimiteInfo] = useState(null);

  const cargar = useCallback(async ({ termino = '', desde = '', hasta = '' } = {}) => {
    setCargando(true);
    try {
      const params = {};
      if (termino) params.busqueda = termino;
      if (desde) params.fechaDesde = desde;
      if (hasta) params.fechaHasta = hasta;

      const res = await api.get('/notas-venta', { params });
      setNotas(res.data.data || []);
      if (res.data.limiteAnual) {
        setLimiteInfo({ limite: res.data.limiteAnual, usadas: res.data.usadasAño });
      }
    } catch {
      toast.error('Error al cargar notas de venta');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const verPDF = async (id) => {
    try {
      const res = await api.get(`/notas-venta/${id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(url, '_blank');
    } catch {
      toast.error('No se pudo generar el PDF');
    }
  };

  const anular = async (id) => {
    const motivo = window.prompt('Motivo de anulación:');
    if (!motivo) return;
    try {
      await api.put(`/notas-venta/${id}/anular`, { motivo });
      toast.success('Nota de venta anulada');
      await cargar({ termino: busqueda, desde: fechaDesde, hasta: fechaHasta });
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al anular');
    }
  };

  const pctUsado = limiteInfo ? Math.round((limiteInfo.usadas / limiteInfo.limite) * 100) : 0;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>🗒️ Notas de Venta</h1>
          <p style={{ color: '#666', margin: '4px 0 0', fontSize: 13 }}>
            Documento para RIMPE Negocio Popular — autorizado por SRI
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/notas-venta/nueva')}>
          + Nueva Nota de Venta
        </button>
      </div>

      {/* Barra de límite Lite */}
      {limiteInfo && (
        <div style={{
          background: pctUsado >= 90 ? '#FFF3E0' : '#F1F8E9',
          border: `1px solid ${pctUsado >= 90 ? '#FFB74D' : '#AED581'}`,
          borderRadius: 8, padding: '10px 16px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>
              Comprobantes {new Date().getFullYear()}: {limiteInfo.usadas} / {limiteInfo.limite}
            </div>
            <div style={{ background: '#ddd', borderRadius: 4, height: 6 }}>
              <div style={{
                width: `${Math.min(pctUsado, 100)}%`,
                height: '100%', borderRadius: 4,
                background: pctUsado >= 90 ? '#FF6F00' : '#558B2F',
              }} />
            </div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: pctUsado >= 90 ? '#E65100' : '#33691E' }}>
            {limiteInfo.limite - limiteInfo.usadas} restantes
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }}
          placeholder="Buscar por número, nombre o identificación..."
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && cargar({ termino: busqueda, desde: fechaDesde, hasta: fechaHasta })}
        />
        <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
        <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }} />
        <button className="btn btn-secondary" onClick={() => cargar({ termino: busqueda, desde: fechaDesde, hasta: fechaHasta })}>Buscar</button>
      </div>

      {/* Tabla */}
      {cargando ? (
        <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
      ) : (
        <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#192C4A', color: '#fff' }}>
                <th style={{ padding: '11px 14px', textAlign: 'left' }}>N° Nota</th>
                <th style={{ padding: '11px 14px', textAlign: 'left' }}>Fecha</th>
                <th style={{ padding: '11px 14px', textAlign: 'left' }}>Cliente</th>
                <th style={{ padding: '11px 8px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '11px 8px', textAlign: 'center' }}>Estado</th>
                <th style={{ padding: '11px 14px', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {notas.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#999' }}>
                  No hay notas de venta registradas
                </td></tr>
              ) : notas.map(n => (
                <tr key={n.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: n.anulada ? 0.5 : 1, cursor: 'pointer' }}
                  onClick={() => navigate(`/notas-venta/${n.id}`)}>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600 }}>
                    {n.numeroNota}
                  </td>
                  <td style={{ padding: '10px 14px', color: '#555' }}>
                    {formatFechaCorta(n.fechaEmision)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 500 }}>{n.razonSocial}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{n.identificacion}</div>
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 600 }}>
                    ${parseFloat(n.total).toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                      background: n.anulada ? '#FFEBEE' : '#E8F5E9',
                      color: n.anulada ? '#C62828' : '#2E7D32',
                    }}>
                      {n.anulada ? 'ANULADA' : 'EMITIDA'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}
                    onClick={e => e.stopPropagation()}>
                    <div className="tbl-acciones" style={{ justifyContent: 'center' }}>
                      <button className="btn-icon ic-ver" title="Ver detalle"
                        onClick={() => navigate(`/notas-venta/${n.id}`)}>
                        <IcVer/>
                      </button>
                      <button className="btn-icon ic-pdf" title="Descargar PDF"
                        onClick={() => verPDF(n.id)}>
                        <IcPDF/>
                      </button>
                      {!n.anulada && (
                        <button className="btn-icon ic-anular" title="Anular"
                          onClick={() => anular(n.id)}>
                          <IcAnular/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
