# Manual de Usuario — AELA ERP
**Versión 1.0 · CorpSimtelec · Ecuador**

---

## Tabla de Contenidos

1. [Introducción](#1-introducción)
2. [Inicio de sesión](#2-inicio-de-sesión)
3. [Configuración inicial](#3-configuración-inicial)
4. [Dashboard (Panel principal)](#4-dashboard-panel-principal)
5. [Módulo POS — Punto de Venta](#5-módulo-pos--punto-de-venta)
6. [Caja Diaria](#6-caja-diaria)
7. [Módulo Facturación](#7-módulo-facturación)
8. [Módulo Notas de Venta](#8-módulo-notas-de-venta)
9. [Módulo Compras](#9-módulo-compras)
10. [Módulo Inventario / Productos](#10-módulo-inventario--productos)
11. [Módulo Clientes](#11-módulo-clientes)
12. [Módulo Contabilidad](#12-módulo-contabilidad)
13. [Módulo Bancos](#13-módulo-bancos)
14. [Declaraciones / ATS / Tributario](#14-declaraciones--ats--tributario)
15. [Talento Humano](#15-talento-humano)
16. [Administración del sistema](#16-administración-del-sistema)
17. [Modo offline (sin internet)](#17-modo-offline-sin-internet)
18. [Solución de problemas](#18-solución-de-problemas)

---

## 1. Introducción

### ¿Qué es AELA ERP?

AELA ERP es un sistema de gestión empresarial completo para Ecuador, desarrollado por **CorpSimtelec**. Integra en una sola plataforma la facturación electrónica autorizada por el SRI, el punto de venta, la caja diaria, el inventario, las compras, la contabilidad, las declaraciones tributarias y el talento humano.

El sistema corre en el navegador como una **Aplicación Web Progresiva (PWA)**, lo que significa que:

- Funciona en cualquier computadora o tablet desde el navegador.
- Puede instalarse como aplicación de escritorio sin necesidad de instaladores.
- Sigue operando aunque se corte el internet (modo offline).

### Planes disponibles

| Característica | Lite | Medium | Pro |
|---|---|---|---|
| Precio | Gratis | Consultar | Consultar |
| Comprobantes/año | 100 | 1.000 | Ilimitados |
| Usuarios | 1 | 3 | Ilimitados |
| Facturas electrónicas | ✅ | ✅ | ✅ |
| Notas de Venta | ✅ | ✅ | ✅ |
| Caja Diaria | ❌ | ✅ | ✅ |
| POS | ❌ | ✅ | ✅ |
| Inventario | ❌ | ✅ | ✅ |
| Compras | ❌ | ✅ | ✅ |
| Talento Humano | ❌ | ✅ | ✅ |
| Retenciones | ❌ | ❌ | ✅ |
| Liquidaciones de Compra | ❌ | ❌ | ✅ |
| ATS | ❌ | ❌ | ✅ |
| Contabilidad completa | ❌ | ❌ | ✅ |
| Multiempresa | ❌ | ❌ | ✅ |

> 💡 Los módulos bloqueados por plan aparecen en el menú lateral con un candado. Al hacer clic se muestra información de actualización.

### Funcionamiento offline

AELA ERP detecta automáticamente cuando no hay conexión a internet. En ese modo:

- El sistema continúa mostrando los datos ya cargados.
- Las operaciones de venta (POS, Notas de Venta) quedan guardadas localmente en la cola de sincronización.
- Al recuperarse la conexión, el sistema sincroniza automáticamente las operaciones pendientes con el servidor.
- Un indicador en la parte superior de la pantalla indica el estado de la conexión.

> ⚠ La emisión de facturas electrónicas con autorización del SRI requiere conexión a internet activa. En modo offline solo se pueden emitir documentos que se enviarán al SRI cuando vuelva la conexión.

---

## 2. Inicio de sesión

### 2.1 Pantalla de login

Al abrir AELA ERP en el navegador verá la pantalla de inicio de sesión.

**Pasos para ingresar:**

1. Abra el navegador e ingrese la dirección del sistema (por ejemplo: `http://localhost:5174` en instalación local, o la URL proporcionada por CorpSimtelec).
2. En el campo **Usuario o correo** escriba su nombre de usuario o su dirección de correo electrónico.
3. En el campo **Contraseña** escriba su contraseña.
4. Haga clic en el botón **Ingresar**.

> 💡 Puede iniciar sesión con su nombre de usuario (por ejemplo: `jperez`) o con su correo electrónico completo (por ejemplo: `jperez@miempresa.com`).

### 2.2 Primera vez — Bootstrap inicial

Si el sistema nunca ha sido configurado, en lugar del formulario de login verá el **formulario de configuración inicial**. Consulte la sección [3. Configuración inicial](#3-configuración-inicial) para completar ese proceso.

### 2.3 Recuperar acceso

En caso de olvidar su contraseña:

1. En la pantalla de login, haga clic en el enlace **¿Olvidé mi contraseña?** (debajo del botón Ingresar).
2. Contacte al administrador del sistema para que le asigne una nueva contraseña desde el módulo de Administración → Usuarios.

> ⚠ En la versión actual, el restablecimiento de contraseña por correo electrónico es gestionado por el administrador. Si es el administrador y olvidó su contraseña, contacte a soporte CorpSimtelec: **WhatsApp +593 097 889 3520** o **soporte@corpsimtelec.com**.

### 2.4 Cambiar contraseña

Una vez dentro del sistema:

1. Haga clic en su nombre de usuario en la parte superior del menú lateral.
2. Seleccione **Cambiar contraseña**.
3. Ingrese su contraseña actual, luego la nueva contraseña dos veces.
4. Haga clic en **Guardar**.

### 2.5 Cerrar sesión

1. Haga clic en su nombre de usuario en la parte superior del menú lateral.
2. Seleccione **Cerrar sesión**.
3. Será redirigido a la pantalla de login.

### 2.6 Tiempo de inactividad

Por seguridad, la sesión se cierra automáticamente después de **30 minutos de inactividad**. Al regresar a la pantalla verá el formulario de login y deberá ingresar nuevamente sus credenciales.

> 💡 Si necesita dejar el equipo sin cerrar sesión, puede hacerlo con confianza: sus datos no se pierden, solo vuelve a requerir su contraseña.

---

## 3. Configuración inicial

### 3.1 Bootstrap — Primera empresa y administrador

Este proceso solo ocurre una vez, cuando el sistema se instala por primera vez y no tiene ningún usuario registrado.

**Pasos:**

1. Al abrir el sistema por primera vez, verá el formulario **Configuración Inicial de AELA**.
2. Complete los datos de la empresa:
   - **RUC** de la empresa (13 dígitos). Al escribirlo, el sistema consultará automáticamente el SRI para rellenar los datos.
   - **Razón Social** y **Nombre Comercial**.
   - **Dirección**, **Teléfono** y **Correo de la empresa**.
3. Complete los datos del primer administrador:
   - **Nombre completo** del administrador.
   - **Nombre de usuario** (sin espacios, ejemplo: `admin`).
   - **Correo electrónico** del administrador.
   - **Contraseña** y **confirmar contraseña** (mínimo 8 caracteres).
4. Haga clic en **Crear empresa y administrador**.

El sistema crea automáticamente:
- La empresa con sus datos.
- El usuario administrador.
- La configuración SRI base.
- La configuración del sistema base.
- El plan de cuentas contable base.

> 💡 Después del bootstrap, ingrese con las credenciales del administrador que acaba de crear.

### 3.2 Configuración del Sistema

Desde el menú lateral, vaya a **Configuración → Config Sistema**.

En esta sección puede definir:

| Parámetro | Descripción |
|---|---|
| **Plan** | Lite / Medium / Pro — define qué módulos están disponibles |
| **Modo de operación** | Monoempresa (una sola empresa) o Multiempresa |
| **Nombre de caja** | Nombre visible para la caja diaria (ej: "Caja General") |
| **Caja Diaria** | Activar/desactivar el módulo de caja |
| **Cierre obligatorio** | Obliga a cerrar caja antes de terminar el día |
| **POS** | Activar/desactivar el punto de venta |
| **Documento POS por defecto** | Factura o Nota de Venta |
| **Inventario** | Activar/desactivar el control de stock |
| **Stock negativo** | Permitir ventas cuando el stock llega a cero |
| **Compras** | Activar/desactivar el módulo de compras |
| **Contabilidad** | Activar/desactivar el módulo contable |
| **Retenciones** | Activar/desactivar emisión de retenciones (Plan Pro) |
| **Liquidaciones** | Activar/desactivar liquidaciones de compra (Plan Pro) |
| **ATS** | Activar/desactivar el módulo ATS (Plan Pro) |
| **Talento Humano** | Activar/desactivar RRHH (Plan Medium/Pro) |
| **SBU Ecuador** | Salario Básico Unificado vigente (para cálculo de nómina) |

**Pasos para guardar cambios:**

1. Modifique los parámetros según sus necesidades.
2. Haga clic en **Guardar configuración**.
3. El sistema aplica los cambios de inmediato. Los módulos desactivados desaparecen del menú lateral.

### 3.3 Configuración SRI

Desde el menú lateral, vaya a **Configuración → Config SRI**.

Esta sección es **imprescindible** para emitir documentos electrónicos válidos ante el SRI.

#### Datos del emisor

1. Ingrese el **RUC** de la empresa (13 dígitos). El sistema puede consultar automáticamente los datos al SRI.
2. Complete la **Razón Social** y **Nombre Comercial**.
3. Ingrese la **Dirección Matriz** y la **Dirección del Establecimiento**.
4. Configure el **Establecimiento** (número de 3 dígitos, ej: `001`) y el **Punto de Emisión** (ej: `001`).

#### Ambiente

Seleccione el ambiente de trabajo:

| Opción | Uso |
|---|---|
| **Pruebas** | Para hacer pruebas. Los documentos no tienen validez legal |
| **Producción** | Para operación real. Los documentos son válidos ante el SRI |

> ⚠ Comience siempre en **Pruebas** hasta verificar que todo funciona correctamente. Solo cambie a **Producción** cuando esté seguro de que la configuración es correcta y tiene su certificado digital listo.

#### Información tributaria

Marque las casillas que correspondan a su empresa:

- **Contribuyente RIMPE** — si está en el Régimen RIMPE.
- **RIMPE Negocio Popular** — si es Negocio Popular dentro del RIMPE.
- **Contribuyente Especial** — si tiene resolución de contribuyente especial del SRI.
- **Obligado a llevar contabilidad** — según su situación tributaria.
- **Agente de Retención** — si tiene resolución de agente de retención.

#### Certificado digital

El certificado digital (archivo `.p12`) es necesario para firmar electrónicamente los documentos y enviarlos al SRI.

**Pasos para cargar el certificado:**

1. En la sección **Certificado Digital**, haga clic en **Seleccionar archivo**.
2. Busque el archivo `.p12` en su computadora y selecciónelo.
3. En el campo **Clave del certificado**, ingrese la contraseña del certificado.
4. Haga clic en **Guardar** para subir el certificado al sistema.
5. Puede hacer clic en **Probar firma** para verificar que el certificado funciona correctamente.

> ⚠ El certificado digital lo emite el Banco Central del Ecuador o una entidad certificadora autorizada. Si no tiene uno, contáctese con el Banco Central del Ecuador o con su asesor tributario.

> 💡 El certificado solo se sube una vez. No necesita volver a subirlo a menos que caduque o cambie.

#### Logo de la empresa

1. En la sección **Logo**, haga clic en **Seleccionar imagen**.
2. Elija una imagen en formato JPG o PNG (recomendado: 300 x 100 px).
3. El logo aparece de inmediato en la vista previa y se imprimirá en los documentos emitidos.

---

## 4. Dashboard (Panel principal)

Al iniciar sesión, el sistema muestra el **Panel principal** (Dashboard) con los indicadores más importantes de la empresa.

### 4.1 Indicadores KPI

| Indicador | Color | Descripción |
|---|---|---|
| **Ventas del mes** | Verde | Total de ventas (facturas + notas de venta) del mes en curso |
| **Compras del mes** | Rojo | Total de compras registradas en el mes en curso |
| **Saldo en caja** | Azul | Saldo actual de la caja diaria |
| **Productos con stock bajo** | Ámbar | Cantidad de productos por debajo del stock mínimo configurado |

> 💡 Al hacer clic en cada indicador puede navegar directamente al módulo correspondiente.

### 4.2 Límite de comprobantes (Plan Lite y Medium)

Si tiene un plan con límite de comprobantes anuales, verá una barra de progreso que muestra cuántos comprobantes ha emitido frente al límite del plan:

- **Verde** — uso normal (menos del 70 %).
- **Ámbar** — uso elevado (entre 70 % y 90 %).
- **Rojo** — próximo a agotar el límite (más del 90 %).

> ⚠ Cuando llegue al 90 % del límite, contacte a CorpSimtelec para actualizar su plan antes de que se bloquee la emisión de documentos.

### 4.3 Estado de módulos

El panel muestra qué módulos están activos en la empresa (Caja, POS, Inventario, Compras, etc.).

### 4.4 Accesos rápidos

Debajo de los indicadores encontrará botones de acceso rápido a los módulos más utilizados, según su rol y el plan contratado:

- POS, Caja Diaria, Notas de Venta, Facturas, Inventario, Clientes, Productos, Compras, Retenciones, Config SRI, Config Sistema.

---

## 5. Módulo POS — Punto de Venta

El módulo POS permite realizar ventas de manera rápida, buscando clientes, agregando productos y emitiendo facturas o notas de venta en segundos.

> 💡 El POS está disponible desde el **Plan Medium**. Debe estar activado en Configuración del Sistema.

### 5.1 Acceder al POS

Desde el menú lateral haga clic en **POS** (aparece fuera de cualquier grupo, siempre visible en la parte superior del menú).

### 5.2 Seleccionar tipo de documento

En la parte superior del POS encontrará un selector con dos opciones:

| Opción | Cuándo usar |
|---|---|
| **Factura** | Para clientes con RUC o cédula que requieren factura electrónica |
| **Nota de Venta** | Para contribuyentes RIMPE que usan notas de venta en lugar de facturas |

> 💡 El documento por defecto (Factura o Nota de Venta) se configura en **Config Sistema → Documento POS por defecto**.

### 5.3 Buscar o ingresar cliente

#### Opción A — Consumidor Final (venta sin identificación)

1. Deje el tipo de identificación en **Consumidor Final**.
2. El sistema asigna automáticamente la identificación `9999999999999` y el nombre `CONSUMIDOR FINAL`.
3. No es necesario ingresar ningún dato adicional del cliente.

#### Opción B — Cliente con cédula o RUC

1. En el selector de **Tipo de identificación**, elija **Cédula**, **RUC** o **Pasaporte**.
2. Ingrese el número de identificación en el campo correspondiente.
3. Presione **Tab** o **Enter** para que el sistema consulte automáticamente el SRI.
4. Si el cliente se encuentra en el SRI, sus datos (nombre, dirección, email) se cargan automáticamente.
5. Si el servicio del SRI no está disponible, verá el mensaje `SRI no disponible — ingresa los datos manualmente`. En ese caso, complete los campos manualmente.

#### Modal de datos incompletos

Si el cliente existe pero le faltan datos (dirección, email o teléfono), el sistema muestra el mensaje:

`⚠ Datos incompletos — completa los campos faltantes`

Se abre automáticamente un modal para que complete la información. Estos datos se guardan en la base del sistema al emitir el documento.

> 💡 Al emitir un documento, si el cliente ya existía en la base de datos pero tenía campos vacíos (dirección, email, teléfono), el sistema los actualiza automáticamente con los datos que ingresó en el POS.

### 5.4 Agregar productos

#### Por código de barras

1. Asegúrese de que el cursor esté en el campo **Código de barras**.
2. Escanee el código con el lector de barras (o escríbalo manualmente) y presione **Enter**.
3. El producto se agrega al carrito con cantidad 1.
4. Si el código no existe, verá un mensaje de error.

#### Por búsqueda de nombre o código

1. En el campo **Buscar producto**, escriba parte del nombre o código del producto.
2. Aparecerá una lista desplegable con los resultados.
3. Haga clic en el producto que desea agregar.

### 5.5 Gestionar el carrito

Una vez agregados los productos al carrito puede:

| Acción | Cómo hacerlo |
|---|---|
| **Cambiar cantidad** | Haga clic en el campo de cantidad del producto y escriba el nuevo valor |
| **Cambiar precio** | Haga clic en el campo de precio unitario y modifíquelo |
| **Eliminar producto** | Haga clic en el ícono de papelera (🗑) al final de la fila |

> ⚠ Si el módulo de inventario está activo y **no** permite stock negativo, el sistema no dejará agregar más unidades de las disponibles en stock.

### 5.6 Seleccionar forma de pago

Para **facturas**, las formas de pago disponibles son:

| Código | Forma de pago |
|---|---|
| Efectivo | Pago en efectivo |
| Tarjeta débito | Pago con tarjeta de débito |
| Tarjeta crédito | Pago con tarjeta de crédito |
| Transferencia / Depósito | Transferencia bancaria o depósito |
| Cheque | Pago con cheque |
| App | Aplicaciones de pago (Ahorita, De Una u otras) |

Para **notas de venta**, las opciones son: Efectivo, Transferencia, Tarjeta débito, Tarjeta crédito, Cheque, Aplicaciones.

> 💡 Si recibió el pago con tarjeta, puede ingresar el **número de referencia** o últimos 4 dígitos en el campo de referencia que aparece al seleccionar tarjeta.

### 5.7 Emitir el documento

1. Revise el resumen del pie del POS:
   - **Subtotal sin IVA**, **IVA 15 %**, **Total a cobrar**.
2. Haga clic en el botón **Emitir Factura** (o **Emitir Nota de Venta**).
3. El sistema procesa el documento y muestra el **modal de confirmación** con:
   - Número del documento emitido.
   - Total cobrado.
   - Estado (autorizado por el SRI en el caso de facturas).

> ⚠ Si ocurre un error al comunicarse con el SRI, el documento queda en estado **pendiente** y se reintentará automáticamente. Puede consultar el estado en el módulo de Facturas.

### 5.8 Imprimir recibo POS

Tras la confirmación del documento:

1. En el modal de confirmación, haga clic en **Imprimir recibo**.
2. El sistema abre una ventana optimizada para impresión en papel de 80 mm (rollo térmico de POS) o en papel A4/carta.
3. Confirme la impresión en el diálogo del navegador.

> 💡 En **Configuración del Sistema → Impresión y kiosko** puede activar **Autoabrir el recibo POS al emitir** para que el sistema abra la impresión automáticamente después de guardar la venta.

> ⚠ El navegador no puede reconocer ni seleccionar una impresora física por sí solo. Si trabaja en kiosko o con móvil, use la **Impresora sugerida para kiosko** como referencia operativa en ese dispositivo.

> 💡 Si necesita reimprimir un comprobante, búsquelo en el listado del módulo de Facturas o Notas de Venta y use la opción de impresión desde el detalle del documento.

### 5.9 Iniciar nueva venta

Después de emitir el documento, el POS limpia automáticamente el carrito y queda listo para una nueva venta. No necesita hacer nada adicional.

---

## 6. Caja Diaria

El módulo de Caja Diaria registra todos los ingresos y egresos de efectivo de la jornada, incluyendo los cobros del POS y movimientos manuales.

> 💡 La Caja Diaria está disponible desde el **Plan Medium**. Debe estar activada en Configuración del Sistema.

Acceda desde el menú lateral: **Ventas → Caja Diaria**.

La pantalla de Caja Diaria tiene cuatro pestañas:

| Pestaña | Contenido |
|---|---|
| **Apertura** | Formulario para abrir la caja del día |
| **Movimientos** | Registro de ingresos y egresos manuales |
| **Cierre** | Formulario de cierre y resumen del día |
| **Historial** | Registro de cajas anteriores |

### 6.1 Apertura de caja

**Pasos:**

1. Vaya a la pestaña **Apertura**.
2. Seleccione la **fecha** de apertura (por defecto es el día de hoy).
3. En el campo **Monto de apertura** ingrese el saldo inicial en efectivo que tiene en la caja (billetes y monedas).
4. Opcionalmente, ingrese una observación.
5. Haga clic en **Registrar apertura**.

> 💡 Si el administrador configuró el cierre de caja como obligatorio, no podrá abrir la caja del día siguiente sin haber cerrado la del día anterior.

### 6.2 Movimientos manuales

Use esta pestaña para registrar ingresos o egresos de efectivo que no provienen de ventas (por ejemplo: pago de servicios, adelantos a proveedores, gastos menores).

**Pasos:**

1. Vaya a la pestaña **Movimientos**.
2. Seleccione el **Tipo**: `INGRESO` o `EGRESO`.
3. Ingrese el **Monto**.
4. (Opcional) Ingrese una **Descripción** y una **Referencia** (número de factura, voucher, etc.).
5. Haga clic en **Registrar movimiento**.

El movimiento se agrega de inmediato al listado de la jornada.

### 6.3 Cierre de caja

**Pasos:**

1. Al finalizar la jornada, vaya a la pestaña **Cierre**.
2. El sistema muestra el **Total esperado** (apertura + ingresos – egresos, incluyendo ventas del POS).
3. En el campo **Efectivo real en caja** cuente el dinero físico e ingrese el total.
4. Opcionalmente, ingrese una observación.
5. Haga clic en **Cerrar caja**.

### 6.4 Lectura de diferencias

Después del cierre, el sistema compara el efectivo esperado con el real y muestra:

| Etiqueta | Color | Significado |
|---|---|---|
| **Sobrante** | 🟢 Verde | Hay más efectivo del esperado |
| **Faltante** | 🔴 Rojo | Hay menos efectivo del esperado |
| **Cuadrado** | 🔵 Azul | El efectivo coincide exactamente |

El valor de la diferencia siempre se muestra en positivo (valor absoluto).

### 6.5 Historial de cajas

En la pestaña **Historial** puede consultar el registro de aperturas y cierres de días anteriores, con sus montos, movimientos y diferencias.

---

## 7. Módulo Facturación

El módulo de Facturación permite emitir, consultar y gestionar todos los documentos electrónicos: facturas, notas de débito, notas de crédito y retenciones.

Acceda desde el menú lateral: **Ventas → Facturas**.

> ⚠ Para emitir documentos electrónicos válidos debe tener la **Configuración SRI** completa con certificado digital cargado y ambiente seleccionado.

### 7.1 Emitir una factura

1. En el listado de Facturas, haga clic en el botón **Nueva Factura**.
2. Complete los datos del cliente (búsqueda por RUC/cédula con consulta automática al SRI).
3. Agregue los productos o servicios: busque por nombre o código y ajuste cantidades y precios.
4. Seleccione la **forma de pago**.
5. Revise el resumen de totales (subtotal, IVA 15 %, total).
6. Haga clic en **Emitir Factura**.
7. El sistema envía la factura al SRI y muestra el resultado: autorizada, pendiente o con error.

### 7.2 Consultar estado de una factura en el SRI

1. Abra el listado de facturas.
2. Haga clic en el número de la factura para ver su detalle.
3. En el detalle verá el **estado SRI**: Autorizada, Pendiente, Rechazada, Anulada.
4. Para facturas pendientes puede hacer clic en **Consultar SRI** para actualizar el estado.

### 7.3 Notas de débito

Las notas de débito se usan para ajustar el valor de una factura ya emitida hacia arriba (cobro adicional, intereses por mora, etc.).

1. Desde el menú lateral, vaya a **Ventas → Notas de Débito**.
2. Haga clic en **Nueva Nota de Débito**.
3. Busque la factura original a la que se aplicará.
4. Ingrese el motivo y el monto del ajuste.
5. Haga clic en **Emitir**.

### 7.4 Notas de crédito

Las notas de crédito se usan para anular o reducir el valor de una factura ya emitida (devolución, descuento posterior, error).

1. Abra el detalle de la factura original.
2. Haga clic en el botón **Emitir Nota de Crédito**.
3. Seleccione si es anulación total o parcial, e ingrese el motivo y el monto.
4. Confirme la emisión.

### 7.5 Retenciones (Plan Pro)

Las retenciones se emiten cuando su empresa actúa como **agente de retención** del SRI.

1. Desde el menú lateral, vaya a **Tributario → Retenciones**.
2. Haga clic en **Nueva Retención**.
3. Busque la compra asociada o ingrese los datos del proveedor y el documento sustento manualmente.
4. Agregue los códigos de retención correspondientes (IR y/o IVA) con sus porcentajes y bases.
5. Haga clic en **Emitir Retención**.

> 💡 Cuando la retención se vincula a una compra registrada, el sistema actualiza automáticamente los acumulados de retención IVA y renta en esa compra.

### 7.6 Guías de remisión

1. Desde el menú lateral, vaya a **Ventas → Guías de Remisión**.
2. Haga clic en **Nueva Guía de Remisión**.
3. Complete los datos del transportista, el destinatario y los bienes que se trasladan.
4. Vincule opcionalmente a una factura existente.
5. Haga clic en **Emitir**.

### 7.7 Buzón SRI

El Buzón SRI muestra los comprobantes que han quedado pendientes de respuesta o que requieren atención.

1. Desde el menú lateral, vaya a **Compras → Buzón SRI**.
2. Revise los documentos en estado pendiente.
3. Para cada documento puede intentar el reenvío al SRI.

### 7.8 Anular una factura

1. Abra el detalle de la factura.
2. Haga clic en **Anular**.
3. Ingrese el motivo de la anulación.
4. Confirme.

> ⚠ Solo se pueden anular facturas autorizadas. Una factura anulada no puede reactivarse. Si tiene movimientos de inventario o caja asociados, estos se revierten automáticamente.

---

## 8. Módulo Notas de Venta

Las Notas de Venta son el documento estándar para los contribuyentes bajo el régimen **RIMPE Negocio Popular**, en lugar de facturas electrónicas.

Acceda desde el menú lateral: **Ventas → Notas de Venta**.

### 8.1 Emitir una Nota de Venta

1. Haga clic en **Nueva Nota de Venta**.
2. Complete los datos del cliente (nombre, identificación, dirección).
3. Agregue los productos o servicios con cantidades y precios.
4. Seleccione la forma de pago.
5. Haga clic en **Emitir Nota de Venta**.

### 8.2 Listado de Notas de Venta

- Muestra todas las notas de venta emitidas con fecha, número, cliente y total.
- Puede filtrar por fecha, cliente o estado.
- Haga clic en el número del documento para ver el detalle completo.

### 8.3 Detalle de Nota de Venta

Desde el detalle puede:
- Ver todos los datos del documento.
- Imprimir la nota de venta.
- Anular la nota de venta.

### 8.4 Anular una Nota de Venta

1. Abra el detalle de la nota de venta.
2. Haga clic en **Anular**.
3. Ingrese el motivo.
4. Confirme la anulación.

---

## 9. Módulo Compras

El módulo de Compras registra las facturas de compra de sus proveedores, con integración opcional de inventario, caja y retenciones.

> 💡 El módulo de Compras está disponible desde el **Plan Medium**.

Acceda desde el menú lateral: **Compras → Compras**.

### 9.1 Registrar una compra manualmente

1. Haga clic en **Nueva Compra**.
2. Busque o registre el **proveedor** (por RUC, con consulta automática al SRI).
3. Ingrese los datos del documento: número de factura del proveedor, fecha de emisión, fecha de vencimiento.
4. Agregue los productos comprados con cantidades, precios unitarios y porcentajes de IVA.
5. En las opciones adicionales seleccione:
   - **Registrar entrada de inventario** — descarga los productos al inventario.
   - **Registrar egreso de caja** — descuenta el pago de la caja diaria.
   - **Actualizar costos** — actualiza el costo de los productos existentes en el catálogo.
   - **Crear productos faltantes** — crea automáticamente los productos que no existan en el catálogo.
6. Haga clic en **Guardar Compra**.

### 9.2 Importar compra desde XML

Si su proveedor le entregó el archivo XML de la factura electrónica:

1. Haga clic en **Importar desde XML**.
2. Seleccione el archivo `.xml` en su computadora.
3. El sistema prellena todos los datos de la compra automáticamente.
4. Revise y ajuste si es necesario.
5. Haga clic en **Guardar Compra**.

### 9.3 Importar compra desde clave de acceso SRI

Si tiene la **clave de acceso** o el **número de autorización** de la factura electrónica del proveedor:

1. Haga clic en **Importar desde autorización SRI**.
2. Ingrese la clave de acceso (49 dígitos) o el número de autorización.
3. El sistema consulta al SRI y descarga el XML autorizado.
4. Los datos se prellenan automáticamente.
5. Revise y haga clic en **Guardar Compra**.

### 9.4 Retenciones de compra

Desde el detalle de una compra puede emitir directamente la retención asociada:

1. Abra el detalle de la compra.
2. En la sección de retenciones, haga clic en **Nueva Retención** (o en una retención existente para ver su detalle).
3. Los datos del proveedor y el documento sustento se prellenan desde la compra.
4. Agregue los códigos de retención y emita.

### 9.5 Anular una compra

1. Abra el detalle de la compra.
2. Haga clic en **Anular**.
3. Ingrese el motivo.
4. Confirme.

El sistema revierte automáticamente los movimientos de inventario y caja asociados a esa compra.

### 9.6 Exportar compras

En el listado de compras puede hacer clic en **Exportar CSV** para descargar las compras visibles (con los filtros activos) en formato de hoja de cálculo.

---

## 10. Módulo Inventario / Productos

### 10.1 Catálogo de productos

Acceda desde el menú lateral: **Inventario → Productos**.

Aquí verá todos los productos y servicios registrados. Para cada producto puede ver: código, nombre, precio de venta, costo, stock actual y estado.

#### Crear un producto nuevo

1. Haga clic en **Nuevo Producto**.
2. Complete los datos:
   - **Código principal** (obligatorio — puede ser el código de barras).
   - **Código auxiliar** (opcional — código interno o alternativo).
   - **Nombre del producto**.
   - **Descripción**.
   - **Precio de venta** (con IVA incluido o sin IVA, según su configuración).
   - **Costo**.
   - **IVA**: 0 %, 5 % o 15 %.
   - **¿Es inventariable?** — marque esta opción si lleva control de stock.
   - **Stock inicial** (si es inventariable).
   - **Stock mínimo** — nivel de alerta de stock bajo.
3. Haga clic en **Guardar**.

> 💡 Los **servicios** (consultoría, mano de obra, instalación, etc.) generalmente no son inventariables. Desmarque la opción "Es inventariable" para esos casos.

### 10.2 Carga masiva desde Excel

Para cargar muchos productos a la vez:

1. Haga clic en **Importar desde Excel**.
2. En el modal, haga clic en **Descargar plantilla** para obtener el archivo `aela-plantilla-productos.xlsx`.
3. Abra la plantilla en Excel y complete los datos siguiendo las columnas indicadas.
4. Guarde el archivo.
5. De regreso en AELA, haga clic en **Seleccionar archivo** y elija el Excel completado.
6. Haga clic en **Importar**.
7. El sistema mostrará un resumen de productos creados, actualizados y errores encontrados.

> 💡 La plantilla incluye instrucciones en la primera fila de cada columna. Respete el formato de los valores (no cambie los encabezados de columna).

> ⚠ Si un producto con el mismo código ya existe, el sistema lo actualiza (no lo duplica). Verifique bien los códigos antes de importar.

### 10.3 Importar productos desde XML de compra

Cuando registra una compra con productos que no existen en el catálogo, puede activar la opción **Crear productos faltantes** y el sistema los crea automáticamente.

Alternativamente:

1. Vaya a **Inventario → Productos → Importar desde XML**.
2. Suba el XML de una factura de compra.
3. El sistema crea los productos nuevos que encuentre en el XML.

### 10.4 Ajustes de stock

Para corregir el stock de un producto (conteo físico, pérdida, ajuste):

1. En el listado de productos, haga clic en el producto.
2. Vaya a la sección **Ajuste de inventario**.
3. Seleccione el tipo: **Entrada** (aumenta stock) o **Salida** (reduce stock).
4. Ingrese la cantidad y el motivo del ajuste.
5. Haga clic en **Guardar ajuste**.

### 10.5 Movimientos de inventario

Acceda desde el menú lateral: **Inventario → Control de Inventario**.

Aquí puede ver todos los movimientos de stock (entradas por compras, salidas por ventas, ajustes manuales), con filtros por fecha, producto y tipo de movimiento.

Puede exportar los movimientos en formato CSV haciendo clic en **Exportar CSV**.

---

## 11. Módulo Clientes

Acceda desde el menú lateral: **Clientes y Proveedores → Clientes**.

### 11.1 Buscar o crear un cliente

#### Búsqueda por cédula o RUC

1. En el formulario de búsqueda, ingrese la cédula (10 dígitos) o el RUC (13 dígitos) del cliente.
2. Haga clic en **Buscar**.
3. El sistema primero busca en la base de datos interna. Si no lo encuentra, consulta automáticamente al SRI.
4. Si el SRI devuelve datos, se prellenan los campos del formulario.
5. Revise los datos y haga clic en **Guardar** para agregar el cliente al maestro.

#### Crear cliente manualmente

1. Haga clic en **Nuevo Cliente**.
2. Seleccione el tipo de identificación: Cédula, RUC o Pasaporte.
3. Ingrese el número de identificación.
4. Complete: Razón Social / Nombre, dirección, teléfono, email.
5. Haga clic en **Guardar**.

### 11.2 Maestro de clientes

El listado muestra todos los clientes registrados. Puede:
- Filtrar por nombre, identificación o estado.
- Hacer clic en un cliente para ver su detalle.
- Editar los datos del cliente.
- Ver el **historial de compras** (facturas y notas de venta emitidas a ese cliente).

---

## 12. Módulo Contabilidad

> 💡 El módulo de Contabilidad está disponible en el **Plan Pro**.

Acceda desde el menú lateral: **Contabilidad → Contabilidad**.

### 12.1 Plan de cuentas

AELA instala automáticamente un **plan de cuentas base** al crear la empresa. Este plan es un punto de partida que el contador puede personalizar.

#### Ver y editar el plan de cuentas

1. Desde el módulo de Contabilidad, vaya a **Plan de Cuentas**.
2. Verá el árbol de cuentas organizado por grupos (Activo, Pasivo, Patrimonio, Ingresos, Gastos, Costos).
3. Puede:
   - **Agregar una cuenta nueva**: haga clic en **Nueva Cuenta** e ingrese el código y nombre.
   - **Editar una cuenta existente**: haga clic en la cuenta y modifique sus datos.
   - **Desactivar una cuenta**: use el interruptor de estado en la fila de la cuenta.

#### Reinstalar el plan base AELA

Si necesita volver al plan de cuentas original sin perder los asientos ya registrados:

1. En el módulo de Contabilidad, busque la opción **Sincronizar plan base AELA**.
2. Confirme la operación.
3. El sistema agrega las cuentas del plan base que falten, sin eliminar las que ya creó el contador.

> ⚠ Modifique el plan de cuentas en coordinación con su contador. Una estructura de cuentas incorrecta puede afectar los reportes contables.

### 12.2 Periodos contables

Antes de registrar asientos manuales, asegúrese de tener el **período contable** abierto.

1. Vaya a **Periodos Contables**.
2. Si no existe el período del año en curso, haga clic en **Nuevo Período** e ingrese el año.
3. El período debe estar en estado **Abierto** para permitir nuevos asientos.

### 12.3 Asientos automáticos

El sistema genera asientos contables automáticamente al:
- Autorizar una factura de venta.
- Registrar una compra.
- Registrar otros documentos contables.

Estos asientos se pueden consultar desde **Contabilidad → Asientos**.

### 12.4 Asientos manuales

Para registrar ajustes o asientos que no se generan automáticamente:

1. En **Contabilidad → Asientos**, haga clic en **Nuevo Asiento**.
2. Ingrese la fecha, descripción y referencia.
3. Agregue las líneas de débito y crédito con las cuentas y montos correspondientes.
4. Verifique que el asiento cuadre (total débitos = total créditos).
5. Haga clic en **Guardar** para dejarlo en borrador, o **Cerrar** para cerrarlo definitivamente.

> ⚠ Un asiento cerrado no puede modificarse. Solo puede anularse mediante un contra-asiento.

### 12.5 Reportes contables

Desde el módulo de Contabilidad puede generar:

| Reporte | Descripción |
|---|---|
| **Diario** | Listado cronológico de todos los asientos |
| **Mayor** | Movimientos por cuenta contable individual |
| **Mayorización** | Resumen de saldos por cuenta |
| **Balance de Comprobación** | Comparación de débitos y créditos por cuenta |
| **Estado de Resultados** | Ingresos y gastos del período |
| **Balance General** | Activos, pasivos y patrimonio a una fecha |

Para generar cualquier reporte:
1. Seleccione el reporte desde el menú de Contabilidad.
2. Elija el **período** o rango de fechas.
3. Haga clic en **Generar**.

---

## 13. Módulo Bancos

> 💡 El módulo de Bancos está disponible en el **Plan Pro**. Acceda desde el menú lateral: **Contabilidad → Bancos**.

### 13.1 Registrar una cuenta bancaria

1. Desde el módulo de Bancos, haga clic en **Nueva Cuenta Bancaria**.
2. Ingrese:
   - Nombre del banco.
   - Tipo de cuenta (corriente, ahorros).
   - Número de cuenta.
   - Nombre del titular.
   - Saldo inicial.
3. Haga clic en **Guardar**.

### 13.2 Registrar movimientos bancarios

1. Seleccione la cuenta bancaria.
2. Haga clic en **Nuevo Movimiento**.
3. Ingrese el tipo (crédito/débito), fecha, monto, descripción y referencia (número de cheque, transferencia, etc.).
4. Haga clic en **Guardar**.

### 13.3 Conciliación bancaria

La conciliación le permite comparar los movimientos del sistema con el estado de cuenta real del banco.

1. Seleccione la cuenta bancaria.
2. Ingrese el saldo del estado de cuenta bancario a una fecha de corte.
3. Marque los movimientos que aparecen en el estado de cuenta.
4. El sistema calcula las diferencias (partidas pendientes).

---

## 14. Declaraciones / ATS / Tributario

> 💡 Estos módulos están disponibles en el **Plan Pro**. Acceda desde el menú lateral: grupo **Tributario**.

### 14.1 Retenciones

(Ver también sección [7.5 Retenciones](#75-retenciones-plan-pro) y [9.4 Retenciones de compra](#94-retenciones-de-compra)).

Desde el menú **Tributario → Retenciones** puede:
- Ver todas las retenciones emitidas.
- Filtrar por proveedor, fecha, estado.
- Descargar el PDF o XML de cualquier retención.
- Reenviar una retención al SRI si tuvo algún error.
- Anular retenciones.

### 14.2 Liquidaciones de compra

Las liquidaciones de compra se usan cuando adquiere bienes o servicios de personas naturales no obligadas a emitir comprobantes.

1. Vaya a **Tributario → Liquidaciones**.
2. Haga clic en **Nueva Liquidación**.
3. Complete los datos del proveedor (cédula/RUC, nombre, dirección).
4. Ingrese los bienes o servicios adquiridos con sus valores.
5. Haga clic en **Emitir Liquidación**.

### 14.3 ATS (Anexo Transaccional Simplificado)

El ATS es el anexo que se presenta mensualmente al SRI con el detalle de compras, ventas y retenciones.

1. Vaya a **Tributario → ATS**.
2. Seleccione el **mes** y el **año** del período.
3. Haga clic en **Vista previa** para revisar los datos antes de exportar.
4. Verifique que los datos sean correctos.
5. Haga clic en **Exportar ATS** para descargar el archivo XML listo para subir al portal del SRI.

> ⚠ Revise siempre la vista previa antes de exportar. Verifique que los RUC de proveedores y clientes sean correctos, y que las bases imponibles coincidan con sus registros.

### 14.4 Reportes tributarios

Desde **Tributario → Reportes Tributarios** puede generar informes detallados de:
- Ventas del período por tipo de documento.
- Compras del período.
- Retenciones efectuadas.
- Resumen de IVA (IVA cobrado en ventas vs IVA pagado en compras).

---

## 15. Talento Humano

> 💡 El módulo de Talento Humano está disponible desde el **Plan Medium**. Debe estar activado en **Config Sistema → Talento Humano Habilitado**. Acceda desde el menú lateral: grupo **Talento Humano**.

### 15.1 Departamentos

1. Vaya a **Talento Humano → Departamentos**.
2. Para crear un departamento, haga clic en **Nuevo Departamento**, ingrese el nombre y haga clic en **Guardar**.
3. Puede editar el nombre o desactivar un departamento.
   > ⚠ No puede desactivar un departamento que tenga empleados activos asignados.

### 15.2 Cargos

1. Vaya a **Talento Humano → Cargos**.
2. Haga clic en **Nuevo Cargo**.
3. Ingrese el nombre del cargo y seleccione opcionalmente el departamento al que pertenece.
4. Haga clic en **Guardar**.

### 15.3 Empleados

#### Registrar un empleado nuevo

1. Vaya a **Talento Humano → Empleados**.
2. Haga clic en **Nuevo Empleado**.
3. Complete los datos en cuatro secciones:

**Datos personales:**
- Tipo y número de identificación (cédula o pasaporte).
- Nombres y apellidos.
- Correo electrónico, teléfono, dirección.
- Fecha de nacimiento, sexo, estado civil.

**Datos laborales:**
- Tipo de contrato (indefinido, plazo fijo, por obra, etc.).
- Fecha de ingreso.
- Salario base mensual.
- Departamento y cargo.

**Configuración IESS:**
- Código de afiliación IESS.
- **Afiliado al IESS** (marcar si corresponde).
- **Tiene Impuesto a la Renta** (marcar si aplica).
- **Fondos de Reserva** (marcar si el empleado cumple más de 1 año y elige recibir mensualmente).

4. Haga clic en **Guardar Empleado**.

### 15.4 Nómina mensual (Rol de pagos)

#### Crear la nómina del mes

1. Vaya a **Talento Humano → Nómina**.
2. Haga clic en **Nueva Nómina**.
3. Seleccione el **mes** y el **año**.
4. El sistema calcula automáticamente los valores para todos los empleados activos:

| Concepto | Cálculo |
|---|---|
| Salario base | Según registro del empleado |
| Horas extras suplementarias | Valor hora × 1.25 (se ingresan manualmente) |
| Horas extras extraordinarias | Valor hora × 1.50 (se ingresan manualmente) |
| Aporte personal IESS | 9.45 % del salario |
| Décimo tercer sueldo proporcional | Salario ÷ 12 (informativo) |
| Décimo cuarto sueldo proporcional | SBU ÷ 12 (informativo, SBU configurable) |
| Fondos de reserva proporcional | Salario ÷ 12 (si aplica) |
| Aporte patronal IESS | 11.15 % del salario (costo empresa, informativo) |

#### Editar detalles individuales

1. En el panel de detalle de la nómina, seleccione un empleado.
2. Puede agregar o modificar:
   - Horas extras suplementarias y extraordinarias.
   - Otros ingresos (bonos, comisiones).
   - Impuesto a la renta (ingreso manual).
   - Préstamos IESS, anticipos, otros descuentos.
3. Los totales se recalculan automáticamente.

#### Flujo de estados de la nómina

```
BORRADOR → (revisar y ajustar) → PROCESADA → (confirmar pago) → PAGADA
```

- **BORRADOR**: nómina en edición. Se puede modificar.
- **PROCESADA**: nómina revisada y lista para pago. Se puede ver pero no editar.
- **PAGADA**: nómina pagada. Bloqueada permanentemente para edición.

#### Exportar e imprimir

- **CSV**: en el panel de detalle de la nómina, haga clic en **CSV** para descargar todos los conceptos en formato Excel-compatible.
- **Rol de pagos imprimible**: haga clic en **Imprimir** para abrir una versión optimizada para impresión con firmas de elaborado/revisado/autorizado.

### 15.5 Ausencias y vacaciones

1. Vaya a **Talento Humano → Ausencias**.
2. Haga clic en **Nueva Ausencia**.
3. Seleccione el empleado, el tipo de ausencia y las fechas de inicio y fin.
   
   Tipos disponibles: Vacación, Permiso Personal, Enfermedad, Maternidad, Paternidad, Licencia.

4. El sistema calcula automáticamente el número de días.
5. Haga clic en **Guardar**.
6. El supervisor o administrador puede aprobar o rechazar la solicitud desde el listado.

---

## 16. Administración del sistema

### 16.1 Gestión de usuarios y roles

Acceda desde el menú lateral: **Administración → Usuarios**.

> ⚠ Solo los usuarios con rol **Administrador** pueden gestionar otros usuarios.

#### Crear un usuario nuevo

1. Haga clic en **Nuevo Usuario**.
2. Complete:
   - **Nombre completo**.
   - **Nombre de usuario** (sin espacios, se usa para iniciar sesión).
   - **Correo electrónico**.
   - **Contraseña inicial**.
   - **Rol** (ver tabla de roles a continuación).
3. Haga clic en **Crear Usuario**.

#### Roles y permisos

| Rol | Descripción | Acceso principal |
|---|---|---|
| **Administrador** | Acceso completo al sistema | Todos los módulos, gestión de usuarios, configuración |
| **Supervisor** | Operaciones y supervisión | Ventas, compras, inventario, RRHH (sin configuración SRI ni sistema) |
| **Contador / Financiero** | Módulos financieros y tributarios | Facturación, contabilidad, retenciones, ATS, nómina |
| **Facturador** | Emisión de documentos de venta | POS, facturas, notas de venta, clientes, caja |
| **Operador** | Operaciones básicas | POS, notas de venta, productos, inventario básico |

> 💡 Los módulos que el usuario puede ver también dependen del plan del sistema y de qué módulos estén activos en la Configuración del Sistema.

#### Editar o desactivar un usuario

1. Busque el usuario en el listado.
2. Haga clic en **Editar** (ícono azul) para modificar sus datos o rol.
3. Haga clic en **Desactivar** (ícono rojo) para bloquear el acceso sin eliminar su historial.
4. Haga clic en **Activar** (ícono verde) para reactivar un usuario desactivado.

### 16.2 Gestión de empresas (Plan Pro — Multiempresa)

Acceda desde el menú lateral: **Administración → Empresas**.

Si el sistema está en modo **Multiempresa**, desde aquí puede:

1. Ver todas las empresas registradas.
2. Crear una nueva empresa con su configuración SRI y plan de cuentas independiente.
3. Cambiar la empresa activa.

> ⚠ Cada empresa tiene su propia configuración SRI, sus propios documentos, clientes, productos y contabilidad. Los usuarios se asignan a empresas específicas.

### 16.3 Activar o desactivar módulos

1. Vaya a **Configuración → Config Sistema**.
2. Use los interruptores (toggles) para activar o desactivar cada módulo.
3. Haga clic en **Guardar configuración**.
4. Los cambios se aplican de inmediato: los módulos desactivados desaparecen del menú lateral.

### 16.4 Cambiar contraseña de cualquier usuario

1. Vaya a **Administración → Usuarios**.
2. Haga clic en **Editar** junto al usuario.
3. En el formulario de edición, ingrese y confirme la nueva contraseña.
4. Haga clic en **Guardar**.

> 💡 El usuario podrá cambiar su propia contraseña desde su perfil una vez que ingrese al sistema.

---

## 17. Modo offline (sin internet)

### 17.1 Cómo funciona

AELA ERP es una PWA (Progressive Web App). Esto significa que el sistema:

1. Al cargar por primera vez con internet, guarda los recursos necesarios en el navegador.
2. Cuando se corta la conexión, el sistema detecta el cambio y activa el **modo offline**.
3. Aparece un indicador visible en la parte superior de la pantalla indicando que está trabajando sin conexión.

### 17.2 Operaciones disponibles en modo offline

| Operación | Disponible offline |
|---|---|
| Ver datos ya cargados (clientes, productos, etc.) | ✅ Sí |
| Emitir ventas en POS (Nota de Venta) | ✅ Sí (se envía al servidor cuando vuelve la conexión) |
| Emitir Facturas Electrónicas con autorización SRI | ❌ No (requiere conexión con el SRI) |
| Registrar movimientos de caja | Parcial |
| Consultar historial de documentos | ✅ Sí (datos previamente cargados) |
| Acceder a configuración | ❌ No (requiere conexión con el servidor) |

> ⚠ Las facturas electrónicas requieren comunicarse con los servidores del SRI para obtener la autorización. En modo offline quedan en estado **pendiente** y se envían automáticamente cuando se recupera la conexión.

### 17.3 Sincronización automática

1. Cuando el sistema detecta que se recuperó la conexión a internet, activa automáticamente la sincronización.
2. Todos los documentos pendientes se envían al servidor y luego al SRI.
3. Una notificación en pantalla confirma que la sincronización se completó.
4. Si algún documento falló (por ejemplo, un error de validación del SRI), aparecerá marcado como error en el módulo correspondiente para que pueda revisarlo y reenviarlo manualmente.

### 17.4 Instalar AELA ERP como aplicación de escritorio

Para instalar AELA como una aplicación (PWA) sin necesidad de abrir el navegador cada vez:

1. En Google Chrome o Edge, abra el sistema.
2. En la barra de direcciones, busque el ícono de instalación (una pantalla con una flecha, o "Instalar aplicación").
3. Haga clic en **Instalar**.
4. El sistema se agrega al escritorio o al menú de inicio de Windows.
5. Desde ahí puede abrirlo como cualquier otra aplicación.

> 💡 La PWA instalada se actualiza automáticamente en segundo plano cuando hay una nueva versión disponible. La próxima vez que la abra, verá la versión actualizada.

### 17.5 Actualizar la PWA manualmente

Si aparece un aviso de actualización disponible:

1. Guarde cualquier trabajo en curso.
2. Haga clic en el aviso de actualización o recargue la página (F5).
3. El sistema carga la nueva versión.

---

## 18. Solución de problemas

### 18.1 Errores comunes del SRI

| Error | Posible causa | Solución |
|---|---|---|
| `CERT_EXPIRED` o "Certificado vencido" | El certificado digital caducó | Renueve el certificado en el Banco Central del Ecuador y cárguelo nuevamente en Config SRI |
| `FIRMA_INVALIDA` | La clave del certificado es incorrecta | Verifique la contraseña del certificado en Config SRI → Certificado Digital |
| `AMBIENTE_NO_COINCIDE` | El ambiente del comprobante no corresponde | Verifique que el ambiente en Config SRI (Pruebas/Producción) sea el correcto |
| `RUC_NO_ENCONTRADO` | El RUC del emisor no está activo en el SRI | Verifique el RUC en la página del SRI y contacte a su asesor tributario |
| `NUMERO_SECUENCIAL_DUPLICADO` | Ya existe un documento con ese número | El sistema asigna el número automáticamente. Si persiste, contacte a soporte |
| `SERVICIO_SRI_NO_DISPONIBLE` | Los servidores del SRI están caídos o con mantenimiento | Espere unos minutos y reintente. Los documentos quedan en estado pendiente |
| `CLAVE_ACCESO_INVALIDA` | Error en la clave de acceso al importar una compra | Verifique que la clave de acceso tenga exactamente 49 dígitos y sea correcta |

> 💡 Puede consultar el estado de los servicios del SRI en: **https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl**

### 18.2 Qué hacer si se cae el internet durante una venta

1. **No cierre el navegador ni apague el equipo.**
2. El sistema detecta la pérdida de conexión y activa el modo offline.
3. Continue con la venta normalmente (en POS con Nota de Venta, si está configurado).
4. Cuando se recupere la conexión, los documentos se sincronizarán automáticamente.
5. Para facturas electrónicas, quedarán en estado "pendiente" hasta que el SRI las autorice.

### 18.3 El sistema muestra "Sin conexión" pero hay internet

1. Verifique que el servidor AELA esté funcionando (consulte con el administrador del sistema).
2. Intente recargar la página con **F5** o **Ctrl + F5** (recarga forzada).
3. Limpie el caché del navegador: en Chrome, vaya a Configuración → Privacidad → Borrar datos de navegación → marque "Imágenes y archivos en caché" → Borrar datos.
4. Si el problema persiste, contacte a soporte CorpSimtelec.

### 18.4 No puedo iniciar sesión

| Situación | Solución |
|---|---|
| Contraseña incorrecta | Contacte al administrador para que restablezca su contraseña |
| Usuario desactivado | Contacte al administrador para que reactive su usuario |
| Sesión expirada (30 min de inactividad) | Ingrese nuevamente con sus credenciales |
| El sistema no responde | Verifique que el servidor esté funcionando; contacte al administrador |

### 18.5 Un producto no aparece en el POS al escanearlo

1. Verifique que el producto existe en el catálogo (**Inventario → Productos**).
2. Verifique que el código escaneado coincide con el **Código Principal** o el **Código Auxiliar** del producto.
3. Verifique que el producto esté en estado **Activo**.
4. Si el código es correcto pero no lo encuentra, edite el producto y actualice el código.

### 18.6 La factura quedó en estado "Pendiente"

1. Vaya al módulo **Ventas → Facturas** y abra el detalle de la factura.
2. Haga clic en **Consultar SRI** para actualizar el estado.
3. Si el SRI ya la autorizó, el estado cambiará a Autorizada.
4. Si el SRI la rechazó, verá el motivo del rechazo. Corrija el error indicado y reintente.
5. Si el SRI no responde, espere a que los servicios estén disponibles y vuelva a consultar.

### 18.7 Cómo actualizar la aplicación (PWA)

1. Cuando hay una actualización disponible, aparece una barra de aviso en la parte superior de la pantalla.
2. Guarde cualquier operación en curso.
3. Haga clic en **Actualizar ahora** o recargue la página (**F5**).
4. El sistema carga la nueva versión automáticamente.

> 💡 Si necesita forzar la actualización sin esperar el aviso automático: abra las Herramientas de desarrollador del navegador (**F12**), vaya a la pestaña **Application** → **Service Workers** → haga clic en **Update** y luego recargue la página.

### 18.8 El plan de cuentas base desapareció o está incompleto

1. Vaya a **Contabilidad** en el menú lateral.
2. Busque la opción **Sincronizar plan base AELA**.
3. Confirme la operación. El sistema agrega las cuentas faltantes sin afectar las que ya existen.

### 18.9 Contacto con soporte CorpSimtelec

Si ninguna solución de esta guía resuelve su problema:

| Canal | Contacto |
|---|---|
| **WhatsApp** | +593 097 889 3520 |
| **Correo soporte** | soporte@corpsimtelec.com |
| **Correo ventas** | ventas@corpsimtelec.com |
| **Correo general** | info@corpsimtelec.com |

Cuando contacte a soporte, tenga a la mano:
- El nombre de su empresa y el RUC.
- Una descripción del problema (qué estaba haciendo cuando ocurrió).
- Capturas de pantalla del error si las hay.
- El plan contratado (Lite, Medium o Pro).

---

*Manual de Usuario AELA ERP v1.0 — CorpSimtelec Ecuador*
*Última actualización: Mayo 2026*
