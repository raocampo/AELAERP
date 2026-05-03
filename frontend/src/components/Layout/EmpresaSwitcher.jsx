// ====================================
// EMPRESA SWITCHER — AELA
// Selector de empresa activa para usuarios con acceso a múltiples empresas (macro empresa).
// Solo se renderiza cuando el usuario tiene ≥2 empresas disponibles.
// ====================================

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/useAuth';
import './EmpresaSwitcher.css';

export default function EmpresaSwitcher() {
  const { empresa, empresasDisponibles, cambiarEmpresa } = useAuth();
  const [abierto, setAbierto]     = useState(false);
  const [cargando, setCargando]   = useState(false);
  const ref = useRef(null);

  // Cerrar al hacer click fuera
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!empresasDisponibles || empresasDisponibles.length < 2) return null;

  const handleSeleccionar = async (empresaId) => {
    if (empresaId === empresa?.id || cargando) return;
    setCargando(true);
    setAbierto(false);
    await cambiarEmpresa(empresaId);
    setCargando(false);
  };

  const nombreActiva = empresa?.nombreComercial || empresa?.razonSocial || 'Empresa activa';

  return (
    <div className="emp-switcher" ref={ref}>
      <button
        className={`emp-switcher-trigger ${abierto ? 'open' : ''} ${cargando ? 'loading' : ''}`}
        onClick={() => !cargando && setAbierto((v) => !v)}
        title="Cambiar empresa activa"
      >
        <span className="emp-switcher-icon">🏢</span>
        <span className="emp-switcher-nombre">{cargando ? 'Cambiando…' : nombreActiva}</span>
        <span className="emp-switcher-arrow">{abierto ? '▴' : '▾'}</span>
      </button>

      {abierto && (
        <div className="emp-switcher-dropdown">
          <div className="emp-switcher-label">Empresas disponibles</div>
          {empresasDisponibles.map((emp) => (
            <button
              key={emp.id}
              className={`emp-switcher-item ${emp.id === empresa?.id ? 'active' : ''}`}
              onClick={() => handleSeleccionar(emp.id)}
            >
              <span className="emp-switcher-item-icon">
                {emp.esMatriz ? '🏛️' : '🏢'}
              </span>
              <span className="emp-switcher-item-info">
                <span className="emp-switcher-item-nombre">
                  {emp.nombreComercial || emp.razonSocial}
                </span>
                <span className="emp-switcher-item-ruc">{emp.ruc}</span>
              </span>
              {emp.id === empresa?.id && <span className="emp-switcher-item-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
