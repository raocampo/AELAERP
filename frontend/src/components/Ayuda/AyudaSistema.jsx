// ====================================
// AYUDA & DOCUMENTACIÓN — AELA ERP
// Guía SaaS / Multi-empresa y uso del sistema
// ====================================

import { useState } from 'react';
import { useAuth } from '../../context/useAuth';
import './AyudaSistema.css';

const SECCIONES = [
  {
    id: 'saas',
    icono: '🏢',
    titulo: 'Multiempresa y Admin Macro',
    contenido: (
      <div className="ayuda-contenido">
        <p>AELA ERP soporta <strong>Macro Empresa</strong>: una sola cuenta (ej. una empresa consultora o de servicios contables) puede gestionar varias empresas/sub-empresas independientes, cada una con sus propios datos, facturas, plan de cuentas y usuarios completamente aislados.</p>

        <h4>Crear una nueva empresa</h4>
        <ol>
          <li>Ve a <strong>Administración → Empresas</strong> (solo visible para administradores).</li>
          <li>Haz clic en <strong>+ Nueva Empresa</strong>.</li>
          <li>Completa: <em>RUC, Razón Social, Nombre Comercial, Dirección, Plan, Tipo de contribuyente</em> (Persona Natural o Jurídica).</li>
          <li>Si es Persona Jurídica, completa opcionalmente <strong>Representante Legal</strong> y <strong>Contadora/Contador</strong> (esta última se identifica con <strong>RUC</strong>, no cédula).</li>
          <li>Marca <strong>Empresa matriz</strong> si es la empresa raíz, o selecciona su <strong>Empresa matriz</strong> si es una filial.</li>
          <li>Activa <strong>Crear configuración SRI</strong> si la empresa necesita facturación electrónica.</li>
          <li>Guarda. El sistema crea automáticamente la estructura de datos para esa empresa (plan de cuentas base, configuración del sistema).</li>
        </ol>

        <h4>Planes disponibles</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Plan</th><th>Facturación electrónica</th><th>Inventario</th><th>Contabilidad</th><th>RRHH</th></tr></thead>
          <tbody>
            <tr><td><strong>Lite</strong></td><td>❌</td><td>Básico</td><td>❌</td><td>❌</td></tr>
            <tr><td><strong>Medium</strong></td><td>✅</td><td>Completo</td><td>❌</td><td>✅</td></tr>
            <tr><td><strong>Pro / Full</strong></td><td>✅</td><td>Completo</td><td>✅</td><td>✅</td></tr>
          </tbody>
        </table>

        <h4>¿Quién es Admin Macro?</h4>
        <p>Un usuario cuyo <strong>rol base</strong> (el de su empresa de origen) es <strong>Administrador</strong> se convierte automáticamente en <strong>Admin Macro</strong>: ve TODAS las empresas activas de la cuenta, puede gestionar usuarios de cualquiera de ellas, y aparece marcado con el chip <strong>"Admin Macro"</strong> en la lista de usuarios de cada empresa (sin necesidad de estar asignado explícitamente a ella).</p>
        <p>Un usuario con rol base distinto (ej. Supervisor o Contador) que también tiene acceso a una empresa específica (asignado por un Admin Macro) solo verá botones de gestión en esa empresa puntual, no en las demás.</p>

        <h4>Cambiar de empresa activa</h4>
        <ol>
          <li>En el sidebar, bajo <strong>"Modo multiempresa"</strong>, haz clic en el nombre de la empresa activa.</li>
          <li>Selecciona la empresa a la que quieres cambiar. El sistema recarga con los datos, permisos y plan de cuentas de esa empresa.</li>
          <li>Todo lo que hagas después (facturas, compras, asientos contables) queda registrado en la empresa activa, no en tu empresa base.</li>
        </ol>

        <h4>Asignar usuarios a una empresa</h4>
        <ol>
          <li>En <strong>Administración → Empresas</strong>, expande la empresa.</li>
          <li>Usa el panel <strong>"Usuarios de esta empresa"</strong> para vincular usuarios existentes (del pool de tu empresa base) o crear nuevos.</li>
          <li>Asigna el rol que tendrá ese usuario específicamente en esa empresa (puede ser distinto a su rol base).</li>
        </ol>

        <div className="ayuda-nota">
          💡 <strong>Modo Mono-empresa:</strong> instalaciones simples (sin Macro Empresa) solo tienen una empresa activa y no muestran el selector del sidebar.
        </div>
      </div>
    ),
  },
  {
    id: 'usuarios',
    icono: '👥',
    titulo: 'Usuarios y roles',
    contenido: (
      <div className="ayuda-contenido">
        <p>Cada usuario tiene un <strong>rol</strong> que determina qué módulos puede usar. El administrador puede además otorgar <strong>permisos adicionales</strong> temporales fuera del rol.</p>

        <h4>Roles disponibles</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Rol</th><th>Acceso principal</th></tr></thead>
          <tbody>
            <tr><td><strong>Administrador</strong></td><td>Acceso completo a todo el sistema</td></tr>
            <tr><td><strong>Supervisor</strong></td><td>Ventas, compras, RRHH, facturación (sin configurar)</td></tr>
            <tr><td><strong>Contador</strong></td><td>Contabilidad, bancos, compras, tributario, RRHH</td></tr>
            <tr><td><strong>Asistente Contabilidad</strong></td><td>Contabilidad (vista), bancos, clientes, inventario</td></tr>
            <tr><td><strong>Facturador</strong></td><td>Facturas, caja, POS, clientes, productos</td></tr>
            <tr><td><strong>Secretaria</strong></td><td>Facturas (ver + emitir), caja, clientes, notas de venta</td></tr>
            <tr><td><strong>Operador</strong></td><td>POS, caja, notas de venta, clientes, inventario (solo ver)</td></tr>
          </tbody>
        </table>

        <h4>Permisos adicionales</h4>
        <p>Si un usuario necesita acceso temporal a un módulo fuera de su rol (por ejemplo, un operador que ayuda con compras), el administrador puede:</p>
        <ol>
          <li>Ir a <strong>Administración → Usuarios</strong>.</li>
          <li>Editar el usuario.</li>
          <li>En la sección <strong>🔑 Permisos adicionales</strong>, marcar los módulos que necesita.</li>
          <li>Guardar. El usuario verá esos módulos adicionales en su siguiente sesión.</li>
        </ol>

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Los permisos adicionales son de propósito temporal. Para cambios permanentes, considera cambiar el rol del usuario.
        </div>
      </div>
    ),
  },
  {
    id: 'inactividad',
    icono: '🔒',
    titulo: 'Cierre automático por inactividad',
    contenido: (
      <div className="ayuda-contenido">
        <p>El sistema cierra la sesión automáticamente si el usuario no realiza ninguna acción durante <strong>30 minutos</strong>.</p>

        <h4>¿Por qué sucede esto?</h4>
        <p>Es una medida de seguridad para proteger los datos de la empresa si el usuario se aleja de su estación de trabajo sin cerrar sesión manualmente.</p>

        <h4>¿Cómo funciona?</h4>
        <ul>
          <li>A los <strong>25 minutos</strong> de inactividad aparece una advertencia: <em>"Tu sesión se cerrará en 5 minutos por inactividad."</em></li>
          <li>Cualquier movimiento del mouse, clic, tecla o scroll reinicia el contador.</li>
          <li>Al cerrarse, el sistema muestra el mensaje <strong>"Sesión cerrada por inactividad"</strong> y redirige al login.</li>
        </ul>

        <div className="ayuda-nota">
          💡 Si necesitas ajustar el tiempo de inactividad (por ejemplo, a 60 minutos), contáctanos para modificar la configuración del servidor.
        </div>
      </div>
    ),
  },
  {
    id: 'error-chunks',
    icono: '🔄',
    titulo: 'Error "Algo salió mal" al iniciar sesión',
    contenido: (
      <div className="ayuda-contenido">
        <p>Este error ocurre cuando hay una <strong>nueva versión del sistema disponible</strong> pero el navegador aún tiene en caché la versión anterior.</p>

        <h4>¿Por qué sucede?</h4>
        <p>Al publicar una actualización, los archivos de la aplicación cambian de nombre (hash). Si el navegador cargó partes de la versión vieja, puede intentar cargar archivos que ya no existen, causando el error.</p>

        <h4>Solución automática</h4>
        <p>El sistema ahora se auto-recupera: limpia la caché del navegador y recarga la página automáticamente cuando detecta este tipo de error.</p>

        <h4>Solución manual (si el error persiste)</h4>
        <ol>
          <li>Presiona <strong>Ctrl + Shift + R</strong> (Windows/Linux) o <strong>Cmd + Shift + R</strong> (Mac) para forzar recarga sin caché.</li>
          <li>O abre las herramientas del desarrollador → Aplicación → Almacenamiento → Limpiar datos del sitio.</li>
          <li>Vuelve a iniciar sesión.</li>
        </ol>
      </div>
    ),
  },
  {
    id: 'sri-config',
    icono: '📋',
    titulo: 'Configuración SRI y facturación electrónica',
    contenido: (
      <div className="ayuda-contenido">
        <p>Para emitir comprobantes electrónicos válidos ante el SRI de Ecuador, configura la empresa en <strong>Configuración → SRI</strong>.</p>

        <h4>Datos necesarios</h4>
        <ul>
          <li><strong>RUC</strong> de la empresa (13 dígitos)</li>
          <li><strong>Certificado P12</strong> del Banco Central del Ecuador o Security Data</li>
          <li><strong>Clave</strong> del certificado P12</li>
          <li><strong>Ambiente</strong>: Pruebas (1) o Producción (2)</li>
          <li><strong>Tipo de emisión</strong>: Normal (1)</li>
        </ul>

        <h4>Proceso de autorización</h4>
        <ol>
          <li>El sistema genera el XML del comprobante firmado con tu certificado.</li>
          <li>Envía al web service del SRI (pruebas o producción).</li>
          <li>Recibe el número de autorización y lo guarda en el comprobante.</li>
          <li>Genera el RIDE (PDF) para entregar al cliente.</li>
        </ol>

        <div className="ayuda-nota">
          💡 Los certificados P12 tienen vigencia de 2 años. El sistema notificará cuando esté próximo a vencer.
        </div>
      </div>
    ),
  },
  {
    id: 'facturas',
    icono: '🧾',
    titulo: 'Emitir una factura electrónica',
    contenido: (
      <div className="ayuda-contenido">
        <h4>Pasos para emitir una factura</h4>
        <ol>
          <li>Ve a <strong>Ventas → Facturas → + Nueva Factura</strong>.</li>
          <li>Busca el cliente por nombre, RUC o cédula. Si no existe, créalo en el momento.</li>
          <li>Agrega los productos/servicios: escribe el código o descripción y selecciona del listado.</li>
          <li>Ajusta cantidades, precios y descuentos si aplica.</li>
          <li>Selecciona la forma de pago (efectivo, tarjeta, transferencia, etc.).</li>
          <li>Haz clic en <strong>Firmar y enviar</strong>. El sistema envía al SRI y obtiene la autorización.</li>
          <li>El RIDE (PDF) se genera automáticamente. Puedes enviarlo por email o imprimirlo.</li>
        </ol>
        <h4>Estados de la factura</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Estado</th><th>Significado</th></tr></thead>
          <tbody>
            <tr><td>🟡 Pendiente</td><td>Guardada sin enviar al SRI</td></tr>
            <tr><td>🔵 Enviada</td><td>Enviada al SRI, esperando autorización</td></tr>
            <tr><td>🟢 Autorizada</td><td>Autorizada por el SRI — tiene validez legal</td></tr>
            <tr><td>🔴 Rechazada</td><td>El SRI rechazó el comprobante — revisa los datos</td></tr>
            <tr><td>⚫ Anulada</td><td>Anulada. Debes emitir una nueva si fue un error</td></tr>
          </tbody>
        </table>
        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Una vez autorizada por el SRI, una factura <strong>no se puede editar ni eliminar</strong>. Para corregirla debes emitir una Nota de Crédito.
        </div>
      </div>
    ),
  },
  {
    id: 'compras-gastos',
    icono: '🛒',
    titulo: 'Compras — Clasificación de gastos para el SRI',
    contenido: (
      <div className="ayuda-contenido">
        <p>Clasificar tus facturas de compra es importante para la <strong>declaración del IVA</strong> y el cálculo de <strong>gastos deducibles</strong> en la declaración anual del Impuesto a la Renta.</p>

        <h4>Categorías disponibles</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Categoría</th><th>¿Cuándo usarla?</th></tr></thead>
          <tbody>
            <tr><td>🏥 Salud</td><td>Medicamentos, consultas médicas, seguros de salud</td></tr>
            <tr><td>📚 Educación</td><td>Colegiaturas, útiles, cursos, internet educativo</td></tr>
            <tr><td>🍽 Alimentación</td><td>Supermercado, restaurantes, alimentos para el hogar</td></tr>
            <tr><td>🏠 Vivienda</td><td>Arriendo, servicios básicos, reparaciones del hogar</td></tr>
            <tr><td>👔 Vestimenta</td><td>Ropa, calzado, accesorios de vestir</td></tr>
            <tr><td>✈ Turismo</td><td>Hoteles, pasajes, agencias de viaje nacionales</td></tr>
            <tr><td>👤 Gastos Personales</td><td>Gastos personales deducibles para personas naturales (Form 107)</td></tr>
            <tr><td>💼 Gastos Profesionales</td><td>Gastos propios del ejercicio profesional o actividad empresarial</td></tr>
            <tr><td>📦 Otros deducibles</td><td>Cualquier otro gasto deducible no contemplado</td></tr>
          </tbody>
        </table>

        <h4>Cómo clasificar una compra</h4>
        <ol>
          <li>Al registrar una compra: campo <strong>"Tipo de gasto (deducción SRI)"</strong> en el formulario.</li>
          <li>En el listado de compras: clic en el ícono ✏ en la columna <strong>Tipo Gasto</strong> para clasificar sin abrir el detalle.</li>
          <li>Usa el botón <strong>⚡ Auto-clasificar</strong> para que el sistema asigne categorías automáticamente basándose en el nombre del proveedor.</li>
        </ol>

        <h4>Reporte por clasificación</h4>
        <p>En <strong>Compras</strong>, debajo de los filtros, verás la tabla <strong>"Resumen por clasificación de gasto"</strong> con:</p>
        <ul>
          <li><strong>Base 0%</strong>: subtotal de compras sin IVA (tarifa 0%)</li>
          <li><strong>Base IVA</strong>: subtotal de compras con IVA (tarifa 15%)</li>
          <li><strong>IVA pagado</strong>: total de IVA en las compras visibles</li>
          <li><strong>Total</strong>: importe total incluyendo IVA</li>
        </ul>
        <p>Haz clic en <strong>📊 Descargar resumen CSV</strong> para exportar este reporte. Filtra primero por fecha o tipo de gasto para obtener el reporte que necesitas para tu declaración.</p>

        <div className="ayuda-nota">
          💡 Para la declaración del IVA (Form 104): usa la columna <strong>Base IVA</strong> como "Compras gravadas" y la columna <strong>IVA pagado</strong> como "IVA en compras".
        </div>

        <h4>RUC vs. Cédula — cuáles compras cuentan para tus declaraciones</h4>
        <p>Una compra solo es deducible y genera crédito de IVA si el comprobante fue emitido a nombre del <strong>RUC</strong> de tu empresa. Si un proveedor te facturó a una <strong>cédula personal</strong> en vez de tu RUC, esa compra no es válida para declaraciones — el sistema la excluye automáticamente del F104/F101 y la marca con el badge <strong>"⚠️ A cédula"</strong> en el listado y en el detalle.</p>
        <p>Para compras importadas antes del 12 de julio de 2026, usa el botón <strong>"🪪 Marcar RUC/Cédula"</strong> (junto a "Auto-clasificar") una sola vez — revisa el XML original de cada compra y las clasifica retroactivamente.</p>
      </div>
    ),
  },
  {
    id: 'pos',
    icono: '🛍️',
    titulo: 'POS — Punto de Venta',
    contenido: (
      <div className="ayuda-contenido">
        <p>El módulo POS permite realizar ventas rápidas desde una interfaz optimizada para caja.</p>
        <h4>Cómo usar el POS</h4>
        <ol>
          <li>Ve a <strong>POS</strong> desde el menú lateral.</li>
          <li>Busca productos por código o descripción. Usa el escáner si tienes uno conectado.</li>
          <li>Ajusta cantidades con los botones +/- o editando el campo directamente.</li>
          <li>Selecciona el tipo de documento: <strong>Factura</strong> o <strong>Nota de Venta</strong>.</li>
          <li>Si necesitas factura, ingresa el RUC/cédula del cliente. Para consumidor final deja en blanco.</li>
          <li>Selecciona la forma de pago y haz clic en <strong>Cobrar</strong>.</li>
          <li>El comprobante se envía al SRI automáticamente si está en modo Producción.</li>
        </ol>
        <div className="ayuda-nota">
          💡 El POS integra automáticamente el cobro con la Caja Diaria si está abierta.
        </div>
      </div>
    ),
  },
  {
    id: 'caja',
    icono: '💰',
    titulo: 'Caja Diaria',
    contenido: (
      <div className="ayuda-contenido">
        <p>La Caja Diaria registra todos los movimientos de efectivo del día.</p>
        <h4>Flujo diario</h4>
        <ol>
          <li><strong>Apertura:</strong> Al iniciar el día ve a <strong>Ventas → Caja Diaria → Abrir Caja</strong>. Ingresa el monto inicial en efectivo.</li>
          <li><strong>Durante el día:</strong> Las ventas en efectivo del POS se registran automáticamente. Puedes agregar ingresos o egresos manuales (pago de servicios, gastos menores, etc.).</li>
          <li><strong>Cierre:</strong> Al final del día haz clic en <strong>Cerrar Caja</strong>. El sistema muestra el resumen con el saldo calculado vs el saldo real contado.</li>
        </ol>
        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Si el administrador configura "Cierre de caja obligatorio", no podrás emitir comprobantes al día siguiente sin cerrar la caja del día anterior.
        </div>
      </div>
    ),
  },
  {
    id: 'buzon-sri',
    icono: '📥',
    titulo: 'Buzón SRI — Importar facturas de compra',
    contenido: (
      <div className="ayuda-contenido">
        <p>El <strong>Buzón SRI</strong> te permite descargar y registrar automáticamente las facturas electrónicas que tus proveedores te han enviado al SRI.</p>

        <h4>¿Qué es el Buzón SRI?</h4>
        <p>Es el repositorio oficial del SRI donde se almacenan todos los comprobantes electrónicos emitidos a tu RUC (facturas, liquidaciones de compra, notas de crédito de proveedores, etc.).</p>

        <h4>Cómo importar desde el Buzón SRI</h4>
        <ol>
          <li>Ve a <strong>Compras → Buzón SRI</strong>.</li>
          <li>Selecciona el rango de fechas que deseas importar.</li>
          <li>Haz clic en <strong>Descargar del SRI</strong>. El sistema consulta el servicio web del SRI con tus credenciales.</li>
          <li>Revisa los comprobantes encontrados. Los nuevos aparecerán marcados como <em>Pendientes</em>.</li>
          <li>Haz clic en <strong>Importar seleccionados</strong> para registrarlos como compras en el sistema.</li>
        </ol>

        <h4>Opciones al importar</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Opción</th><th>Qué hace</th></tr></thead>
          <tbody>
            <tr><td>Registrar inventario</td><td>Crea entradas de inventario para cada producto inventariable de la factura</td></tr>
            <tr><td>Registrar en caja</td><td>Crea un egreso en la Caja Diaria abierta por el total de la compra</td></tr>
            <tr><td>Crear productos nuevos</td><td>Si un código de producto no existe, lo crea automáticamente en el catálogo</td></tr>
          </tbody>
        </table>

        <h4>Importación en lotes</h4>
        <p>Si tienes muchos comprobantes pendientes, el sistema los procesa en <strong>lotes automáticos</strong> para evitar tiempos de espera excesivos. Verás una barra de progreso durante el procesamiento.</p>

        <h4>Comprobantes duplicados</h4>
        <p>El sistema verifica la <strong>clave de acceso</strong> de cada comprobante antes de importar. Si ya fue registrado anteriormente, lo omitirá automáticamente para evitar duplicados.</p>

        <h4>Qué se importa además de facturas</h4>
        <p>El Buzón detecta el tipo de documento por su clave de acceso y lo registra en el módulo correcto: <strong>facturas y liquidaciones de compra</strong> → Compras, <strong>notas de crédito/débito recibidas</strong> y <strong>retenciones recibidas de tus clientes</strong> → visibles en la pestaña <strong>"Historial"</strong> del Buzón. Las facturas de compra generan además su <strong>asiento contable automático</strong>.</p>

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Para usar el Buzón SRI necesitas tener configuradas tus <strong>credenciales SRI</strong> en <em>Configuración → SRI</em> (RUC y clave del portal contribuyente).
        </div>

        <h4>Importar desde archivo XML o ZIP</h4>
        <p>También puedes cargar comprobantes manualmente con las pestañas <strong>"Importar XML"</strong> (varios archivos sueltos) o <strong>"Importar ZIP"</strong> (un comprimido con varios XML). Útil si el proveedor te envió los archivos por correo, o si el documento es demasiado antiguo para la vía automática (ver nota abajo).</p>

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ <strong>Documentos de más de un año:</strong> las pestañas <strong>"Importar TXT"</strong> y <strong>"Por claves de acceso"</strong> consultan el servicio en línea del SRI, que solo tiene disponibles los comprobantes <strong>recientes</strong>. Si necesitas cargar facturas antiguas (por ejemplo, para corregir contabilidad de años anteriores), descarga los XML directamente desde <strong>srienlinea.sri.gob.ec</strong> y usa <strong>"Importar XML"</strong> o <strong>"Importar ZIP"</strong> — esa vía no depende de la fecha porque no vuelve a consultar al SRI.
        </div>
      </div>
    ),
  },
  {
    id: 'facturas-historicas',
    icono: '🗂️',
    titulo: 'Importar facturas históricas (contabilidad atrasada)',
    contenido: (
      <div className="ayuda-contenido">
        <p>Si necesitas cargar facturas de <strong>ventas de años anteriores</strong> (por ejemplo, para poner al día la contabilidad de un cliente nuevo), usa este módulo en vez de emitir facturas una por una.</p>

        <h4>Cómo importar</h4>
        <ol>
          <li>Ve a <strong>Ventas → Importar históricas</strong>.</li>
          <li>Descarga la <strong>plantilla Excel</strong> desde el asistente.</li>
          <li>Llena una fila por factura: fecha, tipo y número de identificación del cliente, razón social, subtotales, IVA, y opcionalmente <em>número de autorización</em> o <em>número de factura</em> originales.</li>
          <li>Sube el archivo. El sistema muestra una <strong>vista previa</strong> con las filas válidas y los errores resaltados antes de importar nada.</li>
          <li>Confirma la importación.</li>
        </ol>

        <h4>Estados asignados automáticamente</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Estado</th><th>Cuándo se asigna</th></tr></thead>
          <tbody>
            <tr><td><strong>Autorizado</strong></td><td>Si la fila trae un número de autorización del SRI (49 dígitos)</td></tr>
            <tr><td><strong>Histórico</strong></td><td>Si no trae autorización — factura solo para registro contable, nunca se envía al SRI</td></tr>
          </tbody>
        </table>

        <div className="ayuda-nota">
          💡 Las facturas con estado <strong>Histórico</strong> aparecen con un badge azul en el listado de facturas, y sí se incluyen en las Declaraciones (F104).
        </div>
      </div>
    ),
  },
  {
    id: 'inventario',
    icono: '📦',
    titulo: 'Inventario — Control de stock',
    contenido: (
      <div className="ayuda-contenido">
        <p>El módulo de inventario lleva el <strong>control de entradas y salidas de stock</strong> de tus productos. Solo aplica a productos marcados como <em>Inventariables</em>.</p>

        <h4>¿Cómo se actualiza el inventario?</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Acción</th><th>Efecto en inventario</th></tr></thead>
          <tbody>
            <tr><td>Compra con "Registrar inventario" activo</td><td>Entrada: suma cantidad comprada al stock</td></tr>
            <tr><td>Registrar en inventario (compra existente)</td><td>Entrada manual desde el detalle de la compra</td></tr>
            <tr><td>Venta (factura o nota de venta)</td><td>Salida: resta cantidad vendida del stock</td></tr>
            <tr><td>POS</td><td>Salida automática al procesar el cobro</td></tr>
            <tr><td>Anular compra</td><td>Revierte las entradas de inventario asociadas</td></tr>
          </tbody>
        </table>

        <h4>Registrar inventario en una compra existente</h4>
        <ol>
          <li>Abre el <strong>Detalle de la compra</strong> que no tiene inventario registrado.</li>
          <li>Haz clic en <strong>📦 Registrar en inventario</strong> (visible cuando la compra no tiene movimientos).</li>
          <li>Opcionalmente selecciona un <strong>margen de utilidad</strong> para calcular el PVP de cada producto automáticamente.</li>
          <li>Confirma. El sistema creará las entradas de stock y actualizará el PVP si seleccionaste un margen.</li>
        </ol>

        <h4>Productos inventariables</h4>
        <p>Para que un producto participe en el control de stock, debe estar marcado como <strong>Inventariable</strong> en el catálogo de productos. Ve a <em>Productos → editar producto → activar "Es inventariable"</em>.</p>

        <h4>Stock mínimo y alertas</h4>
        <p>Puedes configurar un <strong>stock mínimo</strong> por producto. Cuando el stock caiga por debajo de ese umbral, el producto aparecerá resaltado en los reportes de inventario.</p>

        <div className="ayuda-nota">
          💡 El historial completo de movimientos (quién hizo qué, cuándo y por qué referencia) está disponible en <strong>Inventario → Movimientos</strong>.
        </div>
      </div>
    ),
  },
  {
    id: 'utilidades',
    icono: '📊',
    titulo: 'Tabla de Utilidades — Márgenes de ganancia',
    contenido: (
      <div className="ayuda-contenido">
        <p>La <strong>Tabla de Utilidades</strong> define los márgenes de ganancia que usas para calcular el Precio de Venta al Público (PVP) de tus productos a partir del costo de compra.</p>

        <h4>Fórmula</h4>
        <div style={{ background: '#f1f5f9', borderRadius: '.5rem', padding: '.6rem 1rem', fontFamily: 'monospace', marginBottom: '.75rem' }}>
          PVP = Costo × (1 + % Utilidad ÷ 100)
        </div>
        <p>Ejemplo: Si el costo es <strong>$80</strong> y tu margen es <strong>25%</strong>, el PVP será <strong>$100</strong>.</p>

        <h4>Dónde configurarla</h4>
        <p>Ve a <strong>Configuración → Tabla de Utilidades</strong>. Desde allí puedes crear, editar y eliminar márgenes. Puedes tener múltiples márgenes para distintas categorías de productos.</p>

        <h4>Cómo se usa al importar compras</h4>
        <ol>
          <li>Importa o registra una factura de compra.</li>
          <li>En el <strong>Detalle de la compra</strong>, haz clic en <strong>📦 Registrar en inventario</strong>.</li>
          <li>En el modal, selecciona el margen de utilidad que aplica.</li>
          <li>El sistema calculará el PVP de cada producto y lo actualizará en el catálogo.</li>
        </ol>

        <table className="ayuda-tabla">
          <thead><tr><th>Margen</th><th>Costo</th><th>PVP resultante</th></tr></thead>
          <tbody>
            <tr><td>10%</td><td>$100</td><td>$110.00</td></tr>
            <tr><td>25%</td><td>$100</td><td>$125.00</td></tr>
            <tr><td>50%</td><td>$100</td><td>$150.00</td></tr>
            <tr><td>100%</td><td>$100</td><td>$200.00</td></tr>
          </tbody>
        </table>

        <div className="ayuda-nota">
          💡 Puedes crear márgenes por categoría: <em>General (30%), Electrónica (20%), Alimentos (15%)</em>, etc. Selecciona el más adecuado al importar cada compra.
        </div>
      </div>
    ),
  },
  {
    id: 'plan-cuentas',
    icono: '📑',
    titulo: 'Plan de Cuentas — instalación e importación',
    contenido: (
      <div className="ayuda-contenido">
        <p>El Plan de Cuentas es la base de toda la contabilidad: cada asiento automático (facturas, compras, costo de ventas) necesita cuentas ya creadas para poder registrarse.</p>

        <h4>Si tu plan de cuentas está vacío</h4>
        <p>Ve a <strong>Contabilidad → Plan de Cuentas</strong>. El sistema detecta que no tienes cuentas y te ofrece dos opciones:</p>
        <ul>
          <li><strong>Plan AELA base</strong> — catálogo estándar simplificado, listo para empezar rápido.</li>
          <li><strong>Plan NIIF Supercias</strong> — las 308 cuentas del Catálogo Único de Cuentas oficial de la Superintendencia de Compañías del Ecuador, para empresas que deben reportar bajo NIIF.</li>
        </ul>

        <h4>Importar tu propio plan desde Excel</h4>
        <ol>
          <li>En la tarjeta <strong>"Importar plan de cuentas desde Excel"</strong>, descarga la plantilla o arrastra tu propio archivo.</li>
          <li>El sistema detecta automáticamente la fila de encabezados aunque tu archivo tenga un título arriba, y reconoce formatos de otros sistemas contables (columnas como <code>Cod</code>, <code>Parent</code>, <code>Esdetalle</code>) convirtiéndolos al formato de AELA.</li>
          <li>Revisa la vista previa: filas válidas vs. con error. Si todas fallan, el sistema te muestra qué columnas detectó en tu archivo para que compares con las esperadas.</li>
          <li>Confirma la importación.</li>
        </ol>

        <h4>Reemplazar el plan completo</h4>
        <p>Si tu plan de cuentas ya tiene cuentas pero sin movimientos contables aún, puedes <strong>reemplazarlo por completo</strong> al importar (marca la opción correspondiente): el sistema elimina las cuentas que no estén en tu Excel, respetando las que ya tienen movimientos (esas nunca se eliminan, quedan reportadas aparte).</p>

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Si tu empresa ya tiene asientos contables registrados, el sistema restringe el reemplazo completo — solo permite agregar cuentas nuevas o eliminar cuentas sin movimientos, para no romper la contabilidad ya generada.
        </div>
      </div>
    ),
  },
  {
    id: 'config-contable',
    icono: '⚙️',
    titulo: 'Configuración contable — a qué cuenta se contabilizan compras y ventas',
    contenido: (
      <div className="ayuda-contenido">
        <p>Por defecto, el sistema contabiliza automáticamente cada compra y el costo de cada venta en cuentas genéricas predefinidas. Si tu contador prefiere usar cuentas propias del Plan de Cuentas de la empresa, puede configurarlas.</p>

        <h4>Cómo configurarlo</h4>
        <ol>
          <li>Ve a <strong>Contabilidad → Plan de Cuentas</strong>.</li>
          <li>Primero crea (si no existe) la cuenta que quieres usar — por ejemplo, una cuenta de gasto específica como <em>"Gastos de Oficina"</em>.</li>
          <li>En la tarjeta <strong>"Configuración de asientos automáticos — Compras y Ventas"</strong>, selecciona esa cuenta en el campo correspondiente.</li>
          <li>Guarda. Desde ese momento, todas las compras (manuales y las importadas por el Buzón SRI) y el costo de las ventas se contabilizan en las cuentas que elegiste.</li>
        </ol>

        <h4>Qué se puede configurar</h4>
        <table className="ayuda-tabla">
          <thead><tr><th>Campo</th><th>Se usa para</th></tr></thead>
          <tbody>
            <tr><td>Gasto por compra</td><td>Ítems de compra no inventariables (servicios, suministros, etc.)</td></tr>
            <tr><td>Inventario</td><td>Ítems de compra inventariables, y la salida por costo de venta</td></tr>
            <tr><td>IVA crédito tributario compras</td><td>El IVA pagado en las compras</td></tr>
            <tr><td>Cuentas por pagar proveedores</td><td>Contrapartida cuando la compra queda pendiente de pago</td></tr>
            <tr><td>Caja/Bancos</td><td>Contrapartida cuando la compra se paga de contado</td></tr>
            <tr><td>Costo de ventas</td><td>El costo de la mercadería vendida en cada factura</td></tr>
          </tbody>
        </table>

        <div className="ayuda-nota">
          💡 Si dejas un campo sin elegir, el sistema sigue usando la cuenta genérica de siempre — no necesitas configurar todo de una vez.
        </div>
      </div>
    ),
  },
  {
    id: 'bancos',
    icono: '🏦',
    titulo: 'Bancos — cuentas bancarias, movimientos y cheques',
    contenido: (
      <div className="ayuda-contenido">
        <p>El módulo de Bancos (disponible en planes Medium y Pro) lleva el registro de tus cuentas bancarias, sus movimientos y los cheques emitidos.</p>

        <h4>Crear una cuenta bancaria</h4>
        <ol>
          <li>Ve a <strong>Contabilidad → Bancos → + Nueva Cuenta</strong>.</li>
          <li>Completa nombre descriptivo, institución bancaria, tipo (Corriente/Ahorros), número de cuenta y saldo inicial.</li>
          <li><strong>Vincula la cuenta contable:</strong> selecciona en el campo "Cuenta contable" la cuenta de tu Plan de Cuentas que representa este banco (debe estar creada primero en Contabilidad → Plan de Cuentas, tipo Activo).</li>
        </ol>

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Si no vinculas la cuenta contable, la tarjeta de la cuenta bancaria muestra una advertencia "Sin cuenta contable vinculada". Puedes editarla en cualquier momento para agregarla.
        </div>

        <h4>Movimientos y cheques</h4>
        <ul>
          <li><strong>Movimientos / Libro Mayor:</strong> registra depósitos, retiros, transferencias, notas de débito/crédito bancarias. Muestra el saldo acumulado.</li>
          <li><strong>Cheques:</strong> emite cheques asociados a un proveedor, con seguimiento de estado (Pendiente, Cobrado, Anulado, Protestado).</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'cxc-cxp',
    icono: '💳',
    titulo: 'Cuentas por Cobrar y por Pagar',
    contenido: (
      <div className="ayuda-contenido">
        <p>Llevan el control de qué facturas de venta y compras aún no se han cobrado/pagado, y de los abonos parciales o totales que vas registrando.</p>

        <h4>¿Se alimenta solo, o hay que crear algo?</h4>
        <p>La pestaña <strong>"Vigentes"</strong> se alimenta automáticamente: cualquier factura de venta autorizada (o compra no anulada) con saldo pendiente aparece ahí sola, sin que tengas que crear nada manualmente. El saldo se calcula al vuelo: <em>total de la factura/compra − suma de cobros/pagos registrados</em>.</p>
        <p>Lo único que registras manualmente es el <strong>momento en que efectivamente te pagan (o pagas)</strong>:</p>
        <ol>
          <li>Ve a <strong>Contabilidad → Cuentas por Cobrar</strong> (o <strong>Cuentas por Pagar</strong>).</li>
          <li>En la pestaña <strong>Vigentes</strong>, busca la factura/compra y haz clic en <strong>Registrar cobro</strong> (o <strong>Registrar pago</strong>).</li>
          <li>Ingresa el monto (puede ser parcial), fecha, método de pago y banco si aplica.</li>
          <li>Al guardar, el sistema genera el asiento contable automáticamente y recalcula el saldo. Si queda en $0, la factura pasa a la pestaña <strong>Canceladas</strong>.</li>
        </ol>
        <p>Si te equivocaste al registrar un cobro/pago, ve a <strong>Historial</strong> y usa <strong>Anular</strong> — la factura vuelve a Vigentes con su saldo correcto y se genera el asiento de reverso.</p>

        <h4>Recibo de cobro imprimible</h4>
        <p>Al registrar un cobro en Cuentas por Cobrar, el recibo en PDF se abre automáticamente en una pestaña nueva. También puedes volver a generarlo cuando quieras con el botón <strong>"🧾 Recibo"</strong> en cada fila de <strong>Historial de cobros</strong> — incluye los datos de tu empresa, el cliente, la factura, la forma de pago y el saldo pendiente actualizado.</p>

        <h4>Cheques recibidos y tarjetas de crédito</h4>
        <p>Dentro de Cuentas por Cobrar hay una pestaña <strong>Cheques</strong> para darle seguimiento a cheques de clientes (número, banco, estado: Pendiente/Depositado/Protestado/Anulado). Dentro de Cuentas por Pagar hay una pestaña <strong>Tarjetas de crédito</strong> para registrar cargos y pagos de las tarjetas corporativas, con su propio libro de movimientos.</p>

        <h4>Reportes</h4>
        <p>La pestaña <strong>Reportes</strong> incluye <strong>antigüedad de saldos</strong> (0-30, 31-60, 61-90, 91+ días) y <strong>estado de cuenta</strong> por cliente/proveedor.</p>

        <div className="ayuda-nota">
          💡 Disponible en planes Medium y Pro. Requiere el permiso <code>cxc.ver</code>/<code>cxc.gestionar</code> (o <code>cxp.*</code>) asignado a tu rol o como permiso adicional.
        </div>
      </div>
    ),
  },
  {
    id: 'caja-chica',
    icono: '🪙',
    titulo: 'Caja Chica',
    contenido: (
      <div className="ayuda-contenido">
        <p>Distinta de la <strong>Caja Diaria</strong> (que registra las ventas del POS): la Caja Chica es un fondo fijo para gastos menores de oficina (papelería, taxis, cafetería, etc.), con su propio ciclo de reposición.</p>
        <h4>Flujo</h4>
        <ol>
          <li>Crea la caja chica con un <strong>monto fijo inicial</strong> (ej. $100) y su cuenta contable asociada.</li>
          <li>Registra <strong>vales de gasto</strong> a medida que se usa el efectivo, cada uno con su comprobante de respaldo.</li>
          <li>Cuando el efectivo disponible baja, haz una <strong>reposición</strong>: el sistema calcula cuánto hay que reponer para volver al monto fijo, y genera el asiento contable de todos los gastos acumulados desde la última reposición.</li>
          <li>Si necesitas aumentar o disminuir el fondo fijo permanentemente, usa <strong>Incrementar</strong>/<strong>Disminuir</strong> en vez de una reposición normal.</li>
          <li>Al cerrar definitivamente una caja chica, usa <strong>Liquidar</strong>.</li>
        </ol>
        <div className="ayuda-nota">
          💡 Cada vale de gasto se contabiliza individualmente al momento de la reposición — no antes — para reflejar el gasto real solo cuando se confirma.
        </div>
      </div>
    ),
  },
  {
    id: 'retenciones-recibidas',
    icono: '📄',
    titulo: 'Retenciones Recibidas — comprobantes que te emiten tus clientes',
    contenido: (
      <div className="ayuda-contenido">
        <p>Cuando un cliente que es <strong>agente de retención</strong> (contribuyente especial, entidad pública, sociedad obligada a llevar contabilidad, etc.) te paga una factura, está obligado a retenerte un porcentaje de Renta y/o IVA y entregarte un <strong>comprobante de retención</strong> en vez de pagarte ese monto en efectivo — porque ese dinero lo remite él directamente al SRI a tu nombre.</p>

        <h4>Cómo llegan al sistema</h4>
        <p>No se crean manualmente: se importan automáticamente junto con el resto de documentos desde <strong>Compras → Buzón SRI</strong> (el Buzón detecta que es un comprobante tipo 07 dirigido a tu RUC y lo guarda aquí). Revísalas en <strong>Tributario → Retenciones recibidas</strong>.</p>

        <h4>¿Para qué sirven además de tenerlas archivadas?</h4>
        <p>El monto de <strong>IVA</strong> retenido en estos comprobantes es un <strong>crédito a tu favor</strong> que reduce el IVA que debes pagar en tu declaración mensual (Formulario 104) — ver la sección <strong>"Declaraciones Tributarias"</strong> más abajo. El monto de <strong>Renta</strong> retenido es un anticipo de tu Impuesto a la Renta anual.</p>

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ No confundir con <strong>Retenciones (emitidas)</strong> en el menú Compras: esas son las que TÚ le retienes a TUS proveedores, y se declaran aparte en el Formulario 103 — no reducen tu propio IVA a pagar.
        </div>

        <h4>Si ves montos en $0.00</h4>
        <p>Los comprobantes de retención del SRI existen en dos formatos (schema v1.0.0 y v2.0.0) según el sistema que use cada agente de retención. Si importaste comprobantes antes del 12 de julio de 2026 y aparecen en $0.00, usa el botón <strong>"🔄 Recalcular totales"</strong> en la parte superior de la pantalla — vuelve a leer el XML ya guardado de cada uno y corrige los montos y la fecha sin necesidad de volver a descargarlos del Buzón SRI.</p>
      </div>
    ),
  },
  {
    id: 'declaraciones',
    icono: '🧮',
    titulo: 'Declaraciones Tributarias — F104, F103, F101',
    contenido: (
      <div className="ayuda-contenido">
        <p>En <strong>Tributario → Declaraciones</strong> el sistema arma, por período, un resumen de los datos que necesitas para llenar los formularios del SRI. <strong>No reemplaza el DIMM</strong> ni presenta la declaración — es una ayuda para no tener que sumar todo manualmente.</p>

        <h4>F104 — IVA Mensual</h4>
        <p>La lógica es: <code>IVA a pagar = IVA cobrado en ventas − IVA crédito fiscal en compras − IVA que tus clientes te retuvieron − crédito tributario arrastrado del mes anterior</code>.</p>
        <ul>
          <li><strong>IVA cobrado en ventas:</strong> suma del IVA de tus facturas del mes (netas de notas de crédito).</li>
          <li><strong>IVA crédito fiscal:</strong> suma del IVA de tus compras y liquidaciones de compra del mes. Solo cuentan las compras facturadas a tu <strong>RUC</strong> — si una compra llegó dirigida a una cédula personal, no es deducible y el sistema la excluye automáticamente (te avisa cuántas excluyó).</li>
          <li><strong>IVA retenido por clientes:</strong> viene de <strong>Retenciones Recibidas</strong> (ver arriba) — solo cuenta lo que TUS clientes te retuvieron, no lo que tú le retienes a tus proveedores.</li>
          <li><strong>Crédito tributario arrastrado:</strong> el saldo a favor de tu última declaración real ante el SRI. Ingresa el monto en el campo "Crédito tributario arrastrado del mes anterior" y guárdalo — el sistema no lo calcula solo encadenando meses, porque el saldo oficial puede no coincidir (por ejemplo si empezaste a usar AELA a mitad de año).</li>
        </ul>
        <p>Si el resultado es positivo, es <strong>IVA a pagar</strong>. Si es negativo, es <strong>crédito tributario</strong> a tu favor para el siguiente mes.</p>

        <h4>F103 — Retenciones en la Fuente</h4>
        <p>Muestra los comprobantes de retención que <strong>tú emitiste</strong> a tus proveedores durante el período (menú <strong>Compras → Retenciones</strong>), agrupados por código de retención. Esto es dinero que retuviste al pagarles y que debes remitir al SRI — es una obligación separada del IVA que declaras en el F104.</p>
        <div className="ayuda-nota">
          💡 Si el F103 aparece en cero, revisa que sí tengas comprobantes de retención <strong>emitidos y autorizados</strong> en ese mes (menú Compras → Retenciones) — no confundir con Retenciones Recibidas, que no aparecen aquí.
        </div>

        <h4>F101 — Resumen IR Anual</h4>
        <p>Totales orientativos de ingresos y gastos del año para apoyar el llenado del Impuesto a la Renta anual. Consulta siempre con tu contador para la declaración oficial.</p>
      </div>
    ),
  },
  {
    id: 'config-referencias',
    icono: '🔗',
    titulo: 'Cuentas contables por referencia (retenciones, nómina, general)',
    contenido: (
      <div className="ayuda-contenido">
        <p>Permite decirle al sistema, código por código, a qué cuenta de tu Plan de Cuentas debe contabilizar cada tipo de retención SRI, cada concepto de nómina, o cuentas generales — en vez de usar siempre las cuentas genéricas por defecto.</p>
        <h4>Cómo usarlo</h4>
        <ol>
          <li>Ve a <strong>Contabilidad → Plan de Cuentas → Configuración de cuentas por referencia</strong>.</li>
          <li>Elige la pestaña: <strong>Compras</strong> (retenciones a proveedores), <strong>Ventas</strong> (retenciones recibidas), <strong>Empleados</strong> (nómina) o <strong>General</strong>.</li>
          <li>Para cada código de la lista (fija, viene del catálogo del SRI o de nómina), elige la cuenta contable que corresponda.</li>
          <li>Guarda. Desde ese momento, los asientos automáticos de retenciones y nómina usan la cuenta que configuraste para ese código específico.</li>
        </ol>
        <div className="ayuda-nota">
          💡 Es opcional código por código: si dejas uno sin configurar, ese código sigue usando la cuenta genérica de siempre.
        </div>
      </div>
    ),
  },
  {
    id: 'transportistas',
    icono: '🚚',
    titulo: 'Guías de remisión — Catálogo de transportistas',
    contenido: (
      <div className="ayuda-contenido">
        <p>Al emitir una guía de remisión, el campo de transportista tiene autocompletado: escribe el nombre y el sistema sugiere transportistas ya usados antes, completando RUC y placa automáticamente.</p>
        <p>No necesitas crear el catálogo por separado — cada vez que guardas una guía con un transportista nuevo, se agrega solo al catálogo para la próxima vez.</p>
      </div>
    ),
  },
  {
    id: 'acceso',
    icono: '🔗',
    titulo: 'Acceso al sistema y marcadores',
    contenido: (
      <div className="ayuda-contenido">
        <p>Para acceder siempre al sistema correcto desde cualquier dispositivo, guarda la URL de acceso como marcador en tu navegador.</p>
        <h4>¿Cuál URL guardar como marcador?</h4>
        <ul>
          <li>Si tu empresa está en la plataforma AELA con un slug (ej: mprq): <br/><code>https://aela.corpsimtelec.com/mprq</code></li>
          <li>Si tu empresa tiene dominio propio (marca blanca): <br/><code>https://erp.tudominio.com</code></li>
          <li>Si eres usuario de CorpSimtelec directamente: <br/><code>https://aela.corpsimtelec.com/login</code></li>
        </ul>
        <div className="ayuda-nota">
          💡 La URL con el slug siempre redirige automáticamente al login de TU empresa, incluso si cierras sesión o usas un dispositivo diferente.
        </div>
        <h4>Soporte CorpSimtelec</h4>
        <ul>
          <li>📱 WhatsApp: <strong>+593 097 889 3520</strong></li>
          <li>✉️ Email: <strong>soporte@corpsimtelec.com</strong></li>
          <li>🌐 Web: <strong>corpsimtelec.com</strong></li>
        </ul>
      </div>
    ),
  },
];

export default function AyudaSistema() {
  const { usuario } = useAuth();
  const [seccionAbierta, setSeccionAbierta] = useState('saas');

  const toggle = (id) => setSeccionAbierta((prev) => (prev === id ? null : id));

  return (
    <div className="ayuda-page">
      <div className="ayuda-header">
        <div className="ayuda-header-icon">❓</div>
        <div>
          <h1>Centro de Ayuda</h1>
          <p>Documentación y guías para el uso del sistema AELA ERP</p>
        </div>
      </div>

      <div className="ayuda-acordeon">
        {SECCIONES.map((s) => (
          <div key={s.id} className={`ayuda-item ${seccionAbierta === s.id ? 'abierto' : ''}`}>
            <button className="ayuda-item-header" onClick={() => toggle(s.id)}>
              <span className="ayuda-item-icono">{s.icono}</span>
              <span className="ayuda-item-titulo">{s.titulo}</span>
              <span className="ayuda-item-chevron">{seccionAbierta === s.id ? '▲' : '▼'}</span>
            </button>
            {seccionAbierta === s.id && (
              <div className="ayuda-item-body">{s.contenido}</div>
            )}
          </div>
        ))}
      </div>

      <div className="ayuda-footer">
        <p>¿No encontraste lo que buscas? Contacta al administrador del sistema.</p>
        {usuario?.email && <p>Tu correo: <strong>{usuario.email}</strong></p>}
      </div>
    </div>
  );
}
