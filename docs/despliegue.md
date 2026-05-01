# Guía de Despliegue — AELA ERP (CorpSimtelec)

## Arquitectura de producción

| Componente            | Plataforma           | Notas                          |
|----------------------|----------------------|--------------------------------|
| Landing page         | **Cloudflare Pages** | HTML estático, CDN global, gratis |
| Frontend React       | **Vercel**           | Build automático desde GitHub  |
| Backend Node.js      | **Railway**          | 500 h/mes plan gratuito        |
| BD Master (tenants)  | **Railway PostgreSQL** | `aela_master` — catálogo SaaS |
| BD por Tenant        | **Railway PostgreSQL** | Una BD por empresa cliente    |

---

## Diagrama de comunicación

```
[Usuario final]
    │
    ├── aela.ec ────────────────→ Cloudflare Pages  (landing/)
    │       └── /registro.html  → Formulario registro nuevos clientes
    │
    ├── app.aela.ec ────────────→ Vercel  (frontend/dist)
    │                                    │
    │                                    │ HTTPS → /api/*
    │                                    ▼
    │                            Railway Backend (backend/)
    │                                    │
    │                    ┌───────────────┼─────────────────┐
    │                    ▼               ▼                  ▼
    │              aela_master    aela_empresa1    aela_empresa2
    │            (BD tenants)     (cliente 1)      (cliente 2)
    │
    └── (SRI Ecuador) ──────────→ Backend (firma XML, autoriza RIDE)
```

---

## 1. Preparar el repositorio GitHub

```bash
git init
git add .
git commit -m "AELA ERP — versión inicial producción"
git remote add origin https://github.com/tu-usuario/aela-erp.git
git push -u origin main
```

> Asegurarse de que `.env` esté en `.gitignore` (ya lo está). No subir credenciales.

---

## 2. Railway — Backend + BD Master + BDs de Tenants

### 2.1 Crear proyecto en Railway

1. Ir a [railway.app](https://railway.app) → **New Project**
2. **Deploy from GitHub repo** → seleccionar el repositorio AELA ERP
3. Railway detecta `railway.toml` en la raíz automáticamente

### 2.2 Agregar PostgreSQL (BD Master)

1. En el proyecto → **New** → **Database** → **PostgreSQL**
2. Nombrar el servicio: `AELA-master-db`
3. Copiar la variable `DATABASE_URL` generada — esta será `DATABASE_MASTER_URL`

### 2.3 Agregar otra PostgreSQL (BD para el primer tenant / modo mono)

1. **New** → **Database** → **PostgreSQL**
2. Nombrar: `AELA-tenant-db`
3. Esta `DATABASE_URL` será la `DATABASE_URL` del backend y también `DATABASE_ADMIN_URL`

### 2.4 Variables de entorno en Railway (servicio backend)

En el servicio del backend → **Variables** → agregar:

```
NODE_ENV=production
PORT=5600
JWT_SECRET=<mínimo 32 caracteres aleatorios>
JWT_EXPIRES_IN=30d
AELA_EDITION=full
MODO_EMPRESA=multi

# BD del primer tenant (o monoinstancia inicial)
DATABASE_URL=<DATABASE_URL del servicio AELA-tenant-db>

# BD Master para catálogo de tenants
DATABASE_MASTER_URL=<DATABASE_URL del servicio AELA-master-db>

# BD Admin para CREATE DATABASE (usar la misma que master o una con permisos de superusuario)
DATABASE_ADMIN_URL=<DATABASE_URL del servicio AELA-master-db>

# Dominio base del SaaS (subdominio de cada tenant)
AELA_DOMINIO_BASE=app.aela.ec

# Config BD para nuevos tenants (apuntar al servidor PostgreSQL de Railway)
DB_TENANT_HOST=<host del AELA-tenant-db>
DB_TENANT_PORT=5432
DB_TENANT_USER=postgres

# CORS
FRONTEND_URL=https://app.aela.ec

# SMTP (cuando esté configurado)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=info@corpsimtelec.com
SMTP_PASS=<contraseña de app Gmail>
SMTP_FROM=AELA ERP <info@corpsimtelec.com>
```

> **Generar JWT_SECRET:**
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 2.5 Build command (railway.toml ya lo tiene)

El `railway.toml` en la raíz define el start command. Verificar que sea:
```
startCommand = "node backend/server.js"
```

### 2.6 Ejecutar migraciones en producción

Desde Railway CLI o la terminal del servicio:
```bash
cd backend
npx prisma migrate deploy
npx prisma db push --schema=./prisma/schema-master.prisma
```

> La primera migración crea todas las tablas. `schema-master.prisma` crea las tablas de tenants.

---

## 3. Vercel — Frontend React

### 3.1 Importar proyecto

1. [vercel.com](https://vercel.com) → **Add New Project**
2. Importar repositorio GitHub AELA ERP
3. Vercel detecta `vercel.json` automáticamente

### 3.2 Build settings (verificar en Vercel)

| Campo            | Valor                          |
|-----------------|--------------------------------|
| Framework        | Vite                           |
| Build Command    | `cd frontend && npm run build` |
| Output Directory | `frontend/dist`                |
| Install Command  | `cd frontend && npm install`   |

### 3.3 Variables de entorno (Vercel)

En **Settings → Environment Variables**:

```
VITE_API_URL=https://<nombre-servicio>.railway.app
```

> La URL del backend aparece en Railway → **Networking → Public URL**

### 3.4 Dominio personalizado

En Vercel → **Settings → Domains** → agregar `app.aela.ec`
Configurar CNAME en Cloudflare apuntando a `cname.vercel-dns.com`

---

## 4. Cloudflare Pages — Landing page

### 4.1 Crear sitio

1. [pages.cloudflare.com](https://pages.cloudflare.com) → **Create a project** → **Connect to Git**
2. Seleccionar repositorio AELA ERP

### 4.2 Build settings

| Campo            | Valor         |
|-----------------|---------------|
| Build command    | *(vacío)*     |
| Build output dir | `landing`     |
| Root directory   | `/`           |

> La landing es HTML/CSS/JS puro — no requiere build.

### 4.3 Actualizar URLs en landing antes de hacer deploy

**`landing/main.js`** — línea `APP_URL`:
```js
const APP_URL = 'https://app.aela.ec';
```

**`landing/registro.html`** — línea `API_URL` y `APP_URL`:
```js
const API_URL = 'https://<nombre-servicio>.railway.app';
const APP_URL = 'https://app.aela.ec';
```

### 4.4 Dominio personalizado

En Cloudflare Pages → **Custom Domains** → agregar `aela.ec`
Cloudflare gestiona SSL automáticamente.

---

## 5. Checklist pre-deploy

### Variables y configuración

- [ ] `JWT_SECRET` generado y configurado (no usar el del `.env.example`)
- [ ] `DATABASE_URL` apunta a BD de producción
- [ ] `DATABASE_MASTER_URL` apunta a `aela_master` en producción
- [ ] `DATABASE_ADMIN_URL` configurado con usuario con permisos de `CREATE DATABASE`
- [ ] `FRONTEND_URL` en backend = URL de Vercel (`https://app.aela.ec`)
- [ ] `VITE_API_URL` en frontend = URL de Railway
- [ ] `APP_URL` en `landing/main.js` = `https://app.aela.ec`
- [ ] `API_URL` y `APP_URL` en `landing/registro.html` actualizados

### Base de datos

- [ ] Migraciones Prisma ejecutadas: `npx prisma migrate deploy`
- [ ] Schema master aplicado: `npx prisma db push --schema=./prisma/schema-master.prisma`
- [ ] Backup automático de BD configurado en Railway

### Funcional

- [ ] Certificado de firma electrónica subido (para emisión SRI)
- [ ] SMTP configurado y probado (correo de bienvenida al registrar empresa)
- [ ] Flujo completo probado: registro → provisioning → acceso → factura SRI
- [ ] SSL activo en todos los dominios
- [ ] Rate limiting del endpoint `/api/registro` activo (ya está en código)

---

## 6. Variables de entorno — resumen completo

Ver `backend/.env.example` para la lista completa con descripciones.

---

## 7. Consideraciones de seguridad para producción

- `DATABASE_ADMIN_URL` debe usar un usuario PostgreSQL con permisos restringidos (solo `CREATE DATABASE`, no superusuario si es posible)
- En Railway, la conexión entre backend y PostgreSQL es interna (no expuesta a internet)
- Las contraseñas de BD de cada tenant son aleatorias (20 bytes hex) — guardarlas encriptadas con AES-256 (pendiente implementar)
- El dominio `aela_master` debe tener conexiones limitadas solo al backend
- Habilitar firewall de Railway para que solo el backend acceda a las BDs

---

*Última actualización: 2026-04-29 — CorpSimtelec*
