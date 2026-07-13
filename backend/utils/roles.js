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
};

const PERMISSIONS = {
  'usuarios.gestionar': ['admin'],
  'empresas.gestionar': ['admin'],
  'sri.configurar':     ['admin', 'contador'],
  'sistema.configurar': ['admin', 'contador'],

  'facturacion.ver':    ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria'],
  'facturacion.emitir': ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria'],
  'facturacion.anular': ['admin', 'supervisor', 'contador'],

  'compras.gestionar':        ['admin', 'supervisor', 'contador'],
  'retenciones.gestionar':    ['admin', 'supervisor', 'contador'],
  'liquidaciones.gestionar':  ['admin', 'supervisor', 'contador'],
  'tributario.reportes':      ['admin', 'supervisor', 'contador'],

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

  'clientes.gestionar':   ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador'],
  'productos.ver':        ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador'],
  'productos.gestionar':  ['admin', 'supervisor', 'facturador', 'secretaria'],
  'productos.eliminar':   ['admin', 'supervisor'],
  'notasVenta.gestionar': ['admin', 'supervisor', 'facturador', 'secretaria', 'operador'],
  'inventario.ver':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador'],
  'inventario.gestionar': ['admin', 'supervisor', 'facturador', 'secretaria'],
  'caja.ver':             ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador'],
  'caja.gestionar':       ['admin', 'supervisor', 'facturador', 'secretaria', 'operador'],
  'pos.usar':             ['admin', 'supervisor', 'facturador', 'secretaria', 'operador'],

  'rrhh.ver':             ['admin', 'supervisor', 'contador'],
  'rrhh.gestionar':       ['admin', 'supervisor'],
  'rrhh.nomina':          ['admin', 'contador'],

  'proformas.gestionar':  ['admin', 'supervisor', 'facturador', 'secretaria'],
  'proformas.convertir':  ['admin', 'supervisor', 'facturador'],
  'proformas.anular':     ['admin', 'supervisor'],
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

const tienePermiso = (rol, permiso) => {
  const rolNormalizado = normalizarRol(rol);
  return (PERMISSIONS[permiso] || []).includes(rolNormalizado);
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
