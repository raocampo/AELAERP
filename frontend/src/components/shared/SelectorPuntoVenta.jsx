import { useEffect, useState } from 'react';
import api from '../../services/api';
import './SelectorPuntoVenta.css';

const STORAGE_KEY = 'aela_caja_activa';

// Aplana una caja física (que trae su punto de emisión embebido) al mismo
// contrato que ya esperan los formularios padre: un objeto con
// establecimiento/puntoEmision string en el nivel superior (no
// caja.puntoEmision.establecimiento) — así PuntoVenta.jsx/FormFactura.jsx/
// FormGuiaRemision.jsx no necesitan ningún cambio al armar su payload.
function aplanarCaja(caja) {
  if (!caja) return null;
  return {
    id: caja.id,
    establecimiento: caja.puntoEmision?.establecimiento,
    puntoEmision: caja.puntoEmision?.puntoEmision,
    descripcion: caja.nombre,
    sucursal: caja.puntoEmision?.sucursal,
  };
}

/**
 * Selector de caja física activa, para empresas con más de una sucursal,
 * punto de emisión o caja. Se mantiene oculto si la empresa solo tiene una
 * caja (caso de la inmensa mayoría de tenants hoy) — en ese caso la única
 * caja se selecciona automáticamente sin fricción visual. Varias cajas
 * pueden compartir un mismo punto de emisión (misma secuencia SRI).
 *
 * Notifica al padre vía onChange(puntoVenta) cada vez que hay una caja
 * resuelta — incluyendo la primera carga — para que el padre pueda incluir
 * { establecimiento, puntoEmision } en el payload al crear el documento.
 */
export default function SelectorPuntoVenta({ onChange, label = 'Caja:' }) {
  const [cajas, setCajas] = useState([]);
  const [cajaActivaId, setCajaActivaId] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let ignore = false;
    api.get('/cajas/activas')
      .then((res) => {
        if (ignore) return;
        const lista = res.data?.data || [];
        setCajas(lista);

        const guardadoId = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        const inicial = lista.find((c) => c.id === guardadoId) || lista[0] || null;
        setCajaActivaId(inicial?.id || null);
        if (inicial) onChange?.(aplanarCaja(inicial));
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setCargando(false); });
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seleccionar = (id) => {
    const idNum = parseInt(id, 10);
    const caja = cajas.find((c) => c.id === idNum) || null;
    setCajaActivaId(idNum);
    if (caja) {
      localStorage.setItem(STORAGE_KEY, String(idNum));
      onChange?.(aplanarCaja(caja));
    }
  };

  // Con 0 o 1 caja no hay nada que elegir — no se muestra selector, la única
  // caja (o ninguna, si el tenant no la tiene aún) ya se notificó arriba.
  if (cargando || cajas.length <= 1) return null;

  return (
    <div className="selector-punto-venta">
      <label>{label}</label>
      <select value={cajaActivaId || ''} onChange={(e) => seleccionar(e.target.value)}>
        {cajas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.puntoEmision?.sucursal?.nombre || 'Sucursal'} — {c.nombre} ({c.puntoEmision?.establecimiento}-{c.puntoEmision?.puntoEmision})
          </option>
        ))}
      </select>
    </div>
  );
}
