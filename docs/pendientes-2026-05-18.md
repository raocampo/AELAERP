# Pendientes y avances — AELA ERP — 2026-05-18

## ✅ Completado en esta sesión

### Fix crítico: CORS dominio personalizado
- **Problema**: Al acceder desde `https://aela.corpsimtelec.com`, el backend en Railway
  bloqueaba las peticiones con error CORS porque ese dominio no estaba en los orígenes permitidos.
- **Causa**: `FRONTEND_URL` en Railway no incluía el dominio personalizado.
- **Solución implementada**:
  - `backend/app.js`: el middleware CORS ahora combina `FRONTEND_URL` + `CORS_EXTRA_ORIGINS`
    (separados por coma), permitiendo agregar dominios extra sin tocar `FRONTEND_URL`.
  - `railway.toml`: se agregó `CORS_EXTRA_ORIGINS = "https://aela.corpsimtelec.com"`
    en la sección `[env]` — se aplica automáticamente al próximo despliegue en Railway.
  - `backend/.env.example`: documentada la nueva variable `CORS_EXTRA_ORIGINS`.

---

## 📋 Pendientes que requieren acción manual (no código)

### Catastro SRI — `docs/datosRuc` está vacío
La carpeta `docs/datosRuc` no tiene CSVs. Para cargarlos:
1. Ir a: https://srienlinea.sri.gob.ec → **Datos Abiertos** → **Catastro de Contribuyentes**
2. Descargar los archivos CSV (formato pipe `|`, encoding latin1)
3. Colocarlos en `docs/datosRuc/`
4. Ejecutar en Railway (o local apuntando a la BD de Railway):
   ```powershell
   $env:DATABASE_URL = "postgresql://postgres:PASSWORD@roundhouse.proxy.rlwy.net:PORT/railway"
   cd "D:\Users\USUARIO\...\backend"
   node scripts/importarCatastroSRI.js ..\docs\datosRuc
   ```

> **Nota**: El SRI actualiza el catastro periódicamente. Verificar la fecha del archivo descargado.
> El script admite `--replace` para reemplazar registros existentes.

### SMTP — Email de bienvenida y notificaciones
Pendiente de sesión anterior. Agregar en Railway → Variables:
```
SMTP_HOST     = smtp.resend.com
SMTP_PORT     = 587
SMTP_USER     = resend
SMTP_PASS     = re_XXXXXXXXXXXXXXXX
SMTP_FROM     = AELA ERP <info@corpsimtelec.com>
SMTP_SOPORTE  = soporte@corpsimtelec.com
```

### Dominio API personalizado (opcional)
Si se quiere `api.aela.ec` → Railway: Settings → Domains → Custom Domain.
Agregar CNAME en Cloudflare/DNS apuntando a la URL provista por Railway.

---

## 🔲 Pendientes futuros

- [ ] Catastro SRI: descargar y cargar CSVs en Railway (ver arriba)
- [ ] SMTP: configurar en Railway dashboard
- [ ] Manual de usuario: completar secciones Bancos, Declaraciones/ATS, Talento Humano, Admin
- [ ] Multiempresa SaaS: middleware de routing por subdominio (cuando se requiera)
- [ ] Tests automatizados (unitarios/e2e)
- [ ] Migración de datos históricos
- [ ] Segunda empresa de prueba (Macro Empresa)
- [ ] Dominio API personalizado (`api.aela.ec`)
