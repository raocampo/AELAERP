import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { abrirBlobEnNuevaPestana } from '../../utils/exportCsv';
import { enviarBufferUSB } from '../../utils/impresoraUsb';
import { apiOffline, estaOnline } from '../../utils/syncQueue';
import { fechaLocalOffset, hoyLocal } from '../../utils/fecha';
import SelectorPuntoVenta from '../shared/SelectorPuntoVenta';
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
  const location = useLocation();
  const { sistema } = useAuth();
  // Mesas y Comandas (restaurante): si venimos de "Cobrar mesa", precarga el
  // carrito con lo ya pedido y, al emitir con éxito, cierra la comanda y
  // libera la mesa — ver ComandaMesa.jsx. En el flujo normal de POS esto
  // queda en null y no cambia nada del comportamiento existente.
  const [comandaOrigen, setComandaOrigen] = useState(location.state?.comandaParaCobrar || null);
  const [tipoDocumento, setTipoDocumento] = useState(sistema?.documentoPosDefault || 'factura');
  const [tipoId, setTipoId] = useState('07');
  const [identificacion, setIdentificacion] = useState('9999999999999');
  const [razonSocial, setRazonSocial] = useState('CONSUMIDOR FINAL');
  const [direccion, setDireccion] = useState('');
  const [email, setEmail] = useState('');
  // Pagos mixtos: 1+ líneas {formaPago, monto, referencia}. Con 1 sola línea
  // se comporta igual que antes (el monto se autocompleta con el total); con
  // 2+ el cajero reparte el total entre varias formas de pago. El valor de
  // formaPago cambia de significado según tipoDocumento (código SRI para
  // factura, texto libre para nota de venta) — ver FORMAS_FACTURA/FORMAS_NOTA.
  const [pagos, setPagos] = useState([{ formaPago: '01', monto: '', referencia: '' }]);
  const [fechaEmision, setFechaEmision] = useState(hoyLocal());
  // Res. SRI NAC-DGERCGC25-00000014: fecha de emisión = fecha real de la
  // operación, sin backdating — el backend rechaza más de 3 días de atraso
  // o fechas futuras; el picker refleja ese mismo rango para no dejar
  // elegir algo que luego el servidor va a rechazar.
  // hoyLocal()/fechaLocalOffset() usan la hora LOCAL del navegador (nunca
  // toISOString(), que es UTC) — con Ecuador en UTC-5, toISOString() ya
  // muestra el día siguiente a partir de las 19:00 hora local, lo que
  // generaba facturas fechadas "mañana" y el SRI las rechazaba con "FECHA
  // EMISION EXTEMPORANEA" (quemando el secuencial sin poder reutilizarlo).
  const fechaEmisionMin = fechaLocalOffset(-3);
  const fechaEmisionMax = hoyLocal();
  const [codigoBarras, setCodigoBarras] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [carrito, setCarrito] = useState(() => (
    location.state?.comandaParaCobrar?.items?.map((it) => ({
      codigoPrincipal: it.codigoPrincipal,
      descripcion: it.descripcion,
      cantidad: Number(it.cantidad || 1),
      precioUnitario: Number(it.precioUnitario || 0),
      ivaPorcentaje: Number(it.ivaPorcentaje || 0),
    })) || []
  ));
  const [telefono, setTelefono] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [buscandoSRI, setBuscandoSRI] = useState(false);
  const [mensajeSRI, setMensajeSRI] = useState('');
  const [clienteIdBD, setClienteIdBD] = useState(null);
  const [clienteOriginal, setClienteOriginal] = useState({ direccion: '', email: '', telefono: '' });
  const [docEmitido, setDocEmitido] = useState(null); // { id, tipo, numero, total }
  const [showModalCliente, setShowModalCliente] = useState(false);
  const [puntoVenta, setPuntoVenta] = useState(null);
  const dropRef = useRef(null);

  useEffect(() => {
    setTipoDocumento(sistema?.documentoPosDefault || 'factura');
  }, [sistema?.documentoPosDefault]);

  // Al cambiar entre factura/nota de venta, la forma de pago por defecto
  // cambia de código SRI ('01') a texto libre ('Efectivo') — evita mandar
  // un código SRI en una nota de venta o viceversa si el cajero no toca el selector.
  useEffect(() => {
    setPagos([{ formaPago: tipoDocumento === 'factura' ? '01' : 'Efectivo', monto: '', referencia: '' }]);
  }, [tipoDocumento]);

  // Avisa cuando una venta guardada offline finalmente se sincroniza (evento
  // disparado por procesarCola() en utils/syncQueue.js) — el cajero puede
  // haber seguido vendiendo mientras tanto, así que esto es solo un aviso,
  // no intenta reabrir el modal de la venta original.
  useEffect(() => {
    const onSyncOk = (e) => {
      const { entidad, data } = e.detail || {};
      if (entidad !== 'factura' && entidad !== 'nota_venta') return;
      const numero = data?.numeroFactura || data?.numeroNota;
      if (numero) toast.success(`Venta sincronizada — ahora es ${entidad === 'factura' ? 'Factura' : 'Nota de venta'} ${numero}`);
    };
    window.addEventListener('aela:sync-item-ok', onSyncOk);
    return () => window.removeEventListener('aela:sync-item-ok', onSyncOk);
  }, []);

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
    const esRUC = /^\d{13}$/.test(limpio);
    if (!/^\d{10}$/.test(limpio) && !esRUC) {
      if (limpio.length > 0) setMensajeSRI('Ingresa 10 dígitos (cédula) o 13 dígitos (RUC)');
      return;
    }
    // Corrige el tipo de identificación según la longitud del número YA (sin
    // esperar la respuesta del SRI/BD local, para que aplique también a
    // clientes nuevos sin registro previo) — evita enviar al SRI un RUC de
    // 13 dígitos etiquetado como cédula (o viceversa), que el SRI rechaza.
    setTipoId(esRUC ? '04' : '05');

    setBuscandoSRI(true);
    setMensajeSRI('');
    setClienteIdBD(null);
    setClienteOriginal({ direccion: '', email: '', telefono: '' });
    try {
      const res = await api.get(`/clientes/sri/${limpio}`);
      const d = res.data;
      if (d.success && d.data) {
        const c = d.data;
        if (c.tipoIdentificacion) setTipoId(c.tipoIdentificacion);
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

  // Con una sola línea de pago, autocompletar el monto con el total (mismo
  // comportamiento de siempre — el cajero no tiene que escribirlo). Con 2+
  // líneas no se toca nada: el cajero está repartiendo el total a mano.
  useEffect(() => {
    if (pagos.length === 1) {
      setPagos((prev) => [{ ...prev[0], monto: total > 0 ? total.toFixed(2) : '' }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const totalPagos = useMemo(
    () => pagos.reduce((acc, p) => acc + (parseFloat(p.monto) || 0), 0),
    [pagos],
  );
  const restante = Number((total - totalPagos).toFixed(2));
  const pagosCuadran = Math.abs(restante) < 0.01;

  const agregarLineaPago = () => {
    setPagos((prev) => [
      ...prev,
      { formaPago: tipoDocumento === 'factura' ? '01' : 'Efectivo', monto: restante > 0 ? restante.toFixed(2) : '', referencia: '' },
    ]);
  };
  const quitarLineaPago = (index) => {
    setPagos((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };
  const actualizarLineaPago = (index, campo, valor) => {
    setPagos((prev) => prev.map((p, i) => (i === index ? { ...p, [campo]: valor } : p)));
  };

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
    const endpoint = tipo === 'nota_venta'
      ? `/notas-venta/${id}/recibo`
      : `/facturas/${id}/recibo`;
    try {
      await abrirBlobEnNuevaPestana(api, endpoint);
    } catch {
      toast.error('No se pudo generar el recibo');
    }
  };

  // Ticket térmico ESC/POS (etiquetas/cajón/recibo directo) — alternativa al
  // PDF de arriba para negocios con impresora térmica configurada
  // (Configuración del Sistema → Impresión). En modo 'red' el backend manda
  // los bytes por TCP; en modo 'usb' solo genera el buffer y el navegador lo
  // manda por WebUSB (el backend en la nube no alcanza el puerto USB).
  const imprimirTicketTermico = async (id, tipo) => {
    try {
      if (sistema?.impresoraModo === 'usb') {
        const res = await api.post(`/impresora/recibo/${tipo}/${id}/generar`, {}, { responseType: 'arraybuffer' });
        await enviarBufferUSB(res.data);
      } else {
        await api.post(`/impresora/recibo/${tipo}/${id}`);
      }
      toast.success('Ticket enviado a la impresora térmica');
    } catch (err) {
      toast.error(err.response?.data?.mensaje || err.message || 'No se pudo imprimir el ticket térmico');
    }
  };

  const abrirCajonDinero = async () => {
    try {
      if (sistema?.impresoraModo === 'usb') {
        const res = await api.post('/impresora/cajon/generar', {}, { responseType: 'arraybuffer' });
        await enviarBufferUSB(res.data);
      } else {
        await api.post('/impresora/cajon');
      }
    } catch (err) {
      toast.error(err.response?.data?.mensaje || err.message || 'No se pudo abrir el cajón de dinero');
    }
  };

  // Mesas y Comandas: si esta venta viene de "Cobrar mesa", enlaza el
  // documento recién emitido con la comanda y libera la mesa. Best-effort —
  // si falla, la venta YA está hecha (es lo importante); solo avisa para
  // que se libere la mesa a mano desde Mesas.
  const cerrarComandaSiCorresponde = async (tipo, documentoId) => {
    if (!comandaOrigen || !documentoId) return;
    try {
      await api.post(`/mesas/comandas/${comandaOrigen.id}/cerrar`, { tipo, documentoId });
      toast.success(`Mesa ${comandaOrigen.mesaNombre || ''} liberada`);
      setComandaOrigen(null);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'La venta se registró, pero no se pudo liberar la mesa automáticamente');
    }
  };

  const emitirDocumento = async () => {
    if (carrito.length === 0) {
      toast.error('Agrega al menos un producto al carrito');
      return;
    }
    if (pagos.some((p) => !(parseFloat(p.monto) > 0))) {
      toast.error('Cada forma de pago necesita un monto mayor a cero');
      return;
    }
    if (!pagosCuadran) {
      toast.error(restante > 0 ? `Faltan $${restante.toFixed(2)} por cubrir en las formas de pago` : `Las formas de pago suman $${Math.abs(restante).toFixed(2)} de más`);
      return;
    }

    setGuardando(true);
    const online = estaOnline();
    try {
      // Gestión de cliente en BD — solo online. Sin conexión, se manda la
      // identificación completa directo en la factura/nota (ver payload
      // abajo) y el backend la resuelve/crea sola al sincronizar
      // (enriquecerClienteDesdeFactura en routes/facturas.js, o el propio
      // registro de notas_venta que ya guarda los datos del cliente en la
      // fila) — evita depender de un clienteId que todavía no existe en el
      // servidor mientras la venta sigue encolada localmente.
      let idClienteBD = clienteIdBD;

      if (online && tipoId !== '07') {
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
        const totalNota = subtotal;
        const resp = await apiOffline('/notas-venta', {
          method: 'POST',
          entidad: 'nota_venta',
          descripcion: `Nota de venta ${razonSocial} $${totalNota.toFixed(2)}`,
          respuestaOptimista: { tipo: 'nota_venta', total: totalNota },
          body: {
            tipoIdentificacion: tipoId,
            identificacion,
            razonSocial,
            direccion: direccion || undefined,
            email: email || undefined,
            telefono: telefono || undefined,
            formaPago: pagos.length === 1 ? pagos[0].formaPago : 'Mixto',
            pagos: pagos.length > 1 ? pagos.map((p) => ({ formaPago: p.formaPago, total: Number(p.monto) || 0 })) : undefined,
            fechaEmision,
            clienteId: idClienteBD || undefined,
            detalles: carrito.map((item) => ({
              codigoPrincipal: item.codigoPrincipal,
              descripcion: item.descripcion,
              cantidad: Number(item.cantidad || 1),
              precioUnitario: Number(item.precioUnitario || 0),
              descuento: 0,
            })),
            ...(puntoVenta && { establecimiento: puntoVenta.establecimiento, puntoEmision: puntoVenta.puntoEmision }),
          },
        });
        setCarrito([]);
        if (resp.offline) {
          setDocEmitido({
            offline: true, pendienteId: resp.pendienteId,
            tipo: 'nota_venta', numero: null, total: totalNota,
          });
        } else {
          const creada = resp.data?.data;
          setDocEmitido({
            id: creada?.id, tipo: 'nota_venta',
            numero: creada?.numeroNota || '—', total: creada?.total ?? totalNota,
          });
          if (sistema?.impresionAutoReciboPos && creada?.id) {
            void abrirReciboEmitido(creada.id, 'nota_venta');
          }
          void cerrarComandaSiCorresponde('nota_venta', creada?.id);
        }
      } else {
        const resp = await apiOffline('/facturas', {
          method: 'POST',
          entidad: 'factura',
          descripcion: `Factura ${razonSocial} $${totalConIva.toFixed(2)}`,
          respuestaOptimista: { tipo: 'factura', total: totalConIva },
          body: {
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
            pagos: pagos.map((p) => ({
              formaPago: FORMAS_FACTURA.find(f => f.value === p.formaPago)?.sriCodigo || p.formaPago,
              total: Number(p.monto) || 0,
              plazo: 0,
              unidadTiempo: 'dias',
              ...(p.referencia && { referencia: p.referencia }),
            })),
            ...(puntoVenta && { establecimiento: puntoVenta.establecimiento, puntoEmision: puntoVenta.puntoEmision }),
          },
        });
        setCarrito([]);
        if (resp.offline) {
          setDocEmitido({
            offline: true, pendienteId: resp.pendienteId,
            tipo: 'factura', numero: null, total: totalConIva,
          });
        } else {
          const creada = resp.data?.data;
          setDocEmitido({
            id: creada?.id, tipo: 'factura',
            numero: creada?.numeroFactura || '—', total: creada?.importeTotal ?? totalConIva,
          });
          if (sistema?.impresionAutoReciboPos && creada?.id) {
            void abrirReciboEmitido(creada.id, 'factura');
          }
          void cerrarComandaSiCorresponde('factura', creada?.id);
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
      {comandaOrigen && (
        <div className="pos-comanda-banner">
          🍽️ Cobrando {comandaOrigen.mesaNombre || 'mesa'} — al emitir se libera la mesa automáticamente.
        </div>
      )}
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
          <input
            type="date"
            value={fechaEmision}
            min={fechaEmisionMin}
            max={fechaEmisionMax}
            title="La fecha de emisión debe ser de hoy o hasta 3 días atrás (Res. SRI NAC-DGERCGC25-00000014)"
            onChange={(e) => setFechaEmision(e.target.value)}
          />
        </div>
      </div>

      <SelectorPuntoVenta onChange={setPuntoVenta} />

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
              <span>Forma(s) de pago</span>
              <div className="pos-pagos-lista">
                {pagos.map((pago, index) => (
                  <div className="pos-pago-linea" key={index}>
                    {tipoDocumento === 'factura' ? (
                      <select value={pago.formaPago} onChange={(e) => actualizarLineaPago(index, 'formaPago', e.target.value)}>
                        {FORMAS_FACTURA.map((forma) => <option key={forma.value} value={forma.value}>{forma.label}</option>)}
                      </select>
                    ) : (
                      <select value={pago.formaPago} onChange={(e) => actualizarLineaPago(index, 'formaPago', e.target.value)}>
                        {FORMAS_NOTA.map((forma) => <option key={forma} value={forma}>{forma}</option>)}
                      </select>
                    )}
                    <input
                      type="number" min="0" step="0.01"
                      value={pago.monto}
                      onChange={(e) => actualizarLineaPago(index, 'monto', e.target.value)}
                      placeholder="Monto"
                      className="pos-pago-monto"
                    />
                    {pagos.length > 1 && (
                      <button type="button" className="btn-link danger" onClick={() => quitarLineaPago(index)} title="Quitar esta forma de pago">✕</button>
                    )}
                  </div>
                ))}
                {tipoDocumento === 'factura' && pagos.length === 1 && (pagos[0].formaPago === 'CHQ' || pagos[0].formaPago === 'TRF' || pagos[0].formaPago === 'APP') && (
                  <input
                    style={{ marginTop: 2 }}
                    value={pagos[0].referencia}
                    onChange={(e) => actualizarLineaPago(0, 'referencia', e.target.value)}
                    placeholder={
                      pagos[0].formaPago === 'CHQ' ? 'N° cheque y banco (Ej: #001 Pichincha)' :
                      pagos[0].formaPago === 'APP' ? 'App + código transacción (Ej: Ahorita ABC123)' :
                      'N° referencia / comprobante'
                    }
                  />
                )}
                <div className="pos-pagos-footer">
                  <button type="button" className="btn-link" onClick={agregarLineaPago}>+ Agregar forma de pago</button>
                  {!pagosCuadran && (
                    <span className="pos-pago-restante">
                      {restante > 0 ? `Falta $${restante.toFixed(2)}` : `Sobran $${Math.abs(restante).toFixed(2)}`}
                    </span>
                  )}
                </div>
              </div>
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
                      <input type="number" min="0" step="0.0001" value={item.precioUnitario} onChange={(e) => actualizarLinea(item.codigoPrincipal, 'precioUnitario', Number(e.target.value))} />
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
              <button type="button" className="btn-primary" onClick={emitirDocumento} disabled={guardando || !pagosCuadran}>
                {guardando ? 'Emitiendo...' : !pagosCuadran ? 'Formas de pago no cuadran' : 'Cobrar y emitir'}
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
    {docEmitido && docEmitido.offline && (
      <div className="pos-recibo-overlay">
        <div className="pos-recibo-modal">
          <div className="recibo-icono">💾</div>
          <h2>Venta guardada en este dispositivo</h2>
          <p className="recibo-total">${Number(docEmitido.total || 0).toFixed(2)}</p>
          <p className="recibo-nota">
            No hay conexión — todavía no tiene número de {docEmitido.tipo === 'nota_venta' ? 'nota de venta' : 'factura'}.
            Se enviará al SRI automáticamente en cuanto vuelva la señal (no cierres esta pestaña/navegador antes de que sincronice).
          </p>
          <div className="pos-recibo-acciones">
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
                setPagos([{ formaPago: tipoDocumento === 'factura' ? '01' : 'Efectivo', monto: '', referencia: '' }]);
              }}
            >
              ✓ Continuar vendiendo
            </button>
          </div>
        </div>
      </div>
    )}
    {docEmitido && !docEmitido.offline && (
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
            {sistema?.impresoraHabilitada && sistema?.impresoraModo !== 'ninguna' && (
              <button
                className="btn-recibo-print"
                onClick={() => imprimirTicketTermico(docEmitido.id, docEmitido.tipo)}
              >
                🧾 Imprimir ticket térmico
              </button>
            )}
            {sistema?.cajaDineroHabilitada && (
              <button className="btn-recibo-detail" onClick={abrirCajonDinero}>
                💵 Abrir cajón
              </button>
            )}
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
                setPagos([{ formaPago: tipoDocumento === 'factura' ? '01' : 'Efectivo', monto: '', referencia: '' }]);
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