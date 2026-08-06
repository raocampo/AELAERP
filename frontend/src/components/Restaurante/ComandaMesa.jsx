import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './Restaurante.css';

export default function ComandaMesa() {
  const { mesaId } = useParams();
  const navigate = useNavigate();
  const [comanda, setComanda] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [enviandoCocina, setEnviandoCocina] = useState(false);
  const dropRef = useRef(null);

  const cargar = () => {
    setLoading(true);
    api.get(`/mesas/${mesaId}/comanda`)
      .then((r) => {
        if (!r.data?.data) {
          toast.error('Esta mesa no tiene una comanda abierta');
          navigate('/restaurante/mesas');
          return;
        }
        setComanda(r.data.data);
      })
      .catch((err) => toast.error(err.response?.data?.mensaje || 'No se pudo cargar la comanda'))
      .finally(() => setLoading(false));
  };

  useEffect(cargar, [mesaId]);

  useEffect(() => {
    if (busqueda.trim().length < 1) { setResultados([]); return; }
    const timer = setTimeout(() => {
      api.get('/productos/buscar', { params: { q: busqueda } })
        .then((r) => setResultados(r.data?.data || []))
        .catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [busqueda]);

  useEffect(() => {
    const cerrar = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setResultados([]); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, []);

  const guardarItems = async (nuevosItems) => {
    setGuardando(true);
    try {
      const res = await api.put(`/mesas/comandas/${comanda.id}`, { items: nuevosItems });
      setComanda((prev) => ({ ...prev, ...res.data.data }));
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo guardar el pedido');
    } finally {
      setGuardando(false);
    }
  };

  const agregarProducto = (producto) => {
    const items = [...comanda.items];
    const existente = items.find((it) => it.codigoPrincipal === producto.codigoPrincipal && !it.nota && !it.enviadoCocina);
    if (existente) {
      existente.cantidad = Number(existente.cantidad) + 1;
    } else {
      items.push({
        codigoPrincipal: producto.codigoPrincipal,
        descripcion: producto.nombre,
        cantidad: 1,
        precioUnitario: Number(producto.precioUnitario || 0),
        ivaPorcentaje: Number(producto.tarifaIva || 0),
        nota: '',
        enviadoCocina: false,
      });
    }
    setBusqueda('');
    setResultados([]);
    guardarItems(items);
  };

  const cambiarCantidad = (idx, delta) => {
    const items = [...comanda.items];
    const nueva = Number(items[idx].cantidad) + delta;
    if (nueva <= 0) { items.splice(idx, 1); } else { items[idx] = { ...items[idx], cantidad: nueva }; }
    guardarItems(items);
  };

  const cambiarNota = (idx, nota) => {
    const items = [...comanda.items];
    items[idx] = { ...items[idx], nota };
    setComanda((prev) => ({ ...prev, items }));
  };

  const guardarNota = (idx) => {
    guardarItems(comanda.items);
  };

  const quitarItem = (idx) => {
    const items = comanda.items.filter((_, i) => i !== idx);
    guardarItems(items);
  };

  const enviarCocina = async () => {
    setEnviandoCocina(true);
    try {
      const res = await api.post(`/mesas/comandas/${comanda.id}/enviar-cocina`);
      if (res.data?.impreso) toast.success(res.data.mensaje);
      else toast.error(res.data?.mensaje || 'No se imprimió el ticket de cocina');
      setComanda((prev) => ({ ...prev, items: res.data.data.items }));
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo enviar a cocina');
    } finally {
      setEnviandoCocina(false);
    }
  };

  const anular = async () => {
    if (!window.confirm('¿Anular esta comanda? La mesa quedará libre sin generar ninguna venta.')) return;
    try {
      await api.post(`/mesas/comandas/${comanda.id}/anular`);
      toast.success('Comanda anulada');
      navigate('/restaurante/mesas');
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo anular la comanda');
    }
  };

  const irACobrar = () => {
    if (!comanda.items.length) return toast.error('Agrega al menos un ítem antes de cobrar');
    navigate('/pos', {
      state: {
        comandaParaCobrar: {
          id: comanda.id,
          mesaId: Number(mesaId),
          mesaNombre: comanda.mesa?.nombre,
          items: comanda.items,
        },
      },
    });
  };

  if (loading || !comanda) return <div className="rest-page"><div className="rest-empty">Cargando...</div></div>;

  const pendientes = comanda.items.filter((it) => !it.enviadoCocina).length;

  return (
    <div className="rest-page">
      <div className="rest-header">
        <div>
          <h1>🍽️ {comanda.mesa?.nombre || `Mesa ${mesaId}`}</h1>
          <p>{comanda.numeroComensales ? `${comanda.numeroComensales} comensales · ` : ''}Comanda #{comanda.id}</p>
        </div>
        <div className="rest-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/restaurante/mesas')}>← Mesas</button>
          <button className="btn-secondary" onClick={anular}>Anular mesa</button>
        </div>
      </div>

      <div className="rest-comanda-layout">
        <div className="rest-comanda-buscar" ref={dropRef}>
          <input
            className="rest-buscar-input"
            placeholder="Buscar producto para agregar..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            autoFocus
          />
          {resultados.length > 0 && (
            <div className="rest-buscar-drop">
              {resultados.map((p) => (
                <button key={p.id} type="button" className="rest-buscar-item" onClick={() => agregarProducto(p)}>
                  <span>{p.nombre}</span>
                  <span className="rest-buscar-precio">${Number(p.precioUnitario || 0).toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rest-comanda-items">
          {comanda.items.length === 0 ? (
            <div className="rest-empty">Busca un producto arriba para agregarlo al pedido.</div>
          ) : (
            comanda.items.map((item, idx) => (
              <div key={idx} className={`rest-item-row ${item.enviadoCocina ? 'enviado' : 'nuevo'}`}>
                <div className="rest-item-cant">
                  <button type="button" onClick={() => cambiarCantidad(idx, -1)}>−</button>
                  <span>{item.cantidad}</span>
                  <button type="button" onClick={() => cambiarCantidad(idx, 1)}>+</button>
                </div>
                <div className="rest-item-info">
                  <div className="rest-item-nombre">{item.descripcion}</div>
                  <input
                    className="rest-item-nota"
                    placeholder="Nota para cocina (ej. sin cebolla)"
                    value={item.nota || ''}
                    onChange={(e) => cambiarNota(idx, e.target.value)}
                    onBlur={() => guardarNota(idx)}
                  />
                </div>
                <div className="rest-item-precio">${(item.cantidad * item.precioUnitario).toFixed(2)}</div>
                <div className="rest-item-estado">
                  {item.enviadoCocina ? <span title="Ya enviado a cocina">✅</span> : <span title="Sin enviar">🆕</span>}
                </div>
                <button type="button" className="rest-item-quitar" onClick={() => quitarItem(idx)}>✕</button>
              </div>
            ))
          )}
        </div>

        <div className="rest-comanda-footer">
          <div className="rest-comanda-totales">
            <div><span>Subtotal</span><strong>${comanda.subtotal?.toFixed(2)}</strong></div>
            <div><span>IVA</span><strong>${comanda.totalIva?.toFixed(2)}</strong></div>
            <div className="rest-total-final"><span>Total</span><strong>${comanda.total?.toFixed(2)}</strong></div>
          </div>
          <div className="rest-comanda-acciones">
            <button
              className="btn-secondary"
              onClick={enviarCocina}
              disabled={enviandoCocina || pendientes === 0}
            >
              {enviandoCocina ? 'Enviando...' : `🔥 Enviar a cocina${pendientes ? ` (${pendientes})` : ''}`}
            </button>
            <button className="btn-primary" onClick={irACobrar}>💳 Cobrar mesa</button>
          </div>
          {guardando && <span className="rest-guardando">Guardando...</span>}
        </div>
      </div>
    </div>
  );
}
