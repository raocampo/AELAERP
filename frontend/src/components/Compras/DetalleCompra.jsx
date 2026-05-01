import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import './DetalleCompra.css';

const FORMAS_PAGO = {
  '01': 'Sin utilizacion del sistema financiero',
  '15': 'Compensacion de deudas',
  '16': 'Tarjeta de debito',
  '17': 'Dinero electronico',
  '18': 'Tarjeta prepago',
  '19': 'Tarjeta de credito',
  '20': 'Otros con utilizacion del sistema financiero',
  '21': 'Endoso de titulos',
};

function parseJsonField(valor, fallback = []) {
  if (!valor) return fallback;
  if (typeof valor === 'string') {
    try { return JSON.parse(valor); } catch { return fallback; }
  }
  return valor;
}

function fmtFecha(valor, withTime = false) {
  if (!valor) return 'Sin fecha';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return 'Sin fecha';
  return fecha.toLocaleString('es-EC', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
}

function fmtMoneda(valor) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(Number(valor || 0));
}

function fmtNumero(valor, digits = 2) {
  return new Intl.NumberFormat('es-EC', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(valor || 0));
}

function fmtBool(valor, yes = 'Si', no = 'No') { return valor ? yes : no; }

function etiquetaFormaPago(codigo) {
  if (!codigo) return 'Sin forma de pago';
  return FORMAS_PAGO[codigo] ? `${codigo} - ${FORMAS_PAGO[codigo]}` : codigo;
}

export default function DetalleCompra() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { esPro, sistema } = useAuth();
  const [compra, setCompra] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modal editar
  const [modalEditar, setModalEditar] = useState(false);
  const [editObs, setEditObs] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Modal anular
  const [modalAnular, setModalAnular] = useState(false);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [anulando, setAnulando] = useState(false);

  const cargar = async (ignore = false) => {
    setLoading(true);
    try {
      const res = await api.get(`/compras/${id}`);
      if (!ignore) setCompra(res.data?.data || null);
    } catch (error) {
      if (!ignore) {
        toast.error(error.response?.data?.mensaje || 'No se pudo cargar la compra');
        navigate('/compras', { replace: true });
      }
    } finally {
      if (!ignore) setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    cargar(ignore);
    return () => { ignore = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const abrirEditar = () => {
    setEditObs(compra?.observaciones || '');
    setModalEditar(true);
  };

  const guardarEdicion = async () => {
    setGuardando(true);
    try {
      await api.put(`/compras/${id}`, { observaciones: editObs });
      toast.success('Compra actualizada');
      setModalEditar(false);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  const confirmarAnulacion = async () => {
    if (!motivoAnulacion.trim()) {
      toast.error('Debes ingresar el motivo de anulación');
      return;
    }
    setAnulando(true);
    try {
      const res = await api.patch(`/compras/${id}/anular`, { motivoAnulacion });
      const { resumen } = res.data;
      let msg = 'Compra anulada.';
      if (resumen?.inventarioRevertido > 0) msg += ` Inventario revertido (${resumen.inventarioRevertido} mov.).`;
      if (resumen?.cajaRevertida) msg += ' Caja revertida.';
      toast.success(msg, { duration: 5000 });
      setModalAnular(false);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo anular');
    } finally {
      setAnulando(false);
    }
  };

  if (loading) return <div className="detalle-compra-empty">Cargando compra...</div>;
  if (!compra) return <div className="detalle-compra-empty">Compra no encontrada.</div>;

  const detalles = parseJsonField(compra.detalles, []);
  const pagos = parseJsonField(compra.pagos, []);
  const subtotalTarifa0 = Number(compra.subtotal0 || 0);
  const subtotalTarifa5 = Number(compra.subtotal5 || 0);
  const subtotalTarifa15 = Number(compra.subtotal15 || 0);
  const totalRetenido = Number(compra.retencionIVA || 0) + Number(compra.retencionRenta || 0);
  const retenciones = compra.retenciones || [];
  const retencionesDisponibles = esPro && Boolean(sistema?.retencionesHabilitadas);

  return (
    <div className="detalle-compra-page">
      {/* MODAL EDITAR */}
      {modalEditar && (
        <div className="dc-modal-overlay" onClick={() => setModalEditar(false)}>
          <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Editar compra {compra.numeroFactura}</h3>
            <label className="dc-modal-label">
              Observaciones
              <textarea
                className="dc-modal-textarea"
                value={editObs}
                onChange={(e) => setEditObs(e.target.value)}
                rows={4}
                placeholder="Observaciones internas de la compra..."
              />
            </label>
            <div className="dc-modal-actions">
              <button className="btn-secondary" onClick={() => setModalEditar(false)} disabled={guardando}>Cancelar</button>
              <button className="btn-primary" onClick={guardarEdicion} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ANULAR */}
      {modalAnular && (
        <div className="dc-modal-overlay" onClick={() => setModalAnular(false)}>
          <div className="dc-modal dc-modal--danger" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ Anular compra {compra.numeroFactura}</h3>
            <p className="dc-modal-warn">
              Esta acción es irreversible. Se anulará la compra por{' '}
              <strong>{fmtMoneda(compra.importeTotal)}</strong>
              {compra.movimientosInventario > 0 && ` y se revertirán ${compra.movimientosInventario} movimiento(s) de inventario`}
              {compra.egresoCajaRegistrado && ', y se registrará el ingreso correspondiente en caja'}.
            </p>
            <label className="dc-modal-label">
              Motivo de anulación <span style={{ color: '#ef4444' }}>*</span>
              <input
                className="dc-modal-input"
                value={motivoAnulacion}
                onChange={(e) => setMotivoAnulacion(e.target.value)}
                placeholder="Ej: Error de registro, duplicado, etc."
              />
            </label>
            <div className="dc-modal-actions">
              <button className="btn-secondary" onClick={() => setModalAnular(false)} disabled={anulando}>Cancelar</button>
              <button className="btn-danger" onClick={confirmarAnulacion} disabled={anulando || !motivoAnulacion.trim()}>
                {anulando ? 'Anulando…' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="detalle-compra-header">
        <div>
          <h1>Compra {compra.numeroFactura}</h1>
          <p>
            Registrada el {fmtFecha(compra.createdAt, true)}
            {compra.anulada && <span className="detalle-compra-badge detalle-compra-badge-alert">Anulada</span>}
          </p>
          {compra.anulada && compra.motivoAnulacion && (
            <p style={{ color: '#b91c1c', fontSize: '0.9rem', marginTop: 4 }}>
              Motivo: {compra.motivoAnulacion}
            </p>
          )}
        </div>
        <div className="detalle-compra-actions">
          <button className="btn-secondary" onClick={() => navigate('/compras')}>Volver al listado</button>
          {retencionesDisponibles && !compra.anulada && (
            <button className="btn-secondary" onClick={() => navigate(`/retenciones/nueva?compraId=${compra.id}`)}>
              Emitir retención
            </button>
          )}
          {!compra.anulada && (
            <button className="btn-secondary" onClick={abrirEditar}>✏️ Editar</button>
          )}
          {!compra.anulada && (
            <button className="btn-danger" onClick={() => { setMotivoAnulacion(''); setModalAnular(true); }}>
              🗑 Anular
            </button>
          )}
          <button className="btn-primary" onClick={() => navigate('/compras/nueva')}>Nueva compra</button>
        </div>
      </div>

      <section className="detalle-compra-grid">
        <article className="detalle-compra-card">
          <h2>Proveedor</h2>
          <div className="detalle-compra-row"><span>Identificacion</span><strong>{compra.identificacionProveedor}</strong></div>
          <div className="detalle-compra-row"><span>Razon social</span><strong>{compra.razonSocialProveedor}</strong></div>
          {compra.proveedor && (
            <div className="detalle-compra-row"><span>Proveedor maestro</span><strong>{compra.proveedor.razonSocial}</strong></div>
          )}
          {compra.nombreComercialProveedor && (
            <div className="detalle-compra-row"><span>Nombre comercial</span><strong>{compra.nombreComercialProveedor}</strong></div>
          )}
          {compra.direccionProveedor && (
            <div className="detalle-compra-row"><span>Direccion</span><span>{compra.direccionProveedor}</span></div>
          )}
          <div className="detalle-compra-row"><span>Tipo identificacion</span><span>{compra.tipoIdentificacionProveedor}</span></div>
        </article>

        <article className="detalle-compra-card">
          <h2>Comprobante</h2>
          <div className="detalle-compra-row"><span>Fecha emision</span><strong>{fmtFecha(compra.fechaEmision)}</strong></div>
          <div className="detalle-compra-row"><span>Nro. factura</span><strong>{compra.numeroFactura}</strong></div>
          <div className="detalle-compra-row"><span>Autorizacion</span><span>{compra.numeroAutorizacion || 'Sin autorizacion'}</span></div>
          <div className="detalle-compra-row"><span>Clave acceso</span><span className="detalle-compra-wrap">{compra.claveAcceso || 'No registrada'}</span></div>
          <div className="detalle-compra-row"><span>Origen</span><span className="detalle-compra-badge">{compra.origenRegistro || 'MANUAL'}</span></div>
        </article>

        <article className="detalle-compra-card">
          <h2>Operacion</h2>
          <div className="detalle-compra-row"><span>Total</span><strong>{fmtMoneda(compra.importeTotal)}</strong></div>
          <div className="detalle-compra-row"><span>Inventario aplicado</span><strong>{fmtBool(compra.movimientosInventario > 0, `Si (${compra.movimientosInventario})`, 'No')}</strong></div>
          <div className="detalle-compra-row"><span>Egreso en caja</span><strong>{fmtBool(compra.egresoCajaRegistrado)}</strong></div>
          <div className="detalle-compra-row"><span>Productos auto-creados</span><strong>{fmtBool(compra.creaProductos)}</strong></div>
          <div className="detalle-compra-row"><span>Registrada por</span><span>{compra.emisor?.nombre || compra.emisor?.username || 'Sistema'}</span></div>
        </article>
      </section>

      <section className="detalle-compra-card">
        <div className="detalle-compra-section-head">
          <div>
            <h2>Detalle de compra</h2>
            <p>{detalles.length} linea{detalles.length === 1 ? '' : 's'} registradas</p>
          </div>
        </div>

        <div className="detalle-compra-table-wrap">
          <table className="detalle-compra-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Auxiliar</th>
                <th>Descripcion</th>
                <th className="text-right">Cant.</th>
                <th className="text-right">Costo</th>
                <th className="text-right">Desc.</th>
                <th>IVA</th>
                <th>Invent.</th>
                <th className="text-right">Subtotal</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {detalles.map((detalle, index) => (
                <tr key={`${detalle.codigoPrincipal || 'detalle'}-${index}`}>
                  <td>{detalle.codigoPrincipal || 'Sin codigo'}</td>
                  <td>{detalle.codigoAuxiliar || '—'}</td>
                  <td>{detalle.descripcion}</td>
                  <td className="text-right">{fmtNumero(detalle.cantidad, 3)}</td>
                  <td className="text-right">{fmtMoneda(detalle.precioUnitario)}</td>
                  <td className="text-right">{fmtMoneda(detalle.descuento)}</td>
                  <td><span className="detalle-compra-mini-badge">{Number(detalle.porcentajeIva || 0)}%</span></td>
                  <td>{detalle.inventariable ? 'Si' : 'No'}</td>
                  <td className="text-right">{fmtMoneda(detalle.subtotal)}</td>
                  <td className="text-right"><strong>{fmtMoneda(detalle.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="detalle-compra-bottom">
        <article className="detalle-compra-card">
          <h2>Totales</h2>
          <div className="detalle-compra-row"><span>Subtotal 0%</span><strong>{fmtMoneda(subtotalTarifa0)}</strong></div>
          {subtotalTarifa5 > 0 && (
            <div className="detalle-compra-row"><span>Subtotal 5%</span><strong>{fmtMoneda(subtotalTarifa5)}</strong></div>
          )}
          <div className="detalle-compra-row"><span>Subtotal 15%</span><strong>{fmtMoneda(subtotalTarifa15)}</strong></div>
          <div className="detalle-compra-row"><span>Descuento</span><strong>{fmtMoneda(compra.totalDescuento)}</strong></div>
          <div className="detalle-compra-row"><span>IVA</span><strong>{fmtMoneda(compra.totalIva)}</strong></div>
          {totalRetenido > 0 && (
            <div className="detalle-compra-row"><span>Retenciones registradas</span><strong>{fmtMoneda(totalRetenido)}</strong></div>
          )}
          <div className="detalle-compra-row detalle-compra-total"><span>Total</span><strong>{fmtMoneda(compra.importeTotal)}</strong></div>
        </article>

        <article className="detalle-compra-card">
          <h2>Pagos y notas</h2>
          {pagos.length === 0 ? (
            <p className="detalle-compra-muted">No hay formas de pago registradas.</p>
          ) : (
            <div className="detalle-compra-stack">
              {pagos.map((pago, index) => (
                <div key={`${pago.formaPago || 'pago'}-${index}`} className="detalle-compra-payment">
                  <div>
                    <strong>{etiquetaFormaPago(pago.formaPago)}</strong>
                    {(pago.plazo || pago.unidadTiempo) && (
                      <p>Plazo: {pago.plazo || 0} {pago.unidadTiempo || ''}</p>
                    )}
                  </div>
                  <strong>{fmtMoneda(pago.total)}</strong>
                </div>
              ))}
            </div>
          )}

          {compra.observaciones ? (
            <div className="detalle-compra-note">
              <span>Observaciones</span>
              <p>{compra.observaciones}</p>
            </div>
          ) : (
            <p className="detalle-compra-muted">Sin observaciones registradas.</p>
          )}
        </article>
      </section>

      <section className="detalle-compra-card">
        <div className="detalle-compra-section-head">
          <div>
            <h2>Retenciones vinculadas</h2>
            <p>
              {retenciones.length > 0
                ? `${retenciones.length} retención${retenciones.length === 1 ? '' : 'es'} registradas para esta compra`
                : 'Todavía no hay retenciones vinculadas a esta compra'}
            </p>
          </div>
          <div className="detalle-compra-actions">
            {retencionesDisponibles && !compra.anulada && (
              <button className="btn-secondary" onClick={() => navigate(`/retenciones/nueva?compraId=${compra.id}`)}>
                Nueva retención
              </button>
            )}
            {retenciones.length > 0 && (
              <button className="btn-secondary" onClick={() => navigate('/retenciones')}>
                Ir a retenciones
              </button>
            )}
          </div>
        </div>

        {retenciones.length === 0 ? (
          <p className="detalle-compra-muted">
            Cuando emitas una retención desde esta compra, aparecerá aquí con su número, estado y valor retenido.
          </p>
        ) : (
          <div className="detalle-compra-ret-list">
            {retenciones.map((retencion) => (
              <div key={retencion.id} className="detalle-compra-ret-item">
                <div>
                  <strong>{retencion.numeroRetencion}</strong>
                  <p>
                    {fmtFecha(retencion.fechaEmision)} · {fmtMoneda(retencion.totalRetenido)}
                    {retencion.numeroAutorizacion ? ` · Autorización ${retencion.numeroAutorizacion}` : ''}
                  </p>
                </div>
                <span className={`detalle-compra-mini-badge detalle-compra-ret-status estado-${String(retencion.estadoSri || '').toLowerCase()}`}>
                  {retencion.estadoSri}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
