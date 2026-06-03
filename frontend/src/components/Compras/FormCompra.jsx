import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { toInputFecha, hoyLocal } from '../../utils/fecha';
import DropZone from '../shared/DropZone';
import './FormCompra.css';

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

const hoy = () => hoyLocal();

const detalleVacio = () => ({
  codigoPrincipal: '',
  codigoAuxiliar: '',
  descripcion: '',
  cantidad: '',
  precioUnitario: '',
  precioVentaReferencial: '',
  porcentajeIva: 15,
  descuento: '0',
  inventariable: true,
});

function fmtFechaInput(valor) {
  if (!valor) return hoy();
  const result = toInputFecha(valor);
  return result || hoy();
}

function calcularLinea(detalle) {
  const cantidad = parseFloat(detalle.cantidad) || 0;
  const precioUnitario = parseFloat(detalle.precioUnitario) || 0;
  const descuento = parseFloat(detalle.descuento) || 0;
  const subtotal = Math.max((cantidad * precioUnitario) - descuento, 0);
  const iva = detalle.porcentajeIva > 0 ? subtotal * (detalle.porcentajeIva / 100) : 0;
  return {
    subtotal,
    iva,
    total: subtotal + iva,
  };
}

function labelProveedor(proveedor) {
  if (!proveedor) return '';
  return `${proveedor.razonSocial} · ${proveedor.identificacion}`;
}

export default function FormCompra() {
  const navigate = useNavigate();
  const { sistema } = useAuth();
  const [loading, setLoading] = useState(false);
  const [importando, setImportando] = useState(false);
  const [buscandoSRI, setBuscandoSRI] = useState(false);
  const [mensajeSRI, setMensajeSRI] = useState('');
  const [claveAcceso, setClaveAcceso] = useState('');
  const [guardado, setGuardado] = useState(null);
  const [resumenGuardado, setResumenGuardado] = useState(null);
  const [proveedorBusqueda, setProveedorBusqueda] = useState('');
  const [proveedoresSugeridos, setProveedoresSugeridos] = useState([]);
  const [buscandoProveedorMaestro, setBuscandoProveedorMaestro] = useState(false);
  const [proveedorSeleccionado, setProveedorSeleccionado] = useState(null);
  const [form, setForm] = useState({
    proveedorId: null,
    tipoIdentificacionProveedor: '04',
    identificacionProveedor: '',
    razonSocialProveedor: '',
    nombreComercialProveedor: '',
    direccionProveedor: '',
    numeroFactura: '',
    numeroAutorizacion: '',
    claveAcceso: '',
    fechaEmision: hoy(),
    formaPago: '20',
    observaciones: '',
    tipoGasto: '',
    origenRegistro: 'MANUAL',
    xmlOrigen: '',
    crearProductosFaltantes: true,
    actualizarProductosExistentes: true,
    registrarInventario: Boolean(sistema?.inventarioHabilitado),
    registrarEgresoCaja: false,
  });
  const [detalles, setDetalles] = useState([detalleVacio()]);

  useEffect(() => {
    let ignore = false;
    const termino = proveedorBusqueda.trim();

    if (proveedorSeleccionado && termino === labelProveedor(proveedorSeleccionado)) {
      setProveedoresSugeridos([]);
      return undefined;
    }

    if (termino.length < 2) {
      setProveedoresSugeridos([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setBuscandoProveedorMaestro(true);
      try {
        const res = await api.get('/proveedores/buscar', { params: { q: termino } });
        if (!ignore) setProveedoresSugeridos(res.data?.data || []);
      } catch {
        if (!ignore) setProveedoresSugeridos([]);
      } finally {
        if (!ignore) setBuscandoProveedorMaestro(false);
      }
    }, 250);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [proveedorBusqueda, proveedorSeleccionado]);

  const reiniciarFormulario = () => {
    setGuardado(null);
    setResumenGuardado(null);
    setClaveAcceso('');
    setProveedorBusqueda('');
    setProveedoresSugeridos([]);
    setProveedorSeleccionado(null);
    setForm({
      proveedorId: null,
      tipoIdentificacionProveedor: '04',
      identificacionProveedor: '',
      razonSocialProveedor: '',
      nombreComercialProveedor: '',
      direccionProveedor: '',
      numeroFactura: '',
      numeroAutorizacion: '',
      claveAcceso: '',
      fechaEmision: hoy(),
      formaPago: '20',
      observaciones: '',
      origenRegistro: 'MANUAL',
      xmlOrigen: '',
      crearProductosFaltantes: true,
      actualizarProductosExistentes: true,
      registrarInventario: Boolean(sistema?.inventarioHabilitado),
      registrarEgresoCaja: false,
    });
    setDetalles([detalleVacio()]);
  };

  const actualizarForm = (campo, valor) => {
    setForm((prev) => ({ ...prev, [campo]: valor }));
  };

  const aplicarProveedorSeleccionado = (proveedor, mensaje = 'Proveedor maestro cargado') => {
    setProveedorSeleccionado(proveedor);
    setProveedorBusqueda(labelProveedor(proveedor));
    setProveedoresSugeridos([]);
    setMensajeSRI(mensaje);
    setForm((prev) => ({
      ...prev,
      proveedorId: proveedor.id || null,
      tipoIdentificacionProveedor: proveedor.tipoIdentificacion || prev.tipoIdentificacionProveedor,
      identificacionProveedor: proveedor.identificacion || prev.identificacionProveedor,
      razonSocialProveedor: proveedor.razonSocial || prev.razonSocialProveedor,
      nombreComercialProveedor: proveedor.nombreComercial || '',
      direccionProveedor: proveedor.direccion || '',
    }));
  };

  const limpiarProveedorSeleccionado = () => {
    setProveedorSeleccionado(null);
    setProveedoresSugeridos([]);
    setForm((prev) => ({ ...prev, proveedorId: null }));
  };

  const consultarSRIProveedor = async (idParam) => {
    const limpio = (idParam ?? form.identificacionProveedor).trim();
    if (!/^\d{10}$/.test(limpio) && !/^\d{13}$/.test(limpio)) {
      if (limpio.length > 0) setMensajeSRI('Ingresa 10 dígitos (cédula) o 13 dígitos (RUC)');
      return;
    }

    setBuscandoSRI(true);
    setMensajeSRI('');
    try {
      const res = await api.get(`/proveedores/sri/${limpio}`);
      const d = res.data;
      if (d.success && d.data) {
        const c = d.data;
        if (c.id) {
          aplicarProveedorSeleccionado(c, d.fuente === 'bd' ? 'Proveedor encontrado en el maestro' : 'Proveedor cargado desde SRI');
        } else {
          limpiarProveedorSeleccionado();
          actualizarForm('tipoIdentificacionProveedor', c.tipoIdentificacion || form.tipoIdentificacionProveedor);
          actualizarForm('razonSocialProveedor', c.razonSocial || '');
          actualizarForm('nombreComercialProveedor', c.nombreComercial || '');
          actualizarForm('direccionProveedor', c.direccion || '');
        }
        if (d.requiereDatosManuales) {
          setMensajeSRI('Identificación válida — completa los datos del proveedor manualmente');
        } else {
          const fuente = d.fuente === 'sri' ? 'SRI' : d.fuente === 'empresa-local' ? 'sistema' : 'BD';
          setMensajeSRI(`✓ Encontrado en ${fuente}: ${c.razonSocial}`);
        }
      } else if (d.servicioNoDisponible) {
        setMensajeSRI('SRI no disponible — ingresa los datos del proveedor manualmente');
      } else if (d.encontrado === false) {
        setMensajeSRI('No encontrado en SRI — ingresa los datos manualmente');
      } else {
        setMensajeSRI('No se pudo obtener información — ingresa los datos manualmente');
      }
    } catch (err) {
      const msg = err.response?.data?.mensaje;
      setMensajeSRI(msg || 'Error al consultar el SRI — ingresa los datos manualmente');
    } finally {
      setBuscandoSRI(false);
    }
  };

  const actualizarDetalle = (index, campo, valor) => {
    setDetalles((prev) => prev.map((item, idx) => (idx === index ? { ...item, [campo]: valor } : item)));
  };

  const agregarLinea = () => setDetalles((prev) => [...prev, detalleVacio()]);
  const eliminarLinea = (index) => setDetalles((prev) => prev.filter((_, idx) => idx !== index));

  const aplicarImportacion = (data, origen = 'XML') => {
    const proveedor = data?.proveedor || {};
    const comprobante = data?.comprobante || {};

    setForm((prev) => ({
      ...prev,
      proveedorId: prev.identificacionProveedor === proveedor.identificacionProveedor ? prev.proveedorId : null,
      tipoIdentificacionProveedor: proveedor.tipoIdentificacionProveedor || prev.tipoIdentificacionProveedor,
      identificacionProveedor: proveedor.identificacionProveedor || prev.identificacionProveedor,
      razonSocialProveedor: proveedor.razonSocialProveedor || prev.razonSocialProveedor,
      nombreComercialProveedor: proveedor.nombreComercialProveedor || prev.nombreComercialProveedor,
      direccionProveedor: proveedor.direccionProveedor || prev.direccionProveedor,
      numeroFactura: comprobante.numeroFactura || prev.numeroFactura,
      numeroAutorizacion: comprobante.numeroAutorizacion || prev.numeroAutorizacion,
      claveAcceso: comprobante.claveAcceso || prev.claveAcceso,
      fechaEmision: fmtFechaInput(comprobante.fechaEmision),
      formaPago: data?.pagos?.[0]?.formaPago || prev.formaPago,
      origenRegistro: origen,
      xmlOrigen: data?.xmlOrigen || prev.xmlOrigen,
    }));
    if (!proveedorSeleccionado || proveedorSeleccionado.identificacion !== proveedor.identificacionProveedor) {
      setProveedorSeleccionado(null);
    }
    setProveedorBusqueda(proveedor.razonSocialProveedor || '');
    setProveedoresSugeridos([]);
    setClaveAcceso(comprobante.claveAcceso || comprobante.numeroAutorizacion || '');

    if (Array.isArray(data?.detalles) && data.detalles.length > 0) {
      setDetalles(data.detalles.map((detalle) => ({
        codigoPrincipal: detalle.codigoPrincipal || '',
        codigoAuxiliar: detalle.codigoAuxiliar || '',
        descripcion: detalle.descripcion || '',
        cantidad: String(detalle.cantidad || ''),
        precioUnitario: String(detalle.precioUnitario || ''),
        precioVentaReferencial: String(detalle.precioUnitario || ''),
        porcentajeIva: Number(detalle.porcentajeIva ?? 15),
        descuento: String(detalle.descuento || 0),
        inventariable: detalle.inventariable !== false,
      })));
    }
  };

  const importarXml = async (event) => {
    const archivo = event.target.files?.[0];
    if (!archivo) return;

    setImportando(true);
    try {
      const formData = new FormData();
      formData.append('archivo', archivo);
      const res = await api.post('/compras/importar/xml', formData);
      aplicarImportacion(res.data?.data, 'XML');
      toast.success('XML cargado correctamente');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo leer el XML');
    } finally {
      setImportando(false);
      event.target.value = '';
    }
  };

  const importarAutorizacion = async () => {
    if (!claveAcceso.trim()) {
      toast.error('Ingresa la clave de acceso o autorización');
      return;
    }

    setImportando(true);
    try {
      const res = await api.post('/compras/importar/autorizacion', { claveAcceso });
      aplicarImportacion(res.data?.data, 'AUTORIZACION');
      toast.success('Autorización recuperada correctamente');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo consultar la autorización SRI');
    } finally {
      setImportando(false);
    }
  };

  const resumen = detalles.reduce((acc, detalle) => {
    const calc = calcularLinea(detalle);
    if (detalle.porcentajeIva > 0) acc.subtotal15 += calc.subtotal;
    else acc.subtotal0 += calc.subtotal;
    acc.totalIva += calc.iva;
    acc.total += calc.total;
    acc.totalDescuento += parseFloat(detalle.descuento) || 0;
    return acc;
  }, {
    subtotal0: 0,
    subtotal15: 0,
    totalIva: 0,
    total: 0,
    totalDescuento: 0,
  });

  const totalGeneral = resumen.total;

  const guardar = async (event) => {
    event.preventDefault();

    if (!form.identificacionProveedor.trim() || !form.razonSocialProveedor.trim()) {
      toast.error('Completa los datos del proveedor');
      return;
    }
    if (!form.numeroFactura.trim()) {
      toast.error('Ingresa el número de factura de compra');
      return;
    }
    if (detalles.length === 0) {
      toast.error('Debes registrar al menos una línea');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        proveedorId: form.proveedorId,
        tipoIdentificacionProveedor: form.tipoIdentificacionProveedor,
        identificacionProveedor: form.identificacionProveedor.trim(),
        razonSocialProveedor: form.razonSocialProveedor.trim(),
        nombreComercialProveedor: form.nombreComercialProveedor.trim(),
        direccionProveedor: form.direccionProveedor.trim(),
        numeroFactura: form.numeroFactura.trim(),
        numeroAutorizacion: form.numeroAutorizacion.trim(),
        claveAcceso: form.claveAcceso.trim(),
        fechaEmision: form.fechaEmision,
        observaciones: form.observaciones.trim(),
        tipoGasto: form.tipoGasto || null,
        origenRegistro: form.origenRegistro,
        xmlOrigen: form.xmlOrigen,
        crearProductosFaltantes: form.crearProductosFaltantes,
        actualizarProductosExistentes: form.actualizarProductosExistentes,
        registrarInventario: sistema?.inventarioHabilitado ? form.registrarInventario : false,
        registrarEgresoCaja: sistema?.cajaDiariaHabilitada ? form.registrarEgresoCaja : false,
        pagos: [{
          formaPago: form.formaPago,
          total: totalGeneral.toFixed(2),
        }],
        detalles: detalles.map((detalle) => ({
          codigoPrincipal: detalle.codigoPrincipal,
          codigoAuxiliar: detalle.codigoAuxiliar,
          descripcion: detalle.descripcion,
          cantidad: detalle.cantidad,
          precioUnitario: detalle.precioUnitario,
          precioVentaReferencial: detalle.precioVentaReferencial || detalle.precioUnitario,
          porcentajeIva: detalle.porcentajeIva,
          descuento: detalle.descuento,
          inventariable: detalle.inventariable,
        })),
      };

      const res = await api.post('/compras', payload);
      setGuardado(res.data?.data || null);
      setResumenGuardado(res.data?.resumen || null);
      toast.success('Factura de compra registrada');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo registrar la compra');
    } finally {
      setLoading(false);
    }
  };

  if (guardado) {
    return (
      <div className="compra-page">
        <div className="compra-success">
          <div className="compra-success-icon">✓</div>
          <h1>Compra registrada</h1>
          <p>{guardado.numeroFactura} · {guardado.razonSocialProveedor}</p>
          <strong>{new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(Number(guardado.importeTotal || 0))}</strong>

          <div className="compra-success-grid">
            <span>Productos creados: <strong>{resumenGuardado?.productosCreados || 0}</strong></span>
            <span>Productos actualizados: <strong>{resumenGuardado?.productosActualizados || 0}</strong></span>
            <span>Movimientos de inventario: <strong>{resumenGuardado?.movimientosInventario || 0}</strong></span>
            <span>Egreso en caja: <strong>{resumenGuardado?.egresoCajaRegistrado ? 'Sí' : 'No'}</strong></span>
          </div>

          <div className="compra-header-actions">
            <button className="btn-secondary" onClick={() => navigate('/compras')}>Ver compras</button>
            <button className="btn-primary" onClick={reiniciarFormulario}>Nueva compra</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="compra-page">
      <div className="compra-header">
        <div>
          <h1>Nueva factura de compra</h1>
          <p>Registra compras manuales o precargadas desde XML/autorización, con actualización opcional del catálogo e inventario.</p>
        </div>
        <div className="compra-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/compras')}>Volver al listado</button>
          <button className="btn-secondary" onClick={() => navigate('/dashboard')}>Dashboard</button>
        </div>
      </div>

      <form className="compra-grid" onSubmit={guardar}>
        <section className="compra-card compra-card-wide">
          <div className="compra-section-header">
            <div>
              <h2>Precarga</h2>
              <p>Usa XML o clave de acceso del SRI para completar proveedor, factura y detalle.</p>
            </div>
          </div>

          <div className="compra-import-grid">
            <div>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', display: 'block', marginBottom: '6px' }}>Importar XML</span>
              <DropZone
                accept=".xml,text/xml"
                icon="📄"
                label="Arrastra o selecciona el XML"
                sublabel="Factura de compra .xml"
                disabled={importando}
                onChange={([f]) => { if (f) importarXml({ target: { files: [f] } }); }}
              />
            </div>
            <div className="compra-keybox">
              <input
                value={claveAcceso}
                onChange={(e) => setClaveAcceso(e.target.value)}
                placeholder="Clave de acceso o autorización"
              />
              <button type="button" className="btn-secondary" onClick={importarAutorizacion} disabled={importando}>
                {importando ? 'Consultando...' : 'Traer del SRI'}
              </button>
            </div>
          </div>
        </section>

        <section className="compra-card">
          <h2>Proveedor</h2>
          <div className="compra-fields">
            <label className="wide">
              <span>Proveedor guardado</span>
              <div className="compra-provider-master">
                <input
                  value={proveedorBusqueda}
                  onChange={(e) => setProveedorBusqueda(e.target.value)}
                  placeholder="Buscar por RUC, cédula o razón social"
                />
                <button type="button" className="btn-secondary" onClick={() => navigate('/proveedores')}>
                  Abrir maestro
                </button>
              </div>

              {buscandoProveedorMaestro && (
                <small className="compra-helper-text">Buscando proveedores guardados...</small>
              )}

              {proveedoresSugeridos.length > 0 && (
                <div className="compra-provider-results">
                  {proveedoresSugeridos.map((proveedor) => (
                    <button
                      key={proveedor.id}
                      type="button"
                      className="compra-provider-option"
                      onClick={() => aplicarProveedorSeleccionado(proveedor)}
                    >
                      <strong>{proveedor.razonSocial}</strong>
                      <span>{proveedor.identificacion}{proveedor.nombreComercial ? ` · ${proveedor.nombreComercial}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}

              {form.proveedorId && proveedorSeleccionado && (
                <div className="compra-provider-linked">
                  <span>Vinculado al maestro: <strong>{labelProveedor(proveedorSeleccionado)}</strong></span>
                  <button type="button" onClick={limpiarProveedorSeleccionado}>Quitar vínculo</button>
                </div>
              )}
            </label>
            <label>
              <span>Tipo identificación</span>
              <select value={form.tipoIdentificacionProveedor} onChange={(e) => actualizarForm('tipoIdentificacionProveedor', e.target.value)}>
                <option value="04">RUC</option>
                <option value="05">Cédula</option>
                <option value="06">Pasaporte</option>
              </select>
            </label>
            <label>
              <span>Identificación</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ flex: 1 }}
                  value={form.identificacionProveedor}
                  onChange={(e) => {
                    actualizarForm('identificacionProveedor', e.target.value);
                    if (proveedorSeleccionado && e.target.value.trim() !== proveedorSeleccionado.identificacion) {
                      limpiarProveedorSeleccionado();
                    }
                    setMensajeSRI('');
                  }}
                  onBlur={(e) => { if (!buscandoSRI) consultarSRIProveedor(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); consultarSRIProveedor(form.identificacionProveedor); } }}
                  placeholder="RUC (13 dígitos) o cédula (10 dígitos)"
                />
                <button
                  type="button"
                  onClick={() => consultarSRIProveedor(form.identificacionProveedor)}
                  disabled={buscandoSRI}
                  style={{
                    padding: '0 12px', borderRadius: 8, border: '1px solid #c8d8ef',
                    background: '#f0f6ff', color: '#2563eb', fontWeight: 600,
                    cursor: buscandoSRI ? 'wait' : 'pointer', whiteSpace: 'nowrap', fontSize: 13,
                  }}
                >
                  {buscandoSRI ? '…' : '🔍 SRI'}
                </button>
              </div>
              {buscandoSRI && <small style={{ color: '#2563eb', marginTop: 2, display: 'block' }}>Consultando SRI...</small>}
              {mensajeSRI && !buscandoSRI && (
                <small style={{ color: mensajeSRI.startsWith('✓') ? '#2a7a2a' : '#b85a00', marginTop: 2, display: 'block' }}>
                  {mensajeSRI}
                </small>
              )}
            </label>
            <label className="wide">
              <span>Razón social</span>
              <input value={form.razonSocialProveedor} onChange={(e) => actualizarForm('razonSocialProveedor', e.target.value)} />
            </label>
            <label>
              <span>Nombre comercial</span>
              <input value={form.nombreComercialProveedor} onChange={(e) => actualizarForm('nombreComercialProveedor', e.target.value)} />
            </label>
            <label className="wide">
              <span>Dirección</span>
              <input value={form.direccionProveedor} onChange={(e) => actualizarForm('direccionProveedor', e.target.value)} />
            </label>
          </div>
        </section>

        <section className="compra-card">
          <h2>Comprobante</h2>
          <div className="compra-fields">
            <label>
              <span>Número de factura</span>
              <input value={form.numeroFactura} onChange={(e) => actualizarForm('numeroFactura', e.target.value)} placeholder="001-001-000000001" />
            </label>
            <label>
              <span>Número autorización</span>
              <input value={form.numeroAutorizacion} onChange={(e) => actualizarForm('numeroAutorizacion', e.target.value)} />
            </label>
            <label>
              <span>Clave de acceso</span>
              <input value={form.claveAcceso} onChange={(e) => actualizarForm('claveAcceso', e.target.value)} />
            </label>
            <label>
              <span>Fecha emisión</span>
              <input type="date" value={form.fechaEmision} onChange={(e) => actualizarForm('fechaEmision', e.target.value)} />
            </label>
            <label>
              <span>Forma de pago</span>
              <select value={form.formaPago} onChange={(e) => actualizarForm('formaPago', e.target.value)}>
                {FORMAS_PAGO.map((item) => (
                  <option key={item.codigo} value={item.codigo}>{item.codigo} - {item.label}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span>Tipo de gasto (deducción SRI)</span>
              <select value={form.tipoGasto} onChange={(e) => actualizarForm('tipoGasto', e.target.value)}>
                <option value="">— Sin clasificar —</option>
                <option value="SALUD">🏥 Salud</option>
                <option value="EDUCACION">📚 Educación</option>
                <option value="ALIMENTACION">🍽 Alimentación</option>
                <option value="VIVIENDA">🏠 Vivienda</option>
                <option value="VESTIMENTA">👔 Vestimenta</option>
                <option value="TURISMO">✈ Turismo</option>
                <option value="GASTOS_PERSONALES">👤 Gastos Personales</option>
                <option value="GASTOS_PROFESIONALES">💼 Gastos Profesionales</option>
                <option value="OTROS">📦 Otros deducibles</option>
              </select>
            </label>
            <label className="wide">
              <span>Observaciones</span>
              <textarea value={form.observaciones} onChange={(e) => actualizarForm('observaciones', e.target.value)} rows={3} />
            </label>
          </div>
        </section>

        <section className="compra-card compra-card-wide">
          <div className="compra-section-header">
            <div>
              <h2>Detalle de compra</h2>
              <p>Cada línea puede crear o enlazar productos existentes para alimentar inventario.</p>
            </div>
            <button type="button" className="btn-secondary" onClick={agregarLinea}>Agregar línea</button>
          </div>

          <div className="compra-table-wrap">
            <table className="compra-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Auxiliar</th>
                  <th>Descripción</th>
                  <th>Cant.</th>
                  <th>Costo</th>
                  <th>P. venta ref.</th>
                  <th>IVA</th>
                  <th>Desc.</th>
                  <th>Invent.</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detalles.map((detalle, index) => {
                  const calc = calcularLinea(detalle);
                  return (
                    <tr key={`${index}-${detalle.codigoPrincipal}`}>
                      <td><input value={detalle.codigoPrincipal} onChange={(e) => actualizarDetalle(index, 'codigoPrincipal', e.target.value)} /></td>
                      <td><input value={detalle.codigoAuxiliar} onChange={(e) => actualizarDetalle(index, 'codigoAuxiliar', e.target.value)} /></td>
                      <td><input value={detalle.descripcion} onChange={(e) => actualizarDetalle(index, 'descripcion', e.target.value)} /></td>
                      <td><input type="number" step="0.001" min="0" value={detalle.cantidad} onChange={(e) => actualizarDetalle(index, 'cantidad', e.target.value)} /></td>
                      <td><input type="number" step="0.0001" min="0" value={detalle.precioUnitario} onChange={(e) => actualizarDetalle(index, 'precioUnitario', e.target.value)} /></td>
                      <td><input type="number" step="0.0001" min="0" value={detalle.precioVentaReferencial} onChange={(e) => actualizarDetalle(index, 'precioVentaReferencial', e.target.value)} /></td>
                      <td>
                        <select value={detalle.porcentajeIva} onChange={(e) => actualizarDetalle(index, 'porcentajeIva', Number(e.target.value))}>
                          <option value={0}>0%</option>
                          <option value={15}>15%</option>
                        </select>
                      </td>
                      <td><input type="number" step="0.01" min="0" value={detalle.descuento} onChange={(e) => actualizarDetalle(index, 'descuento', e.target.value)} /></td>
                      <td>
                        <input type="checkbox" checked={detalle.inventariable} onChange={(e) => actualizarDetalle(index, 'inventariable', e.target.checked)} />
                      </td>
                      <td className="money">{calc.total.toFixed(2)}</td>
                      <td>
                        {detalles.length > 1 && (
                          <button type="button" className="compra-delete" onClick={() => eliminarLinea(index)}>×</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="compra-card">
          <h2>Automatizaciones</h2>
          <label className="compra-check">
            <input type="checkbox" checked={form.crearProductosFaltantes} onChange={(e) => actualizarForm('crearProductosFaltantes', e.target.checked)} />
            <span>Crear productos faltantes automáticamente</span>
          </label>
          <label className="compra-check">
            <input type="checkbox" checked={form.actualizarProductosExistentes} onChange={(e) => actualizarForm('actualizarProductosExistentes', e.target.checked)} />
            <span>Actualizar costo de productos existentes</span>
          </label>
          <label className="compra-check">
            <input
              type="checkbox"
              checked={form.registrarInventario}
              onChange={(e) => actualizarForm('registrarInventario', e.target.checked)}
              disabled={!sistema?.inventarioHabilitado}
            />
            <span>Registrar entrada en inventario</span>
          </label>
          <label className="compra-check">
            <input
              type="checkbox"
              checked={form.registrarEgresoCaja}
              onChange={(e) => actualizarForm('registrarEgresoCaja', e.target.checked)}
              disabled={!sistema?.cajaDiariaHabilitada}
            />
            <span>Registrar pago como egreso de caja</span>
          </label>

          {!sistema?.inventarioHabilitado && (
            <p className="compra-note">Inventario está deshabilitado en Configuración del Sistema, así que solo se actualizará el catálogo.</p>
          )}
        </section>

        <section className="compra-card">
          <h2>Resumen</h2>
          <div className="compra-total-row">
            <span>Subtotal 0%</span>
            <strong>{resumen.subtotal0.toFixed(2)}</strong>
          </div>
          <div className="compra-total-row">
            <span>Subtotal 15%</span>
            <strong>{resumen.subtotal15.toFixed(2)}</strong>
          </div>
          <div className="compra-total-row">
            <span>Descuento</span>
            <strong>{resumen.totalDescuento.toFixed(2)}</strong>
          </div>
          <div className="compra-total-row">
            <span>IVA</span>
            <strong>{resumen.totalIva.toFixed(2)}</strong>
          </div>
          <div className="compra-total-row total">
            <span>Total</span>
            <strong>{totalGeneral.toFixed(2)}</strong>
          </div>

          <button type="submit" className="btn-primary compra-submit" disabled={loading}>
            {loading ? 'Guardando compra...' : `Registrar compra por ${totalGeneral.toFixed(2)}`}
          </button>
        </section>
      </form>
    </div>
  );
}
