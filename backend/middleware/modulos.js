const { obtenerConfiguracionSistemaOperativa } = require('../utils/configuracionSistema');

const MENSAJES = {
  facturacionHabilitada: 'El modulo de facturacion esta deshabilitado en la configuracion del sistema',
  comprasHabilitadas: 'El modulo de compras esta deshabilitado en la configuracion del sistema',
  contabilidadHabilitada: 'El modulo de contabilidad esta deshabilitado en la configuracion del sistema',
  retencionesHabilitadas: 'El modulo de retenciones esta deshabilitado en la configuracion del sistema',
  liquidacionesHabilitadas: 'El modulo de liquidaciones esta deshabilitado en la configuracion del sistema',
  atsHabilitado: 'El modulo de ATS esta deshabilitado en la configuracion del sistema',
  buzonSriHabilitado: 'El modulo de Buzon SRI esta deshabilitado en la configuracion del sistema',
  tributarioHabilitado: 'El modulo Tributario esta deshabilitado en la configuracion del sistema',
  bancosHabilitado: 'El modulo de Bancos esta deshabilitado en la configuracion del sistema',
};

const requiereModulo = (campo, mensajePersonalizado = null) => async (req, res, next) => {
  try {
    const empresaId = req.empresa?.id || 1;
    const config = await obtenerConfiguracionSistemaOperativa(empresaId);
    if (!config?.[campo]) {
      return res.status(403).json({
        success: false,
        mensaje: mensajePersonalizado || MENSAJES[campo] || 'El modulo solicitado esta deshabilitado',
      });
    }
    req.configuracionSistema = config;
    next();
  } catch (error) {
    console.error(`requiereModulo(${campo}):`, error);
    res.status(500).json({
      success: false,
      mensaje: 'No se pudo validar la configuracion del sistema',
    });
  }
};

module.exports = {
  requiereModulo,
};
