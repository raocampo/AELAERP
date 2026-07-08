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

  'cxc.ver':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria'],
  'cxc.gestionar': ['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'cxp.ver':       ['admin', 'supervisor', 'contador', 'asistente_contabilidad'],
  'cxp.gestionar': ['admin', 'supervisor', 'contador'],

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

export const normalizarRol = (rol) => {
  const role = String(rol || '').trim().toLowerCase();
  if (!role) return 'operador';
  return ROLE_ALIASES[role] || role;
};

export const obtenerRolLabel = (rol) => ROLE_LABELS[normalizarRol(rol)] || normalizarRol(rol);

export const tienePermiso = (rol, permiso, permisosExtra = []) => {
  const role = normalizarRol(rol);
  if ((PERMISSIONS[permiso] || []).includes(role)) return true;
  return Array.isArray(permisosExtra) && permisosExtra.includes(permiso);
};

// Permisos agrupados por módulo — usados en la UI de asignación de permisos adicionales
export const PERMISOS_POR_MODULO = [
  { modulo: 'Facturación',     permisos: ['facturacion.ver', 'facturacion.emitir', 'facturacion.anular'] },
  { modulo: 'Compras',         permisos: ['compras.gestionar'] },
  { modulo: 'Retenciones',     permisos: ['retenciones.gestionar', 'liquidaciones.gestionar'] },
  { modulo: 'Tributario',      permisos: ['tributario.reportes'] },
  { modulo: 'Contabilidad',    permisos: ['contabilidad.ver', 'contabilidad.gestionar', 'contabilidad.bloquear'] },
  { modulo: 'Bancos',          permisos: ['bancos.ver', 'bancos.gestionar', 'cheques.gestionar'] },
  { modulo: 'Cuentas por Cobrar', permisos: ['cxc.ver', 'cxc.gestionar'] },
  { modulo: 'Cuentas por Pagar',  permisos: ['cxp.ver', 'cxp.gestionar'] },
  { modulo: 'Clientes',        permisos: ['clientes.gestionar'] },
  { modulo: 'Productos',       permisos: ['productos.ver', 'productos.gestionar', 'productos.eliminar'] },
  { modulo: 'Proformas',        permisos: ['proformas.gestionar', 'proformas.convertir', 'proformas.anular'] },
  { modulo: 'Ventas / Caja',   permisos: ['notasVenta.gestionar', 'caja.ver', 'caja.gestionar', 'pos.usar'] },
  { modulo: 'Inventario',      permisos: ['inventario.ver', 'inventario.gestionar'] },
  { modulo: 'RRHH / Nómina',   permisos: ['rrhh.ver', 'rrhh.gestionar', 'rrhh.nomina'] },
];

// Etiquetas legibles para cada permiso individual
export const PERMISO_LABELS = {
  'facturacion.ver':       'Ver facturas',
  'facturacion.emitir':    'Emitir facturas',
  'facturacion.anular':    'Anular facturas',
  'compras.gestionar':     'Gestionar compras',
  'retenciones.gestionar': 'Retenciones',
  'liquidaciones.gestionar':'Liquidaciones',
  'tributario.reportes':   'Reportes tributarios',
  'contabilidad.ver':      'Ver contabilidad',
  'contabilidad.gestionar':'Gestionar contabilidad',
  'contabilidad.bloquear': 'Bloquear períodos',
  'bancos.ver':            'Ver bancos',
  'bancos.gestionar':      'Gestionar bancos',
  'cheques.gestionar':     'Cheques',
  'cxc.ver':               'Ver cuentas por cobrar',
  'cxc.gestionar':         'Registrar cobros',
  'cxp.ver':               'Ver cuentas por pagar',
  'cxp.gestionar':         'Registrar pagos',
  'clientes.gestionar':    'Gestionar clientes',
  'productos.ver':         'Ver productos',
  'productos.gestionar':   'Gestionar productos',
  'productos.eliminar':    'Eliminar productos',
  'notasVenta.gestionar':  'Notas de venta',
  'caja.ver':              'Ver caja',
  'caja.gestionar':        'Gestionar caja',
  'pos.usar':              'Usar POS',
  'inventario.ver':        'Ver inventario',
  'inventario.gestionar':  'Gestionar inventario',
  'rrhh.ver':              'Ver RRHH',
  'rrhh.gestionar':        'Gestionar RRHH',
  'rrhh.nomina':           'Nómina',
  'proformas.gestionar':   'Gestionar proformas',
  'proformas.convertir':   'Convertir proforma a factura',
  'proformas.anular':      'Anular proformas',
};
