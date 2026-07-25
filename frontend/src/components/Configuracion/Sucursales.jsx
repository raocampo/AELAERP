import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './Sucursales.css';

const FORM_SUCURSAL_VACIO = { nombre: '', establecimiento: '', direccion: '', telefono: '' };
const FORM_PUNTO_VACIO = { puntoEmision: '', descripcion: '' };

export default function Sucursales() {
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [formSucursal, setFormSucursal] = useState(FORM_SUCURSAL_VACIO);
  const [guardandoSucursal, setGuardandoSucursal] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(null); // sucursal a eliminar
  const [formsPunto, setFormsPunto] = useState({}); // { [sucursalId]: { puntoEmision, descripcion } }
  const [guardandoPunto, setGuardandoPunto] = useState(null); // sucursalId en progreso

  const cargar = async () => {
    try {
      const res = await api.get('/sucursales');
      setSucursales(res.data?.data || []);
    } catch {
      toast.error('No se pudieron cargar las sucursales');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  const crearSucursal = async () => {
    if (!formSucursal.nombre.trim()) { toast.error('El nombre es requerido'); return; }
    if (!/^\d{1,3}$/.test(formSucursal.establecimiento.trim())) {
      toast.error('El establecimiento debe ser un código numérico de hasta 3 dígitos (ej. 002)');
      return;
    }
    setGuardandoSucursal(true);
    try {
      await api.post('/sucursales', formSucursal);
      toast.success('Sucursal creada correctamente');
      setFormSucursal(FORM_SUCURSAL_VACIO);
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al crear la sucursal');
    } finally {
      setGuardandoSucursal(false);
    }
  };

  const toggleActivo = async (sucursal) => {
    try {
      await api.put(`/sucursales/${sucursal.id}`, { activo: !sucursal.activo });
      toast.success(sucursal.activo ? 'Sucursal desactivada' : 'Sucursal activada');
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al actualizar la sucursal');
    }
  };

  const eliminarSucursal = async (id) => {
    try {
      await api.delete(`/sucursales/${id}`);
      toast.success('Sucursal eliminada');
      setConfirmarEliminar(null);
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo eliminar la sucursal');
    }
  };

  const actualizarFormPunto = (sucursalId, campo, valor) => {
    setFormsPunto((prev) => ({
      ...prev,
      [sucursalId]: { ...(prev[sucursalId] || FORM_PUNTO_VACIO), [campo]: valor },
    }));
  };

  const crearPunto = async (sucursalId) => {
    const form = formsPunto[sucursalId] || FORM_PUNTO_VACIO;
    if (!/^\d{1,3}$/.test(String(form.puntoEmision).trim())) {
      toast.error('El punto de emisión debe ser un código numérico de hasta 3 dígitos (ej. 002)');
      return;
    }
    setGuardandoPunto(sucursalId);
    try {
      await api.post('/puntos-emision', { sucursalId, ...form });
      toast.success('Punto de venta creado correctamente');
      setFormsPunto((prev) => ({ ...prev, [sucursalId]: FORM_PUNTO_VACIO }));
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al crear el punto de venta');
    } finally {
      setGuardandoPunto(null);
    }
  };

  const desactivarPunto = async (id) => {
    try {
      await api.delete(`/puntos-emision/${id}`);
      toast.success('Punto de venta desactivado');
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo desactivar el punto de venta');
    }
  };

  if (cargando) return <div className="suc-loading">Cargando sucursales...</div>;

  return (
    <div className="suc-page">
      <div className="suc-header">
        <div>
          <h1>Sucursales y Puntos de Venta</h1>
          <p>
            Cada <strong>sucursal</strong> es un local físico (establecimiento SRI). Cada sucursal
            puede tener varios <strong>puntos de venta/cajas</strong> (punto de emisión SRI) — por
            ejemplo, las 4 cajas registradoras de un supermercado.
          </p>
        </div>
      </div>

      {/* Formulario nueva sucursal */}
      <div className="suc-form-card">
        <h3>+ Nueva sucursal</h3>
        <div className="suc-form-row">
          <div className="suc-form-field" style={{ flex: 2 }}>
            <label>Nombre</label>
            <input
              placeholder="Ej: Sucursal Norte"
              value={formSucursal.nombre}
              onChange={(e) => setFormSucursal((p) => ({ ...p, nombre: e.target.value }))}
              maxLength={150}
            />
          </div>
          <div className="suc-form-field suc-form-field--sm">
            <label>Establecimiento</label>
            <input
              placeholder="002"
              value={formSucursal.establecimiento}
              onChange={(e) => setFormSucursal((p) => ({ ...p, establecimiento: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
              maxLength={3}
            />
          </div>
          <div className="suc-form-field" style={{ flex: 2 }}>
            <label>Dirección (opcional)</label>
            <input
              placeholder="Av. Principal y Secundaria"
              value={formSucursal.direccion}
              onChange={(e) => setFormSucursal((p) => ({ ...p, direccion: e.target.value }))}
              maxLength={300}
            />
          </div>
          <div className="suc-form-field">
            <label>Teléfono (opcional)</label>
            <input
              placeholder="0999999999"
              value={formSucursal.telefono}
              onChange={(e) => setFormSucursal((p) => ({ ...p, telefono: e.target.value }))}
              maxLength={20}
            />
          </div>
        </div>
        <div className="suc-form-actions">
          <button className="btn-primary" onClick={crearSucursal} disabled={guardandoSucursal}>
            {guardandoSucursal ? 'Creando...' : 'Crear sucursal'}
          </button>
        </div>
      </div>

      {/* Lista de sucursales */}
      {sucursales.length === 0 ? (
        <div className="suc-empty">No hay sucursales configuradas todavía.</div>
      ) : (
        sucursales.map((sucursal) => (
          <div key={sucursal.id} className={`suc-card${!sucursal.activo ? ' suc-card--inactiva' : ''}`}>
            <div className="suc-card-header">
              <div>
                <h3>
                  {sucursal.nombre}
                  {sucursal.esMatriz && <span className="suc-badge">Matriz</span>}
                  {!sucursal.activo && <span className="suc-badge suc-badge--inactiva">Inactiva</span>}
                </h3>
                <p className="suc-card-sub">
                  Establecimiento <strong>{sucursal.establecimiento}</strong>
                  {sucursal.direccion ? ` · ${sucursal.direccion}` : ''}
                  {sucursal.telefono ? ` · ${sucursal.telefono}` : ''}
                </p>
              </div>
              {!sucursal.esMatriz && (
                <div className="suc-card-actions">
                  <button className="btn-secondary" onClick={() => toggleActivo(sucursal)}>
                    {sucursal.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="btn-icon btn-icon--danger" onClick={() => setConfirmarEliminar(sucursal)} title="Eliminar">🗑️</button>
                </div>
              )}
            </div>

            {/* Puntos de venta de esta sucursal */}
            <div className="suc-puntos">
              {sucursal.puntosEmision?.length > 0 ? (
                <table className="suc-puntos-table">
                  <thead>
                    <tr><th>Código</th><th>Descripción</th><th></th></tr>
                  </thead>
                  <tbody>
                    {sucursal.puntosEmision.map((punto) => (
                      <tr key={punto.id}>
                        <td><span className="suc-pct-chip">{sucursal.establecimiento}-{punto.puntoEmision}</span></td>
                        <td>{punto.descripcion || '—'}</td>
                        <td className="suc-puntos-actions">
                          <button className="btn-icon btn-icon--danger" onClick={() => desactivarPunto(punto.id)} title="Desactivar">🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="suc-puntos-empty">Esta sucursal todavía no tiene puntos de venta/cajas.</div>
              )}

              <div className="suc-punto-form">
                <input
                  className="suc-punto-form-codigo"
                  placeholder="Código (ej. 002)"
                  value={formsPunto[sucursal.id]?.puntoEmision || ''}
                  onChange={(e) => actualizarFormPunto(sucursal.id, 'puntoEmision', e.target.value.replace(/\D/g, '').slice(0, 3))}
                  maxLength={3}
                />
                <input
                  placeholder="Descripción (ej. Caja 2)"
                  value={formsPunto[sucursal.id]?.descripcion || ''}
                  onChange={(e) => actualizarFormPunto(sucursal.id, 'descripcion', e.target.value)}
                  maxLength={100}
                />
                <button
                  className="btn-secondary"
                  onClick={() => crearPunto(sucursal.id)}
                  disabled={guardandoPunto === sucursal.id}
                >
                  {guardandoPunto === sucursal.id ? 'Agregando...' : '+ Agregar punto de venta'}
                </button>
              </div>
            </div>
          </div>
        ))
      )}

      {confirmarEliminar && (
        <div className="suc-modal-overlay" onClick={() => setConfirmarEliminar(null)}>
          <div className="suc-modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Eliminar "{confirmarEliminar.nombre}"?</h3>
            <p>Solo se puede eliminar si no tiene puntos de venta activos. Esta acción no se puede deshacer.</p>
            <div className="suc-modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmarEliminar(null)}>Cancelar</button>
              <button className="btn-danger" onClick={() => eliminarSucursal(confirmarEliminar.id)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
