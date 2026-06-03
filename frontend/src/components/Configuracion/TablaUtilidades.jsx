import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './TablaUtilidades.css';

const FORM_VACIO = { nombre: '', porcentaje: '', descripcion: '' };

export default function TablaUtilidades() {
  const [items,     setItems]     = useState([]);
  const [cargando,  setCargando]  = useState(true);
  const [form,      setForm]      = useState(FORM_VACIO);
  const [editId,    setEditId]    = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmar, setConfirmar] = useState(null); // id a eliminar

  const cargar = async () => {
    try {
      const res = await api.get('/utilidades');
      setItems(res.data?.data || []);
    } catch { toast.error('No se pudo cargar la tabla de utilidades'); }
    finally { setCargando(false); }
  };

  useEffect(() => { cargar(); }, []);

  const iniciarEdicion = (item) => {
    setEditId(item.id);
    setForm({ nombre: item.nombre, porcentaje: String(item.porcentaje), descripcion: item.descripcion || '' });
  };

  const cancelar = () => { setEditId(null); setForm(FORM_VACIO); };

  const guardar = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre es requerido'); return; }
    const pct = parseFloat(form.porcentaje);
    if (isNaN(pct) || pct < 0 || pct > 1000) { toast.error('Porcentaje debe ser entre 0 y 1000'); return; }

    setGuardando(true);
    try {
      if (editId) {
        await api.put(`/utilidades/${editId}`, { ...form, porcentaje: pct });
        toast.success('Margen actualizado');
      } else {
        await api.post('/utilidades', { ...form, porcentaje: pct });
        toast.success('Margen creado');
      }
      cancelar();
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (id) => {
    try {
      await api.delete(`/utilidades/${id}`);
      toast.success('Margen eliminado');
      setConfirmar(null);
      await cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al eliminar');
    }
  };

  const pvpEjemplo = (pct) => {
    const p = parseFloat(pct);
    if (isNaN(p)) return '—';
    return `$${(100 * (1 + p / 100)).toFixed(2)}`;
  };

  if (cargando) return <div className="util-loading">Cargando tabla de utilidades...</div>;

  return (
    <div className="util-page">
      <div className="util-header">
        <div>
          <h1>Tabla de Utilidades</h1>
          <p>
            Define los márgenes de ganancia para calcular el <strong>Precio de Venta al Público (PVP)</strong>{' '}
            automáticamente al importar productos desde facturas de compra.
          </p>
        </div>
      </div>

      <div className="util-formula-card">
        <strong>Fórmula: </strong>
        <code>PVP = Costo × (1 + % Utilidad ÷ 100)</code>
        <span className="util-formula-ej">Ejemplo: Costo $100 con 30% → PVP $130</span>
      </div>

      {/* Formulario agregar / editar */}
      <div className="util-form-card">
        <h3>{editId ? 'Editar margen' : '+ Nuevo margen'}</h3>
        <div className="util-form-row">
          <div className="util-form-field">
            <label>Nombre</label>
            <input
              placeholder="Ej: General, Electrónica, Alimentos"
              value={form.nombre}
              onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))}
              maxLength={80}
            />
          </div>
          <div className="util-form-field util-form-field--sm">
            <label>% Utilidad</label>
            <div className="util-pct-wrap">
              <input
                type="number"
                step="0.5"
                min="0"
                max="1000"
                placeholder="30"
                value={form.porcentaje}
                onChange={(e) => setForm((p) => ({ ...p, porcentaje: e.target.value }))}
              />
              <span>%</span>
            </div>
          </div>
          <div className="util-form-field util-form-field--sm util-pvp-preview">
            <label>PVP si costo = $100</label>
            <strong>{pvpEjemplo(form.porcentaje)}</strong>
          </div>
          <div className="util-form-field" style={{ flex: 2 }}>
            <label>Descripción (opcional)</label>
            <input
              placeholder="Ej: Para productos de tecnología y electrónica"
              value={form.descripcion}
              onChange={(e) => setForm((p) => ({ ...p, descripcion: e.target.value }))}
              maxLength={200}
            />
          </div>
        </div>
        <div className="util-form-actions">
          {editId && <button className="btn-secondary" onClick={cancelar}>Cancelar</button>}
          <button className="btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando...' : editId ? 'Actualizar' : 'Agregar margen'}
          </button>
        </div>
      </div>

      {/* Tabla de márgenes */}
      {items.length === 0 ? (
        <div className="util-empty">
          No hay márgenes configurados. Agrega el primero arriba.
        </div>
      ) : (
        <div className="util-table-card">
          <table className="util-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th className="num">% Utilidad</th>
                <th className="num">PVP (si costo=$100)</th>
                <th>Descripción</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.nombre}</strong></td>
                  <td className="num"><span className="util-pct-chip">{Number(item.porcentaje).toFixed(1)}%</span></td>
                  <td className="num">${(100 * (1 + Number(item.porcentaje) / 100)).toFixed(2)}</td>
                  <td className="util-desc">{item.descripcion || '—'}</td>
                  <td className="util-actions">
                    <button className="btn-icon" onClick={() => iniciarEdicion(item)} title="Editar">✏️</button>
                    <button className="btn-icon btn-icon--danger" onClick={() => setConfirmar(item.id)} title="Eliminar">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal confirmar eliminación */}
      {confirmar && (
        <div className="util-modal-overlay" onClick={() => setConfirmar(null)}>
          <div className="util-modal" onClick={(e) => e.stopPropagation()}>
            <h3>¿Eliminar este margen?</h3>
            <p>Esta acción no se puede deshacer.</p>
            <div className="util-modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className="btn-danger" onClick={() => eliminar(confirmar)}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
