import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import '../Compras/ListaCompras.css';

export default function EtiquetasProductos() {
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [lista, setLista] = useState([]); // [{ productoId, codigoPrincipal, codigoAuxiliar, nombre, precioUnitario, cantidad }]
  const [ancho, setAncho] = useState(80);
  const [imprimiendo, setImprimiendo] = useState(false);

  useEffect(() => {
    api.get('/impresora/config')
      .then((r) => { if (r.data?.data?.impresoraAncho) setAncho(r.data.data.impresoraAncho); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) { setResultados([]); return; }
    let ignore = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      api.get('/productos/buscar', { params: { q: busqueda.trim() } })
        .then((r) => { if (!ignore) setResultados(r.data?.data || []); })
        .catch(() => {})
        .finally(() => { if (!ignore) setBuscando(false); });
    }, 250);
    return () => { ignore = true; clearTimeout(timer); };
  }, [busqueda]);

  const agregarProducto = (p) => {
    if (lista.some((item) => item.productoId === p.id)) {
      toast('Ese producto ya está en la lista');
      return;
    }
    setLista((prev) => [...prev, {
      productoId: p.id,
      codigoPrincipal: p.codigoPrincipal,
      codigoAuxiliar: p.codigoAuxiliar || '',
      nombre: p.nombre,
      precioUnitario: Number(p.precioUnitario || 0),
      cantidad: 1,
    }]);
    setBusqueda('');
    setResultados([]);
  };

  const quitarProducto = (productoId) => {
    setLista((prev) => prev.filter((item) => item.productoId !== productoId));
  };

  const actualizarCantidad = (productoId, cantidad) => {
    setLista((prev) => prev.map((item) => item.productoId === productoId ? { ...item, cantidad: Math.max(1, parseInt(cantidad, 10) || 1) } : item));
  };

  const totalEtiquetas = lista.reduce((s, item) => s + item.cantidad, 0);

  const imprimir = async () => {
    if (lista.length === 0) return;
    setImprimiendo(true);
    try {
      const res = await api.post('/impresora/etiquetas/imprimir', {
        ancho,
        productos: lista.map((item) => ({ productoId: item.productoId, cantidad: item.cantidad })),
      });
      toast.success(res.data?.mensaje || 'Etiquetas enviadas a la impresora');
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al imprimir las etiquetas');
    } finally {
      setImprimiendo(false);
    }
  };

  return (
    <div className="compras-page">
      <div className="compras-header">
        <div>
          <h1>Etiquetas de Productos</h1>
          <p>Genera e imprime etiquetas con código de barras para pegar en los productos físicos.</p>
        </div>
        <div className="compras-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/productos')}>Volver a Productos</button>
        </div>
      </div>

      <section className="compras-card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
            <label>
              Buscar producto por código o nombre
              <input
                autoFocus
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Escanea o escribe el código de barras / nombre..."
              />
            </label>
            {(buscando || resultados.length > 0) && busqueda.trim().length >= 2 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto',
              }}>
                {buscando && <div style={{ padding: '0.6rem' }}>Buscando...</div>}
                {!buscando && resultados.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => agregarProducto(p)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', width: '100%',
                      padding: '0.5rem 0.75rem', textAlign: 'left', background: 'transparent',
                      border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                    }}
                  >
                    <span><strong>{p.codigoPrincipal}</strong> — {p.nombre}</span>
                    <span style={{ color: '#64748b' }}>{p.codigoAuxiliar || ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            Ancho de papel
            <select value={ancho} onChange={(e) => setAncho(parseInt(e.target.value, 10))}>
              <option value={58}>58mm</option>
              <option value={80}>80mm</option>
            </select>
          </label>
        </div>
      </section>

      <section className="compras-card">
        {lista.length === 0 ? (
          <div className="compras-empty">Busca y agrega productos para generar sus etiquetas.</div>
        ) : (
          <>
            <div className="compras-table-wrap">
              <table className="compras-table">
                <thead>
                  <tr>
                    <th>Código</th><th>Nombre</th><th>Precio</th><th>Copias</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((item) => (
                    <tr key={item.productoId}>
                      <td data-label="Código"><strong>{item.codigoAuxiliar || item.codigoPrincipal}</strong></td>
                      <td data-label="Nombre">{item.nombre}</td>
                      <td data-label="Precio">${item.precioUnitario.toFixed(2)}</td>
                      <td data-label="Copias">
                        <input
                          type="number" min="1" value={item.cantidad}
                          onChange={(e) => actualizarCantidad(item.productoId, e.target.value)}
                          style={{ width: 70 }}
                        />
                      </td>
                      <td>
                        <button className="btn-secondary" onClick={() => quitarProducto(item.productoId)}>Quitar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Vista previa simple de la primera etiqueta ─────────────── */}
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.9rem', color: '#64748b' }}>Vista previa (primer producto)</h3>
              <div style={{
                width: ancho === 58 ? 220 : 300, border: '1px dashed #94a3b8', borderRadius: 6,
                padding: '0.75rem', textAlign: 'center', fontFamily: 'monospace', background: '#f8fafc',
              }}>
                <strong>{lista[0].nombre}</strong>
                <div>${lista[0].precioUnitario.toFixed(2)}</div>
                <div style={{
                  marginTop: '0.5rem', letterSpacing: 2, fontSize: '1.5rem', background: '#fff',
                  padding: '0.25rem', border: '1px solid #cbd5e1',
                }}>
                  ▌│▌││▌│▌▌│▌││▌
                </div>
                <div style={{ fontSize: '0.75rem' }}>{lista[0].codigoAuxiliar || lista[0].codigoPrincipal}</div>
              </div>
            </div>

            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <button className="btn-primary" onClick={imprimir} disabled={imprimiendo}>
                {imprimiendo ? 'Imprimiendo...' : `🖨 Imprimir ${totalEtiquetas} etiqueta(s)`}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
