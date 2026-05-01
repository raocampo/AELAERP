export const ROLE_OPTIONS = [
  { value: 'admin',                  label: 'Administrador' },
  { value: 'supervisor',             label: 'Supervisor' },
  { value: 'contador',               label: 'Contador / Financiero' },
  { value: 'asistente_contabilidad', label: 'Asistente de Contabilidad' },
  { value: 'facturador',             label: 'Facturador' },
  { value: 'secretaria',             label: 'Secretaria' },
  { value: 'operador',               label: 'Operador' },
];

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((role) => [role.value, role.label]));

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
  'sri.configurar': ['admin'],
  'sistema.configurar': ['admin'],

  'facturacion.ver':    ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria'],
  'facturacion.emitir': ['admin', 'supervisor', 'facturador', 'secretaria'],
  'facturacion.anular': ['admin', 'supervisor'],

  'compras.gestionar':        ['admin', 'supervisor', 'contador'],
  'retenciones.gestionar':    ['admin', 'supervisor', 'contador'],
  'liquidaciones.gestionar':  ['admin', 'supervisor', 'contador'],
  'tributario.reportes':      ['admin', 'supervisor', 'contador'],

  'contabilidad.ver':      ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'secretaria'],
  'contabilidad.gestionar':['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'contabilidad.bloquear': ['admin', 'contador'],

  'bancos.ver':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'bancos.gestionar': ['admin', 'supervisor', 'contador'],
  'cheques.gestionar':['admin', 'supervisor', 'contador'],

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
};

export const normalizarRol = (rol) => {
  const role = String(rol || '').trim().toLowerCase();
  if (!role) return 'operador';
  return ROLE_ALIASES[role] || role;
};

export const obtenerRolLabel = (rol) => ROLE_LABELS[normalizarRol(rol)] || normalizarRol(rol);

export const tienePermiso = (rol, permiso) => {
  const role = normalizarRol(rol);
  return (PERMISSIONS[permiso] || []).includes(role);
};
