// ====================================
// ATS — ANEXO TRANSACCIONAL SIMPLIFICADO
// frontend/src/components/Facturacion/ATS.jsx
// ====================================

import { useState, useCallback } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import { descargarPdf } from '../../utils/exportCsv';
import './ATS.css';

const POR_PAGINA = 50;

function usePagina(items) {
  const [pagina, setPagina] = useState(1);
  const totalPaginas = Math.max(1, Math.ceil(items.length / POR_PAGINA));
  const paginaReal = Math.min(pagina, totalPaginas);
  const slice = items.slice((paginaReal - 1) * POR_PAGINA, paginaReal * POR_PAGINA);
  return { slice, pagina: paginaReal, totalPaginas, setPagina };
}

function Paginador({ pagina, totalPaginas, total, setPagina }) {
  if (totalPaginas <= 1) return null;
  return (
    <div className="ats-paginador">
      <button disabled={pagina === 1} onClick={() => setPagina(1)}>«</button>
      <button disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>‹ Anterior</button>
      <span>Página <strong>{pagina}</strong> de <strong>{totalPaginas}</strong> ({total} registros)</span>
      <button disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente ›</button>
      <button disabled={pagina === totalPaginas} onClick={() => setPagina(totalPaginas)}>»</button>
    </div>
  );
}

const MESES = [
  { v: '01', l: 'Enero' },   { v: '02', l: 'Febrero' },  { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' },   { v: '05', l: 'Mayo' },      { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' },   { v: '08', l: 'Agosto' },    { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' },
];

const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
const fmtFecha = (f) => f ? formatFechaCorta(f) : '-';

// ─── Tab Ventas ───────────────────────────────────────────────────────────────
function TabVentas({ data }) {
  const facturas     = data.facturas     || [];
  const liquidaciones = data.liquidaciones || [];
  const ncs          = data.ncs          || [];

  const { slice: sliceF, pagina: paginaF, totalPaginas: totalF, setPagina: setPaginaF } = usePagina(facturas);

  const totF  = facturas.reduce((s, f) => s + parseFloat(f.importeTotal || 0), 0);
  const totL  = liquidaciones.reduce((s, l) => s + parseFloat(l.importeTotal || 0), 0);
  const totNC = ncs.reduce((s, n) => s + parseFloat(n.importeTotal || 0), 0);

  return (
    <>
      {/* Facturas emitidas */}
      <div className="ats-seccion">
        <h3 className="ats-seccion-titulo">
          Facturas emitidas autorizadas
          <span className="ats-sec-count">{facturas.length}</span>
        </h3>
        <Paginador pagina={paginaF} totalPaginas={totalF} total={facturas.length} setPagina={setPaginaF} />
        {facturas.length === 0 ? (
          <p className="ats-empty">No hay facturas autorizadas en este período.</p>
        ) : (
          <div className="ats-tabla-wrap">
            <table className="ats-tabla">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Comprador</th>
                  <th>RUC / CI</th>
                  <th className="text-right">Base 0%</th>
                  <th className="text-right">Base gravada</th>
                  <th className="text-right">IVA</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sliceF.map(f => (
                  <tr key={f.id}>
                    <td className="ats-num">{f.numeroFactura}</td>
                    <td>{fmtFecha(f.fechaEmision)}</td>
                    <td>{f.razonSocialComprador}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{f.identificacionComprador}</td>
                    <td className="ats-money">{fmt(f.subtotal0)}</td>
                    <td className="ats-money">{fmt((parseFloat(f.subtotal15 || 0) + parseFloat(f.subtotal5 || 0)).toFixed(2))}</td>
                    <td className="ats-money">{fmt(f.totalIva)}</td>
                    <td className="ats-money ats-money-total">{fmt(f.importeTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ats-tfoot">
                  <td colSpan={4}><strong>TOTALES</strong></td>
                  <td className="ats-money"><strong>{fmt(facturas.reduce((s, f) => s + parseFloat(f.subtotal0 || 0), 0))}</strong></td>
                  <td className="ats-money"><strong>{fmt(facturas.reduce((s, f) => s + parseFloat(f.subtotal15 || 0) + parseFloat(f.subtotal5 || 0), 0))}</strong></td>
                  <td className="ats-money"><strong>{fmt(facturas.reduce((s, f) => s + parseFloat(f.totalIva || 0), 0))}</strong></td>
                  <td className="ats-money ats-money-total"><strong>{fmt(totF)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Liquidaciones de compra emitidas */}
      {liquidaciones.length > 0 && (
        <div className="ats-seccion">
          <h3 className="ats-seccion-titulo">
            Liquidaciones de Compra emitidas (tipo 03)
            <span className="ats-sec-count">{liquidaciones.length}</span>
          </h3>
          <div className="ats-tabla-wrap">
            <table className="ats-tabla">
              <thead>
                <tr>
                  <th>Número</th><th>Fecha</th><th>Proveedor</th><th>Identificación</th>
                  <th className="text-right">Base 0%</th><th className="text-right">Base grav.</th>
                  <th className="text-right">IVA</th><th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {liquidaciones.map(l => (
                  <tr key={l.id}>
                    <td className="ats-num">{l.numeroLiquidacion}</td>
                    <td>{fmtFecha(l.fechaEmision)}</td>
                    <td>{l.razonSocialProveedor}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{l.identificacionProveedor}</td>
                    <td className="ats-money">{fmt(l.subtotal0)}</td>
                    <td className="ats-money">{fmt(l.subtotal15)}</td>
                    <td className="ats-money">{fmt(l.totalIva)}</td>
                    <td className="ats-money ats-money-total">{fmt(l.importeTotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ats-tfoot">
                  <td colSpan={4}><strong>TOTALES</strong></td>
                  <td className="ats-money"><strong>{fmt(liquidaciones.reduce((s, l) => s + parseFloat(l.subtotal0 || 0), 0))}</strong></td>
                  <td className="ats-money"><strong>{fmt(liquidaciones.reduce((s, l) => s + parseFloat(l.subtotal15 || 0), 0))}</strong></td>
                  <td className="ats-money"><strong>{fmt(liquidaciones.reduce((s, l) => s + parseFloat(l.totalIva || 0), 0))}</strong></td>
                  <td className="ats-money ats-money-total"><strong>{fmt(totL)}</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Notas de crédito emitidas */}
      {ncs.length > 0 && (
        <div className="ats-seccion">
          <h3 className="ats-seccion-titulo">
            Notas de Crédito emitidas (tipo 04)
            <span className="ats-sec-count">{ncs.length}</span>
          </h3>
          <div className="ats-tabla-wrap">
            <table className="ats-tabla">
              <thead>
                <tr>
                  <th>Número</th><th>Fecha</th><th>Comprador</th><th>Identificación</th>
                  <th className="text-right">Subtotal</th><th className="text-right">IVA</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {ncs.map(n => (
                  <tr key={n.id}>
                    <td className="ats-num">{n.numeroNC}</td>
                    <td>{fmtFecha(n.fechaEmision)}</td>
                    <td>{n.razonSocialComprador}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{n.identificacionComprador}</td>
                    <td className="ats-money">{fmt(n.totalSinImpuestos)}</td>
                    <td className="ats-money">{fmt(n.totalIva)}</td>
                    <td className="ats-money ats-money-total" style={{ color: '#dc2626' }}>({fmt(n.importeTotal)})</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="ats-tfoot">
                  <td colSpan={6}><strong>TOTAL NC (descuenta de ventas)</strong></td>
                  <td className="ats-money ats-money-total" style={{ color: '#dc2626' }}><strong>({fmt(totNC)})</strong></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Tab Compras ──────────────────────────────────────────────────────────────
function TabCompras({ data }) {
  const compras = data.compras || [];
  const { slice, pagina, totalPaginas, setPagina } = usePagina(compras);

  const totBase0    = compras.reduce((s, c) => s + parseFloat(c.subtotal0 || 0), 0);
  const totBaseGrav = compras.reduce((s, c) => s + parseFloat(c.subtotal15 || 0) + parseFloat(c.subtotal5 || 0), 0);
  const totIva      = compras.reduce((s, c) => s + parseFloat(c.totalIva || 0), 0);
  const totTotal    = compras.reduce((s, c) => s + parseFloat(c.importeTotal || 0), 0);
  const totRetIR    = compras.reduce((s, c) => s + parseFloat(c.retencionRenta || 0), 0);
  const totRetIva   = compras.reduce((s, c) => s + parseFloat(c.retencionIVA || 0), 0);

  return (
    <div className="ats-seccion">
      <h3 className="ats-seccion-titulo">
        Facturas de Compra registradas
        <span className="ats-sec-count">{compras.length}</span>
      </h3>

      {/* Resumen compras */}
      {compras.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            ['Base 0%', totBase0],
            ['Base gravada', totBaseGrav],
            ['IVA pagado', totIva],
            ['Total compras', totTotal],
            ['Ret. IR', totRetIR],
            ['Crédito trib. IVA', totRetIva],
          ].map(([label, val]) => (
            <div key={label} className="ats-mini-card">
              <span className="ats-mini-label">{label}</span>
              <span className="ats-mini-val">{fmt(val)}</span>
            </div>
          ))}
        </div>
      )}

      <Paginador pagina={pagina} totalPaginas={totalPaginas} total={compras.length} setPagina={setPagina} />
      {compras.length === 0 ? (
        <p className="ats-empty">No hay facturas de compra en este período.</p>
      ) : (
        <div className="ats-tabla-wrap">
          <table className="ats-tabla">
            <thead>
              <tr>
                <th>Número factura</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>RUC / CI</th>
                <th>Autorización</th>
                <th className="text-right">Base 0%</th>
                <th className="text-right">Base grav.</th>
                <th className="text-right">IVA</th>
                <th className="text-right">Total</th>
                <th className="text-right">Ret. IR</th>
                <th className="text-right">Ret. IVA</th>
                <th>Retención N°</th>
              </tr>
            </thead>
            <tbody>
              {slice.map(c => {
                const ret = (c.retenciones || [])[0];
                const baseGrav = parseFloat(c.subtotal15 || 0) + parseFloat(c.subtotal5 || 0);
                return (
                  <tr key={c.id}>
                    <td className="ats-num">{c.numeroFactura}</td>
                    <td>{fmtFecha(c.fechaEmision)}</td>
                    <td className="ats-proveedor">{c.razonSocialProveedor}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{c.identificacionProveedor}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={c.numeroAutorizacion}>{c.numeroAutorizacion ? c.numeroAutorizacion.slice(0, 14) + '…' : '—'}</td>
                    <td className="ats-money">{fmt(c.subtotal0)}</td>
                    <td className="ats-money">{fmt(baseGrav)}</td>
                    <td className="ats-money">{fmt(c.totalIva)}</td>
                    <td className="ats-money ats-money-total">{fmt(c.importeTotal)}</td>
                    <td className="ats-money">{fmt(c.retencionRenta)}</td>
                    <td className="ats-money">{fmt(c.retencionIVA)}</td>
                    <td style={{ fontSize: '0.82rem' }}>{ret ? ret.numeroRetencion : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="ats-tfoot">
                <td colSpan={5}><strong>TOTALES</strong></td>
                <td className="ats-money"><strong>{fmt(totBase0)}</strong></td>
                <td className="ats-money"><strong>{fmt(totBaseGrav)}</strong></td>
                <td className="ats-money"><strong>{fmt(totIva)}</strong></td>
                <td className="ats-money ats-money-total"><strong>{fmt(totTotal)}</strong></td>
                <td className="ats-money"><strong>{fmt(totRetIR)}</strong></td>
                <td className="ats-money"><strong>{fmt(totRetIva)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Retenciones ──────────────────────────────────────────────────────────
function TabRetenciones({ data }) {
  const retenciones = data.retenciones || [];
  const { slice: sliceR, pagina: paginaR, totalPaginas: totalR, setPagina: setPaginaR } = usePagina(retenciones);

  return (
    <div className="ats-seccion">
      <h3 className="ats-seccion-titulo">
        Comprobantes de Retención emitidos
        <span className="ats-sec-count">{retenciones.length}</span>
      </h3>
      <Paginador pagina={paginaR} totalPaginas={totalR} total={retenciones.length} setPagina={setPaginaR} />
      {retenciones.length === 0 ? (
        <p className="ats-empty">No hay retenciones autorizadas en este período.</p>
      ) : (
        <div className="ats-tabla-wrap">
          <table className="ats-tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Identificación</th>
                <th>Período</th>
                <th className="text-right">Ret. Renta</th>
                <th className="text-right">Ret. IVA</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {sliceR.map(ret => {
                const imps = Array.isArray(ret.impuestos) ? ret.impuestos
                  : (typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : []);
                const retRenta = imps.filter(i => String(i.codigo) === '1').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
                const retIva   = imps.filter(i => String(i.codigo) === '2').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
                return (
                  <tr key={ret.id}>
                    <td className="ats-num">{ret.numeroRetencion}</td>
                    <td>{fmtFecha(ret.fechaEmision)}</td>
                    <td>{ret.razonSocialProveedor}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{ret.identificacionProveedor}</td>
                    <td>{ret.periodoFiscal}</td>
                    <td className="ats-money">{fmt(retRenta)}</td>
                    <td className="ats-money">{fmt(retIva)}</td>
                    <td className="ats-money ats-money-total">{fmt(ret.totalRetenido)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="ats-tfoot">
                <td colSpan={7}><strong>TOTAL RETENIDO</strong></td>
                <td className="ats-money ats-money-total">
                  <strong>{fmt(retenciones.reduce((s, r) => s + parseFloat(r.totalRetenido || 0), 0))}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab Anulados ─────────────────────────────────────────────────────────────
function TabAnulados({ data }) {
  const anulados = data.anulados || [];
  const { slice: sliceA, pagina: paginaA, totalPaginas: totalA, setPagina: setPaginaA } = usePagina(anulados);
  return (
    <div className="ats-seccion">
      <h3 className="ats-seccion-titulo">
        Comprobantes Anulados del período
        <span className="ats-sec-count">{anulados.length}</span>
      </h3>
      <Paginador pagina={paginaA} totalPaginas={totalA} total={anulados.length} setPagina={setPaginaA} />
      {anulados.length === 0 ? (
        <p className="ats-empty">No hay comprobantes anulados en este período.</p>
      ) : (
        <div className="ats-tabla-wrap">
          <table className="ats-tabla">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Número</th>
                <th>Fecha</th>
                <th>Autorización</th>
              </tr>
            </thead>
            <tbody>
              {sliceA.map(f => (
                <tr key={f.id}>
                  <td>Factura</td>
                  <td className="ats-num">{f.numeroFactura}</td>
                  <td>{fmtFecha(f.fechaEmision)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{f.numeroAutorizacion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ATS() {
  const hoy  = new Date();
  const [mes,  setMes]  = useState(String(hoy.getMonth() + 1).padStart(2, '0'));
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [descargando, setDescargando]     = useState(false);
  const [descPdf,     setDescPdf]         = useState(false);
  const [error,   setError]   = useState('');
  const [tabActiva, setTabActiva] = useState('ventas');

  const anios = Array.from({ length: 6 }, (_, i) => String(hoy.getFullYear() - i));

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const { data: resp } = await api.get('/ats/preview', {
        params: { mes: parseInt(mes), anio: parseInt(anio) },
      });
      setData(resp.data);
      setTabActiva('ventas');
    } catch (err) {
      setError(err.response?.data?.error || 'Error al generar el ATS');
    } finally {
      setLoading(false);
    }
  }, [mes, anio]);

  const descargarXML = async () => {
    setDescargando(true);
    try {
      const resp = await api.get('/ats/exportar', {
        params: { mes: parseInt(mes), anio: parseInt(anio) },
        responseType: 'blob',
      });
      const filename = `ats_${anio}${mes}.xml`;
      const url = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert('Error al descargar ATS XML: ' + (err.response?.data?.error || err.message));
    } finally {
      setDescargando(false);
    }
  };

  const descargarTalonPdf = async () => {
    setDescPdf(true);
    try {
      await descargarPdf(
        api, '/ats/exportar/pdf',
        { mes: parseInt(mes), anio: parseInt(anio) },
        `talonATS_${anio}${mes}.pdf`,
      );
    } catch {
      alert('No se pudo generar el talón resumen PDF');
    } finally {
      setDescPdf(false);
    }
  };

  const tabs = [
    { key: 'ventas',      label: `Ventas (${data ? (data.facturas.length + data.liquidaciones.length) : '—'})` },
    { key: 'compras',     label: `Compras (${data ? data.compras.length : '—'})` },
    { key: 'retenciones', label: `Retenciones emitidas (${data ? data.retenciones.length : '—'})` },
    { key: 'anulados',    label: `Anulados (${data ? data.anulados.length : '—'})` },
  ];

  return (
    <div className="ats-container">
      {/* Header */}
      <div className="ats-header">
        <div>
          <h1 className="ats-title">ATS — Anexo Transaccional Simplificado</h1>
          <p className="ats-subtitle">Exportación XML mensual para declaración SRI (DIMM / Portal Web)</p>
        </div>
      </div>

      {/* Selector de período */}
      <div className="ats-periodo-box">
        <div className="ats-periodo-selector">
          <label>Mes:</label>
          <select value={mes} onChange={e => setMes(e.target.value)} className="ats-select">
            {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
          <label>Año:</label>
          <select value={anio} onChange={e => setAnio(e.target.value)} className="ats-select">
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn-generar-ats" onClick={cargar} disabled={loading}>
            {loading ? 'Cargando...' : 'Generar ATS'}
          </button>
          {data && (
            <>
              <button className="btn-descargar-ats" onClick={descargarXML} disabled={descargando}>
                {descargando ? 'Descargando...' : '⬇ XML ATS'}
              </button>
              <button className="btn-imprimir-ats" onClick={descargarTalonPdf} disabled={descPdf}>
                {descPdf ? 'Generando...' : '🖨 Talón Resumen PDF'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="ats-error">{error}</div>}

      {data && (
        <>
          {/* Resumen cards */}
          <div className="ats-cards-grid">
            <div className="ats-card ats-card-ventas">
              <div className="ats-card-icono">🧾</div>
              <div className="ats-card-titulo">Ventas</div>
              <div className="ats-card-valor">{data.facturas.length + data.liquidaciones.length}</div>
              <div className="ats-card-sub">Total: {fmt(data.totales.totalVentasFacturas + data.totales.totalVentasLiquidaciones)}</div>
              <div className="ats-card-nota">facturas + liquidaciones</div>
            </div>
            <div className="ats-card ats-card-liq">
              <div className="ats-card-icono">🛒</div>
              <div className="ats-card-titulo">Compras</div>
              <div className="ats-card-valor">{data.compras.length}</div>
              <div className="ats-card-sub">Total: {fmt(data.totales.totalCompras)}</div>
              <div className="ats-card-nota">facturas de compra</div>
            </div>
            <div className="ats-card ats-card-ret">
              <div className="ats-card-icono">📋</div>
              <div className="ats-card-titulo">Retenciones emitidas</div>
              <div className="ats-card-valor">{data.retenciones.length}</div>
              <div className="ats-card-sub">Total ret.: {fmt(data.totales.totalRetenciones)}</div>
              <div className="ats-card-nota">autorizadas</div>
            </div>
            <div className="ats-card ats-card-total">
              <div className="ats-card-icono">🚫</div>
              <div className="ats-card-titulo">Anulados</div>
              <div className="ats-card-valor">{data.anulados.length}</div>
              <div className="ats-card-sub">{data.periodo.label}</div>
              <div className="ats-card-nota">facturas emitidas</div>
            </div>
          </div>

          {/* Info instrucciones */}
          <div className="ats-nota-sri">
            <strong>¿Cómo usar el ATS XML?</strong>
            <ol>
              <li>Descargue el archivo <strong>⬇ XML ATS</strong>.</li>
              <li>Ingrese al portal SRI (<em>sri.gob.ec</em>) → Servicios en Línea → ATS.</li>
              <li>Cargue el XML y valide antes del vencimiento del período.</li>
              <li>Descargue el <strong>🖨 Talón Resumen PDF</strong> para su archivo contable.</li>
            </ol>
          </div>

          {/* Tabs */}
          <div className="ats-tabs-bar">
            {tabs.map(t => (
              <button
                key={t.key}
                className={`ats-tab-btn ${tabActiva === t.key ? 'activo' : ''}`}
                onClick={() => setTabActiva(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tabActiva === 'ventas'      && <TabVentas data={data} />}
          {tabActiva === 'compras'     && <TabCompras data={data} />}
          {tabActiva === 'retenciones' && <TabRetenciones data={data} />}
          {tabActiva === 'anulados'    && <TabAnulados data={data} />}
        </>
      )}

      {!data && !loading && (
        <div className="ats-placeholder">
          Seleccione el período y haga clic en <strong>Generar ATS</strong> para ver el resumen
          de transacciones y descargar el XML para el SRI.
        </div>
      )}
    </div>
  );
}
