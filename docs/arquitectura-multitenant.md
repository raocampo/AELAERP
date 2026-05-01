# Arquitectura Multi-Tenant — AELA

## Resumen

AELA opera bajo un modelo **"una BD por cliente"** (database-per-tenant).  
Cada empresa tiene su propia base de datos PostgreSQL completamente aislada.  
Un backend Node.js único atiende a todos los tenants resolviendo su BD según el subdominio.

---

## Modelo de despliegue

```
Internet
   │
   ├── cliente1.AELA.com  ─┐
   ├── cliente2.AELA.com  ─┤──→  Nginx (reverse proxy)
   ├── factura.miempresa.com ─┘         │
                                        ▼
                               Backend Node.js (puerto 5600)
                                        │
                          ┌─────────────┼─────────────────┐
                          ▼             ▼                  ▼
                    aela_master    scfi_cliente1     scfi_cliente2
                   (BD tenants)    (BD empresa 1)   (BD empresa 2)
                          │
                    tenants / suscripciones
```

### BD Master (`aela_master`)
- Gestiona el **catálogo de tenants**: quién existe, qué plan tiene, dónde está su BD.
- **Nunca** contiene datos operativos (facturas, clientes, productos).
- Tablas: `tenants`, `suscripciones`.

### BD por Tenant (`scfi_<slug>`)
- Contiene todos los datos operativos del cliente.
- Usa el mismo schema Prisma que el modo monoinstancia.
- Completamente aislada: un error en la BD de un cliente no afecta a otros.

---

## Planes disponibles

| Plan       | Precio base    | Comprobantes/año | Usuarios | Módulos incluidos |
|------------|---------------|-----------------|----------|-------------------|
| **Lite**   | Gratis        | 100             | 3        | Facturas, Notas de Venta, Clientes, Productos (Admin, Facturador, Operador) |
| **Medium** | Desde $15/mes | 1.000           | Ilimitados | + Caja, POS, Compras, Inventario, Talento Humano |
| **Pro**    | Desde $30/mes | Ilimitados      | Ilimitados | + Retenciones, Liquidaciones, ATS, Contabilidad completa |
| **White-label** | Cotización | Ilimitados   | Ilimitados | Todo Pro + marca propia + container dedicado |

### Condiciones del plan Lite
- Gratuito sin expiración mientras se mantenga dentro de los límites.
- Límites: 100 comprobantes/año, **hasta 3 usuarios** (Administrador, Facturador, Operador), sin POS ni Caja.
- Al superar cualquier límite o necesitar módulos adicionales, el sistema ofrece actualizar al plan correspondiente.
- Los módulos no incluidos **se muestran bloqueados** en el sidebar con candado (🔒) y al hacer click muestran el comparativo de planes.

---

## Flujo de activación de un cliente

### Plan Lite (gratuito)
```
Landing → Formulario registro → POST /api/registro
       → Provisioning en background (crea BD + migraciones)
       → Email con URL de acceso: https://slug.AELA.com
       → Cliente completa bootstrap (empresa + admin)
       → Acceso inmediato
```

### Plan Medium / Pro (pago)
```
Landing → Selecciona plan → Formulario registro
       → POST /api/registro (inicia con plan=lite)
       → Redirige a pasarela de pago (PayPhone / Stripe)
       → Pago confirmado → Webhook POST /api/webhooks/pago
       → actualizarPlanTenant(slug, 'medium'|'pro')
       → Email con URL + credenciales de acceso
```

### White-label
```
Contacto directo → Cotización → Configuración manual
       → Se levanta container Docker dedicado (Opción C)
       → Se configura brandConfig: logo, nombre, colores, dominio
       → DNS del cliente apunta a IP del servidor AELA
       → El middleware resuelve por dominio personalizado
```

---

## Resolución de tenant por request

El middleware `resolverTenant` determina qué BD usar en cada request:

```
Request entrante
       │
       ├─ Header X-Tenant-Slug?  → usar ese slug (APIs internas)
       ├─ Subdominio del host?   → extraer slug de cliente1.AELA.com
       ├─ Dominio personalizado? → buscar en brandConfig.dominio
       └─ ENV AELA_TENANT_SLUG?  → modo desarrollo / monoinstancia
                │
                ▼
         Buscar en BD master
                │
          ┌─────┴──────┐
          ▼             ▼
       Encontrado    No encontrado
          │               │
     req.tenant = ...   404 o modo
     req.prisma = ...   monoinstancia
          │
          ▼
      Handler de ruta
      (usa req.prisma en lugar de prisma global)
```

### Cache de tenants
Los registros de la BD master se cachean en memoria por **5 minutos** para evitar consultas en cada request. Al cambiar el plan o estado de un tenant, se invalida el cache con `invalidarCacheTenant(slug)`.

---

## Pool de conexiones Prisma

```javascript
// Una instancia PrismaClient por tenant, reutilizada en requests posteriores
const pool = new Map(); // slug → PrismaClient

getTenantPrisma(tenant) // retorna el cliente existente o crea uno nuevo
```

- Las conexiones se mantienen vivas durante el proceso.
- Al suspender/eliminar un tenant: llamar `removeTenantFromPool(slug)`.
- En un servidor con 50 tenants activos: ~50 conexiones PostgreSQL abiertas.
- Para escalar a cientos de tenants: usar PgBouncer como connection pooler.

---

## Archivos clave

| Archivo | Descripción |
|---------|-------------|
| `backend/prisma-master/schema.prisma` | Schema de la BD master (tenants + suscripciones) |
| `backend/config/prismaMaster.js` | Cliente Prisma para la BD master |
| `backend/config/prismaTenant.js` | Pool de clientes Prisma por tenant |
| `backend/middleware/tenant.js` | Resolución de tenant por subdominio/dominio |
| `backend/utils/provisionarTenant.js` | Creación de BD + migraciones + activación |
| `backend/routes/registro.js` | Registro público desde la landing page |

---

## Variables de entorno necesarias

```env
# BD Master (catálogo de tenants)
DATABASE_MASTER_URL="postgresql://postgres:pass@localhost:5432/aela_master"

# BD Administrativa (para CREATE DATABASE via psql)
DATABASE_ADMIN_URL="postgresql://postgres:pass@localhost:5432/postgres"

# Dominio base del sistema
AELA_DOMINIO_BASE="AELA.com"

# Para desarrollo sin multi-tenant (monoinstancia)
AELA_TENANT_SLUG="mi-empresa"

# Configuración de BD para nuevos tenants
DB_TENANT_HOST="localhost"
DB_TENANT_PORT="5432"
DB_TENANT_USER="postgres"
```

---

## Puesta en marcha del modo multi-tenant

```bash
# 1. Crear la BD master
createdb aela_master

# 2. Configurar DATABASE_MASTER_URL en .env

# 3. Aplicar schema de tenants
npx prisma db push --schema=prisma-master/schema.prisma

# 4. Agregar el middleware al server.js
app.use(resolverTenant);  # antes de todas las rutas

# 5. Registrar la ruta de registro público
app.use('/api/registro', registroRouter);
```

---

## Seguridad

- Las contraseñas de BD de cada tenant se generan aleatoriamente (20 bytes hex).
- En producción, encriptar `dbPass` en la BD master con AES-256 antes de guardar.
- El endpoint `/api/registro` tiene rate limiting (5 intentos / 10 min por IP).
- Los tenants `suspendido` y `vencido` reciben `402 Payment Required` en todos los endpoints.
- El provisioning corre en `setImmediate` (background) — no bloquea la respuesta al cliente.

---

## Escalabilidad

| Escenario | Solución |
|-----------|----------|
| > 100 tenants simultáneos | PgBouncer para connection pooling |
| BD de tenant muy grande | Mover esa BD a servidor PostgreSQL dedicado (cambiar dbHost en tenants) |
| Alta disponibilidad | Réplica del servidor principal + failover Nginx |
| White-label con SLA alto | Container Docker dedicado (Opción C) con su propio PostgreSQL |
