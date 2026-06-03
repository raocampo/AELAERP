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
    titulo: 'Crear nueva empresa (SaaS / Marca blanca)',
    contenido: (
      <div className="ayuda-contenido">
        <p>AELA ERP soporta <strong>múltiples empresas</strong> dentro de la misma plataforma. Cada empresa tiene sus propios datos, usuarios, facturas y configuraciones completamente aislados.</p>

        <h4>¿Cómo crear una nueva empresa?</h4>
        <ol>
          <li>Ve a <strong>Administración → Empresas</strong> (solo visible para administradores).</li>
          <li>Haz clic en <strong>+ Nueva Empresa</strong>.</li>
          <li>Completa los datos: <em>RUC, Razón Social, Nombre Comercial, Dirección, Plan.</em></li>
          <li>Activa <strong>Crear configuración SRI</strong> si la empresa necesita facturación electrónica.</li>
          <li>Guarda. El sistema creará automáticamente la estructura de datos para esa empresa.</li>
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

        <h4>Asignar usuarios a la empresa</h4>
        <ol>
          <li>En <strong>Administración → Empresas</strong>, expande la empresa creada.</li>
          <li>Usa el panel <strong>"Usuarios de esta empresa"</strong> para vincular usuarios existentes o crear nuevos.</li>
          <li>Asigna el rol que tendrá el usuario en esa empresa específica.</li>
        </ol>

        <div className="ayuda-nota">
          💡 <strong>Modo Mono-empresa:</strong> Si el sistema está configurado en modo <code>monoempresa</code>, solo habrá una empresa activa. Para activar multi-empresa, configura <code>VITE_MODO_EMPRESA=multiempresa</code> en el entorno de producción (Vercel).
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

        <div className="ayuda-nota ayuda-nota-warning">
          ⚠️ Para usar el Buzón SRI necesitas tener configuradas tus <strong>credenciales SRI</strong> en <em>Configuración → SRI</em> (RUC y clave del portal contribuyente).
        </div>

        <h4>Importar desde archivo XML</h4>
        <p>También puedes cargar comprobantes manualmente subiendo el archivo <strong>XML</strong> directamente (arrastra el archivo o usa el botón de carga). Útil si el proveedor te envió el XML por correo.</p>
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
