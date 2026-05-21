// ====================================
// COMPONENTE: DETALLE DE FACTURA
// frontend/src/components/Facturacion/DetalleFactura.jsx
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatFechaLarga, formatFechaHora } from '../../utils/fecha';
import './DetalleFactura.css';
// ─── Timeline de estado SRI ───────────────────────────────────────────────────
const PASOS_SRI = [
  { key: 'PENDIENTE_FIRMA', label: 'Generado',  icon: '📄' },
  { key: 'ENVIADO',         label: 'Enviado',   icon: '📤' },
  { key: 'AUTORIZADO',      label: 'Autorizado', icon: '✅' },
];

const TimelineSRI = ({ estado }) => {
  const orden = { PENDIENTE_FIRMA: 0, LISTO_ENVIAR: 0, ENVIADO: 1, AUTORIZADO: 2, RECHAZADO: -1, ANULADO: -1 };
  const paso  = orden[estado] ?? 0;
  const rechazado = estado === 'RECHAZADO';
  const anulado   = estado === 'ANULADO';

  return (
    <div className="sri-timeline">
      {PASOS_SRI.map((p, i) => {
        const done    = i <= paso && !rechazado && !anulado;
        const current = i === paso && !rechazado && !anulado;
        return (
          <div key={p.key} className={`timeline-paso ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
            <div className="timeline-icon">{rechazado && i === 1 ? '❌' : anulado && i === 0 ? '🚫' : p.icon}</div>
            <span className="timeline-label">{p.label}</span>
            {i < PASOS_SRI.length - 1 && <div className={`timeline-linea ${i < paso && !rechazado ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────
const DetalleFactura = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [factura,    setFactura]    = useState(null);
  const [loading,    setLoading]    = useState(true);

  // Modal Nota de Crédito
  const [modalNC,    setModalNC]    = useState(false);
  const [ncMotivo,   setNcMotivo]   = useState('');
  const [ncDetalles, setNcDetalles] = useState([]);
  const [enviandoNC, setEnviandoNC] = useState(false);

  // Modal Anular
  const [modalAnular,  setModalAnular]  = useState(false);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [anulando,     setAnulando]     = useState(false);
  const [ncAnulacion,  setNcAnulacion]  = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/facturas/${id}`);
      const f   = res.data.data;
      setFactura(f);
      // Inicializar detalles NC con los mismos detalles de la factura
      const dets = typeof f.detalles === 'string' ? JSON.parse(f.detalles) : f.detalles;
      setNcDetalles(dets.map(d => ({ ...d, incluir: true })));
    } catch {
      toast.error('Error al cargar la factura');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirPDF = async (endpoint, nombreArchivo) => {
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const base  = (import.meta.env.VITE_API_URL || 'http://localhost:5600/api').replace(/\/api$/, '');
      const res   = await fetch(`${base}/api${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast.error('No se pudo generar el documento'); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.target   = '_blank';
      a.rel      = 'noopener noreferrer';
      if (nombreArchivo) a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error('Error al abrir el documento');
    }
  };

  const descargarPDF  = () => abrirPDF(`/facturas/${id}/pdf`);
  const imprimirRecibo = () => abrirPDF(`/facturas/${id}/recibo`);

  const descargarXML = async () => {
    const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
    const base  = (import.meta.env.VITE_API_URL || 'http://localhost:5600/api').replace(/\/api$/, '');
    const res   = await fetch(`${base}/api/facturas/${id}/xml`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { toast.error('Sin XML disponible'); return; }
    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `factura-${factura.numeroFactura}.xml`;
    a.click();
  };

  const reenviar = async () => {
    const tid = toast.loading('Reenviando al SRI...');
    try {
      const res = await api.post(`/facturas/${id}/reenviar`);
      toast.dismiss(tid);
      toast.success(res.data.mensaje);
      await cargar();
    } catch (err) {
      toast.dismiss(tid);
      toast.error(err.response?.data?.error || 'Error');
    }
  };

  const emitirNC = async () => {
    const detallesFiltrados = ncDetalles.filter(d => d.incluir);
    if (!ncMotivo) return toast.error('Escribe el motivo de la Nota de Crédito');
    if (!detallesFiltrados.length) return toast.error('Selecciona al menos un ítem');
    setEnviandoNC(true);
    try {
      const res = await api.post('/facturas/notas-credito', {
        facturaId: factura.id,
        motivoModificacion: ncMotivo,
        detalles: detallesFiltrados.map(d => ({
          descripcion:    d.descripcion,
          cantidad:       d.cantidad,
          precioUnitario: d.precioUnitario,
          ivaPorcentaje:  d.ivaPorcentaje,
        })),
      });
      toast.success(`Nota de Crédito ${res.data.data.numeroNC} emitida`);
      setModalNC(false);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al emitir NC');
    } finally {
      setEnviandoNC(false);
    }
  };

  const anularFactura = async () => {
    if (!motivoAnular.trim()) return toast.error('Escribe el motivo de anulación');
    setAnulando(true);
    try {
      const res = await api.post(`/facturas/${id}/anular`, { motivo: motivoAnular });
      toast.success(res.data.mensaje || 'Factura anulada');
      setModalAnular(false);
      setMotivoAnular('');
      if (res.data.ncAnulacion) setNcAnulacion(res.data.ncAnulacion);
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al anular');
    } finally {
      setAnulando(false);
    }
  };

  if (loading) return <div className="loading">Cargando factura...</div>;
  if (!factura) return <div className="error">Factura no encontrada</div>;

  const detalles = typeof factura.detalles === 'string' ? JSON.parse(factura.detalles) : factura.detalles;
  const pagos    = typeof factura.pagos    === 'string' ? JSON.parse(factura.pagos)    : factura.pagos;
  const mensajes = factura.mensajesSri;

  return (
    <div className="detalle-factura-container">
      {/* Header */}
      <div className="det-fact-header">
        <div>
          <h1>Factura {factura.numeroFactura}</h1>
          <p className="det-fact-fecha">
            Emitida el {formatFechaLarga(factura.fechaEmision)}
            {factura.anulada && <span className="badge-anulada">ANULADA</span>}
          </p>
        </div>
        <div className="det-fact-acciones">
          <button className="btn-secondary" onClick={() => navigate('/facturas')}>← Volver</button>
          <button className="btn-secondary" onClick={descargarPDF}>📄 RIDE PDF</button>
          <button className="btn-secondary" onClick={imprimirRecibo}>🖨️ Recibo POS</button>
          <button className="btn-secondary" onClick={descargarXML}>📥 XML</button>
          {['PENDIENTE_FIRMA', 'RECHAZADO'].includes(factura.estadoSri) && !factura.anulada && (
            <button className="btn-secondary" onClick={reenviar}>🔄 Reenviar SRI</button>
          )}
          {!factura.anulada && factura.estadoSri !== 'ANULADO' && (
            <button className="btn-danger-outline" onClick={() => setModalAnular(true)}>
              🚫 Anular factura
            </button>
          )}
          {!factura.anulada && factura.estadoSri !== 'ANULADO' && (
            <button className="btn-nc" onClick={() => setModalNC(true)}>
              📝 Nota de Crédito
            </button>
          )}
        </div>
      </div>

      {/* Timeline SRI */}
      <div className="det-card">
        <h2>Estado SRI</h2>
        <TimelineSRI estado={factura.estadoSri} />
        {factura.numeroAutorizacion && (
          <div className="det-autorizacion">
            <span className="det-label">N° Autorización:</span>
            <code className="det-codigo">{factura.numeroAutorizacion}</code>
          </div>
        )}
        {factura.fechaAutorizacion && (
          <div className="det-autorizacion">
            <span className="det-label">Fecha Autorización:</span>
            <span>{formatFechaHora(factura.fechaAutorizacion)}</span>
          </div>
        )}
        {factura.estadoSri === 'RECHAZADO' && mensajes && (
          <div className="det-errores">
            <strong>Mensajes del SRI:</strong>
            <pre>{JSON.stringify(mensajes, null, 2)}</pre>
          </div>
        )}
        <div className="det-clave">
          <span className="det-label">Clave de Acceso:</span>
          <code className="det-codigo small">{factura.claveAcceso}</code>
        </div>
      </div>

      {/* Datos del comprador */}
      <div className="det-grid-2">
        <div className="det-card">
          <h2>🏢 Emisor</h2>
          <div className="det-row"><span>RUC:</span><strong>{factura.rucEmisor}</strong></div>
          <div className="det-row"><span>Razón Social:</span><strong>{factura.razonSocialEmisor}</strong></div>
        </div>
        <div className="det-card">
          <h2>👤 Receptor</h2>
          <div className="det-row"><span>Identificación:</span><strong>{factura.identificacionComprador}</strong></div>
          <div className="det-row"><span>Razón Social:</span><strong>{factura.razonSocialComprador}</strong></div>
          {factura.direccionComprador && (
            <div className="det-row"><span>Dirección:</span><span>{factura.direccionComprador}</span></div>
          )}
          {factura.emailComprador && (
            <div className="det-row"><span>Email:</span><span>{factura.emailComprador}</span></div>
          )}
        </div>
      </div>

      {/* Detalles */}
      <div className="det-card">
        <h2>📋 Detalles</h2>
        <div className="det-tabla-wrap">
          <table className="det-tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">P. Unit.</th>
                <th className="text-right">Desc.</th>
                <th>IVA</th>
                <th className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {detalles.map((d, i) => {
                const cant  = parseFloat(d.cantidad)        || 0;
                const prec  = parseFloat(d.precioUnitario)  || 0;
                const desc  = parseFloat(d.descuento)       || 0;
                const sub   = (cant * prec - desc).toFixed(2);
                return (
                  <tr key={i}>
                    <td>{d.codigoPrincipal || '—'}</td>
                    <td>{d.descripcion}</td>
                    <td className="text-right">{cant}</td>
                    <td className="text-right">${prec.toFixed(2)}</td>
                    <td className="text-right">${desc.toFixed(2)}</td>
                    <td><span className="iva-badge">{d.ivaPorcentaje || 0}%</span></td>
                    <td className="text-right"><strong>${sub}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totales */}
        <div className="det-totales">
          <div className="det-total-fila"><span>Subtotal 0%:</span><span>${parseFloat(factura.subtotal0).toFixed(2)}</span></div>
          <div className="det-total-fila"><span>Subtotal 15%:</span><span>${parseFloat(factura.subtotal15).toFixed(2)}</span></div>
          <div className="det-total-fila"><span>Total Descuento:</span><span>-${parseFloat(factura.totalDescuento).toFixed(2)}</span></div>
          <div className="det-total-fila"><span>IVA:</span><span>${parseFloat(factura.totalIva).toFixed(2)}</span></div>
          {parseFloat(factura.propina) > 0 && (
            <div className="det-total-fila"><span>Propina:</span><span>${parseFloat(factura.propina).toFixed(2)}</span></div>
          )}
          <div className="det-total-fila principal"><span>TOTAL:</span><span>${parseFloat(factura.importeTotal).toFixed(2)}</span></div>
        </div>
      </div>

      {/* Pago */}
      <div className="det-card">
        <h2>💳 Forma de Pago</h2>
        {pagos?.map((p, i) => (
          <div key={i} className="det-row">
            <span>{p.formaPago}:</span>
            <strong>${parseFloat(p.total).toFixed(2)}</strong>
          </div>
        ))}
      </div>

      {/* Modal Anular factura */}
      {modalAnular && (
        <div className="modal-overlay" onClick={() => setModalAnular(false)}>
          <div className="modal-content nc-modal" onClick={e => e.stopPropagation()}>
            <h3>🚫 Anular Factura {factura.numeroFactura}</h3>

            {factura.estadoSri === 'AUTORIZADO' ? (
              <div className="anular-warning">
                <p>⚠️ <strong>Esta factura ya fue autorizada por el SRI.</strong></p>
                <p style={{ marginTop: 8 }}>
                  El sistema generará automáticamente una <strong>Nota de Crédito al 100%</strong>
                  {' '}con el motivo indicado. La NC quedará pendiente de envío al SRI y
                  compensará esta factura en el registro tributario.
                </p>
              </div>
            ) : (
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '8px 0 12px' }}>
                La factura no está autorizada por el SRI. Se marcará como
                <strong> ANULADA</strong> localmente y se revertirán los movimientos
                de inventario y caja.
              </p>
            )}

            <div className="nc-field">
              <label>Motivo de anulación *</label>
              <input
                value={motivoAnular}
                onChange={e => setMotivoAnular(e.target.value)}
                placeholder="Ej: Error en datos del cliente, factura duplicada..."
              />
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setModalAnular(false); setMotivoAnular(''); }}>
                Cancelar
              </button>
              <button
                className="btn-danger"
                onClick={anularFactura}
                disabled={anulando || !motivoAnular.trim()}
              >
                {anulando ? 'Anulando...' : (factura.estadoSri === 'AUTORIZADO' ? '🚫 Anular + emitir NC' : '🚫 Anular factura')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado NC de anulación */}
      {ncAnulacion && (
        <div className="modal-overlay" onClick={() => setNcAnulacion(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>✅ Anulación procesada</h3>
            <div className="anular-nc-info">
              <p>📄 Nota de Crédito emitida: <strong>{ncAnulacion.numeroNC}</strong></p>
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: 6 }}>
                La NC está pendiente de firma y envío al SRI.
                Ve al <strong>Buzón SRI</strong> para enviarla y obtener la autorización.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setNcAnulacion(null)}>Cerrar</button>
              <button className="btn-primary" onClick={() => navigate('/buzon-sri')}>
                📤 Ir al Buzón SRI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Nota de Crédito */}
      {modalNC && (
        <div className="modal-overlay">
          <div className="modal-content nc-modal" onClick={e => e.stopPropagation()}>
            <h3>📝 Emitir Nota de Crédito</h3>
            <p className="nc-desc">
              La NC se emite contra la factura <strong>{factura.numeroFactura}</strong>.
              Selecciona los ítems a acreditar y escribe el motivo.
            </p>

            <div className="nc-field">
              <label>Motivo de la Nota de Crédito *</label>
              <input
                value={ncMotivo}
                onChange={e => setNcMotivo(e.target.value)}
                placeholder="Ej: Anulación por error en datos, devolución de servicio..."
              />
            </div>

            <div className="nc-detalles-lista">
              <label>Ítems a incluir en la NC</label>
              {ncDetalles.map((d, i) => (
                <label key={i} className="nc-det-item">
                  <input
                    type="checkbox"
                    checked={d.incluir}
                    onChange={e => setNcDetalles(prev => prev.map((x, j) => j === i ? { ...x, incluir: e.target.checked } : x))}
                  />
                  <span>{d.descripcion} — {d.cantidad} x ${parseFloat(d.precioUnitario).toFixed(2)}</span>
                </label>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setModalNC(false)}>Cancelar</button>
              <button className="btn-primary" onClick={emitirNC} disabled={enviandoNC}>
                {enviandoNC ? 'Emitiendo...' : '✅ Emitir NC'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DetalleFactura;
