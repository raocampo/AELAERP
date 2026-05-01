// ====================================
// FORMULARIO NOTA DE VENTA — AELA
// Para RIMPE Negocio Popular
// frontend/src/components/NotasVenta/FormNotaVenta.jsx
// ====================================

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './FormNotaVenta.css';

const TIPOS_ID = [
  { valor: '05', label: 'Cédula (05)' },
  { valor: '04', label: 'RUC (04)' },
  { valor: '06', label: 'Pasaporte (06)' },
  { valor: '07', label: 'Consumidor Final (07)' },
];

const FORMAS_PAGO = [
  { uid: 'Efectivo',       label: 'Efectivo', icon: '💵' },
  { uid: 'Transferencia',  label: 'Transferencia', icon: '🏦' },
  { uid: 'Tarjeta débito', label: 'Tarjeta débito', icon: '💳' },
  { uid: 'Tarjeta crédito',label: 'Tarjeta crédito', icon: '💳' },
  { uid: 'Cheque',         label: 'Cheque', icon: '🧾' },
  { uid: 'App Móvil',      label: 'Aplicación Móvil', icon: '📱' },
];

const DETALLE_VACIO = {
  descripcion: '', cantidad: '1', precioUnitario: '', descuento: '0',
};

export default function FormNotaVenta() {
  const navigate = useNavigate();

  // ── Cliente ──────────────────────────────────────────────────────────────
  const [tipoId,       setTipoId]       = useState('07');
  const [identificacion, setIdentificacion] = useState('9999999999999');
  const [razonSocial,  setRazonSocial]  = useState('CONSUMIDOR FINAL');
  const [direccion,    setDireccion]    = useState('');
  const [email,        setEmail]        = useState('');
  const [clienteId,    setClienteId]    = useState(null);
  const [buscandoSRI,  setBuscandoSRI]  = useState(false);
  const [mensajeSRI,   setMensajeSRI]   = useState('');

  // ── Detalle ──────────────────────────────────────────────────────────────
  const [detalles, setDetalles] = useState([{ ...DETALLE_VACIO }]);

  // ── Otros ────────────────────────────────────────────────────────────────
  const [formaPago,    setFormaPago]    = useState('Efectivo');
  const [numeroCheque, setNumeroCheque] = useState('');
  const [bancoEmisor,  setBancoEmisor]  = useState('');
  const [appNombre,    setAppNombre]    = useState('Ahorita');
  const [appOtra,      setAppOtra]      = useState('');
  const [codigoTransaccion, setCodTx]  = useState('');
  const [fechaEmision, setFecha]        = useState(format(new Date(), 'yyyy-MM-dd'));
  const [observaciones, setObs]         = useState('');
  const [submitting,   setSubmitting]   = useState(false);

  // ── Calcular totales ──────────────────────────────────────────────────────
  const calcTotales = () => {
    let subtotal = 0, totalDesc = 0;
    detalles.forEach(d => {
      const cant  = parseFloat(d.cantidad)       || 0;
      const precio = parseFloat(d.precioUnitario) || 0;
      const desc   = parseFloat(d.descuento)      || 0;
      subtotal  += cant * precio;
      totalDesc += desc;
    });
    return {
      subtotal:       parseFloat(subtotal.toFixed(2)),
      totalDescuento: parseFloat(totalDesc.toFixed(2)),
      total:          parseFloat((subtotal - totalDesc).toFixed(2)),
    };
  };
  const totales = calcTotales();

  // ── Consumidor Final ──────────────────────────────────────────────────────
  useEffect(() => {
    if (tipoId === '07') {
      setIdentificacion('9999999999999');
      setRazonSocial('CONSUMIDOR FINAL');
      setClienteId(null);
      setMensajeSRI('');
    } else if (identificacion === '9999999999999') {
      setIdentificacion('');
      setRazonSocial('');
    }
  }, [identificacion, tipoId]);

  // ── Consulta SRI ──────────────────────────────────────────────────────────
  const consultarSRI = async (id) => {
    const limpio = id.trim();
    const ok = /^\d{10}$/.test(limpio) || /^\d{13}$/.test(limpio);
    if (!ok || tipoId === '07') return;
    setBuscandoSRI(true);
    setMensajeSRI('');
    try {
      const res = await api.get(`/clientes/sri/${limpio}`);
      if (res.data.success && res.data.data) {
        const c = res.data.data;
        setClienteId(c.id || null);
        if (c.razonSocial) setRazonSocial(c.razonSocial);
        if (c.direccion) setDireccion(c.direccion);
        if (!email) setEmail(c.email || '');
        if (res.data.requiereDatosManuales) {
          setMensajeSRI(res.data.mensaje || 'Identificación válida en SRI, completa los datos manualmente');
        } else {
          const fuente = res.data.fuente === 'sri'
            ? 'Encontrado en SRI'
            : res.data.fuente === 'empresa-local'
              ? 'Datos locales del sistema'
              : 'BD local';
          setMensajeSRI(`✓ ${fuente}: ${c.razonSocial || limpio}`);
        }
      } else if (res.data.servicioNoDisponible) {
        setMensajeSRI(res.data.mensaje || 'No fue posible consultar el SRI en este momento');
      } else if (res.data.encontrado === false) {
        setMensajeSRI(res.data.mensaje || 'No encontrado — ingresa los datos manualmente');
      } else {
        setMensajeSRI('No encontrado — ingresa los datos manualmente');
      }
    } catch {
      setMensajeSRI('Error al consultar SRI');
    } finally {
      setBuscandoSRI(false);
    }
  };

  // ── Detalle CRUD ──────────────────────────────────────────────────────────
  const actualizarDetalle = (idx, campo, valor) =>
    setDetalles(prev => prev.map((d, i) => i === idx ? { ...d, [campo]: valor } : d));

  const agregarLinea = () => setDetalles(prev => [...prev, { ...DETALLE_VACIO }]);

  const eliminarLinea = (idx) => {
    if (detalles.length === 1) return;
    setDetalles(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!identificacion || !razonSocial) return toast.error('Faltan datos del cliente');
    if (detalles.some(d => !d.descripcion || !d.precioUnitario)) {
      return toast.error('Completa descripción y precio en todos los ítems');
    }
    if (totales.total <= 0) return toast.error('El total debe ser mayor a 0');

    setSubmitting(true);
    try {
      await api.post('/notas-venta', {
        tipoIdentificacion: tipoId,
        identificacion,
        razonSocial,
        direccion:    direccion    || undefined,
        email:        email        || undefined,
        clienteId:    clienteId    || undefined,
        detalles:     detalles.map(d => ({
          descripcion:     d.descripcion,
          cantidad:        parseFloat(d.cantidad)       || 1,
          precioUnitario:  parseFloat(d.precioUnitario) || 0,
          descuento:       parseFloat(d.descuento)      || 0,
        })),
        formaPago,
        formaPagoDetalles: formaPago === 'Cheque'
          ? { numeroCheque, bancoEmisor }
          : formaPago === 'App Móvil'
            ? { appNombre: appNombre === 'Otra' ? appOtra : appNombre, codigoTransaccion }
            : undefined,
        fechaEmision,
        observaciones: observaciones || undefined,
      });
      toast.success('Nota de venta emitida');
      navigate('/notas-venta');
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al crear nota de venta');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fnv-container">
      <div className="fnv-header">
        <div>
          <h1>🗒️ Nueva Nota de Venta</h1>
          <p>Documento para RIMPE Negocio Popular — autorizado SRI</p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate('/notas-venta')}>← Volver</button>
      </div>

      <form onSubmit={handleSubmit}>

        {/* ── Datos cliente ── */}
        <div className="fnv-section">
          <h2>👤 Datos del Destinatario</h2>
          <div className="fnv-grid-2">
            <div className="fnv-field">
              <label>Tipo de identificación *</label>
              <select value={tipoId} onChange={e => { setTipoId(e.target.value); setMensajeSRI(''); setClienteId(null); }}>
                {TIPOS_ID.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>

            <div className="fnv-field">
              <label>N° de identificación *</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ flex: 1 }} value={identificacion}
                  onChange={e => { setIdentificacion(e.target.value); setClienteId(null); setMensajeSRI(''); }}
                  onBlur={e => { if (!buscandoSRI) consultarSRI(e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); consultarSRI(identificacion); } }}
                  placeholder={tipoId === '07' ? '9999999999999' : tipoId === '04' ? 'RUC (13 dígitos)' : 'Cédula (10 dígitos)'}
                  readOnly={tipoId === '07'} required />
                {tipoId !== '07' && (
                  <button type="button" className="btn btn-secondary"
                    style={{ padding: '0 12px', fontSize: 13 }}
                    onClick={() => consultarSRI(identificacion)} disabled={buscandoSRI}>
                    {buscandoSRI ? '…' : '🔍 SRI'}
                  </button>
                )}
              </div>
              {buscandoSRI && <small className="fnv-sri-ok">Consultando SRI...</small>}
              {mensajeSRI && !buscandoSRI && (
                <small className={mensajeSRI.startsWith('✓') ? 'fnv-sri-ok' : 'fnv-sri-warn'}>{mensajeSRI}</small>
              )}
            </div>

            <div className="fnv-field full">
              <label>Nombres / Razón Social *</label>
              <input value={razonSocial} onChange={e => setRazonSocial(e.target.value)}
                readOnly={tipoId === '07'} required />
            </div>
            <div className="fnv-field">
              <label>Dirección</label>
              <input value={direccion} onChange={e => setDireccion(e.target.value)}
                placeholder="Calle, número, ciudad" />
            </div>
            <div className="fnv-field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com" />
            </div>
          </div>
        </div>

        {/* ── Detalle ── */}
        <div className="fnv-section">
          <h2>📋 Detalle</h2>
          <div className="fnv-table-wrap">
            <table className="fnv-table">
              <thead>
                <tr>
                  <th>Descripción *</th>
                  <th className="center" style={{ width: 80 }}>Cant.</th>
                  <th className="right" style={{ width: 100 }}>P. Unit.</th>
                  <th className="right" style={{ width: 90 }}>Desc.</th>
                  <th className="right" style={{ width: 90 }}>Total</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {detalles.map((d, idx) => {
                  const lineTotal = ((parseFloat(d.cantidad) || 0) * (parseFloat(d.precioUnitario) || 0)) - (parseFloat(d.descuento) || 0);
                  return (
                    <tr key={idx}>
                      <td>
                        <input type="text" value={d.descripcion} style={{ width: '100%' }}
                          onChange={e => actualizarDetalle(idx, 'descripcion', e.target.value)}
                          placeholder="Descripción del producto/servicio" required />
                      </td>
                      <td>
                        <input type="number" value={d.cantidad} min="0.01" step="0.01"
                          onChange={e => actualizarDetalle(idx, 'cantidad', e.target.value)}
                          style={{ width: 68, textAlign: 'center' }} />
                      </td>
                      <td>
                        <input type="number" value={d.precioUnitario} min="0" step="0.01"
                          onChange={e => actualizarDetalle(idx, 'precioUnitario', e.target.value)}
                          style={{ width: 88, textAlign: 'right' }}
                          placeholder="0.00" required />
                      </td>
                      <td>
                        <input type="number" value={d.descuento} min="0" step="0.01"
                          onChange={e => actualizarDetalle(idx, 'descuento', e.target.value)}
                          style={{ width: 78, textAlign: 'right' }} />
                      </td>
                      <td className="fnv-cell-total">${lineTotal.toFixed(2)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button type="button" onClick={() => eliminarLinea(idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', fontSize: 18, lineHeight: 1 }}>
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 13 }} onClick={agregarLinea}>
            + Agregar línea
          </button>
        </div>

        {/* ── Opciones + Totales ── */}
        <div className="fnv-section">
          <div className="fnv-bottom-row">
            <div className="fnv-opciones">
              <div className="fnv-field">
                <label>Forma de pago</label>
                <select value={formaPago} onChange={e => setFormaPago(e.target.value)}>
                  {FORMAS_PAGO.map(f => <option key={f.uid} value={f.uid}>{f.icon} {f.label}</option>)}
                </select>
              </div>

              {/* Cheque fields */}
              {formaPago === 'Cheque' && (
                <div className="fnv-field">
                  <label>Número de cheque</label>
                  <input value={numeroCheque} onChange={e => setNumeroCheque(e.target.value)}
                    placeholder="Ej: 001234" />
                </div>
              )}
              {formaPago === 'Cheque' && (
                <div className="fnv-field">
                  <label>Banco emisor</label>
                  <input value={bancoEmisor} onChange={e => setBancoEmisor(e.target.value)}
                    placeholder="Ej: Banco Pichincha" />
                </div>
              )}

              {/* App fields */}
              {formaPago === 'App Móvil' && (
                <div className="fnv-field">
                  <label>Aplicación</label>
                  <select value={appNombre} onChange={e => setAppNombre(e.target.value)}>
                    <option value="Ahorita">Ahorita (Banco Loja)</option>
                    <option value="De Una">De Una (Banco Pichincha)</option>
                    <option value="Otra">Otra aplicación</option>
                  </select>
                </div>
              )}
              {formaPago === 'App Móvil' && appNombre === 'Otra' && (
                <div className="fnv-field">
                  <label>Nombre de la app</label>
                  <input value={appOtra} onChange={e => setAppOtra(e.target.value)}
                    placeholder="Nombre de la aplicación" />
                </div>
              )}
              {formaPago === 'App Móvil' && (
                <div className="fnv-field">
                  <label>Código de transacción</label>
                  <input value={codigoTransaccion} onChange={e => setCodTx(e.target.value)}
                    placeholder="Código de referencia" />
                </div>
              )}
              <div className="fnv-field">
                <label>Fecha de emisión</label>
                <input type="date" value={fechaEmision} onChange={e => setFecha(e.target.value)} />
              </div>
              <div className="fnv-field">
                <label>Observaciones</label>
                <textarea value={observaciones} onChange={e => setObs(e.target.value)}
                  rows={3} placeholder="Observaciones opcionales..." />
              </div>
            </div>

            <div className="fnv-totales-box">
              <div className="fnv-total-fila">
                <span>Subtotal:</span>
                <span>${totales.subtotal.toFixed(2)}</span>
              </div>
              {totales.totalDescuento > 0 && (
                <div className="fnv-total-fila">
                  <span>Descuento:</span>
                  <span style={{ color: '#dc2626' }}>-${totales.totalDescuento.toFixed(2)}</span>
                </div>
              )}
              <div className="fnv-total-fila fnv-total-principal">
                <span>TOTAL:</span>
                <span>${totales.total.toFixed(2)}</span>
              </div>
              <div className="fnv-nota-rimpe">(Nota de venta sin IVA — RIMPE)</div>
            </div>
          </div>
        </div>

        <div className="fnv-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/notas-venta')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Emitiendo...' : '✓ Emitir Nota de Venta'}
          </button>
        </div>

      </form>
    </div>
  );
}
