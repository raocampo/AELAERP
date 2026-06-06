# AELA ERP — Pendientes 2026-06-05
## Sesión nocturna: Multiempresa — Roles por empresa y Admin Macro

---

## ✅ Resuelto esta sesión (4 commits)

### Commit `a4089b2` — Rol efectivo en cambiarEmpresa

**Problema:** Al cambiar de empresa en modo multiempresa, el JWT y el state del frontend
seguían usando el rol base del usuario (`usuarios.rol = 'contador'`) en lugar del rol
asignado para esa empresa en `usuario_empresas.rol = 'admin'`.

**Fix backend (`backend/routes/auth.js`):**
- `emitirToken` acepta `opts.rol` para sobreescribir el rol en el JWT
- `POST /auth/cambiar-empresa` consulta el rol base de la BD y usa `accesoExtra.rol`
  (de `usuario_empresas`) si existe; devuelve `usuario: { rol: rolEfectivo }` en la respuesta

**Fix frontend (`frontend/src/context/AuthContext.jsx`):**
- `cambiarEmpresa` extrae `datosUsuario.rol` de la respuesta y actualiza `setUsuario` +
  `aela_usuario` en localStorage para que `PermissionRoute` vea el rol correcto de inmediato

---

### Commit `a8dc18b` — Middleware proteger usa decoded.rol + refrescar EmpresaSwitcher

**Problema 1:** `proteger` en `backend/middleware/auth.js` ignoraba el `rol` del JWT y
siempre usaba `usuario.rol` de la BD (rol base). Eso hacía que `soloAdmin` y todos los
middlewares de autorización vieran `contador` aunque el JWT dijera `admin`.

**Fix:** `req.usuario.rol = normalizarRol(decoded.rol ?? usuario.rol)` — confía en el JWT
para el rol efectivo (firmado y verificado con JWT_SECRET).

**Problema 2:** El EmpresaSwitcher desaparecía al cambiar de empresa porque
`cambiarEmpresa` no refrescaba `empresasDisponibles`.

**Fix:** `cambiarEmpresa` llama a `cargarEmpresasDisponibles()` al terminar.

---

### Commit `714762f` — Gestión de Empresas filtrada por acceso real del usuario

**Problema:** `GET /api/empresas` devolvía TODAS las empresas sin filtrar. Un usuario
asignado como admin solo en su empresa veía todas las empresas del sistema.

**Fix backend (`backend/routes/empresas.js`):**
- Nuevo helper `rolEnEmpresa()` determina el rol de un usuario en una empresa específica
- `GET /api/empresas` filtra por acceso real (empresa base + `usuario_empresas`)
- Cada empresa incluye `rolUsuario` para que el frontend sepa qué acciones mostrar
- `GET /api/empresas/:id/usuarios` verifica que el usuario sea admin de ESA empresa

**Fix frontend (`frontend/src/components/Empresas/GestionEmpresas.jsx`):**
- Botones Editar/Usuarios/Desactivar solo se muestran si `tienePermiso(e.rolUsuario, 'usuarios.gestionar')`

---

### Commit `8529f8b` — Admin Macro: acceso implícito a todas las empresas

**Problema:** Robert Ocampo (admin de Corp Simtelec) no aparecía en la lista de usuarios
de CONSORCIO VIAL UCHUCAY. El selector para asignar usuarios estaba vacío (porque buscaba
usuarios en la empresa activa CONSORCIO, que no tiene usuarios propios en la tabla `usuarios`).

**Regla implementada: "Admin Macro"**
Un usuario es Admin Macro si su `rol` en la tabla `usuarios` (rol base) es `'admin'`.
- Ve TODAS las empresas activas con `rolUsuario = 'admin'`
- Aparece automáticamente en el panel de usuarios de CUALQUIER empresa con `tipoAcceso: 'macro'`
- No se puede quitar de una empresa (acceso implícito, no revocable)

**Fix backend:**
- `GET /api/empresas`: si `esAdminMacro` → devuelve todas las empresas activas
- `GET /api/empresas/:id/usuarios`: si `esAdminMacro` → salta el check de empresa específica;
  incluye admins de la empresa raíz como miembros implícitos con `tipoAcceso: 'macro'`
- `GET /api/usuarios?scope=pool`: devuelve usuarios de la empresa BASE del usuario
  (Corp Simtelec) en lugar de la empresa activa — para que el selector tenga el pool completo

**Fix frontend:**
- Selector usa `?scope=pool` → muestra todos los Corp Simtelec users asignables
- Chip "Admin Macro" (azul) para `tipoAcceso: 'macro'`, sin botón Quitar

---

## Resumen de la lógica multiempresa implementada

```
Usuario             | Rol base (usuarios.rol) | Empresa asignada (usuario_empresas)
--------------------|-------------------------|-----------------------------------
Robert Ocampo       | admin                   | Andrea Estefania (admin)
Lucia               | supervisor              | CONSORCIO VIAL UCHUCAY (admin)
Andrea Maza         | contador                | Andrea Estefania (admin)
Darwin Ateaga       | contador                | —
Adriana Camacho     | facturador              | —
Jackeline Ocampoo   | supervisor              | —

Regla Admin Macro: rol base = 'admin' → ve TODO, aparece en TODO
```

### Tabla de permisos en Gestión de Empresas (después del fix)

| Usuario | Empresa | Rol efectivo | Ve empresa | Botones gestión |
|---------|---------|--------------|-----------|-----------------|
| Robert  | Corp Simtelec | admin (base) | ✅ | ✅ |
| Robert  | Andrea Estefania | admin (macro) | ✅ | ✅ |
| Robert  | CONSORCIO VIAL | admin (macro) | ✅ | ✅ |
| Lucia   | Corp Simtelec | supervisor (base) | ✅ | ❌ |
| Lucia   | CONSORCIO VIAL | admin (asignado) | ✅ | ✅ |
| Andrea Maza | Corp Simtelec | contador (base) | ✅ | ❌ |
| Andrea Maza | Andrea Estefania | admin (asignado) | ✅ | ✅ |

---

## 🔴 Pendientes para mañana

### 1. Verificar en producción el flujo multiempresa completo

Pasos:
1. Iniciar sesión como **Andrea Maza** (aemaza) en aela.corpsimtelec.com
2. Verificar que el Dashboard muestra rol "Contador / Financiero"
3. Cambiar a empresa "Andrea Estefania Maza Santin" via EmpresaSwitcher
4. Verificar que el sidebar muestra "Administrador"
5. Ir a Facturas → Nueva Factura → debe abrir el formulario (sin redirigir al dashboard)
6. Ir a Administración → Empresas → debe ver solo Andrea Estefania (con botones) + Corp Simtelec (sin botones)
7. Expandir "Usuarios" de Andrea Estefania → debe ver a Robert Ocampo con chip "Admin Macro"

### 2. Verificar como Robert Ocampo

1. Iniciar sesión como **Robert Ocampo** (rao.ocampo)
2. Ir a Administración → Empresas → debe ver las 3 empresas
3. Expandir "Usuarios" de CONSORCIO VIAL UCHUCAY → debe ver a Robert con "Admin Macro" + Lucia como "Asignado"
4. Verificar que el selector de agregar usuario muestra todos los usuarios de Corp Simtelec

### 3. Verificar como Lucia

1. Iniciar sesión como **Lucia** (lucy)
2. Ir a Administración → Empresas → debe ver CONSORCIO (con botones) + Corp Simtelec (sin botones)
3. Cambiar a empresa CONSORCIO → verificar rol en sidebar ("Administrador")
4. Nueva Factura → debe funcionar

---

## 🟡 Pendientes medios (de sesiones anteriores)

### 4. Buzón SRI — Verificar scraper en producción

- Ir a `/buzon` → Descarga automática → Diagnóstico SRI
- Chrome debe aparecer como ✅
- Si falla → revisar Railway env vars para `PUPPETEER_EXECUTABLE_PATH`
- Flujo: RUC + clave → Consultar → polling → resultados

### 5. mprq — Certificado .p12 pendiente

El tenant `mprq` (Miryan Patricia Ramon Quezada) no puede firmar comprobantes hasta que:
- Ingrese a `aela.corpsimtelec.com/mprq`
- Configuración → SRI → subir `.p12` y su clave
- Configurar establecimiento y punto de emisión

### 6. Limpiar tenant loja-torneos-y-competencia

```sql
DELETE FROM aela_master.tenants WHERE slug = 'loja-torneos-y-competencia';
DROP DATABASE IF EXISTS aela_loja_torneos_y_competencia;
```

### 7. App móvil — Verificar assets y prueba

- `mobile/assets/` — confirmar logos reales de AELA (no placeholders)
- `expo start` en dispositivo Android/iOS

---

## 🟢 Backlog

| # | Tarea |
|---|-------|
| 8 | AyudaSistema.jsx — sección multiempresa/admin macro en el sistema |
| 9 | Pasarela de pagos PayPhone o Stripe |
| 10 | Impuesto a la Renta en nómina (tabla LORTI) |
| 11 | App móvil ESC/POS Bluetooth + escáner de barras |
| 12 | Tests e2e Playwright |
| 13 | Catastro SRI — actualización desde CSV oficial |
| 14 | Panel Super Admin — stats de uso y facturación |
| 15 | GestionEmpresas — en selector "Asignar usuario", mostrar también usuarios de empresas hermanas (no solo empresa base) |

---

## Archivos modificados esta sesión

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `backend/routes/auth.js` | Fix | emitirToken acepta opts.rol; cambiarEmpresa usa rolEfectivo |
| `backend/middleware/auth.js` | Fix | proteger usa decoded.rol del JWT |
| `backend/routes/empresas.js` | Fix+Feat | filtrado por acceso + admin macro + rolUsuario |
| `backend/routes/usuarios.js` | Feat | scope=pool para devolver usuarios de empresa base |
| `frontend/src/context/AuthContext.jsx` | Fix | cambiarEmpresa actualiza usuario.rol + llama cargarEmpresasDisponibles |
| `frontend/src/components/Empresas/GestionEmpresas.jsx` | Fix | botones condicionales + chip Admin Macro + selector scope=pool |
