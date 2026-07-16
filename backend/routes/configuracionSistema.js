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
const { enviarAlertaSoporte } = require('../utils/email');

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

// POST /api/configuracion-sistema/test-email — enviar email de prueba
router.post('/test-email', proteger, autorizarPermiso('sistema.configurar'), async (req, res) => {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    return res.status(400).json({
      success: false,
      mensaje: 'SMTP no configurado. Agrega las variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM en las variables de entorno del servidor.',
    });
  }

  const destino = req.usuario?.email || req.body?.email;
  if (!destino) {
    return res.status(400).json({ success: false, mensaje: 'No hay correo de destino. Tu usuario no tiene email registrado.' });
  }

  try {
    await enviarAlertaSoporte({
      asunto: 'Prueba de SMTP — AELA ERP',
      mensaje: `¡Configuración SMTP funcionando correctamente!\n\nEste es un correo de prueba enviado desde AELA ERP.\n\nServidor: ${smtpHost}\nDestinatario: ${destino}\nFecha: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`,
    });

    // También intentar enviar al usuario admin que lanzó la prueba
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host:   smtpHost,
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || 'AELA ERP <info@corpsimtelec.com>',
      to:      destino,
      subject: '✅ Prueba SMTP — AELA ERP',
      html:    `<p>¡La configuración SMTP de <strong>AELA ERP</strong> funciona correctamente!</p><p>Servidor: <code>${smtpHost}</code></p><p>${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}</p>`,
    });

    res.json({ success: true, mensaje: `Email de prueba enviado a ${destino}` });
  } catch (err) {
    console.error('[test-email]', err.message);
    res.status(500).json({
      success: false,
      mensaje: `Error SMTP: ${err.message}. Verifica host, puerto, usuario y contraseña.`,
    });
  }
});

module.exports = router;
