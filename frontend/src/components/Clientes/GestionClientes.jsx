// ====================================
// GESTIÓN DE CLIENTES — AELA
// ====================================

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './GestionClientes.css';

const TIPOS_IDENTIFICACION = [
  { valor: '04', label: 'RUC' },
  { valor: '05', label: 'Cédula' },
  { valor: '06', label: 'Pasaporte' },
  { valor: '07', label: 'Consumidor Final' },
];

const FORM_INICIAL = {
  id: null,
  tipoIdentificacion: '05',
  identificacion: '',
  razonSocial: '',
  nombreComercial: '',
  direccion: '',
  email: '',
  telefono: '',
  activo: true,
};

export default function GestionClientes() {
  const [clientes, setClientes] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState(FORM_INICIAL);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [buscandoSri, setBuscandoSri] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await api.get('/clientes', { params: { q: busqueda, page, limit: LIMIT } });
      setClientes(res.data?.data || []);
      setTotal(res.data?.total || 0);
    } catch {
      toast.error('No se pudo cargar la lista de clientes');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, page]);

  // ─── SRI lookup al salir del campo identificación ───────────────────────────
  const handleIdentificacionBlur = async () => {
    const id = form.identificacion.trim();
    if (!id || form.id) return; // No buscar al editar
    if (!/^\d{10}$/.test(id) && !/^\d{13}$/.test(id)) return;

    setBuscandoSri(true);
    try {
      const res = await api.get(`/clientes/sri/${id}`);
      const d = res.data;

      if (d.success && d.data) {
        if (d.requiereDatosManuales) {
          toast('Identificación válida en SRI. Completa los datos manualmente.', { icon: 'ℹ️' });
          setForm((prev) => ({ ...prev, ...d.data }));
        } else {
          toast.success(d.fuente === 'bd' ? 'Cliente encontrado en BD' : 'Datos cargados desde SRI');
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
        toast('Identificación no encontrada en SRI.', { icon: '⚠️' });
      }
    } catch {
      // Silencioso — el usuario puede ingresar datos manualmente
    } finally {
      setBuscandoSri(false);
    }
  };

  // ─── Abrir modal (nuevo o editar) ────────────────────────────────────────────
  const abrirNuevo = () => {
    setForm(FORM_INICIAL);
    setModalAbierto(true);
  };

  const abrirEditar = (cliente) => {
    setForm({
      id: cliente.id,
      tipoIdentificacion: cliente.tipoIdentificacion,
      identificacion: cliente.identificacion,
      razonSocial: cliente.razonSocial,
      nombreComercial: cliente.nombreComercial || '',
      direccion: cliente.direccion || '',
      email: cliente.email || '',
      telefono: cliente.telefono || '',
      activo: cliente.activo,
    });
    setModalAbierto(true);
  };

  const cerrarModal = () => {
    setModalAbierto(false);
    setForm(FORM_INICIAL);
  };

  // ─── Guardar (crear o actualizar) ────────────────────────────────────────────
  const guardar = async (e) => {
    e.preventDefault();
    if (!form.tipoIdentificacion || !form.identificacion.trim() || !form.razonSocial.trim()) {
      toast.error('Tipo de identificación, identificación y razón social son requeridos');
      return;
    }

    setGuardando(true);
    try {
      if (form.id) {
        await api.put(`/clientes/${form.id}`, form);
        toast.success('Cliente actualizado');
      } else {
        await api.post('/clientes', form);
        toast.success('Cliente creado');
      }
      cerrarModal();
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar el cliente');
    } finally {
      setGuardando(false);
    }
  };

  // ─── Activar / Desactivar ────────────────────────────────────────────────────
  const toggleActivo = async (cliente) => {
    try {
      await api.put(`/clientes/${cliente.id}`, { activo: !cliente.activo });
      toast.success(cliente.activo ? 'Cliente desactivado' : 'Cliente activado');
      cargar();
    } catch {
      toast.error('No se pudo actualizar el estado');
    }
  };

  const camposCompletos = clientes.filter((c) => c.email || c.telefono).length;

  return (
    <div className="clientes-page">
      {/* HEADER */}
      <div className="clientes-header">
        <div>
          <h1>Clientes</h1>
          <p>Gestiona tu base de clientes con consulta automática al catastro del SRI.</p>
        </div>
        <button className="btn-primary" onClick={abrirNuevo}>Nuevo cliente</button>
      </div>

      {/* RESUMEN */}
      <div className="clientes-summary">
        <article className="clientes-summary-card">
          <span>Total clientes</span>
          <strong>{total}</strong>
        </article>
        <article className="clientes-summary-card">
          <span>Activos</span>
          <strong>{clientes.filter((c) => c.activo).length}</strong>
        </article>
        <article className="clientes-summary-card">
          <span>Con contacto</span>
          <strong>{camposCompletos}</strong>
        </article>
      </div>

      {/* FILTROS */}
      <div className="clientes-filtros">
        <input
          type="search"
          placeholder="Buscar por RUC, cédula o nombre..."
          value={busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setPage(1); }}
          className="clientes-busqueda"
        />
      </div>

      {/* TABLA */}
      <div className="clientes-card">
        {cargando ? (
          <div className="clientes-loading">Cargando...</div>
        ) : clientes.length === 0 ? (
          <div className="clientes-empty">
            {busqueda ? 'No se encontraron clientes con ese criterio.' : 'No hay clientes registrados. Crea el primero.'}
          </div>
        ) : (
          <div className="clientes-table-wrap">
            <table className="clientes-table">
              <thead>
                <tr>
                  <th>Identificación</th>
                  <th>Razón Social</th>
                  <th>Nombre Comercial</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} className={!c.activo ? 'row-inactivo' : ''}>
                    <td>
                      <span className="tipo-badge">
                        {TIPOS_IDENTIFICACION.find((t) => t.valor === c.tipoIdentificacion)?.label || c.tipoIdentificacion}
                      </span>{' '}
                      {c.identificacion}
                    </td>
                    <td>{c.razonSocial}</td>
                    <td>{c.nombreComercial || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td>{c.telefono || '—'}</td>
                    <td>
                      <span className={`estado-badge ${c.activo ? 'activo' : 'inactivo'}`}>
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="acciones">
                      <button className="btn-sm-edit" onClick={() => abrirEditar(c)}>Editar</button>
                      <button
                        className={`btn-sm-toggle ${c.activo ? 'desactivar' : 'activar'}`}
                        onClick={() => toggleActivo(c)}
                      >
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINACIÓN */}
        {total > LIMIT && (
          <div className="clientes-pagination">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span>Página {page} de {Math.ceil(total / LIMIT)}</span>
            <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      {/* MODAL */}
      {modalAbierto && (
        <div className="modal-overlay" onClick={cerrarModal}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{form.id ? 'Editar cliente' : 'Nuevo cliente'}</h2>
              <button className="modal-close" onClick={cerrarModal}>✕</button>
            </div>

            <form onSubmit={guardar} className="modal-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de identificación</label>
                  <select
                    value={form.tipoIdentificacion}
                    onChange={(e) => setForm((p) => ({ ...p, tipoIdentificacion: e.target.value }))}
                    disabled={!!form.id}
                  >
                    {TIPOS_IDENTIFICACION.map((t) => (
                      <option key={t.valor} value={t.valor}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    Identificación
                    {buscandoSri && <span className="sri-loading"> Consultando SRI...</span>}
                  </label>
                  <input
                    type="text"
                    value={form.identificacion}
                    onChange={(e) => setForm((p) => ({ ...p, identificacion: e.target.value }))}
                    onBlur={handleIdentificacionBlur}
                    placeholder="RUC o cédula"
                    disabled={!!form.id}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Razón Social *</label>
                <input
                  type="text"
                  value={form.razonSocial}
                  onChange={(e) => setForm((p) => ({ ...p, razonSocial: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>Nombre Comercial</label>
                <input
                  type="text"
                  value={form.nombreComercial}
                  onChange={(e) => setForm((p) => ({ ...p, nombreComercial: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Dirección</label>
                <input
                  type="text"
                  value={form.direccion}
                  onChange={(e) => setForm((p) => ({ ...p, direccion: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    type="text"
                    value={form.telefono}
                    onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
                  />
                </div>
              </div>

              {form.id && (
                <div className="form-group form-check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.activo}
                      onChange={(e) => setForm((p) => ({ ...p, activo: e.target.checked }))}
                    />
                    {' '}Cliente activo
                  </label>
                </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={cerrarModal}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
