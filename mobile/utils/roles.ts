// Espejo de frontend/src/utils/roles.js y backend/utils/roles.js.
// Mantener las 3 copias en sync al agregar roles o permisos.

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  contador: 'Contador / Financiero',
  asistente_contabilidad: 'Asistente de Contabilidad',
  facturador: 'Facturador',
  secretaria: 'Secretaria',
  operador: 'Operador',
  mesero: 'Mesero',
  cajero: 'Cajero',
  cocina: 'Cocina',
  vendedor: 'Agente Vendedor',
};

const ROLE_ALIASES: Record<string, string> = {
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
  asesor: 'vendedor',
  vendedora: 'vendedor',
  preventista: 'vendedor',
  agente: 'vendedor',
  agente_vendedor: 'vendedor',
};

const PERMISSIONS: Record<string, string[]> = {
  'facturacion.ver':    ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'cajero'],
  'facturacion.emitir': ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'cajero'],

  'clientes.gestionar': ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador', 'cajero'],
  'productos.ver':      ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador', 'mesero', 'cajero', 'vendedor'],
  'inventario.ver':     ['admin', 'supervisor', 'contador', 'asistente_contabilidad', 'facturador', 'secretaria', 'operador'],
  'notasVenta.gestionar': ['admin', 'supervisor', 'facturador', 'secretaria', 'operador', 'cajero'],
  'pos.usar':           ['admin', 'supervisor', 'facturador', 'secretaria', 'operador', 'cajero'],

  'proformas.gestionar': ['admin', 'supervisor', 'facturador', 'secretaria'],

  'vendedor.ver':     ['admin', 'supervisor', 'vendedor'],
  'vendedor.pedidos': ['admin', 'supervisor', 'vendedor'],
  'vendedor.cobros':  ['admin', 'supervisor', 'vendedor'],
  'vendedor.asignar': ['admin', 'supervisor'],

  'mesas.gestionar':   ['admin', 'supervisor', 'facturador', 'secretaria', 'operador'],
  'mesas.tomarPedido': ['mesero'],
  'mesas.cobrar':      ['cajero'],
  'mesas.cocina':      ['admin', 'supervisor', 'cocina'],
};

export function normalizarRol(rol?: string | null): string {
  const role = String(rol || '').trim().toLowerCase();
  if (!role) return 'operador';
  return ROLE_ALIASES[role] || role;
}

export function obtenerRolLabel(rol?: string | null): string {
  const r = normalizarRol(rol);
  return ROLE_LABELS[r] || r;
}

// `permiso` puede ser un string o un array de alternativas (OR), igual que
// autorizarPermiso en el backend.
export function tienePermiso(
  rol?: string | null,
  permiso?: string | string[],
  permisosExtra: string[] = [],
): boolean {
  const role = normalizarRol(rol);
  const permisos = Array.isArray(permiso) ? permiso : [permiso].filter(Boolean) as string[];
  return permisos.some((p) => (
    (PERMISSIONS[p] || []).includes(role) ||
    (Array.isArray(permisosExtra) && permisosExtra.includes(p))
  ));
}

export function esVendedor(rol?: string | null): boolean {
  return normalizarRol(rol) === 'vendedor';
}
