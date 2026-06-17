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
          clienteId:          proforma.clienteid || proforma.clienteId,
          detalles:           proforma.detalles,
          observaciones:      proforma.observaciones,
        },
      },
    });
  };

  const imprimir = () => window.print();

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
          {/* Imprimir */}
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

        {/* Observaciones */}
        {proforma.observaciones && (
          <div className="prf-det-obs">
            <p className="prf-det-obs-label">Observaciones / Condiciones</p>
            <p className="prf-det-obs-txt">{proforma.observaciones}</p>
          </div>
        )}

        {/* Pie del documento */}
        <div className="prf-det-footer-doc">
          <p>Este documento es una cotización / presupuesto y no tiene validez tributaria. Para emitir un comprobante válido, convierta esta proforma a Factura.</p>
        </div>
      </div>
    </div>
  );
}
