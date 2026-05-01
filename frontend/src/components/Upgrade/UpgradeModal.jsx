// ====================================
// UPGRADE MODAL — AELA
// Se activa cuando el usuario hace click en un módulo bloqueado del sidebar.
// Muestra comparativo de planes y CTA para actualizar.
// ====================================

import './Upgrade.css';

// ─── Datos de cada plan ─────────────────────────────────────────────────────
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

// ─── Textos por módulo bloqueado ─────────────────────────────────────────────
const MODULO_LABELS = {
  '/caja':                  'Caja Diaria',
  '/pos':                   'Punto de Venta (POS)',
  '/compras':               'Compras',
  '/inventario':            'Inventario',
  '/retenciones':           'Retenciones',
  '/liquidaciones':         'Liquidaciones de compra',
  '/ats':                   'ATS',
  '/reportes-tributarios':  'Reportes Tributarios',
  '/contabilidad':          'Contabilidad',
  '/finanzas':              'Hub Financiero',
};

export default function UpgradeModal({ planRequerido, moduloPath, onClose }) {
  const planRequeridoNorm = planRequerido === 'full' ? 'pro' : planRequerido;
  const nombreModulo = MODULO_LABELS[moduloPath] || 'este módulo';
  const planObj = PLANES.find((p) => p.key === planRequeridoNorm) || PLANES[1];

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="upgrade-overlay" onClick={handleOverlayClick}>
      <div className="upgrade-modal" role="dialog" aria-modal="true">

        {/* ── Header ── */}
        <div className="upgrade-header">
          <div className="upgrade-header-text">
            <span className="upgrade-lock-icon">🔒</span>
            <div
              className={`upgrade-required-badge ${planRequeridoNorm}`}
              style={{ '--plan-card-color': planObj.color }}
            >
              Requiere plan {planObj.nombre}
            </div>
            <h2>{nombreModulo}</h2>
            <p>
              {nombreModulo} está disponible a partir del plan{' '}
              <strong>{planObj.nombre}</strong>. Actualiza tu plan para
              acceder a este y otros módulos adicionales.
            </p>
          </div>
          <button className="upgrade-close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* ── Cards de planes ── */}
        <div className="upgrade-planes">
          {PLANES.map((plan) => {
            const esActual = plan.key === 'lite'; // se reemplaza cuando venga del contexto
            const esRecomendado = plan.key === planRequeridoNorm;

            let cardClass = 'upgrade-plan-card disponible';
            if (esActual) cardClass = 'upgrade-plan-card actual';
            if (esRecomendado) cardClass = 'upgrade-plan-card recomendado';

            return (
              <div
                key={plan.key}
                className={cardClass}
                style={{ '--plan-card-color': plan.color }}
              >
                {esActual && <span className="tag-actual">Tu plan</span>}
                {esRecomendado && (
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
            Los planes mensuales y anuales están disponibles. Contáctanos para
            activar tu cuenta o migrar al plan que necesitas.
          </p>
          <div className="upgrade-footer-acciones">
            <button className="btn-upgrade-cerrar" onClick={onClose}>
              Cerrar
            </button>
            <a
              className={`btn-upgrade-contactar ${planRequeridoNorm}`}
              href="mailto:ventas@aela.ec?subject=Solicitud%20de%20actualización%20de%20plan"
              target="_blank"
              rel="noreferrer"
            >
              Actualizar plan →
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}
