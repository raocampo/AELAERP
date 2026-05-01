import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './TalentoHumano.css';

const EMPTY = { nombre: '', descripcion: '', departamentoId: '' };

const Cargos = () => {
  const [lista, setLista] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [guardando, setGuardando] = useState(false);
  const inputRef = useRef(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r, deps] = await Promise.all([
        api.get('/talento-humano/cargos'),
        api.get('/talento-humano/departamentos'),
      ]);
      setLista(r.data.data);
      setDepartamentos(deps.data.data.filter(d => d.activo));
    } catch {
      toast.error('Error al cargar cargos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (modal) setTimeout(() => inputRef.current?.focus(), 80); }, [modal]);

  const abrirNuevo = () => { setForm(EMPTY); setModal(true); };
  const abrirEditar = (c) => {
    setForm({ id: c.id, nombre: c.nombre, descripcion: c.descripcion || '', departamentoId: c.departamento?.id || '' });
    setModal(true);
  };
  const cerrar = () => setModal(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return toast.error('El nombre es requerido');
    setGuardando(true);
    try {
      if (form.id) {
        await api.put(`/talento-humano/cargos/${form.id}`, form);
        toast.success('Cargo actualizado');
      } else {
        await api.post('/talento-humano/cargos', form);
        toast.success('Cargo creado');
      }
      cerrar();
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async (c) => {
    if (!confirm(`¿Desactivar el cargo "${c.nombre}"?`)) return;
    try {
      await api.put(`/talento-humano/cargos/${c.id}`, { activo: false });
      toast.success('Cargo desactivado');
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error');
    }
  };

  const filtrados = lista.filter(c =>
    c.nombre.toLowerCase().includes(q.toLowerCase()) ||
    (c.departamento?.nombre || '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>📋 Cargos</h1>
        <div className="th-toolbar">
          <input
            className="th-search"
            placeholder="Buscar cargo o departamento…"
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
                <th>Cargo</th>
                <th>Departamento</th>
                <th>Descripción</th>
                <th>Empleados</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'#a0aec0' }}>Sin resultados</td></tr>
              ) : filtrados.map(c => (
                <tr key={c.id}>
                  <td>{c.nombre}</td>
                  <td>{c.departamento?.nombre || <span style={{ color:'#a0aec0' }}>Sin departamento</span>}</td>
                  <td>{c.descripcion || '—'}</td>
                  <td>{c._count?.empleados ?? 0}</td>
                  <td>
                    <span className={c.activo ? 'badge-activo' : 'badge-inactivo'}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      <button className="btn-th-sm" onClick={() => abrirEditar(c)}>✏️ Editar</button>
                      {c.activo && (
                        <button className="btn-th-danger" onClick={() => desactivar(c)}>Desactivar</button>
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
            <h2>{form.id ? 'Editar Cargo' : 'Nuevo Cargo'}</h2>
            <form onSubmit={guardar}>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.9rem' }}>
                <div className="th-form-group">
                  <label>Nombre del cargo *</label>
                  <input
                    ref={inputRef}
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Ej: Jefe de Ventas"
                  />
                </div>
                <div className="th-form-group">
                  <label>Departamento</label>
                  <select
                    value={form.departamentoId}
                    onChange={e => setForm(f => ({ ...f, departamentoId: e.target.value }))}
                  >
                    <option value="">— Sin departamento —</option>
                    {departamentos.map(d => (
                      <option key={d.id} value={d.id}>{d.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="th-form-group">
                  <label>Descripción</label>
                  <textarea
                    value={form.descripcion}
                    onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                    placeholder="Descripción del cargo…"
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

export default Cargos;
