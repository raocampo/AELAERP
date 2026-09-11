export interface Usuario {
  id: number;
  nombre: string;
  username?: string;
  email: string;
  rol: string;
  // El backend (routes/auth.js) devuelve `permisosExtra` en el login.
  permisosExtra?: string[];
}

export interface Empresa {
  id: number;
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  logoUrl?: string;
  plan?: string;
}

export interface Sistema {
  posHabilitado: boolean;
  inventarioHabilitado: boolean;
  facturacionHabilitada: boolean;
  restauranteHabilitado: boolean;
  documentoPosDefault?: 'factura' | 'nota_venta';
  cajaNombre?: string;
}

export interface ItemComanda {
  codigoPrincipal: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  ivaPorcentaje: number;
  nota?: string | null;
  enviadoCocina: boolean;
  facturado?: boolean;
}

export interface ItemCocinaPendiente {
  comandaId: number;
  mesaId: number;
  mesaNombre: string;
  codigoPrincipal: string;
  descripcion: string;
  cantidad: number;
  nota?: string | null;
  enviadoCocinaEn: string;
}

export interface LlamadaServicio {
  id: number;
  mesaId: number;
  estado: 'PENDIENTE' | 'ATENDIDA';
  createdAt: string;
  mesa?: { nombre: string };
}

export interface Mesa {
  id: number;
  nombre: string;
  capacidad?: number | null;
  estado: 'LIBRE' | 'OCUPADA';
  comanda: {
    id: number;
    numeroComensales?: number | null;
    cantidadItems: number;
    pendientesCocina: number;
    tieneCuentaDividida?: boolean;
    subtotal: number;
    totalIva: number;
    total: number;
  } | null;
}

export interface Comanda {
  id: number;
  mesaId: number;
  mesa?: { nombre: string };
  estado: 'ABIERTA' | 'CERRADA' | 'ANULADA';
  items: ItemComanda[];
  numeroComensales?: number | null;
  subtotal: number;
  totalIva: number;
  total: number;
  totalFacturado?: number;
}

export interface Producto {
  id: number;
  codigoPrincipal: string;
  codigoAuxiliar?: string;
  nombre: string;
  precioUnitario: number;
  costoUnitario?: number;
  tarifaIva: number;
  unidadMedida: string;
  inventariable: boolean;
  stockActual: number;
  stockMinimo: number;
  activo: boolean;
}

export interface ItemCarrito {
  codigoPrincipal: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  ivaPorcentaje: number;
}

export interface Factura {
  id: number;
  numeroFactura: string;
  fechaEmision: string;
  razonSocialComprador: string;
  identificacionComprador: string;
  importeTotal: number;
  estadoSri: string;
  estadoInterno: string;
  createdAt: string;
}

export interface NotaVenta {
  id: number;
  numeroNota: string;
  fechaEmision: string;
  razonSocial: string;
  identificacion: string;
  total: number;
  estado: string;
  createdAt: string;
}

export interface MovimientoInventario {
  id: number;
  tipo: 'entrada' | 'salida' | 'ajuste';
  cantidad: number;
  stockAnterior: number;
  stockNuevo: number;
  costoUnitario?: number;
  referencia?: string;
  observacion?: string;
  createdAt: string;
  producto: { nombre: string; codigoPrincipal: string };
  usuario: { nombre: string };
}

export interface ResumenInventario {
  totalProductos: number;
  totalInventariables: number;
  stockBajo: number;
  sinStock: number;
}

// ── Módulo Agente Vendedor (docs/roadmap-agente-vendedor.md) ──────────────
export interface ClienteVendedor {
  id: number;
  identificacion: string;
  tipoIdentificacion: string;
  razonSocial: string;
  nombreComercial?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  email?: string | null;
  vendedorId?: number | null;
  saldoPendiente: number;
}

export interface FacturaPendienteVendedor {
  id: number;
  numeroFactura: string;
  fechaEmision: string;
  importeTotal: number;
  cobrado: number;
  notaCredito: number;
  saldo: number;
}

export interface EstadoCuentaVendedor {
  cliente: ClienteVendedor;
  saldoTotal: number;
  facturasPendientes: FacturaPendienteVendedor[];
}

export interface PedidoVendedor {
  id: number;
  numero: string;
  razonSocial: string;
  identificacion: string;
  clienteId: number | null;
  importeTotal: number;
  estado: string;
  fechaEmision: string;
  createdAt: string;
  facturaId: number | null;
}
