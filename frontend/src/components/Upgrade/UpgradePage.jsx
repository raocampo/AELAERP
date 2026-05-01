// ====================================
// UPGRADE PAGE — AELA
// Se muestra cuando el usuario accede directamente a una ruta bloqueada
// (ej: un usuario Lite escribe /compras en la URL)
// ====================================

import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import './Upgrade.css';

const PLANES = [
  {
    key: 'lite',
    nombre: 'Lite',
    color: '#F9A825',
    precioLabel: 'Gratuito',
    descripcion: 'Para negocios pequeños que emiten facturas y notas de venta.',
    modulos: [
      'Facturas electrónicas',
      'Notas de venta',
      'Gestión de clientes',
      'Catálogo de productos',
      'Configuración SRI',
      '1 usuario · 100 comprobantes/año',
    ],
  },
  {
    key: 'medium',
    nombre: 'Medium',
    color: '#7C3AED',
    precioLabel: 'Desde $15/mes',
    descripcion: 'Para negocios que necesitan control de caja, inventario y compras.',
    modulos: [
      'Todo lo de Lite +',
      'Caja diaria',
      'Punto de Venta (POS)',
      'Módulo de compras',
      'Control de inventario',
      'Hasta 3 usuarios · 1.000 comprobantes/año',
    ],
  },
  {
    key: 'pro',
    nombre: 'Pro',
    color: '#1976D2',
    precioLabel: 'Desde $30/mes',
    descripcion: 'Para empresas que requieren contabilidad, retenciones y ATS.',
    modulos: [
      'Todo lo de Medium +',
      'Retenciones',
      'Liquidaciones de compra',
      'ATS / Reportes tributarios',
      'Contabilidad completa',
      'Usuarios ilimitados · Comprobantes ilimitados',
    ],
  },
];

const MODULO_NOMBRES = {
  medium: 'Medium',
  pro:    'Pro',
};

export default function UpgradePage({ planRequerido = 'medium' }) {
  const navigate = useNavigate();
  const { planLabel } = useAuth();

  const planRequeridoNorm = planRequerido === 'full' ? 'pro' : planRequerido;
  const planObj = PLANES.find((p) => p.key === planRequeridoNorm) || PLANES[1];

  return (
    <div className="upgrade-page">

      {/* ── Header ── */}
      <div className="upgrade-header">
        <div className="upgrade-header-text">
          <span className="upgrade-lock-icon">🔒</span>
          <div className={`upgrade-required-badge ${planRequeridoNorm}`}>
            Requiere plan {MODULO_NOMBRES[planRequeridoNorm]}
          </div>
          <h2>Tu plan {planLabel} no incluye este módulo</h2>
          <p>
            Para acceder a esta sección necesitas el plan{' '}
            <strong>{planObj.nombre}</strong> o superior. Revisa a continuación
            lo que incluye cada plan y elige el que mejor se adapta a tu negocio.
          </p>
        </div>
        <button
          className="btn-upgrade-cerrar"
          onClick={() => navigate('/dashboard')}
          style={{ alignSelf: 'flex-start' }}
        >
          ← Volver
        </button>
      </div>

      {/* ── Cards de planes ── */}
      <div className="upgrade-planes">
        {PLANES.map((plan) => {
          const esPlanActual = plan.key === planLabel?.toLowerCase();
          const esRecomendado = plan.key === planRequeridoNorm;

          let cardClass = 'upgrade-plan-card disponible';
          if (esPlanActual) cardClass = 'upgrade-plan-card actual';
          if (esRecomendado) cardClass = 'upgrade-plan-card recomendado';

          return (
            <div
              key={plan.key}
              className={cardClass}
              style={{ '--plan-card-color': plan.color }}
            >
              {esPlanActual && <span className="tag-actual">Tu plan actual</span>}
              {esRecomendado && !esPlanActual && (
                <span className="tag-recomendado" style={{ background: plan.color }}>
                  Recomendado
                </span>
              )}

              <span
                className="upgrade-plan-badge-card"
                style={{ background: plan.color }}
              >
                {plan.nombre}
              </span>

              <p className="upgrade-plan-nombre">{plan.nombre}</p>
              <p className="upgrade-plan-precio">
                <strong>{plan.precioLabel}</strong>
              </p>

              <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 12px', lineHeight: 1.4 }}>
                {plan.descripcion}
              </p>

              <ul className="upgrade-plan-modulos">
                {plan.modulos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="upgrade-footer">
        <p className="upgrade-footer-texto">
          Los planes mensuales y anuales están disponibles con facturación y
          soporte incluidos. Para migración de datos o configuración asistida,{' '}
          <a
            href="mailto:ventas@aela.ec?subject=Solicitud%20de%20actualización%20de%20plan"
            target="_blank"
            rel="noreferrer"
          >
            contáctanos
          </a>.
        </p>
        <div className="upgrade-footer-acciones">
          <button
            className="btn-upgrade-cerrar"
            onClick={() => navigate('/dashboard')}
          >
            Volver al Dashboard
          </button>
          <a
            className={`btn-upgrade-contactar ${planRequeridoNorm}`}
            href="mailto:ventas@aela.ec?subject=Solicitud%20de%20actualización%20de%20plan"
            target="_blank"
            rel="noreferrer"
          >
            Solicitar actualización →
          </a>
        </div>
      </div>

    </div>
  );
}
