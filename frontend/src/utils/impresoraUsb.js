// ============================================================
// AELA — Impresión térmica ESC/POS directa por USB (WebUSB)
//
// El backend corre en la nube (Railway) y no tiene forma de alcanzar un
// puerto USB del equipo del cliente — solo el navegador puede hacerlo.
// WebUSB solo existe en Chrome/Edge/Opera (escritorio Y Android); Safari y
// Firefox nunca lo van a soportar (decisión de esos navegadores). Requiere
// HTTPS (o localhost) y que el usuario autorice el dispositivo una vez —
// el permiso queda guardado por el navegador para ese sitio, así que
// `reconectarImpresoraUSB()` no vuelve a preguntar en cargas futuras.
//
// Nota para el despliegue en Windows: algunas impresoras ESC/POS quedan
// con el driver genérico de Windows ya asociado a la interfaz USB, lo que
// puede bloquear `claimInterface()`. Si eso pasa, hay que reasignar el
// driver de esa interfaz a WinUSB (ej. con Zadig) para que el navegador
// pueda tomarla — es una limitación conocida de WebUSB en Windows, no un
// bug de esta implementación.
// ============================================================

let dispositivo = null;
let endpointSalida = null;

export function usbDisponible() {
  return typeof navigator !== 'undefined' && Boolean(navigator.usb);
}

async function prepararDispositivo(device) {
  await device.open();
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  const interfaz = device.configuration.interfaces.find((iface) =>
    iface.alternates.some((alt) => alt.endpoints.some((e) => e.direction === 'out'))
  );
  if (!interfaz) {
    throw new Error('El dispositivo USB seleccionado no tiene una salida de datos — ¿es realmente una impresora?');
  }

  await device.claimInterface(interfaz.interfaceNumber);
  const alternate = interfaz.alternates.find((alt) => alt.endpoints.some((e) => e.direction === 'out'));
  const endpointOut = alternate.endpoints.find((e) => e.direction === 'out');

  dispositivo = device;
  endpointSalida = endpointOut.endpointNumber;
  return { nombre: device.productName || 'Impresora USB', fabricante: device.manufacturerName || '' };
}

/** Pide al usuario elegir un dispositivo USB (diálogo nativo del navegador) y lo prepara para imprimir. */
export async function conectarImpresoraUSB() {
  if (!usbDisponible()) {
    throw new Error('Este navegador no soporta impresión USB (WebUSB). Usa Chrome, Edge u Opera.');
  }
  const device = await navigator.usb.requestDevice({ filters: [] });
  return prepararDispositivo(device);
}

/** Reconecta a un dispositivo ya autorizado antes, sin volver a preguntar. Devuelve null si no hay ninguno. */
export async function reconectarImpresoraUSB() {
  if (!usbDisponible()) return null;
  const dispositivos = await navigator.usb.getDevices();
  if (dispositivos.length === 0) return null;
  return prepararDispositivo(dispositivos[0]);
}

/** Envía un buffer ESC/POS (ArrayBuffer) a la impresora USB ya conectada. */
export async function enviarBufferUSB(arrayBuffer) {
  if (!dispositivo) {
    const reconectado = await reconectarImpresoraUSB();
    if (!reconectado) {
      throw new Error('No hay ninguna impresora USB conectada. Ve a Configuración del Sistema → Impresión y conéctala.');
    }
  }

  const datos = arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : arrayBuffer;
  const resultado = await dispositivo.transferOut(endpointSalida, datos);
  if (resultado.status !== 'ok') {
    throw new Error(`La impresora USB no confirmó la impresión (estado: ${resultado.status})`);
  }
}
