// ====================================
// UTIL — Envío de Emails (nodemailer)
// Usado para emails de bienvenida, notificaciones, etc.
// ====================================

const nodemailer = require('nodemailer');

// ─── Crear transporter según configuración SMTP ───────────────────────────────
function crearTransporter() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ─── Template HTML de bienvenida ─────────────────────────────────────────────
function templateBienvenida({ nombreEmpresa, nombreContacto, urlAcceso, plan }) {
  const planLabel = plan === 'lite' ? 'Lite (Gratis)' : plan === 'medium' ? 'Medium' : 'Pro';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>¡Bienvenido a AELA ERP!</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#7C3AED,#6d28d9);padding:40px 40px 32px;text-align:center;">
            <svg width="48" height="48" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:12px">
              <rect width="28" height="28" rx="7" fill="rgba(255,255,255,.15)"/>
              <path d="M14 5 L22 23 M14 5 L6 23 M9 17 H19" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>
            <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800;letter-spacing:-.5px">AELA ERP</h1>
            <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:14px">by CorpSimtelec</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h2 style="color:#1e293b;margin:0 0 8px;font-size:22px">¡Bienvenido, ${nombreContacto}! 🎉</h2>
            <p style="color:#475569;margin:0 0 24px;font-size:15px;line-height:1.6">
              Tu sistema <strong>${nombreEmpresa}</strong> ya está activo y listo para usar.<br/>
              Plan contratado: <strong>${planLabel}</strong>.
            </p>

            <!-- Acceso -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-radius:12px;padding:20px;margin-bottom:28px;">
              <tr>
                <td>
                  <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8">Tu URL de acceso</p>
                  <p style="margin:0;font-size:15px;color:#7C3AED;font-weight:600;word-break:break-all">${urlAcceso}</p>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <div style="text-align:center;margin-bottom:32px;">
              <a href="${urlAcceso}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 36px;border-radius:10px;font-weight:700;font-size:16px;letter-spacing:-.2px">
                Acceder a mi sistema →
              </a>
            </div>

            <!-- Pasos -->
            <p style="color:#1e293b;font-weight:700;margin:0 0 12px;font-size:15px">Primeros pasos:</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:6px 0;color:#475569;font-size:14px">✅ &nbsp;Completa los datos de tu empresa</td></tr>
              <tr><td style="padding:6px 0;color:#475569;font-size:14px">✅ &nbsp;Configura los datos del emisor para el SRI</td></tr>
              <tr><td style="padding:6px 0;color:#475569;font-size:14px">✅ &nbsp;Carga tu catálogo de productos</td></tr>
              <tr><td style="padding:6px 0;color:#475569;font-size:14px">✅ &nbsp;Emite tu primera factura electrónica</td></tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
            <p style="color:#94a3b8;font-size:13px;margin:0 0 8px">
              ¿Necesitas ayuda? Estamos disponibles <strong>24/7</strong>.
            </p>
            <p style="margin:0;font-size:13px">
              <a href="https://wa.me/5930978893520" style="color:#16a34a;font-weight:600;text-decoration:none">WhatsApp</a>
              &nbsp;·&nbsp;
              <a href="mailto:info@corpsimtelec.com" style="color:#7C3AED;font-weight:600;text-decoration:none">info@corpsimtelec.com</a>
            </p>
            <p style="color:#cbd5e1;font-size:12px;margin:16px 0 0">
              AELA ERP © ${new Date().getFullYear()} CorpSimtelec · Ecuador
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Enviar email de bienvenida tras provisioning ────────────────────────────
/**
 * @param {object} tenant  - Objeto tenant de la BD master
 * @param {string} email   - Correo del contacto
 */
async function enviarEmailBienvenida(tenant, email) {
  const transporter = crearTransporter();
  if (!transporter) {
    console.warn('[email] SMTP no configurado — no se envió email de bienvenida');
    return;
  }

  const appBase   = process.env.APP_BASE_URL || 'https://aela.corpsimtelec.com';
  const urlAcceso = `${appBase}/${tenant.slug}`;

  const html = templateBienvenida({
    nombreEmpresa:  tenant.nombreContacto || tenant.slug,
    nombreContacto: tenant.nombreContacto || 'Administrador',
    urlAcceso,
    plan: tenant.plan,
  });

  try {
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || 'AELA ERP <info@corpsimtelec.com>',
      to:      email,
      subject: `¡Tu sistema AELA ERP está listo! — ${tenant.nombreContacto || tenant.slug}`,
      html,
    });
    console.log(`[email] Bienvenida enviada a ${email}`);
  } catch (err) {
    console.error(`[email] Error enviando bienvenida a ${email}:`, err.message);
    // No lanzar — el provisioning ya fue exitoso, el email es opcional
  }
}

// ─── Enviar alerta interna al equipo de soporte ───────────────────────────────
async function enviarAlertaSoporte({ asunto, mensaje }) {
  const transporter = crearTransporter();
  if (!transporter) return;

  const destino = process.env.SMTP_SOPORTE || 'info@corpsimtelec.com';
  try {
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || 'AELA ERP <info@corpsimtelec.com>',
      to:      destino,
      subject: `[AELA ERP] ${asunto}`,
      text:    mensaje,
    });
  } catch (err) {
    console.error('[email] Error enviando alerta soporte:', err.message);
  }
}

module.exports = { enviarEmailBienvenida, enviarAlertaSoporte };
