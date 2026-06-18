// ====================================
// COMPONENTE: FORMULARIO PROFORMA (Crear / Editar)
// frontend/src/components/Proformas/FormProforma.jsx
// ====================================

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './FormProforma.css';

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPOS_ID = [
  { valor: '05', label: 'Cédula' },
  { valor: '04', label: 'RUC' },
  { valor: '06', label: 'Pasaporte' },
  { valor: '07', label: 'Consumidor Final' },
];

const IVA_OPCIONES = [
  { valor: 0,  label: '0%' },
  { valor: 5,  label: '5%' },
  { valor: 15, label: '15%' },
  { valor: 6,  label: 'No Obj.' },
  { valor: 7,  label: 'Exento' },
];

const DETALLE_VACIO = {
  codigoPrincipal: '',
  descripcion:     '',
  cantidad:        '1',
  precioUnitario:  '',
  descuento:       '0',
  ivaPorcentaje:   15,
};

// ─── Cálculo de totales ───────────────────────────────────────────────────────

function calcularTotales(detalles) {
  let sub0 = 0, sub5 = 0, sub15 = 0, totalDesc = 0, totalIva = 0;
  detalles.forEach(d => {
    const cant   = parseFloat(d.cantidad)       || 0;
    const precio = parseFloat(d.precioUnitario) || 0;
    const desc   = parseFloat(d.descuento)      || 0;
    const iva    = parseInt(d.ivaPorcentaje)    || 0;
    const sub    = cant * precio - desc;
    totalDesc += desc;
    if (iva === 0 || iva === 6 || iva === 7) sub0  += sub;
    if (iva === 5)  { sub5  += sub; totalIva += sub * 0.05; }
    if (iva === 15) { sub15 += sub; totalIva += sub * 0.15; }
  });
  const subtotalBase = sub0 + sub5 + sub15;
  return {
    sub0:         parseFloat(sub0.toFixed(2)),
    sub5:         parseFloat(sub5.toFixed(2)),
    sub15:        parseFloat(sub15.toFixed(2)),
    totalDesc:    parseFloat(totalDesc.toFixed(2)),
    totalIva:     parseFloat(totalIva.toFixed(2)),
    importeTotal: parseFloat((subtotalBase + totalIva).toFixed(2)),
  };
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function FormProforma() {
  const navigate  = useNavigate();
  const { id }    = useParams();
  const esEdicion = Boolean(id);

  const [saving,   setSaving]   = useState(false);
  const [cargando, setCargando] = useState(esEdicion);

  // ── Datos del cliente ──────────────────────────────────────────────────────
  const [cliente, setCliente] = useState({
    tipoIdentificacion: '07',
    identificacion:     '9999999999999',
    razonSocial:        'CONSUMIDOR FINAL',
    direccion:          '',
    email:              '',
    telefono:           '',
    clienteId:          null,
  });
  const [buscandoCliente, setBuscandoCliente] = useState(false);

  // ── Detalles ──────────────────────────────────────────────────────────────
  const [detalles, setDetalles] = useState([{ ...DETALLE_VACIO }]);

  // ── Búsqueda de producto ──────────────────────────────────────────────────
  const [productoQuery, setProductoQuery]   = useState('');
  const [productosResult, setProductosResult] = useState([]);
  const [filaProducto, setFilaProducto]     = useState(null);
  const [dropdownPos, setDropdownPos]       = useState(null);
  const buscadorRef = useRef();

  // ── Metadatos ─────────────────────────────────────────────────────────────
  const [vigenciaDesde, setVigenciaDesde] = useState('');
  const [vigenciaHasta, setVigenciaHasta] = useState('');
  const [observaciones, setObservaciones] = useState('');

  // ── Cargar proforma para edición ──────────────────────────────────────────
  useEffect(() => {
    if (!esEdicion) return;
    (async () => {
      try {
        const res = await api.get(`/proformas/${id}`);
        const p   = res.data.data;
        setCliente({
          tipoIdentificacion: p.tipoidentificacion || p.tipoIdentificacion || '07',
          identificacion:     p.identificacion     || '9999999999999',
          razonSocial:        p.razonsocial        || p.razonSocial        || '',
          direccion:          p.direccion          || '',
          email:              p.email              || '',
          telefono:           p.telefono           || '',
          clienteId:          p.clienteid          || p.clienteId          || null,
        });
        const dets = typeof p.detalles === 'string' ? JSON.parse(p.detalles) : (p.detalles || []);
        setDetalles(dets.length ? dets : [{ ...DETALLE_VACIO }]);
        setVigenciaDesde(p.vigenciadesde ? p.vigenciadesde.substring(0, 10) : '');
        setVigenciaHasta(p.vigenciahasta ? p.vigenciahasta.substring(0, 10) : '');
        setObservaciones(p.observaciones || '');
      } catch {
        toast.error('Error al cargar proforma');
        navigate('/proformas');
      } finally {
        setCargando(false);
      }
    })();
  }, [id, esEdicion, navigate]);

  // ── Búsqueda cliente SRI ──────────────────────────────────────────────────
  const buscarCliente = async () => {
    if (cliente.tipoIdentificacion === '07') return;
    if (!cliente.identificacion || cliente.identificacion.length < 10) {
      return toast.error('Ingrese la identificación completa');
    }
    setBuscandoCliente(true);
    try {
      const res = await api.get(`/clientes/sri/${cliente.identificacion}`);
      const d   = res.data.data;
      setCliente(prev => ({ ...prev, razonSocial: d.razonSocial || d.nombreComercial || prev.razonSocial, clienteId: d.id || null }));
      toast.success('Cliente encontrado');
    } catch {
      // cliente no en catastro — dejar que ingrese manual
    } finally {
      setBuscandoCliente(false);
    }
  };

  const handleClienteChange = (campo, valor) => {
    setCliente(prev => {
      const next = { ...prev, [campo]: valor };
      if (campo === 'tipoIdentificacion' && valor === '07') {
        next.identificacion = '9999999999999';
        next.razonSocial    = 'CONSUMIDOR FINAL';
      }
      return next;
    });
  };

  // ── Búsqueda de producto ──────────────────────────────────────────────────
  useEffect(() => {
    if (filaProducto === null || !productoQuery.trim()) { setProductosResult([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get(`/productos/buscar?q=${encodeURIComponent(productoQuery)}`);
        setProductosResult(res.data.data || res.data || []);
      } catch { setProductosResult([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [productoQuery, filaProducto]);

  const seleccionarProducto = (fila, prod) => {
    setDetalles(prev => prev.map((d, i) => i !== fila ? d : {
      ...d,
      codigoPrincipal: prod.codigoPrincipal || prod.codigo || '',
      descripcion:     prod.nombre || prod.descripcion || '',
      precioUnitario:  String(prod.precioUnitario || prod.precio || ''),
      ivaPorcentaje:   prod.tarifaIva ?? prod.iva ?? 15,
    }));
    setProductoQuery('');
    setProductosResult([]);
    setFilaProducto(null);
  };

  // ── Manejo de detalles ────────────────────────────────────────────────────
  const handleDetalleChange = (i, campo, valor) => {
    setDetalles(prev => prev.map((d, idx) => idx === i ? { ...d, [campo]: valor } : d));
  };

  const agregarLinea = () => setDetalles(prev => [...prev, { ...DETALLE_VACIO }]);

  const eliminarLinea = (i) => {
    if (detalles.length === 1) return toast.error('Debe haber al menos una línea');
    setDetalles(prev => prev.filter((_, idx) => idx !== i));
  };

  // ── Guardar ───────────────────────────────────────────────────────────────
  const guardar = async (e) => {
    e?.preventDefault();
    if (!cliente.razonSocial?.trim()) return toast.error('Razón social del cliente requerida');
    const lineasValidas = detalles.filter(d => d.descripcion?.trim() && parseFloat(d.precioUnitario) > 0);
    if (!lineasValidas.length) return toast.error('Agregue al menos un detalle con precio');

    setSaving(true);
    try {
      const body = {
        ...cliente,
        detalles: lineasValidas,
        vigenciaDesde: vigenciaDesde || null,
        vigenciaHasta: vigenciaHasta || null,
        observaciones: observaciones || null,
      };
      if (esEdicion) {
        await api.put(`/proformas/${id}`, body);
        toast.success('Proforma actualizada');
      } else {
        const res = await api.post('/proformas', body);
        toast.success('Proforma creada');
        navigate(`/proformas/${res.data.data.id}`);
        return;
      }
      navigate(`/proformas/${id}`);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // ── Totales calculados en tiempo real ─────────────────────────────────────
  const totales = calcularTotales(detalles);

  if (cargando) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Cargando...</div>;

  return (
    <div className="prf-form-container">
      <div className="prf-form-header">
        <div>
          <h1>{esEdicion ? '✏️ Editar Proforma' : '📋 Nueva Proforma'}</h1>
          <p className="prf-form-subtitle">Cotización / Presupuesto</p>
        </div>
        <div className="prf-form-header-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate(esEdicion ? `/proformas/${id}` : '/proformas')}>
            ← Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar Proforma'}
          </button>
        </div>
      </div>

      <form onSubmit={guardar}>

        {/* ─── Sección Cliente ─── */}
        <div className="prf-section">
          <h2>👤 Cliente</h2>
          <div className="prf-grid-tipo-id">
            <div className="prf-field">
              <label>Tipo ID</label>
              <select value={cliente.tipoIdentificacion} onChange={e => handleClienteChange('tipoIdentificacion', e.target.value)}>
                {TIPOS_ID.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>
            {cliente.tipoIdentificacion !== '07' && (
              <div className="prf-field">
                <label>Identificación</label>
                <div className="prf-id-row">
                  <input
                    value={cliente.identificacion}
                    onChange={e => handleClienteChange('identificacion', e.target.value)}
                    placeholder="Cédula / RUC / Pasaporte"
                    maxLength={20}
                  />
                  <button type="button" className="btn-secondary prf-btn-buscar"
                    onClick={buscarCliente} disabled={buscandoCliente}>
                    {buscandoCliente ? '...' : '🔍'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="prf-grid-2">
            <div className="prf-field prf-field-full">
              <label>Razón Social *</label>
              <input
                value={cliente.razonSocial}
                onChange={e => handleClienteChange('razonSocial', e.target.value)}
                placeholder="Nombre o razón social del cliente"
                disabled={cliente.tipoIdentificacion === '07'}
                required
              />
            </div>
            <div className="prf-field">
              <label>Email</label>
              <input type="email" value={cliente.email}
                onChange={e => handleClienteChange('email', e.target.value)}
                placeholder="cliente@empresa.com" />
            </div>
            <div className="prf-field">
              <label>Teléfono</label>
              <input value={cliente.telefono}
                onChange={e => handleClienteChange('telefono', e.target.value)}
                placeholder="09XXXXXXXX" />
            </div>
            <div className="prf-field prf-field-full">
              <label>Dirección</label>
              <input value={cliente.direccion}
                onChange={e => handleClienteChange('direccion', e.target.value)}
                placeholder="Dirección del cliente" />
            </div>
          </div>
        </div>

        {/* ─── Sección Detalles ─── */}
        <div className="prf-section">
          <div className="prf-section-head">
            <h2>📦 Detalle de productos / servicios</h2>
            <button type="button" className="btn-secondary prf-btn-add" onClick={agregarLinea}>
              + Agregar línea
            </button>
          </div>

          <div className="prf-tabla-detalles-wrap">
            <table className="prf-tabla-detalles">
              <thead>
                <tr>
                  <th style={{ width: '36%' }}>Descripción</th>
                  <th style={{ width: '10%' }}>Cant.</th>
                  <th style={{ width: '13%' }}>Precio Unit.</th>
                  <th style={{ width: '10%' }}>Descuento</th>
                  <th style={{ width: '10%' }}>IVA</th>
                  <th style={{ width: '13%' }}>Total línea</th>
                  <th style={{ width: '8%' }}></th>
                </tr>
              </thead>
              <tbody>
                {detalles.map((d, i) => {
                  const cant   = parseFloat(d.cantidad)       || 0;
                  const precio = parseFloat(d.precioUnitario) || 0;
                  const desc   = parseFloat(d.descuento)      || 0;
                  const iva    = parseInt(d.ivaPorcentaje)    || 0;
                  const sub    = cant * precio - desc;
                  const ivaAmt = (iva === 15 ? sub * 0.15 : iva === 5 ? sub * 0.05 : 0);
                  const total  = sub + ivaAmt;

                  return (
                    <tr key={i}>
                      <td className="prf-td-desc">
                        <div style={{ position: 'relative' }}>
                          <input
                            value={d.descripcion}
                            onChange={e => { handleDetalleChange(i, 'descripcion', e.target.value); setFilaProducto(i); setProductoQuery(e.target.value); }}
                            onFocus={e => {
                              setFilaProducto(i);
                              const r = e.target.getBoundingClientRect();
                              // Abrir hacia arriba si hay menos de 220px bajo el input
                              const abrirArriba = (window.innerHeight - r.bottom) < 220;
                              setDropdownPos({
                                top:    abrirArriba ? 'auto' : r.bottom,
                                bottom: abrirArriba ? (window.innerHeight - r.top) : 'auto',
                                left:   r.left,
                                width:  r.width,
                              });
                            }}
                            placeholder="Buscar producto o escribir..."
                            className="prf-input-desc"
                          />
                          {filaProducto === i && productosResult.length > 0 && dropdownPos && (
                            <ul className="prf-dropdown-productos" ref={buscadorRef} style={{ position: 'fixed', top: dropdownPos.top, bottom: dropdownPos.bottom, left: dropdownPos.left, width: dropdownPos.width, zIndex: 9999 }}>
                              {productosResult.slice(0, 8).map(p => (
                                <li key={p.id} onMouseDown={() => seleccionarProducto(i, p)}>
                                  <span className="prf-prod-nombre">{p.nombre}</span>
                                  <span className="prf-prod-precio">${parseFloat(p.precioUnitario || 0).toFixed(2)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <input
                          value={d.codigoPrincipal}
                          onChange={e => handleDetalleChange(i, 'codigoPrincipal', e.target.value)}
                          placeholder="Código (opcional)"
                          className="prf-input-codigo"
                        />
                      </td>
                      <td>
                        <input type="number" min="0.001" step="any"
                          value={d.cantidad}
                          onChange={e => handleDetalleChange(i, 'cantidad', e.target.value)}
                          className="prf-input-num"
                        />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.0001"
                          value={d.precioUnitario}
                          onChange={e => handleDetalleChange(i, 'precioUnitario', e.target.value)}
                          className="prf-input-num"
                          placeholder="0.00"
                        />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01"
                          value={d.descuento}
                          onChange={e => handleDetalleChange(i, 'descuento', e.target.value)}
                          className="prf-input-num"
                        />
                      </td>
                      <td>
                        <select value={d.ivaPorcentaje}
                          onChange={e => handleDetalleChange(i, 'ivaPorcentaje', parseInt(e.target.value))}
                          className="prf-select-iva">
                          {IVA_OPCIONES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="prf-td-total">
                        ${total.toFixed(2)}
                      </td>
                      <td>
                        <button type="button" className="prf-btn-del" onClick={() => eliminarLinea(i)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totales */}
          <div className="prf-totales">
            <div className="prf-totales-grid">
              {totales.sub0  > 0  && <><span>Subtotal 0%</span>  <span>${totales.sub0.toFixed(2)}</span></>}
              {totales.sub5  > 0  && <><span>Subtotal 5%</span>  <span>${totales.sub5.toFixed(2)}</span></>}
              {totales.sub15 > 0  && <><span>Subtotal 15%</span> <span>${totales.sub15.toFixed(2)}</span></>}
              {totales.totalDesc > 0 && <><span>Descuento</span> <span className="prf-desc-txt">-${totales.totalDesc.toFixed(2)}</span></>}
              {totales.totalIva  > 0 && <><span>IVA</span>       <span>${totales.totalIva.toFixed(2)}</span></>}
              <span className="prf-total-label">TOTAL</span>
              <span className="prf-total-valor">${totales.importeTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ─── Sección Vigencia y Observaciones ─── */}
        <div className="prf-section">
          <h2>📅 Vigencia y Observaciones</h2>
          <div className="prf-grid-2">
            <div className="prf-field">
              <label>Válida desde</label>
              <input type="date" value={vigenciaDesde} onChange={e => setVigenciaDesde(e.target.value)} />
            </div>
            <div className="prf-field">
              <label>Válida hasta</label>
              <input type="date" value={vigenciaHasta} onChange={e => setVigenciaHasta(e.target.value)} />
              <span className="prf-hint">Si se vence, se recomienda anularla y crear una nueva</span>
            </div>
            <div className="prf-field prf-field-full">
              <label>Observaciones / Condiciones</label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Condiciones de pago, garantías, tiempos de entrega..."
                rows={3}
                className="prf-textarea"
              />
            </div>
          </div>
        </div>

        {/* Acciones al pie */}
        <div className="prf-form-footer">
          <button type="button" className="btn-secondary" onClick={() => navigate(esEdicion ? `/proformas/${id}` : '/proformas')}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar Proforma'}
          </button>
        </div>

      </form>
    </div>
  );
}
