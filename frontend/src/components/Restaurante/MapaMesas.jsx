import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';
import './Restaurante.css';

function ModalMenuQR({ mesa, onClose }) {
  const { empresa } = useAuth();
  const [qrUrl, setQrUrl] = useState(null);
  const [urlPublica, setUrlPublica] = useState('');

  useEffect(() => {
    // Sin slug (monoinstancia — Railway dedicado por cliente, sin SaaS
    // multi-tenant) la ruta es /menu/:empresaId a secas; con slug real
    // (SaaS) es /menu/:slug/:empresaId. Ver App.jsx — un slug vacío en el
    // path produce /menu//1, que no matchea ninguna ruta.
    // Con `mesa` (QR impreso para UNA mesa en particular) se agrega
    // ?mesa=<id> — MenuPublico.jsx lo usa para mostrar el botón "Llamar al
    // mesero" ya sabiendo de qué mesa viene, sin que el cliente tenga que
    // escribir el número a mano.
    const slug = localStorage.getItem('aela_tenant_slug') || '';
    const base = `${window.location.origin}/menu/${slug ? `${slug}/` : ''}${empresa?.id}`;
    const publica = mesa ? `${base}?mesa=${mesa.id}` : base;
    setUrlPublica(publica);

    let objectUrl = null;
    api.get('/mesas/menu/qr', { params: { url: publica }, responseType: 'blob' })
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data);
        setQrUrl(objectUrl);
      })
      .catch(() => toast.error('No se pudo generar el código QR'));

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [empresa?.id, mesa]);

  const copiarUrl = () => {
    navigator.clipboard?.writeText(urlPublica);
    toast.success('Enlace copiado');
  };

  return (
    <div className="rest-modal-overlay">
      <div className="rest-modal" onClick={(e) => e.stopPropagation()}>
        <h2>📋 Menú Digital{mesa ? ` — ${mesa.nombre}` : ''}</h2>
        <p style={{ color: '#64748b', fontSize: '.85rem', marginTop: -8 }}>
          {mesa
            ? `Imprime este código y pégalo en ${mesa.nombre} — el cliente ve el menú y puede llamar al mesero desde ahí, sin instalar nada.`
            : 'Imprime este código y pégalo en las mesas — tus clientes lo escanean con la cámara de su celular y ven el menú al instante, sin instalar nada.'}
        </p>
        {qrUrl ? (
          <img src={qrUrl} alt="QR del menú digital" style={{ display: 'block', margin: '0 auto', width: 220, height: 220 }} />
        ) : (
          <div className="rest-empty">Generando código QR...</div>
        )}
        <label style={{ marginTop: 12 }}>
          <span style={{ fontSize: '.8rem', color: '#64748b', fontWeight: 600 }}>Enlace del menú</span>
          <input value={urlPublica} readOnly onClick={(e) => e.target.select()} style={{ width: '100%', marginTop: 4 }} />
        </label>
        <div className="rest-form-actions">
          <button type="button" className="btn-secondary" onClick={copiarUrl}>Copiar enlace</button>
          {qrUrl && (
            <a href={qrUrl} download="menu-qr.png" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              Descargar QR
            </a>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

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
  const [modalQR, setModalQR] = useState(null); // null=cerrado, true=QR general, {mesa}=QR de una mesa
  const [llamadas, setLlamadas] = useState([]);

  const cargar = () => {
    setLoading(true);
    api.get('/mesas')
      .then((r) => setMesas(r.data?.data || []))
      .catch((err) => toast.error(err.response?.data?.mensaje || 'No se pudieron cargar las mesas'))
      .finally(() => setLoading(false));
  };

  useEffect(cargar, []);

  // Llamadas de servicio (botón "Llamar al mesero" del menú por QR) — se
  // revisan por polling, igual que la Vista de Cocina; no hay WebSocket en
  // este backend.
  const cargarLlamadas = () => {
    api.get('/mesas/llamadas/pendientes')
      .then((r) => setLlamadas(r.data?.data || []))
      .catch(() => {});
  };
  useEffect(() => {
    cargarLlamadas();
    const id = setInterval(cargarLlamadas, 15_000);
    return () => clearInterval(id);
  }, []);

  const atenderLlamada = async (llamada) => {
    try {
      await api.post(`/mesas/llamadas/${llamada.id}/atender`);
      setLlamadas((prev) => prev.filter((l) => l.id !== llamada.id));
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo marcar la llamada como atendida');
    }
  };

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
          <button className="btn-secondary" onClick={() => setModalQR(true)}>📋 Menú Digital (QR)</button>
          <button className="btn-secondary" onClick={() => setModoAdmin((v) => !v)}>
            {modoAdmin ? 'Salir de edición' : '⚙️ Administrar mesas'}
          </button>
          {modoAdmin && (
            <button className="btn-primary" onClick={() => setModalMesa({})}>+ Nueva mesa</button>
          )}
        </div>
      </div>

      {llamadas.length > 0 && (
        <div className="rest-llamadas-banner">
          {llamadas.map((l) => (
            <div key={l.id} className="rest-llamada-item">
              🔔 <strong>{l.mesa?.nombre}</strong> está llamando al mesero
              <button type="button" className="btn-secondary" onClick={() => atenderLlamada(l)}>Atender</button>
            </div>
          ))}
        </div>
      )}

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
                    {mesa.comanda.tieneCuentaDividida && (
                      <div className="rest-mesa-badge">🔀 cuenta dividida</div>
                    )}
                  </>
                ) : (
                  <div className="rest-mesa-estado">
                    {abriendo === mesa.id ? 'Abriendo...' : 'Libre'}
                  </div>
                )}
                {modoAdmin && (
                  <>
                    <div className="rest-mesa-edit">✏️ Editar</div>
                    <button
                      type="button"
                      className="rest-mesa-qr-btn"
                      onClick={(e) => { e.stopPropagation(); setModalQR({ mesa }); }}
                      title={`Generar QR solo para ${mesa.nombre}`}
                    >
                      📋 QR
                    </button>
                  </>
                )}
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
      {modalQR && <ModalMenuQR mesa={modalQR.mesa || null} onClose={() => setModalQR(null)} />}
    </div>
  );
}
