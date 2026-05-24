// ====================================
// APP — AELA
// Rutas adaptativas según plan (full/lite) y modo (mono/multi)
// ====================================

import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';

// Auth
import { tienePermiso } from './utils/roles';
import { obtenerModulosHabilitados, planBloqueadoPorRequisito } from './utils/sistema';

import './App.css';

// Capturar ?tenant=slug al abrir el link de acceso enviado por correo.
// Se guarda en localStorage para que api.js lo envíe como X-Tenant-Slug en cada petición.
// Se limpia la URL inmediatamente para que no quede visible en el historial.
(function capturarTenantSlug() {
  try {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('tenant');
    if (slug && slug.trim()) {
      localStorage.setItem('aela_tenant_slug', slug.trim());
      params.delete('tenant');
      const qs = params.toString();
      const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
      window.history.replaceState({}, '', url);
    }
  } catch (_) {}
})();

const Login = lazy(() => import('./components/Auth/Login'));
const Layout = lazy(() => import('./components/Layout/Layout'));
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'));
const GestionProductos = lazy(() => import('./components/Productos/GestionProductos'));
const ListaCompras = lazy(() => import('./components/Compras/ListaCompras'));
const FormCompra = lazy(() => import('./components/Compras/FormCompra'));
const DetalleCompra = lazy(() => import('./components/Compras/DetalleCompra'));
const CajaDiaria = lazy(() => import('./components/Caja/CajaDiaria'));
const PuntoVenta = lazy(() => import('./components/POS/PuntoVenta'));
const ConfiguracionSistema = lazy(() => import('./components/Sistema/ConfiguracionSistema'));
const ListaFacturas = lazy(() => import('./components/Facturacion/ListaFacturas'));
const FormFactura = lazy(() => import('./components/Facturacion/FormFactura'));
const DetalleFactura = lazy(() => import('./components/Facturacion/DetalleFactura'));
const ListaRetenciones = lazy(() => import('./components/Facturacion/ListaRetenciones'));
const FormRetencion = lazy(() => import('./components/Facturacion/FormRetencion'));
const ListaLiquidaciones = lazy(() => import('./components/Facturacion/ListaLiquidaciones'));
const FormLiquidacion = lazy(() => import('./components/Facturacion/FormLiquidacion'));
const FinanzasHub = lazy(() => import('./components/Facturacion/FinanzasHub'));
const ConfiguracionSRI = lazy(() => import('./components/Facturacion/ConfiguracionSRI'));
const ATS = lazy(() => import('./components/Facturacion/ATS'));
const ReportesTributarios = lazy(() => import('./components/Facturacion/ReportesTributarios'));
const ContabilidadHub = lazy(() => import('./components/Contabilidad/ContabilidadHub'));
const ListaNotasDebito = lazy(() => import('./components/Facturacion/ListaNotasDebito'));
const FormNotaDebito = lazy(() => import('./components/Facturacion/FormNotaDebito'));
const Declaraciones = lazy(() => import('./components/Declaraciones/Declaraciones'));
const BuzonSRI = lazy(() => import('./components/Buzon/BuzonSRI'));
const ListaGuiasRemision = lazy(() => import('./components/GuiasRemision/ListaGuiasRemision'));
const FormGuiaRemision = lazy(() => import('./components/GuiasRemision/FormGuiaRemision'));
const BancosHub = lazy(() => import('./components/Bancos/BancosHub'));
const ListaNotasVenta = lazy(() => import('./components/NotasVenta/ListaNotasVenta'));
const FormNotaVenta = lazy(() => import('./components/NotasVenta/FormNotaVenta'));
const DetalleNotaVenta = lazy(() => import('./components/NotasVenta/DetalleNotaVenta'));
const GestionClientes = lazy(() => import('./components/Clientes/GestionClientes'));
const GestionProveedores = lazy(() => import('./components/Proveedores/GestionProveedores'));
const GestionEmpresas = lazy(() => import('./components/Empresas/GestionEmpresas'));
const GestionUsuarios = lazy(() => import('./components/Usuarios/GestionUsuarios'));
const UpgradePage = lazy(() => import('./components/Upgrade/UpgradePage'));
const TalentoHumanoHub   = lazy(() => import('./components/TalentoHumano/TalentoHumanoHub'));
const ListaEmpleados     = lazy(() => import('./components/TalentoHumano/ListaEmpleados'));
const FormEmpleado       = lazy(() => import('./components/TalentoHumano/FormEmpleado'));
const Departamentos      = lazy(() => import('./components/TalentoHumano/Departamentos'));
const Cargos             = lazy(() => import('./components/TalentoHumano/Cargos'));
const Nomina             = lazy(() => import('./components/TalentoHumano/Nomina'));
const Ausencias          = lazy(() => import('./components/TalentoHumano/Ausencias'));
const AyudaSistema       = lazy(() => import('./components/Ayuda/AyudaSistema'));
const AccesoTenant       = lazy(() => import('./components/Tenant/AccesoTenant'));

function RouteLoading() {
  return <div style={{ padding: 40 }}>Cargando módulo...</div>;
}

// ─── ProtectedRoute ───────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <div style={{ padding: 40 }}>Cargando...</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  return children;
}

// ─── Ruta disponible desde Medium — muestra UpgradePage si es Lite ───────────
function MediumRoute({ children }) {
  const { esLite, esMedium } = useAuth();
  if (planBloqueadoPorRequisito('medium', { esLite, esMedium })) {
    return <UpgradePage planRequerido="medium" />;
  }
  return children;
}

// ─── Ruta exclusiva de Pro — muestra UpgradePage si es Lite o Medium ─────────
function ProRoute({ children }) {
  const { esLite, esMedium } = useAuth();
  if (planBloqueadoPorRequisito('pro', { esLite, esMedium })) {
    return <UpgradePage planRequerido="pro" />;
  }
  return children;
}


// ─── Ruta de admin multi ──────────────────────────────────────────────────────
function PermissionRoute({ permission, children }) {
  const { usuario } = useAuth();
  if (!tienePermiso(usuario?.rol, permission, usuario?.permisosExtra)) return <Navigate to="/dashboard" replace />;
  return children;
}

function ModuleRoute({ moduleKey, children }) {
  const { sistema } = useAuth();
  if (!sistema) return <div style={{ padding: 40 }}>Cargando...</div>;
  const enabled = obtenerModulosHabilitados(sistema);

  if (!enabled[moduleKey]) return <Navigate to="/dashboard" replace />;
  return children;
}

// Ruta de gestión de empresas — accesible para el admin en cualquier modo
// (mono con subsidiarias = Macro Empresa, multi = SaaS)
function AdminEmpresasRoute({ children }) {
  const { usuario } = useAuth();
  if (!tienePermiso(usuario?.rol, 'empresas.gestionar')) return <Navigate to="/dashboard" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { usuario } = useAuth();
  if (!tienePermiso(usuario?.rol, 'usuarios.gestionar')) return <Navigate to="/dashboard" replace />;
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
        <Suspense fallback={<RouteLoading />}>
          <Routes>
              {/* Pública */}
              <Route path="/login" element={<Login />} />

              {/* Protegidas dentro del Layout */}
              <Route path="/" element={
                <ProtectedRoute><Layout /></ProtectedRoute>
              }>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />

                {/* Facturas — requieren Medium o superior */}
                <Route path="facturas"          element={<MediumRoute><PermissionRoute permission="facturacion.ver"><ListaFacturas /></PermissionRoute></MediumRoute>} />
                <Route path="facturas/nueva"    element={<MediumRoute><PermissionRoute permission="facturacion.emitir"><FormFactura /></PermissionRoute></MediumRoute>} />
                <Route path="facturas/:id"      element={<MediumRoute><PermissionRoute permission="facturacion.ver"><DetalleFactura /></PermissionRoute></MediumRoute>} />

                {/* Clientes */}
                <Route path="clientes" element={<PermissionRoute permission="clientes.gestionar"><GestionClientes /></PermissionRoute>} />

                {/* Proveedores — Medium y Pro */}
                <Route path="proveedores" element={<MediumRoute><ModuleRoute moduleKey="compras"><PermissionRoute permission="compras.gestionar"><GestionProveedores /></PermissionRoute></ModuleRoute></MediumRoute>} />

                {/* Productos / Inventario */}
                <Route path="productos" element={<PermissionRoute permission="productos.ver"><GestionProductos initialTab="catalogo" /></PermissionRoute>} />

                {/* Compras — Medium y Pro */}
                <Route path="compras" element={<MediumRoute><ModuleRoute moduleKey="compras"><PermissionRoute permission="compras.gestionar"><ListaCompras /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="compras/nueva" element={<MediumRoute><ModuleRoute moduleKey="compras"><PermissionRoute permission="compras.gestionar"><FormCompra /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="compras/:id" element={<MediumRoute><ModuleRoute moduleKey="compras"><PermissionRoute permission="compras.gestionar"><DetalleCompra /></PermissionRoute></ModuleRoute></MediumRoute>} />

                {/* Caja diaria — disponible desde Lite */}
                <Route path="caja" element={<ModuleRoute moduleKey="caja"><PermissionRoute permission="caja.ver"><CajaDiaria /></PermissionRoute></ModuleRoute>} />

                {/* POS — disponible desde Lite */}
                <Route path="pos" element={<ModuleRoute moduleKey="pos"><PermissionRoute permission="pos.usar"><PuntoVenta /></PermissionRoute></ModuleRoute>} />

                {/* Inventario — disponible desde Lite (máx 100 productos) */}
                <Route path="inventario" element={<ModuleRoute moduleKey="inventario"><PermissionRoute permission="inventario.ver"><GestionProductos initialTab="inventario" /></PermissionRoute></ModuleRoute>} />

                {/* Notas de Venta — todos los planes */}
                <Route path="notas-venta"         element={<PermissionRoute permission="notasVenta.gestionar"><ListaNotasVenta /></PermissionRoute>} />
                <Route path="notas-venta/nueva"   element={<PermissionRoute permission="notasVenta.gestionar"><FormNotaVenta /></PermissionRoute>} />
                <Route path="notas-venta/:id"     element={<PermissionRoute permission="notasVenta.gestionar"><DetalleNotaVenta /></PermissionRoute>} />

                {/* Retenciones — solo Pro */}
                <Route path="retenciones"       element={<ProRoute><ModuleRoute moduleKey="retenciones"><PermissionRoute permission="retenciones.gestionar"><ListaRetenciones /></PermissionRoute></ModuleRoute></ProRoute>} />
                <Route path="retenciones/nueva" element={<ProRoute><ModuleRoute moduleKey="retenciones"><PermissionRoute permission="retenciones.gestionar"><FormRetencion /></PermissionRoute></ModuleRoute></ProRoute>} />

                {/* Liquidaciones — solo Pro */}
                <Route path="liquidaciones"       element={<ProRoute><ModuleRoute moduleKey="liquidaciones"><PermissionRoute permission="liquidaciones.gestionar"><ListaLiquidaciones /></PermissionRoute></ModuleRoute></ProRoute>} />
                <Route path="liquidaciones/nueva" element={<ProRoute><ModuleRoute moduleKey="liquidaciones"><PermissionRoute permission="liquidaciones.gestionar"><FormLiquidacion /></PermissionRoute></ModuleRoute></ProRoute>} />

                {/* Notas de Débito — solo Pro */}
                <Route path="notas-debito"       element={<ProRoute><PermissionRoute permission="facturacion.emitir"><ListaNotasDebito /></PermissionRoute></ProRoute>} />
                <Route path="notas-debito/nueva" element={<ProRoute><PermissionRoute permission="facturacion.emitir"><FormNotaDebito /></PermissionRoute></ProRoute>} />

                {/* Buzón SRI — Medium y Pro */}
                <Route path="buzon" element={<MediumRoute><ModuleRoute moduleKey="compras"><PermissionRoute permission="compras.gestionar"><BuzonSRI /></PermissionRoute></ModuleRoute></MediumRoute>} />

                {/* Guías de Remisión — Medium y Pro */}
                <Route path="guias-remision"         element={<MediumRoute><PermissionRoute permission="facturacion.ver"><ListaGuiasRemision /></PermissionRoute></MediumRoute>} />
                <Route path="guias-remision/nueva"   element={<MediumRoute><PermissionRoute permission="facturacion.emitir"><FormGuiaRemision /></PermissionRoute></MediumRoute>} />
                <Route path="guias-remision/:id/editar" element={<MediumRoute><PermissionRoute permission="facturacion.emitir"><FormGuiaRemision /></PermissionRoute></MediumRoute>} />

                {/* Declaraciones tributarias — solo Pro */}
                <Route path="declaraciones" element={<ProRoute><PermissionRoute permission="tributario.reportes"><Declaraciones /></PermissionRoute></ProRoute>} />

                {/* Tributario — solo Pro */}
                <Route path="ats"                  element={<ProRoute><ModuleRoute moduleKey="ats"><PermissionRoute permission="tributario.reportes"><ATS /></PermissionRoute></ModuleRoute></ProRoute>} />
                <Route path="reportes-tributarios" element={<ProRoute><PermissionRoute permission="tributario.reportes"><ReportesTributarios /></PermissionRoute></ProRoute>} />

                {/* Contabilidad — solo Pro */}
                <Route path="contabilidad" element={<ProRoute><ModuleRoute moduleKey="contabilidad"><PermissionRoute permission="contabilidad.ver"><ContabilidadHub /></PermissionRoute></ModuleRoute></ProRoute>} />
                <Route path="bancos" element={<MediumRoute><PermissionRoute permission="bancos.ver"><BancosHub /></PermissionRoute></MediumRoute>} />

                {/* Configuración SRI — todos los planes */}
                <Route path="configuracion-sri" element={<PermissionRoute permission="sri.configurar"><ConfiguracionSRI /></PermissionRoute>} />
                <Route path="configuracion-sistema" element={<PermissionRoute permission="sistema.configurar"><ConfiguracionSistema /></PermissionRoute>} />

                {/* Hub financiero — Medium y Pro */}
                <Route path="finanzas" element={<MediumRoute><PermissionRoute permission="facturacion.ver"><FinanzasHub /></PermissionRoute></MediumRoute>} />

                {/* Talento Humano — Medium y Pro */}
                <Route path="talento-humano"               element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.ver"><TalentoHumanoHub /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/empleados"     element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.ver"><ListaEmpleados /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/empleados/nuevo" element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.gestionar"><FormEmpleado /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/empleados/:id" element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.ver"><FormEmpleado /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/departamentos" element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.gestionar"><Departamentos /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/cargos"        element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.gestionar"><Cargos /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/nomina"        element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.nomina"><Nomina /></PermissionRoute></ModuleRoute></MediumRoute>} />
                <Route path="talento-humano/ausencias"     element={<MediumRoute><ModuleRoute moduleKey="talentoHumano"><PermissionRoute permission="rrhh.ver"><Ausencias /></PermissionRoute></ModuleRoute></MediumRoute>} />

                {/* Usuarios — solo admin */}
                <Route path="usuarios" element={<AdminRoute><GestionUsuarios /></AdminRoute>} />

                {/* Gestión de Empresas — admin + multiempresa */}
                <Route path="empresas" element={<AdminEmpresasRoute><GestionEmpresas /></AdminEmpresasRoute>} />

                {/* Centro de Ayuda — accesible para todos */}
                <Route path="ayuda" element={<AyudaSistema />} />
              </Route>

              {/* Acceso tenant: /:slug — guarda slug en localStorage y redirige a /login */}
              <Route path="/:slug" element={<AccesoTenant />} />

              <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
