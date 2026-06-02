# AELA ERP — Buzón SRI: Fixes y estado técnico
## Sesión 2026-06-02 — Diagnóstico y corrección del scraper

---

## Diagnóstico del problema (confirmado con capturas de pantalla)

Al intentar la descarga automática aparecían dos errores simultáneos:

1. **API REST muerta**: `movil-servicios/api/v1.0/contribuyente/login` → HTTP 404.
   El SRI desactivó su API móvil (v1.0 y v2.0). No hay fecha de reactivación conocida.

2. **Timeout de Puppeteer** (45 s): El scraper navegaba a URLs inexistentes
   (`/sri-en-linea/auth/login`, `/sri-en-linea/VOE/.../RecepcionComprobantes.jsf`)
   con `waitUntil: 'networkidle2'`, que nunca termina en portales JSF con recursos activos.

3. **URL del portal correcta** (confirmada en captura):
   ```
   srienlinea.sri.gob.ec/comprobantes-electronicos-internet/pages/consultas/menu.jsf
   ```
   El portal **sigue siendo JSF** (no Angular SPA). El formulario filtra por **año + mes**,
   no por rango de fechas como asumía el código anterior.

---

## Cambios implementados y commiteados

### `backend/utils/sriScraper.js` — Reescritura completa

| Aspecto | Antes (roto) | Ahora (corregido) |
|---------|-------------|-------------------|
| URL comprobantes | `/sri-en-linea/VOE/.../RecepcionComprobantes.jsf` (no existe) | `/comprobantes-electronicos-internet/pages/consultas/menu.jsf` ✓ |
| URL login | `/sri-en-linea/auth/login` (404) | `srienlinea.sri.gob.ec/` → redirige al JSF login ✓ |
| Espera navegación | `networkidle2` → timeout 45s | `domcontentloaded` → responde en ~2s ✓ |
| Formulario filtro | Campos `fechaDesde`/`fechaHasta` (no existen) | `select[id*="anio"]` + `select[id*="mes"]` ✓ |
| Rango multi-mes | Una sola consulta | Itera mes a mes, agrega resultados ✓ |
| Lógica JWT/token | Captura de JWT (portal SPA) | Eliminada — JSF usa JSESSIONID ✓ |

**Nueva función `_mesesEnRango(fechaDesde, fechaHasta)`**
- Convierte `dd/mm/yyyy` → array `[{ anio, mes }, ...]`
- Permite consultar rangos como "01/01/2026 al 31/05/2026" → 5 consultas separadas

**Nueva función `_consultarMesJsf(page, ruc, anio, mes, tipoComprobante)`**
- Selecciona radio "RUC/Cédula/Pasaporte"
- Llena el campo de identificación si está vacío
- Selecciona año y mes de los dropdowns (prueba `"6"` y `"06"`)
- Hace click en "Consultar" y espera `domcontentloaded`

### `backend/utils/sriPortal.js`
- Timeout del fetch: 30 s → **8 s** (la API devuelve 404 en <1 s)
- Comentario documenta estado 404 de la API al 2026-06-02

### `backend/routes/buzon.js` — Diagnóstico actualizado
El endpoint `GET /api/buzon/sri/diagnostico` ahora verifica:
- **SRI-Portal**: `srienlinea.sri.gob.ec/` (portal JSF real) — ✅ si responde
- **SRI-API-Movil**: endpoint v2.0 — reporta 404 con nota explicativa
- **Chrome**: versión y disponibilidad del navegador

### `frontend/src/components/Buzon/BuzonSRI.jsx`
- Mensaje de diagnóstico usa `SRI-Portal` + `Chrome` para decidir el estado
- Ya no depende de `SRI-REST` que siempre está en ❌

---

## Archivos del commit

```
backend/utils/sriScraper.js          ← Reescritura completa
backend/utils/sriPortal.js           ← Timeout 8s + comentario estado API
backend/routes/buzon.js              ← Diagnóstico con portal JSF real
frontend/src/components/Buzon/BuzonSRI.jsx  ← Diagnóstico UI actualizado
docs/pendientes-2026-06-02-buzon-sri.md     ← Este archivo
```

---

## Estado esperado tras el deploy

| Check | Esperado |
|-------|---------|
| `🔍 Diagnóstico SRI` → SRI-Portal | ✅ Portal accesible |
| `🔍 Diagnóstico SRI` → SRI-API-Movil | ❌ 404 (normal, API desactivada) |
| `🔍 Diagnóstico SRI` → Chrome | ✅ si Chromium está en Railway |
| Descarga automática | Debería funcionar si Chrome ✅ |

---

## Incertidumbre restante

### ¿El formulario realmente usa `select[id*="anio"]`?
Sin acceder al HTML del portal (requiere estar logueado), los selectores son heurísticos.
Si la consulta llega al formulario pero no filtra por mes/año, ajustar los selectores
inspeccionando el HTML con DevTools en la página `menu.jsf`.

**Cómo depurar:** En Railway logs, buscar errores de `page.select(...)`.
Si aparece `"Error: No element found for selector"` para un select de año/mes,
el selector está mal y hay que actualizarlo con el ID real del elemento JSF.

### ¿El login JSF funciona desde Railway?
El SRI puede bloquear IPs de proveedores cloud (Railway usa AWS us-east). Si el login falla
con error diferente a "credenciales incorrectas", es posible que el SRI esté bloqueando
la IP del servidor. En ese caso, la descarga automática no funcionará en cloud — solo local.

### Fallback siempre disponible
Si la descarga automática sigue fallando, los métodos manuales son 100% confiables:
- **Importar TXT del SRI** (recomendado: rápido y sin credenciales en AELA)
- **Importar ZIP**
- **Por claves de acceso**

---

## Pendientes para próxima sesión

| # | Tarea | Condición |
|---|-------|-----------|
| 1 | Verificar logs Railway tras el deploy | Obligatorio tras push |
| 2 | Probar descarga automática con credenciales reales | Si Chrome ✅ en diagnóstico |
| 3 | Confirmar selectores JSF (`select[id*="anio"]`) | Si la consulta no filtra bien |
| 4 | Confirmar si SRI bloquea IPs de Railway | Si login falla con error inesperado |
| 5 | Activar/configurar tenant mprq (pendiente anterior) | Independiente del Buzón |
