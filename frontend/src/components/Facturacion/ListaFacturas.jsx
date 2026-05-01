// ====================================
// COMPONENTE: LISTA DE FACTURAS
// frontend/src/components/Facturacion/ListaFacturas.jsx
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './ListaFacturas.css';

// ─── Badge de estado SRI ─────────────────────────────────────────────────────
const BadgeEstado = ({ estado }) => {
  const conf = {
    PENDIENTE_FIRMA: { label: 'Pendiente firma', cls: 'pendiente-firma' },
    LISTO_ENVIAR:    { label: 'Listo enviar',    cls: 'listo-enviar'    },
    ENVIADO:         { label: 'Enviado',          cls: 'enviado'         },
    AUTORIZADO:      { label: 'Autorizado',       cls: 'autorizado'      },
    RECHAZADO:       { label: 'Rechazado',        cls: 'rechazado'       },
    ANULADO:         { label: 'Anulado',          cls: 'anulado'         },
  };
  const c = conf[estado] || { label: estado, cls: 'pendiente-firma' };
  return <span className={`sri-badge ${c.cls}`}>{c.label}</span>;
};

// ─── Tab: Facturas ────────────────────────────────────────────────────────────
const TabFacturas = ({ navigate }) => {
  const [facturas, setFacturas]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [busqueda, setBusqueda]   = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [modalAnular, setModalAnular]   = useState(null);
  const [motivoAnul,  setMotivoAnul]    = useState('');

  const cargar = useCallback(async ({ termino = busqueda, estado = filtroEstado } = {}) => {
    setLoading(true);
    try {
      const params = {};
      if (estado) params.estado = estado;
      if (termino) params.busqueda = termino;
      const res = await api.get('/facturas', { params });
      setFacturas(res.data.data || []);
    } catch {
      toast.error('Error al cargar facturas');
    } finally {
      setLoading(false);
    }
  }, [busqueda, filtroEstado]);

  useEffect(() => {
    if (!busqueda && !filtroEstado) {
      cargar({ termino: busqueda, estado: filtroEstado });
      return undefined;
    }

    const timer = setTimeout(() => {
      cargar({ termino: busqueda, estado: filtroEstado });
    }, 350);

    return () => clearTimeout(timer);
  }, [busqueda, cargar, filtroEstado]);

  const descargarPDF = async (factura) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5600'}/api/facturas/${factura.id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      toast.error('Error al generar PDF');
    }
  };

  const descargarXML = async (factura) => {
    try {
      const token = localStorage.getItem('token');
      const res   = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5600'}/api/facturas/${factura.id}/xml`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast.error('Sin XML disponible aún'); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `factura-${factura.numeroFactura}.xml`;
      a.click();
    } catch {
      toast.error('Error al descargar XML');
    }
  };

  const reenviarSRI = async (factura) => {
    const tid = toast.loading('Reenviando al SRI...');
    try {
      const res = await api.post(`/facturas/${factura.id}/reenviar`);
      toast.dismiss(tid);
      toast.success(res.data.mensaje || 'Reenviado');
      await cargar();
    } catch (err) {
      toast.dismiss(tid);
      toast.error(err.response?.data?.error || 'Error al reenviar');
    }
  };

  const confirmarAnular = async () => {
    try {
      await api.post(`/facturas/${modalAnular.id}/anular`, { motivo: motivoAnul });
      toast.success('Factura anulada');
      setModalAnular(null);
      setMotivoAnul('');
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al anular');
    }
  };

  return (
    <>
      {/* Filtros */}
      <div className="fact-filtros">
        <input
          className="fact-busqueda"
          placeholder="Buscar por N° factura, cliente o RUC/CI..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className="fact-select">
          <option value="">Todos los estados</option>
          <option value="PENDIENTE_FIRMA">Pendiente firma</option>
          <option value="ENVIADO">Enviado</option>
          <option value="AUTORIZADO">Autorizado</option>
          <option value="RECHAZADO">Rechazado</option>
          <option value="ANULADO">Anulado</option>
        </select>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="loading">Cargando facturas...</div>
      ) : facturas.length === 0 ? (
        <div className="fact-vacio">
          <p>No hay facturas registradas.</p>
          <button className="btn-primary" onClick={() => navigate('/facturas/nueva')}>
            + Emitir primera factura
          </button>
        </div>
      ) : (
        <div className="fact-table-wrap">
          <table className="fact-table">
            <thead>
              <tr>
                <th>N° Factura</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>CI / RUC</th>
                <th className="text-right">Total</th>
                <th>Estado SRI</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {facturas.map(f => (
                <tr key={f.id} className={f.anulada ? 'row-anulada' : ''}>
                  <td>
                    <button
                      className="fact-link"
                      onClick={() => navigate(`/facturas/${f.id}`)}
                    >
                      {f.numeroFactura}
                    </button>
                  </td>
                  <td>{format(new Date(f.fechaEmision), 'dd/MM/yyyy', { locale: es })}</td>
                  <td className="fact-cliente">{f.razonSocialComprador}</td>
                  <td>{f.identificacionComprador}</td>
                  <td className="text-right">
                    <strong>${parseFloat(f.importeTotal).toFixed(2)}</strong>
                  </td>
                  <td>
                    <BadgeEstado estado={f.estadoSri} />
                    {f.cobrada && (
                      <span
                        className="sri-badge cobrada"
                        title={f.fechaCobro ? `Cobrada el ${new Date(f.fechaCobro).toLocaleDateString('es-EC')}` : 'Cobrada'}
                        style={{ marginLeft: 4 }}
                      >
                        💰 Cobrada
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="fact-acciones">
                      <button
                        className="btn-icon" title="Ver detalle"
                        onClick={() => navigate(`/facturas/${f.id}`)}
                      >👁️</button>
                      <button
                        className="btn-icon" title="Descargar RIDE PDF"
                        onClick={() => descargarPDF(f)}
                      >📄</button>
                      {(f.estadoSri === 'AUTORIZADO' || f.xmlFirmado) && (
                        <button
                          className="btn-icon" title="Descargar XML"
                          onClick={() => descargarXML(f)}
                        >📥</button>
                      )}
                      {['PENDIENTE_FIRMA', 'RECHAZADO', 'ENVIADO'].includes(f.estadoSri) && !f.anulada && (
                        <button
                          className="btn-icon" title="Reenviar al SRI"
                          onClick={() => reenviarSRI(f)}
                        >🔄</button>
                      )}
                      {!f.anulada && f.estadoSri !== 'ANULADO' && (
                        <button
                          className="btn-icon danger" title="Anular factura"
                          onClick={() => setModalAnular(f)}
                        >✕</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal anular */}
      {modalAnular && (
        <div className="modal-overlay" onClick={() => setModalAnular(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Anular Factura {modalAnular.numeroFactura}</h3>
            <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '8px 0 16px' }}>
              Esta acción marcará la factura como <strong>ANULADA</strong>. Si necesita reembolsar,
              emita una Nota de Crédito desde el detalle de la factura.
            </p>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
              Motivo de anulación
            </label>
            <input
              className="modal-input"
              value={motivoAnul}
              onChange={e => setMotivoAnul(e.target.value)}
              placeholder="Ej: Error en datos del cliente"
            />
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setModalAnular(null)}>Cancelar</button>
              <button className="btn-danger" onClick={confirmarAnular}>Anular factura</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ─── Tab: Notas de Crédito ────────────────────────────────────────────────────
const TabNotasCredito = ({ navigate }) => {
  const [ncs, setNcs]       = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/facturas/notas-credito/lista')
      .then(r => setNcs(r.data.data || []))
      .catch(() => toast.error('Error al cargar NC'))
      .finally(() => setLoading(false));
  }, []);

  const descargarPDFnc = async (nc) => {
    const token = localStorage.getItem('token');
    const res   = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:5600'}/api/facturas/notas-credito/${nc.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  if (loading) return <div className="loading">Cargando Notas de Crédito...</div>;

  return (
    <div className="fact-table-wrap">
      {ncs.length === 0 ? (
        <div className="fact-vacio"><p>No hay Notas de Crédito emitidas.</p></div>
      ) : (
        <table className="fact-table">
          <thead>
            <tr>
              <th>N° NC</th>
              <th>Fecha</th>
              <th>Factura afectada</th>
              <th>Cliente</th>
              <th className="text-right">Total</th>
              <th>Estado SRI</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {ncs.map(nc => (
              <tr key={nc.id}>
                <td>{nc.numeroNC}</td>
                <td>{format(new Date(nc.fechaEmision), 'dd/MM/yyyy', { locale: es })}</td>
                <td>
                  <button className="fact-link" onClick={() => navigate(`/facturas/${nc.facturaId}`)}>
                    {nc.numeroFacturaAfectada}
                  </button>
                </td>
                <td>{nc.razonSocialComprador}</td>
                <td className="text-right"><strong>${parseFloat(nc.importeTotal).toFixed(2)}</strong></td>
                <td><BadgeEstado estado={nc.estadoSri} /></td>
                <td>
                  <button className="btn-icon" onClick={() => descargarPDFnc(nc)} title="Descargar RIDE NC">
                    📄
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────
const ListaFacturas = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState('facturas');

  return (
    <div className="lista-facturas-container">
      <div className="fact-header">
        <div>
          <h1>🧾 Facturación</h1>
          <p className="fact-subtitle">Comprobantes electrónicos autorizados por el SRI Ecuador</p>
        </div>
        <div className="fact-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/productos')}>
            📦 Productos
          </button>
          <button className="btn-secondary" onClick={() => navigate('/configuracion-sri')}>
            ⚙️ Configuración SRI
          </button>
          <button className="btn-primary" onClick={() => navigate('/facturas/nueva')}>
            + Nueva Factura
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="fact-tabs">
        <button
          className={`fact-tab ${tab === 'facturas' ? 'active' : ''}`}
          onClick={() => setTab('facturas')}
        >
          Facturas
        </button>
        <button
          className={`fact-tab ${tab === 'nc' ? 'active' : ''}`}
          onClick={() => setTab('nc')}
        >
          Notas de Crédito
        </button>
      </div>

      {tab === 'facturas'
        ? <TabFacturas navigate={navigate} />
        : <TabNotasCredito navigate={navigate} />
      }
    </div>
  );
};

export default ListaFacturas;
