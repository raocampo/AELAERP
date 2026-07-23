import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { parseFechaLocal } from '../../utils/fecha';
import './ListaCompras.css';
import './DetalleCompra.css';

function fmtFecha(valor) {
  if (!valor) return 'Sin fecha';
  const fecha = parseFechaLocal(valor);
  return Number.isNaN(fecha.getTime()) ? 'Sin fecha' : fecha.toLocaleDateString('es-EC');
}

const ESTADOS = [
  { value: 'PENDIENTE', label: 'Pendientes' },
  { value: 'RESUELTO', label: 'Resueltos' },
  { value: 'IGNORADO', label: 'Ignorados' },
  { value: 'TODOS', label: 'Todos' },
];

// ─── Modal: asignar a un producto existente ──────────────────────────────────
function ModalAsignar({ item, onClose, onAsignado }) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);

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

  const asignar = async (producto) => {
    setEnviando(true);
    try {
      const res = await api.post(`/compras/pendientes/${item.id}/asignar`, { productoId: producto.id });
      toast.success(res.data?.mensaje || 'Ítem asignado correctamente');
      onAsignado();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al asignar el ítem');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="dc-modal-overlay" onClick={onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Asignar a producto existente</h3>
        <p style={{ marginTop: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Se sumará la cantidad <strong>{Number(item.cantidad).toFixed(3)}</strong> de "{item.descripcion}"
          al stock del producto que elijas, sin modificar su costo.
        </p>
        <input
          autoFocus
          placeholder="Buscar producto por código o nombre..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: '0.75rem' }}>
          {buscando && <div className="compras-empty">Buscando...</div>}
          {!buscando && busqueda.trim().length >= 2 && resultados.length === 0 && (
            <div className="compras-empty">Sin resultados</div>
          )}
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={enviando}
              onClick={() => asignar(p)}
              style={{
                display: 'flex', justifyContent: 'space-between', width: '100%',
                padding: '0.5rem 0.75rem', marginBottom: '0.25rem', textAlign: 'left',
                background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer',
              }}
            >
              <span><strong>{p.codigoPrincipal}</strong> — {p.nombre}</span>
              <span style={{ color: '#64748b' }}>Stock: {Number(p.stockActual || 0).toFixed(2)}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: '1rem', textAlign: 'right' }}>
          <button className="btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: crear producto nuevo (opt-in explícito) ──────────────────────────
function ModalCrearProducto({ item, onClose, onCreado }) {
  const [precioUnitario, setPrecioUnitario] = useState('0');
  const [tarifaIva, setTarifaIva] = useState('15');
  const [inventariable, setInventariable] = useState(true);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    try {
      const res = await api.post(`/compras/pendientes/${item.id}/crear-producto`, {
        precioUnitario: Number(precioUnitario) || 0,
        tarifaIva: Number(tarifaIva) || 0,
        inventariable,
      });
      toast.success(res.data?.mensaje || 'Producto creado correctamente');
      onCreado();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al crear el producto');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="dc-modal-overlay" onClick={onClose}>
      <div className="dc-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Crear producto nuevo</h3>
        <p style={{ marginTop: 0, color: '#64748b', fontSize: '0.85rem' }}>
          Código <strong>{item.codigoPrincipal}</strong> — {item.descripcion} (cantidad inicial: {Number(item.cantidad).toFixed(3)})
        </p>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          Precio de venta (PVP)
          <input type="number" step="0.01" value={precioUnitario} onChange={(e) => setPrecioUnitario(e.target.value)} />
        </label>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          % IVA
          <select value={tarifaIva} onChange={(e) => setTarifaIva(e.target.value)}>
            <option value="0">0%</option>
            <option value="5">5%</option>
            <option value="15">15%</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input type="checkbox" checked={inventariable} onChange={(e) => setInventariable(e.target.checked)} />
          Manejar en inventario
        </label>
        <div style={{ marginTop: '1rem', textAlign: 'right' }}>
          <button className="btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn-primary" onClick={enviar} disabled={enviando} style={{ marginLeft: '0.5rem' }}>
            {enviando ? 'Creando...' : 'Crear producto'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ObsequiosPendientes() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState('PENDIENTE');
  const [busqueda, setBusqueda] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAsignar, setModalAsignar] = useState(null);
  const [modalCrear, setModalCrear] = useState(null);

  const cargar = () => {
    setLoading(true);
    api.get('/compras/pendientes', { params: { estado, busqueda: busqueda || undefined } })
      .then((r) => setItems(r.data?.data || []))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'Error al cargar obsequios pendientes'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    api.get('/compras/pendientes', { params: { estado, busqueda: busqueda || undefined } })
      .then((r) => { if (!ignore) setItems(r.data?.data || []); })
      .catch((err) => { if (!ignore) toast.error(err.response?.data?.mensaje || 'Error al cargar obsequios pendientes'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [estado, busqueda]);

  const ignorar = async (item) => {
    if (!window.confirm(`¿Ignorar "${item.descripcion}"? No se moverá inventario.`)) return;
    try {
      await api.post(`/compras/pendientes/${item.id}/ignorar`);
      toast.success('Ítem ignorado');
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al ignorar el ítem');
    }
  };

  return (
    <div className="compras-page">
      <div className="compras-header">
        <div>
          <h1>Obsequios pendientes</h1>
          <p>
            Ítems de compra facturados a $0.00 (regalos/combos de proveedor) que no se pudieron emparejar
            automáticamente con un producto. Elige a qué producto sumar la cantidad, ignóralos, o crea un
            producto nuevo si corresponde.
          </p>
        </div>
        <div className="compras-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/compras')}>Volver a Compras</button>
        </div>
      </div>

      <section className="compras-filtros">
        {ESTADOS.map((e) => (
          <button
            key={e.value}
            className={estado === e.value ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setEstado(e.value)}
          >
            {e.label}
          </button>
        ))}
        <input
          placeholder="Buscar por código o descripción..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </section>

      <section className="compras-card">
        {loading ? (
          <div className="compras-empty">Cargando...</div>
        ) : items.length === 0 ? (
          <div className="compras-empty">No hay ítems en este estado.</div>
        ) : (
          <div className="compras-table-wrap">
            <table className="compras-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Factura</th><th>Proveedor</th>
                  <th>Código</th><th>Descripción</th><th>Cantidad</th><th>Prefijo</th><th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Fecha">{fmtFecha(item.compra?.fechaEmision)}</td>
                    <td data-label="Factura">{item.compra?.numeroFactura || '—'}</td>
                    <td data-label="Proveedor">{item.compra?.razonSocialProveedor || '—'}</td>
                    <td data-label="Código"><strong>{item.codigoPrincipal}</strong></td>
                    <td data-label="Descripción">{item.descripcion}</td>
                    <td data-label="Cantidad">{Number(item.cantidad).toFixed(3)}</td>
                    <td data-label="Prefijo">
                      {item.prefijoDetectado
                        ? <span title="Prefijo detectado">{item.prefijoDetectado}</span>
                        : <span className="compras-muted">—</span>}
                    </td>
                    <td data-label="Acciones">
                      {item.estado === 'PENDIENTE' ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button className="btn-secondary" onClick={() => setModalAsignar(item)}>Asignar</button>
                          <button className="btn-secondary" onClick={() => setModalCrear(item)}>Crear producto</button>
                          <button className="btn-secondary" onClick={() => ignorar(item)}>Ignorar</button>
                        </div>
                      ) : item.estado === 'RESUELTO' ? (
                        <span title="Resuelto">
                          ✅ {item.productoAsignado ? `→ ${item.productoAsignado.codigoPrincipal}` : ''}
                        </span>
                      ) : (
                        <span title="Ignorado">🚫 Ignorado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalAsignar && (
        <ModalAsignar
          item={modalAsignar}
          onClose={() => setModalAsignar(null)}
          onAsignado={() => { setModalAsignar(null); cargar(); }}
        />
      )}
      {modalCrear && (
        <ModalCrearProducto
          item={modalCrear}
          onClose={() => setModalCrear(null)}
          onCreado={() => { setModalCrear(null); cargar(); }}
        />
      )}
    </div>
  );
}
