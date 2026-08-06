import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './Restaurante.css';

function ModalMesa({ mesa, onClose, onGuardado }) {
  const [nombre, setNombre] = useState(mesa?.nombre || '');
  const [capacidad, setCapacidad] = useState(mesa?.capacidad || '');
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e) => {
    e.preventDefault();
    if (!nombre.trim()) return toast.error('El nombre de la mesa es requerido');
    setGuardando(true);
    try {
      if (mesa?.id) {
        await api.put(`/mesas/${mesa.id}`, { nombre, capacidad: capacidad || null });
        toast.success('Mesa actualizada');
      } else {
        await api.post('/mesas', { nombre, capacidad: capacidad || null });
        toast.success('Mesa creada');
      }
      onGuardado();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo guardar la mesa');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="rest-modal-overlay">
      <div className="rest-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mesa?.id ? 'Editar mesa' : 'Nueva mesa'}</h2>
        <form onSubmit={guardar} className="rest-form">
          <label>
            <span>Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Mesa 1, Terraza 3..." autoFocus required />
          </label>
          <label>
            <span>Capacidad (personas)</span>
            <input type="number" min="1" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} placeholder="Opcional" />
          </label>
          <div className="rest-form-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MapaMesas() {
  const navigate = useNavigate();
  const [mesas, setMesas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalMesa, setModalMesa] = useState(null); // null=cerrado, {}=nueva, {...}=editar
  const [modoAdmin, setModoAdmin] = useState(false);
  const [abriendo, setAbriendo] = useState(null);

  const cargar = () => {
    setLoading(true);
    api.get('/mesas')
      .then((r) => setMesas(r.data?.data || []))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'No se pudieron cargar las mesas'))
      .finally(() => setLoading(false));
  };

  useEffect(cargar, []);

  const abrirMesa = async (mesa) => {
    if (mesa.comanda) {
      navigate(`/restaurante/mesas/${mesa.id}/comanda`);
      return;
    }
    setAbriendo(mesa.id);
    try {
      await api.post(`/mesas/${mesa.id}/comanda`, {});
      navigate(`/restaurante/mesas/${mesa.id}/comanda`);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo abrir la mesa');
    } finally {
      setAbriendo(null);
    }
  };

  return (
    <div className="rest-page">
      <div className="rest-header">
        <div>
          <h1>🍽️ Mesas</h1>
          <p>Toca una mesa libre para abrirla, o una ocupada para ver/editar su pedido.</p>
        </div>
        <div className="rest-header-actions">
          <button className="btn-secondary" onClick={() => setModoAdmin((v) => !v)}>
            {modoAdmin ? 'Salir de edición' : '⚙️ Administrar mesas'}
          </button>
          {modoAdmin && (
            <button className="btn-primary" onClick={() => setModalMesa({})}>+ Nueva mesa</button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rest-empty">Cargando...</div>
      ) : mesas.length === 0 ? (
        <div className="rest-empty">
          No hay mesas configuradas todavía.{' '}
          <button className="btn-primary" onClick={() => { setModoAdmin(true); setModalMesa({}); }}>Crear la primera mesa</button>
        </div>
      ) : (
        <div className="rest-grid">
          {mesas.map((mesa) => {
            const ocupada = Boolean(mesa.comanda);
            return (
              <div
                key={mesa.id}
                className={`rest-mesa-card ${ocupada ? 'ocupada' : 'libre'}`}
                onClick={() => (modoAdmin ? setModalMesa(mesa) : abrirMesa(mesa))}
              >
                <div className="rest-mesa-nombre">{mesa.nombre}</div>
                {mesa.capacidad && <div className="rest-mesa-cap">👥 {mesa.capacidad}</div>}
                {ocupada ? (
                  <>
                    <div className="rest-mesa-estado">Ocupada</div>
                    <div className="rest-mesa-total">${mesa.comanda.total.toFixed(2)}</div>
                    {mesa.comanda.pendientesCocina > 0 && (
                      <div className="rest-mesa-badge">🔥 {mesa.comanda.pendientesCocina} sin enviar</div>
                    )}
                  </>
                ) : (
                  <div className="rest-mesa-estado">
                    {abriendo === mesa.id ? 'Abriendo...' : 'Libre'}
                  </div>
                )}
                {modoAdmin && <div className="rest-mesa-edit">✏️ Editar</div>}
              </div>
            );
          })}
        </div>
      )}

      {modalMesa && (
        <ModalMesa
          mesa={modalMesa.id ? modalMesa : null}
          onClose={() => setModalMesa(null)}
          onGuardado={() => { setModalMesa(null); cargar(); }}
        />
      )}
    </div>
  );
}
