const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const renderCell = (value, tag = 'td') => `<${tag}>${escapeHtml(value)}</${tag}>`;

export const buildKvTable = (rows = []) => {
  if (!rows.length) {
    return '<p class="report-empty">Sin datos disponibles.</p>';
  }

  const body = rows.map(([label, value]) => (
    `<tr>${renderCell(label, 'th')}${renderCell(value)}</tr>`
  )).join('');

  return `
    <table class="report-table report-table-kv">
      <tbody>${body}</tbody>
    </table>
  `;
};

export const buildDataTable = (headers = [], rows = []) => {
  const head = headers.map((header) => renderCell(header, 'th')).join('');

  if (!rows.length) {
    return `
      <table class="report-table">
        <thead><tr>${head}</tr></thead>
      </table>
      <p class="report-empty">Sin datos disponibles.</p>
    `;
  }

  const body = rows.map((row) => (
    `<tr>${(row || []).map((cell) => renderCell(cell)).join('')}</tr>`
  )).join('');

  return `
    <table class="report-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
};

function buildLetterhead(empresa) {
  if (!empresa) return '';

  const logoHtml = empresa.logoUrl
    ? `<img src="${escapeHtml(empresa.logoUrl)}" class="lh-logo" alt="Logo" />`
    : '<div class="lh-logo-placeholder">🏢</div>';

  const dirHtml    = empresa.direccion  ? `<span>${escapeHtml(empresa.direccion)}</span>`  : '';
  const telHtml    = empresa.telefono   ? `<span>Tel: ${escapeHtml(empresa.telefono)}</span>` : '';
  const emailHtml  = empresa.email      ? `<span>${escapeHtml(empresa.email)}</span>`      : '';

  return `
    <div class="lh-wrap">
      <div class="lh-logo-col">${logoHtml}</div>
      <div class="lh-info-col">
        <div class="lh-name">${escapeHtml(empresa.razonSocial || '')}</div>
        ${empresa.ruc ? `<div class="lh-ruc">RUC: ${escapeHtml(empresa.ruc)}</div>` : ''}
        <div class="lh-details">${dirHtml}${telHtml}${emailHtml}</div>
      </div>
    </div>
  `;
}

export const printHtmlReport = ({ title = 'Reporte', subtitle = '', sections = [], empresa = null } = {}) => {
  const renderedSections = sections.map(({ title: sectionTitle = '', html = '' }) => `
    <section class="report-section">
      <h2>${escapeHtml(sectionTitle)}</h2>
      ${html}
    </section>
  `).join('');

  const doc = `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <style>
          :root {
            color-scheme: light;
            --border: #d7dee7;
            --text: #1f2937;
            --muted: #6b7280;
            --surface: #ffffff;
            --surface-alt: #f8fafc;
            --accent: #0f766e;
          }

          * { box-sizing: border-box; }

          body {
            margin: 0;
            padding: 32px;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            color: var(--text);
            background: var(--surface-alt);
          }

          .report-shell {
            max-width: 1100px;
            margin: 0 auto;
            background: var(--surface);
          }

          /* ── Letterhead ── */
          .lh-wrap {
            display: flex;
            align-items: center;
            gap: 20px;
            padding: 16px 0 14px;
            border-bottom: 3px solid var(--accent);
            margin-bottom: 14px;
          }
          .lh-logo-col { flex: 0 0 auto; }
          .lh-logo {
            max-height: 72px;
            max-width: 160px;
            object-fit: contain;
          }
          .lh-logo-placeholder {
            font-size: 48px;
            line-height: 1;
          }
          .lh-info-col { flex: 1; }
          .lh-name {
            font-size: 18px;
            font-weight: 700;
            color: var(--text);
          }
          .lh-ruc {
            font-size: 13px;
            color: var(--muted);
            margin-top: 2px;
          }
          .lh-details {
            display: flex;
            flex-wrap: wrap;
            gap: 6px 18px;
            margin-top: 4px;
            font-size: 12px;
            color: var(--muted);
          }

          /* ── Report title ── */
          .report-header {
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border);
          }
          .report-header h1 {
            margin: 0;
            font-size: 22px;
            color: var(--accent);
          }
          .report-header p {
            margin: 6px 0 0;
            color: var(--muted);
            font-size: 13px;
          }

          .report-section {
            margin-bottom: 24px;
            page-break-inside: avoid;
          }
          .report-section h2 {
            margin: 0 0 12px;
            font-size: 16px;
            color: var(--accent);
            border-left: 4px solid var(--accent);
            padding-left: 8px;
          }

          .report-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--surface);
          }
          .report-table th,
          .report-table td {
            padding: 8px 10px;
            border: 1px solid var(--border);
            font-size: 11px;
            text-align: left;
            vertical-align: top;
          }
          .report-table thead th {
            background: #ecfeff;
            font-weight: 700;
            font-size: 11px;
          }
          .report-table-kv th {
            width: 220px;
            background: #f8fafc;
          }
          .report-empty {
            margin: 12px 0 0;
            color: var(--muted);
            font-size: 13px;
          }

          @media print {
            body { padding: 0; background: #fff; }
            .report-shell { max-width: none; }
            .report-section { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <main class="report-shell">
          ${buildLetterhead(empresa)}
          <header class="report-header">
            <h1>${escapeHtml(title)}</h1>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
          </header>
          ${renderedSections}
        </main>
        <script>
          window.addEventListener('load', () => {
            window.focus();
            window.print();
          });
        </script>
      </body>
    </html>
  `;

  // Se imprime desde un iframe oculto en vez de una ventana nueva (window.open):
  // los bloqueadores de ventanas emergentes (Firefox en particular) bloquean
  // window.open('', ...) con más frecuencia que uno con URL real, y no hay
  // forma de "habilitar" esto de antemano para el usuario. Un iframe no abre
  // ninguna ventana/pestaña, así que nunca lo bloquea un popup blocker.
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  let limpiado = false;
  const limpiar = () => {
    if (limpiado) return;
    limpiado = true;
    iframe.remove();
  };

  const iframeWindow = iframe.contentWindow;
  iframeWindow.document.open();
  iframeWindow.document.write(doc);
  iframeWindow.document.close();
  iframeWindow.addEventListener('afterprint', limpiar);
  // Respaldo por si 'afterprint' no dispara en algún navegador.
  setTimeout(limpiar, 60000);
};
