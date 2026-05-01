import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { tienePermiso } from '../../utils/roles';
import './FinanzasHub.css';

const modulos = [
  {
    titulo: 'Facturas',
    icono: '🧾',
    descripcion: 'Emisión de facturas electrónicas tipo 01. Firma XAdES-BES, envío SOAP al SRI y generación del RIDE en PDF.',
    ruta: '/facturas',
    color: '#6366f1',
    permiso: 'facturacion.ver',
    acciones: [
      { label: 'Ver facturas', ruta: '/facturas' },
      { label: 'Nueva factura', ruta: '/facturas/nueva' },
    ],
  },
  {
    titulo: 'Compras',
    icono: '🛒',
    descripcion: 'Registro formal de facturas de compra con precarga por XML/autorización, actualización de productos y entrada opcional a inventario.',
    ruta: '/compras',
    color: '#0f766e',
    permiso: 'compras.gestionar',
    modulo: 'comprasHabilitadas',
    acciones: [
      { label: 'Ver compras', ruta: '/compras' },
      { label: 'Nueva compra', ruta: '/compras/nueva' },
    ],
  },
  {
    titulo: 'Retenciones',
    icono: '📌',
    descripcion: 'Comprobantes de retención tipo 07. Renta IR e IVA con cálculo automático del valor retenido.',
    ruta: '/retenciones',
    color: '#0891b2',
    permiso: 'retenciones.gestionar',
    modulo: 'retencionesHabilitadas',
    acciones: [
      { label: 'Ver retenciones', ruta: '/retenciones' },
      { label: 'Nueva retención', ruta: '/retenciones/nueva' },
    ],
  },
  {
    titulo: 'Notas de Crédito',
    icono: '📝',
    descripcion: 'Anulación o corrección de facturas emitidas. Comprobante tipo 04 vinculado al documento original.',
    ruta: '/facturas',
    color: '#d97706',
    permiso: 'facturacion.emitir',
    acciones: [
      { label: 'Ver en Facturas', ruta: '/facturas' },
    ],
  },
  {
    titulo: 'Liquidaciones Compra',
    icono: '🛒',
    descripcion: 'Comprobante electrónico tipo 03 para compras a personas naturales sin RUC. Aplica IVA 0% o 15%.',
    ruta: '/liquidaciones',
    color: '#0ea5e9',
    permiso: 'liquidaciones.gestionar',
    modulo: 'liquidacionesHabilitadas',
    acciones: [
      { label: 'Ver liquidaciones', ruta: '/liquidaciones' },
      { label: 'Nueva liquidación', ruta: '/liquidaciones/nueva' },
    ],
  },
  {
    titulo: 'ATS',
    icono: '📋',
    descripcion: 'Anexo Transaccional Simplificado — exportación XML mensual con ventas y retenciones para declarar al SRI.',
    ruta: '/ats',
    color: '#f59e0b',
    permiso: 'tributario.reportes',
    modulo: 'atsHabilitado',
    acciones: [
      { label: 'Generar ATS', ruta: '/ats' },
    ],
  },
  {
    titulo: 'Reportes Tributarios',
    icono: '📊',
    descripcion: 'Consolidado mensual de ventas, notas de crédito y retenciones. Cálculo referencial del IVA a declarar.',
    ruta: '/reportes-tributarios',
    color: '#059669',
    permiso: 'tributario.reportes',
    acciones: [
      { label: 'Ver reporte', ruta: '/reportes-tributarios' },
    ],
  },
  {
    titulo: 'Configuración SRI',
    icono: '⚙️',
    descripcion: 'RUC, razón social, establecimiento, punto de emisión, ambiente (pruebas/producción), certificado .p12 y logo.',
    ruta: '/configuracion-sri',
    color: '#7c3aed',
    permiso: 'sri.configurar',
    acciones: [
      { label: 'Configurar', ruta: '/configuracion-sri' },
    ],
  },
  {
    titulo: 'Catálogo de Productos',
    icono: '📦',
    descripcion: 'Catálogo reutilizable de productos y servicios. Asigna precios y tarifa de IVA para agilizar la emisión.',
    ruta: '/productos',
    color: '#0369a1',
    permiso: 'productos.ver',
    acciones: [
      { label: 'Ver catálogo', ruta: '/productos' },
    ],
  },
];

const FinanzasHub = () => {
  const navigate = useNavigate();
  const { usuario, sistema } = useAuth();
  const rol = usuario?.rol;

  const modulosVisibles = modulos.filter((m) => {
    if (!tienePermiso(rol, m.permiso)) return false;
    if (!m.modulo) return true;
    return Boolean(sistema?.[m.modulo]);
  });

  return (
    <div className="fhub-container">
      <div className="fhub-header">
        <div className="fhub-header-icon">💰</div>
        <div>
          <h1 className="fhub-titulo">Módulo de Finanzas</h1>
          <p className="fhub-subtitulo">
            Facturación electrónica SRI · Compras · Retenciones · Reportes tributarios
          </p>
        </div>
      </div>

      <div className="fhub-grid">
        {modulosVisibles.map((mod) => (
          <div
            key={mod.titulo}
            className="fhub-card"
            style={{ '--card-color': mod.color }}
          >
            <div className="fhub-card-top">
              <span className="fhub-card-icon">{mod.icono}</span>
              <h3 className="fhub-card-titulo">{mod.titulo}</h3>
            </div>
            <p className="fhub-card-desc">{mod.descripcion}</p>
            <div className="fhub-card-acciones">
              {mod.acciones.map((ac) => (
                <button
                  key={ac.label}
                  className="fhub-btn"
                  onClick={() => navigate(ac.ruta)}
                >
                  {ac.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="fhub-info">
        <span className="fhub-info-icon">🔒</span>
        <span>
          Todos los comprobantes cumplen la normativa del <strong>SRI Ecuador</strong>.
          Ambiente actual configurable desde <strong>Configuración SRI</strong>.
        </span>
      </div>
    </div>
  );
};

export default FinanzasHub;
