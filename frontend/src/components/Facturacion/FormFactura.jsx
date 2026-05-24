// ====================================
// COMPONENTE: FORMULARIO NUEVA FACTURA
// frontend/src/components/Facturacion/FormFactura.jsx
// ====================================

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './FormFactura.css';

// ─── Constantes ──────────────────────────────────────────────────────────────

const TIPOS_ID = [
  { valor: '05', label: 'Cédula (05)' },
  { valor: '04', label: 'RUC (04)' },
  { valor: '06', label: 'Pasaporte (06)' },
  { valor: '07', label: 'Consumidor Final (07)' },
];

// Formas de pago (uid interno → código SRI oficial → etiqueta amigable)
const FORMAS_PAGO_SRI = [
  { uid: '01',  sriCodigo: '01', label: 'Efectivo / Sin sist. financiero',              icon: '💵' },
  { uid: '16',  sriCodigo: '16', label: 'Tarjeta de Débito',                             icon: '💳' },
  { uid: '19',  sriCodigo: '19', label: 'Tarjeta de Crédito',                            icon: '💳' },
  { uid: 'CHQ', sriCodigo: '20', label: 'Cheque',                                        icon: '🧾' },
  { uid: 'TRF', sriCodigo: '20', label: 'Transferencia / Depósito',                     icon: '🏦' },
  { uid: '20',  sriCodigo: '20', label: 'Otros con utilización del sistema financiero',  icon: '🏦' },
  { uid: 'APP', sriCodigo: '17', label: 'Aplicación Móvil',                              icon: '📱' },
  { uid: '15',  sriCodigo: '15', label: 'Compensación de Deudas',                       icon: '📄' },
  { uid: '18',  sriCodigo: '18', label: 'Tarjeta Prepago',                               icon: '🎁' },
  { uid: '21',  sriCodigo: '21', label: 'Endoso de Títulos',                             icon: '📜' },
];

const UNIDADES_TIEMPO = ['dias', 'meses', 'años'];

const IVA_OPCIONES = [
  { valor: 0,  label: '0%' },
  { valor: 5,  label: '5%' },
  { valor: 15, label: '15%' },
  { valor: 6,  label: 'No Objeto IVA' },
  { valor: 7,  label: 'Exento IVA' },
];

const DETALLE_VACIO = {
  codigoPrincipal: '',
  codigoAuxiliar:  '',
  descripcion:     '',
  cantidad:        '1',
  precioUnitario:  '',
  descuento:       '0',
  ivaPorcentaje:   0,
};

// ─── Mapeador IVA producto → factura ─────────────────────────────────────────
const mapearIva = (tarifaIva) => {
  if (tarifaIva === 15) return 15;
  if (tarifaIva === 5)  return 5;
  if (tarifaIva === 6)  return 6; // No Objeto de IVA
  if (tarifaIva === 7)  return 7; // Exento de IVA
  return 0;
};

// ─── Cálculo de totales ───────────────────────────────────────────────────────
const calcularTotales = (detalles) => {
  let sub0 = 0, sub5 = 0, sub15 = 0, subNoObj = 0, subExento = 0, totalDesc = 0, totalIva = 0;
  detalles.forEach(d => {
    const cant   = parseFloat(d.cantidad)       || 0;
    const precio = parseFloat(d.precioUnitario) || 0;
    const desc   = parseFloat(d.descuento)      || 0;
    const ivaPct = parseInt(d.ivaPorcentaje)    || 0;
    const sub    = cant * precio - desc;
    totalDesc += desc;
    if (ivaPct === 0)  sub0      += sub;
    if (ivaPct === 5)  sub5      += sub;
    if (ivaPct === 15) sub15     += sub;
    if (ivaPct === 6)  subNoObj  += sub; // No Objeto
    if (ivaPct === 7)  subExento += sub; // Exento
    if (ivaPct <= 15)  totalIva  += sub * (ivaPct / 100); // 6/7 tienen 0% efectivo
  });
  const importeTotal = sub0 + sub5 + sub15 + subNoObj + subExento + totalIva;
  return {
    subSinImpuestos: parseFloat((sub0 + sub5 + sub15 + subNoObj + subExento).toFixed(2)),
    sub0:            parseFloat(sub0.toFixed(2)),
    sub5:            parseFloat(sub5.toFixed(2)),
    sub15:           parseFloat(sub15.toFixed(2)),
    subNoObjeto:     parseFloat(subNoObj.toFixed(2)),
    subExento:       parseFloat(subExento.toFixed(2)),
    totalDesc:       parseFloat(totalDesc.toFixed(2)),
    iva5:            parseFloat((sub5  * 0.05).toFixed(2)),
    iva15:           parseFloat((sub15 * 0.15).toFixed(2)),
    totalIva:        parseFloat(totalIva.toFixed(2)),
    importeTotal:    parseFloat(importeTotal.toFixed(2)),
  };
};

// ─── Modal de Forma de Pago ───────────────────────────────────────────────────
const APPS_MOVILES = [
  { value: 'ahorita', label: '🏦 Ahorita (Banco de Loja)' },
  { value: 'deuna',   label: '💙 De Una (Banco Pichincha)' },
  { value: 'otra',    label: '📱 Otra aplicación' },
];

const ModalPago = ({ inicial, onGuardar, onCerrar }) => {
  const [pago, setPago] = useState(inicial || {
    uid: '01', codigoFormaPago: '01',
    valor: '', plazo: '0', unidadTiempo: 'dias',
    numeroCheque: '', bancoEmisor: '',
    appNombre: 'ahorita', codigoTransaccion: '', nombreOtraApp: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setPago(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'uid') {
        const entry = FORMAS_PAGO_SRI.find(f => f.uid === value);
        next.codigoFormaPago = entry?.sriCodigo || value;
      }
      return next;
    });
  };

  const handleGuardar = () => {
    if (!pago.valor || parseFloat(pago.valor) <= 0) {
      toast.error('El valor del pago debe ser mayor a 0'); return;
    }
    const entry = FORMAS_PAGO_SRI.find(f => f.uid === pago.uid);
    const pagoFinal = {
      uid:             pago.uid,
      codigoFormaPago: entry?.sriCodigo || '01',
      valor:           parseFloat(pago.valor),
      plazo:           parseInt(pago.plazo) || 0,
      unidadTiempo:    pago.unidadTiempo || 'dias',
      formaPago:       entry?.label || pago.uid,
    };
    if (pago.uid === 'CHQ') {
      pagoFinal.numeroCheque = pago.numeroCheque;
      pagoFinal.bancoEmisor  = pago.bancoEmisor;
    }
    if (pago.uid === 'APP') {
      const appLabel = pago.appNombre === 'ahorita' ? 'Ahorita (Banco de Loja)'
                     : pago.appNombre === 'deuna'   ? 'De Una (Banco Pichincha)'
                     : pago.nombreOtraApp || 'App Móvil';
      pagoFinal.appNombre         = appLabel;
      pagoFinal.codigoTransaccion = pago.codigoTransaccion;
      pagoFinal.formaPago         = `📱 ${appLabel}`;
    }
    onGuardar(pagoFinal);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content modal-pago" onClick={e => e.stopPropagation()}>
        <div className="modal-pago-header">
          <h3>Detalle forma de pago</h3>
          <button type="button" className="btn-close" onClick={onCerrar}>✕</button>
        </div>

        <div className="fact-field" style={{ marginBottom: 14 }}>
          <label>Forma de Pago *</label>
          <select name="uid" value={pago.uid} onChange={handleChange}>
            {FORMAS_PAGO_SRI.map(f => (
              <option key={f.uid} value={f.uid}>{f.icon} {f.label}</option>
            ))}
          </select>
        </div>

        {/* Campos extra: Cheque */}
        {pago.uid === 'CHQ' && (
          <div className="pago-modal-grid" style={{ marginBottom: 12 }}>
            <div className="fact-field">
              <label>N° de Cheque</label>
              <input name="numeroCheque" value={pago.numeroCheque} onChange={handleChange} placeholder="Ej: 001234" />
            </div>
            <div className="fact-field">
              <label>Banco emisor</label>
              <input name="bancoEmisor" value={pago.bancoEmisor} onChange={handleChange} placeholder="Ej: Banco Pichincha" />
            </div>
          </div>
        )}

        {/* Campos extra: App Móvil */}
        {pago.uid === 'APP' && (
          <div style={{ marginBottom: 12 }}>
            <div className="fact-field" style={{ marginBottom: 10 }}>
              <label>Aplicación</label>
              <select name="appNombre" value={pago.appNombre} onChange={handleChange}>
                {APPS_MOVILES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            {pago.appNombre === 'otra' && (
              <div className="fact-field" style={{ marginBottom: 10 }}>
                <label>Nombre de la app</label>
                <input name="nombreOtraApp" value={pago.nombreOtraApp} onChange={handleChange} placeholder="Nombre de la aplicación" />
              </div>
            )}
            <div className="fact-field">
              <label>Código de transacción</label>
              <input name="codigoTransaccion" value={pago.codigoTransaccion} onChange={handleChange} placeholder="Código de referencia (opcional)" />
            </div>
          </div>
        )}

        <div className="pago-modal-grid">
          <div className="fact-field">
            <label>Valor *</label>
            <input type="number" name="valor" value={pago.valor}
              onChange={handleChange} min="0.01" step="0.01" placeholder="0.00" />
          </div>
          <div className="fact-field">
            <label>Plazo</label>
            <input type="number" name="plazo" value={pago.plazo}
              onChange={handleChange} min="0" placeholder="0" />
          </div>
          <div className="fact-field">
            <label>Tiempo</label>
            <select name="unidadTiempo" value={pago.unidadTiempo} onChange={handleChange}>
              <option value="">Seleccione</option>
              {UNIDADES_TIEMPO.map(u => (
                <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button type="button" className="btn-secondary" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn-primary" onClick={handleGuardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────
const FormFactura = () => {
  const navigate = useNavigate();

  // ── Datos del cliente ─────────────────────────────────────────────────────
  const [tipoId,      setTipoId]      = useState('05');
  const [idComprador, setIdComprador] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [direccion,   setDireccion]   = useState('');
  const [email,       setEmail]       = useState('');
  const [telefono,    setTelefono]    = useState('');
  const [clienteId,   setClienteId]   = useState(null); // ID en nuestra BD

  // Autocomplete cliente (BD)
  const [busqCliente,  setBusqCliente]  = useState('');
  const [clientes,     setClientes]     = useState([]);
  const [mostrarDrop,  setMostrarDrop]  = useState(false);
  const dropCliRef = useRef();

  // Consulta SRI
  const [buscandoSRI, setBuscandoSRI] = useState(false);
  const [mensajeSRI,  setMensajeSRI]  = useState('');

  // ── Detalles ─────────────────────────────────────────────────────────────
  const [detalles, setDetalles] = useState([]);

  // Autocomplete global de productos (para la barra de búsqueda superior)
  const [busqProd,     setBusqProd]     = useState('');
  const [prodResults,  setProdResults]  = useState([]);
  const [prodDropOpen, setProdDropOpen] = useState(false);
  const prodRef = useRef();

  // ── Pagos ─────────────────────────────────────────────────────────────────
  const [pagos,         setPagos]         = useState([]);
  const [modalPago,     setModalPago]     = useState(false);
  const [pagoInicial,   setPagoInicial]   = useState(null);
  const [pagoEditIdx,   setPagoEditIdx]   = useState(null);

  // ── Opciones ──────────────────────────────────────────────────────────────
  const [fechaEmision,  setFecha]      = useState(format(new Date(), 'yyyy-MM-dd'));
  const [observaciones, setObs]        = useState('');
  const [submitting,    setSubmitting] = useState(false);

  const totales = calcularTotales(detalles);

  // ── Autocomplete cliente (BD) ─────────────────────────────────────────────
  useEffect(() => {
    if (tipoId !== '05' && tipoId !== '04') { setClientes([]); setMostrarDrop(false); return; }
    if (busqCliente.length < 2) { setClientes([]); setMostrarDrop(false); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/clientes/buscar', { params: { q: busqCliente } });
        setClientes(res.data.data?.slice(0, 8) || []);
        setMostrarDrop(true);
      } catch { setClientes([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [busqCliente, tipoId]);

  useEffect(() => {
    const h = (e) => {
      if (dropCliRef.current && !dropCliRef.current.contains(e.target)) setMostrarDrop(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const seleccionarCliente = (c) => {
    setClienteId(c.id);
    setIdComprador(c.identificacion);
    setRazonSocial(c.razonSocial);
    setEmail(c.email || '');
    setTelefono(c.telefono || '');
    setDireccion(c.direccion || '');
    setBusqCliente(c.razonSocial);
    setMostrarDrop(false);
    setMensajeSRI('');
  };

  // ── Consulta SRI al escribir identificación completa ──────────────────────
  const consultarSRI = async (id) => {
    const limpio = id.trim();
    const esCedula = /^\d{10}$/.test(limpio);
    const esRUC    = /^\d{13}$/.test(limpio);
    if (!esCedula && !esRUC) return;
    if (tipoId === '07') return;

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
        if (!telefono) setTelefono(c.telefono || '');
        if (res.data.requiereDatosManuales) {
          setMensajeSRI('⚠ RUC válido — el SRI no devolvió datos. Complete razón social, dirección, email y teléfono: se guardarán como nuevo cliente al emitir.');
        } else {
          const fuente = res.data.fuente === 'sri'
            ? 'SRI (guardado en BD)'
            : res.data.fuente === 'empresa-local'
              ? 'datos locales del sistema'
              : 'BD local';
          setMensajeSRI(`✓ Encontrado en ${fuente}: ${c.razonSocial || limpio}${(!c.email || !c.telefono) ? ' — puede completar email/teléfono, se actualizarán.' : ''}`);
        }
      } else if (res.data.servicioNoDisponible) {
        setMensajeSRI(res.data.mensaje || 'No fue posible consultar el SRI en este momento');
      } else if (res.data.encontrado === false) {
        setMensajeSRI(res.data.mensaje || 'No encontrado en SRI — ingresa los datos manualmente');
      } else {
        setMensajeSRI('No encontrado en SRI — ingresa los datos manualmente');
      }
    } catch {
      setMensajeSRI('Error al consultar SRI — ingresa los datos manualmente');
    } finally {
      setBuscandoSRI(false);
    }
  };

  useEffect(() => {
    if (tipoId === '07') {
      setIdComprador('9999999999999');
      setRazonSocial('CONSUMIDOR FINAL');
      setClienteId(null);
      setMensajeSRI('');
    } else if (idComprador === '9999999999999') {
      setIdComprador('');
      setRazonSocial('');
    }
  }, [idComprador, tipoId]);

  // ── Autocomplete de productos (barra global) ──────────────────────────────
  const buscarProducto = async (q) => {
    setBusqProd(q);
    if (q.length < 1) { setProdDropOpen(false); setProdResults([]); return; }
    try {
      const res = await api.get('/productos/buscar', { params: { q } });
      setProdResults(res.data.data || []);
      setProdDropOpen((res.data.data || []).length > 0);
    } catch { /* ignore */ }
  };

  const agregarDesdeProducto = (prod) => {
    setDetalles(prev => [...prev, {
      codigoPrincipal: prod.codigoPrincipal,
      codigoAuxiliar:  prod.codigoAuxiliar || '',
      descripcion:     prod.nombre,
      cantidad:        '1',
      precioUnitario:  String(prod.precioUnitario),
      descuento:       '0',
      ivaPorcentaje:   mapearIva(prod.tarifaIva),
    }]);
    setBusqProd('');
    setProdDropOpen(false);
    setProdResults([]);
  };

  useEffect(() => {
    const h = (e) => {
      if (prodRef.current && !prodRef.current.contains(e.target)) setProdDropOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Detalles CRUD ─────────────────────────────────────────────────────────
  const actualizarDetalle = (idx, campo, valor) =>
    setDetalles(prev => prev.map((d, i) => i === idx ? { ...d, [campo]: valor } : d));

  const agregarLineaVacia = () => setDetalles(prev => [...prev, { ...DETALLE_VACIO }]);

  const eliminarDetalle = (idx) => {
    if (detalles.length === 0) return;
    setDetalles(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Pagos ─────────────────────────────────────────────────────────────────
  const abrirModalPago = (uid = '01', idx = null) => {
    if (idx !== null) {
      setPagoInicial(pagos[idx]);
    } else {
      const entry = FORMAS_PAGO_SRI.find(f => f.uid === uid) || FORMAS_PAGO_SRI[0];
      setPagoInicial({
        uid,
        codigoFormaPago: entry?.sriCodigo || uid,
        valor: totales.importeTotal > 0 ? String(totales.importeTotal.toFixed(2)) : '',
        plazo: '0', unidadTiempo: 'dias',
        numeroCheque: '', bancoEmisor: '',
        appNombre: 'ahorita', codigoTransaccion: '', nombreOtraApp: '',
      });
    }
    setPagoEditIdx(idx);
    setModalPago(true);
  };

  const guardarPago = (pago) => {
    if (pagoEditIdx !== null) {
      setPagos(prev => prev.map((p, i) => i === pagoEditIdx ? pago : p));
    } else {
      setPagos(prev => [...prev, pago]);
    }
    setModalPago(false);
    setPagoEditIdx(null);
  };

  const eliminarPago = (idx) => setPagos(prev => prev.filter((_, i) => i !== idx));

  // ── Enviar ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!idComprador || !razonSocial) return toast.error('Faltan datos del cliente');
    if (detalles.length === 0) return toast.error('Agrega al menos un ítem a la factura');
    if (detalles.some(d => !d.descripcion || !d.precioUnitario)) {
      return toast.error('Completa la descripción y precio de todos los ítems');
    }
    if (pagos.length === 0) return toast.error('Agrega al menos una forma de pago');

    setSubmitting(true);
    try {
      const res = await api.post('/facturas', {
        tipoIdentificacionComprador: tipoId,
        identificacionComprador:     idComprador,
        razonSocialComprador:        razonSocial,
        direccionComprador:          direccion    || undefined,
        emailComprador:              email        || undefined,
        telefonoComprador:           telefono     || undefined,
        detalles: detalles.map(d => ({
          codigoPrincipal: d.codigoPrincipal || 'SRV001',
          descripcion:     d.descripcion,
          cantidad:        parseFloat(d.cantidad)       || 1,
          precioUnitario:  parseFloat(d.precioUnitario) || 0,
          descuento:       parseFloat(d.descuento)      || 0,
          ivaPorcentaje:   parseInt(d.ivaPorcentaje)    || 0,
        })),
        pagos: pagos.map(p => ({
          formaPago:    p.codigoFormaPago,
          total:        p.valor,
          plazo:        p.plazo || 0,
          unidadTiempo: p.unidadTiempo || 'dias',
          ...(p.numeroCheque      && { numeroCheque:       p.numeroCheque      }),
          ...(p.bancoEmisor       && { bancoEmisor:        p.bancoEmisor       }),
          ...(p.appNombre         && { appNombre:          p.appNombre         }),
          ...(p.codigoTransaccion && { codigoTransaccion:  p.codigoTransaccion }),
        })),
        observaciones: observaciones || undefined,
        fechaEmision,
        clienteId: clienteId || undefined,
      });

      if (res.data?.data?.id) {
        localStorage.setItem('caja_ultima_factura', JSON.stringify({
          id: res.data.data.id,
          numeroFactura: res.data.data.numeroFactura || '',
          razonSocialComprador: res.data.data.razonSocialComprador || razonSocial,
          identificacionComprador: res.data.data.identificacionComprador || idComprador,
          createdAt: new Date().toISOString(),
        }));
      }

      toast.success('Factura emitida correctamente');
      const factId = res.data.data.id;
      // Navegar al detalle — desde ahí se puede imprimir el recibo POS
      navigate(`/facturas/${factId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al emitir factura');
    } finally {
      setSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="form-factura-container">
      <div className="form-fact-header">
        <div>
          <h1>🧾 Nueva Factura</h1>
          <p className="form-fact-subtitle">Comprobante electrónico — SRI Ecuador</p>
        </div>
        <button className="btn-secondary" onClick={() => navigate('/facturas')}>← Volver</button>
      </div>

      <form onSubmit={handleSubmit}>

        {/* ─── Sección 1: Datos del Cliente ─── */}
        <div className="fact-seccion">
          <h2>👤 Datos del Cliente</h2>
          <div className="fact-grid-2">
            <div className="fact-field">
              <label>Tipo de identificación *</label>
              <select value={tipoId} onChange={e => {
                setTipoId(e.target.value);
                setBusqCliente('');
                setClienteId(null);
                setMensajeSRI('');
              }}>
                {TIPOS_ID.map(t => <option key={t.valor} value={t.valor}>{t.label}</option>)}
              </select>
            </div>

            {(tipoId === '05' || tipoId === '04') && (
              <div className="fact-field" ref={dropCliRef}>
                <label>Buscar cliente existente (BD)</label>
                <input type="text" value={busqCliente}
                  onChange={e => { setBusqCliente(e.target.value); setMostrarDrop(true); }}
                  placeholder="Nombre, RUC o cédula..." />
                {mostrarDrop && clientes.length > 0 && (
                  <div className="pac-dropdown">
                    {clientes.map(c => (
                      <div key={c.id} className="pac-item" onClick={() => seleccionarCliente(c)}>
                        <span className="pac-nombre">{c.razonSocial}</span>
                        <span className="pac-cedula">{c.tipoIdentificacion === '04' ? 'RUC' : 'CI'}: {c.identificacion}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="fact-field">
              <label>N° de identificación *</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={{ flex: 1 }} value={idComprador}
                  onChange={e => { setIdComprador(e.target.value); setClienteId(null); setMensajeSRI(''); }}
                  onBlur={e => { if (!buscandoSRI) consultarSRI(e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); consultarSRI(idComprador); } }}
                  placeholder={tipoId === '07' ? '9999999999999' : tipoId === '04' ? 'RUC (13 dígitos)' : 'Cédula (10 dígitos)'}
                  readOnly={tipoId === '07'} required />
                {tipoId !== '07' && (
                  <button type="button" onClick={() => consultarSRI(idComprador)} disabled={buscandoSRI}
                    style={{
                      padding: '0 12px', borderRadius: 8, border: '1px solid #c8d8ef',
                      background: '#f0f6ff', color: '#2563eb', fontWeight: 600,
                      cursor: buscandoSRI ? 'wait' : 'pointer', whiteSpace: 'nowrap', fontSize: 13,
                    }}>
                    {buscandoSRI ? '…' : '🔍 SRI'}
                  </button>
                )}
              </div>
              {buscandoSRI && <small style={{ color: '#2563eb' }}>Consultando SRI...</small>}
              {mensajeSRI && !buscandoSRI && (
                <small style={{ color: mensajeSRI.startsWith('✓') ? '#2a7a2a' : '#b85a00' }}>
                  {mensajeSRI}
                </small>
              )}
            </div>
            <div className="fact-field">
              <label>Razón Social / Nombre *</label>
              <input value={razonSocial} onChange={e => setRazonSocial(e.target.value)}
                placeholder="Nombre o razón social" readOnly={tipoId === '07'} required />
            </div>
            <div className="fact-field">
              <label>Email (para envío)</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com" />
            </div>
            <div className="fact-field">
              <label>Teléfono</label>
              <input type="tel" value={telefono} onChange={e => setTelefono(e.target.value)}
                placeholder="02-000-0000" maxLength={50} />
            </div>
            <div className="fact-field">
              <label>Dirección</label>
              <input value={direccion} onChange={e => setDireccion(e.target.value)}
                placeholder="Calle, número, ciudad" />
            </div>
          </div>
        </div>

        {/* ─── Sección 2: Detalles ─── */}
        <div className="fact-seccion">
          <h2>📋 Detalle</h2>

          {/* Barra de búsqueda de productos */}
          <div className="fact-busq-prod-bar" ref={prodRef}>
            <span className="fact-busq-label">Código / Descripción:</span>
            <div className="fact-busq-input-wrap">
              <input
                type="text"
                value={busqProd}
                onChange={e => buscarProducto(e.target.value)}
                placeholder="Escriba una letra o palabra, después seleccione el producto"
                className="fact-busq-input"
              />
              {prodDropOpen && prodResults.length > 0 && (
                <div className="prod-auto-drop">
                  {prodResults.map(p => (
                    <div key={p.id} className="prod-auto-item"
                      onMouseDown={() => agregarDesdeProducto(p)}>
                      <span className="prod-auto-codigo">{p.codigoPrincipal}</span>
                      <span className="prod-auto-nombre">{p.nombre}</span>
                      <span className="prod-auto-precio">${parseFloat(p.precioUnitario).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="btn-busq-prod" onClick={() => { if (busqProd) buscarProducto(busqProd); }}>
              🔍 Buscar en listado
            </button>
          </div>

          {/* Tabla de ítems — envuelto en fact-tabla-outer para contener el scroll horizontal */}
          <div className="fact-tabla-outer">
          <div className="fact-detalles-wrap">
            {/* Encabezado */}
            <div className="fact-det-header">
              <span style={{ flex: '0 0 66px' }}>Cód. Princ.</span>
              <span style={{ flex: '0 0 44px' }}>Aux.</span>
              <span style={{ flex: '0 0 34px', textAlign: 'center' }}>Cant.</span>
              <span style={{ flex: 1, minWidth: 100 }}>Descripción *</span>
              <span style={{ flex: '0 0 62px', textAlign: 'right' }}>P. Unit.</span>
              <span style={{ flex: '0 0 46px', textAlign: 'center' }}>IVA</span>
              <span style={{ flex: '0 0 48px', textAlign: 'right' }}>Desc.</span>
              <span style={{ flex: '0 0 60px', textAlign: 'right' }}>Total</span>
              <span style={{ flex: '0 0 20px' }}></span>
            </div>

            {detalles.length === 0 ? (
              <div className="fact-det-empty">
                No existen productos — busca arriba o agrega una línea manualmente
              </div>
            ) : (
              detalles.map((det, idx) => {
                const cant   = parseFloat(det.cantidad)       || 0;
                const precio = parseFloat(det.precioUnitario) || 0;
                const desc   = parseFloat(det.descuento)      || 0;
                const sub    = (cant * precio - desc).toFixed(2);
                return (
                  <div key={idx} className="fact-det-row">
                    <input style={{ flex: '0 0 66px' }} value={det.codigoPrincipal}
                      onChange={e => actualizarDetalle(idx, 'codigoPrincipal', e.target.value)}
                      placeholder="SRV001" />
                    <input style={{ flex: '0 0 44px' }} value={det.codigoAuxiliar}
                      onChange={e => actualizarDetalle(idx, 'codigoAuxiliar', e.target.value)}
                      placeholder="-" />
                    <input type="number" min="0.01" step="0.01"
                      style={{ flex: '0 0 34px', textAlign: 'center' }}
                      value={det.cantidad}
                      onChange={e => actualizarDetalle(idx, 'cantidad', e.target.value)} />
                    <input style={{ flex: 1, minWidth: 100 }}
                      value={det.descripcion}
                      onChange={e => actualizarDetalle(idx, 'descripcion', e.target.value)}
                      placeholder="Descripción" required />
                    <input type="number" min="0" step="0.01"
                      style={{ flex: '0 0 62px', textAlign: 'right' }}
                      value={det.precioUnitario}
                      onChange={e => actualizarDetalle(idx, 'precioUnitario', e.target.value)}
                      placeholder="0.00" required />
                    <select style={{ flex: '0 0 46px' }} value={det.ivaPorcentaje}
                      onChange={e => actualizarDetalle(idx, 'ivaPorcentaje', parseInt(e.target.value))}>
                      {IVA_OPCIONES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
                    </select>
                    <input type="number" min="0" step="0.01"
                      style={{ flex: '0 0 48px', textAlign: 'right' }}
                      value={det.descuento}
                      onChange={e => actualizarDetalle(idx, 'descuento', e.target.value)} />
                    <span style={{ flex: '0 0 60px', textAlign: 'right', fontWeight: 700, fontSize: '0.78rem', lineHeight: '26px' }}>
                      ${sub}
                    </span>
                    <button type="button" className="btn-icon danger"
                      style={{ flex: '0 0 20px', padding: '2px', fontSize: '0.75rem' }}
                      onClick={() => eliminarDetalle(idx)} title="Eliminar">✕</button>
                  </div>
                );
              })
            )}
          </div>{/* /fact-detalles-wrap */}
          </div>{/* /fact-tabla-outer */}

          <button type="button" className="btn-agregar-linea" onClick={agregarLineaVacia}
            style={{ marginTop: 10 }}>
            + Agregar línea manualmente
          </button>
        </div>

        {/* ─── Sección 3: Formas de Pago + Totales ─── */}
        <div className="fact-pago-totales-row">

          {/* Formas de pago */}
          <div className="fact-seccion fact-pago-col">
            <h2>💳 Formas de Pago</h2>

            {/* Tabla de pagos agregados */}
            <div className="fact-pagos-tabla-wrap">
              {pagos.length === 0 ? (
                <div className="fact-pagos-vacio">No existen formas de pago</div>
              ) : (
                <table className="fact-pagos-tabla">
                  <thead>
                    <tr>
                      <th>Forma de Pago</th>
                      <th>Valor</th>
                      <th>Plazo</th>
                      <th>Tiempo</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagos.map((p, i) => {
                      const etiqueta = p.formaPago || FORMAS_PAGO_SRI.find(f => f.uid === p.uid || f.sriCodigo === p.codigoFormaPago)?.label || p.codigoFormaPago;
                      return (
                        <tr key={i}>
                          <td className="pago-label">
                            {etiqueta}
                            {p.numeroCheque && <small style={{ display: 'block', color: '#666', marginTop: 2 }}>Cheque #{p.numeroCheque}{p.bancoEmisor ? ` — ${p.bancoEmisor}` : ''}</small>}
                            {p.codigoTransaccion && <small style={{ display: 'block', color: '#666', marginTop: 2 }}>Cód: {p.codigoTransaccion}</small>}
                          </td>
                          <td className="text-right">${parseFloat(p.valor).toFixed(2)}</td>
                          <td className="text-center">{p.plazo || 0}</td>
                          <td className="text-center">{p.unidadTiempo || '—'}</td>
                          <td>
                            <button type="button" className="btn-icon danger"
                              onClick={() => eliminarPago(i)} title="Quitar">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Botones rápidos */}
            <div className="fact-pago-btns">
              <button type="button" className="btn-pago-rapido"
                onClick={() => abrirModalPago('01')}>💵 Efectivo</button>
              <button type="button" className="btn-pago-rapido"
                onClick={() => abrirModalPago('16')}>💳 Tarjeta débito</button>
              <button type="button" className="btn-pago-rapido"
                onClick={() => abrirModalPago('19')}>💳 Tarjeta crédito</button>
              <button type="button" className="btn-pago-rapido"
                onClick={() => abrirModalPago('TRF')}>🏦 Transferencia</button>
              <button type="button" className="btn-pago-rapido"
                onClick={() => abrirModalPago('CHQ')}>🧾 Cheque</button>
              <button type="button" className="btn-pago-rapido"
                onClick={() => abrirModalPago('APP')}>📱 App Móvil</button>
              <button type="button" className="btn-pago-rapido btn-pago-mas"
                onClick={() => abrirModalPago('01')}>+ Añadir forma de pago</button>
            </div>
          </div>

          {/* Totales */}
          <div className="fact-totales-box">
            <div className="total-fila"><span>Subtotal sin impuestos:</span><span>${totales.subSinImpuestos.toFixed(2)}</span></div>
            <div className="total-fila"><span>Subtotal 15.00%:</span><span>${totales.sub15.toFixed(2)}</span></div>
            {totales.sub5 > 0 && (
              <div className="total-fila"><span>Subtotal 5%:</span><span>${totales.sub5.toFixed(2)}</span></div>
            )}
            <div className="total-fila"><span>Subtotal 0%:</span><span>${totales.sub0.toFixed(2)}</span></div>
            <div className="total-fila"><span>Total descuento:</span><span>-${totales.totalDesc.toFixed(2)}</span></div>
            <div className="total-fila"><span>IVA 15.00%:</span><span>${totales.iva15.toFixed(2)}</span></div>
            {totales.iva5 > 0 && (
              <div className="total-fila"><span>IVA 5%:</span><span>${totales.iva5.toFixed(2)}</span></div>
            )}
            <div className="total-fila total-principal">
              <span>Valor a pagar:</span><span>${totales.importeTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* ─── Sección 4: Opciones adicionales ─── */}
        <div className="fact-seccion">
          <h2>📝 Opciones Adicionales</h2>
          <div className="fact-grid-2">
            <div className="fact-field">
              <label>Fecha de emisión</label>
              <input type="date" value={fechaEmision} onChange={e => setFecha(e.target.value)} />
            </div>
            <div className="fact-field full">
              <label>Observaciones</label>
              <textarea value={observaciones} onChange={e => setObs(e.target.value)}
                placeholder="Notas adicionales para la factura" rows={2} />
            </div>
          </div>
        </div>

        {/* ─── Acciones ─── */}
        <div className="form-fact-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/facturas')}>
            Cancelar
          </button>
          <button type="button" className="btn-secondary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Guardando...' : '💾 Guardar sin firmar'}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Emitiendo...' : '🧾 Firmar y enviar'}
          </button>
        </div>

      </form>

      {/* Modal de forma de pago */}
      {modalPago && (
        <ModalPago
          inicial={pagoInicial}
          onGuardar={guardarPago}
          onCerrar={() => { setModalPago(false); setPagoEditIdx(null); }}
        />
      )}
    </div>
  );
};

export default FormFactura;
