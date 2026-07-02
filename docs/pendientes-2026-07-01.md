# AELA ERP — Sesión 2026-07-01

## Resumen ejecutivo

Diagnóstico y fix de 4 bugs independientes que afectaban el Buzón SRI de la empresa
**PUPUCHAICELA ABENDAÑO** (macro-empresa dentro de Corp Simtelec) al importar 45
documentos recibidos, más un bug no relacionado en Gestión de Empresas. Ninguno de los
bugs de código estaba relacionado con el otro pese a presentarse juntos en la misma sesión.

Commits pusheados: `27f3952`, `b682fb7`, `2b46e69`, `3abddae`

---

## 🔴 PENDIENTE CRÍTICO — Verificar mañana desde la oficina

### 1. Confirmar qué commit quedó activo en Railway

El ID de deployment que muestra el dashboard de Railway (ej. `e643dba9`) **no es el hash
de git** — es el ID interno del build. Se confirmó que ese SHA no existe en
`github.com/raocampo/AELAERP` (404 en la API de GitHub). Para saber con certeza qué
commit está corriendo:

1. Railway → proyecto AELAERP → deployment activo → pestaña **"Details"** (no "Deploy Logs")
2. Ahí debe mostrar el commit real de GitHub con su mensaje
3. Verificar que sea `3abddae` o posterior (el HEAD de esta sesión)
4. Si Railway sigue en un commit viejo (anterior a `a581579`), forzar un redeploy manual
   desde el dashboard ("Redeploy" en el deployment más reciente, o "Clear build cache & redeploy")

### 2. Confirmar log de versión del scraper

Se agregó un marcador en `backend/utils/sriScraper.js` para diagnosticar esto sin
depender del dashboard. Al arrancar el servidor debe verse en Railway logs:
```
[SRI] sriScraper.js build 2026-07-01 — incluye hash MD5+SHA-512 (a581579)
```
Si NO aparece esta línea, el deploy no tomó el último código.

### 3. Reintentar "Importar XML" en PUPUCHAICELA (los 45 documentos)

**No usar "Importar TXT" ni "Por claves de acceso"** para estos documentos — son de
febrero 2023 y el webservice en vivo del SRI (`AutorizacionComprobantesOffline`) tiene
un límite de fecha, confirmado probándolo directamente:
```
<informacionAdicional>No es posible validar la clave de acceso ya que la fecha de
emision esta fuera del rango permitido.</informacionAdicional>
```
Usar **"Importar XML"** o **"Importar ZIP"** con los archivos ya descargados de
`srienlinea.sri.gob.ec` — esa vía no vuelve a consultar al SRI, parsea el XML directo.

Si tras el deploy sigue dando error de `Foreign key constraint` / `EMPRESA_NO_ENCONTRADA`
(409), pedir a Lucia/Robert cerrar sesión y volver a entrar (JWT viejo referenciando
una empresa que el middleware ya no puede resolver a un id falso — ver Bug 1 abajo).

### 4. Confirmar login del scraper SRI (Descarga automática)

Con RUC `1103568240001` (o el de PUPUCHAICELA) + clave real, tab "Descarga automática SRI".
Log esperado si el hash fix está realmente corriendo:
```
[SRI-fetch] POST body: usuario=... | password_hash=... (160 chars)
[SRI-fetch] POST resultado: 302 | location: https://srienlinea.sri.gob.ec/tuportal...
```
Si sigue devolviendo 200 + "Clave inválida / inactiva" después de confirmar el deploy
correcto (punto 1), ahí sí habría que revisar si la clave del portal cambió.

### 5. Confirmar que Gestión de Empresas guarda tipoContribuyente/repLegal/contadora

Editar cualquier empresa jurídica → llenar Representante Legal + Contadora (ahora "RUC
de la contadora", 13 dígitos) → Guardar → recargar la página → reabrir el formulario de
esa empresa → verificar que los datos persistieron (antes se descartaban silenciosamente).

---

## Lo que se hizo hoy (cronológico)

### Bug 1 — `req.empresa` fantasma → FK violation en facturas_compra (`27f3952`)

`backend/middleware/auth.js`: cuando no podía resolver la empresa del JWT ni ninguna
empresa activa como fallback, **inventaba** `req.empresa = { id: empresaIdActiva || 1 }`
sin validar que la fila existiera. Cualquier `create()` con FK sobre `empresaId` fallaba
en cascada (45 de 45 en "Importar XML" con `facturas_compra_empresaId_fkey`).

**Fix:** si `empresaIdActiva` estaba seteado pero no se resolvió a ninguna empresa real,
responde 409 `EMPRESA_NO_ENCONTRADA` pidiendo re-login, en vez de fabricar un id falso.
El fallback a `id:1` se conserva solo para instalaciones mono-empresa legítimas sin
`empresaId` en el JWT ni en el usuario.

### Bug 2 — Posible deploy atascado en Railway (`27f3952`)

Comparando el log de producción línea por línea contra `git show a581579` (fix de hash
MD5+SHA-512 del login SRI, sesión 2026-06-30), el formato del POST body coincidía
EXACTAMENTE con el código **anterior** al fix, no con el actual — aunque el commit sí
estaba en `origin/main`. Se agregó un log de versión en `sriScraper.js` para confirmar
en logs futuros qué build está realmente activo (ver PENDIENTE CRÍTICO punto 2).

### Bug 3 — Mensajes de error del SRI se unían como objetos → "SRI: [object Object]" (`b682fb7`, `2b46e69`)

`sri.autorizarComprobanteSRI()` (`backend/utils/sri.js`) devuelve `mensajes` como array
de objetos `{ identificador, mensaje, tipo, informacionAdicional }`, pero
`obtenerXmlDesdeAutorizacion()` (`backend/utils/importacionProductos.js`) hacía
`sriMensajes.join('; ')` directamente sobre esos objetos → `"[object Object]"`. También
disparaba falsamente el aviso "Servicio SRI no disponible".

**Fix:** extrae `m.mensaje`/`m.identificador` + `m.informacionAdicional` antes de unir.
Reveló la causa real: Bug 4.

### Bug 4 — SRI rechaza documentos antiguos en el webservice en vivo (no es un bug nuestro)

Con el fix del Bug 3 se reveló que el SRI respondía código 80 "ERROR EN LA ESTRUCTURA
DE LA CLAVE DE ACCESO", pero `informacionAdicional` decía la razón real: fecha de
emisión fuera del rango permitido. Verificado con un `curl` directo al SOAP
`AutorizacionComprobantesOffline` de `cel.sri.gob.ec` usando una clave real de feb/2023
del archivo `1104196546001_Recibidos.txt` del cliente — el checksum módulo-11 de la
clave es válido (verificado a mano), coincide con RUC/serie/fecha del resto de columnas.
Es una limitación real y documentada del SRI, no algo corregible en nuestro código.

**Fix:** `/buzon/consultar` ahora detecta el patrón "fuera del rango permitido" y
muestra un aviso específico sugiriendo "Importar XML"/"Importar ZIP" en vez del genérico
"servicio no disponible".

### Bug 5 — `POST/PUT /api/empresas` no guardaba tipoContribuyente/repLegal/contadora (`3abddae`)

No relacionado al Buzón SRI — reportado aparte. `backend/routes/empresas.js`: el
formulario de `GestionEmpresas.jsx` enviaba `tipoContribuyente`,
`repLegalNombre/Cedula/Cargo/Email` y `contadoraNombre/Cedula/Email/Telefono`, pero las
rutas solo desestructuraban un subconjunto fijo del `req.body` — estos campos se
descartaban silenciosamente para TODA empresa (matriz o filial), pese a que las columnas
ya existían en el schema (`VarChar(13)`, migración `20260521120000_empresa_tipo_representante`).

**Fix:** ambas rutas ahora leen y persisten esos 9 campos. También se cambió la etiqueta
"Cédula de la contadora" → "RUC de la contadora" (maxLength 10→13): la contadora de una
empresa jurídica se identifica con RUC, no cédula.

---

## Archivos modificados hoy

| Archivo | Cambio |
|---------|--------|
| `backend/middleware/auth.js` | Ya no inventa empresaId falso; responde 409 EMPRESA_NO_ENCONTRADA |
| `backend/utils/sriScraper.js` | Log de versión de build al cargar el módulo |
| `backend/utils/importacionProductos.js` | Extrae texto real de mensajes SRI (objetos, no strings) + informacionAdicional |
| `backend/routes/buzon.js` | Aviso específico para documentos fuera del rango de fecha del SRI |
| `backend/routes/empresas.js` | POST/PUT ahora guardan tipoContribuyente, repLegal*, contadora* |
| `frontend/src/components/Empresas/GestionEmpresas.jsx` | Etiqueta "Cédula" → "RUC de la contadora" (13 dígitos) |

---

## Commits de hoy

| Commit | Descripción |
|--------|-------------|
| `27f3952` | fix: empresa no resuelta ya no crea empresaId falso + marcador de versión scraper |
| `b682fb7` | fix: mensajes de error del SRI se unían como objetos → "SRI: [object Object]" |
| `2b46e69` | fix: exponer informacionAdicional del SRI + aviso específico para documentos antiguos |
| `3abddae` | fix: POST/PUT empresas no guardaban tipoContribuyente, repLegal ni contadora |

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL en Railway
Empresa de prueba: PUPUCHAICELA ABENDAÑO (dentro de Corp Simtelec, macro-empresa)
Usuarios de prueba: Lucia Arevalo (Administrador), Robert Ocampo (Administrador)
```

**Cómo depurar si el Buzón SRI falla mañana:**
1. Railway dashboard → AELA backend → Deploy Logs
2. Buscar `[SRI] sriScraper.js build 2026-07-01` al arrancar — confirma versión del deploy
3. Para "Importar XML": buscar `[Buzón XML] Error importando` y el mensaje de Prisma
4. Para "Importar TXT"/"Por claves": el mensaje de error ahora debe incluir el texto
   real del SRI entre paréntesis (informacionAdicional)

**Archivos clave del Buzón SRI:**
- `backend/routes/buzon.js` — rutas `/consultar`, `/importar`, `/importar-xml`
- `backend/utils/buzon.js` — `importarDocumentoRecibido()` (routing por tipo de doc)
- `backend/utils/importacionProductos.js` — `obtenerXmlDesdeAutorizacion()` (SOAP SRI)
- `backend/utils/sri.js` — `autorizarComprobanteSRI()`, `soapRequest()`
- `backend/utils/sriScraper.js` — login scraper (fetch+JSF, Puppeteer fallback)
- `backend/middleware/auth.js` — resolución de `req.empresa` desde el JWT
