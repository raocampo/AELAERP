import { useEffect, useState } from 'react';
import api from '../../services/api';
import './SelectorPuntoVenta.css';

const STORAGE_KEY = 'aela_punto_venta_activo';

/**
 * Selector de punto de venta/caja activo, para empresas con más de una
 * sucursal o más de una caja. Se mantiene oculto si la empresa solo tiene
 * un punto de venta (caso de la inmensa mayoría de tenants hoy) — en ese
 * caso el único punto se selecciona automáticamente sin fricción visual.
 *
 * Notifica al padre vía onChange(puntoVenta) cada vez que hay un punto
 * resuelto — incluyendo la primera carga — para que el padre pueda incluir
 * { establecimiento, puntoEmision } en el payload al crear el documento.
 */
export default function SelectorPuntoVenta({ onChange, label = 'Punto de venta:' }) {
  const [puntos, setPuntos] = useState([]);
  const [puntoActivoId, setPuntoActivoId] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let ignore = false;
    api.get('/puntos-emision/activos')
      .then((res) => {
        if (ignore) return;
        const lista = res.data?.data || [];
        setPuntos(lista);

        const guardadoId = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        const inicial = lista.find((p) => p.id === guardadoId) || lista[0] || null;
        setPuntoActivoId(inicial?.id || null);
        if (inicial) onChange?.(inicial);
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setCargando(false); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seleccionar = (id) => {
    const idNum = parseInt(id, 10);
    const punto = puntos.find((p) => p.id === idNum) || null;
    setPuntoActivoId(idNum);
    if (punto) {
      localStorage.setItem(STORAGE_KEY, String(idNum));
      onChange?.(punto);
    }
  };

  // Con 0 o 1 punto de venta no hay nada que elegir — no se muestra selector,
  // el único punto (o ninguno, si el tenant no lo tiene aún) ya se notificó arriba.
  if (cargando || puntos.length <= 1) return null;

  return (
    <div className="selector-punto-venta">
      <label>{label}</label>
      <select value={puntoActivoId || ''} onChange={(e) => seleccionar(e.target.value)}>
        {puntos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.sucursal?.nombre || 'Sucursal'} — {p.descripcion || `${p.establecimiento}-${p.puntoEmision}`}
          </option>
        ))}
      </select>
    </div>
  );
}
