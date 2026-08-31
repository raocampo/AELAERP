// ====================================
// FORMULARIO NOTA DE VENTA — AELA
// Para RIMPE Negocio Popular
// frontend/src/components/NotasVenta/FormNotaVenta.jsx
// ====================================

import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { parseFechaLocal } from '../../utils/fecha';
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

// POS (PuntoVenta.jsx) usa su propia lista de nombres para notas de venta
// (FORMAS_NOTA) que en un caso no coincide textualmente con FORMAS_PAGO de
// arriba — "Aplicaciones (Ahorita/De Una)" vs "App Móvil", mismo concepto.
// Se normaliza al cargar una nota para editar para que el <select> no quede
// en un valor que no existe entre sus opciones.
const normalizarFormaPago = (fp) => (fp === 'Aplicaciones (Ahorita/De Una)' ? 'App Móvil' : fp);

const PAGO_VACIO = { formaPago: 'Efectivo', monto: '' };

// codigoAuxiliar no tiene input propio (poco usado a mano) pero se conserva
// en el objeto para no perder el vínculo con el producto al EDITAR una nota
// que sí venía del catálogo (ej. creada desde POS), donde importa para
// revertir/aplicar el movimiento de inventario correcto.
const DETALLE_VACIO = {
  descripcion: '', cantidad: '1', precioUnitario: '', descuento: '0',
  codigoPrincipal: '', codigoAuxiliar: '',
};

export default function FormNotaVenta() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editando = Boolean(id);
  const [cargandoNota, setCargandoNota] = useState(editando);
  const [numeroNota, setNumeroNota] = useState('');

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
  const [busqProd,     setBusqProd]     = useState('');
  const [prodResults,  setProdResults]  = useState([]);
  const [prodDropOpen, setProdDropOpen] = useState(false);
  const prodRef = useRef(null);

  // ── Otros ────────────────────────────────────────────────────────────────
  // Pagos mixtos (mismo patrón que PuntoVenta.jsx): 1+ líneas {formaPago,
  // monto}. Con 1 sola línea se comporta igual que antes (el monto se
  // autocompleta con el total, sin mostrarse como algo que el usuario deba
  // tocar); con 2+ se reparte el total a mano — necesario para no perder el
  // desglose real al editar una nota creada desde POS con 2+ formas de pago.
  const [pagos, setPagos] = useState([{ ...PAGO_VACIO }]);
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

  // Con una sola línea de pago, el monto sigue el total automáticamente —
  // mismo comportamiento de siempre (el usuario nunca lo ve/toca). Con 2+
  // líneas no se toca nada: el usuario está repartiendo el total a mano.
  useEffect(() => {
    if (pagos.length === 1) {
      setPagos((prev) => [{ ...prev[0], monto: totales.total > 0 ? totales.total.toFixed(2) : '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totales.total]);

  const totalPagos = pagos.reduce((acc, p) => acc + (parseFloat(p.monto) || 0), 0);
  const restantePago = Number((totales.total - totalPagos).toFixed(2));
  const pagosCuadran = Math.abs(restantePago) < 0.01;

  const agregarLineaPago = () => {
    setPagos((prev) => [...prev, { formaPago: 'Efectivo', monto: restantePago > 0 ? restantePago.toFixed(2) : '' }]);
  };
  const quitarLineaPago = (index) => {
    setPagos((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };
  const actualizarLineaPago = (index, campo, valor) => {
    setPagos((prev) => prev.map((p, i) => (i === index ? { ...p, [campo]: valor } : p)));
  };

  // ── Cargar datos existentes (modo edición) ────────────────────────────────
  useEffect(() => {
    if (!editando) return;
    (async () => {
      try {
        const res = await api.get(`/notas-venta/${id}`);
        const n = res.data.data || res.data;
        if (n.anulada) {
          toast.error('No se puede editar una nota de venta anulada');
          navigate(`/notas-venta/${id}`);
          return;
        }
        setNumeroNota(n.numeroNota || '');
        setTipoId(n.tipoIdentificacion || '07');
        setIdentificacion(n.identificacion || '9999999999999');
        setRazonSocial(n.razonSocial || 'CONSUMIDOR FINAL');
        setDireccion(n.direccion || '');
        setEmail(n.email || '');
        setClienteId(n.clienteId || null);
        const det = typeof n.detalles === 'string' ? JSON.parse(n.detalles) : (n.detalles || []);
        setDetalles(det.length
          ? det.map(d => ({
              descripcion:     d.descripcion || '',
              cantidad:        String(d.cantidad ?? 1),
              precioUnitario:  String(d.precioUnitario ?? ''),
              descuento:       String(d.descuento ?? 0),
              codigoPrincipal: d.codigoPrincipal || '',
              codigoAuxiliar:  d.codigoAuxiliar || '',
            }))
          : [{ ...DETALLE_VACIO }]);
        // Pagos mixtos (ej. notas creadas desde POS con 2+ formas de pago):
        // se carga el desglose real desde n.pagos en vez de colapsarlo a una
        // sola forma de pago. El monto de la línea única (caso normal) se
        // recalcula solo via el efecto de arriba una vez que totales.total
        // esté listo con los detalles ya cargados.
        setPagos(Array.isArray(n.pagos) && n.pagos.length > 0
          ? n.pagos.map((p) => ({ formaPago: normalizarFormaPago(p.formaPago) || 'Efectivo', monto: String(p.total ?? '') }))
          : [{ formaPago: normalizarFormaPago(n.formaPago) || 'Efectivo', monto: '' }]);
        setFecha(n.fechaEmision ? format(parseFechaLocal(n.fechaEmision), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'));
        setObs(n.observaciones || '');
      } catch {
        toast.error('No se pudo cargar la nota de venta');
        navigate('/notas-venta');
      } finally {
        setCargandoNota(false);
      }
    })();
  }, [editando, id, navigate]);

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
    const esRUC = /^\d{13}$/.test(limpio);
    const ok = /^\d{10}$/.test(limpio) || esRUC;
    if (!ok || tipoId === '07') return;
    // Corrige el tipo de identificación según la longitud del número YA (sin
    // esperar la respuesta del SRI/BD local) — evita enviar un RUC de 13
    // dígitos etiquetado como cédula, que el SRI rechaza.
    setTipoId(esRUC ? '04' : '05');

    setBuscandoSRI(true);
    setMensajeSRI('');
    try {
      const res = await api.get(`/clientes/sri/${limpio}`);
      if (res.data.success && res.data.data) {
        const c = res.data.data;
        setClienteId(c.id || null);
        if (c.tipoIdentificacion) setTipoId(c.tipoIdentificacion);
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

  // ── Autocomplete de productos del catálogo ────────────────────────────────
  // Para Negocio Popular, precioUnitario del catálogo YA incluye IVA (ver
  // nota en PuntoVenta.jsx) — se usa tal cual, sin sumar/restar nada.
  const buscarProducto = async (q) => {
    setBusqProd(q);
    if (q.length < 1) { setProdDropOpen(false); setProdResults([]); return; }
    try {
      const res = await api.get('/productos/buscar', { params: { q } });
      setProdResults(res.data.data || []);
      setProdDropOpen((res.data.data || []).length > 0);
    } catch { /* ignore */ }
  };

  const buscarPorScanner = async () => {
    const codigo = busqProd.trim();
    if (!codigo) return;
    try {
      const res = await api.get('/productos/buscar', { params: { q: codigo } });
      const items = res.data?.data || [];
      const exacto = items.find((p) =>
        String(p.codigoPrincipal || '').trim().toUpperCase() === codigo.toUpperCase() ||
        String(p.codigoAuxiliar || '').trim().toUpperCase() === codigo.toUpperCase()
      );
      if (exacto) { agregarDesdeProducto(exacto); return; }
      if (items.length === 1) { agregarDesdeProducto(items[0]); return; }
      setProdResults(items);
      setProdDropOpen(items.length > 0);
    } catch { /* ignore */ }
  };

  const agregarDesdeProducto = (prod) => {
    setDetalles(prev => {
      // Si la única línea existente está totalmente vacía (estado inicial),
      // se reemplaza en vez de dejar una fila en blanco antes del producto.
      const base = prev.length === 1 && !prev[0].descripcion && !prev[0].precioUnitario
        ? []
        : prev;
      return [...base, {
        descripcion:     prod.nombre,
        cantidad:        '1',
        precioUnitario:  String(prod.precioUnitario ?? ''),
        descuento:       '0',
        codigoPrincipal: prod.codigoPrincipal || '',
        codigoAuxiliar:  prod.codigoAuxiliar  || '',
      }];
    });
    setBusqProd('');
    setProdDropOpen(false);
    setProdResults([]);
  };

  useEffect(() => {
    const cerrar = (e) => {
      if (prodRef.current && !prodRef.current.contains(e.target)) setProdDropOpen(false);
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

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
    if (pagos.length > 1 && !pagosCuadran) {
      return toast.error(restantePago > 0
        ? `Falta $${restantePago.toFixed(2)} por repartir entre las formas de pago`
        : `Las formas de pago suman $${Math.abs(restantePago).toFixed(2)} de más`);
    }

    setSubmitting(true);
    try {
      const payload = {
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
          codigoPrincipal: d.codigoPrincipal || undefined,
          codigoAuxiliar:  d.codigoAuxiliar  || undefined,
        })),
        formaPago: pagos.length === 1 ? pagos[0].formaPago : 'Mixto',
        pagos: pagos.length > 1
          ? pagos.map((p) => ({ formaPago: p.formaPago, total: parseFloat(p.monto) || 0 }))
          : undefined,
        formaPagoDetalles: pagos.length === 1 && pagos[0].formaPago === 'Cheque'
          ? { numeroCheque, bancoEmisor }
          : pagos.length === 1 && pagos[0].formaPago === 'App Móvil'
            ? { appNombre: appNombre === 'Otra' ? appOtra : appNombre, codigoTransaccion }
            : undefined,
        fechaEmision,
        observaciones: observaciones || undefined,
      };

      if (editando) {
        await api.put(`/notas-venta/${id}`, payload);
        toast.success('Nota de venta actualizada — ya puedes reimprimirla');
        navigate(`/notas-venta/${id}`);
      } else {
        await api.post('/notas-venta', payload);
        toast.success('Nota de venta emitida');
        navigate('/notas-venta');
      }
    } catch (err) {
      toast.error(err.response?.data?.mensaje || `Error al ${editando ? 'guardar los cambios de' : 'crear'} la nota de venta`);
    } finally {
      setSubmitting(false);
    }
  };

  if (cargandoNota) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        Cargando nota de venta...
      </div>
    );
  }

  return (
    <div className="fnv-container">
      <div className="fnv-header">
        <div>
          <h1>{editando ? `✏️ Editar Nota de Venta ${numeroNota}` : '🗒️ Nueva Nota de Venta'}</h1>
          <p>
            {editando
              ? 'No es comprobante electrónico validado en línea por el SRI — se puede corregir y reimprimir.'
              : 'Documento para RIMPE Negocio Popular — autorizado SRI'}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => navigate(editando ? `/notas-venta/${id}` : '/notas-venta')}>← Volver</button>
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

          <div className="fnv-busq-prod-bar" ref={prodRef}>
            <div className="fnv-busq-input-wrap">
              <input
                type="text"
                value={busqProd}
                onChange={e => buscarProducto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarPorScanner(); } }}
                placeholder="Escanea o busca un producto del catálogo por código o nombre"
                className="fnv-busq-input"
              />
              {prodDropOpen && prodResults.length > 0 && (
                <div className="fnv-prod-drop">
                  {prodResults.map(p => (
                    <button key={p.id} type="button" className="fnv-prod-item" onClick={() => agregarDesdeProducto(p)}>
                      <span className="fnv-prod-codigo">{p.codigoPrincipal}</span>
                      <span className="fnv-prod-nombre">{p.nombre}</span>
                      <span className="fnv-prod-precio">${parseFloat(p.precioUnitario || 0).toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="fnv-table-wrap">
            <table className="fnv-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Código</th>
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
                        <input type="text" value={d.codigoPrincipal} style={{ width: '100%' }}
                          onChange={e => actualizarDetalle(idx, 'codigoPrincipal', e.target.value)}
                          placeholder="SRV001" />
                      </td>
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
                        <input type="number" value={d.precioUnitario} min="0" step="0.0001"
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
            + Agregar línea manualmente
          </button>
        </div>

        {/* ── Opciones + Totales ── */}
        <div className="fnv-section">
          <div className="fnv-bottom-row">
            <div className="fnv-opciones">
              <div className="fnv-field">
                <label>Forma(s) de pago</label>
                <div className="fnv-pagos-lista">
                  {pagos.map((pago, index) => (
                    <div className="fnv-pago-linea" key={index}>
                      <select value={pago.formaPago} onChange={e => actualizarLineaPago(index, 'formaPago', e.target.value)}>
                        {FORMAS_PAGO.map(f => <option key={f.uid} value={f.uid}>{f.icon} {f.label}</option>)}
                      </select>
                      <input
                        type="number" min="0" step="0.01"
                        value={pago.monto}
                        onChange={e => actualizarLineaPago(index, 'monto', e.target.value)}
                        placeholder="Monto"
                        className="fnv-pago-monto"
                      />
                      {pagos.length > 1 && (
                        <button type="button" className="fnv-pago-quitar" onClick={() => quitarLineaPago(index)} title="Quitar esta forma de pago">✕</button>
                      )}
                    </div>
                  ))}
                  <div className="fnv-pagos-footer">
                    <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={agregarLineaPago}>
                      + Agregar forma de pago
                    </button>
                    {pagos.length > 1 && !pagosCuadran && (
                      <span className="fnv-pago-restante">
                        {restantePago > 0 ? `Falta $${restantePago.toFixed(2)}` : `Sobran $${Math.abs(restantePago).toFixed(2)}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Cheque fields — solo con una única forma de pago */}
              {pagos.length === 1 && pagos[0].formaPago === 'Cheque' && (
                <div className="fnv-field">
                  <label>Número de cheque</label>
                  <input value={numeroCheque} onChange={e => setNumeroCheque(e.target.value)}
                    placeholder="Ej: 001234" />
                </div>
              )}
              {pagos.length === 1 && pagos[0].formaPago === 'Cheque' && (
                <div className="fnv-field">
                  <label>Banco emisor</label>
                  <input value={bancoEmisor} onChange={e => setBancoEmisor(e.target.value)}
                    placeholder="Ej: Banco Pichincha" />
                </div>
              )}

              {/* App fields — solo con una única forma de pago */}
              {pagos.length === 1 && pagos[0].formaPago === 'App Móvil' && (
                <div className="fnv-field">
                  <label>Aplicación</label>
                  <select value={appNombre} onChange={e => setAppNombre(e.target.value)}>
                    <option value="Ahorita">Ahorita (Banco Loja)</option>
                    <option value="De Una">De Una (Banco Pichincha)</option>
                    <option value="Otra">Otra aplicación</option>
                  </select>
                </div>
              )}
              {pagos.length === 1 && pagos[0].formaPago === 'App Móvil' && appNombre === 'Otra' && (
                <div className="fnv-field">
                  <label>Nombre de la app</label>
                  <input value={appOtra} onChange={e => setAppOtra(e.target.value)}
                    placeholder="Nombre de la aplicación" />
                </div>
              )}
              {pagos.length === 1 && pagos[0].formaPago === 'App Móvil' && (
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
          <button type="button" className="btn btn-secondary" onClick={() => navigate(editando ? `/notas-venta/${id}` : '/notas-venta')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting || (pagos.length > 1 && !pagosCuadran)}>
            {submitting
              ? (editando ? 'Guardando...' : 'Emitiendo...')
              : (editando ? '✓ Guardar cambios' : '✓ Emitir Nota de Venta')}
          </button>
        </div>

      </form>
    </div>
  );
}
