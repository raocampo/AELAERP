// ====================================
// COMPONENTE: LISTA DE FACTURAS
// frontend/src/components/Facturacion/ListaFacturas.jsx
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatFechaCorta } from '../../utils/fecha';
import { IcVer, IcPDF, IcDescargar, IcReenviar, IcAnular } from '../../utils/icons';
import { descargarExcel } from '../../utils/exportCsv';
import { printHtmlReport, buildDataTable } from '../../utils/reportPrint';
import './ListaFacturas.css';

// Base URL del servidor sin /api al final (para fetch directo con Authorization header)
const SERVER_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5600/api').replace(/\/api$/, '');

// ─── Badge de estado SRI ─────────────────────────────────────────────────────
const BadgeEstado = ({ estado }) => {
  const conf = {
    PENDIENTE_FIRMA: { label: 'Pendiente firma', cls: 'pendiente-firma' },
    LISTO_ENVIAR:    { label: 'Listo enviar',    cls: 'listo-enviar'    },
    ENVIADO:         { label: 'Enviado',          cls: 'enviado'         },
    AUTORIZADO:      { label: 'Autorizado',       cls: 'autorizado'      },
    RECHAZADO:       { label: 'Rechazado',        cls: 'rechazado'       },
    ANULADO:         { label: 'Anulado',          cls: 'anulado'         },
    HISTORICO:       { label: 'Histórica',        cls: 'listo-enviar'    },
  };
  const c = conf[estado] || { label: estado, cls: 'pendiente-firma' };
  return <span className={`sri-badge ${c.cls}`}>{c.label}</span>;
};

// ─── Tab: Facturas ────────────────────────────────────────────────────────────
const TabFacturas = ({ navigate, onIrNC }) => {
  const [facturas, setFacturas]   = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [busqueda, setBusqueda]   = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [modalAnular, setModalAnular]   = useState(null);
  const [motivoAnul,  setMotivoAnul]    = useState('');
  const [anulandoId,  setAnulandoId]    = useState(null);
  const [ncResultado, setNcResultado]   = useState(null);
  const [exportando,      setExportando]      = useState(false);
  const [imprimiendoPdf,  setImprimiendoPdf]  = useState(false);

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
      const res = await fetch(`${SERVER_BASE}/api/facturas/${factura.id}/pdf`, {
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
      const res   = await fetch(`${SERVER_BASE}/api/facturas/${factura.id}/xml`, {
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
      const estadoFinal = res.data.data?.estadoSri || '';
      if (estadoFinal === 'AUTORIZADO') {
        toast.success('¡Factura autorizada por el SRI!');
      } else if (estadoFinal === 'RECHAZADO') {
        toast.error(res.data.mensaje || 'Rechazado por el SRI');
      } else {
        toast.success(res.data.mensaje || 'Procesado');
      }
      await cargar();
    } catch (err) {
      toast.dismiss(tid);
      toast.error(err.response?.data?.error || 'Error al reenviar');
    }
  };

  const exportarExcel = async () => {
    setExportando(true);
    try {
      const params = {};
      if (filtroEstado) params.estado = filtroEstado;
      if (busqueda)     params.busqueda = busqueda;
      await descargarExcel(api, '/facturas/exportar/xlsx', params, `ventas-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Excel exportado correctamente');
    } catch {
      toast.error('No se pudo exportar el Excel');
    } finally {
      setExportando(false);
    }
  };

  const imprimirPdf = async () => {
    setImprimiendoPdf(true);
    try {
      const cfg    = await api.get('/facturas/configuracion').catch(() => ({ data: { data: {} } }));
      const stored = JSON.parse(localStorage.getItem('aela_empresa') || '{}');
      const d      = cfg.data?.data || {};
      const empresa = {
        razonSocial: d.razonSocial || stored.razonSocial || '',
        ruc:         d.ruc         || stored.ruc         || '',
        direccion:   d.dirMatriz   || stored.direccion   || '',
        telefono:    d.telefono    || stored.telefono    || '',
        email:       d.emailNotificaciones || stored.email || '',
        logoUrl:     d.logoUrl     || null,
      };

      const estadoLabel = {
        PENDIENTE_FIRMA: 'Pendiente firma', LISTO_ENVIAR: 'Listo enviar',
        ENVIADO: 'Enviado', AUTORIZADO: 'Autorizado',
        RECHAZADO: 'Rechazado', ANULADO: 'Anulado', HISTORICO: 'Histórica',
      };

      const filas = facturas.map((f) => [
        f.numeroFactura || '',
        formatFechaCorta(f.fechaEmision),
        f.razonSocialComprador || '',
        f.identificacionComprador || '',
        `$${Number(f.importeTotal || 0).toFixed(2)}`,
        estadoLabel[f.estadoSri] || f.estadoSri || '',
        f.anulada ? 'Sí' : 'No',
      ]);

      const totalGeneral = facturas.reduce((s, f) => s + Number(f.importeTotal || 0), 0);
      filas.push(['', 'TOTAL', '', '', `$${totalGeneral.toFixed(2)}`, '', '']);

      const tabla = buildDataTable(
        ['Nro Factura', 'Fecha', 'Cliente', 'CI/RUC', 'Total', 'Estado SRI', 'Anulada'],
        filas,
      );

      let subtitulo = `${facturas.length} registro(s)`;
      if (filtroEstado) subtitulo += ` | Estado: ${estadoLabel[filtroEstado] || filtroEstado}`;
      if (busqueda)     subtitulo += ` | Búsqueda: "${busqueda}"`;

      printHtmlReport({
        title: 'Libro de Ventas',
        subtitle: subtitulo,
        sections: [{ title: 'Detalle de Facturas', html: tabla }],
        empresa,
      });
    } catch {
      toast.error('No se pudo generar el PDF');
    } finally {
      setImprimiendoPdf(false);
    }
  };

  const confirmarAnular = async () => {
    if (!motivoAnul.trim()) return toast.error('Escribe el motivo de anulación');
    setAnulandoId(modalAnular.id);
    try {
      const res = await api.post(`/facturas/${modalAnular.id}/anular`, { motivo: motivoAnul });
      toast.success(res.data.mensaje || 'Factura anulada');
      if (res.data.ncAnulacion) {
        setNcResultado({ factura: modalAnular, nc: res.data.ncAnulacion });
      }
      setModalAnular(null);
      setMotivoAnul('');
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al anular');
    } finally {
      setAnulandoId(null);
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
          <option value="HISTORICO">Histórica</option>
        </select>
      </div>

      {/* Exportar */}
      <div className="fact-export-bar">
        <button className="btn-secondary" onClick={exportarExcel} disabled={exportando || facturas.length === 0}>
          {exportando ? 'Exportando…' : '⬇ Excel'}
        </button>
        <button className="btn-secondary" onClick={imprimirPdf} disabled={imprimiendoPdf || facturas.length === 0}>
          {imprimiendoPdf ? 'Generando…' : '🖨 PDF'}
        </button>
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
                  <td>{formatFechaCorta(f.fechaEmision)}</td>
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
                        title={f.fechaCobro ? `Cobrada el ${formatFechaCorta(f.fechaCobro)}` : 'Cobrada'}
                        style={{ marginLeft: 4 }}
                      >
                        💰 Cobrada
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="tbl-acciones">
                      <button className="btn-icon ic-ver" title="Ver detalle"
                        onClick={() => navigate(`/facturas/${f.id}`)}>
                        <IcVer/>
                      </button>
                      <button className="btn-icon ic-pdf" title="Descargar RIDE PDF"
                        onClick={() => descargarPDF(f)}>
                        <IcPDF/>
                      </button>
                      {(f.estadoSri === 'AUTORIZADO' || f.xmlFirmado) && (
                        <button className="btn-icon ic-xml" title="Descargar XML"
                          onClick={() => descargarXML(f)}>
                          <IcDescargar/>
                        </button>
                      )}
                      {['PENDIENTE_FIRMA', 'RECHAZADO', 'ENVIADO'].includes(f.estadoSri) && !f.anulada && (
                        <button className="btn-icon ic-reenviar" title="Reenviar al SRI"
                          onClick={() => reenviarSRI(f)}>
                          <IcReenviar/>
                        </button>
                      )}
                      {!f.anulada && f.estadoSri !== 'ANULADO' && (
                        <button className="btn-icon ic-anular" title="Anular factura"
                          onClick={() => setModalAnular(f)}>
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

      {/* Modal anular */}
      {modalAnular && (
        <div className="modal-overlay" onClick={() => setModalAnular(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>🚫 Anular Factura {modalAnular.numeroFactura}</h3>

            {modalAnular.estadoSri === 'AUTORIZADO' ? (
              <div className="anular-warning">
                <p>⚠️ <strong>Esta factura ya fue autorizada por el SRI.</strong></p>
                <p style={{ marginTop: 8 }}>
                  Según el procedimiento fiscal ecuatoriano, no es posible cancelar
                  directamente un comprobante autorizado. El sistema emitirá
                  automáticamente una <strong>Nota de Crédito al 100%</strong> con el
                  motivo indicado, la cual será enviada al SRI para compensar la factura.
                </p>
              </div>
            ) : (
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '8px 0 4px' }}>
                La factura no está autorizada por el SRI, se marcará como
                <strong> ANULADA</strong> internamente y se revertirán los movimientos
                de inventario y caja correspondientes.
              </p>
            )}

            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, margin: '14px 0 6px' }}>
              Motivo de anulación *
            </label>
            <input
              className="modal-input"
              value={motivoAnul}
              onChange={e => setMotivoAnul(e.target.value)}
              placeholder="Ej: Error en datos del cliente, duplicada, etc."
            />

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setModalAnular(null); setMotivoAnul(''); }}>
                Cancelar
              </button>
              <button
                className="btn-danger"
                onClick={confirmarAnular}
                disabled={!!anulandoId || !motivoAnul.trim()}
              >
                {anulandoId ? 'Anulando...' : (modalAnular.estadoSri === 'AUTORIZADO' ? '🚫 Anular + emitir NC' : '🚫 Anular factura')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal resultado NC de anulación */}
      {ncResultado && (
        <div className="modal-overlay" onClick={() => setNcResultado(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>✅ Anulación procesada</h3>
            <p>
              La factura <strong>{ncResultado.factura.numeroFactura}</strong> fue anulada.
            </p>
            <div className="anular-nc-info">
              <p>📄 Nota de Crédito generada: <strong>{ncResultado.nc.numeroNC}</strong></p>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 6 }}>
                La NC está pendiente de firma y envío al SRI. Ve a la pestaña
                <em> Notas de Crédito</em> o al buzón SRI para enviarla.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setNcResultado(null)}>Cerrar</button>
              <button className="btn-primary" onClick={() => { setNcResultado(null); onIrNC(); }}>
                Ver Notas de Crédito
              </button>
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
  const [enviando, setEnviando] = useState(null);

  const recargar = () => {
    setLoading(true);
    api.get('/facturas/notas-credito/lista')
      .then(r => setNcs(r.data.data || []))
      .catch(() => toast.error('Error al cargar NC'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { recargar(); }, []);

  const descargarPDFnc = async (nc) => {
    const token = localStorage.getItem('token');
    const res   = await fetch(`${SERVER_BASE}/api/facturas/notas-credito/${nc.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), '_blank');
  };

  const enviarSRI = async (nc) => {
    if (!window.confirm(`¿Reenviar la Nota de Crédito ${nc.numeroNC} al SRI para firma y autorización?`)) return;
    setEnviando(nc.id);
    try {
      const res = await api.post(`/facturas/notas-credito/${nc.id}/reenviar`);
      const estado = res.data?.data?.estadoSri || '';
      toast.success(`NC procesada. Estado: ${estado || 'actualizado'}`);
      recargar();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al reenviar al SRI');
    } finally {
      setEnviando(null);
    }
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
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {ncs.map(nc => (
              <tr key={nc.id}>
                <td>{nc.numeroNC}</td>
                <td>{formatFechaCorta(nc.fechaEmision)}</td>
                <td>
                  <button className="fact-link" onClick={() => navigate(`/facturas/${nc.facturaId}`)}>
                    {nc.numeroFacturaAfectada}
                  </button>
                </td>
                <td>{nc.razonSocialComprador}</td>
                <td className="text-right"><strong>${parseFloat(nc.importeTotal).toFixed(2)}</strong></td>
                <td><BadgeEstado estado={nc.estadoSri} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <div className="tbl-acciones">
                    <button className="btn-icon ic-pdf" onClick={() => descargarPDFnc(nc)} title="Descargar RIDE NC">
                      <IcPDF/>
                    </button>
                    {['PENDIENTE_FIRMA', 'RECHAZADO', 'FIRMADO_PENDIENTE_ENVIO'].includes(nc.estadoSri) && (
                      <button
                        className="btn-icon ic-reenviar"
                        onClick={() => enviarSRI(nc)}
                        disabled={enviando === nc.id}
                        title="Enviar al SRI"
                      >
                        <IcReenviar/>
                      </button>
                    )}
                  </div>
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
        ? <TabFacturas navigate={navigate} onIrNC={() => setTab('nc')} />
        : <TabNotasCredito navigate={navigate} />
      }
    </div>
  );
};

export default ListaFacturas;
