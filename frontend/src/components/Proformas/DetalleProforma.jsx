// ====================================
// COMPONENTE: DETALLE DE PROFORMA
// frontend/src/components/Proformas/DetalleProforma.jsx
// ====================================

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/useAuth';
import { tienePermiso } from '../../utils/roles';
import './DetalleProforma.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ESTADOS_CFG = {
  BORRADOR:   { label: 'Borrador',    color: '#64748b', bg: '#f1f5f9', icon: '📝' },
  ENVIADA:    { label: 'Enviada',     color: '#2563eb', bg: '#dbeafe', icon: '📤' },
  ACEPTADA:   { label: 'Aceptada',    color: '#16a34a', bg: '#dcfce7', icon: '✅' },
  RECHAZADA:  { label: 'Rechazada',   color: '#dc2626', bg: '#fee2e2', icon: '❌' },
  CONVERTIDA: { label: 'Convertida',  color: '#7c3aed', bg: '#ede9fe', icon: '🧾' },
  ANULADA:    { label: 'Anulada',     color: '#374151', bg: '#e5e7eb', icon: '🚫' },
};

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtMonto(v) { return `$${parseFloat(v || 0).toFixed(2)}`; }

function ivaLabel(pct) {
  if (pct === 6) return 'No Obj.';
  if (pct === 7) return 'Exento';
  return `${pct}%`;
}

export default function DetalleProforma() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const { usuario }  = useAuth();
  const [proforma, setProforma] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [modalEmail, setModalEmail] = useState(false);
  const [emailDestino, setEmailDestino] = useState('');
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [descargandoPdf, setDescargandoPdf] = useState(false);
  const [modalWA, setModalWA] = useState(false);
  const [waMensaje, setWaMensaje] = useState('');

  const puedeConvertir = tienePermiso(usuario?.rol, 'proformas.convertir');
  const puedeAnular    = tienePermiso(usuario?.rol, 'proformas.anular');
  const puedeEditar    = tienePermiso(usuario?.rol, 'proformas.gestionar');

  useEffect(() => { cargar(); }, [id]);

  const cargar = async () => {
    try {
      const res = await api.get(`/proformas/${id}`);
      const p   = res.data.data;
      // Normalizar campos (PostgreSQL devuelve lowercase en raw queries)
      setProforma({
        ...p,
        tipoIdentificacion: p.tipoidentificacion || p.tipoIdentificacion,
        razonSocial:        p.razonsocial        || p.razonSocial,
        importeTotal:       p.importetotal       || p.importeTotal,
        totalDescuento:     p.totaldescuento     || p.totalDescuento,
        totalIva:           p.totaliva           || p.totalIva,
        subtotal0:          p.subtotal0,
        subtotal5:          p.subtotal5,
        subtotal15:         p.subtotal15,
        vigenciaDesde:      p.vigenciadesde      || p.vigenciaDesde,
        vigenciaHasta:      p.vigenciahasta      || p.vigenciaHasta,
        facturaId:          p.facturaid          || p.facturaId,
        formaPago:          p.formapago          || p.formaPago || null,
        detalles:           typeof p.detalles === 'string' ? JSON.parse(p.detalles) : (p.detalles || []),
      });
    } catch {
      toast.error('Error al cargar proforma');
      navigate('/proformas');
    } finally {
      setCargando(false);
    }
  };

  const cambiarEstado = async (nuevoEstado) => {
    if (!window.confirm(`¿Cambiar estado a "${ESTADOS_CFG[nuevoEstado]?.label}"?`)) return;
    setProcesando(true);
    try {
      await api.post(`/proformas/${id}/estado`, { nuevoEstado });
      toast.success(`Proforma marcada como ${ESTADOS_CFG[nuevoEstado]?.label}`);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al cambiar estado');
    } finally {
      setProcesando(false);
    }
  };

  const anular = async () => {
    if (!window.confirm('¿Anular esta proforma? Esta acción no se puede deshacer.')) return;
    setProcesando(true);
    try {
      await api.post(`/proformas/${id}/anular`);
      toast.success('Proforma anulada');
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al anular');
    } finally {
      setProcesando(false);
    }
  };

  const convertirAFactura = () => {
    // Navegamos a Nueva Factura pasando los datos de la proforma como state
    navigate('/facturas/nueva', {
      state: {
        proforma: {
          id:                 proforma.id,
          tipoIdentificacion: proforma.tipoIdentificacion,
          identificacion:     proforma.identificacion,
          razonSocial:        proforma.razonSocial,
          direccion:          proforma.direccion,
          email:              proforma.email,
          telefono:           proforma.telefono,
          numero:             proforma.numero,
          clienteId:          proforma.clienteid || proforma.clienteId,
          detalles:           proforma.detalles,
          observaciones:      proforma.observaciones,
        },
      },
    });
  };

  const imprimir = () => window.print();

  const descargarPdf = async () => {
    setDescargandoPdf(true);
    try {
      const res = await api.get(`/proformas/${id}/pdf`, { responseType: 'blob' });
      const url  = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href     = url;
      link.download = `${proforma.numero?.replace(/\//g, '-') || 'proforma'}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Error al generar el PDF. Intenta de nuevo.');
    } finally {
      setDescargandoPdf(false);
    }
  };

  const abrirModalEmail = () => {
    setEmailDestino(proforma.email || '');
    setModalEmail(true);
  };

  const enviarEmail = async () => {
    if (!emailDestino.trim()) return toast.error('Ingresa un correo electrónico');
    setEnviandoEmail(true);
    try {
      const res = await api.post(`/proformas/${id}/enviar-email`, { emailDestino: emailDestino.trim() });
      toast.success(res.data?.mensaje || `Proforma enviada a ${emailDestino.trim()}`);
      setModalEmail(false);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al enviar email');
    } finally {
      setEnviandoEmail(false);
    }
  };

  const abrirModalWhatsApp = () => {
    const detalles = proforma.detalles || [];

    const lineas = detalles.map(d => {
      const cant  = parseFloat(d.cantidad || 1);
      const prec  = parseFloat(d.precioUnitario || 0);
      const desc  = parseFloat(d.descuento || 0);
      const tot   = (cant * prec - desc).toFixed(2);
      const iva   = d.ivaPorcentaje ? ` | IVA ${d.ivaPorcentaje}%` : '';
      return `  • ${d.descripcion}${d.codigo ? ` (${d.codigo})` : ''}\n    Cant: ${cant} × $${prec.toFixed(2)}${iva} = *$${tot}*`;
    }).join('\n');

    const st0   = parseFloat(proforma.subtotal0  || 0);
    const st5   = parseFloat(proforma.subtotal5  || 0);
    const st15  = parseFloat(proforma.subtotal15 || 0);
    const iva   = parseFloat(proforma.totalIva   || 0);
    const desc  = parseFloat(proforma.totalDescuento || 0);
    const total = parseFloat(proforma.importeTotal || 0);

    const resumenLineas = [
      st0  > 0 ? `  Subtotal 0%:   $${st0.toFixed(2)}`  : '',
      st5  > 0 ? `  Subtotal 5%:   $${st5.toFixed(2)}`  : '',
      st15 > 0 ? `  Subtotal 15%:  $${st15.toFixed(2)}` : '',
      desc > 0 ? `  Descuento:    -$${desc.toFixed(2)}`  : '',
      `  IVA:           $${iva.toFixed(2)}`,
    ].filter(Boolean).join('\n');

    const emisor   = proforma.razonsocial_emisor || proforma.razonSocial_emisor || '';
    const saludo   = `Estimado/a *${proforma.razonSocial || 'cliente'}*,`;
    const intro    = emisor
      ? `Le saluda *${emisor}*. Le compartimos la siguiente proforma para su revisión:`
      : 'Le compartimos la siguiente proforma para su revisión:';

    const cabecera = [
      `📋 *PROFORMA N° ${proforma.numero}*`,
      `📅 Fecha: ${fmtFecha(proforma.createdAt || proforma.createdat)}`,
      proforma.vigenciaHasta ? `⏳ Válida hasta: *${fmtFecha(proforma.vigenciaHasta)}*` : '',
    ].filter(Boolean).join('\n');

    const clienteLinea = proforma.tipoIdentificacion !== '07' && proforma.identificacion
      ? `🪪 RUC/CI: ${proforma.identificacion}`
      : '';

    const texto = [
      saludo,
      '',
      intro,
      '',
      cabecera,
      clienteLinea,
      '',
      `📦 *DETALLE:*`,
      lineas,
      '',
      `💰 *RESUMEN:*`,
      resumenLineas,
      `  ──────────────────`,
      `  *TOTAL:   $${total.toFixed(2)}*`,
      '',
      proforma.formaPago ? `💳 Forma de pago: ${proforma.formaPago}` : '',
      proforma.observaciones ? `📝 ${proforma.observaciones}` : '',
      '',
      `📎 *Adjunto a este mensaje encontrará el archivo PDF* de la proforma. Por favor descárguelo para revisarlo.`,
      '',
      `Quedamos atentos a su confirmación. ¡Gracias por su preferencia!`,
      emisor ? `\n_${emisor}_` : '',
      `_Este documento es una cotización y no tiene validez tributaria._`,
    ].filter(s => s !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();

    setWaMensaje(texto);
    setModalWA(true);
  };

  const abrirWhatsApp = () => {
    const telefono = (proforma.telefono || '').replace(/\D/g, '');
    const url = telefono
      ? `https://wa.me/593${telefono.replace(/^0/, '')}?text=${encodeURIComponent(waMensaje)}`
      : `https://wa.me/?text=${encodeURIComponent(waMensaje)}`;
    window.open(url, '_blank');
  };

  const copiarMensajeWA = () => {
    navigator.clipboard.writeText(waMensaje)
      .then(() => toast.success('Mensaje copiado al portapapeles'))
      .catch(() => toast.error('No se pudo copiar'));
  };

  if (cargando) return <div className="prf-det-loading">Cargando proforma...</div>;
  if (!proforma) return null;

  const cfg     = ESTADOS_CFG[proforma.estado] || ESTADOS_CFG.BORRADOR;
  const detalles = proforma.detalles || [];

  return (
    <div className="prf-det-container">
      {/* ── Header ── */}
      <div className="prf-det-header">
        <div>
          <button className="prf-det-back" onClick={() => navigate('/proformas')}>← Proformas</button>
          <h1>{proforma.numero}</h1>
          <span className="prf-det-badge" style={{ color: cfg.color, background: cfg.bg }}>
            {cfg.icon} {cfg.label}
          </span>
        </div>
        <div className="prf-det-header-actions">
          {/* Editar — solo BORRADOR o ENVIADA */}
          {puedeEditar && ['BORRADOR', 'ENVIADA'].includes(proforma.estado) && (
            <button className="btn-secondary" onClick={() => navigate(`/proformas/${id}/editar`)}>
              ✏️ Editar
            </button>
          )}
          {/* Cambiar estado */}
          {proforma.estado === 'BORRADOR' && puedeEditar && (
            <button className="btn-secondary" disabled={procesando} onClick={() => cambiarEstado('ENVIADA')}>
              📤 Marcar como Enviada
            </button>
          )}
          {proforma.estado === 'ENVIADA' && puedeEditar && (
            <>
              <button className="btn-secondary" disabled={procesando} onClick={() => cambiarEstado('ACEPTADA')}>
                ✅ Aceptada
              </button>
              <button className="btn-secondary prf-btn-rechazar" disabled={procesando} onClick={() => cambiarEstado('RECHAZADA')}>
                ❌ Rechazada
              </button>
            </>
          )}
          {/* Convertir a Factura */}
          {puedeConvertir && ['BORRADOR', 'ENVIADA', 'ACEPTADA'].includes(proforma.estado) && (
            <button className="btn-primary" disabled={procesando} onClick={convertirAFactura}>
              🧾 Convertir a Factura
            </button>
          )}
          {/* Ver factura generada */}
          {proforma.estado === 'CONVERTIDA' && proforma.facturaId && (
            <button className="btn-primary" onClick={() => navigate(`/facturas/${proforma.facturaId}`)}>
              🧾 Ver Factura
            </button>
          )}
          {/* Compartir */}
          <button className="btn-secondary" onClick={abrirModalWhatsApp} title="Compartir por WhatsApp">
            💬 WhatsApp
          </button>
          <button className="btn-secondary" onClick={abrirModalEmail} title="Enviar por Email (con PDF adjunto)">
            📧 Email
          </button>
          {/* PDF y Print */}
          <button className="btn-secondary" onClick={descargarPdf} disabled={descargandoPdf} title="Descargar PDF">
            {descargandoPdf ? '⏳ Generando...' : '⬇️ PDF'}
          </button>
          <button className="btn-secondary prf-btn-print" onClick={imprimir}>🖨️ Imprimir</button>
          {/* Anular */}
          {puedeAnular && !['CONVERTIDA', 'ANULADA'].includes(proforma.estado) && (
            <button className="btn-secondary prf-btn-anular" disabled={procesando} onClick={anular}>
              🚫 Anular
            </button>
          )}
        </div>
      </div>

      {/* ── Layout imprimible ── */}
      <div className="prf-det-doc">

        {/* Cabecera del documento */}
        <div className="prf-det-doc-head">
          <div className="prf-det-empresa">
            <h2>{proforma.razonsocial_emisor || 'AELA ERP'}</h2>
          </div>
          <div className="prf-det-doc-info">
            <h3>PROFORMA</h3>
            <table className="prf-det-meta-tbl">
              <tbody>
                <tr><td>Número</td>  <td><strong>{proforma.numero}</strong></td></tr>
                <tr><td>Fecha</td>   <td>{fmtFecha(proforma.createdat || proforma.createdAt)}</td></tr>
                {proforma.vigenciaDesde && <tr><td>Válida desde</td><td>{fmtFecha(proforma.vigenciaDesde)}</td></tr>}
                {proforma.vigenciaHasta && <tr><td>Válida hasta</td><td><strong>{fmtFecha(proforma.vigenciaHasta)}</strong></td></tr>}
                <tr>
                  <td>Estado</td>
                  <td><span className="prf-det-badge-sm" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Datos del cliente */}
        <div className="prf-det-cliente-box">
          <p className="prf-det-cliente-label">CLIENTE</p>
          <p className="prf-det-cliente-nombre">{proforma.razonSocial}</p>
          {proforma.identificacion && proforma.tipoIdentificacion !== '07' && (
            <p className="prf-det-cliente-id">{proforma.identificacion}</p>
          )}
          {proforma.direccion && <p className="prf-det-cliente-dir">{proforma.direccion}</p>}
          {proforma.email     && <p className="prf-det-cliente-email">{proforma.email}</p>}
          {proforma.telefono  && <p className="prf-det-cliente-tel">{proforma.telefono}</p>}
        </div>

        {/* Tabla de detalles */}
        <table className="prf-det-items">
          <thead>
            <tr>
              <th>#</th>
              <th>Código</th>
              <th>Descripción</th>
              <th>Cant.</th>
              <th>P. Unit.</th>
              <th>Desc.</th>
              <th>IVA</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {detalles.map((d, i) => {
              const cant   = parseFloat(d.cantidad)       || 0;
              const precio = parseFloat(d.precioUnitario) || 0;
              const desc   = parseFloat(d.descuento)      || 0;
              const iva    = parseInt(d.ivaPorcentaje)    || 0;
              const sub    = cant * precio - desc;
              const ivaAmt = iva === 15 ? sub * 0.15 : iva === 5 ? sub * 0.05 : 0;
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{d.codigoPrincipal || '—'}</td>
                  <td>{d.descripcion}</td>
                  <td className="prf-det-num">{cant}</td>
                  <td className="prf-det-num">{fmtMonto(precio)}</td>
                  <td className="prf-det-num">{desc > 0 ? fmtMonto(desc) : '—'}</td>
                  <td className="prf-det-num">{ivaLabel(iva)}</td>
                  <td className="prf-det-num prf-det-total">{fmtMonto(sub + ivaAmt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totales */}
        <div className="prf-det-totales">
          <div className="prf-det-totales-grid">
            {parseFloat(proforma.subtotal0  || 0) > 0 && <><span>Subtotal 0%</span>  <span>{fmtMonto(proforma.subtotal0)}</span></>}
            {parseFloat(proforma.subtotal5  || 0) > 0 && <><span>Subtotal 5%</span>  <span>{fmtMonto(proforma.subtotal5)}</span></>}
            {parseFloat(proforma.subtotal15 || 0) > 0 && <><span>Subtotal 15%</span> <span>{fmtMonto(proforma.subtotal15)}</span></>}
            {parseFloat(proforma.totalDescuento || 0) > 0 && (
              <><span>Descuento</span><span className="prf-det-desc">-{fmtMonto(proforma.totalDescuento)}</span></>
            )}
            {parseFloat(proforma.totalIva || 0) > 0 && <><span>IVA</span> <span>{fmtMonto(proforma.totalIva)}</span></>}
            <span className="prf-det-tot-label">TOTAL</span>
            <span className="prf-det-tot-valor">{fmtMonto(proforma.importeTotal)}</span>
          </div>
        </div>

        {/* Forma de pago */}
        {proforma.formaPago && (
          <div className="prf-det-obs" style={{ background: '#f5f3ff', borderLeft: '3px solid #7c3aed' }}>
            <p className="prf-det-obs-label">Forma de pago</p>
            <p className="prf-det-obs-txt" style={{ fontWeight: 600 }}>{proforma.formaPago}</p>
          </div>
        )}

        {/* Observaciones */}
        {proforma.observaciones && (
          <div className="prf-det-obs">
            <p className="prf-det-obs-label">Observaciones / Condiciones</p>
            <p className="prf-det-obs-txt">{proforma.observaciones}</p>
          </div>
        )}

        {/* Pie del documento */}
        <div className="prf-det-footer-doc prf-det-footer-disc">
          <p>Este documento es una cotización / presupuesto y no tiene validez tributaria. Para emitir un comprobante válido, convierta esta proforma a Factura.</p>
        </div>
      </div>

      {/* ── Modal WhatsApp ── */}
      {modalWA && (
        <div className="modal-overlay" onClick={() => setModalWA(false)}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: '#1e293b' }}>💬 Compartir por WhatsApp</h3>
            <p style={{ margin: '0 0 14px', fontSize: '.83rem', color: '#64748b' }}>
              Descarga el PDF primero, luego abre WhatsApp y adjunta el archivo manualmente junto con este mensaje.
            </p>

            {/* Vista previa del mensaje */}
            <label style={{ fontSize: '.8rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Vista previa del mensaje:
            </label>
            <textarea
              value={waMensaje}
              onChange={e => setWaMensaje(e.target.value)}
              rows={14}
              style={{
                width: '100%', fontFamily: 'monospace', fontSize: '.78rem',
                border: '1px solid #d1d5db', borderRadius: 8, padding: '10px 12px',
                resize: 'vertical', background: '#f9fafb', color: '#1e293b',
                boxSizing: 'border-box', marginBottom: 14,
              }}
            />

            {/* Acciones */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={() => setModalWA(false)} style={{ flex: 'none' }}>
                Cancelar
              </button>
              <button className="btn-secondary" onClick={copiarMensajeWA} style={{ flex: 'none' }}>
                📋 Copiar mensaje
              </button>
              <button
                className="btn-secondary"
                onClick={descargarPdf}
                disabled={descargandoPdf}
                style={{ flex: 'none' }}
              >
                {descargandoPdf ? '⏳ Generando...' : '⬇️ Descargar PDF'}
              </button>
              <button
                className="btn-primary"
                onClick={abrirWhatsApp}
                style={{ flex: 1, minWidth: 140, background: '#25d366', borderColor: '#25d366' }}
              >
                💬 Abrir WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal envío por Email ── */}
      {modalEmail && (
        <div className="modal-overlay" onClick={() => setModalEmail(false)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>📧 Enviar proforma por email</h3>
              <button className="btn-close" onClick={() => setModalEmail(false)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Se enviará la proforma <strong>{proforma.numero}</strong> al correo indicado.
            </p>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Correo electrónico *
            </label>
            <input
              type="email"
              value={emailDestino}
              onChange={e => setEmailDestino(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && enviarEmail()}
              placeholder="cliente@empresa.com"
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #c8d8ef', fontSize: 14, boxSizing: 'border-box', marginBottom: 20 }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setModalEmail(false)}>Cancelar</button>
              <button className="btn-primary" onClick={enviarEmail} disabled={enviandoEmail}>
                {enviandoEmail ? 'Enviando...' : '📧 Enviar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
