import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import './PuntoVenta.css';

const TIPOS_ID = [
  { valor: '07', label: 'Consumidor Final' },
  { valor: '05', label: 'Cédula' },
  { valor: '04', label: 'RUC' },
  { valor: '06', label: 'Pasaporte' },
];

const FORMAS_FACTURA = [
  { value: '01',  sriCodigo: '01', label: '💵 Efectivo' },
  { value: '16',  sriCodigo: '16', label: '💳 Tarjeta débito' },
  { value: '19',  sriCodigo: '19', label: '💳 Tarjeta crédito' },
  { value: 'TRF', sriCodigo: '20', label: '🏦 Transferencia / Depósito' },
  { value: 'CHQ', sriCodigo: '20', label: '🧾 Cheque' },
  { value: 'APP', sriCodigo: '17', label: '📱 App (Ahorita / De Una / Otra)' },
];

const FORMAS_NOTA = ['Efectivo', 'Transferencia', 'Tarjeta débito', 'Tarjeta crédito', 'Cheque', 'Aplicaciones (Ahorita/De Una)'];

export default function PuntoVenta() {
  const navigate = useNavigate();
  const { sistema } = useAuth();
  const [tipoDocumento, setTipoDocumento] = useState(sistema?.documentoPosDefault || 'factura');
  const [tipoId, setTipoId] = useState('07');
  const [identificacion, setIdentificacion] = useState('9999999999999');
  const [razonSocial, setRazonSocial] = useState('CONSUMIDOR FINAL');
  const [direccion, setDireccion] = useState('');
  const [email, setEmail] = useState('');
  const [formaPagoFactura, setFormaPagoFactura] = useState('01');
  const [pagoRefFactura, setPagoRefFactura] = useState('');
  const [formaPagoNota, setFormaPagoNota] = useState('Efectivo');
  const [fechaEmision, setFechaEmision] = useState(new Date().toISOString().slice(0, 10));
  const [codigoBarras, setCodigoBarras] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [carrito, setCarrito] = useState([]);
  const [telefono, setTelefono] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [buscandoSRI, setBuscandoSRI] = useState(false);
  const [mensajeSRI, setMensajeSRI] = useState('');
  const [clienteIdBD, setClienteIdBD] = useState(null);
  const [clienteOriginal, setClienteOriginal] = useState({ direccion: '', email: '', telefono: '' });
  const [docEmitido, setDocEmitido] = useState(null); // { id, tipo, numero, total }
  const [showModalCliente, setShowModalCliente] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    setTipoDocumento(sistema?.documentoPosDefault || 'factura');
  }, [sistema?.documentoPosDefault]);

  // Al cambiar tipo: si es 07 → poner consumidor final; si sale de 07 → limpiar campos
  useEffect(() => {
    if (tipoId === '07') {
      setIdentificacion('9999999999999');
      setRazonSocial('CONSUMIDOR FINAL');
      setDireccion('');
      setEmail('');
      setTelefono('');
    } else {
      setIdentificacion('');
      setRazonSocial('');
      setDireccion('');
      setEmail('');
      setTelefono('');
    }
    setMensajeSRI('');
    setClienteIdBD(null);
    setClienteOriginal({ direccion: '', email: '', telefono: '' });
  }, [tipoId]);

  const consultarSRI = async (idParam) => {
    const limpio = (idParam ?? identificacion).trim();
    if (tipoId === '07') return;
    if (!/^\d{10}$/.test(limpio) && !/^\d{13}$/.test(limpio)) {
      if (limpio.length > 0) setMensajeSRI('Ingresa 10 dígitos (cédula) o 13 dígitos (RUC)');
      return;
    }

    setBuscandoSRI(true);
    setMensajeSRI('');
    setClienteIdBD(null);
    setClienteOriginal({ direccion: '', email: '', telefono: '' });
    try {
      const res = await api.get(`/clientes/sri/${limpio}`);
      const d = res.data;
      if (d.success && d.data) {
        const c = d.data;
        setRazonSocial(c.razonSocial || '');
        setDireccion(c.direccion || '');
        setEmail(c.email || '');
        setTelefono(c.telefono || '');
        if (d.requiereDatosManuales) {
          setClienteIdBD(null);
          setMensajeSRI('Identificación válida — completa los datos del cliente');
          setShowModalCliente(true);
        } else {
          setClienteIdBD(c.id || null);
          setClienteOriginal({
            direccion: c.direccion || '',
            email: c.email || '',
            telefono: c.telefono || '',
          });
          const incompleto = !c.direccion || !c.email || !c.telefono;
          if (incompleto) {
            setMensajeSRI('⚠ Datos incompletos — completa los campos faltantes');
            setShowModalCliente(true);
          } else {
            setMensajeSRI('');
          }
        }
      } else if (d.servicioNoDisponible) {
        setMensajeSRI('SRI no disponible — ingresa los datos manualmente');
      } else if (d.encontrado === false) {
        setMensajeSRI('No encontrado en SRI — ingresa los datos manualmente');
      } else {
        setMensajeSRI('No se pudo obtener información — ingresa los datos manualmente');
      }
    } catch (err) {
      const msg = err.response?.data?.mensaje;
      const debug = err.response?.data?.debug;
      setMensajeSRI((msg || 'Error al consultar el SRI') + (debug ? ` [${debug}]` : ' — ingresa los datos manualmente'));
    } finally {
      setBuscandoSRI(false);
    }
  };

  useEffect(() => {
    if (busqueda.trim().length < 1) {
      setResultados([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/productos/buscar', { params: { q: busqueda } });
        setResultados(res.data?.data || []);
      } catch {
        setResultados([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [busqueda]);

  useEffect(() => {
    const cerrar = (event) => {
      if (dropRef.current && !dropRef.current.contains(event.target)) {
        setResultados([]);
      }
    };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

  const subtotal = useMemo(
    () => carrito.reduce((acc, item) => acc + (Number(item.cantidad || 0) * Number(item.precioUnitario || 0)), 0),
    [carrito],
  );

  const totalConIva = useMemo(
    () => carrito.reduce((acc, item) => {
      const linea = Number(item.cantidad || 0) * Number(item.precioUnitario || 0);
      return acc + linea + linea * (Number(item.ivaPorcentaje || 0) / 100);
    }, 0),
    [carrito],
  );

  // Total a cobrar: con IVA para facturas, sin IVA para notas de venta (RIMPE)
  const total = tipoDocumento === 'factura' ? totalConIva : subtotal;

  const agregarProducto = (producto) => {
    setCarrito((prev) => {
      const existente = prev.find((item) => item.codigoPrincipal === producto.codigoPrincipal);
      if (existente) {
        return prev.map((item) => (
          item.codigoPrincipal === producto.codigoPrincipal
            ? { ...item, cantidad: Number(item.cantidad) + 1 }
            : item
        ));
      }

      return [
        ...prev,
        {
          codigoPrincipal: producto.codigoPrincipal,
          descripcion: producto.nombre,
          cantidad: 1,
          precioUnitario: Number(producto.precioUnitario || 0),
          ivaPorcentaje: Number(producto.tarifaIva || 0),
        },
      ];
    });

    setBusqueda('');
    setResultados([]);
  };

  const agregarProductoPorCodigo = async () => {
    const codigo = codigoBarras.trim();
    if (!codigo) return;

    try {
      const res = await api.get('/productos/buscar', { params: { q: codigo } });
      const items = res.data?.data || [];
      const exacto = items.find((item) => {
        const codigoPrincipal = String(item.codigoPrincipal || '').trim().toUpperCase();
        const codigoAuxiliar = String(item.codigoAuxiliar || '').trim().toUpperCase();
        const buscado = codigo.toUpperCase();
        return codigoPrincipal === buscado || codigoAuxiliar === buscado;
      });

      if (exacto) {
        agregarProducto(exacto);
        setCodigoBarras('');
        return;
      }

      if (items.length === 1) {
        agregarProducto(items[0]);
        setCodigoBarras('');
        return;
      }

      if (items.length > 1) {
        setBusqueda(codigo);
        setResultados(items);
        toast('Se encontraron varios productos. Selecciona uno del listado.');
        return;
      }

      toast.error('No se encontró un producto con ese código');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo buscar el producto por código');
    }
  };

  const actualizarLinea = (codigoPrincipal, campo, valor) => {
    setCarrito((prev) => prev.map((item) => (
      item.codigoPrincipal === codigoPrincipal ? { ...item, [campo]: valor } : item
    )));
  };

  const quitarLinea = (codigoPrincipal) => {
    setCarrito((prev) => prev.filter((item) => item.codigoPrincipal !== codigoPrincipal));
  };

  const abrirReciboEmitido = async (id, tipo) => {
    await imprimirReciboDoc(id, tipo);
  };

  const imprimirReciboDoc = async (id, tipo) => {
    const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
    const base = (import.meta.env.VITE_API_URL || 'http://localhost:5600/api').replace(/\/api$/, '');
    const endpoint = tipo === 'nota_venta'
      ? `${base}/api/notas-venta/${id}/recibo`
      : `${base}/api/facturas/${id}/recibo`;
    try {
      const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { toast.error('No se pudo generar el recibo'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch {
      toast.error('Error al abrir el recibo');
    }
  };

  const emitirDocumento = async () => {
    if (carrito.length === 0) {
      toast.error('Agrega al menos un producto al carrito');
      return;
    }

    setGuardando(true);
    try {
      // Gestión de cliente en BD
      let idClienteBD = clienteIdBD;

      if (tipoId !== '07') {
        if (idClienteBD) {
          // Cliente ya existe en BD: actualizar solo los campos que antes estaban vacíos
          const updates = {};
          if (direccion.trim() && !clienteOriginal.direccion) updates.direccion = direccion.trim();
          if (email.trim() && !clienteOriginal.email) updates.email = email.trim();
          if (telefono.trim() && !clienteOriginal.telefono) updates.telefono = telefono.trim();
          if (Object.keys(updates).length > 0) {
            try { await api.put(`/clientes/${idClienteBD}`, updates); } catch { /* no crítico */ }
          }
        } else if (razonSocial.trim()) {
          // Cliente nuevo: crear en BD
          try {
            const resCliente = await api.post('/clientes', {
              tipoIdentificacion: tipoId,
              identificacion: identificacion.trim(),
              razonSocial: razonSocial.trim(),
              direccion: direccion?.trim() || undefined,
              email: email?.trim() || undefined,
              telefono: telefono?.trim() || undefined,
            });
            idClienteBD = resCliente.data?.data?.id || null;
            setClienteIdBD(idClienteBD);
          } catch (errCliente) {
            if (errCliente.response?.status === 409) {
              try {
                const busq = await api.get('/clientes', { params: { q: identificacion } });
                const enc = busq.data?.data?.find(c => c.identificacion === identificacion.trim());
                idClienteBD = enc?.id || null;
                setClienteIdBD(idClienteBD);
              } catch { /* continuar sin clienteId */ }
            }
          }
        }
      }

      if (tipoDocumento === 'nota_venta') {
        const res = await api.post('/notas-venta', {
          tipoIdentificacion: tipoId,
          identificacion,
          razonSocial,
          direccion: direccion || undefined,
          email: email || undefined,
          telefono: telefono || undefined,
          formaPago: formaPagoNota,
          fechaEmision,
          clienteId: idClienteBD || undefined,
          detalles: carrito.map((item) => ({
            codigoPrincipal: item.codigoPrincipal,
            descripcion: item.descripcion,
            cantidad: Number(item.cantidad || 1),
            precioUnitario: Number(item.precioUnitario || 0),
            descuento: 0,
          })),
        });
        setCarrito([]);
        setDocEmitido({
          id: res.data?.data?.id,
          tipo: 'nota_venta',
          numero: res.data?.data?.numeroNota || '—',
          total: res.data?.data?.total ?? subtotal,
        });
        if (sistema?.impresionAutoReciboPos && res.data?.data?.id) {
          void abrirReciboEmitido(res.data.data.id, 'nota_venta');
        }
      } else {
        const res = await api.post('/facturas', {
          tipoIdentificacionComprador: tipoId,
          identificacionComprador: identificacion,
          razonSocialComprador: razonSocial,
          direccionComprador: direccion || undefined,
          emailComprador: email || undefined,
          telefonoComprador: telefono || undefined,
          fechaEmision,
          clienteId: idClienteBD || undefined,
          detalles: carrito.map((item) => ({
            codigoPrincipal: item.codigoPrincipal,
            descripcion: item.descripcion,
            cantidad: Number(item.cantidad || 1),
            precioUnitario: Number(item.precioUnitario || 0),
            descuento: 0,
            ivaPorcentaje: Number(item.ivaPorcentaje || 0),
          })),
          pagos: [
            {
              formaPago: FORMAS_FACTURA.find(f => f.value === formaPagoFactura)?.sriCodigo || formaPagoFactura,
              total: totalConIva,  // total con IVA para que coincida con el importe total de la factura
              plazo: 0,
              unidadTiempo: 'dias',
              ...(pagoRefFactura && { referencia: pagoRefFactura }),
            },
          ],
        });
        setCarrito([]);
        setDocEmitido({
          id: res.data?.data?.id,
          tipo: 'factura',
          numero: res.data?.data?.numeroFactura || '—',
          total: res.data?.data?.importeTotal ?? totalConIva,
        });
        if (sistema?.impresionAutoReciboPos && res.data?.data?.id) {
          void abrirReciboEmitido(res.data.data.id, 'factura');
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.mensaje || error.response?.data?.error || 'No se pudo emitir el documento');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
    <div className="pos-page">
      <div className="pos-topbar">
        <div>
          <h1>Punto de Venta</h1>
          <p>Venta rápida con catálogo, caja diaria e inventario integrados.</p>
        </div>
        <div className="pos-topbar-actions">
          <select value={tipoDocumento} onChange={(e) => setTipoDocumento(e.target.value)}>
            <option value="factura">Factura</option>
            <option value="nota_venta">Nota de venta</option>
          </select>
          <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
        </div>
      </div>

      <div className="pos-grid">
        <section className="pos-card">
          <h2>Cliente</h2>
          <div className="pos-form">
            <label>
              <span>Tipo</span>
              <select value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
                {TIPOS_ID.map((tipo) => <option key={tipo.valor} value={tipo.valor}>{tipo.label}</option>)}
              </select>
            </label>
            <label>
              <span>Identificación</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ flex: 1 }}
                  value={identificacion}
                  onChange={(e) => { setIdentificacion(e.target.value); setMensajeSRI(''); }}
                  onBlur={(e) => { if (!buscandoSRI) consultarSRI(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); consultarSRI(identificacion); } }}
                  readOnly={tipoId === '07'}
                  placeholder={tipoId === '04' ? 'RUC — 13 dígitos' : tipoId === '05' ? 'Cédula — 10 dígitos' : ''}
                />
                {tipoId !== '07' && (
                  <button
                    type="button"
                    onClick={() => consultarSRI(identificacion)}
                    disabled={buscandoSRI}
                    style={{
                      padding: '0 12px', borderRadius: 8, border: '1px solid #c8d8ef',
                      background: '#f0f6ff', color: '#2563eb', fontWeight: 600,
                      cursor: buscandoSRI ? 'wait' : 'pointer', whiteSpace: 'nowrap', fontSize: 13,
                    }}
                  >
                    {buscandoSRI ? '…' : '🔍 SRI'}
                  </button>
                )}
              </div>
              {buscandoSRI && <small style={{ color: '#2563eb', marginTop: 2, display: 'block' }}>Consultando SRI...</small>}
              {mensajeSRI && !buscandoSRI && (
                <small style={{ color: mensajeSRI.startsWith('✓') ? '#2a7a2a' : '#b85a00', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {mensajeSRI}
                  {mensajeSRI.includes('incompleto') || mensajeSRI.includes('completa') ? (
                    <button type="button" onClick={() => setShowModalCliente(true)} style={{ fontSize: 11, padding: '1px 8px', borderRadius: 5, border: '1px solid #b85a00', background: '#fff7ed', color: '#b85a00', cursor: 'pointer', fontWeight: 600 }}>
                      Editar
                    </button>
                  ) : null}
                </small>
              )}
            </label>
            <label className="full">
              <span>Nombre o razón social</span>
              <input value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} readOnly={tipoId === '07'} />
            </label>
            <label>
              <span>Dirección</span>
              <input value={direccion} onChange={(e) => setDireccion(e.target.value)} />
            </label>
            <label>
              <span>Teléfono</span>
              <input value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="0987654321" readOnly={tipoId === '07'} />
            </label>
            <label>
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="full">
              <span>Forma de pago</span>
              {tipoDocumento === 'factura' ? (
                <>
                  <select value={formaPagoFactura} onChange={(e) => { setFormaPagoFactura(e.target.value); setPagoRefFactura(''); }}>
                    {FORMAS_FACTURA.map((forma) => <option key={forma.value} value={forma.value}>{forma.label}</option>)}
                  </select>
                  {(formaPagoFactura === 'CHQ' || formaPagoFactura === 'TRF' || formaPagoFactura === 'APP') && (
                    <input
                      style={{ marginTop: 6 }}
                      value={pagoRefFactura}
                      onChange={(e) => setPagoRefFactura(e.target.value)}
                      placeholder={
                        formaPagoFactura === 'CHQ' ? 'N° cheque y banco (Ej: #001 Pichincha)' :
                        formaPagoFactura === 'APP' ? 'App + código transacción (Ej: Ahorita ABC123)' :
                        'N° referencia / comprobante'
                      }
                    />
                  )}
                </>
              ) : (
                <select value={formaPagoNota} onChange={(e) => setFormaPagoNota(e.target.value)}>
                  {FORMAS_NOTA.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                </select>
              )}
            </label>
          </div>
        </section>

        <section className="pos-card pos-card-wide">
          <h2>Carrito</h2>
          <div className="pos-scan-row">
            <input
              value={codigoBarras}
              onChange={(e) => setCodigoBarras(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  agregarProductoPorCodigo();
                }
              }}
              placeholder="Escanea o escribe el código de barras / código del producto"
            />
            <button type="button" className="btn-secondary" onClick={agregarProductoPorCodigo}>
              Agregar por código
            </button>
          </div>
          <div className="pos-search-wrap" ref={dropRef}>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Busca manualmente por código, auxiliar o nombre"
            />
            {resultados.length > 0 && (
              <div className="pos-search-drop">
                {resultados.map((producto) => (
                  <button key={producto.id} type="button" className="pos-search-item" onClick={() => agregarProducto(producto)}>
                    <strong>{producto.codigoPrincipal}</strong>
                    <span>{producto.nombre}</span>
                    <small>${Number(producto.precioUnitario || 0).toFixed(2)}</small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pos-table-wrap">
            <table className="pos-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Precio</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {carrito.map((item) => (
                  <tr key={item.codigoPrincipal}>
                    <td>
                      <div className="pos-product">
                        <strong>{item.codigoPrincipal}</strong>
                        <span>{item.descripcion}</span>
                      </div>
                    </td>
                    <td>
                      <input type="number" min="1" step="1" value={item.cantidad} onChange={(e) => actualizarLinea(item.codigoPrincipal, 'cantidad', Number(e.target.value))} />
                    </td>
                    <td>
                      <input type="number" min="0" step="0.01" value={item.precioUnitario} onChange={(e) => actualizarLinea(item.codigoPrincipal, 'precioUnitario', Number(e.target.value))} />
                    </td>
                    <td>${(Number(item.cantidad || 0) * Number(item.precioUnitario || 0)).toFixed(2)}</td>
                    <td><button type="button" className="btn-link danger" onClick={() => quitarLinea(item.codigoPrincipal)}>Quitar</button></td>
                  </tr>
                ))}
                {carrito.length === 0 && (
                  <tr><td colSpan="5" className="pos-empty">Agrega productos para comenzar una venta.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="pos-footer">
            <div className="pos-total">
              <span>Total</span>
              <strong>${total.toFixed(2)}</strong>
            </div>
            <div className="pos-actions">
              <button type="button" className="btn-secondary" onClick={() => setCarrito([])}>Vaciar carrito</button>
              <button type="button" className="btn-primary" onClick={emitirDocumento} disabled={guardando}>
                {guardando ? 'Emitiendo...' : 'Cobrar y emitir'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>

    {/* Modal de completar datos del cliente */}
    {showModalCliente && (
      <div className="pos-recibo-overlay">
        <div className="pos-recibo-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
          <div className="recibo-icono">👤</div>
          <h2 style={{ marginBottom: 4 }}>Datos del cliente</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
            Completa los campos faltantes. Se guardarán al emitir el documento.
          </p>
          <div className="pos-form" style={{ textAlign: 'left', gridTemplateColumns: '1fr 1fr' }}>
            <label className="full">
              <span>Nombre / Razón social</span>
              <input value={razonSocial} readOnly style={{ background: '#f1f5f9' }} />
            </label>
            <label>
              <span>Dirección</span>
              <input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Calle, sector, ciudad"
                autoFocus
              />
            </label>
            <label>
              <span>Teléfono</span>
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="0987654321"
              />
            </label>
            <label className="full">
              <span>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="cliente@empresa.com"
                type="email"
              />
            </label>
          </div>
          <div className="pos-recibo-acciones" style={{ marginTop: 16 }}>
            <button className="btn-recibo-new" onClick={() => setShowModalCliente(false)}>
              ✓ Guardar y continuar
            </button>
            <button className="btn-recibo-detail" onClick={() => setShowModalCliente(false)} style={{ background: '#f1f5f9', color: '#64748b' }}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Modal de recibo tras emisión */}
    {docEmitido && (
      <div className="pos-recibo-overlay">
        <div className="pos-recibo-modal">
          <div className="recibo-icono">✅</div>
          <h2>{docEmitido.tipo === 'nota_venta' ? 'Nota de Venta emitida' : 'Factura emitida'}</h2>
          <p className="recibo-numero">N° {docEmitido.numero}</p>
          <p className="recibo-total">${Number(docEmitido.total || 0).toFixed(2)}</p>
          <p className="recibo-nota">
            {docEmitido.tipo === 'nota_venta'
              ? 'Comprobante RIMPE. El cliente puede solicitar copia.'
              : 'El RIDE electrónico se enviará al correo del cliente.'}
          </p>
          <p style={{ color: '#64748b', marginTop: 0 }}>
            {sistema?.impresoraKiosko
              ? `Impresora sugerida: ${sistema.impresoraKiosko}`
              : 'La impresión se controla desde el navegador; el sistema no detecta impresoras automáticamente.'}
          </p>
          <div className="pos-recibo-acciones">
            <button
              className="btn-recibo-print"
              onClick={async () => {
                await imprimirReciboDoc(docEmitido.id, docEmitido.tipo);
                setDocEmitido(null);
              }}
            >
              🖨️ Imprimir recibo POS
            </button>
            <button
              className="btn-recibo-detail"
              onClick={() => navigate(docEmitido.tipo === 'nota_venta' ? `/notas-venta/${docEmitido.id}` : `/facturas/${docEmitido.id}`)}
            >
              📄 Ver {docEmitido.tipo === 'nota_venta' ? 'nota de venta' : 'factura'}
            </button>
            <button
              className="btn-recibo-new"
              onClick={() => {
                setDocEmitido(null);
                setTipoId('07');
                setIdentificacion('9999999999999');
                setRazonSocial('CONSUMIDOR FINAL');
                setDireccion('');
                setEmail('');
                setTelefono('');
                setClienteIdBD(null);
                setClienteOriginal({ direccion: '', email: '', telefono: '' });
                setMensajeSRI('');
              }}
            >
              ➕ Nueva venta
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}