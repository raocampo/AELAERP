// Ruta de acceso al sistema de un tenant: /acceso/:slug
// Guarda el slug en localStorage y redirige al login.
// URL limpia sin ?tenant= visible.

import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function AccesoTenant() {
  const { slug }   = useParams();
  const navigate   = useNavigate();

  useEffect(() => {
    if (slug?.trim()) {
      localStorage.setItem('aela_tenant_slug', slug.trim().toLowerCase());
    }
    navigate('/login', { replace: true });
  }, [slug, navigate]);

  return null;
}
