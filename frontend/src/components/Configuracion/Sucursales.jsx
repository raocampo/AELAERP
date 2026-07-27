import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './Sucursales.css';

const FORM_SUCURSAL_VACIO = { nombre: '', establecimiento: '', direccion: '', telefono: '' };
const FORM_PUNTO_VACIO = { puntoEmision: '', descripcion: '' };
const FORM_CAJA_VACIO = { nombre: '' };

export default function Sucursales() {
  const [sucursales, setSucursales] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [formSucursal, setFormSucursal] = useState(FORM_SUCURSAL_VACIO);
  const [guardandoSucursal, setGuardandoSucursal] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(null); // sucursal a eliminar
  const [formsPunto, setFormsPunto] = useState({}); // { [sucursalId]: { puntoEmision, descripcion } }
  const [guardandoPunto, setGuardandoPunto] = useState(null); // sucursalId en progreso
  const [formsCaja, setFormsCaja] = useState({}); // { [puntoEmisionId]: { nombre } }
  const [guardandoCaja, setGuardandoCaja] = useState(null); // puntoEmisionId en progreso

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

  const actualizarFormCaja = (puntoEmisionId, valor) => {
    setFormsCaja((prev) => ({ ...prev, [puntoEmisionId]: { nombre: valor } }));
  };

  const crearCaja = async (puntoEmisionId) => {
    const form = formsCaja[puntoEmisionId] || FORM_CAJA_VACIO;
    if (!form.nombre.trim()) { toast.error('El nombre de la caja es requerido'); return; }
    setGuardandoCaja(puntoEmisionId);
    try {
      await api.post('/cajas', { puntoEmisionId, nombre: form.nombre.trim() });
      toast.success('Caja creada correctamente');
      setFormsCaja((prev) => ({ ...prev, [puntoEmisionId]: FORM_CAJA_VACIO }));
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al crear la caja');
    } finally {
      setGuardandoCaja(null);
    }
  };

  const desactivarCaja = async (id) => {
    try {
      await api.delete(`/cajas/${id}`);
      toast.success('Caja desactivada');
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo desactivar la caja');
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
            tiene uno o más <strong>puntos de emisión</strong> (secuencia SRI), y cada punto de
            emisión puede tener varias <strong>cajas</strong> físicas — por ejemplo, las 4 cajas
            registradoras de un supermercado que emiten bajo la misma secuencia.
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

            {/* Puntos de emisión de esta sucursal, con sus cajas físicas anidadas */}
            <div className="suc-puntos">
              {sucursal.puntosEmision?.length > 0 ? (
                sucursal.puntosEmision.map((punto) => (
                  <div key={punto.id} className="suc-punto-card">
                    <div className="suc-punto-card-header">
                      <span className="suc-pct-chip">{sucursal.establecimiento}-{punto.puntoEmision}</span>
                      <span className="suc-punto-descripcion">{punto.descripcion || 'Punto de emisión'}</span>
                      <button className="btn-icon btn-icon--danger" onClick={() => desactivarPunto(punto.id)} title="Desactivar punto de emisión">🗑️</button>
                    </div>

                    {/* Cajas físicas que emiten bajo este punto de emisión */}
                    <div className="suc-cajas">
                      {punto.cajas?.length > 0 ? (
                        <div className="suc-cajas-lista">
                          {punto.cajas.map((caja) => (
                            <span key={caja.id} className="suc-caja-chip">
                              🖥️ {caja.nombre}
                              <button className="suc-caja-chip-x" onClick={() => desactivarCaja(caja.id)} title="Desactivar caja">✕</button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="suc-puntos-empty">Este punto de emisión todavía no tiene cajas.</div>
                      )}
                      <div className="suc-caja-form">
                        <input
                          placeholder="Nombre de la caja (ej. Caja 2)"
                          value={formsCaja[punto.id]?.nombre || ''}
                          onChange={(e) => actualizarFormCaja(punto.id, e.target.value)}
                          maxLength={100}
                        />
                        <button
                          className="btn-secondary"
                          onClick={() => crearCaja(punto.id)}
                          disabled={guardandoCaja === punto.id}
                        >
                          {guardandoCaja === punto.id ? 'Agregando...' : '+ Agregar caja'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="suc-puntos-empty">Esta sucursal todavía no tiene puntos de emisión.</div>
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
