// Ruta de acceso al sistema de un tenant: /:slug
// Guarda el slug en localStorage, limpia la sesión anterior y redirige al login.
// URL limpia: https://aela.corpsimtelec.com/torneosloja

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SESSION_STORAGE_KEYS } from '../../services/api';

export default function AccesoTenant() {
  const { slug }   = useParams();
  const navigate   = useNavigate();

  useEffect(() => {
    const slugNorm = slug?.trim().toLowerCase();
    if (!slugNorm) { navigate('/login', { replace: true }); return; }

    // Detectar si el usuario viene de una sesión de otro tenant (o sin tenant).
    // Si el slug cambió respecto a la sesión activa, limpiar todo para forzar re-login.
    const slugActual = localStorage.getItem('aela_tenant_slug');
    if (slugActual !== slugNorm) {
      SESSION_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    }

    localStorage.setItem('aela_tenant_slug', slugNorm);
    navigate('/login', { replace: true });
  }, [slug, navigate]);

  return null;
}
