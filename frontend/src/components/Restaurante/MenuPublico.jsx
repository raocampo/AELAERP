import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import './MenuPublico.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

export default function MenuPublico() {
  const { slug, empresaId } = useParams();
  const [searchParams] = useSearchParams();
  const mesaParam = searchParams.get('mesa');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [llamando, setLlamando] = useState(false);
  const [avisoLlamada, setAvisoLlamada] = useState('');

  useEffect(() => {
    let ignore = false;
    // Instancia propia, sin tocar localStorage de sesión: esta página la
    // abre un cliente sin cuenta en su celular, y no debe interferir con
    // una sesión de administrador que pueda estar abierta en el mismo
    // navegador (ver nota en backend/routes/menuPublico.js).
    // `slug` es undefined en monoinstancia (ruta /menu/:empresaId, sin
    // segmento de slug) — no mandar el header en ese caso, para que
    // resolverTenant caiga al modo monoinstancia en vez de buscar un tenant
    // que no existe.
    axios.get(`${API_URL}/menu-publico/${empresaId}`, {
      headers: slug ? { 'X-Tenant-Slug': slug } : {},
      params: mesaParam ? { mesa: mesaParam } : undefined,
    })
      .then((res) => { if (!ignore) setDatos(res.data?.data || null); })
      .catch((err) => { if (!ignore) setError(err.response?.data?.mensaje || 'No se pudo cargar el menú'); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [slug, empresaId, mesaParam]);

  const llamarMesero = () => {
    if (!datos?.mesa?.id) return;
    setLlamando(true);
    setAvisoLlamada('');
    axios.post(`${API_URL}/menu-publico/${empresaId}/llamar-mesero`, { mesaId: datos.mesa.id }, {
      headers: slug ? { 'X-Tenant-Slug': slug } : {},
    })
      .then((res) => setAvisoLlamada(res.data?.mensaje || 'Mesero avisado'))
      .catch((err) => setAvisoLlamada(err.response?.data?.mensaje || 'No se pudo avisar al mesero'))
      .finally(() => setLlamando(false));
  };

  if (loading) {
    return <div className="menu-pub-page"><div className="menu-pub-loading">Cargando menú...</div></div>;
  }

  if (error || !datos) {
    return (
      <div className="menu-pub-page">
        <div className="menu-pub-loading">{error || 'Menú no disponible'}</div>
      </div>
    );
  }

  return (
    <div className="menu-pub-page">
      <header className="menu-pub-header">
        {datos.restaurante.logoUrl && (
          <img src={datos.restaurante.logoUrl} alt={datos.restaurante.nombre} className="menu-pub-logo" />
        )}
        <h1>{datos.restaurante.nombre}</h1>
        <p>Menú{datos.mesa ? ` · ${datos.mesa.nombre}` : ''}</p>
        {datos.mesa && (
          <div className="menu-pub-llamar">
            <button type="button" onClick={llamarMesero} disabled={llamando}>
              {llamando ? 'Avisando...' : '🔔 Llamar al mesero'}
            </button>
            {avisoLlamada && <span className="menu-pub-llamar-aviso">{avisoLlamada}</span>}
          </div>
        )}
      </header>

      {datos.categorias.length === 0 ? (
        <div className="menu-pub-loading">El menú todavía no tiene platos publicados.</div>
      ) : (
        datos.categorias.map((cat) => (
          <section key={cat.nombre} className="menu-pub-categoria">
            <h2>{cat.nombre}</h2>
            <div className="menu-pub-items">
              {cat.items.map((item) => (
                <div key={item.id} className="menu-pub-item">
                  {item.imagenUrl && (
                    <img src={item.imagenUrl} alt={item.nombre} className="menu-pub-item-img" />
                  )}
                  <div className="menu-pub-item-info">
                    <div className="menu-pub-item-nombre">{item.nombre}</div>
                    {item.descripcion && <div className="menu-pub-item-desc">{item.descripcion}</div>}
                  </div>
                  <div className="menu-pub-item-precio">${item.precio.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      <footer className="menu-pub-footer">Precios en dólares · Sujetos a cambio sin previo aviso</footer>
    </div>
  );
}
