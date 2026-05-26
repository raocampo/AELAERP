# AELA ERP — Pendientes al 2026-05-25
## Para continuar mañana en la oficina

---

## ✅ Completado en esta sesión (2026-05-25)

| # | Tarea | Commit |
|---|-------|--------|
| 1 | Envío automático de documentos fiscales al correo del cliente (Factura, NC, ND, NV) | `1f360b3` |
| 2 | SMTP dual: Resend.com (primario) + Gmail (respaldo automático) | `4f4963f` |
| 3 | `vercel.json`: redirect dominios Vercel → `aela.corpsimtelec.com` + rewrite SPA | `f88d948` / `14b1dd8` |
| 4 | Landing `main.js`: botones "Acceder" siempre apuntan a `aela.corpsimtelec.com` | `5345105` |
| 5 | Sidebar dinámico: logo del cliente, nombre comercial, razón social, "AELA ERP by CorpSimtelec" | `c299c52` |

### Configuración DNS y SMTP completada
- Dominio `corpsimtelec.com` **verificado** en Resend.com ✅
- 3 registros DNS agregados en Donweb (DKIM TXT, MX send, SPF TXT) ✅
- API Key Resend creada (`re_KXdBhV8t...`) ✅
- Variables SMTP primario y backup agregadas en Railway ✅
- **Falta:** hacer Redeploy en Railway para activar el SMTP

---

## 🔴 PRIORIDAD 1 — Redeploy en Railway para activar SMTP

El código de envío de emails está listo y las variables están en Railway, pero
**el servidor no ha reiniciado** con la nueva configuración todavía.

**Pasos:**
1. Abrir Railway → proyecto AELA → Backend → **Deployments**
2. Click en los **tres puntos (⋮)** del último deploy → **Redeploy**
3. Esperar ~2 minutos que arranque
4. Emitir una factura de prueba con email real (ej: `corpsimtelec@gmail.com`) como email del cliente
5. Verificar que llega el PDF adjunto al correo

**Logs esperados tras el Redeploy:**
```
[email] Factura 001-001-000000001 enviada a corpsimtelec@gmail.com
```

---

## 🔴 PRIORIDAD 2 — App Password Gmail para el respaldo SMTP

La verificación en 2 pasos de `corpsimtelec@gmail.com` no estaba activa,
por lo que no se pudo crear la App Password de Gmail (backup SMTP).

**Pasos:**
1. Ir a [myaccount.google.com/security](https://myaccount.google.com/security)
2. Activar **Verificación en 2 pasos**
3. Ir a [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
4. Crear con nombre `AELA ERP Railway` → copiar la clave de 16 chars
5. En Railway → Variables → editar `SMTP_PASS_BACKUP` con esa clave
6. Redeploy

> Sin esto el SMTP backup (Gmail) no funcionará como respaldo.
> El primario (Resend) sí funciona independientemente.

---

## 🟡 PRIORIDAD 3 — Verificar redirect Vercel → aela.corpsimtelec.com

Después del Redeploy de Vercel (automático por el push de hoy), verificar:

1. Abrir `https://aelaerp-git-main-raocampos-projects.vercel.app` en el navegador
2. Debe redirigir automáticamente a `https://aela.corpsimtelec.com`
3. Si no redirige, ir a Vercel → proyecto aelaerp → Deployments → confirmar
   que el commit `14b1dd8` está desplegado como "Ready Latest"

---

## 🟡 PRIORIDAD 4 — Verificar sidebar con branding del cliente

1. Abrir `https://aela.corpsimtelec.com` e iniciar sesión
2. Verificar que el sidebar muestra:
   - **Logo** del cliente (si está configurado en Configuración SRI)
   - **Nombre comercial** en texto morado
   - **Razón social** en texto gris pequeño (si es diferente al nombre comercial)
   - **"AELA ERP by CorpSimtelec"** como subtítulo
3. Si no hay logo cargado → debe mostrar el icono SVG de AELA con los nombres

---

## 🟡 PRIORIDAD 5 — Certificados .p12 en Railway (filesystem efímero)

Los certificados de firma electrónica se suben a disco (`uploads/certificados/`)
y se pierden con cada Redeploy.

**Opciones:**
- A) **Railway Volume** — disco persistente adjunto al servicio (recomendado)
- B) **Guardar en BD como base64** — igual que el logo (ya funciona para logos)

---

## 🟢 BACKLOG (no urgente)

- Modal cliente en POS cuando faltan datos del comprador
- Teléfono en notas de venta (`schema.prisma` + migración)
- Panel admin SaaS (ver todos los tenants, estado, plan, último acceso)
- Pasarela de pagos PayPhone/Stripe para planes Medium/Pro
- Catastro SRI: cargar CSVs en Railway
- Tests e2e con Playwright

---

## Contexto técnico de la sesión

### Variables SMTP en Railway (ya configuradas)
```
# Primario — Resend.com
SMTP_HOST      = smtp.resend.com
SMTP_PORT      = 587
SMTP_USER      = resend
SMTP_PASS      = re_KXdBhV8t...  (API Key completa)
SMTP_FROM      = AELA ERP <info@corpsimtelec.com>
SMTP_SOPORTE   = corpsimtelec@gmail.com

# Backup — Gmail (SMTP_PASS_BACKUP pendiente de configurar)
SMTP_HOST_BACKUP = smtp.gmail.com
SMTP_PORT_BACKUP = 587
SMTP_USER_BACKUP = corpsimtelec@gmail.com
SMTP_PASS_BACKUP = (pendiente — App Password Gmail)
SMTP_FROM_BACKUP = AELA ERP <corpsimtelec@gmail.com>
```

### Cómo funciona el envío de documentos fiscales
```
Factura autorizada por SRI
  └─► procesarFacturaEnSRI() → genera PDF → enviarDocumentoFiscal()
        └─► intenta Resend primero → si falla → intenta Gmail
              └─► email con PDF adjunto al emailComprador

Nota de Crédito → igual, email obtenido de la factura relacionada (facturaId)
Nota de Débito  → igual, email buscado en tabla clientes por identificación
Nota de Venta   → PDF generado en /tmp → email → PDF eliminado
```

### Archivos modificados hoy
```
backend/utils/email.js              ← enviarDocumentoFiscal + SMTP dual fallback
backend/routes/facturas.js          ← hook post-autorización factura y NC
backend/routes/notasDebito.js       ← hook post-autorización ND
backend/routes/notasVenta.js        ← envío en background tras crear NV
frontend/src/components/Layout/Layout.jsx  ← sidebar dinámico con branding
frontend/src/components/Layout/Layout.css  ← estilos cliente logo/nombre
landing/main.js                     ← siempre apunta a aela.corpsimtelec.com
vercel.json                         ← redirect + rewrite SPA
```

### URLs del proyecto
| Servicio | URL |
|----------|-----|
| Frontend (Vercel) | https://aela.corpsimtelec.com |
| Backend (Railway) | https://aelaerp-production.up.railway.app |
| Repo GitHub | https://github.com/raocampo/AELAERP |
