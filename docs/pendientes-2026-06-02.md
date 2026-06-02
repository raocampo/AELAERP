# AELA ERP — Pendientes al 2026-06-02
## Sesión de trabajo: marcadores, Panel Admin, marca blanca

---

## ✅ Completado en esta sesión

### 1. Slug en URL del login — marcadores del navegador

**Problema:** Clientes guardaban `aela.corpsimtelec.com/login` como marcador. Sin slug en la URL y sin localStorage (otro dispositivo), cargaban corpsimtelec en vez de su sistema.

**Fix:**
- `AccesoTenant.jsx`: redirige a `/login?slug=mprq` en vez de `/login`
- `Login.jsx`: lee `?slug` de la URL antes de cualquier llamada API, limpia sesión anterior si cambió el tenant

**URL correcta para marcadores del cliente mprq:**
```
https://aela.corpsimtelec.com/mprq
  (redirige automáticamente a /login?slug=mprq)
```

**Commit:** `62a3530`

---

### 2. Fix loop infinito en Panel Super Admin

**Problema:** `useSaApi` retornaba un nuevo objeto `{get, put, post}` en cada render. Esto hacía que `cargarDatos` se recreara y el `useEffect` lo llamara en loop → `ERR_INSUFFICIENT_RESOURCES` en la consola.

**Fix:** `useMemo` en el retorno de `useSaApi` estabiliza la referencia del objeto.

**Commit:** `f88caab`

---

### 3. Soporte de dominio personalizado (marca blanca)

Para clientes que quieren su propio dominio (`erp.miempresa.com`) en lugar de `aela.corpsimtelec.com/slug`.

**Backend `auth.js`:**
- Nuevo endpoint público `GET /api/auth/identificar-dominio?host=erp.miempresa.com`
- Dado un hostname, retorna el `{ slug, plan }` del tenant que lo tiene configurado en `brandConfig.dominio`

**Backend `superAdmin.js`:**
- `PUT /api/super-admin/tenants/:id` ahora acepta `dominioPersonalizado`
- Se persiste en `brandConfig.dominio` del tenant (merge con brandConfig existente)

**Frontend `App.jsx`:**
- Al cargar la app, detecta si el hostname NO es el dominio base de AELA
- Si es un dominio personalizado y no hay slug en localStorage, consulta `identificar-dominio` y guarda el slug automáticamente

**Frontend `PanelSuperAdmin.jsx`:**
- Campo "Dominio personalizado" en el modal **✏️ Editar** del tenant
- Muestra el dominio actual si ya estaba configurado

**Commit:** `ad99933`

---

### 4. Eliminación del tenant loja-torneos-y-competencia

**Pasos confirmados:**
1. `DELETE FROM aela_master.tenants WHERE slug = 'loja-torneos-y-competencia';`
2. `DROP DATABASE aela_loja_torneos_y_competencia;`

---

### 5. Panel Super Admin activo en producción

- URL: `https://aela.corpsimtelec.com/super-admin`
- Requiere `SUPER_ADMIN_KEY` configurada en Railway (ya activa)
- Funcionalidades: ver tenants, editar plan/estado/dominio, registrar suscripciones, suspender

---

## Flujo para activar marca blanca a un cliente

```
1. Super Admin → Editar tenant → campo "Dominio personalizado" → erp.miempresa.com
2. Cliente crea DNS CNAME: erp → cname.vercel-dns.com
3. Vercel → Settings → Domains → agregar erp.miempresa.com
4. Cliente accede a https://erp.miempresa.com → sistema resuelve tenant automáticamente
```

---

## Estado de tenants activos

| Tenant | BD | Dominio | Plan | Estado |
|--------|-----|---------|------|--------|
| (sin slug) corpsimtelec | `railway` | aela.corpsimtelec.com | Pro | Operativo |
| mprq | `aela_mprq` | aela.corpsimtelec.com/mprq | Pro | Activo / en configuración SRI |

---

## 🔴 Pendientes urgentes

1. **mprq** — el cliente debe completar Configuración SRI y cargar certificado .p12
2. **Eliminar loja-torneos** — ejecutar los dos SQL en DBeaver si no se hizo aún

---

## 🟡 Pendientes medios

3. App móvil — assets reales (logo AELA), prueba completa en dispositivo
4. App móvil — prueba impresora térmica con IP fija

---

## 🟢 Backlog

| # | Tarea |
|---|-------|
| 5 | Pasarela de pagos — PayPhone o Stripe para activación automática de planes |
| 6 | Impuesto a la Renta en nómina (tabla LORTI) |
| 7 | App móvil — ESC/POS Bluetooth, escáner de código de barras |
| 8 | Tests e2e Playwright (web) y react-native-testing-library (móvil) |
| 9 | Catastro SRI — script para actualizar desde CSV oficial del SRI |

---

## Archivos modificados en esta sesión

```
frontend/src/components/Tenant/AccesoTenant.jsx     ← slug en URL del login
frontend/src/components/Auth/Login.jsx              ← lee ?slug de URL
frontend/src/components/SuperAdmin/PanelSuperAdmin.jsx ← useMemo + campo dominio
frontend/src/components/SuperAdmin/PanelSuperAdmin.css ← estilos sa-hint
frontend/src/App.jsx                                ← detección dominio personalizado
backend/routes/auth.js                              ← GET /identificar-dominio
backend/routes/superAdmin.js                        ← PUT acepta dominioPersonalizado
```
