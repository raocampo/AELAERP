import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { parseFechaLocal } from '../../utils/fecha';
import { adivinarUnidadesDesdeNombre } from '../../utils/adivinarPaquete';
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

const MOTIVOS = [
  { value: 'TODOS', label: 'Todos los motivos' },
  { value: 'POSIBLE_DUPLICADO', label: '⚠️ Posibles duplicados' },
  { value: 'REGALO', label: '🎁 Obsequios/combos' },
];

// ─── Modal: asignar a un producto existente ──────────────────────────────────
function ModalAsignar({ item, productoPreseleccionado, onClose, onAsignado }) {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [productoElegido, setProductoElegido] = useState(productoPreseleccionado || null);
  // No se asume la unidad adivinada del nombre — un ítem que "suena" a X8
  // puede venderse igual completo, sin dividirse (ej. una lonchera de
  // salchichas). Arranca en 1 (sin dividir); la sugerencia se ofrece aparte.
  const [unidadesEquivalentes, setUnidadesEquivalentes] = useState('1');
  const sugerenciaUnidades = adivinarUnidadesDesdeNombre(item.descripcion);
  const [recordarCodigo, setRecordarCodigo] = useState(true);

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

  const confirmar = async () => {
    if (!productoElegido) return;
    setEnviando(true);
    try {
      const res = await api.post(`/compras/pendientes/${item.id}/asignar`, {
        productoId: productoElegido.id,
        unidadesEquivalentes: Math.max(1, parseInt(unidadesEquivalentes, 10) || 1),
        recordarCodigo,
      });
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
          La factura dice <strong>"{item.descripcion}"</strong> (código {item.codigoPrincipal}) — elige a cuál
          producto de tu catálogo corresponde.
        </p>

        {!productoElegido ? (
          <>
            <input
              autoFocus
              placeholder="Buscar producto por código o nombre..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e2e8f0', borderRadius: 8, padding: '.5rem .6rem', fontSize: '.9rem' }}
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
                  onClick={() => setProductoElegido(p)}
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
          </>
        ) : (
          <>
            <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.75rem' }}>
              <strong>{productoElegido.codigoPrincipal}</strong> — {productoElegido.nombre}
              <div style={{ fontSize: '.8rem', color: '#64748b' }}>Stock actual: {Number(productoElegido.stockActual || 0).toFixed(2)}</div>
              {!productoPreseleccionado && (
                <button type="button" className="btn-secondary" style={{ marginTop: 6 }} onClick={() => setProductoElegido(null)}>
                  Cambiar producto
                </button>
              )}
            </div>
            <p style={{ fontSize: '.85rem', color: '#1e293b', margin: '0 0 .3rem', fontWeight: 600 }}>
              ¿"{item.descripcion}" se vende TAL CUAL (como {productoElegido.nombre}), o representa varias
              unidades de {productoElegido.nombre} que se venden sueltas?
            </p>
            <label style={{ display: 'block', marginBottom: '0.3rem' }}>
              Unidades de {productoElegido.nombre} que representa cada "{item.descripcion}"
              <input
                type="number" min="1" step="1"
                value={unidadesEquivalentes}
                onChange={(e) => setUnidadesEquivalentes(e.target.value)}
              />
            </label>
            <p style={{ fontSize: '.78rem', color: '#64748b', margin: '0 0 .5rem' }}>
              Deja <strong>1</strong> si se vende completo, sin dividir.
              {sugerenciaUnidades > 1 && Number(unidadesEquivalentes) !== sugerenciaUnidades && (
                <>
                  {' '}El nombre sugiere que trae {sugerenciaUnidades} unidades — si esas SÍ se venden sueltas,{' '}
                  <button
                    type="button"
                    onClick={() => setUnidadesEquivalentes(String(sugerenciaUnidades))}
                    style={{ background: 'none', border: 'none', padding: 0, color: '#7C3AED', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                  >
                    usar {sugerenciaUnidades}
                  </button>.
                </>
              )}
            </p>
            <p style={{ fontSize: '.8rem', color: '#64748b', marginTop: 0 }}>
              Se sumarán {Number(item.cantidad).toFixed(3)} × {Math.max(1, parseInt(unidadesEquivalentes, 10) || 1)} ={' '}
              <strong>{(Number(item.cantidad) * Math.max(1, parseInt(unidadesEquivalentes, 10) || 1)).toFixed(3)}</strong> al
              stock de {productoElegido.nombre}, sin modificar su costo.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={recordarCodigo} onChange={(e) => setRecordarCodigo(e.target.checked)} />
              Recordar el código {item.codigoPrincipal} para que la próxima compra ya vaya directo a este producto
            </label>
          </>
        )}

        <div style={{ marginTop: '1rem', textAlign: 'right' }}>
          <button className="btn-secondary" onClick={onClose} disabled={enviando}>Cancelar</button>
          {productoElegido && (
            <button className="btn-primary" onClick={confirmar} disabled={enviando} style={{ marginLeft: '0.5rem' }}>
              {enviando ? 'Asignando...' : 'Confirmar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: crear producto nuevo (opt-in explícito) ──────────────────────────
function ModalCrearProducto({ item, onClose, onCreado }) {
  // Precargados desde la línea de compra que originó este ítem pendiente
  // (costo y PVP ya calculados/editados ahí) — antes siempre arrancaba en
  // $0.00 aunque la compra ya tuviera el precio correcto.
  const [precioUnitario, setPrecioUnitario] = useState(String(item.precioVentaReferencial ?? '0'));
  const [tarifaIva, setTarifaIva] = useState(String(item.porcentajeIva ?? '15'));
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
          {item.costoUnitario != null && (
            <> — costo de compra: <strong>${Number(item.costoUnitario).toFixed(4)}</strong></>
          )}
        </p>
        <label style={{ display: 'block', marginBottom: '0.5rem' }}>
          Precio de venta (PVP)
          <input type="number" step="0.0001" value={precioUnitario} onChange={(e) => setPrecioUnitario(e.target.value)} />
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
  const [motivo, setMotivo] = useState('TODOS');
  const [busqueda, setBusqueda] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalAsignar, setModalAsignar] = useState(null);
  const [modalCrear, setModalCrear] = useState(null);

  const cargar = () => {
    setLoading(true);
    api.get('/compras/pendientes', { params: { estado, motivo, busqueda: busqueda || undefined } })
      .then((r) => setItems(r.data?.data || []))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'Error al cargar ítems pendientes'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    api.get('/compras/pendientes', { params: { estado, motivo, busqueda: busqueda || undefined } })
      .then((r) => { if (!ignore) setItems(r.data?.data || []); })
      .catch((err) => { if (!ignore) toast.error(err.response?.data?.mensaje || 'Error al cargar ítems pendientes'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [estado, motivo, busqueda]);

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

  const usarSugerido = (item) => {
    if (!item.productoSugerido) return;
    setModalAsignar({ ...item, __preseleccionar: true });
  };

  return (
    <div className="compras-page">
      <div className="compras-header">
        <div>
          <h1>Ítems de compra por revisar</h1>
          <p>
            Ítems de detalle de una compra que necesitan tu confirmación antes de afectar el inventario:
            regalos/combos facturados a $0.00 sin emparejar, y posibles productos duplicados (nombre parecido
            a uno que ya tienes en catálogo, ej. "cable #8 THHN" vs "cable # 8 color verde"). Asigna al
            producto correcto, ignora, o crea uno nuevo si de verdad corresponde.
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
        <select value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ marginLeft: '.5rem' }}>
          {MOTIVOS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
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
                  <th>Código</th><th>Descripción</th><th>Cantidad</th><th>Motivo / Sugerencia</th><th>Acciones</th>
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
                    <td data-label="Motivo / Sugerencia">
                      {item.motivo === 'POSIBLE_DUPLICADO' ? (
                        <div>
                          <span style={{ color: '#b45309', fontWeight: 600 }}>⚠️ Posible duplicado</span>
                          {item.productoSugerido && (
                            <div style={{ fontSize: '.8rem', marginTop: 2 }}>
                              ¿Es <strong>{item.productoSugerido.codigoPrincipal}</strong> — {item.productoSugerido.nombre}?
                            </div>
                          )}
                        </div>
                      ) : item.prefijoDetectado ? (
                        <span title="Prefijo detectado">🎁 Prefijo {item.prefijoDetectado}</span>
                      ) : (
                        <span className="compras-muted">🎁 Regalo/combo</span>
                      )}
                    </td>
                    <td data-label="Acciones">
                      {item.estado === 'PENDIENTE' ? (
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          {item.productoSugerido && (
                            <button className="btn-primary" onClick={() => usarSugerido(item)}>
                              Sí, es el mismo
                            </button>
                          )}
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
          productoPreseleccionado={modalAsignar.__preseleccionar ? modalAsignar.productoSugerido : null}
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
