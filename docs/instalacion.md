# Guía de Instalación — AELA

## Escenarios disponibles

| Escenario | Script | Sistema | Cuándo usarlo |
|-----------|--------|---------|---------------|
| **VPS / Servidor Linux** | `install-linux.sh` | Ubuntu 22.04 / Debian | Cliente con VPS o servidor propio con acceso a internet |
| **Local Windows** | `install-windows.ps1` | Windows 10/11 | Oficina sin internet, red interna, uso solo en la empresa |
| **Actualización Linux** | `update-linux.sh` | Ubuntu/Debian | Aplicar nueva versión en servidor ya instalado |
| **Actualización Windows** | `update-windows.ps1` | Windows | Aplicar nueva versión en instalación Windows |

---

## Escenario 1 — VPS / Servidor Linux

### Requisitos
- Ubuntu 22.04 LTS o Debian 12
- Acceso SSH con usuario root
- Dominio apuntando a la IP del servidor (opcional pero recomendado)
- Puertos 80 y 443 abiertos

### El script instala automáticamente
- Node.js 20 LTS
- PostgreSQL 14+
- Nginx (reverse proxy + archivos estáticos)
- PM2 (gestor de procesos con autoarranque)

### Pasos

```bash
# 1. Conectarse al servidor por SSH
ssh root@IP-DEL-SERVIDOR

# 2. Subir el proyecto al servidor
scp -r /ruta/local/AELA root@IP:/tmp/AELA

# 3. Entrar al directorio de scripts
cd /tmp/AELA/scripts

# 4. Dar permisos y ejecutar
chmod +x install-linux.sh
sudo ./install-linux.sh
```

### Preguntas durante la instalación
```
Plan (lite/medium/pro) [pro]:        → Según lo que pagó el cliente
Dominio o IP del servidor:           → mi-empresa.com o 190.123.45.67
Puerto backend [5600]:               → Enter (dejar por defecto)
Usuario PostgreSQL [postgres]:       → Enter
Contraseña PostgreSQL:               → Ingresar contraseña segura
Nombre de BD [aela_db]:              → Enter o personalizar
Correo SMTP:                         → Enter para omitir (configurar después)
```

### Resultado
```
http://mi-empresa.com  →  AELA listo para usar
```

### SSL (recomendado tras la instalación)
```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d mi-empresa.com
# El certificado se renueva automáticamente
```

### Comandos de gestión
```bash
pm2 status                      # Ver estado del backend
pm2 logs AELA-backend           # Ver logs en tiempo real
pm2 restart AELA-backend        # Reiniciar backend
pm2 reload AELA-backend         # Reiniciar sin downtime
systemctl status nginx          # Estado del servidor web
tail -f /var/log/AELA/error.log # Ver errores del backend
```

---

## Escenario 2 — Windows Local (red interna)

### Cuándo usar este escenario
- La empresa quiere sus datos 100% locales
- No necesitan acceso desde internet
- Tienen una PC o servidor Windows dedicado en la oficina

### Requisitos previos (instalar manualmente antes de correr el script)

1. **Node.js 20 LTS**
   - Descargar de https://nodejs.org
   - Durante la instalación marcar "Add to PATH"
   - Verificar: `node --version` en PowerShell

2. **PostgreSQL 16**
   - Descargar de https://www.postgresql.org/download/windows/
   - Durante la instalación:
     - Anotar el puerto (5432)
     - Anotar la contraseña del usuario `postgres`
   - Marcar la opción de agregar al PATH

3. **Git** (para futuras actualizaciones)
   - https://git-scm.com/download/win

### Ejecutar el instalador

```powershell
# Abrir PowerShell como Administrador
# Click derecho en el menú inicio → "Windows PowerShell (Administrador)"

# Ir al directorio de scripts
cd C:\ruta\al\proyecto\AELA\scripts

# Ejecutar
PowerShell -ExecutionPolicy Bypass -File install-windows.ps1
```

### Preguntas durante la instalación
```
Plan (lite/medium/pro) [pro]:        → Según el plan contratado
Puerto backend [5600]:               → Enter
Puerto frontend [5174]:              → Enter
Usuario PostgreSQL [postgres]:       → Enter
Contraseña PostgreSQL:               → La contraseña que pusiste al instalar PostgreSQL
Nombre de BD [aela_db]:              → Enter
```

### Resultado
El script crea dos **Servicios de Windows** que arrancan automáticamente al encender el PC:

```
AELA-Backend   → API corriendo en puerto 5600
AELA-Frontend  → Web corriendo en puerto 5174
```

### Acceso
```
Desde esta PC:          http://localhost:5174
Desde otras PCs:        http://192.168.1.XX:5174
                        (reemplazar XX con la IP del PC servidor)
```

### Cómo encontrar la IP del PC servidor
```powershell
# En el PC donde está instalado AELA
ipconfig
# Buscar "IPv4 Address" en el adaptador de red principal
# Ejemplo: 192.168.1.10
```

### Gestionar los servicios Windows

**Desde PowerShell (Administrador):**
```powershell
Get-Service AELA-Backend, AELA-Frontend     # Ver estado
Start-Service AELA-Backend                  # Iniciar
Stop-Service AELA-Backend                   # Detener
Restart-Service AELA-Backend               # Reiniciar

# Ver logs de errores
Get-Content C:\AELA\logs\backend-err.log -Tail 50
```

**Desde la GUI:**
1. Presionar `Win + R` → escribir `services.msc`
2. Buscar "AELA Backend" y "AELA Frontend"
3. Click derecho → Iniciar / Detener / Reiniciar

### ¿Qué pasa cuando apagan el PC?
Los servicios Windows tienen configuración `SERVICE_AUTO_START`:
- Al encender el PC → Windows inicia automáticamente `AELA-Backend` y `AELA-Frontend`
- No requiere ninguna acción manual
- Los usuarios de la red pueden conectarse una vez que el PC servidor encienda (~30 segundos)

---

## Actualizar a una nueva versión

### Linux
```bash
# Subir nuevo código al servidor
scp -r /ruta/nueva/AELA root@IP:/tmp/AELA-nuevo

# Ejecutar script de actualización
cd /tmp/AELA-nuevo/scripts
chmod +x update-linux.sh
sudo ./update-linux.sh
```

### Windows
```powershell
# Copiar nueva versión a la carpeta del proyecto
# Ejecutar como Administrador:
PowerShell -ExecutionPolicy Bypass -File C:\AELA-nuevo\scripts\update-windows.ps1
```

El script de actualización:
1. Hace backup automático de la BD antes de cualquier cambio
2. Copia solo los archivos nuevos (preserva .env y uploads)
3. Aplica cambios de estructura de BD si los hay
4. Recompila el frontend
5. Reinicia los servicios

---

## Cambiar el plan de un cliente

### En Linux (editar .env y reiniciar)
```bash
nano /opt/AELA/backend/.env
# Cambiar: AELA_EDITION=medium  →  AELA_EDITION=pro
pm2 restart AELA-backend
```

### En Windows (editar .env y reiniciar servicio)
```powershell
# Editar C:\AELA\backend\.env
# Cambiar AELA_EDITION=medium por AELA_EDITION=pro
Restart-Service AELA-Backend
```

---

## Backup manual de la BD

### Linux
```bash
# Backup
sudo -u postgres pg_dump aela_db > /var/backups/scfi_$(date +%Y%m%d).sql

# Restaurar (si es necesario)
sudo -u postgres psql aela_db < /var/backups/scfi_20260407.sql
```

### Windows
```powershell
# Backup (desde PowerShell con PostgreSQL en PATH)
pg_dump -U postgres aela_db -f "C:\AELA\backups\scfi_backup.sql"

# Restaurar
psql -U postgres aela_db -f "C:\AELA\backups\scfi_backup.sql"
```

---

## Solución de problemas comunes

| Problema | Causa probable | Solución |
|----------|---------------|----------|
| `EADDRINUSE :5600` | Puerto ocupado por otra instancia | `pm2 kill` (Linux) o `Stop-Service AELA-Backend` (Windows) |
| Pantalla en blanco en el navegador | Frontend no compilado o URL de API incorrecta | Verificar `VITE_API_URL` en .env y recompilar |
| `prisma: EPERM` al generar | Backend corriendo y bloqueando el DLL | Detener servicio, generar, reiniciar |
| No accede desde otras PCs | Firewall bloqueando el puerto | Verificar reglas de firewall |
| `Connection refused` al backend | Servicio detenido | `pm2 start AELA-backend` o `Start-Service AELA-Backend` |
| BD vacía al reiniciar | Normal en primera instalación | Completar bootstrap inicial en el navegador |
