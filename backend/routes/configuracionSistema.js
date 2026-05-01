const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const {
  asegurarConfiguracionSistemaEmpresa,
  obtenerConfiguracionSistemaOperativa,
  construirPayloadConfiguracionSistema,
  limitesPlan,
} = require('../utils/configuracionSistema');

router.use(proteger);

const permitirConfigurarSistema = autorizarPermiso('sistema.configurar');

router.get('/', async (req, res) => {
  try {
    const config = await obtenerConfiguracionSistemaOperativa(req.empresa);
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('GET /configuracion-sistema:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar la configuración del sistema' });
  }
});

router.put('/', permitirConfigurarSistema, async (req, res) => {
  try {
    const actual = await asegurarConfiguracionSistemaEmpresa(req.empresa.id);
    const payload = construirPayloadConfiguracionSistema({
      ...req.empresa,
      ...actual,
    }, req.body || {});

    const actualizado = await prisma.$transaction(async (tx) => {
      if (payload.modoOperacion !== actual.modoOperacion) {
        await tx.configuracion_sistema.updateMany({
          data: { modoOperacion: payload.modoOperacion },
        });
      }

      const limites = limitesPlan(payload.tipoSistema);
      await tx.empresas.update({
        where: { id: req.empresa.id },
        data: {
          plan: payload.tipoSistema,
          factAnualesMax: limites.factAnualesMax,
          maxUsuarios:    limites.maxUsuarios,
        },
      });

      await tx.configuracion_sistema.update({
        where: { empresaId: req.empresa.id },
        data: payload,
      });

      return obtenerConfiguracionSistemaOperativa(req.empresa.id, tx);
    });

    res.json({ success: true, data: actualizado, mensaje: 'Configuración del sistema actualizada' });
  } catch (error) {
    console.error('PUT /configuracion-sistema:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar la configuración del sistema' });
  }
});

module.exports = router;
