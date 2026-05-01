// ====================================
// FORMULARIO: NUEVA LIQUIDACIÓN DE COMPRA
// frontend/src/components/Facturacion/FormLiquidacion.jsx
// ====================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './FormLiquidacion.css';

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:5600'}/api`;

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FORMAS_PAGO = [
  { codigo: '01', label: 'Sin utilización del sistema financiero' },
  { codigo: '15', label: 'Compensación de deudas' },
  { codigo: '16', label: 'Tarjeta de débito' },
  { codigo: '17', label: 'Dinero electrónico' },
  { codigo: '18', label: 'Tarjeta prepago' },
  { codigo: '19', label: 'Tarjeta de crédito' },
  { codigo: '20', label: 'Otros con utilización del sistema financiero' },
  { codigo: '21', label: 'Endoso de títulos' },
];

const detalleVacio = () => ({
  descripcion: '',
  cantidad: '',
  precioUnitario: '',
  porcentajeIva: 15,
  descuento: '0',
});

const calcLinea = (det) => {
  const cant = parseFloat(det.cantidad)        || 0;
  const pu   = parseFloat(det.precioUnitario)  || 0;
  const desc = parseFloat(det.descuento)       || 0;
  const base = cant * pu - desc;
  const iva  = det.porcentajeIva === 15 ? base * 0.15 : 0;
  return { base: base < 0 ? 0 : base, iva, total: (base < 0 ? 0 : base) + iva };
};

export default function FormLiquidacion() {
  const navigate = useNavigate();
  const token   = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [guardado, setGuardado] = useState(null);

  // ── Datos proveedor + fechas ────────────────────────────────────────────────
  const [form, setForm] = useState({
    tipoIdentificacionProveedor: '02',
    identificacionProveedor: '',
    razonSocialProveedor: '',
    direccionProveedor: '',
    fechaEmision: hoy(),
    formaPago: '01',
    observaciones: '',
  });

  // ── Detalles (líneas de producto/servicio) ──────────────────────────────────
  const [detalles, setDetalles] = useState([detalleVacio()]);

  const handleForm  = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleDetalle = (idx, campo, valor) => {
    setDetalles(prev => prev.map((d, i) => i !== idx ? d : { ...d, [campo]: valor }));
  };

  const agregarLinea  = () => setDetalles(prev => [...prev, detalleVacio()]);
  const eliminarLinea = (idx) => setDetalles(prev => prev.filter((_, i) => i !== idx));

  // ── Totales calculados ──────────────────────────────────────────────────────
  const totales = detalles.reduce(
    (acc, d) => {
      const { base, iva } = calcLinea(d);
      if (d.porcentajeIva === 15) acc.sub15 += base;
      else acc.sub0 += base;
      acc.iva += iva;
      return acc;
    },
    { sub0: 0, sub15: 0, iva: 0 }
  );
  const totalDesc = detalles.reduce((s, d) => s + (parseFloat(d.descuento) || 0), 0);
  const importeTotal = totales.sub0 + totales.sub15 + totales.iva;

  // ── Guardar ─────────────────────────────────────────────────────────────────
  const guardar = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.identificacionProveedor.trim())
      return setError('Identificación del proveedor es requerida');
    if (!form.razonSocialProveedor.trim())
      return setError('Nombre/Razón social del proveedor es requerido');
    if (detalles.length === 0)
      return setError('Debe agregar al menos una línea de detalle');
    if (detalles.some(d => !d.descripcion.trim()))
      return setError('La descripción es requerida en todos los detalles');
    if (detalles.some(d => !(parseFloat(d.cantidad) > 0)))
      return setError('La cantidad debe ser mayor a 0 en todos los detalles');
    if (detalles.some(d => !(parseFloat(d.precioUnitario) > 0)))
      return setError('El precio unitario debe ser mayor a 0 en todos los detalles');

    setLoading(true);
    try {
      const payload = {
        tipoIdentificacionProveedor: form.tipoIdentificacionProveedor,
        identificacionProveedor: form.identificacionProveedor.trim(),
        razonSocialProveedor: form.razonSocialProveedor.trim(),
        direccionProveedor: form.direccionProveedor.trim() || undefined,
        fechaEmision: form.fechaEmision || undefined,
        observaciones: form.observaciones.trim() || undefined,
        detalles: detalles.map(d => ({
          descripcion:    d.descripcion.trim(),
          cantidad:       parseFloat(d.cantidad),
          precioUnitario: parseFloat(d.precioUnitario),
          porcentajeIva:  Number(d.porcentajeIva),
          descuento:      parseFloat(d.descuento) || 0,
        })),
        pagos: [{ formaPago: form.formaPago, total: importeTotal.toFixed(2) }],
      };

      const { data } = await axios.post(`${API}/liquidaciones`, payload, { headers });
      setGuardado(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al emitir la liquidación');
    } finally {
      setLoading(false);
    }
  };

  // ── Pantalla de éxito ───────────────────────────────────────────────────────
  if (guardado) {
    const descargarPDF = async () => {
      try {
        const resp = await axios.get(`${API}/liquidaciones/${guardado.id}/pdf`, {
          headers, responseType: 'blob',
        });
        const url  = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href  = url;
        link.setAttribute('download', `liquidacion-${guardado.numeroLiquidacion}.pdf`);
        document.body.appendChild(link); link.click(); link.remove();
      } catch (err) { alert('Error al descargar PDF: ' + err.message); }
    };

    return (
      <div className="lf-container">
        <div className="lf-exito">
          <div className="lf-exito-icono">✅</div>
          <h2>Liquidación Emitida</h2>
          <p className="lf-exito-num">Nro. {guardado.numeroLiquidacion}</p>
          <p>Proveedor: <strong>{guardado.razonSocialProveedor}</strong></p>
          <p>Total: <strong>${parseFloat(guardado.importeTotal).toFixed(2)}</strong></p>
          <div className={`lf-badge badge-${guardado.estadoSri === 'AUTORIZADO' ? 'success' : 'warning'} lf-badge-lg`}>
            {guardado.estadoSri}
          </div>
          <div className="lf-exito-acciones">
            <button className="btn-exito-lf-pdf"   onClick={descargarPDF}>Descargar RIDE PDF</button>
            <button className="btn-exito-lf-lista"  onClick={() => navigate('/liquidaciones')}>Ver Lista</button>
            <button className="btn-exito-lf-nueva"  onClick={() => setGuardado(null)}>Nueva Liquidación</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Formulario ──────────────────────────────────────────────────────────────
  return (
    <div className="lf-container">
      <div className="lf-header">
        <div className="lf-nav-actions">
          <button className="btn-back-lf" onClick={() => navigate('/liquidaciones')}>← Volver</button>
          <button className="btn-back-lf" onClick={() => navigate('/compras')}>Ir a Compras</button>
          <button className="btn-back-lf" onClick={() => navigate('/dashboard')}>Salir al Dashboard</button>
        </div>
        <h1>Nueva Liquidación de Compra</h1>
        <p>Comprobante electrónico tipo 03 — compras a personas naturales sin RUC</p>
      </div>

      {error && <div className="lf-error">{error}</div>}

      <form onSubmit={guardar} className="lf-form">

        {/* DATOS DEL PROVEEDOR */}
        <div className="lf-seccion">
          <h3 className="lf-seccion-titulo">Proveedor (Persona Natural)</h3>
          <div className="lf-grid-3">
            <div className="lf-campo">
              <label>Tipo Identificación <span className="req">*</span></label>
              <select name="tipoIdentificacionProveedor" value={form.tipoIdentificacionProveedor}
                onChange={handleForm} className="lf-input-form">
                <option value="02">02 — Cédula de Identidad</option>
                <option value="03">03 — Pasaporte</option>
              </select>
            </div>
            <div className="lf-campo">
              <label>Identificación <span className="req">*</span></label>
              <input type="text" name="identificacionProveedor" value={form.identificacionProveedor}
                onChange={handleForm} placeholder="Número de cédula o pasaporte"
                className="lf-input-form" maxLength={20} />
            </div>
            <div className="lf-campo lf-campo-wide">
              <label>Nombre Completo del Proveedor <span className="req">*</span></label>
              <input type="text" name="razonSocialProveedor" value={form.razonSocialProveedor}
                onChange={handleForm} placeholder="Nombre y apellido completo"
                className="lf-input-form" maxLength={300} />
            </div>
            <div className="lf-campo lf-campo-wide">
              <label>Dirección del Proveedor (opcional)</label>
              <input type="text" name="direccionProveedor" value={form.direccionProveedor}
                onChange={handleForm} placeholder="Dirección del proveedor"
                className="lf-input-form" maxLength={300} />
            </div>
            <div className="lf-campo">
              <label>Fecha de Emisión</label>
              <input type="date" name="fechaEmision" value={form.fechaEmision}
                onChange={handleForm} className="lf-input-form" />
            </div>
          </div>
        </div>

        {/* DETALLE DE BIENES / SERVICIOS */}
        <div className="lf-seccion">
          <div className="lf-seccion-header">
            <h3 className="lf-seccion-titulo">Detalle de Bienes o Servicios</h3>
            <button type="button" className="btn-add-lf" onClick={agregarLinea}>
              + Agregar Línea
            </button>
          </div>

          <div className="lf-tabla-wrap">
            <table className="lf-det-tabla">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th>Cantidad</th>
                  <th>P. Unitario</th>
                  <th>IVA %</th>
                  <th>Descuento</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detalles.map((det, idx) => {
                  const { total } = calcLinea(det);
                  return (
                    <tr key={idx}>
                      <td>
                        <input type="text" value={det.descripcion}
                          onChange={e => handleDetalle(idx, 'descripcion', e.target.value)}
                          className="lf-det-input lf-det-desc" placeholder="Descripción del bien/servicio" />
                      </td>
                      <td>
                        <input type="number" step="0.001" min="0" value={det.cantidad}
                          onChange={e => handleDetalle(idx, 'cantidad', e.target.value)}
                          className="lf-det-input lf-det-num" placeholder="0" />
                      </td>
                      <td>
                        <input type="number" step="0.01" min="0" value={det.precioUnitario}
                          onChange={e => handleDetalle(idx, 'precioUnitario', e.target.value)}
                          className="lf-det-input lf-det-num" placeholder="0.00" />
                      </td>
                      <td>
                        <select value={det.porcentajeIva}
                          onChange={e => handleDetalle(idx, 'porcentajeIva', Number(e.target.value))}
                          className="lf-det-input lf-det-iva">
                          <option value={0}>0%</option>
                          <option value={15}>15%</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" step="0.01" min="0" value={det.descuento}
                          onChange={e => handleDetalle(idx, 'descuento', e.target.value)}
                          className="lf-det-input lf-det-num" placeholder="0.00" />
                      </td>
                      <td className="lf-det-total">${total.toFixed(2)}</td>
                      <td>
                        {detalles.length > 1 && (
                          <button type="button" className="btn-del-lf" onClick={() => eliminarLinea(idx)}>✕</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Resumen de totales */}
          <div className="lf-totales">
            <div className="lf-totales-grid">
              <div className="lf-tot-row">
                <span>Subtotal 0%</span>
                <strong>${totales.sub0.toFixed(2)}</strong>
              </div>
              <div className="lf-tot-row">
                <span>Subtotal 15%</span>
                <strong>${totales.sub15.toFixed(2)}</strong>
              </div>
              {totalDesc > 0 && (
                <div className="lf-tot-row">
                  <span>Total Descuento</span>
                  <strong>-${totalDesc.toFixed(2)}</strong>
                </div>
              )}
              <div className="lf-tot-row">
                <span>IVA 15%</span>
                <strong>${totales.iva.toFixed(2)}</strong>
              </div>
              <div className="lf-tot-row lf-tot-final">
                <span>TOTAL</span>
                <strong>${importeTotal.toFixed(2)}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* PAGO Y OBSERVACIONES */}
        <div className="lf-seccion">
          <h3 className="lf-seccion-titulo">Pago y Observaciones</h3>
          <div className="lf-grid-2">
            <div className="lf-campo">
              <label>Forma de Pago <span className="req">*</span></label>
              <select name="formaPago" value={form.formaPago} onChange={handleForm} className="lf-input-form">
                {FORMAS_PAGO.map(fp => (
                  <option key={fp.codigo} value={fp.codigo}>{fp.codigo} — {fp.label}</option>
                ))}
              </select>
            </div>
            <div className="lf-campo lf-campo-wide">
              <label>Observaciones (opcional)</label>
              <textarea name="observaciones" value={form.observaciones} onChange={handleForm}
                rows={2} className="lf-textarea-form" placeholder="Información adicional..." />
            </div>
          </div>
        </div>

        {/* BOTONES */}
        <div className="lf-form-acciones">
          <button type="button" className="btn-cancelar-lf" onClick={() => navigate('/liquidaciones')}>
            Cancelar
          </button>
          <button type="submit" className="btn-emitir-lf" disabled={loading}>
            {loading ? 'Emitiendo...' : `Emitir Liquidación — $${importeTotal.toFixed(2)}`}
          </button>
        </div>
      </form>
    </div>
  );
}
