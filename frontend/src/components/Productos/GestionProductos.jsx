import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { descargarCsv } from '../../utils/exportCsv';
import { IcEditar, IcEliminar } from '../../utils/icons';
import DropZone from '../shared/DropZone';
import './GestionProductos.css';

const FORM_INICIAL = {
  id: null,
  codigoPrincipal: '',
  codigoAuxiliar: '',
  nombre: '',
  precioUnitario: '',
  costoUnitario: '',
  tarifaIva: 15,
  unidadMedida: 'UND',
  inventariable: false,
  stockActual: '0',
  stockMinimo: '0',
  infoAdicional: '',
  activo: true,
  categoriaMenu: '',
  descripcionMenu: '',
  imagenMenuUrl: '',
  visibleEnMenu: false,
  ordenMenu: 0,
};

const MOVIMIENTO_INICIAL = {
  productoId: '',
  tipo: 'ENTRADA',
  cantidad: '',
  referencia: '',
  observacion: '',
  costoUnitario: '',
};

export default function GestionProductos({ initialTab = 'catalogo' }) {
  const { sistema } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [productos, setProductos] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [guardandoMovimiento, setGuardandoMovimiento] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState(FORM_INICIAL);
  const [movimientoForm, setMovimientoForm] = useState(MOVIMIENTO_INICIAL);
  const [archivoExcel, setArchivoExcel] = useState(null);
  const [archivoXml, setArchivoXml] = useState(null);
  const [claveAcceso, setClaveAcceso] = useState('');
  const [registrarEntradaInventario, setRegistrarEntradaInventario] = useState(true);
  const [margenUtilidad, setMargenUtilidad] = useState(''); // % de utilidad para importación XML
  const [importando, setImportando] = useState(false);
  const [resultadoImportacion, setResultadoImportacion] = useState(null);
  const [exportandoInv, setExportandoInv] = useState(false);
  const [exportandoInvExcel, setExportandoInvExcel] = useState(false);
  const [modalProducto,   setModalProducto]   = useState(false);
  const [modalMovimiento, setModalMovimiento] = useState(false);
  const [modalEliminarInv, setModalEliminarInv] = useState(false);
  const [eliminarProductosInv, setEliminarProductosInv] = useState(false);
  const [eliminandoInv, setEliminandoInv] = useState(false);
  // Lista — paginación
  const [listPage,    setListPage]    = useState(1);
  const [listPerPage, setListPerPage] = useState(15);
  // Movimientos — filtro + paginación
  const [movPage,       setMovPage]       = useState(1);
  const [movPerPage]                      = useState(10);
  const [movFiltroTipo, setMovFiltroTipo] = useState('');
  // Filtro por producto: la lista general trae solo los últimos 200
  // movimientos MEZCLADOS entre todos los productos — insuficiente para ver
  // el historial completo de uno solo si hay mucho movimiento. Al filtrar
  // se pide directo al backend con ese productoId (soportado desde antes,
  // solo no estaba expuesto en esta UI).
  const [movFiltroProducto, setMovFiltroProducto] = useState(null); // { id, nombre } | null
  const [movimientosProducto, setMovimientosProducto] = useState(null); // null = sin filtro activo
  const [cargandoMovProducto, setCargandoMovProducto] = useState(false);
  const busquedaInicial = useRef(busqueda);

  const inventarioActivo = Boolean(sistema?.inventarioHabilitado);

  const cargar = useCallback(async ({ busquedaActual = '' } = {}) => {
    setCargando(true);
    try {
      const consultas = [
        api.get('/productos', { params: { busqueda: busquedaActual, limit: 200 } }),
        api.get('/productos/resumen'),
      ];

      if (inventarioActivo) {
        // El mismo cuadro "Buscar por código o nombre" de arriba también
        // filtra esta lista — antes solo afectaba Catálogo/Lista, dando la
        // impresión de que "Actualizar" no hacía nada en Movimientos.
        consultas.push(api.get('/inventario/movimientos', { params: { limit: 200, busqueda: busquedaActual || undefined } }));
      }

      const [productosRes, resumenRes, movimientosRes] = await Promise.all(consultas);
      setProductos(productosRes.data?.data || []);
      setResumen(resumenRes.data?.data || null);
      setMovimientos(movimientosRes?.data?.data || []);
      // Una búsqueda general nueva tiene prioridad sobre el filtro de "ver
      // historial completo de un producto" (si había uno activo, quedaría
      // mostrando datos viejos e ignorando la búsqueda recién hecha).
      if (busquedaActual) { setMovFiltroProducto(null); setMovimientosProducto(null); }
    } catch (error) {
      toast.error(error.response?.data?.mensaje || error.response?.data?.error || 'No se pudo cargar productos');
    } finally {
      setCargando(false);
    }
  }, [inventarioActivo]);

  useEffect(() => {
    cargar({ busquedaActual: busquedaInicial.current });
  }, [cargar]);

  const productosInventariables = useMemo(
    () => productos.filter((item) => item.inventariable),
    [productos],
  );

  const limpiarForm = () => setForm(FORM_INICIAL);

  const editarProducto = (producto) => {
    setForm({
      id: producto.id,
      codigoPrincipal: producto.codigoPrincipal || '',
      codigoAuxiliar: producto.codigoAuxiliar || '',
      nombre: producto.nombre || '',
      precioUnitario: producto.precioUnitario,
      costoUnitario: producto.costoUnitario,
      tarifaIva: producto.tarifaIva ?? 15,
      unidadMedida: producto.unidadMedida || 'UND',
      inventariable: Boolean(producto.inventariable),
      stockActual: producto.stockActual ?? '0',
      stockMinimo: producto.stockMinimo ?? '0',
      infoAdicional: producto.infoAdicional || '',
      activo: Boolean(producto.activo),
      categoriaMenu: producto.categoriaMenu || '',
      descripcionMenu: producto.descripcionMenu || '',
      imagenMenuUrl: producto.imagenMenuUrl || '',
      visibleEnMenu: Boolean(producto.visibleEnMenu),
      ordenMenu: producto.ordenMenu ?? 0,
    });
    setModalProducto(true);
  };

  const guardarProducto = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const payload = {
        ...form,
        precioUnitario: Number(form.precioUnitario || 0),
        costoUnitario: Number(form.costoUnitario || 0),
        stockActual: Number(form.stockActual || 0),
        stockMinimo: Number(form.stockMinimo || 0),
      };

      if (form.id) {
        await api.put(`/productos/${form.id}`, payload);
        toast.success('Producto actualizado');
      } else {
        await api.post('/productos', payload);
        toast.success('Producto creado');
      }

      limpiarForm();
      setModalProducto(false);
      await cargar({ busquedaActual: busqueda });
    } catch (error) {
      toast.error(error.response?.data?.mensaje || error.response?.data?.error || 'No se pudo guardar el producto');
    } finally {
      setGuardando(false);
    }
  };

  const eliminarProducto = async (id) => {
    if (!window.confirm('¿Deseas eliminar este producto?')) return;
    try {
      await api.delete(`/productos/${id}`);
      toast.success('Producto eliminado');
      await cargar({ busquedaActual: busqueda });
    } catch (error) {
      toast.error(error.response?.data?.mensaje || error.response?.data?.error || 'No se pudo eliminar');
    }
  };

  const registrarMovimiento = async (e) => {
    e.preventDefault();
    setGuardandoMovimiento(true);
    try {
      await api.post('/inventario/movimientos', {
        ...movimientoForm,
        cantidad: Number(movimientoForm.cantidad || 0),
        costoUnitario: movimientoForm.costoUnitario === '' ? undefined : Number(movimientoForm.costoUnitario),
      });
      toast.success('Movimiento de inventario registrado');
      setMovimientoForm(MOVIMIENTO_INICIAL);
      setModalMovimiento(false);
      await cargar({ busquedaActual: busqueda });
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo registrar el movimiento');
    } finally {
      setGuardandoMovimiento(false);
    }
  };

  const eliminarTodoInventario = async () => {
    setEliminandoInv(true);
    try {
      const res = await api.post('/inventario/eliminar-todo', { eliminarProductos: eliminarProductosInv });
      toast.success(res.data?.mensaje || 'Inventario eliminado');
      setModalEliminarInv(false);
      setEliminarProductosInv(false);
      await cargar({ busquedaActual: busqueda });
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo eliminar el inventario');
    } finally {
      setEliminandoInv(false);
    }
  };

  const filtrarMovimientosPorProducto = async (producto) => {
    setMovFiltroProducto(producto);
    setMovPage(1);
    if (!producto) { setMovimientosProducto(null); return; }
    setCargandoMovProducto(true);
    try {
      const res = await api.get('/inventario/movimientos', { params: { productoId: producto.id, limit: 500 } });
      setMovimientosProducto(res.data?.data || []);
    } catch {
      toast.error('No se pudo cargar el historial de este producto');
      setMovimientosProducto([]);
    } finally {
      setCargandoMovProducto(false);
    }
  };

  const exportarMovimientosCsv = async () => {
    setExportandoInv(true);
    try {
      const fecha = new Date().toISOString().slice(0, 10);
      await descargarCsv(api, '/inventario/movimientos/exportar/csv', {}, `inventario-movimientos-${fecha}.csv`);
      toast.success('CSV exportado correctamente');
    } catch {
      toast.error('No se pudo exportar el CSV de inventario');
    } finally {
      setExportandoInv(false);
    }
  };

  const exportarInventarioExcel = async () => {
    setExportandoInvExcel(true);
    try {
      const res = await api.get('/productos/exportar/excel', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      const fecha = new Date().toISOString().slice(0, 10);
      link.setAttribute('download', `aela-inventario-${fecha}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Inventario exportado correctamente');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo exportar el inventario');
    } finally {
      setExportandoInvExcel(false);
    }
  };

  const descargarPlantilla = async () => {
    try {
      const res = await api.get('/productos/importacion/plantilla', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'aela-plantilla-productos.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo descargar la plantilla');
    }
  };

  const ejecutarImportacionArchivo = async (endpoint, archivo, origenLabel) => {
    if (!archivo) {
      toast.error(`Selecciona un archivo ${origenLabel}`);
      return;
    }

    setImportando(true);
    try {
      const formData = new FormData();
      formData.append('archivo', archivo);
      formData.append('registrarEntradaInventario', String(registrarEntradaInventario));
      if (margenUtilidad !== '') formData.append('margenUtilidad', String(Number(margenUtilidad) || 0));
      const res = await api.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResultadoImportacion(res.data?.data || null);
      toast.success(res.data?.mensaje || 'Importación completada');
      await cargar({ busquedaActual: busqueda });
      setTab('lista');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || `No se pudo importar el archivo ${origenLabel}`);
    } finally {
      setImportando(false);
    }
  };

  const importarDesdeExcel = async () => ejecutarImportacionArchivo('/productos/importacion/excel', archivoExcel, 'Excel');
  const importarDesdeXml = async () => ejecutarImportacionArchivo('/productos/importacion/xml', archivoXml, 'XML');

  const importarDesdeAutorizacion = async () => {
    if (!claveAcceso.trim()) {
      toast.error('Ingresa la clave de acceso o número de autorización');
      return;
    }

    setImportando(true);
    try {
      const res = await api.post('/productos/importacion/autorizacion', {
        claveAcceso: claveAcceso.trim(),
        registrarEntradaInventario,
        margenUtilidad: Number(margenUtilidad) || 0,
      });
      setResultadoImportacion(res.data?.data || null);
      toast.success(res.data?.mensaje || 'Importación desde autorización completada');
      await cargar({ busquedaActual: busqueda });
      setTab('lista');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo importar desde la autorización del SRI');
    } finally {
      setImportando(false);
    }
  };

  // Datos derivados para lista paginada
  const productosPaginados = useMemo(() => {
    const inicio = (listPage - 1) * listPerPage;
    return productos.slice(inicio, inicio + listPerPage);
  }, [productos, listPage, listPerPage]);
  const listTotalPages = Math.ceil(productos.length / listPerPage);

  // Datos derivados para movimientos filtrados + paginados
  const movFiltrados = useMemo(() => {
    const base = movFiltroProducto ? (movimientosProducto || []) : movimientos;
    if (!movFiltroTipo) return base;
    return base.filter((m) => m.tipo === movFiltroTipo);
  }, [movimientos, movimientosProducto, movFiltroProducto, movFiltroTipo]);
  const movTotalPages = Math.ceil(movFiltrados.length / movPerPage);
  const movEnPagina   = movFiltrados.slice((movPage - 1) * movPerPage, movPage * movPerPage);

  return (
    <div className="prod-page">
      <div className="prod-header">
        <div>
          <h1>Productos e Inventario</h1>
          <p>Catálogo comercial, control de stock y movimientos manuales para la operación diaria.</p>
        </div>
        <div className="prod-header-actions">
          <input
            className="prod-search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código o nombre"
          />
          <button className="btn-secondary" onClick={() => cargar({ busquedaActual: busqueda })}>Actualizar</button>
        </div>
      </div>

      <div className="prod-tabs">
        <button className={`prod-tab ${tab === 'catalogo' ? 'active' : ''}`} onClick={() => setTab('catalogo')}>
          Catálogo
        </button>
        <button className={`prod-tab ${tab === 'lista' ? 'active' : ''}`} onClick={() => setTab('lista')}>
          Lista
        </button>
        <button className={`prod-tab ${tab === 'importacion' ? 'active' : ''}`} onClick={() => setTab('importacion')}>
          Importación
        </button>
        {inventarioActivo && (
          <button className={`prod-tab ${tab === 'inventario' ? 'active' : ''}`} onClick={() => setTab('inventario')}>
            Inventario
          </button>
        )}
      </div>

      {resumen && (
        <div className="prod-kpis">
          <div className="prod-kpi"><span>Total productos</span><strong>{resumen.total || 0}</strong></div>
          <div className="prod-kpi"><span>Inventariables</span><strong>{resumen.inventariables || 0}</strong></div>
          {inventarioActivo && <div className="prod-kpi"><span>Stock bajo</span><strong>{resumen.stockBajo || 0}</strong></div>}
          {inventarioActivo && <div className="prod-kpi"><span>Sin stock</span><strong>{resumen.sinStock || 0}</strong></div>}
        </div>
      )}

      {tab === 'catalogo' && (
        <section className="prod-card">
          <div className="prod-section-head">
            <h2>Productos recientes</h2>
            <button className="btn-primary" onClick={() => { limpiarForm(); setModalProducto(true); }}>
              + Nuevo producto
            </button>
          </div>
          <div className="prod-mini-list">
            {productos.slice(0, 12).map((producto) => (
              <button key={producto.id} className="prod-mini-item" onClick={() => editarProducto(producto)}>
                <strong>{producto.codigoPrincipal}</strong>
                <span>{producto.nombre}</span>
                <small>${Number(producto.precioUnitario || 0).toFixed(2)}</small>
              </button>
            ))}
            {productos.length === 0 && <div className="prod-empty">No hay productos registrados.</div>}
          </div>
        </section>
      )}

      {tab === 'lista' && (
        <section className="prod-card">
          <div className="prod-section-head">
            <h2>Listado completo <span className="prod-count">({productos.length})</span></h2>
            <div className="prod-pag-controls">
              <label className="prod-perpage-label">
                Mostrar
                <select value={listPerPage} onChange={(e) => { setListPerPage(Number(e.target.value)); setListPage(1); }}>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={9999}>Todos</option>
                </select>
              </label>
            </div>
          </div>
          {cargando ? (
            <div className="prod-empty">Cargando productos...</div>
          ) : (
            <>
              <div className="prod-table-wrap">
                <table className="prod-table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nombre</th>
                      <th>Precio</th>
                      {inventarioActivo && <th className="text-right">Stock</th>}
                      <th>IVA</th>
                      <th>Estado</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {productosPaginados.map((producto) => (
                      <tr key={producto.id}>
                        <td>{producto.codigoPrincipal}</td>
                        <td>
                          <div className="prod-name">{producto.nombre}</div>
                          {producto.codigoAuxiliar && <small style={{ color: '#64748b', fontSize: '.8rem' }}>{producto.codigoAuxiliar}</small>}
                        </td>
                        <td>${Number(producto.precioUnitario || 0).toFixed(2)}</td>
                        {inventarioActivo && (
                          <td className="text-right" style={{ color: Number(producto.stockActual || 0) < 0 ? '#ef4444' : Number(producto.stockActual || 0) === 0 ? '#f59e0b' : undefined }}>
                            {producto.inventariable ? Number(producto.stockActual || 0).toFixed(2) : '—'}
                          </td>
                        )}
                        <td>{producto.tarifaIva}%</td>
                        <td><span style={{ color: producto.activo ? '#16a34a' : '#94a3b8', fontSize: '.82rem', fontWeight: 600 }}>{producto.activo ? 'Activo' : 'Inactivo'}</span></td>
                        <td className="prod-table-actions">
                          <div className="tbl-acciones">
                            <button className="btn-icon ic-editar" title="Editar" onClick={() => editarProducto(producto)}><IcEditar/></button>
                            <button className="btn-icon ic-eliminar" title="Eliminar" onClick={() => eliminarProducto(producto.id)}><IcEliminar/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {productos.length === 0 && (
                      <tr><td colSpan={inventarioActivo ? 7 : 6} className="prod-empty">No hay productos para mostrar.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {listTotalPages > 1 && (
                <div className="prod-pagination">
                  <button className="btn-secondary" disabled={listPage <= 1} onClick={() => setListPage((p) => p - 1)}>← Ant.</button>
                  <span className="prod-pag-info">Pág. <strong>{listPage}</strong> / <strong>{listTotalPages}</strong> — {productos.length} productos</span>
                  <button className="btn-secondary" disabled={listPage >= listTotalPages} onClick={() => setListPage((p) => p + 1)}>Sig. →</button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'inventario' && inventarioActivo && (
        <section className="prod-card">
          <div className="prod-section-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Movimientos <span className="prod-count">({movFiltrados.length})</span></h2>
              <select className="prod-filtro-select" value={movFiltroTipo}
                onChange={(e) => { setMovFiltroTipo(e.target.value); setMovPage(1); }}>
                <option value="">Todos los tipos</option>
                <option value="ENTRADA">Entradas</option>
                <option value="SALIDA">Salidas</option>
                <option value="AJUSTE_POSITIVO">Ajuste +</option>
                <option value="AJUSTE_NEGATIVO">Ajuste −</option>
                <option value="VENTA_FACTURA">Venta factura</option>
                <option value="VENTA_NOTA">Venta nota</option>
              </select>
              {movFiltroProducto && (
                <span className="prod-filtro-chip">
                  Producto: <strong>{movFiltroProducto.nombre}</strong> — historial completo
                  <button type="button" className="prod-filtro-chip-x" onClick={() => filtrarMovimientosPorProducto(null)} title="Quitar filtro">✕</button>
                </span>
              )}
              {!movFiltroProducto && (
                <span style={{ fontSize: '.78rem', color: '#64748b' }}>
                  Clic en un producto de la lista para ver su historial completo
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button className="btn-secondary" onClick={exportarMovimientosCsv}
                disabled={exportandoInv || movimientos.length === 0}>
                {exportandoInv ? 'Exportando…' : '⬇ CSV movimientos'}
              </button>
              <button className="btn-secondary" onClick={exportarInventarioExcel} disabled={exportandoInvExcel}>
                {exportandoInvExcel ? 'Exportando…' : '⬇ Exportar inventario (Excel)'}
              </button>
              <button className="btn-secondary" onClick={() => setTab('importacion')}>
                📤 Actualizar por plantilla Excel
              </button>
              <button className="btn-danger" onClick={() => setModalEliminarInv(true)}>
                🗑 Eliminar todo el inventario
              </button>
              <button className="btn-primary" onClick={() => { setMovimientoForm(MOVIMIENTO_INICIAL); setModalMovimiento(true); }}>
                + Registrar movimiento
              </button>
            </div>
          </div>
          {cargandoMovProducto && <p style={{ color: '#64748b', fontSize: '.85rem' }}>Cargando historial del producto…</p>}
          <div className="prod-table-wrap">
            <table className="prod-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th className="text-right">Stock anterior</th>
                  <th className="text-right">Cantidad</th>
                  <th className="text-right">Stock nuevo</th>
                  <th>Referencia</th>
                </tr>
              </thead>
              <tbody>
                {movEnPagina.map((movimiento) => (
                  <tr key={movimiento.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: '.82rem' }}>{new Date(movimiento.createdAt).toLocaleString('es-EC')}</td>
                    <td>
                      {movimiento.producto?.id ? (
                        <button
                          type="button"
                          className="prod-link-btn"
                          title="Ver historial completo de este producto"
                          onClick={() => filtrarMovimientosPorProducto({ id: movimiento.producto.id, nombre: movimiento.producto.nombre })}
                        >
                          {movimiento.producto.nombre}
                        </button>
                      ) : (movimiento.producto?.nombre || '—')}
                    </td>
                    <td><span className="prod-tipo-chip">{movimiento.tipo}</span></td>
                    <td className="text-right">{Number(movimiento.stockAnterior || 0).toFixed(2)}</td>
                    <td className="text-right">{Number(movimiento.cantidad || 0).toFixed(2)}</td>
                    <td className="text-right">{Number(movimiento.stockNuevo || 0).toFixed(2)}</td>
                    <td style={{ fontSize: '.8rem', color: '#64748b' }}>{movimiento.referencia || '—'}</td>
                  </tr>
                ))}
                {movFiltrados.length === 0 && (
                  <tr><td colSpan="7" className="prod-empty">
                    {busqueda
                      ? `No hay movimientos de un producto que coincida con "${busqueda}".`
                      : movFiltroTipo ? 'No hay movimientos de ese tipo.' : 'No hay movimientos de inventario todavía.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          {movTotalPages > 1 && (
            <div className="prod-pagination">
              <button className="btn-secondary" disabled={movPage <= 1} onClick={() => setMovPage((p) => p - 1)}>← Ant.</button>
              <span className="prod-pag-info">Pág. <strong>{movPage}</strong> / <strong>{movTotalPages}</strong> — {movFiltrados.length} movimientos</span>
              <button className="btn-secondary" disabled={movPage >= movTotalPages} onClick={() => setMovPage((p) => p + 1)}>Sig. →</button>
            </div>
          )}
        </section>
      )}

      {tab === 'importacion' && (
        <div className="prod-import-stack-outer">
          <section className="prod-card">
            <h2>Importación masiva</h2>
            <div className="prod-import-stack">
              <div className="prod-import-box">
                <h3>1. Plantilla Excel</h3>
                <p>Descarga una plantilla lista para cargar productos desde otro sistema o desde un archivo propio.</p>
                <button type="button" className="btn-secondary" onClick={descargarPlantilla}>
                  Descargar plantilla Excel
                </button>
              </div>

              <div className="prod-import-box">
                <h3>2. Importar desde Excel</h3>
                <p>Soporta columnas comunes como código, nombre, precio, costo, IVA, stock y producto inventariable.</p>
                <p style={{ color: '#64748b', fontSize: '.82rem' }}>
                  Vuelve a subir la misma plantilla cuando quieras actualizar precios, costos o stock: los productos se
                  emparejan por <strong>código</strong> y se actualizan sin duplicarse — los que no aparecen en el
                  archivo quedan intactos.
                </p>
                <DropZone
                  accept=".xlsx,.xls,.csv"
                  icon="📊"
                  label="Arrastra o selecciona el archivo Excel"
                  sublabel="Acepta .xlsx  .xls  .csv"
                  files={archivoExcel ? [archivoExcel] : []}
                  onChange={([f]) => setArchivoExcel(f || null)}
                />
                <button type="button" className="btn-primary" onClick={importarDesdeExcel} disabled={importando}>
                  {importando ? 'Importando...' : 'Importar Excel'}
                </button>
              </div>

              <div className="prod-import-box">
                <h3>3. Importar desde XML de compra</h3>
                <p>Carga el XML de una factura de compra y AELA tomará los detalles para crear o actualizar productos.</p>
                <p><strong>El precio del XML será el costo de compra.</strong> Define el % de utilidad para calcular el precio de venta automáticamente.</p>
                <DropZone
                  accept=".xml,text/xml,application/xml"
                  icon="📄"
                  label="Arrastra o selecciona el XML de compra"
                  sublabel="Factura de compra .xml"
                  files={archivoXml ? [archivoXml] : []}
                  onChange={([f]) => setArchivoXml(f || null)}
                />
                <button type="button" className="btn-primary" onClick={importarDesdeXml} disabled={importando}>
                  {importando ? 'Importando...' : 'Importar XML'}
                </button>
              </div>

              <div className="prod-import-box">
                <h3>4. Importar desde autorización SRI</h3>
                <p>Pega la clave de acceso o número de autorización del comprobante y AELA intentará recuperar el XML autorizado.</p>
                <input
                  value={claveAcceso}
                  onChange={(e) => setClaveAcceso(e.target.value)}
                  placeholder="Clave de acceso / número de autorización"
                />
                <button type="button" className="btn-primary" onClick={importarDesdeAutorizacion} disabled={importando}>
                  {importando ? 'Consultando...' : 'Importar desde SRI'}
                </button>
              </div>

              <div className="prod-import-box">
                <h3>⚙️ Configuración de precios (XML / SRI)</h3>
                <p>Aplica a importaciones desde XML y desde autorización SRI.</p>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span>% Utilidad (margen sobre costo)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number" min="0" step="0.5" max="999"
                      value={margenUtilidad}
                      onChange={(e) => setMargenUtilidad(e.target.value)}
                      placeholder="Ej: 30"
                      style={{ width: '100px' }}
                    />
                    <span style={{ color: '#666', fontSize: '0.85em' }}>
                      {margenUtilidad !== '' && Number(margenUtilidad) > 0
                        ? `Precio venta = costo × ${(1 + Number(margenUtilidad) / 100).toFixed(4)}`
                        : 'Dejar vacío o 0 para no calcular precio de venta'}
                    </span>
                  </div>
                </label>
              </div>

              <label className="prod-check full">
                <input
                  type="checkbox"
                  checked={registrarEntradaInventario}
                  onChange={(e) => setRegistrarEntradaInventario(e.target.checked)}
                />
                <span>Registrar también la entrada de inventario usando las cantidades importadas</span>
              </label>
            </div>
          </section>

          <section className="prod-card">
            <h2>Resultado de importación</h2>
            {resultadoImportacion ? (() => {
              const todosItems = resultadoImportacion.items || [];
              const LIMITE_IMP = 15;
              const [verTodosImp, setVerTodosImp] = [false, () => {}]; // placeholder — usamos estado inline
              const itemsVisibles = todosItems.slice(0, LIMITE_IMP);
              const hayMas = todosItems.length > LIMITE_IMP;
              return (
                <div className="prod-mini-list">
                  <div className="prod-import-summary">
                    <div><span>Creados</span><strong>{resultadoImportacion.creados || 0}</strong></div>
                    <div><span>Actualizados</span><strong>{resultadoImportacion.actualizados || 0}</strong></div>
                    <div><span>Omitidos</span><strong>{resultadoImportacion.omitidos || 0}</strong></div>
                    <div><span>Movimientos</span><strong>{resultadoImportacion.movimientos || 0}</strong></div>
                  </div>
                  {resultadoImportacion.codigosDesambiguados?.length > 0 && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '.75rem 1rem', fontSize: '.85rem' }}>
                      <strong>⚠ {resultadoImportacion.codigosDesambiguados.length} código(s) repetido(s) en el archivo con nombres distintos</strong> —
                      se les asignó un código nuevo para no perder ninguno. Verifica y corrige el código real cuando lo tengas.
                      <ul style={{ margin: '.5rem 0 0', paddingLeft: '1.2rem' }}>
                        {resultadoImportacion.codigosDesambiguados.map((c, i) => (
                          <li key={i}>
                            <code>{c.codigoOriginal}</code> → <code>{c.codigoNuevo}</code> — {c.nombre}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="prod-table-wrap">
                    <table className="prod-table">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>Nombre</th>
                          <th>Costo</th>
                          <th>PVP</th>
                          <th className="text-right">Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemsVisibles.map((item) => (
                          <tr key={item.id || item.codigoPrincipal}>
                            <td>{item.codigoPrincipal}</td>
                            <td>{item.nombre}</td>
                            <td>${Number(item.costoUnitario || 0).toFixed(2)}</td>
                            <td>{Number(item.precioUnitario || 0) > 0
                              ? `$${Number(item.precioUnitario).toFixed(2)}`
                              : <span style={{ color: '#f59e0b', fontSize: '.8rem' }}>Pendiente</span>}
                            </td>
                            <td className="text-right">{Number(item.stockActual || 0).toFixed(2)}</td>
                          </tr>
                        ))}
                        {todosItems.length === 0 && (
                          <tr><td colSpan="5" className="prod-empty">La importación no devolvió productos visibles.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {hayMas && (
                    <p style={{ fontSize: '.82rem', color: '#64748b', padding: '.5rem 0 0', textAlign: 'center' }}>
                      Mostrando {LIMITE_IMP} de {todosItems.length} productos importados. Ve a <strong>Lista</strong> para verlos todos.
                    </p>
                  )}
                </div>
              );
            })() : (
              <div className="prod-empty">
                Aquí verás el resumen de la última importación de productos desde Excel, XML o autorización del SRI.
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── MODAL PRODUCTO ── */}
      {modalProducto && (
        <div className="prod-modal-overlay">
          <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
            <div className="prod-modal-head">
              <h2>{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
              <button className="prod-modal-close" onClick={() => setModalProducto(false)}>✕</button>
            </div>
            <form className="prod-form prod-modal-body" onSubmit={guardarProducto}>
              <label>
                <span>Código principal</span>
                <input value={form.codigoPrincipal} onChange={(e) => setForm((prev) => ({ ...prev, codigoPrincipal: e.target.value }))} required />
              </label>
              <label>
                <span>Código auxiliar</span>
                <input value={form.codigoAuxiliar} onChange={(e) => setForm((prev) => ({ ...prev, codigoAuxiliar: e.target.value }))} />
              </label>
              <label className="full">
                <span>Nombre</span>
                <input value={form.nombre} onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))} required />
              </label>
              <label>
                <span>{sistema?.negocioPopular ? 'Precio de venta (incluye IVA)' : 'Precio de venta (sin IVA)'}</span>
                <input type="number" min="0" step="0.0001" placeholder="0.0000" value={form.precioUnitario} onChange={(e) => setForm((prev) => ({ ...prev, precioUnitario: e.target.value }))} required />
                {sistema?.negocioPopular && (
                  <small>Negocio Popular no desglosa IVA — este es el precio final que paga el cliente.</small>
                )}
              </label>
              <label>
                <span>Costo unitario</span>
                <input type="number" min="0" step="0.0001" placeholder="0.0000" value={form.costoUnitario} onChange={(e) => setForm((prev) => ({ ...prev, costoUnitario: e.target.value }))} />
              </label>
              <label>
                <span>IVA{sistema?.negocioPopular ? ' (referencial)' : ''}</span>
                <select value={form.tarifaIva} onChange={(e) => setForm((prev) => ({ ...prev, tarifaIva: Number(e.target.value) }))}>
                  <option value={0}>0% — Tarifa 0%</option>
                  <option value={5}>5%</option>
                  <option value={15}>15%</option>
                  <option value={6}>No Objeto de IVA</option>
                  <option value={7}>Exento de IVA</option>
                </select>
                {sistema?.negocioPopular && (
                  <small>No se cobra por separado — solo se usa si más adelante cambia de régimen.</small>
                )}
              </label>
              <label>
                <span>Unidad</span>
                <input value={form.unidadMedida} onChange={(e) => setForm((prev) => ({ ...prev, unidadMedida: e.target.value }))} />
              </label>
              <label className="full">
                <span>Información adicional</span>
                <textarea rows="2" value={form.infoAdicional} onChange={(e) => setForm((prev) => ({ ...prev, infoAdicional: e.target.value }))} />
              </label>
              <label className="prod-check full">
                <input type="checkbox" checked={form.inventariable} onChange={(e) => setForm((prev) => ({ ...prev, inventariable: e.target.checked }))} />
                <span>Este producto maneja stock</span>
              </label>
              {inventarioActivo && form.inventariable && (
                <>
                  <label>
                    <span>Stock actual</span>
                    <input type="number" step="0.001" value={form.stockActual} onChange={(e) => setForm((prev) => ({ ...prev, stockActual: e.target.value }))} />
                  </label>
                  <label>
                    <span>Stock mínimo</span>
                    <input type="number" min="0" step="0.001" value={form.stockMinimo} onChange={(e) => setForm((prev) => ({ ...prev, stockMinimo: e.target.value }))} />
                  </label>
                </>
              )}
              <label className="prod-check full">
                <input type="checkbox" checked={form.activo} onChange={(e) => setForm((prev) => ({ ...prev, activo: e.target.checked }))} />
                <span>Producto activo</span>
              </label>

              {sistema?.restauranteHabilitado && (
                <div className="prod-menu-digital full">
                  <h3>Menú Digital (QR)</h3>
                  <label className="prod-check full">
                    <input
                      type="checkbox"
                      checked={form.visibleEnMenu}
                      onChange={(e) => setForm((prev) => ({ ...prev, visibleEnMenu: e.target.checked }))}
                    />
                    <span>Mostrar este plato en el menú digital público</span>
                  </label>
                  {form.visibleEnMenu && (
                    <>
                      <label>
                        <span>Categoría</span>
                        <input
                          value={form.categoriaMenu}
                          onChange={(e) => setForm((prev) => ({ ...prev, categoriaMenu: e.target.value }))}
                          placeholder="Entradas, Platos Fuertes, Bebidas, Postres..."
                        />
                      </label>
                      <label>
                        <span>Orden dentro de la categoría</span>
                        <input
                          type="number"
                          value={form.ordenMenu}
                          onChange={(e) => setForm((prev) => ({ ...prev, ordenMenu: parseInt(e.target.value, 10) || 0 }))}
                        />
                      </label>
                      <label className="full">
                        <span>Descripción para el cliente</span>
                        <textarea
                          rows="2"
                          value={form.descripcionMenu}
                          onChange={(e) => setForm((prev) => ({ ...prev, descripcionMenu: e.target.value }))}
                          placeholder="Ej. Pollo a la plancha con arroz, ensalada y patacones"
                        />
                      </label>
                      <label className="full">
                        <span>Foto del plato</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => setForm((prev) => ({ ...prev, imagenMenuUrl: reader.result }));
                            reader.readAsDataURL(file);
                          }}
                        />
                        {form.imagenMenuUrl && (
                          <img src={form.imagenMenuUrl} alt="Vista previa" className="prod-menu-preview" />
                        )}
                      </label>
                    </>
                  )}
                </div>
              )}

              <div className="prod-actions full">
                <button type="button" className="btn-secondary" onClick={limpiarForm}>Limpiar</button>
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : form.id ? 'Actualizar producto' : 'Crear producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL ELIMINAR TODO EL INVENTARIO ── */}
      {modalEliminarInv && (
        <div className="prod-modal-overlay" onClick={() => setModalEliminarInv(false)}>
          <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
            <div className="prod-modal-head">
              <h2>Eliminar todo el inventario</h2>
              <button className="prod-modal-close" onClick={() => setModalEliminarInv(false)}>✕</button>
            </div>
            <div className="prod-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <p style={{ margin: 0 }}>
                Esta acción reinicia el stock a <strong>0</strong> de todos los productos inventariables
                {eliminarProductosInv ? ' y elimina el producto del catálogo' : ''}. Se registra un movimiento de
                ajuste por cada producto afectado para dejar rastro en el historial.
              </p>
              <label className="prod-check" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={eliminarProductosInv}
                  onChange={(e) => setEliminarProductosInv(e.target.checked)}
                  style={{ marginTop: '3px' }}
                />
                <span>
                  Eliminar también los productos del catálogo (no solo el stock) — útil si hay productos mal creados
                  o duplicados. Los productos con historial de compras vinculado no podrán borrarse; en ese caso solo
                  se reiniciará su stock a 0.
                </span>
              </label>
              <p style={{ margin: 0, color: '#ef4444', fontWeight: 600 }}>Esta acción no se puede deshacer.</p>
              <div className="prod-actions">
                <button className="btn-secondary" onClick={() => setModalEliminarInv(false)}>Cancelar</button>
                <button className="btn-danger" onClick={eliminarTodoInventario} disabled={eliminandoInv}>
                  {eliminandoInv ? 'Eliminando…' : eliminarProductosInv ? 'Eliminar productos e inventario' : 'Reiniciar stock a 0'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL MOVIMIENTO ── */}
      {modalMovimiento && (
        <div className="prod-modal-overlay" onClick={() => setModalMovimiento(false)}>
          <div className="prod-modal" onClick={(e) => e.stopPropagation()}>
            <div className="prod-modal-head">
              <h2>Registrar movimiento</h2>
              <button className="prod-modal-close" onClick={() => setModalMovimiento(false)}>✕</button>
            </div>
            <form className="prod-form prod-modal-body" onSubmit={registrarMovimiento}>
              <label className="full">
                <span>Producto</span>
                <select value={movimientoForm.productoId}
                  onChange={(e) => setMovimientoForm((prev) => ({ ...prev, productoId: e.target.value }))} required>
                  <option value="">Seleccione un producto</option>
                  {productosInventariables.map((p) => (
                    <option key={p.id} value={p.id}>{p.codigoPrincipal} — {p.nombre}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tipo</span>
                <select value={movimientoForm.tipo} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, tipo: e.target.value }))}>
                  <option value="ENTRADA">Entrada</option>
                  <option value="SALIDA">Salida</option>
                  <option value="AJUSTE_POSITIVO">Ajuste positivo</option>
                  <option value="AJUSTE_NEGATIVO">Ajuste negativo</option>
                </select>
              </label>
              <label>
                <span>Cantidad</span>
                <input type="number" min="0.001" step="0.001" value={movimientoForm.cantidad}
                  onChange={(e) => setMovimientoForm((prev) => ({ ...prev, cantidad: e.target.value }))} required />
              </label>
              <label>
                <span>Costo unitario</span>
                <input type="number" min="0" step="0.0001" value={movimientoForm.costoUnitario}
                  onChange={(e) => setMovimientoForm((prev) => ({ ...prev, costoUnitario: e.target.value }))} />
              </label>
              <label>
                <span>Referencia</span>
                <input value={movimientoForm.referencia}
                  onChange={(e) => setMovimientoForm((prev) => ({ ...prev, referencia: e.target.value }))} />
              </label>
              <label className="full">
                <span>Observación</span>
                <textarea rows="2" value={movimientoForm.observacion}
                  onChange={(e) => setMovimientoForm((prev) => ({ ...prev, observacion: e.target.value }))} />
              </label>
              <div className="prod-actions full">
                <button type="button" className="btn-secondary" onClick={() => setModalMovimiento(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardandoMovimiento}>
                  {guardandoMovimiento ? 'Registrando...' : 'Registrar movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
