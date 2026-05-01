import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './TalentoHumano.css';

const EMPTY = { nombre: '', descripcion: '' };

const Departamentos = () => {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [guardando, setGuardando] = useState(false);
  const inputRef = useRef(null);

  const cargar = async () => {
    setLoading(true);
    try {
      const r = await api.get('/talento-humano/departamentos');
      setLista(r.data.data);
    } catch {
      toast.error('Error al cargar departamentos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);
  useEffect(() => { if (modal) setTimeout(() => inputRef.current?.focus(), 80); }, [modal]);

  const abrirNuevo = () => { setForm(EMPTY); setModal(true); };
  const abrirEditar = (dep) => { setForm({ id: dep.id, nombre: dep.nombre, descripcion: dep.descripcion || '' }); setModal(true); };
  const cerrar = () => setModal(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return toast.error('El nombre es requerido');
    setGuardando(true);
    try {
      if (form.id) {
        await api.put(`/talento-humano/departamentos/${form.id}`, form);
        toast.success('Departamento actualizado');
      } else {
        await api.post('/talento-humano/departamentos', form);
        toast.success('Departamento creado');
      }
      cerrar();
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async (dep) => {
    if (!confirm(`¿Desactivar el departamento "${dep.nombre}"?`)) return;
    try {
      await api.delete(`/talento-humano/departamentos/${dep.id}`);
      toast.success('Departamento desactivado');
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al desactivar');
    }
  };

  const filtrados = lista.filter(d =>
    d.nombre.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>🏢 Departamentos</h1>
        <div className="th-toolbar">
          <input
            className="th-search"
            placeholder="Buscar departamento…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button className="btn-th-primary" onClick={abrirNuevo}>+ Nuevo</button>
        </div>
      </div>

      {loading ? (
        <div className="th-loading">Cargando…</div>
      ) : (
        <div className="th-table-wrapper">
          <table className="th-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Empleados</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign:'center', padding:'2rem', color:'#a0aec0' }}>Sin resultados</td></tr>
              ) : filtrados.map(dep => (
                <tr key={dep.id}>
                  <td>{dep.nombre}</td>
                  <td>{dep.descripcion || '—'}</td>
                  <td>{dep._count?.empleados ?? 0}</td>
                  <td>
                    <span className={dep.activo ? 'badge-activo' : 'badge-inactivo'}>
                      {dep.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn-th-sm" onClick={() => abrirEditar(dep)}>✏️ Editar</button>
                      {dep.activo && (
                        <button className="btn-th-danger" onClick={() => desactivar(dep)}>Desactivar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="th-modal-overlay" onClick={e => e.target === e.currentTarget && cerrar()}>
          <div className="th-modal">
            <h2>{form.id ? 'Editar Departamento' : 'Nuevo Departamento'}</h2>
            <form onSubmit={guardar}>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.9rem' }}>
                <div className="th-form-group">
                  <label>Nombre *</label>
                  <input
                    ref={inputRef}
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Contabilidad"
                  />
                </div>
                <div className="th-form-group">
                  <label>Descripción</label>
                  <textarea
                    value={form.descripcion}
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    placeholder="Descripción del departamento…"
                    rows={3}
                  />
                </div>
              </div>
              <div className="th-modal-actions">
                <button type="button" className="btn-th-secondary" onClick={cerrar}>Cancelar</button>
                <button type="submit" className="btn-th-primary" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Departamentos;
