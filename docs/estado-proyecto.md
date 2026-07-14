# Estado del Proyecto AELA

Fecha de referencia: `2026-07-14`

## Resumen general

AELA ya cuenta con una base funcional operativa para:

- bootstrap inicial de empresa y administrador
- autenticacion por usuario o correo
- gestion de usuarios y roles
- configuracion SRI separada de configuracion del sistema
- facturacion electronica con asientos contables automáticos (venta + costo)
- notas de venta con asientos automáticos (venta + costo + reverso al anular)
- caja diaria
- POS
- productos e inventario
- compras
- liquidaciones
- retenciones
- ATS
- contabilidad base por empresa
- **sidebar agrupado con menus colapsables y navegacion inteligente**
- **módulo multi-tenant SaaS completamente operativo** (registro de empresas, provisioning automático de BD, activación de tenants)
- **landing page AELA ERP** en tema claro con planes, contacto CorpSimtelec y registro self-service
- **identidad visual AELA ERP** aplicada (colores, favicons, tipografía según brandbook CorpSimtelec)
- **módulo Gestión de Usuarios** con UI rediseñada (avatares, badges, modal animado)


## Realizado

### 1. Acceso inicial y seguridad

- pantalla de bootstrap inicial cuando no existen usuarios
- creacion de la primera empresa y del primer administrador
- login por `username` o `email`
- roles funcionales:
  - administrador
  - supervisor
  - contador / financiero
  - facturador
  - operador
- permisos aplicados en frontend y backend

### 2. Multiempresa, ediciones y configuracion operativa

- soporte `monoempresa` y `multiempresa`
- soporte `full` y `lite`
- configuracion del sistema separada de configuracion SRI
- activacion y desactivacion de modulos por empresa
- bloqueo real en frontend y backend para modulos no disponibles en Lite

### 3. Configuracion SRI

- datos del emisor por empresa
- ambiente pruebas / produccion
- establecimiento y punto de emision
- carga de certificado
- logo
- precarga inicial desde datos de empresa cuando aplica

### 4. Facturacion y clientes

- emision de facturas
- consulta de facturas
- detalle de factura
- anulacion
- mejora en consulta SRI para clientes y RUC
- manejo mas tolerante cuando el servicio publico del SRI no devuelve detalle completo

### 5. Productos e inventario

- catalogo de productos y servicios
- productos inventariables y no inventariables
- movimientos de inventario
- integracion de inventario con facturas, notas de venta y POS
- plantilla Excel para carga masiva
- importacion desde Excel
- importacion desde XML
- importacion desde clave de acceso / autorizacion SRI
- exportacion CSV de movimientos de inventario

### 6. Caja diaria y POS

- apertura de caja
- movimientos manuales
- cierre de caja
- historial
- interfaz por pestañas en caja
- POS con ingreso manual de productos
- POS con lectura por codigo principal o codigo auxiliar
- integracion de ventas con caja

### 7. Compras

- modulo formal de compras
- maestro de proveedores separado del encabezado de compras
- registro manual de facturas de compra
- listado de compras con chip "Anulada" para compras anuladas
- detalle individual de compra con modal de edicion (observaciones, fecha si sin movimientos)
- anulacion de compra con reversion de inventario y caja, y motivo registrado
- detalle de compra con acceso directo a retenciones vinculadas
- importacion desde XML de compra
- importacion desde autorizacion / clave de acceso del SRI
- opcion de crear productos faltantes automaticamente
- opcion de actualizar costos en productos existentes
- opcion de registrar entrada de inventario desde la compra
- opcion de registrar egreso de caja desde la compra
- asiento contable automatico base para compras registradas
- exportacion CSV de compras con filtros activos

### 8. Tributario y contabilidad

- retenciones
- retenciones con vinculacion opcional a compras y precarga guiada del documento sustento
- liquidaciones de compra
- ATS
- plan de cuentas base por empresa
- edicion del plan de cuentas
- importacion masiva de plan de cuentas desde Excel (formato AELA y formato externo)
- auto-deteccion de formato externo (columnas Parent/Esdetalle) con transformacion automatica
- deteccion inteligente de fila de encabezado (maneja archivos con titulo antes de los headers)
- modo reemplazar plan completo (respeta FK y cuentas con movimientos)
- plan de cuentas NIIF Supercias 308 cuentas (CUC oficial Ecuador)
- drag & drop para subir archivo de importacion
- estado del sistema contable (planVacio / sinMovimientos / enOperacion) con UI contextual
- periodos contables
- asientos
- mayor
- mayorizacion
- balance de comprobacion
- estado de resultados
- balance general

### 9. Documentacion

- README principal
- puesta en marcha
- arquitectura
- modulos
- API
- este documento de estado
- base inicial de pruebas automatizadas en backend y frontend, incluyendo autenticacion, permisos, configuracion y logica de retenciones
- workflow de CI base para pruebas, lint y build

### 10. Dashboard y UX

- dashboard con indicadores reales por empresa: ventas del mes, compras del mes, saldo de caja, stock bajo
- accesos rapidos del dashboard ajustados segun plan (Lite no muestra modulo Facturas)
- metricas con color semantico (verde ventas, rojo compras, azul caja, ambar stock bajo)

### 11. Estabilidad tecnica frontend

- refactor del contexto de autenticacion para separar `AuthProvider`, contexto base y hook `useAuth`
- limpieza de hooks y efectos en modulos operativos para evitar closures inestables y dependencias omitidas
- `lint` del frontend ya sin warnings
- mantenimiento del build productivo sin errores funcionales

### 12. Rendimiento de carga frontend

- code splitting por rutas con `React.lazy` y `Suspense`
- carga diferida de modulos operativos y administrativos
- eliminacion del warning de Vite por chunk principal demasiado grande
- eliminacion del warning por import mixto en `syncQueue` / `offlineDB`

### 13. Navegacion — sidebar con grupos colapsables

- sidebar rediseñado con menus colapsables por modulo
- `Dashboard` y `POS` como items independientes fuera de cualquier grupo
- grupos: Ventas, Compras, Inventario, Clientes y Proveedores, Tributario, Contabilidad, Talento Humano, Configuracion, Administracion
- `Hub Financiero` eliminado del sidebar (era redundante: repite links ya disponibles en el sidebar)
- `Caja Diaria` movida del grupo Inventario al grupo Ventas
- auto-apertura del grupo activo al navegar
- soporte de items bloqueados por plan y por modulo desactivado (con candado visual)

### 14. Modulo Talento Humano (RRHH)

Disponible desde plan **Medium**. Activable desde Configuracion del Sistema.

#### Base de datos (Prisma / PostgreSQL)
- `departamentos`: estructura organizacional por empresa
- `cargos`: puestos de trabajo vinculados a departamento
- `empleados`: datos personales, laborales, IESS y estado
- `contratos`: historial de contratos por empleado
- `nominas`: encabezado de nomina mensual por empresa (BORRADOR / PROCESADA / PAGADA)
- `nomina_detalles`: una fila por empleado por nomina con todos los conceptos
- `ausencias`: registro de permisos, vacaciones y licencias

#### Backend — `/api/talento-humano`
- protegido con `soloMediumOPro`
- CRUD `departamentos` con validacion de empleados activos antes de desactivar
- CRUD `cargos` con filtro por departamento
- CRUD `empleados` con paginacion y multiples filtros
- `GET/POST /nomina`: crea nomina mensual y calcula automaticamente todos los empleados activos
- `PUT /nomina/:id/detalle/:empId`: edicion manual de horas extras, otros ingresos y descuentos
- `PATCH /nomina/:id/estado`: flujo BORRADOR → PROCESADA → PAGADA
- `DELETE /nomina/:id`: solo si no esta PAGADA
- CRUD `ausencias` con filtros y endpoint de aprobacion toggle
- `GET /dashboard`: indicadores rapidos (empleados activos, ausencias pendientes, nomina del mes)

#### Calculos Ecuador implementados
- Aporte personal IESS: **9.45%** del salario
- Aporte patronal IESS: **11.15%** del salario
- Decimo tercer sueldo proporcional: **salario / 12**
- Decimo cuarto sueldo proporcional: **SBU ($460) / 12**
- Fondos de reserva: **salario / 12** (solo si `fondosReserva = true`, tras 1 año)
- Horas extras suplementarias: **25%** sobre hora ordinaria (salario/240 × 1.25)
- Horas extras extraordinarias: **50%** sobre hora ordinaria (salario/240 × 1.50)
- SBU base: `$460` (constante, actualizable en el archivo de ruta)

#### Permisos de sistema
- `rrhh.ver`: admin, supervisor, contador
- `rrhh.gestionar`: admin, supervisor
- `rrhh.nomina`: admin, contador

#### Frontend — componentes React
- `TalentoHumanoHub.jsx`: panel de bienvenida con metricas en tiempo real y accesos rapidos
- `Departamentos.jsx`: CRUD con modal, contador de empleados
- `Cargos.jsx`: CRUD con modal, filtro por departamento
- `ListaEmpleados.jsx`: lista paginada con filtros por nombre/cedula/departamento/estado
- `FormEmpleado.jsx`: formulario completo (datos personales, laborales, IESS y beneficios)
- `Nomina.jsx`: vista split — lista de nominas a la izquierda, detalle con desglose a la derecha; edicion de conceptos por empleado; flujo de estado
- `Ausencias.jsx`: tabla con filtros multiples, registro y aprobacion de ausencias
- `TalentoHumano.css`: hoja de estilos compartida del modulo

#### Integracion
- 8 rutas en `App.jsx` bajo `/talento-humano/*` con guards `MediumRoute + ModuleRoute + PermissionRoute`
- Grupo `Talento Humano` con 6 subitems en el sidebar (Layout.jsx)
- Toggle `talentoHumanoHabilitado` en Configuracion del Sistema
- `CAPACIDADES_PLAN` actualizado en `sistema.js` (Lite: false, Medium/Pro: true)
- Planes Medium y Pro describen Talento Humano en su lista de modulos

### 16. Marca AELA ERP — identidad visual CorpSimtelec

- Sistema renombrado oficialmente como **AELA ERP** (diseñado y desarrollado por CorpSimtelec)
- Aplicación del brandbook AELA: paleta de colores, tipografía, iconografía (`docs/aela-design-tokens.css`, `docs/aela-logos.md`)
- Color primario violeta `#7C3AED` aplicado en sidebar, botones, badges, navbars
- Favicon SVG creado para el sistema (`frontend/public/favicon.svg`) y la landing (`landing/favicon.svg`)
- Título del sistema: "AELA ERP — Gestión empresarial Ecuador"
- Datos de contacto CorpSimtelec integrados: WhatsApp `5930978893520`, correos `info@corpsimtelec.com`, `ventas@corpsimtelec.com`
- Soporte 24/7 declarado en landing

### 17. Landing page AELA ERP

- Landing page en `landing/` (HTML/CSS/JS puro, sin framework)
- Conversión de tema oscuro a **tema claro** profesional (fondo `#f8fafc`, texto `#1e293b`)
- Navbar translúcida blanca con `backdrop-filter: blur(14px)` y sombra al scroll
- Hero con gradiente violeta suave, métricas animadas, CTA principal
- Sección de características (6 cards: Facturación, POS, Inventario, Contabilidad, RRHH, SRI)
- Sección de planes con cards rediseñados:
  - **Lite**: $0 / siempre, badge "🎁 Gratis", hasta 3 usuarios, CTA verde "Obtener acceso gratuito"
  - **Medium**: Consultar, Usuarios ilimitados, Talento Humano incluido
  - **Pro**: Consultar, Usuarios ilimitados, todo incluyendo ATS y contabilidad completa
- Footer con logo AELA, datos CorpSimtelec, links rápidos, redes y contacto
- Favicon SVG (`landing/favicon.svg`)
- `main.js`: botón Lite enlaza a `registro.html`; botones Acceder al sistema enlaza a URL del app

### 18. Módulo multi-tenant SaaS — completamente operativo

La arquitectura multi-tenant ya existía en código; en esta sesión se **activó y depuró** completamente:

#### Componentes activados
- `backend/prisma/schema-master.prisma`: schema de la BD master (`tenants`, `suscripciones`)
- `backend/config/prismaMaster.js`: cliente Prisma dinámico para `aela_master`
- `backend/middleware/tenant.js`: resolución de tenant por header / subdominio / ENV
- `backend/utils/provisionarTenant.js`: provisioning completo (BD + migraciones + activación)
- `backend/routes/registro.js`: endpoint público `POST /api/registro` con rate limiting

#### Fixes realizados en provisionarTenant.js
1. Contraseña con `@` rompía `psql` al pasarla en URL → **ahora usa `PGPASSWORD` env var + parámetros individuales**
2. URL de migraciones usaba contraseña aleatoria del tenant → **ahora usa credenciales admin de `DATABASE_ADMIN_URL`**
3. Check "already exists" solo en inglés → **soporte también en español** para PostgreSQL instalado en español

#### Variables .env activadas
```
DATABASE_MASTER_URL   → BD catálogo de tenants (aela_master)
DATABASE_ADMIN_URL    → BD admin para CREATE DATABASE vía psql
MODO_EMPRESA=multi    → activa resolución multi-tenant
AELA_DOMINIO_BASE     → dominio base para URLs de acceso
DB_TENANT_USER/HOST/PORT → configuración para nuevas BDs
```

#### Flujo validado localmente
```
POST /api/registro → 200 ¡Bienvenido!
[background] psql CREATE DATABASE scfi_ferreteria_demo_sa → OK
[background] npx prisma db push → OK (schema completo migrado)
[background] tenant.estado = 'activo' → OK
GET /api/registro/estado/:email → { estado: "activo", urlAcceso: "..." }
```

#### Registro self-service (landing/registro.html)
- Formulario standalone HTML (sin framework) en `landing/`
- Llama `POST /api/registro` con los datos de la empresa
- Muestra estado de éxito con mensaje y enlace al sistema
- `API_URL` apunta a `http://localhost:5600` (cambiar a URL real en producción)

### 19. Módulo Gestión de Usuarios — UI rediseñada

- `GestionUsuarios.jsx` reescrito completamente (sin inline styles, usa clases CSS)
- `GestionUsuarios.css` creado desde cero con diseño profesional:
  - Avatar circular con gradiente violeta-índigo e iniciales del usuario
  - Badge monospace para nombre de usuario
  - Badges de rol con colores semánticos: Admin (violeta), Supervisor (naranja), Contador (azul), Facturador (verde), Operador (gris)
  - Puntos de estado animados (verde activo, rojo inactivo)
  - Botones de acción diferenciados: Editar (azul), Activar (verde), Desactivar (rojo)
  - Modal animado con icono de cabecera

### 20. Sidebar y UX del sistema

- Opacidad del texto del sidebar mejorada:
  - Encabezados de grupo: `50%` → `78%`
  - Sub-items: `65%` → `82%`
  - Flechas de colapso: `30%` → `50%`
  - Items bloqueados: `28%` → `38%`
- Favicon en pestaña del navegador (sistema + landing)



- **Scripts de backup/migración segura de BD**: `npm run db:migrate:safe` crea backup con `pg_dump`, ejecuta `prisma migrate deploy`, regenera Prisma Client y restaura el backup si falla. `npm run db:migrate:dev:safe -- --name nombre` hace lo mismo al crear migraciones locales. `prisma db push --accept-data-loss` queda fuera del flujo operativo.
- **Catastro SRI local**: `npm run catastro:import` carga por defecto los CSV oficiales en `docs/datosRuc`; `npm run catastro:replace` hace backup y recarga completamente `contribuyentes_sri`.
- **SBU Ecuador configurable**: campo `sbuEcuador` en `configuracion_sistema` (Prisma, migración `20260427234231_sbu_configurable`). La nómina lee el SBU desde la BD en lugar de usar una constante hardcodeada. UI en Configuración del Sistema muestra el campo con nota informativa.
- **Exportación CSV de nómina**: endpoint `GET /api/talento-humano/nomina/:id/csv` que genera un CSV completo con todos los conceptos por empleado, incluyendo fila de totales. Incluye BOM UTF-8 para compatibilidad con Excel. Botón "📥 CSV" en el panel de detalle de nómina.
- **Rol de pagos imprimible**: función `imprimirRolPagos()` en `Nomina.jsx` que genera una ventana HTML completa con diseño para impresión landscape, firma de elaborado/revisado/autorizado, y totales por columna. Botón "🖨️ Imprimir" en el panel de detalle.
- **`capacidadesPlan` en backend**: sincronizado para incluir `talentoHumanoHabilitado` en los tres planes (Lite: false, Medium/Pro: true).


Durante la implementacion se verifico:

- `npx prisma validate`
- `npx prisma generate`
- `npm run db:migrate:safe`
- `npm test` en backend
- `npm test` en frontend
- `npm run lint` en frontend sin warnings
- `npm run build` del frontend sin warnings de chunk grande ni import mixto
- arranque del backend en `http://localhost:5600`
- carga local de rutas backend clave (`compras`, `retenciones`, `proveedores`, `talento-humano`)
- sincronizacion del esquema Prisma con PostgreSQL
- migracion `20260427231353_talento_humano` aplicada exitosamente

### 24. Sesión 2026-07-04/05 — Motor contable completo: 5 principios ERP implementados

Ver `docs/pendientes-2026-07-04.md` para detalle exhaustivo (commits, scripts de integración, causa raíz de cada bug).

#### Fix — Bancos: empresa activa vs. empresa base (`2886f8b`)
`routes/bancos.js` tenía `obtenerEmpresaId` propio que devolvía `req.usuario.empresaId`
(empresa base fija) en vez de `req.empresa.id` (empresa activa del EmpresaSwitcher).
Admin Macro como Robert Ocampo operaba silenciosamente sobre su empresa base al ver
Consorcio Vial — potencial mezcla de datos entre empresas.

#### Feature — Bancos vinculados al Plan de Cuentas (`2886f8b`)
- Modal Nueva/Editar Cuenta Bancaria: selector de cuenta contable
- Tarjeta de cuenta muestra la cuenta contable vinculada o aviso "Sin cuenta contable"

#### Bug — Modal de Bancos transparente + selector vacío (`a3ee110`)
- Variables CSS `--color-surface`, `--color-text-primary` no definidas en ningún lado
  → `background: transparent` al abrir el modal. Reemplazadas por valores reales con fallback.
- `GET /plan-cuentas` filtraba `tipo` sin `mode: 'insensitive'` → cuentas mal capitalizadas
  excluidas. Corregido con comparación case-insensitive.

#### Feature — Configuración contable (asientos automáticos configurables) (`6b081f3`)
Nueva tabla `configuracion_contable` (1 fila por empresa) con 6 campos de código de cuenta:
`codigoCuentaComprasGasto`, `codigoCuentaInventario`, `codigoCuentaIvaCompras`,
`codigoCuentaCxP`, `codigoCuentaCajaCompras`, `codigoCuentaCostoVentas`.
- `GET/PUT /api/contabilidad/configuracion-asientos` — valida que el código exista y acepte movimiento
- UI en ContabilidadHub → tab Plan de Cuentas: 5 selectores por tipo de cuenta
- `_resolverCuenta()` en `utils/contabilidad.js`: usa la cuenta configurada o cae al default
  sin romper nunca el asiento (fallback gracioso con log de advertencia)
- Migración: `20260704000000_configuracion_contable/migration.sql`

#### Feature — Asiento automático de costo de ventas en facturas (Principio #3) (`c7adfd7`)
`crearAsientoCostoVentaFactura()`: toma el costo real congelado en `movimientos_inventario`
al momento de la venta (no el costo actual del producto). Solo genera asiento si la factura
tiene ítems inventariables. Se llama junto al asiento de venta tras autorización SRI.

#### Feature — Asientos completos para Notas de Venta (`5c429dd`)
- `crearAsientoVentaNotaVenta()`: Debe Caja / Haber Ventas (sin IVA — RIMPE)
- `crearAsientoCostoVentaNotaVenta()`: Debe Costo de Ventas / Haber Inventario
- `crearAsientoReversoNotaVentaAnulada()`: reversa ambos asientos al anular

#### Fix — Buzón SRI no generaba asientos de compra (`de6b37e`)
Los 4 endpoints de importación del Buzón SRI nunca llamaban a `crearAsientoFacturaCompraRegistrada`.
Fix: nuevo helper `_generarAsientoSiAplica()` en `buzon.js`, no bloqueante.

#### Feature — Asientos para retenciones y NC/ND recibidas (`f666fbf`)
- `crearAsientoRetencionRecibida()`: Debe Retención IVA (`1.1.07.001`) + Retención Renta
  (`1.1.07.002`) / Haber CxC
- `crearAsientoDocRecibidoOtro()`: NC reduce CxP, ND aumenta CxP

#### Feature — Asiento opcional para movimientos bancarios y cheques (`cbe029f`)
`crearAsientoMovimientoBancario()`: usuario elige cuenta contrapartida; si no la elige,
el movimiento se registra sin asiento (no se fuerza nada). Requiere cuenta bancaria vinculada al plan.

#### Bug crítico — Facturas históricas (Excel) nunca generaban asiento (`3a032cf`)
`crearAsientoFacturaAutorizada` solo se llamaba desde el job SRI. Las facturas con
`origenRegistro='IMPORTACION'` nunca pasaban por ese job → 0 asientos contables.
Fix: llamar la función con la **fecha histórica** de cada factura, no la de hoy.
Se agrega columna "Libro Diario" (✓ Enlazada / ⚠ Sin asiento) en el resultado de importación.

#### Feature — Reparación retroactiva sin reimportar (`8ad0bb7`)
`POST /api/facturas/importar/generar-asientos-faltantes`: genera asientos para facturas
ya importadas antes del fix, idempotente. Botón "Generar asientos faltantes" en la UI.

#### Feature — Centros de Costo dimensionales (Principio #4) (`cf16980`)
- Nueva tabla `centros_costo` (`codigo`, `nombre`, `descripcion`, `empresaId`, `activo`)
- Campo `centroCostoId Int?` opcional en `asientos_contables_detalle` (FK SET NULL)
- CRUD `GET/POST/PUT/DELETE /api/contabilidad/centros-costo`
- Nuevo tab "Centros de Costo" en ContabilidadHub
- Selector de centro de costo en cada línea al crear/editar asientos manuales
- Migración: `20260704120000_centros_costo/migration.sql`

#### Feature — Provisiones automáticas de nómina (Principio #5) (`c6a61da`)
- `crearAsientoNominaPeriodo()`: Debe Gasto Sueldos + Aporte Patronal + Provisiones /
  Haber Sueldos por Pagar + IESS + Retención IR + Provisiones + Anticipos. Se dispara
  al cambiar nómina BORRADOR→PROCESADA. Fecha = fin de mes del período.
- `crearAsientoPagoNominaPeriodo()`: Debe Sueldos por Pagar / Haber Caja. Al marcar PAGADA.
- Crea cuentas `5.1.02.001-005` y `2.1.05.001-007` automáticamente si no existen.
- Nómina.jsx: toast con resultado del asiento al procesar/pagar.

#### Feature — Importar facturas de COMPRA históricas (`e7415cb`)
- `backend/utils/importarComprasHistoricas.js`: valida proveedor (tipo/RUC/nombre),
  `numero_factura` obligatorio, genera asiento `COMPRA` con fecha histórica desde el día uno.
  No toca inventario (mismo criterio que ventas históricas).
- `frontend/src/components/Compras/ImportarComprasHistoricas.jsx`: wizard 4 pasos.
- Ruta `/compras/importar-historicas`, entrada en menú de Compras.

#### Docs actualizados
- `AyudaSistema.jsx`: sección multiempresa, Plan de Cuentas avanzado, configuración
  contable, Bancos, facturas históricas, Buzón SRI corregido
- `docs/manual-usuario.md`: contabilidad (12.3.1), Bancos (13.1), Facturación (7.7),
  Compras (9.7 — Buzón SRI con información correcta)

#### Estado 5 principios ERP contable
| # | Principio | Estado |
|---|-----------|--------|
| 1 | Cuentas de control (no cuentitis) | ✅ Seguido — CxC/CxP usan FK a clientes/proveedores |
| 2 | Mapeo SRI → cuenta contable | 🟡 Parcial — configuración manual del contador (tabla `configuracion_contable`); motor automático por código SRI es mejora opcional futura |
| 3 | POS + inventario permanente | ✅ Facturas (`c7adfd7`) + Notas de Venta (`5c429dd`) |
| 4 | Centros de costo dimensionales | ✅ `cf16980` |
| 5 | Provisiones RRHH automáticas | ✅ `c6a61da` |

### 27. Sesión 2026-07-13 — 7 bugs + utilidad por ítem en compras + 4 decimales en facturas

Ver `docs/pendientes-2026-07-13.md` para el detalle exhaustivo (5 commits, lista de
verificación y backlog completo).

**Bugs corregidos:**
- Rol `contador` no podía emitir facturas de venta — faltaba `facturacion.emitir` en el rol.
- Compras 0% por $13.50 "invisibles" en declaración F104 — eran liquidaciones de compra (tipo
  SRI `03`), no facturas; el desglose visual ahora explica la composición del total.
- Gastos personales (alimentación, salud, vivienda, vestimenta, educación) se sumaban al F104 —
  nuevo campo `esGastoPersonal` en `facturas_compra`; la declaración los filtra y avisa cuántos
  excluyó. UI en DetalleCompra: checkbox + categoría en modal Editar, badge ámbar en vista.
- Libro de bancos no generaba asientos — nuevos endpoints de contabilización individual y por
  lote (`POST /bancos/:id/contabilizar-pendientes`); LibroBancos muestra columna 📒/⚠ y botón
  para contabilizar pendientes; BancosHub avisa si la cuenta no tiene cuenta contable asignada.
- Regenerar asiento de compra ignoraba `cuentaGastoId` cuando había ítems inventariables —
  `subtotalInventario` ahora vale 0 cuando hay cuenta explícita, de modo que todo el importe
  va a la cuenta de gasto configurada y no al Inventario Mercaderías.
- No había vista de notas de crédito recibidas de proveedores — nuevo componente
  `NotasCreditoRecibidas.jsx`, endpoint `GET /compras/notas-credito`, botón en ListaCompras.

**Bugs corregidos (sesión anterior, mismo día, commit `b1be14a`):**
- Compras manuales excluidas del F104 — filtro `receptorEsRuc: { not: false }` en Prisma
  excluía NULLs; corregido a `OR: [{null}, {true}]`.
- Cambiar cuenta contable no regeneraba el asiento automáticamente.
- Tab "Importar" en Cuentas por Cobrar — importar cobros masivos desde Excel.

**Features:**
- Utilidad% y PVP variable por ítem al cargar facturas de compra (FormCompra) — cálculo
  cruzado automático; al guardar actualiza el PVP del producto en catálogo.
- Editar utilidad% y PVP en facturas ya registradas (DetalleCompra) — nuevas columnas Utilidad%
  y PVP en la tabla de ítems; botón ✏️ por fila → modal con cálculo cruzado; backend
  `PATCH /compras/:id/item-utilidad` sincroniza el catálogo.
- Facturas y proformas de venta aceptan hasta 4 decimales en precio unitario (`sri.js` acumula
  con precisión completa antes de redondear; totales SRI siguen siendo 2 dec, obligatorio).

### 28. Sesión 2026-07-13 (parte 3) — Auditoría de código: 2 bugs críticos + 4 features documentados retroactivamente

Ver `docs/pendientes-2026-07-13-parte3.md` para el detalle exhaustivo. Sesión de auditoría
de código (no de features reportadas por el usuario) sobre trabajo de otra sesión que había
quedado sin documentar ni verificar.

**Bugs críticos encontrados y corregidos, ninguno reportado — detectados leyendo el código
antes de llegar a producción:**
- **Cuentas por Cobrar nunca funcionó** (`021a759`) — las 7 consultas de `cxc.js` filtraban
  `estadoSri: 'AUTORIZADA'` (femenino) pero el valor real que se guarda en todo el resto del
  sistema es `'AUTORIZADO'` (masculino) — nunca coincidía. "Vigentes"/"Canceladas" siempre
  vacío, registrar cobro y el importador Excel de cobros fallaban al 100%.
- **WebServices API (`/api/ext/v1`) no funcionaba en absoluto** (`9480db6`) — escrito contra
  un schema imaginado: nombres de campo inexistentes, campos obligatorios nunca provistos,
  `detalles` (columna Json) tratada como relación Prisma, pagos escritos en una tabla
  (`pagos_factura`) que no existe. Reescrito completo siguiendo el patrón de "Importar
  facturas históricas" (AVALAB ya emite sus propias facturas autorizadas por el SRI; AELA
  solo las registra para contabilidad, no las autoriza). Verificado con script de
  integración real contra `scfi_dev` (cliente, factura, asiento, cobro, asiento de cobro).

**Features documentados retroactivamente (ya en `main`, de otra sesión, sin doc):**
- Permisos de Configuración (Config SRI/Sistema) ampliados a rol contador (`98bdc5c`).
- Módulo de Anticipos de clientes y proveedores, tab dentro de CxC/CxP (`704efc0`) —
  auditado, sin bugs.
- Fix de aislamiento de tenant: `api.js` ahora extrae el tenant del JWT en vez de
  `localStorage` (podía quedar residual del último tenant visitado) + botón "Restaurar plan
  AELA" (`780782b`).
- Vencimientos automáticos de plan (trial/pagado), PRO mono/multiempresa, y pagos de
  suscripción (transferencia/PayPhone/Stripe) con aprobación manual vía `SUPER_ADMIN_KEY`
  (`1dc8ca6`) — auditado, sin bugs.

### 29. Sesión 2026-07-13/14 (parte 4) — Carga de contabilidad atrasada + 2 bugs de producción confirmados

Ver `docs/pendientes-2026-07-14.md` para el detalle exhaustivo. Continuación directa de la
parte 3, motivada por un cliente real (Comercial S&S / Daniel Puchaicela) con contabilidad
atrasada desde junio 2023.

**Bugs de producción corregidos, confirmados con logs reales de Railway:**
- **Configuración de cuentas por referencia no guardaba** (`f3a7126`) — `P2000: value too
  long for column`. `codigoReferencia` era VARCHAR(20) pero el catálogo de nómina/general
  tiene códigos de hasta 34 caracteres (`INVENTARIO_TRANSFERENCIAS_TRANSITO`,
  `GANANCIA_NETA_EJERCICIO`, etc.). Ampliado a VARCHAR(50). De paso, el PUT no tenía el
  mismo respaldo que el GET para tablas faltantes en tenants sin el fix — ahora se auto-repara.
- **`auditoria.userAgent`/`ip` faltantes en tenants antiguos** (`f3a7126`) — confirmado en
  logs (`column userAgent does not exist`), nunca rompía nada visible
  (`registrarAuditoria` traga sus propios errores) pero ensuciaba los logs en cada acción
  auditada. `applySchemaFixes.js` nunca tuvo una entrada para esas columnas.

**Features — 3 utilidades de carga masiva, promovidas de scripts a funciones reales de la app:**
- `convertirComprasHistoricasSRI.js`: convierte exports crudos del SRI (multi-hoja, hasta 8
  layouts de columnas distintos) a la plantilla de "Importar Compras Históricas", combinando
  todo en la menor cantidad de archivos posible (respeta el límite de 1000 filas). Se queda
  como script — no hay UI porque el input es demasiado variable para automatizar sin revisión.
- **Retenciones Recibidas** (`57a9c63`): nueva pestaña "⬆ Importar desde Excel" — acepta
  directo el "Listado de Retenciones" que exporta el SRI, mismo wizard que Compras.
- **Importar Históricas de ventas** (`2627c2b`): nuevo modo "🗂 Desde XML autorizados (.zip)"
  además del Excel — parsea `<factura>` autorizado directamente, sin re-teclear nada.

Las 3 utilidades se verificaron end-to-end vía HTTP real (JWT real, no solo `node -c`)
contra los archivos reales del cliente antes de entregarlas.

### 26. Sesión 2026-07-12 — Bug real en declaraciones (F104/retenciones recibidas), RUC vs Cédula, DetalleCompra responsiva, recibo de cobro

Ver `docs/pendientes-2026-07-12.md` para el detalle exhaustivo. A diferencia de sesiones
previas (features nuevas), esta fue debugging de **datos y cálculos reales** disparado por
preguntas del cliente sobre su declaración tributaria — dos hallazgos llevaban semanas
afectando silenciosamente los números que usa para declarar al SRI.

- **Retenciones Recibidas en $0.00** (`0d7c903`): el parser (`buzon.js`) solo soportaba el
  schema v1.0.0 del SRI; los agentes de retención reales usan v2.0.0 (anidado por documento
  sustento) — confirmado con 3 XML reales. Además leía `valorRetener` en vez de
  `valorRetenido`, y la fecha caía siempre en la de importación. Reparación retroactiva:
  botón "Recalcular totales".
- **F104 restaba las retenciones equivocadas** (`04b8af5`): usaba las que la empresa emite a
  proveedores (obligación del F103) en vez de las que sus clientes le retienen a ella (crédito
  real del F104) — el "IVA a pagar" mostrado estuvo sobreestimado. De paso, `declaraciones.js`
  completo migrado a `req.prisma` (usaba el cliente global, bug potencial multi-tenant).
- **Crédito tributario arrastrado** (`711aa0e`): campo nuevo en F104, no existía dónde
  ingresarlo. No se encadena automático mes a mes a propósito.
- **DetalleCompra no responsiva** (`9598db4`, `b0c9145`): dos bugs de CSS distintos — grid
  frágil con `max-width` en porcentaje colapsaba valores a 0, y el contenedor de página sin
  `minmax(0,1fr)` dejaba que la tabla de ítems ensanchara toda la página más allá del viewport
  (recortada por `overflow-x:hidden` del layout raíz, no scrolleable).
- **RUC vs Cédula** (`1f1c29c`): compras facturadas a cédula personal (no al RUC de la empresa)
  ahora se excluyen automáticamente de F104/F101 — no son deducibles tributariamente. Columna
  `receptorEsRuc`, calculada al importar del Buzón SRI, con backfill retroactivo.
- **CxC — recibo de cobro PDF** (`71ce673`): benchmark vs "Sofía", cliente priorizó esto sobre
  Importar cobros / cuentas manuales-préstamos / Órdenes de pago (los 3 quedan en backlog).
- Fix de raíz de los 500 intermitentes en CxC/CxP tras cada deploy (race condition esperando
  schema fixes en `prismaTenant.js`). Modal de asiento contable agrandado. Ayuda del sistema:
  6 secciones nuevas para módulos que ya existían sin documentar.

**Parte 2 — segunda ronda, bugs reproducidos en vivo por el cliente:**
- **Asiento de compra descuadrado** (`5887d40`): `crearAsientoFacturaCompraRegistrada`
  descartaba en silencio (`Math.max(...,0)`) un residuo de 1 centavo de drift de redondeo
  entre el desglose por línea y los totales guardados de la compra, dejando el asiento
  con debe > haber. El residuo ahora se absorbe en la línea de inventario.
- **"Imprimir PDF" bloqueado por popup** (`5887d40`): `reportPrint.js` usaba
  `window.open('', ...)` — reemplazado por un iframe oculto, inmune a bloqueadores de
  popups (afecta ATS y Reportes Tributarios).
- **Filtros de Contabilidad colapsaban mal** (`5887d40`): `.conta-filters` pasó de grid
  fijo de 5 columnas a flexbox con wrap — se acomoda de forma continua en vez de saltar
  a una sola columna por debajo de 1100px.
- **Columna Operación en Compras simplificada** (`5887d40`): de 2 filas de badges
  siempre visibles a 4 botones de acción + un popover "···" con la información de
  estado (origen, asiento, aviso de cédula).

### 25. Sesión 2026-07-07 — Benchmark vs "Sofía", Configuración de cuentas por referencia, CxC/CxP

Ver `docs/pendientes-2026-07-07.md` para el detalle exhaustivo (endpoints, modelos, scripts
de verificación). Sesión de dos partes, ambas motivadas por comparar AELA contra "Sofía"
(otro ERP contable ecuatoriano) a partir de capturas de pantalla compartidas por el cliente.

#### Parte 1 — Configuración de cuentas contables por referencia (commit `d07f1ec`)
Nueva tabla genérica `configuracion_cuentas_referencia` (empresaId+categoria+codigoReferencia
→ cuentaId) para catálogos largos que no caben en columnas fijas — reemplaza el patrón de
seguir agregando campos a `configuracion_contable` (que se deja intacta, sigue sirviendo solo
para Compras/Costo de Ventas). Catálogo de referencias en código
(`backend/utils/catalogosCuentasReferencia.js`), reexportando `CODIGOS_RETENCION_RENTA`/
`CODIGOS_RETENCION_IVA` de `sri.js` (ya existían, usados para emitir retenciones) en vez de
retipear la lista de Sofía. 4 categorías: Compras/Ventas (retenciones por código SRI, 19 c/u),
Empleados (13 conceptos de nómina), General (9 referencias, config-only — sin motor que las
use todavía). `crearAsientoRetencionAutorizada`/`crearAsientoRetencionRecibida` ahora desglosan
el asiento por código de retención en vez de 1-2 líneas genéricas fijas; `crearAsientoNominaPeriodo`/
`crearAsientoPagoNominaPeriodo` comparten el mismo mecanismo (se corrigió de paso una
inconsistencia real: antes cada una hardcodeaba su propia cuenta "Sueldos por Pagar" por
separado). Endpoints `GET/PUT /api/contabilidad/configuracion-referencias/:categoria`.
UI: nuevo card con sub-tabs en ContabilidadHub → Plan de Cuentas.

#### Parte 2 — Inventario de módulos + Cuentas por Cobrar/Pagar + 3 mejoras (commit siguiente)
Se auditó el menú completo de Sofía contra AELA (12 áreas). 3 ya existían sólidas (Bancos,
Guías de remisión, Compras), 1 con otro nombre (Ventas=Facturación, Directorio=Clientes/
Proveedores), y **5 módulos no existían en absoluto**: Importaciones/aduanas, Caja chica
formal, Anticipos, Cuentas por Cobrar/Pagar como subledger, Inventario multi-bodega. El
cliente priorizó Cuentas por Cobrar/Pagar; los otros 4 quedan en backlog (ver pendientes).

**Hallazgo clave**: `crearAsientoCobroFactura` (contabilidad.js) ya existía con la lógica de
asiento de cobro correcta, pero estaba huérfana — ningún endpoint la invocaba, y su diseño
(asienta el total de una sola vez, referencia única por factura) es incompatible con cobros
parciales. Se dejó intacta y se crearon 4 funciones nuevas para el subledger real:
`crearAsientoCobroCliente`, `crearAsientoPagoProveedor`, `crearAsientoReversoCobroCliente`,
`crearAsientoReversoPagoProveedor` — referenciadas por el id del cobro/pago (no de la
factura), permitiendo múltiples abonos parciales.

**Cuentas por Cobrar/Pagar** — 2 tablas nuevas (`cobros_cliente`, `pagos_proveedor`),
independientes del JSON `pagos` de facturas/compras (que es metadata SRI de forma de pago,
escrita una vez al emitir, no un log de abonos — se confirmó que `cobrada`/`fechaCobro` en
`facturas` están muertos, ningún endpoint los escribía). Saldo pendiente calculado al vuelo
(importeTotal − suma de cobros/pagos no anulados), sin columna redundante. Validaciones:
factura/compra no anulada, sobre-pago rechazado, lock `SELECT ... FOR UPDATE` dentro de
transacción para evitar condición de carrera con cobros simultáneos. Endpoints
`GET/POST /api/cxc/*` y `/api/cxp/*` (vigentes, canceladas, historial, registrar, anular).
Frontend: `CuentasPorCobrarHub.jsx`/`CuentasPorPagarHub.jsx` (clonan el patrón de tabs de
`BancosHub.jsx`). Permisos nuevos `cxc.ver`/`cxc.gestionar`/`cxp.ver`/`cxp.gestionar`
(backend `utils/roles.js` + frontend `utils/roles.js`, se mantienen como copias espejadas).

**Backlog explícito dentro de CxC/CxP** (no implementado, alcance acotado a propósito):
cheques recibidos de clientes con tracking propio (hoy "cheque" es solo un método de pago
más, sin número/vencimiento/estado), tarjetas de crédito (CxP), importar Excel, reportes
dedicados.

**3 mejoras a módulos existentes** (mismo commit):
- **Bancos**: comprobantes numerados por categoría (`ING-`/`EGR-`/`NC-`/`ND-`/`AJU-`,
  columna `numero` en `movimientos_bancarios`, nullable — sin backfill de movimientos viejos).
- **Compras**: `GET /api/compras/:id/asiento` (ver asiento, antes solo se podía generar, no
  visualizar) + modal de solo lectura en `DetalleCompra.jsx`; `crearAsientoReversoCompraAnulada`
  — **fix de cobertura real**: antes, anular una compra con asiento ya generado no reversaba
  la contabilidad, solo marcaba `anulada:true` — la compra seguía afectando el Libro Diario.
- **Retenciones**: `PUT /api/retenciones/:id` para editar códigos/montos mientras
  `estadoSri !== 'AUTORIZADO' && !anulada` (mismo guard que ya usaba `/reenviar`), regenera
  el XML pero no reenvía automáticamente al SRI.
- **Guías de remisión**: catálogo `transportistas` (mismo patrón CRUD que `centros_costo`) para
  autocompletar — los campos planos en `guias_remision` se mantienen intactos (el XSD del SRI
  los exige así), el catálogo solo evita re-teclear.

**Verificación**: toda la sesión se verificó contra Postgres real (`scfi_dev` local disponible
esta vez, a diferencia de sesiones anteriores) con scripts de integración ad-hoc (crear
datos de prueba, ejercitar la función real, verificar resultado, limpiar) — no solo
`node -c`/`require()`. Sin acceso a navegador en este entorno, así que el flujo de UI
completo (clicks reales) queda pendiente de que el usuario lo pruebe en producción/local.


Ver `docs/pendientes-2026-07-03.md` para detalle completo.

#### Auditoría multi-tenant sistemática (`4d1e3a4`)
- Backend: `facturas.js`, `clientes.js`, `proveedores.js`, `productos.js` — rutas con multer
  migradas a `req.prisma` y `req.prisma.$transaction()`
- Frontend: `ListaLiquidaciones`, `FormLiquidacion`, `ListaNotasDebito`, `FormNotaDebito`,
  `ATS`, `ReportesTributarios` migrados de axios directo al `api` service

#### Plan de cuentas — importación avanzada (`4b5b59e`, `bb2ea49`, `2a03852`, `3340ac8`)
- Modo **reemplazar plan completo**: elimina hijos antes que padres, respeta FK y movimientos
- Endpoint `GET /api/contabilidad/plan-cuentas/estado`: detecta estado del sistema contable
- **UI contextual** con banner 3 estados (inicio/sin-movimientos/en-operación)
- **Drag & drop** con feedback visual en zona de importación
- **Auto-detección** de formato externo (columnas Parent/Esdetalle) con transformación automática
- Protección contra ciclos en parent lookup (Set computing)
- **Plan NIIF Supercias**: 308 cuentas del CUC oficial, endpoint de semilla, elección al inicio

#### Fix importación — columnas no reconocidas (`9ef752e`)
- `parsearBuffer` detecta automáticamente la fila de encabezado real (primeras 10 filas)
- NORM_MAP ampliado con +20 aliases para sistemas contables ecuatorianos
- Diagnóstico visible: muestra columnas detectadas cuando todas las filas fallan
- Fix CSS: `}` sobrante eliminado en `.conta-dropzone-hint`

#### Fix importación — formato externo con headers no estándar (`de905b2`)
- `parsearBuffer` aplica `mapearFila()` antes de `transformarDesdeExterno` para normalizar
  cualquier capitalización/puntuación: `Cod→codigo`, `Tipo.→tipo`, `Parent→codigoPadre`
- `TIPO_EXTERNO_MAP` ampliado + búsqueda parcial + fallback por código numérico
- `acepta_movimiento` acepta `'activo'`, `'si'`, `'yes'`, `'1'`, `'x'`
- Resuelve: 427 filas `undefined` al importar formato externo `Cod/Nombre/Tipo./Parent/Esdetalle`

#### Principios de diseño ERP contable (documentados)
5 principios compartidos por el usuario para guiar la arquitectura contable futura:
cuentas de control, mapeo SRI, POS+inventario permanente, centros de costo, provisiones RRHH.
Ver `memory/feedback_erp_contabilidad_design.md`.

### 21. Sesión 2026-05-01 — Seguridad, catastro SRI y cierre de rebrand

#### Rebrand SCFI → AELA completado al 100%
- Service Worker (`sw.js`): caches `aela-app-v2`, `aela-api-v1`, sync tag `aela-sync-queue`, mensaje `AELA_SYNC_NOW`.
- PWA Manifest: nombre "AELA ERP", theme_color `#7C3AED`.
- Landing `ant/`: branding completo AELA, email `info@aela.ec`.
- Variables de entorno: `AELA_EDITION`, `AELA_DOMINIO_BASE` en `.env`, `.env.example` y `email.js`.
- `package.json` raíz: nombre `aela-erp`.
- 0 referencias SCFI en código fuente.

#### Bases de datos renombradas
- `scfi_db` → `aela_db` | `scfi_master` → `aela_master`
- `.env` actualizado. Backend conectado a `aela_db` verificado.

#### Catastro SRI importado
- 6.799.463 contribuyentes en tabla `contribuyentes_sri` (25 provincias).

#### POS — mejoras
- Modal de edición de cliente con datos incompletos (abre automáticamente al detectar campos vacíos).
- Campo `telefono` agregado a `notas_venta` (Prisma + migración + recibo PDF).

#### Seguridad
- `dbPass` en tabla `tenants` ahora se cifra con **AES-256-GCM** (`utils/cifrado.js`).
- `DB_ENCRYPT_KEY` (32 bytes, 64 hex chars) en `.env`.
- Tenant existente migrado a contraseña cifrada.
- `JWT_SECRET` renovado con clave aleatoria segura de 48 bytes.

#### Timeout de sesión
- Cierre automático por inactividad: aviso a los 25 min, logout a los 30 min.
- Implementado en `AuthContext.jsx` con event listeners globales.

#### Manual de usuario
- `docs/manual-usuario.md` creado — cubre todos los módulos del sistema.

### 22. Sesiones 2026-05-20 / 2026-05-24 — SaaS multi-tenant completo en Railway

#### Arquitectura multi-tenant operativa
- **`resolverTenant` middleware** añadido globalmente en `app.js` → cada request identifica su BD de tenant por el header `X-Tenant-Slug`.
- **`routes/auth.js`**: todas las rutas usan `req.prisma` en lugar del cliente Prisma global → cada empresa autentica contra su propia BD.
- **`middleware/auth.js`**: `proteger` usa `req.prisma || prisma` para soportar tanto modo mono como multi-tenant.
- **`middleware/tenant.js`**: null-guard en `buscarTenant` (cuando master no está disponible), manejo de `estado='error'` con respuesta 503 amigable.

#### Provisioning de tenants sin psql (Railway)
- **`utils/provisionarTenant.js`**: `crearBaseDatos()` reescrita usando `pg` Client directo en lugar de `execSync('psql ...')` — psql no existe en Railway.
- Credenciales del tenant: usan las del servidor Railway (`DATABASE_ADMIN_URL`) con diferente nombre de BD, en lugar de usuario/contraseña aleatorios apuntando a localhost.
- **`scripts/fixTenantCredentials.js`**: corrige registros de tenant existentes que tenían `dbHost='localhost'`.

#### Aislamiento schema aela_master (nunca más destruido por prisma)
- **`config/prismaMaster.js`**: auto-agrega `?schema=aela_master` a `DATABASE_MASTER_URL` → Prisma Master usa esquema PostgreSQL separado.
- **`scripts/migrateMaster.js`**: reescrito con `pg` directo — crea esquema `aela_master`, crea tablas de catálogo sin depender del CLI de Prisma.
- **`start.sh`**: `prisma db push --accept-data-loss` → `prisma migrate deploy` (no destruye las tablas master).
- **`package.json`**: `postinstall` genera `@prisma/client-master` automáticamente en Railway.

#### URL de acceso sin prefijo — `/:slug`
- Clientes acceden con URL limpia: `https://aela.corpsimtelec.com/torneosloja` (sin `/acceso/` ni `?tenant=`).
- **`routes/registro.js`**: campo `urlAcceso` en el formulario → validación de slug (3-30 chars, a-z0-9-), lista completa de palabras reservadas (todas las rutas del sistema + palabras de infraestructura), verificación de unicidad en BD master. El estado devuelve `${APP_BASE_URL}/${slug}`.
- **`App.jsx`**: ruta `/:slug` como catch-all al final del árbol de rutas — React Router v6 prioriza rutas estáticas sobre segmentos dinámicos, sin colisión con `/login`, `/dashboard`, etc.
- **`components/Tenant/AccesoTenant.jsx`**: guarda slug en `localStorage('aela_tenant_slug')` y redirige a `/login`.
- **`utils/email.js`**: URL de bienvenida usa `${APP_BASE_URL}/${slug}` (path-based) en lugar del formato de subdominio anterior.
- **`landing/registro.html`**: preview en vivo muestra `aela.corpsimtelec.com/slug`; `APP_URL` corregido a `aela.corpsimtelec.com`.

#### Variables de entorno necesarias en Railway
```
DATABASE_MASTER_URL   → misma BD que DATABASE_URL con schema=aela_master
DATABASE_ADMIN_URL    → conexión admin para CREATE DATABASE (puede ser = DATABASE_URL)
MODO_EMPRESA          → multi
APP_BASE_URL          → https://aela.corpsimtelec.com
DB_ENCRYPT_KEY        → 64 hex chars para cifrar dbPass de tenants
```

#### Flujo end-to-end implementado
```
1. Cliente llena registro.html → POST /api/registro
2. Backend responde inmediatamente (200) con mensaje "configurando..."
3. Background: provisionarTenant() → CREATE DATABASE → prisma migrate deploy → estado='activo'
4. Frontend hace polling GET /api/registro/estado/:email cada 3s
5. Al activarse: barra verde 100% + botón "🚀 Ir a mi sistema"
6. Cliente abre https://aela.corpsimtelec.com/slug
7. AccesoTenant guarda slug en localStorage → redirige a /login
8. Login detecta slug → llama /api/auth/bootstrap-status con X-Tenant-Slug
9. Si no hay usuarios: muestra bootstrap para crear administrador
10. Administrador se crea → login normal → sistema operativo
```

---

## Pendiente

### 🔴 Prioridad alta — ANTES de producción

1. **Subir a producción** — ver `despliegue.md` para la guía completa
   - Crear repositorio GitHub (si no existe)
   - Railway: backend + BD master (`aela_master`) + PostgreSQL
   - Vercel: frontend React
   - Cloudflare Pages: landing page
   - Cambiar variables de entorno para producción
   - Ejecutar migraciones en producción
   - Cambiar `API_URL` y `APP_URL` en `landing/registro.html`
   - Cambiar `APP_URL` en `landing/main.js`

2. **SMTP para emails de bienvenida** — actualmente el provisioning crea la BD pero NO envía email
   - Completar `enviarEmailBienvenida()` en `registro.js`
   - Configurar `SMTP_*` en `.env` de producción
   - Template de email con URL de acceso `https://slug.dominio.com`

3. **Revisar flujo SRI en producción** con certificado real y ambiente de producción del SRI

### 🟡 Prioridad media — mejoras funcionales

4. **Pasarela de pagos** para planes Medium y Pro
   - Integrar PayPhone (Ecuador) o Stripe
   - Webhook `POST /api/webhooks/pago` → `actualizarPlanTenant(slug, 'medium'|'pro')`
   - Actualización automática del plan tras pago confirmado

5. **Polling de estado de registro** en `registro.html` ✅ **Completado**
   - `setInterval` cada 3 s llama `GET /api/registro/estado/:email`
   - Barra de progreso animada con mensajes rotativos (6 etapas)
   - Cuando `estado = 'activo'` → barra verde al 100% + botón "🚀 Ir a mi sistema ahora →" con `urlAcceso` real
   - Cuando `estado = 'error'` → mensaje con contacto WhatsApp / email soporte
   - Timeout a los 3 min (60 intentos) → nota informativa sin cortar la experiencia

6. ✅ **Encriptación de credenciales de BD** — completado 2026-05-01
   - `dbPass` cifrado con AES-256-GCM (`utils/cifrado.js`), clave independiente `DB_ENCRYPT_KEY`

7. **Panel de administración SaaS** (backoffice CorpSimtelec)
   - Ver todos los tenants, planes, estado
   - Activar/suspender tenants
   - Ver logs de provisioning fallidos

### 🔴 Prioridad alta — Verificar en producción (sesión 2026-07-13/14, parte 4)

Ver `docs/pendientes-2026-07-14.md` sección "VERIFICAR MAÑANA EN PRODUCCIÓN".

1. **Configuración de cuentas por referencia** — asignar cuenta a una referencia de Nómina
   o General (código largo, ej. "Ganancia neta del ejercicio") → Guardar. Antes fallaba
   siempre con estas.
2. **Importar retenciones desde Excel** — Retenciones Recibidas → pestaña "⬆ Importar desde
   Excel" con uno de los 3 archivos reales del cliente.
3. **Importar ventas desde XML** — Ventas → Importar históricas → modo XML (.zip).
4. **Carga real de contabilidad atrasada de Comercial S&S** — una vez confirmados 1-3, usar
   los archivos ya generados para cargar los datos reales del cliente (escribe en
   producción — coordinar antes).

### 🔴 Prioridad alta — Verificar en producción (sesión 2026-07-13, parte 3 — bugs críticos)

Ver `docs/pendientes-2026-07-13-parte3.md` sección "VERIFICAR EN PRODUCCIÓN". Los 2 más
urgentes, porque antes de estos fixes el módulo entero no funcionaba:

1. **Cuentas por Cobrar → Vigentes** — debe mostrar facturas pendientes reales por primera
   vez (antes siempre vacío por el bug `estadoSri: 'AUTORIZADA'` vs `'AUTORIZADO'`).
2. **WebServices API con AVALAB** — antes de conectar AVALAB en serio, probar
   `POST /api/ext/v1/facturas` con una API key de prueba y datos reales, y confirmar que la
   factura y su asiento contable aparecen en el Libro Diario del tenant correcto.
3. Confirmar en Railway que existe `SUPER_ADMIN_KEY` (aprobar pagos de suscripción
   manualmente) y las variables de `PAYPHONE_*`/`BANCO_*` si ya se va a usar esa pasarela.

### 🔴 Prioridad alta — Verificar en producción (sesión 2026-07-13)

Ver `docs/pendientes-2026-07-13.md` sección "VERIFICAR EN PRODUCCIÓN" para la lista detallada.
Los más críticos (todos requieren navegador):

1. **Rol contadora** — usuario con rol `contador` puede crear facturas desde `/facturacion/nueva`.
2. **Gastos personales** — marcar compra como gasto personal → F104 baja ese importe + aviso.
3. **Libro bancos** — depósito con contrapartida → columna 📒; "Contabilizar pendientes" en lote.
4. **Regenerar asiento** — compra con cuenta contable asignada → asiento usa esa cuenta, no Inventario.
5. **NC Proveedores** — Compras → "📋 NC Proveedores" muestra notas de crédito del buzón SRI.
6. **Utilidad ítem ya registrado** — compra `001-010-000523799`, botón ✏️ en ítem VIA320 ($1.32),
   ingresar 30% → PVP = $1.72, guardar, verificar en catálogo.
7. **4 decimales en facturas** — precio 1.2575 × 3 → total $3.7725 en línea; XML generado ok.

### 🔴 Prioridad alta — Verificar en producción (sesión 2026-07-04/05)

Ver `docs/pendientes-2026-07-04.md` sección "PENDIENTES PARA MAÑANA" para lista completa de 12 puntos.
Los más críticos:

0. **Generar asientos faltantes** — facturas históricas ya importadas antes del fix `3a032cf`:
   ir a Ventas → Importar históricas → "Generar asientos faltantes". Idempotente, seguro.
1. **Confirmar deploy Railway** — verificar que el deployment activo corresponde al commit
   `62ed9f6` (o posterior). Si no, forzar "Clear build cache & redeploy".
2. **Bancos en Consorcio Vial** — modal sólido (no transparente), selector cuenta contable funcional.
3. **Configuración contable de compras** — configurar cuenta de gasto propia, importar una compra,
   confirmar en Libro Diario que usa esa cuenta (no la genérica).
4. **Costo de ventas en facturas** — factura con producto inventariable → asiento `COSTO_VENTA`.
5. **Asientos de Notas de Venta** — nota de venta + anulación → asientos `NOTA_VENTA`, `COSTO_VENTA`, `ANULACION_NOTA`.
10. **Centros de Costo** — crear centro de costo, asignarlo en un asiento manual.
11. **Provisiones de nómina** — procesar nómina → asiento `NOMINA` de provisión; pagar → asiento de pago.
12. **Importar compras históricas** — importar un lote y confirmar asientos `COMPRA` con fecha histórica.

### 🔴 Prioridad alta — Verificar en producción (sesión 2026-07-07)

Ver `docs/pendientes-2026-07-07.md` para la lista completa. Los más críticos (probar en
navegador — todo lo demás ya se verificó con scripts de integración contra Postgres real):

1. **Cuentas por Cobrar/Pagar** — registrar un cobro parcial y uno total sobre una factura real,
   confirmar que pasa de "Vigentes" a "Canceladas" y que el asiento `COBRO` aparece en el Libro
   Diario; repetir el flujo simétrico en Cuentas por Pagar con una compra.
2. **Anular una compra que ya tenga asiento generado** — confirmar que ahora SÍ aparece el
   asiento `ANULACION` de reverso en el Libro Diario (antes de este fix, no se generaba).
3. **Ver asiento desde el detalle de una compra** — botón nuevo en `DetalleCompra.jsx`.
4. **Editar una retención NO autorizada** — cambiar un monto, confirmar que se puede reenviar
   después con los datos nuevos.
5. **Comprobantes bancarios numerados** — registrar un depósito y un retiro, confirmar que
   aparecen con número `ING-AAAAMM-NNNN`/`EGR-AAAAMM-NNNN` en la tabla de movimientos.
6. **Transportistas en Guías de Remisión** — crear una guía con un transportista nuevo, crear
   una segunda guía y confirmar que aparece sugerido al escribir el nombre.
7. **Configuración de cuentas por referencia** (Parte 1) — configurar una cuenta específica para
   un código de retención, generar una retención con ese código, confirmar que el asiento usa
   la cuenta configurada y no la genérica.

### 🟢 Prioridad funcional (mejoras del sistema)

8. **Contabilidad — mejoras opcionales**
   - ~~Motor automático SRI → cuenta~~ ✅ resuelto 2026-07-07 — "Configuración de cuentas por
     referencia" (retenciones por código SRI, nómina, general). Ver sección 25.
   - **Puppeteer en Railway** — solo si el scraper SRI sigue fallando tras el fix fetch+JSF

9. **Talento Humano**
   - Impuesto a la Renta auto-calculado (tabla progresiva LORTI)
   - Historial salarial por empleado (contratos)
   - Notificaciones de ausencias pendientes de aprobación
   - SBU actualizable desde Configuración (ya existe campo, confirmar UI)

10. **Reportes**
    - Exportación PDF/Excel de nómina (más allá del CSV actual)
    - Reportes de ventas por período
    - Reportes de compras por proveedor

11. **Seguridad adicional**
    - 2FA para roles administrador
    - Log de auditoría de acciones críticas (eliminar, anular, cambiar rol)
    - Política de contraseñas configurable

12. **Pruebas automatizadas**
    - Ampliar cobertura de rutas críticas (registro, provisioning, nomina)
    - Tests de integración frontend con Playwright o Cypress



## Riesgos o consideraciones actuales

- el ambiente `produccion` en SRI no debe asumirse listo solo por estar seleccionado; requiere validacion operativa real con certificados y comprobantes de prueba controlados
- los servicios publicos del SRI no siempre devuelven toda la informacion esperada; por eso el sistema ya contempla carga manual cuando el detalle no esta disponible
- en Windows, `prisma generate` puede fallar con `EPERM` si el backend esta usando el cliente Prisma al mismo tiempo
- el plan de cuentas base es un punto de partida; el contador debe adaptarlo a la realidad contable de la empresa
- el SBU Ecuador esta hardcodeado en `$460` (2024); debe revisarse anualmente o llevarse a configuracion del sistema
- la tabla de Impuesto a la Renta no esta implementada aun en nomina; actualmente se ingresa manualmente como descuento

## Recomendacion de siguientes pasos

1. completar y probar Configuracion SRI de la empresa activa con datos reales
2. cargar algunos productos iniciales o importarlos desde compras
3. probar flujo completo de compra -> retencion -> inventario -> venta -> caja
4. revisar contabilidad con el contador y ajustar plan de cuentas
5. validar con operaciones reales el maestro de proveedores y la vinculacion compra -> retencion
6. registrar empleados reales y procesar primera nomina de prueba
7. revisar si el SBU debe llevarse a un campo configurable en Configuracion del Sistema

## Criterio de estado actual

Estado general recomendado: `funcional en desarrollo activo`

Esto significa:

- ya se puede operar buena parte del sistema
- varias areas ya estan integradas entre si
- aun faltan pulidos, validaciones reales y algunos submodulos importantes
- la documentacion ya existe, pero debe mantenerse actualizada conforme se siga ampliando AELA
