import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { descargarCsv } from '../../utils/exportCsv';
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
        consultas.push(api.get('/inventario/movimientos', { params: { limit: 25 } }));
      }

      const [productosRes, resumenRes, movimientosRes] = await Promise.all(consultas);
      setProductos(productosRes.data?.data || []);
      setResumen(resumenRes.data?.data || null);
      setMovimientos(movimientosRes?.data?.data || []);
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
    });
    setTab('catalogo');
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
      await cargar({ busquedaActual: busqueda });
      setTab('inventario');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo registrar el movimiento');
    } finally {
      setGuardandoMovimiento(false);
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
        <div className="prod-grid">
          <section className="prod-card">
            <h2>{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
            <form className="prod-form" onSubmit={guardarProducto}>
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
                <span>Precio de venta</span>
                <input type="number" min="0" step="0.01" value={form.precioUnitario} onChange={(e) => setForm((prev) => ({ ...prev, precioUnitario: e.target.value }))} required />
              </label>
              <label>
                <span>Costo unitario</span>
                <input type="number" min="0" step="0.01" value={form.costoUnitario} onChange={(e) => setForm((prev) => ({ ...prev, costoUnitario: e.target.value }))} />
              </label>
              <label>
                <span>IVA</span>
                <select value={form.tarifaIva} onChange={(e) => setForm((prev) => ({ ...prev, tarifaIva: Number(e.target.value) }))}>
                  <option value={0}>0% — Aplica tarifa 0%</option>
                  <option value={5}>5%</option>
                  <option value={15}>15%</option>
                  <option value={6}>No Objeto de IVA (transporte, salud, educación)</option>
                  <option value={7}>Exento de IVA</option>
                </select>
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
                    <input type="number" min="0" step="0.001" value={form.stockActual} onChange={(e) => setForm((prev) => ({ ...prev, stockActual: e.target.value }))} />
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

              <div className="prod-actions full">
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : form.id ? 'Actualizar producto' : 'Crear producto'}
                </button>
                <button type="button" className="btn-secondary" onClick={limpiarForm}>Limpiar</button>
              </div>
            </form>
          </section>

          <section className="prod-card">
            <h2>Productos recientes</h2>
            <div className="prod-mini-list">
              {productos.slice(0, 10).map((producto) => (
                <button key={producto.id} className="prod-mini-item" onClick={() => editarProducto(producto)}>
                  <strong>{producto.codigoPrincipal}</strong>
                  <span>{producto.nombre}</span>
                  <small>${Number(producto.precioUnitario || 0).toFixed(2)}</small>
                </button>
              ))}
              {productos.length === 0 && <div className="prod-empty">No hay productos registrados.</div>}
            </div>
          </section>
        </div>
      )}

      {tab === 'lista' && (
        <section className="prod-card">
          <h2>Listado completo</h2>
          {cargando ? (
            <div className="prod-empty">Cargando productos...</div>
          ) : (
            <div className="prod-table-wrap">
              <table className="prod-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Precio</th>
                    {inventarioActivo && <th>Stock</th>}
                    <th>IVA</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((producto) => (
                    <tr key={producto.id}>
                      <td>{producto.codigoPrincipal}</td>
                      <td>
                        <div className="prod-name">{producto.nombre}</div>
                        {producto.codigoAuxiliar && <small>{producto.codigoAuxiliar}</small>}
                      </td>
                      <td>${Number(producto.precioUnitario || 0).toFixed(2)}</td>
                      {inventarioActivo && <td>{producto.inventariable ? Number(producto.stockActual || 0).toFixed(3) : 'N/A'}</td>}
                      <td>{producto.tarifaIva}%</td>
                      <td>{producto.activo ? 'Activo' : 'Inactivo'}</td>
                      <td className="prod-table-actions">
                        <button className="btn-link" onClick={() => editarProducto(producto)}>Editar</button>
                        <button className="btn-link danger" onClick={() => eliminarProducto(producto.id)}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
                  {productos.length === 0 && (
                    <tr><td colSpan={inventarioActivo ? 7 : 6} className="prod-empty">No hay productos para mostrar.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'inventario' && inventarioActivo && (
        <div className="prod-grid">
          <section className="prod-card">
            <h2>Registrar movimiento</h2>
            <form className="prod-form" onSubmit={registrarMovimiento}>
              <label className="full">
                <span>Producto</span>
                <select
                  value={movimientoForm.productoId}
                  onChange={(e) => setMovimientoForm((prev) => ({ ...prev, productoId: e.target.value }))}
                  required
                >
                  <option value="">Seleccione un producto</option>
                  {productosInventariables.map((producto) => (
                    <option key={producto.id} value={producto.id}>
                      {producto.codigoPrincipal} - {producto.nombre}
                    </option>
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
                <input type="number" min="0.001" step="0.001" value={movimientoForm.cantidad} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, cantidad: e.target.value }))} required />
              </label>
              <label>
                <span>Costo unitario</span>
                <input type="number" min="0" step="0.01" value={movimientoForm.costoUnitario} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, costoUnitario: e.target.value }))} />
              </label>
              <label>
                <span>Referencia</span>
                <input value={movimientoForm.referencia} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, referencia: e.target.value }))} />
              </label>
              <label className="full">
                <span>Observación</span>
                <textarea rows="2" value={movimientoForm.observacion} onChange={(e) => setMovimientoForm((prev) => ({ ...prev, observacion: e.target.value }))} />
              </label>
              <div className="prod-actions full">
                <button type="submit" className="btn-primary" disabled={guardandoMovimiento}>
                  {guardandoMovimiento ? 'Registrando...' : 'Registrar movimiento'}
                </button>
              </div>
            </form>
          </section>

          <section className="prod-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Últimos movimientos</h2>
              <button
                className="btn-secondary"
                onClick={exportarMovimientosCsv}
                disabled={exportandoInv || movimientos.length === 0}
                style={{ fontSize: '0.88rem' }}
              >
                {exportandoInv ? 'Exportando…' : '⬇ CSV'}
              </button>
            </div>
            <div className="prod-table-wrap">
              <table className="prod-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th>Cantidad</th>
                    <th>Stock nuevo</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((movimiento) => (
                    <tr key={movimiento.id}>
                      <td>{new Date(movimiento.createdAt).toLocaleString('es-EC')}</td>
                      <td>{movimiento.producto?.nombre || 'Producto'}</td>
                      <td>{movimiento.tipo}</td>
                      <td>{Number(movimiento.cantidad || 0).toFixed(3)}</td>
                      <td>{Number(movimiento.stockNuevo || 0).toFixed(3)}</td>
                    </tr>
                  ))}
                  {movimientos.length === 0 && (
                    <tr><td colSpan="5" className="prod-empty">No hay movimientos de inventario todavía.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === 'importacion' && (
        <div className="prod-grid">
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
                <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setArchivoExcel(e.target.files?.[0] || null)} />
                <button type="button" className="btn-primary" onClick={importarDesdeExcel} disabled={importando}>
                  {importando ? 'Importando...' : 'Importar Excel'}
                </button>
              </div>

              <div className="prod-import-box">
                <h3>3. Importar desde XML de compra</h3>
                <p>Carga el XML de una factura de compra y AELA tomará los detalles para crear o actualizar productos.</p>
                <p><strong>El precio del XML será el costo de compra.</strong> Define el % de utilidad para calcular el precio de venta automáticamente.</p>
                <input type="file" accept=".xml,text/xml,application/xml" onChange={(e) => setArchivoXml(e.target.files?.[0] || null)} />
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
            {resultadoImportacion ? (
              <div className="prod-mini-list">
                <div className="prod-import-summary">
                  <div><span>Creados</span><strong>{resultadoImportacion.creados || 0}</strong></div>
                  <div><span>Actualizados</span><strong>{resultadoImportacion.actualizados || 0}</strong></div>
                  <div><span>Omitidos</span><strong>{resultadoImportacion.omitidos || 0}</strong></div>
                  <div><span>Movimientos</span><strong>{resultadoImportacion.movimientos || 0}</strong></div>
                </div>
                <div className="prod-table-wrap">
                  <table className="prod-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Nombre</th>
                        <th>Costo compra</th>
                        <th>Precio venta</th>
                        <th>Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resultadoImportacion.items || []).map((item) => (
                        <tr key={item.id || item.codigoPrincipal}>
                          <td>{item.codigoPrincipal}</td>
                          <td>{item.nombre}</td>
                          <td>${Number(item.costoUnitario || 0).toFixed(4)}</td>
                          <td>
                            {Number(item.precioUnitario || 0) > 0
                              ? `$${Number(item.precioUnitario).toFixed(4)}`
                              : <span style={{ color: '#f59e0b' }}>Pendiente</span>}
                          </td>
                          <td>{Number(item.stockActual || 0).toFixed(3)}</td>
                        </tr>
                      ))}
                      {(resultadoImportacion.items || []).length === 0 && (
                        <tr><td colSpan="5" className="prod-empty">La importación no devolvió productos visibles.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="prod-empty">
                Aquí verás el resumen de la última importación de productos desde Excel, XML o autorización del SRI.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
