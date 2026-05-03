import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
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

  return (
    <div className="proveedores-page">
      <div className="proveedores-header">
        <div>
          <h1>Proveedores</h1>
          <p>Administra tu maestro de proveedores y reutilizalo en compras con consulta opcional al SRI.</p>
        </div>
        <div className="proveedores-header-actions">
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
                      <button className="btn-sm-edit" onClick={() => abrirEditar(proveedor)}>Editar</button>
                      <button
                        className={`btn-sm-toggle ${proveedor.activo ? 'desactivar' : 'activar'}`}
                        onClick={() => toggleActivo(proveedor)}
                      >
                        {proveedor.activo ? 'Desactivar' : 'Activar'}
                      </button>
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
                              <td>{new Date(c.fechaEmision).toLocaleDateString('es-EC')}</td>
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
