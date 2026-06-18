// ====================================
// UTIL — Envío de Emails (nodemailer)
// Usado para emails de bienvenida, notificaciones, etc.
// ====================================

const nodemailer = require('nodemailer');
const fs         = require('fs');

// ─── Primario: Resend HTTP API (evita bloqueo de puertos SMTP en Railway) ─────
// Usa fetch nativo de Node.js 18+. No requiere paquete adicional.
async function enviarViaResendAPI(mailOptions) {
  const apiKey = process.env.SMTP_PASS;
  if (!apiKey || !String(apiKey).startsWith('re_')) return null; // no es API key Resend

  const body = {
    from:    mailOptions.from,
    to:      Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
    subject: mailOptions.subject,
    ...(mailOptions.html && { html: mailOptions.html }),
    ...(mailOptions.text && { text: mailOptions.text }),
  };

  if (mailOptions.attachments?.length > 0) {
    body.attachments = mailOptions.attachments
      .filter(a => a.path && fs.existsSync(a.path))
      .map(a => ({
        filename: a.filename,
        content:  fs.readFileSync(a.path).toString('base64'),
      }));
  }

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend API ${res.status}: ${err.message || res.statusText}`);
  }
  return await res.json();
}

// ─── Backup: Gmail SMTP (nodemailer) ─────────────────────────────────────────
function crearTransporterGmail() {
  const host = process.env.SMTP_HOST_BACKUP;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port:   parseInt(process.env.SMTP_PORT_BACKUP || '587', 10),
    secure: process.env.SMTP_SECURE_BACKUP === 'true',
    auth: {
      user: process.env.SMTP_USER_BACKUP,
      pass: process.env.SMTP_PASS_BACKUP,
    },
  });
}

// Intenta Resend API primero; si falla usa Gmail SMTP como backup.
async function enviarConFallback(mailOptions) {
  try {
    const result = await enviarViaResendAPI(mailOptions);
    if (result) return result;
  } catch (err) {
    console.warn('[email] Fallo Resend API, intentando Gmail backup:', err.message);
  }

  const backup = crearTransporterGmail();
  if (backup) {
    const fromBackup = process.env.SMTP_FROM_BACKUP || mailOptions.from;
    return backup.sendMail({ ...mailOptions, from: fromBackup });
  }
  throw new Error('Sin método de envío disponible (Resend API y Gmail SMTP fallaron)');
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
  const appBase   = process.env.APP_BASE_URL || 'https://aela.corpsimtelec.com';
  const urlAcceso = `${appBase}/${tenant.slug}`;

  const html = templateBienvenida({
    nombreEmpresa:  tenant.nombreContacto || tenant.slug,
    nombreContacto: tenant.nombreContacto || 'Administrador',
    urlAcceso,
    plan: tenant.plan,
  });

  try {
    await enviarConFallback({
      from:    process.env.SMTP_FROM || 'AELA ERP <info@corpsimtelec.com>',
      to:      email,
      subject: `¡Tu sistema AELA ERP está listo! — ${tenant.nombreContacto || tenant.slug}`,
      html,
    });
    console.log(`[email] Bienvenida enviada a ${email}`);
  } catch (err) {
    console.warn(`[email] No se pudo enviar bienvenida a ${email}: ${err.message}`);
    // No lanzar — el provisioning ya fue exitoso, el email es opcional
  }
}

// ─── Enviar alerta interna al equipo de soporte ───────────────────────────────
async function enviarAlertaSoporte({ asunto, mensaje }) {
  const destino = process.env.SMTP_SOPORTE || 'info@corpsimtelec.com';
  try {
    await enviarConFallback({
      from:    process.env.SMTP_FROM || 'AELA ERP <info@corpsimtelec.com>',
      to:      destino,
      subject: `[AELA ERP] ${asunto}`,
      text:    mensaje,
    });
  } catch (err) {
    console.error('[email] Error enviando alerta soporte:', err.message);
  }
}

// ─── Template HTML para documentos fiscales ──────────────────────────────────
function templateDocumentoFiscal({
  tipoLabel, numero, razonSocialEmisor, nombreComercialEmisor, logoUrl,
  razonSocialComprador, fechaStr, totalStr, claveAcceso, numeroAutorizacion,
}) {
  const urlSRI = `https://srienlinea.sri.gob.ec/comprobantes-electronicos-internet/pages/consultaComprobantes/consultarComprobante.jsf`;
  const colorHeader = tipoLabel === 'Nota de Crédito' ? '#059669'
    : tipoLabel === 'Nota de Débito'  ? '#d97706'
    : tipoLabel === 'Nota de Venta'   ? '#2563eb'
    : '#7C3AED'; // Factura

  const nombreMostrar  = nombreComercialEmisor || razonSocialEmisor || 'AELA ERP';
  const esNV           = tipoLabel === 'Nota de Venta';

  // Data URIs (base64) se excluyen del email: pueden pesar 200-500 KB y Gmail
  // recorta mensajes > 102 KB ocultando todo el contenido.
  // Solo se usa la imagen si es una URL externa real (https://...).
  const logoEsUrl = logoUrl && logoUrl.startsWith('http');
  const logoHtml  = logoEsUrl
    ? `<img src="${logoUrl}" alt="${nombreMostrar}" style="height:56px;max-width:180px;object-fit:contain;border-radius:6px;margin-bottom:10px;display:block;margin-left:auto;margin-right:auto;"/>`
    : `<svg width="44" height="44" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:10px;display:block;margin-left:auto;margin-right:auto;">
        <rect width="28" height="28" rx="7" fill="rgba(255,255,255,.2)"/>
        <path d="M14 5 L22 23 M14 5 L6 23 M9 17 H19" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
       </svg>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${tipoLabel} ${numero}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,${colorHeader},${colorHeader}bb);padding:36px 40px 28px;text-align:center;">
            ${logoHtml}
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800;letter-spacing:-.3px;line-height:1.2">${nombreMostrar}</h1>
            <p style="color:rgba(255,255,255,.65);margin:5px 0 0;font-size:12px;letter-spacing:.3px">AELA ERP · by CorpSimtelec</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="color:#64748b;margin:0 0 4px;font-size:14px">Estimado/a cliente,</p>
            <h2 style="color:#1e293b;margin:0 0 6px;font-size:20px;font-weight:700">
              ${tipoLabel} <span style="color:${colorHeader}">${numero}</span>
            </h2>
            <p style="color:#475569;margin:0 0 28px;font-size:14px;line-height:1.6">
              Le enviamos adjunto el comprobante electrónico${esNV ? '.' : ' autorizado por el SRI.'}<br/>
              Por favor consérvelo para sus registros.
            </p>

            <!-- Datos del comprobante -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Emisor</span><br/>
                        <span style="color:#1e293b;font-size:14px;font-weight:600">${razonSocialEmisor || ''}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Destinatario</span><br/>
                        <span style="color:#1e293b;font-size:14px">${razonSocialComprador || ''}</span>
                      </td>
                    </tr>
                    ${fechaStr ? `<tr>
                      <td style="padding:6px 0;border-bottom:1px solid #e2e8f0;">
                        <span style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Fecha de Emisión</span><br/>
                        <span style="color:#1e293b;font-size:14px">${fechaStr}</span>
                      </td>
                    </tr>` : ''}
                    ${totalStr ? `<tr>
                      <td style="padding:6px 0;">
                        <span style="color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Valor Total</span><br/>
                        <span style="color:${colorHeader};font-size:18px;font-weight:800">${totalStr}</span>
                      </td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>

            <!-- Autorización -->
            ${numeroAutorizacion ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;margin-bottom:24px;">
              <tr>
                <td style="padding:16px 20px;">
                  <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#16a34a">
                    ✅ Autorizado por el SRI
                  </p>
                  <p style="margin:0;font-size:12px;color:#166534;word-break:break-all;font-family:monospace">
                    ${numeroAutorizacion}
                  </p>
                </td>
              </tr>
            </table>` : ''}

            <!-- CTA verificar -->
            ${claveAcceso ? `
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${urlSRI}" style="display:inline-block;background:${colorHeader};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">
                Verificar en el portal SRI →
              </a>
            </div>` : ''}

            <p style="color:#94a3b8;font-size:13px;margin:0;line-height:1.6">
              Si tiene alguna consulta sobre este comprobante, contáctenos por los medios indicados abajo.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="color:#94a3b8;font-size:13px;margin:0 0 6px">
              ¿Necesitas ayuda? Estamos disponibles <strong>24/7</strong>.
            </p>
            <p style="margin:0;font-size:13px">
              <a href="https://wa.me/5930978893520" style="color:#16a34a;font-weight:600;text-decoration:none">WhatsApp</a>
              &nbsp;·&nbsp;
              <a href="mailto:info@corpsimtelec.com" style="color:#7C3AED;font-weight:600;text-decoration:none">info@corpsimtelec.com</a>
            </p>
            <p style="color:#cbd5e1;font-size:12px;margin:14px 0 0">
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

// ─── Enviar documento fiscal al cliente (factura, NC, ND, NV) ─────────────────
/**
 * @param {object} params
 * @param {string} params.tipo              - 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO' | 'NOTA_VENTA'
 * @param {string} params.numero            - Número del comprobante (ej: "001-001-000000001")
 * @param {string} params.email             - Correo del destinatario
 * @param {string} [params.pdfPath]         - Ruta absoluta al PDF (se adjunta si existe)
 * @param {string} [params.razonSocialEmisor]
 * @param {string} [params.razonSocialComprador]
 * @param {Date|string} [params.fecha]
 * @param {number|string} [params.total]
 * @param {string} [params.claveAcceso]
 * @param {string} [params.numeroAutorizacion]
 */
async function enviarDocumentoFiscal({
  tipo, numero, email, pdfPath,
  razonSocialEmisor, nombreComercialEmisor, logoUrl,
  razonSocialComprador,
  fecha, total, claveAcceso, numeroAutorizacion,
}) {
  if (!email) return;

  const tipoLabel = {
    FACTURA:      'Factura',
    NOTA_CREDITO: 'Nota de Crédito',
    NOTA_DEBITO:  'Nota de Débito',
    NOTA_VENTA:   'Nota de Venta',
  }[tipo] || tipo;

  const tipoFilename = {
    FACTURA:      'FAC',
    NOTA_CREDITO: 'NC',
    NOTA_DEBITO:  'ND',
    NOTA_VENTA:   'NV',
  }[tipo] || tipo;

  const fechaStr = fecha
    ? new Date(fecha).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  const totalStr = (total !== undefined && total !== null)
    ? `$${Number(total).toFixed(2)}`
    : '';

  const html = templateDocumentoFiscal({
    tipoLabel, numero,
    razonSocialEmisor, nombreComercialEmisor, logoUrl,
    razonSocialComprador,
    fechaStr, totalStr, claveAcceso, numeroAutorizacion,
  });

  const attachments = [];
  if (pdfPath && fs.existsSync(pdfPath)) {
    attachments.push({
      filename: `${tipoFilename}-${numero}.pdf`,
      path:     pdfPath,
    });
  }

  try {
    await enviarConFallback({
      from:    process.env.SMTP_FROM || 'AELA ERP <info@corpsimtelec.com>',
      to:      email,
      subject: `${tipoLabel} ${numero} — ${razonSocialEmisor || 'AELA ERP'}`,
      html,
      attachments,
    });
    console.log(`[email] ${tipoLabel} ${numero} enviada a ${email}`);
  } catch (err) {
    console.error(`[email] Error enviando ${tipoLabel} ${numero} a ${email}:`, err.message);
  }
}

module.exports = { enviarEmailBienvenida, enviarAlertaSoporte, enviarDocumentoFiscal, enviarConFallback };
