import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import { IcEditar, IcActivar, IcDesactivar } from '../../utils/icons';
import './GestionProveedores.css';

const TIPOS_IDENTIFICACION = [
  { valor: '04', label: 'RUC' },
  { valor: '05', label: 'Cedula' },
  { valor: '06', label: 'Pasaporte' },
];

const FORM_INICIAL = {
  id: null,
  tipoIdentificacion: '04',
  identificacion: '',
  razonSocial: '',
  nombreComercial: '',
  direccion: '',
  ciudad: '',
  provincia: '',
  email: '',
  telefono: '',
  contactoNombre: '',
  banco: '',
  cuentaBancaria: '',
  observaciones: '',
  activo: true,
};

export default function GestionProveedores() {
  const navigate = useNavigate();
  const [proveedores, setProveedores] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroCiudad, setFiltroCiudad] = useState('');
  const [filtroProvincia, setFiltroProvincia] = useState('');
  const [form, setForm] = useState(FORM_INICIAL);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [buscandoSri, setBuscandoSri] = useState(false);
  const [page, setPage] = useState(1);
  const [historialCompras, setHistorialCompras] = useState(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const LIMIT = 50;

  // ─── Catastro SRI — búsqueda por nombre ──────────────────────────────────────
  const [catastroResultados, setCatastroResultados] = useState([]);
  const [buscandoCatastro, setBuscandoCatastro] = useState(false);
  const [mostrarCatastro, setMostrarCatastro] = useState(false);

  // ─── Clientes — búsqueda para cargar como proveedor ──────────────────────────
  const [clientesResultados, setClientesResultados] = useState([]);
  const [buscandoClientes, setBuscandoClientes] = useState(false);
  const [mostrarClientes, setMostrarClientes] = useState(false);

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await api.get('/proveedores', {
        params: { q: busqueda, ciudad: filtroCiudad || undefined, provincia: filtroProvincia || undefined, page, limit: LIMIT },
      });
      setProveedores(res.data?.data || []);
      setTotal(res.data?.total || 0);
    } catch {
      toast.error('No se pudo cargar la lista de proveedores');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(cargar, busqueda || filtroCiudad || filtroProvincia ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, filtroCiudad, filtroProvincia, page]);

  // Búsqueda en catastro SRI (6.8M contribuyentes) al escribir nombre
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 3 || /^\d+$/.test(q)) {
      setCatastroResultados([]);
      setMostrarCatastro(false);
      return;
    }
    setBuscandoCatastro(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/clientes/buscar-catastro', { params: { q, limit: 20 } });
        const data = res.data?.data || [];
        setCatastroResultados(data);
        if (data.length > 0) setMostrarCatastro(true);
      } catch {
        setCatastroResultados([]);
      } finally {
        setBuscandoCatastro(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Búsqueda en tabla clientes (reusar como proveedor)
  useEffect(() => {
    const q = busqueda.trim();
    if (q.length < 3) {
      setClientesResultados([]);
      setMostrarClientes(false);
      return;
    }
    setBuscandoClientes(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/clientes', { params: { q, limit: 10, page: 1 } });
        const data = res.data?.data || [];
        setClientesResultados(data);
        if (data.length > 0) setMostrarClientes(true);
      } catch {
        setClientesResultados([]);
      } finally {
        setBuscandoClientes(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Pre-llenar formulario desde catastro SRI
  const agregarDesdeCatastro = (c) => {
    const tipoId = c.tipoContribuyente === 'PERSONAS NATURALES' ? '05' : '04';
    setForm({
      ...FORM_INICIAL,
      tipoIdentificacion: tipoId,
      identificacion: c.ruc,
      razonSocial: c.razonSocial,
      nombreComercial: c.nombreComercial || '',
      provincia: c.provincia || '',
    });
    setMostrarCatastro(false);
    setMostrarClientes(false);
    setModalAbierto(true);
  };

  // Pre-llenar formulario desde tabla clientes
  const agregarDesdeClientes = (c) => {
    setForm({
      ...FORM_INICIAL,
      tipoIdentificacion: c.tipoIdentificacion,
      identificacion: c.identificacion,
      razonSocial: c.razonSocial,
      nombreComercial: c.nombreComercial || '',
      direccion: c.direccion || '',
      email: c.email || '',
      telefono: c.telefono || '',
    });
    setMostrarCatastro(false);
    setMostrarClientes(false);
    setModalAbierto(true);
  };

  const handleIdentificacionBlur = async () => {
    const id = form.identificacion.trim();
    if (!id || form.id) return;
    if (!/^\d{10}$/.test(id) && !/^\d{13}$/.test(id)) return;

    setBuscandoSri(true);
    try {
      const res = await api.get(`/proveedores/sri/${id}`);
      const d = res.data;

      if (d.success && d.data) {
        if (d.requiereDatosManuales) {
          toast('Identificacion valida en SRI. Completa los datos manualmente.', { icon: 'ℹ️' });
          setForm((prev) => ({
            ...prev,
            tipoIdentificacion: d.data.tipoIdentificacion || prev.tipoIdentificacion,
            identificacion: d.data.identificacion || prev.identificacion,
          }));
        } else {
          toast.success(d.fuente === 'bd' ? 'Proveedor encontrado en BD' : 'Datos cargados desde SRI');
          setForm((prev) => ({
            ...prev,
            tipoIdentificacion: d.data.tipoIdentificacion || prev.tipoIdentificacion,
            razonSocial: d.data.razonSocial || '',
            nombreComercial: d.data.nombreComercial || '',
            direccion: d.data.direccion || '',
            email: d.data.email || '',
            telefono: d.data.telefono || '',
          }));
        }
      } else if (d.servicioNoDisponible) {
        toast('SRI no disponible. Ingresa los datos manualmente.', { icon: '⚠️' });
      } else if (d.encontrado === false) {
        toast('Identificacion no encontrada en SRI.', { icon: '⚠️' });
      }
    } catch {
      // Permitir ingreso manual si falla la consulta.
    } finally {
      setBuscandoSri(false);
    }
  };

  const abrirNuevo = () => {
    setForm(FORM_INICIAL);
    setModalAbierto(true);
  };

  const abrirEditar = async (proveedor) => {
    setForm({
      id: proveedor.id,
      tipoIdentificacion: proveedor.tipoIdentificacion,
      identificacion: proveedor.identificacion,
      razonSocial: proveedor.razonSocial,
      nombreComercial: proveedor.nombreComercial || '',
      direccion: proveedor.direccion || '',
      ciudad: proveedor.ciudad || '',
      provincia: proveedor.provincia || '',
      email: proveedor.email || '',
      telefono: proveedor.telefono || '',
      contactoNombre: proveedor.contactoNombre || '',
      banco: proveedor.banco || '',
      cuentaBancaria: proveedor.cuentaBancaria || '',
      observaciones: proveedor.observaciones || '',
      activo: proveedor.activo,
    });
    setHistorialCompras(null);
    setModalAbierto(true);
    setCargandoHistorial(true);
    try {
      const res = await api.get(`/proveedores/${proveedor.id}/compras`);
      setHistorialCompras(res.data);
    } catch {
      setHistorialCompras({ data: [], totalCompras: 0, montoTotal: 0 });
    } finally {
      setCargandoHistorial(false);
    }
  };

  const cerrarModal = () => {
    setModalAbierto(false);
    setForm(FORM_INICIAL);
    setHistorialCompras(null);
  };

  const guardar = async (event) => {
    event.preventDefault();
    if (!form.tipoIdentificacion || !form.identificacion.trim() || !form.razonSocial.trim()) {
      toast.error('Tipo de identificacion, identificacion y razon social son requeridos');
      return;
    }

    setGuardando(true);
    try {
      if (form.id) {
        await api.put(`/proveedores/${form.id}`, form);
        toast.success('Proveedor actualizado');
      } else {
        await api.post('/proveedores', form);
        toast.success('Proveedor creado');
      }
      cerrarModal();
      cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'Error al guardar el proveedor');
    } finally {
      setGuardando(false);
    }
  };

  const toggleActivo = async (proveedor) => {
    try {
      await api.put(`/proveedores/${proveedor.id}`, { activo: !proveedor.activo });
      toast.success(proveedor.activo ? 'Proveedor desactivado' : 'Proveedor activado');
      cargar();
    } catch {
      toast.error('No se pudo actualizar el estado');
    }
  };

  const conCompras = proveedores.filter((p) => Number(p.comprasCount || 0) > 0).length;
  const conContacto = proveedores.filter((p) => p.email || p.telefono).length;

  // ─── Importar Excel ──────────────────────────────────────────────────────────
  const [modalImport, setModalImport] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const abrirImport = () => { setImportResult(null); setModalImport(true); };
  const cerrarImport = () => { setModalImport(false); setImportResult(null); };

  const handleImportExcel = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setImportando(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const res = await api.post('/proveedores/importar-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      if (res.data.resumen?.creados > 0) cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al importar el archivo');
    } finally {
      setImportando(false);
    }
  };

  const descargarPlantilla = async () => {
    try {
      const res = await api.get('/proveedores/plantilla-excel', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_proveedores.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  };

  return (
    <div className="proveedores-page">
      <div className="proveedores-header">
        <div>
          <h1>Proveedores</h1>
          <p>Administra tu maestro de proveedores y reutilizalo en compras con consulta opcional al SRI.</p>
        </div>
        <div className="proveedores-header-actions">
          <button className="btn-secondary" onClick={abrirImport}>Importar Excel</button>
          <button className="btn-secondary" onClick={() => navigate('/compras/nueva')}>Nueva compra</button>
          <button className="btn-primary" onClick={abrirNuevo}>Nuevo proveedor</button>
        </div>
      </div>

      <div className="proveedores-summary">
        <article className="proveedores-summary-card">
          <span>Total proveedores</span>
          <strong>{total}</strong>
        </article>
        <article className="proveedores-summary-card">
          <span>Con compras</span>
          <strong>{conCompras}</strong>
        </article>
        <article className="proveedores-summary-card">
          <span>Con contacto</span>
          <strong>{conContacto}</strong>
        </article>
      </div>

      <div className="proveedores-filtros">
        <input
          type="search"
          placeholder="Buscar por RUC, cedula o nombre..."
          value={busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setPage(1); }}
          className="proveedores-busqueda"
        />
        <input
          type="text"
          placeholder="Filtrar por ciudad..."
          value={filtroCiudad}
          onChange={(e) => { setFiltroCiudad(e.target.value); setPage(1); }}
          className="proveedores-busqueda"
          style={{ maxWidth: 180 }}
        />
        <input
          type="text"
          placeholder="Filtrar por provincia..."
          value={filtroProvincia}
          onChange={(e) => { setFiltroProvincia(e.target.value); setPage(1); }}
          className="proveedores-busqueda"
          style={{ maxWidth: 180 }}
        />
        {(filtroCiudad || filtroProvincia) && (
          <button className="btn-secondary" style={{ fontSize: '0.85rem' }}
            onClick={() => { setFiltroCiudad(''); setFiltroProvincia(''); setPage(1); }}>
            Limpiar filtros
          </button>
        )}
      </div>

      {/* CATASTRO SRI — aparece al escribir un nombre en el buscador */}
      {busqueda.trim().length >= 3 && !/^\d+$/.test(busqueda.trim()) && (
        <div className="proveedores-card" style={{ marginBottom: '10px', border: '1px solid #6366f1', borderRadius: '10px', overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                     padding: '10px 16px', background: '#eef2ff', cursor: 'pointer' }}
            onClick={() => setMostrarCatastro((v) => !v)}
          >
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#4338ca' }}>
              🗂 Catastro SRI
              {buscandoCatastro
                ? ' — buscando...'
                : catastroResultados.length > 0
                  ? ` — ${catastroResultados.length} resultados para "${busqueda.trim().toUpperCase()}"`
                  : ' — sin resultados'}
            </span>
            <span style={{ color: '#6366f1', fontSize: '0.82rem' }}>
              {mostrarCatastro ? '▲ ocultar' : '▼ ver'}
            </span>
          </div>
          {mostrarCatastro && catastroResultados.length > 0 && (
            <div className="proveedores-table-wrap">
              <table className="proveedores-table">
                <thead>
                  <tr>
                    <th>RUC</th>
                    <th>Razón Social</th>
                    <th>Tipo</th>
                    <th>Provincia</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {catastroResultados.map((c) => (
                    <tr key={c.ruc}>
                      <td><span className="tipo-badge">RUC</span> {c.ruc}</td>
                      <td>{c.razonSocial}</td>
                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {c.tipoContribuyente === 'PERSONAS NATURALES' ? 'Natural' : 'Sociedad'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.provincia || '—'}</td>
                      <td className="acciones">
                        <button className="btn-sm-edit" onClick={() => agregarDesdeCatastro(c)}>
                          + Usar como proveedor
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mostrarCatastro && !buscandoCatastro && catastroResultados.length === 0 && (
            <div className="proveedores-empty" style={{ padding: '14px' }}>
              No se encontraron contribuyentes activos en el catastro SRI.
            </div>
          )}
        </div>
      )}

      {/* CLIENTES EXISTENTES — reusar como proveedor */}
      {busqueda.trim().length >= 3 && (
        <div className="proveedores-card" style={{ marginBottom: '10px', border: '1px solid #10b981', borderRadius: '10px', overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                     padding: '10px 16px', background: '#ecfdf5', cursor: 'pointer' }}
            onClick={() => setMostrarClientes((v) => !v)}
          >
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#065f46' }}>
              👤 Clientes existentes
              {buscandoClientes
                ? ' — buscando...'
                : clientesResultados.length > 0
                  ? ` — ${clientesResultados.length} clientes con "${busqueda.trim()}"`
                  : ' — sin resultados'}
            </span>
            <span style={{ color: '#10b981', fontSize: '0.82rem' }}>
              {mostrarClientes ? '▲ ocultar' : '▼ ver'}
            </span>
          </div>
          {mostrarClientes && clientesResultados.length > 0 && (
            <div className="proveedores-table-wrap">
              <table className="proveedores-table">
                <thead>
                  <tr>
                    <th>Identificación</th>
                    <th>Razón Social</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clientesResultados.map((c) => (
                    <tr key={c.id}>
                      <td>{c.identificacion}</td>
                      <td>{c.razonSocial}</td>
                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.email || '—'}</td>
                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.telefono || '—'}</td>
                      <td className="acciones">
                        <button className="btn-sm-edit" style={{ background: '#10b981', color: '#fff', border: 'none' }}
                          onClick={() => agregarDesdeClientes(c)}>
                          + Usar como proveedor
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mostrarClientes && !buscandoClientes && clientesResultados.length === 0 && (
            <div className="proveedores-empty" style={{ padding: '14px' }}>
              No hay clientes registrados con ese nombre.
            </div>
          )}
        </div>
      )}

      <div className="proveedores-card">
        {cargando ? (
          <div className="proveedores-loading">Cargando...</div>
        ) : proveedores.length === 0 ? (
          <div className="proveedores-empty">
            {busqueda ? 'No se encontraron proveedores con ese criterio.' : 'No hay proveedores registrados. Crea el primero.'}
          </div>
        ) : (
          <div className="proveedores-table-wrap">
            <table className="proveedores-table">
              <thead>
                <tr>
                  <th>Identificacion</th>
                  <th>Razon Social</th>
                  <th>Nombre Comercial</th>
                  <th>Contacto</th>
                  <th>Compras</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {proveedores.map((proveedor) => (
                  <tr key={proveedor.id} className={!proveedor.activo ? 'row-inactivo' : ''}>
                    <td>
                      <span className="tipo-badge">
                        {TIPOS_IDENTIFICACION.find((t) => t.valor === proveedor.tipoIdentificacion)?.label || proveedor.tipoIdentificacion}
                      </span>{' '}
                      {proveedor.identificacion}
                    </td>
                    <td>{proveedor.razonSocial}</td>
                    <td>{proveedor.nombreComercial || '—'}</td>
                    <td>
                      <div className="proveedores-contacto">
                        <span>{proveedor.email || 'Sin email'}</span>
                        <span>{proveedor.telefono || 'Sin telefono'}</span>
                      </div>
                    </td>
                    <td>{proveedor.comprasCount || 0}</td>
                    <td>
                      <span className={`estado-badge ${proveedor.activo ? 'activo' : 'inactivo'}`}>
                        {proveedor.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="acciones">
                      <div className="tbl-acciones">
                        <button className="btn-icon" title="Editar proveedor" onClick={() => abrirEditar(proveedor)}><IcEditar/></button>
                        <button
                          className={`btn-icon ${proveedor.activo ? 'danger' : 'success'}`}
                          title={proveedor.activo ? 'Desactivar proveedor' : 'Activar proveedor'}
                          onClick={() => toggleActivo(proveedor)}
                        >
                          {proveedor.activo ? <IcDesactivar/> : <IcActivar/>}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > LIMIT && (
          <div className="proveedores-pagination">
            <button disabled={page === 1} onClick={() => setPage((prev) => prev - 1)}>Anterior</button>
            <span>Página {page} de {Math.ceil(total / LIMIT)}</span>
            <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((prev) => prev + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      {/* MODAL IMPORTAR EXCEL */}
      {modalImport && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '660px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Importar proveedores desde Excel</h2>
              <button className="modal-close" onClick={cerrarImport}>✕</button>
            </div>

            <div className="modal-form">
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                Columnas <strong>obligatorias</strong>: identificacion, razonSocial.
                Opcionales: nombreComercial, email, telefono, direccion, ciudad, provincia, contactoNombre, banco, cuentaBancaria, observaciones.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b', marginBottom: '2px' }}>Paso 1 — Descarga la plantilla</div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Incluye todos los campos disponibles con un ejemplo</div>
                </div>
                <button className="btn-secondary" onClick={descargarPlantilla}>
                  Descargar plantilla
                </button>
              </div>

              {!importResult ? (
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b', marginBottom: '10px' }}>Paso 2 — Sube tu archivo Excel</div>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportExcel}
                    disabled={importando}
                    style={{ display: 'block', width: '100%', cursor: 'pointer' }}
                  />
                  {importando && (
                    <p style={{ marginTop: '10px', color: '#64748b', fontSize: '0.9rem' }}>Procesando archivo...</p>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '5px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
                      ✓ Creados: {importResult.resumen.creados}
                    </span>
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '5px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
                      Omitidos: {importResult.resumen.omitidos}
                    </span>
                    {importResult.resumen.errores > 0 && (
                      <span style={{ background: '#fee2e2', color: '#991b1b', padding: '5px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
                        Errores: {importResult.resumen.errores}
                      </span>
                    )}
                  </div>
                  <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Fila</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Identificación</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Razón Social</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.resultados.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{r.fila}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.identificacion}</td>
                            <td style={{ padding: '6px 10px' }}>{r.razonSocial || '—'}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600,
                                background: r.estado === 'creado' ? '#dcfce7' : r.estado === 'error' ? '#fee2e2' : '#f1f5f9',
                                color: r.estado === 'creado' ? '#166534' : r.estado === 'error' ? '#991b1b' : '#475569',
                              }}>
                                {r.estado === 'creado' ? 'Creado' : r.estado === 'error' ? `Error: ${r.motivo}` : r.motivo || 'Omitido'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="btn-secondary" onClick={() => setImportResult(null)} style={{ marginTop: '10px' }}>
                    Importar otro archivo
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={cerrarImport}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{form.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
              <button className="modal-close" onClick={cerrarModal}>✕</button>
            </div>

            <form onSubmit={guardar} className="modal-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de identificacion</label>
                  <select
                    value={form.tipoIdentificacion}
                    onChange={(e) => setForm((prev) => ({ ...prev, tipoIdentificacion: e.target.value }))}
                    disabled={!!form.id}
                  >
                    {TIPOS_IDENTIFICACION.map((tipo) => (
                      <option key={tipo.valor} value={tipo.valor}>{tipo.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    Identificacion
                    {buscandoSri && <span className="sri-loading"> Consultando SRI...</span>}
                  </label>
                  <input
                    type="text"
                    value={form.identificacion}
                    onChange={(e) => setForm((prev) => ({ ...prev, identificacion: e.target.value }))}
                    onBlur={handleIdentificacionBlur}
                    placeholder="RUC o cedula"
                    disabled={!!form.id}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Razon Social *</label>
                <input
                  type="text"
                  value={form.razonSocial}
                  onChange={(e) => setForm((prev) => ({ ...prev, razonSocial: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>Nombre Comercial</label>
                <input
                  type="text"
                  value={form.nombreComercial}
                  onChange={(e) => setForm((prev) => ({ ...prev, nombreComercial: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Direccion</label>
                <input
                  type="text"
                  value={form.direccion}
                  onChange={(e) => setForm((prev) => ({ ...prev, direccion: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Ciudad</label>
                  <input
                    type="text"
                    value={form.ciudad}
                    onChange={(e) => setForm((prev) => ({ ...prev, ciudad: e.target.value }))}
                    placeholder="Ej: Quito"
                  />
                </div>
                <div className="form-group">
                  <label>Provincia</label>
                  <input
                    type="text"
                    value={form.provincia}
                    onChange={(e) => setForm((prev) => ({ ...prev, provincia: e.target.value }))}
                    placeholder="Ej: Pichincha"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Telefono</label>
                  <input
                    type="text"
                    value={form.telefono}
                    onChange={(e) => setForm((prev) => ({ ...prev, telefono: e.target.value }))}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Contacto (persona de contacto)</label>
                <input
                  type="text"
                  value={form.contactoNombre}
                  onChange={(e) => setForm((prev) => ({ ...prev, contactoNombre: e.target.value }))}
                  placeholder="Nombre del contacto"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Banco</label>
                  <input
                    type="text"
                    value={form.banco}
                    onChange={(e) => setForm((prev) => ({ ...prev, banco: e.target.value }))}
                    placeholder="Ej: Banco Pichincha"
                  />
                </div>
                <div className="form-group">
                  <label>Cuenta bancaria</label>
                  <input
                    type="text"
                    value={form.cuentaBancaria}
                    onChange={(e) => setForm((prev) => ({ ...prev, cuentaBancaria: e.target.value }))}
                    placeholder="Número de cuenta"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Observaciones</label>
                <textarea
                  rows={3}
                  value={form.observaciones}
                  onChange={(e) => setForm((prev) => ({ ...prev, observaciones: e.target.value }))}
                />
              </div>

              {form.id && (
                <div className="form-group form-check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.activo}
                      onChange={(e) => setForm((prev) => ({ ...prev, activo: e.target.checked }))}
                    />
                    {' '}Proveedor activo
                  </label>
                </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={cerrarModal}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear proveedor'}
                </button>
              </div>
            </form>

            {form.id && (
              <div className="prov-historial">
                <h3>Historial de compras</h3>
                {cargandoHistorial ? (
                  <p className="prov-historial-loading">Cargando historial...</p>
                ) : historialCompras ? (
                  <>
                    <div className="prov-historial-resumen">
                      <span>Total compras: <strong>{historialCompras.totalCompras}</strong></span>
                      <span>Monto total: <strong>${Number(historialCompras.montoTotal || 0).toFixed(2)}</strong></span>
                    </div>
                    {historialCompras.data?.length > 0 ? (
                      <table className="prov-historial-table">
                        <thead>
                          <tr><th>N°</th><th>Fecha</th><th>Total</th><th>Estado</th></tr>
                        </thead>
                        <tbody>
                          {historialCompras.data.map((c) => (
                            <tr key={c.id} className={c.anulada ? 'row-anulada' : ''}>
                              <td>{c.numero}</td>
                              <td>{formatFechaCorta(c.fechaEmision)}</td>
                              <td>${Number(c.importeTotal || 0).toFixed(2)}</td>
                              <td>{c.anulada ? 'Anulada' : (c.estado || 'Registrada')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="prov-historial-empty">Sin compras registradas para este proveedor.</p>
                    )}
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
