const ROLE_DEFINITIONS = {
  admin: {
    key: 'admin',
    label: 'Administrador',
  },
  supervisor: {
    key: 'supervisor',
    label: 'Supervisor',
  },
  contador: {
    key: 'contador',
    label: 'Contador / Financiero',
  },
  asistente_contabilidad: {
    key: 'asistente_contabilidad',
    label: 'Asistente de Contabilidad',
  },
  facturador: {
    key: 'facturador',
    label: 'Facturador',
  },
  secretaria: {
    key: 'secretaria',
    label: 'Secretaria',
  },
  operador: {
    key: 'operador',
    label: 'Operador',
  },
  mesero: {
    key: 'mesero',
    label: 'Mesero',
  },
  cajero: {
    key: 'cajero',
    label: 'Cajero',
  },
  cocina: {
    key: 'cocina',
    label: 'Cocina',
  },
};

const ROLE_ALIASES = {
  administrador: 'admin',
  financiero: 'contador',
  contador_financiero: 'contador',
  asistente_contable: 'asistente_contabilidad',
  aux_contabilidad: 'asistente_contabilidad',
  recepcionista: 'secretaria',
  medico: 'facturador',
  gerente: 'supervisor',
  visor: 'supervisor',
  mesera: 'mesero',
  cajera: 'cajero',
};

const PERMISSIONS = {
  'usuarios.gestionar': ['admin'],
  'empresas.gestionar': ['admin'],
  'sri.configurar':     ['admin', 'contador'],
  'sistema.configurar': ['admin', 'contador'],
  'sucursales.gestionar': ['admin', 'contador'],

  'facturacion.ver':    ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'cajero'],
  'facturacion.emitir': ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'cajero'],
  'facturacion.anular': ['admin', 'supervisor', 'contador'],

  'compras.gestionar':        ['admin', 'supervisor', 'contador'],
  'retenciones.gestionar':    ['admin', 'supervisor', 'contador'],
  'liquidaciones.gestionar':  ['admin', 'supervisor', 'contador'],
  'tributario.reportes':      ['admin', 'supervisor', 'contador'],
  'estadisticas.ver':         ['admin', 'supervisor', 'contador'],

  // contabilidad.ver  → puede ver asientos, plan, reportes (NO crear/editar)
  // contabilidad.gestionar → puede crear/editar asientos propios y no bloqueados
  // contabilidad.bloquear  → puede bloquear/desbloquear asientos (solo contador/admin)
  'contabilidad.ver':      ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'secretaria'],
  'contabilidad.gestionar':['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'contabilidad.bloquear': ['admin', 'contador'],

  'bancos.ver':      ['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'bancos.gestionar':['admin', 'supervisor', 'contador'],
  'cheques.gestionar':['admin', 'supervisor', 'contador'],

  'cxc.ver':             ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria'],
  'cxc.gestionar':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'cxp.ver':             ['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'cxp.gestionar':       ['admin', 'supervisor', 'contador'],

  'cajaChica.ver':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'secretaria', 'operador'],
  'cajaChica.gestionar': ['admin', 'supervisor', 'contador'],

  'clientes.gestionar':   ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador', 'cajero'],
  'productos.ver':        ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador', 'mesero', 'cajero'],
  'productos.gestionar':  ['admin', 'supervisor', 'facturador', 'secretaria'],
  'productos.eliminar':   ['admin', 'supervisor'],
  'notasVenta.gestionar': ['admin', 'supervisor', 'facturador', 'secretaria', 'operador', 'cajero'],
  'inventario.ver':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador'],
  'inventario.gestionar': ['admin', 'supervisor', 'facturador', 'secretaria'],
  'caja.ver':             ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador', 'cajero'],
  'caja.gestionar':       ['admin', 'supervisor', 'facturador', 'secretaria', 'operador', 'cajero'],
  'pos.usar':             ['admin', 'supervisor', 'facturador', 'secretaria', 'operador', 'cajero'],

  'rrhh.ver':             ['admin', 'supervisor', 'contador'],
  'rrhh.gestionar':       ['admin', 'supervisor'],
  'rrhh.nomina':          ['admin', 'contador'],

  'proformas.gestionar':  ['admin', 'supervisor', 'facturador', 'secretaria'],
  'proformas.convertir':  ['admin', 'supervisor', 'facturador'],
  'proformas.anular':     ['admin', 'supervisor'],

  // Mesas y Comandas (restaurantes).
  // mesas.gestionar   → umbral amplio: puede tomar Y cobrar pedidos (roles
  //                     generales de POS que ya lo tenían).
  // mesas.tomarPedido → solo abrir/editar comanda y enviar a cocina (mesero).
  // mesas.cobrar      → solo cerrar/cobrar y anular comanda (cajero).
  // mesas.cocina      → ver la cola de cocina y marcar ítems listos.
  // mesas.administrar → crear/editar/eliminar mesas del local.
  // Las rutas de mesas.js que aceptan varios roles usan
  // autorizarPermiso(['mesas.gestionar', 'mesas.tomarPedido']) (OR), así que
  // basta con estar en UNA de las dos listas para esa acción puntual.
  'mesas.gestionar':     ['admin', 'supervisor', 'facturador', 'secretaria', 'operador'],
  'mesas.tomarPedido':   ['mesero'],
  'mesas.cobrar':        ['cajero'],
  'mesas.cocina':        ['admin', 'supervisor', 'cocina'],
  'mesas.administrar':   ['admin', 'supervisor'],
};

const DEFAULT_ROLE = 'operador';

const normalizarRol = (rol) => {
  const rolBase = String(rol || '').trim().toLowerCase();
  if (!rolBase) return DEFAULT_ROLE;
  return ROLE_ALIASES[rolBase] || rolBase;
};

const esRolValido = (rol) => Object.prototype.hasOwnProperty.call(ROLE_DEFINITIONS, normalizarRol(rol));

const obtenerRolLabel = (rol) => {
  const rolNormalizado = normalizarRol(rol);
  return ROLE_DEFINITIONS[rolNormalizado]?.label || rolNormalizado;
};

const listarRoles = () => Object.values(ROLE_DEFINITIONS);

const listarClavesRoles = () => Object.keys(ROLE_DEFINITIONS);

const listarRolesComoTexto = () => listarRoles().map((rol) => rol.label).join(', ');

// `permisosExtra` — permisos individuales concedidos al usuario además de
// los de su rol (ver campo usuarios.permisosExtra). Mismo patrón que el
// espejo en frontend/src/utils/roles.js.
const tienePermiso = (rol, permiso, permisosExtra = []) => {
  const rolNormalizado = normalizarRol(rol);
  if ((PERMISSIONS[permiso] || []).includes(rolNormalizado)) return true;
  return Array.isArray(permisosExtra) && permisosExtra.includes(permiso);
};

module.exports = {
  DEFAULT_ROLE,
  PERMISSIONS,
  listarRoles,
  listarClavesRoles,
  listarRolesComoTexto,
  normalizarRol,
  esRolValido,
  obtenerRolLabel,
  tienePermiso,
};
