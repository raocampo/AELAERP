# Estado del Proyecto AELA

Fecha de referencia: `2026-04-29`

## Resumen general

AELA ya cuenta con una base funcional operativa para:

- bootstrap inicial de empresa y administrador
- autenticacion por usuario o correo
- gestion de usuarios y roles
- configuracion SRI separada de configuracion del sistema
- facturacion electronica
- notas de venta
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



- **Scripts de backup de BD para desarrollo** (`scripts/backup-dev.ps1` y `backup-dev.sh`): leen `DATABASE_URL` del `.env`, ejecutan `pg_dump` y guardan en `backups/` con timestamp. Mantienen los últimos 20 backups. Deben ejecutarse **antes de toda migración Prisma**.
- **SBU Ecuador configurable**: campo `sbuEcuador` en `configuracion_sistema` (Prisma, migración `20260427234231_sbu_configurable`). La nómina lee el SBU desde la BD en lugar de usar una constante hardcodeada. UI en Configuración del Sistema muestra el campo con nota informativa.
- **Exportación CSV de nómina**: endpoint `GET /api/talento-humano/nomina/:id/csv` que genera un CSV completo con todos los conceptos por empleado, incluyendo fila de totales. Incluye BOM UTF-8 para compatibilidad con Excel. Botón "📥 CSV" en el panel de detalle de nómina.
- **Rol de pagos imprimible**: función `imprimirRolPagos()` en `Nomina.jsx` que genera una ventana HTML completa con diseño para impresión landscape, firma de elaborado/revisado/autorizado, y totales por columna. Botón "🖨️ Imprimir" en el panel de detalle.
- **`capacidadesPlan` en backend**: sincronizado para incluir `talentoHumanoHabilitado` en los tres planes (Lite: false, Medium/Pro: true).


Durante la implementacion se verifico:

- `npx prisma validate`
- `npx prisma generate`
- `npx prisma migrate deploy`
- `npm test` en backend
- `npm test` en frontend
- `npm run lint` en frontend sin warnings
- `npm run build` del frontend sin warnings de chunk grande ni import mixto
- arranque del backend en `http://localhost:5600`
- carga local de rutas backend clave (`compras`, `retenciones`, `proveedores`, `talento-humano`)
- sincronizacion del esquema Prisma con PostgreSQL
- migracion `20260427231353_talento_humano` aplicada exitosamente

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

### 🟢 Prioridad funcional (mejoras del sistema)

8. **Talento Humano**
   - Impuesto a la Renta auto-calculado (tabla progresiva LORTI)
   - Historial salarial por empleado (contratos)
   - Notificaciones de ausencias pendientes de aprobación
   - SBU actualizable desde Configuración (ya existe campo, confirmar UI)

9. **Reportes**
   - Exportación PDF/Excel de nómina (más allá del CSV actual)
   - Reportes de ventas por período
   - Reportes de compras por proveedor

10. **Seguridad adicional**
    - 2FA para roles administrador
    - Log de auditoría de acciones críticas (eliminar, anular, cambiar rol)
    - Política de contraseñas configurable

11. **Pruebas automatizadas**
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
