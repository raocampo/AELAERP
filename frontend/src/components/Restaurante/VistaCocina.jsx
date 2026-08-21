import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import './Restaurante.css';

const POLL_MS = 15_000;

function minutosDesde(fecha) {
  if (!fecha) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 60_000));
}

export default function VistaCocina() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [marcando, setMarcando] = useState(null);

  const cargar = () => {
    api.get('/mesas/cocina/pendientes')
      .then((r) => setItems(r.data?.data || []))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'No se pudo cargar la cola de cocina'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const marcarListo = async (item) => {
    const clave = `${item.comandaId}-${item.codigoPrincipal}-${item.nota || ''}`;
    setMarcando(clave);
    try {
      await api.post(`/mesas/comandas/${item.comandaId}/items/listo`, {
        codigoPrincipal: item.codigoPrincipal,
        nota: item.nota,
      });
      setItems((prev) => prev.filter((it) => (
        !(it.comandaId === item.comandaId && it.codigoPrincipal === item.codigoPrincipal && (it.nota || '') === (item.nota || ''))
      )));
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo marcar el ítem como listo');
    } finally {
      setMarcando(null);
    }
  };

  return (
    <div className="rest-page">
      <div className="rest-header">
        <div>
          <h1>🔥 Cocina</h1>
          <p>Pedidos enviados a cocina, pendientes de preparar. Se actualiza solo cada 15 segundos.</p>
        </div>
      </div>

      {loading ? (
        <div className="rest-empty">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="rest-empty">No hay pedidos pendientes por ahora 🎉</div>
      ) : (
        <div className="rest-cocina-grid">
          {items.map((item) => {
            const clave = `${item.comandaId}-${item.codigoPrincipal}-${item.nota || ''}`;
            const minutos = minutosDesde(item.enviadoCocinaEn);
            return (
              <div key={clave} className={`rest-cocina-card${minutos >= 10 ? ' urgente' : ''}`}>
                <div className="rest-cocina-mesa">{item.mesaNombre}</div>
                <div className="rest-cocina-item">
                  <span className="rest-cocina-cant">{item.cantidad}×</span> {item.descripcion}
                </div>
                {item.nota && <div className="rest-cocina-nota">📝 {item.nota}</div>}
                <div className="rest-cocina-tiempo">{minutos <= 0 ? 'recién' : `hace ${minutos} min`}</div>
                <button
                  className="btn-primary"
                  disabled={marcando === clave}
                  onClick={() => marcarListo(item)}
                >
                  {marcando === clave ? 'Marcando...' : '✓ Listo'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
