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

export const printHtmlReport = ({ title = 'Reporte', subtitle = '', sections = [] } = {}) => {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=800');

  if (!printWindow) {
    window.alert('No se pudo abrir la ventana de impresion. Habilita las ventanas emergentes.');
    return;
  }

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

          * {
            box-sizing: border-box;
          }

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

          .report-header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid var(--accent);
          }

          .report-header h1 {
            margin: 0;
            font-size: 28px;
            line-height: 1.2;
          }

          .report-header p {
            margin: 8px 0 0;
            color: var(--muted);
            font-size: 14px;
          }

          .report-section {
            margin-bottom: 24px;
            page-break-inside: avoid;
          }

          .report-section h2 {
            margin: 0 0 12px;
            font-size: 18px;
          }

          .report-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--surface);
          }

          .report-table th,
          .report-table td {
            padding: 10px 12px;
            border: 1px solid var(--border);
            font-size: 12px;
            text-align: left;
            vertical-align: top;
          }

          .report-table thead th {
            background: #ecfeff;
            font-weight: 700;
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
            body {
              padding: 0;
              background: #fff;
            }

            .report-shell {
              max-width: none;
            }

            .report-section {
              break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        <main class="report-shell">
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

  printWindow.document.open();
  printWindow.document.write(doc);
  printWindow.document.close();
};
