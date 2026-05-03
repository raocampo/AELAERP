// ====================================
// GESTIÓN DE USUARIOS — Solo admin
// frontend/src/components/Usuarios/GestionUsuarios.jsx
// ====================================

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import { ROLE_OPTIONS, obtenerRolLabel, tienePermiso } from '../../utils/roles';
import './GestionUsuarios.css';

const FORM_VACIO = {
  nombre: '',
  username: '',
  email: '',
  rol: 'operador',
  password: '',
  activo: true,
};

export default function GestionUsuarios() {
  const { usuario } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);

  useEffect(() => {
    cargar();
  }, []);

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await api.get('/usuarios');
      setUsuarios(res.data?.data || []);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al cargar usuarios');
    } finally {
      setCargando(false);
    }
  };

  const abrirNuevo = () => {
    setEditando(null);
    setForm(FORM_VACIO);
    setMostrarForm(true);
  };

  const abrirEditar = (item) => {
    setEditando(item.id);
    setForm({
      nombre: item.nombre || '',
      username: item.username || '',
      email: item.email || '',
      rol: item.rol || 'operador',
      password: '',
      activo: Boolean(item.activo),
    });
    setMostrarForm(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleGuardar = async (e) => {
    e.preventDefault();

    if (!form.nombre.trim() || !form.username.trim()) {
      toast.error('Nombre y usuario son requeridos');
      return;
    }

    if (!/^[a-z0-9._-]{3,40}$/i.test(form.username.trim())) {
      toast.error('El usuario debe tener entre 3 y 40 caracteres y solo usar letras, números, punto, guion o guion bajo');
      return;
    }

    if (!editando && form.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    setGuardando(true);
    try {
      const payload = {
        nombre: form.nombre,
        username: form.username,
        email: form.email || null,
        rol: form.rol,
        activo: form.activo,
      };

      if (form.password) {
        payload.password = form.password;
      }

      if (editando) {
        await api.put(`/usuarios/${editando}`, payload);
        toast.success('Usuario actualizado');
      } else {
        await api.post('/usuarios', payload);
        toast.success('Usuario creado');
      }

      setMostrarForm(false);
      setForm(FORM_VACIO);
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar usuario');
    } finally {
      setGuardando(false);
    }
  };

  const toggleActivo = async (item) => {
    try {
      await api.put(`/usuarios/${item.id}`, { activo: !item.activo });
      toast.success(item.activo ? 'Usuario desactivado' : 'Usuario activado');
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al cambiar estado del usuario');
    }
  };

  if (!tienePermiso(usuario?.rol, 'usuarios.gestionar')) {
    return (
      <div className="usuarios-sin-permiso">
        <h2>👥 Gestión de Usuarios</h2>
        <p>Solo los administradores pueden crear o modificar usuarios.</p>
      </div>
    );
  }

  const getInitials = (nombre) =>
    nombre ? nombre.trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '?';

  const getRolBadgeClass = (rol) => {
    if (rol === 'admin') return 'badge-rol admin';
    if (rol === 'contador') return 'badge-rol contador';
    return 'badge-rol operador';
  };

  return (
    <div className="usuarios-page">
      {/* Header */}
      <div className="usuarios-header">
        <div className="usuarios-header-info">
          <h1>👥 Gestión de Usuarios</h1>
          <p>Crea usuarios con nombre de acceso propio. El correo es opcional.</p>
        </div>
        <button className="btn-primary" onClick={abrirNuevo}>+ Nuevo Usuario</button>
      </div>

      {/* Modal */}
      {mostrarForm && (
        <div className="usu-modal-overlay">
          <div className="usu-modal" onClick={(e) => e.stopPropagation()}>
            <div className="usu-modal-header">
              <div className="usu-modal-header-left">
                <div className="usu-modal-header-icon">
                  {editando ? '✏️' : '👤'}
                </div>
                <div className="usu-modal-header-text">
                  <h3>{editando ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                  <p>Puede iniciar sesión con su usuario o con su correo si lo tiene.</p>
                </div>
              </div>
              <button className="usu-modal-close" onClick={() => setMostrarForm(false)}>✕</button>
            </div>

            <form className="usu-form" onSubmit={handleGuardar}>
              <div className="usu-form-grid">
                <div className="usu-field">
                  <label>Nombre completo *</label>
                  <input
                    name="nombre"
                    value={form.nombre}
                    onChange={handleChange}
                    placeholder="Ej: Juan Pérez"
                    required
                  />
                </div>
                <div className="usu-field">
                  <label>Nombre de usuario *</label>
                  <input
                    name="username"
                    value={form.username}
                    onChange={handleChange}
                    placeholder="Ej: caja01, j.perez"
                    required
                  />
                </div>
                <div className="usu-field">
                  <label>Correo electrónico</label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="Opcional"
                  />
                </div>
                <div className="usu-field">
                  <label>Rol</label>
                  <select name="rol" value={form.rol} onChange={handleChange}>
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>{role.label}</option>
                    ))}
                  </select>
                </div>
                <div className="usu-field full">
                  <label>{editando ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label>
                  <input
                    type="password"
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    placeholder={editando ? 'Déjala vacía para conservar la actual' : 'Mínimo 8 caracteres'}
                    required={!editando}
                  />
                </div>
                {editando && (
                  <div className="usu-field full">
                    <div className="usu-checkbox-row">
                      <input
                        type="checkbox"
                        name="activo"
                        id="chk-activo"
                        checked={form.activo}
                        onChange={handleChange}
                      />
                      <span>Usuario activo (puede iniciar sesión)</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="usu-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setMostrarForm(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : editando ? 'Actualizar' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contenido */}
      {cargando ? (
        <div className="usuarios-loading">Cargando usuarios...</div>
      ) : (
        <div className="usuarios-table-card">
          <table className="usuarios-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Usuario</th>
                <th>Correo</th>
                <th className="center">Rol</th>
                <th className="center">Estado</th>
                <th className="center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 ? (
                <tr>
                  <td colSpan={6} className="usuarios-empty">
                    No hay usuarios registrados aún.
                  </td>
                </tr>
              ) : usuarios.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="usuarios-nombre-cell">
                      <div className="usuarios-avatar">{getInitials(item.nombre)}</div>
                      <div>
                        <strong>{item.nombre}</strong>
                        {item.id === usuario?.id && (
                          <div className="usuarios-sesion-label">● Tu sesión</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="usuarios-username">{item.username}</span>
                  </td>
                  <td>
                    <span className={`usuarios-email${item.email ? '' : ' sin-correo'}`}>
                      {item.email || 'Sin correo'}
                    </span>
                  </td>
                  <td className="center">
                    <span className={getRolBadgeClass(item.rol)}>
                      {obtenerRolLabel(item.rol)}
                    </span>
                  </td>
                  <td className="center">
                    <span className={`badge-activo ${item.activo ? 'si' : 'no'}`}>
                      {item.activo ? 'ACTIVO' : 'INACTIVO'}
                    </span>
                  </td>
                  <td>
                    <div className="usuarios-acciones">
                      <button className="btn-accion-editar" onClick={() => abrirEditar(item)}>
                        ✏️ Editar
                      </button>
                      {item.id !== usuario?.id && (
                        <button
                          className={`btn-accion-toggle ${item.activo ? 'desactivar' : 'activar'}`}
                          onClick={() => toggleActivo(item)}
                        >
                          {item.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
