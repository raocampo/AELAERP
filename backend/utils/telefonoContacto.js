const MAX_TELEFONO_CONTACTO = 50;

// Conserva varios números, prefijos y extensiones; no corta datos de contacto.
function normalizarTelefonoContacto(valor, etiqueta = 'El teléfono') {
  if (valor === undefined || valor === null) return null;
  const texto = typeof valor === 'string' ? valor.trim() : null;
  if (texto === null || [...texto].length > MAX_TELEFONO_CONTACTO) {
    const error = new Error(`${etiqueta} debe ser texto de hasta ${MAX_TELEFONO_CONTACTO} caracteres. Puedes separar varios números con punto y coma.`);
    error.code = 'TELEFONO_CONTACTO_INVALIDO';
    throw error;
  }
  return texto || null;
}

module.exports = { MAX_TELEFONO_CONTACTO, normalizarTelefonoContacto };
