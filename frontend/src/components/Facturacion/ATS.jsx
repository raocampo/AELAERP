// ====================================
// ATS — ANEXO TRANSACCIONAL SIMPLIFICADO
// frontend/src/components/Facturacion/ATS.jsx
// ====================================

import { useState, useCallback } from 'react';
import axios from 'axios';
import './ATS.css';
import { buildDataTable, buildKvTable, printHtmlReport } from '../../utils/reportPrint';

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:5600'}/api`;

const MESES = [
  { v: '01', l: 'Enero' },   { v: '02', l: 'Febrero' },  { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' },   { v: '05', l: 'Mayo' },      { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' },   { v: '08', l: 'Agosto' },    { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' }, { v: '11', l: 'Noviembre' }, { v: '12', l: 'Diciembre' },
];

export default function ATS() {
  const hoy  = new Date();
  const [mes,  setMes]  = useState(String(hoy.getMonth() + 1).padStart(2, '0'));
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [error,   setError]   = useState('');

  const anios = Array.from({ length: 5 }, (_, i) => String(hoy.getFullYear() - i));

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const token = localStorage.getItem('token');
      const { data: resp } = await axios.get(`${API}/ats/preview`, {
        headers: { Authorization: `Bearer ${token}` },
        params:  { mes: parseInt(mes), anio: parseInt(anio) },
      });
      setData(resp.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al generar el ATS');
    } finally {
      setLoading(false);
    }
  }, [mes, anio]);

  const descargarXML = async () => {
    setDescargando(true);
    try {
      const token = localStorage.getItem('token');
      const resp  = await axios.get(`${API}/ats/exportar`, {
        headers:      { Authorization: `Bearer ${token}` },
        params:       { mes: parseInt(mes), anio: parseInt(anio) },
        responseType: 'blob',
      });
      const filename = `ats_${anio}${mes}.xml`;
      const url      = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/xml' }));
      const link     = document.createElement('a');
      link.href      = url;
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

  const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-EC') : '-';
  const fmt      = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

  const imprimirPDF = () => {
    if (!data) return;

    const resumenRows = [
      ['Período', data.periodo.label],
      ['Facturas', data.facturas.length],
      ['Liquidaciones', data.liquidaciones.length],
      ['Retenciones', data.retenciones.length],
      ['Total documentos', data.totales.totalDocumentos],
      ['Total facturas', fmt(data.totales.totalVentasFacturas)],
      ['Total liquidaciones', fmt(data.totales.totalVentasLiquidaciones)],
      ['Total retenciones', fmt(data.totales.totalRetenciones)],
    ];

    const facturasRows = (data.facturas || []).map((f) => ([
      f.numeroFactura,
      fmtFecha(f.fechaEmision),
      f.razonSocialComprador,
      f.identificacionComprador,
      fmt(f.subtotal0),
      fmt(f.subtotal15),
      fmt(f.totalIva),
      fmt(f.importeTotal),
    ]));

    const liquidacionesRows = (data.liquidaciones || []).map((liq) => ([
      liq.numeroLiquidacion,
      fmtFecha(liq.fechaEmision),
      liq.razonSocialProveedor,
      liq.identificacionProveedor,
      fmt(liq.subtotal0),
      fmt(liq.subtotal15),
      fmt(liq.totalIva),
      fmt(liq.importeTotal),
    ]));

    const retRows = (data.retenciones || []).map((ret) => {
      const imps = Array.isArray(ret.impuestos)
        ? ret.impuestos
        : (typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : []);
      const retRenta = imps.filter((i) => String(i.codigo) === '1').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
      const retIva = imps.filter((i) => String(i.codigo) === '2').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
      return [
        ret.numeroRetencion,
        fmtFecha(ret.fechaEmision),
        ret.razonSocialProveedor,
        ret.identificacionProveedor,
        ret.periodoFiscal,
        fmt(retRenta),
        fmt(retIva),
        fmt(ret.totalRetenido),
      ];
    });

    printHtmlReport({
      title: 'ATS - Anexo Transaccional Simplificado',
      subtitle: data.periodo.label,
      sections: [
        { title: 'Resumen', html: buildKvTable(resumenRows) },
        {
          title: 'Facturas',
          html: buildDataTable(
            ['Número', 'Fecha', 'Comprador', 'Identificación', 'Base 0%', 'Base 15%', 'IVA', 'Total'],
            facturasRows,
          ),
        },
        {
          title: 'Liquidaciones',
          html: buildDataTable(
            ['Número', 'Fecha', 'Proveedor', 'Identificación', 'Base 0%', 'Base 15%', 'IVA', 'Total'],
            liquidacionesRows,
          ),
        },
        {
          title: 'Retenciones',
          html: buildDataTable(
            ['Número', 'Fecha', 'Proveedor', 'Identificación', 'Período', 'Ret. Renta', 'Ret. IVA', 'Total'],
            retRows,
          ),
        },
      ],
    });
  };

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
          <button
            type="button"
            className="btn-imprimir-ats"
            onClick={imprimirPDF}
            disabled={!data}
          >
            Imprimir PDF
          </button>
        </div>
      </div>

      {error && <div className="ats-error">{error}</div>}

      {data && (
        <>
          {/* Tarjetas de resumen */}
          <div className="ats-cards-grid">
            <div className="ats-card ats-card-ventas">
              <div className="ats-card-icono">🧾</div>
              <div className="ats-card-titulo">Facturas</div>
              <div className="ats-card-valor">{data.facturas.length}</div>
              <div className="ats-card-sub">Total: {fmt(data.totales.totalVentasFacturas)}</div>
              <div className="ats-card-nota">solo autorizadas</div>
            </div>

            <div className="ats-card ats-card-liq">
              <div className="ats-card-icono">🛒</div>
              <div className="ats-card-titulo">Liquidaciones de Compra</div>
              <div className="ats-card-valor">{data.liquidaciones.length}</div>
              <div className="ats-card-sub">Total: {fmt(data.totales.totalVentasLiquidaciones)}</div>
              <div className="ats-card-nota">solo autorizadas</div>
            </div>

            <div className="ats-card ats-card-ret">
              <div className="ats-card-icono">📋</div>
              <div className="ats-card-titulo">Retenciones Emitidas</div>
              <div className="ats-card-valor">{data.retenciones.length}</div>
              <div className="ats-card-sub">Total: {fmt(data.totales.totalRetenciones)}</div>
              <div className="ats-card-nota">solo autorizadas</div>
            </div>

            <div className="ats-card ats-card-total">
              <div className="ats-card-icono">📊</div>
              <div className="ats-card-titulo">Total Documentos</div>
              <div className="ats-card-valor">{data.totales.totalDocumentos}</div>
              <div className="ats-card-sub">{data.periodo.label}</div>
            </div>
          </div>

          {/* Botón descarga XML */}
          <div className="ats-descarga-box">
            <div className="ats-descarga-info">
              <strong>ATS XML listo para declarar</strong>
              <span>Período: {data.periodo.label} — {data.totales.totalDocumentos} documentos autorizados</span>
            </div>
            <button className="btn-descargar-ats" onClick={descargarXML} disabled={descargando}>
              {descargando ? 'Descargando...' : '⬇ Descargar ATS XML'}
            </button>
          </div>

          {/* Nota informativa */}
          <div className="ats-nota-sri">
            <strong>¿Cómo usar el ATS XML?</strong>
            <ol>
              <li>Descargue el archivo XML generado.</li>
              <li>Ingrese al portal SRI (<em>sri.gob.ec</em>) o al DIMM formularios.</li>
              <li>En el módulo ATS, cargue el archivo XML descargado.</li>
              <li>Valide y envíe la declaración antes del vencimiento del período.</li>
            </ol>
          </div>

          {/* Tabla: Facturas */}
          <div className="ats-seccion">
            <h3 className="ats-seccion-titulo">
              Facturas — {data.periodo.label}
              <span className="ats-sec-count">{data.facturas.length}</span>
            </h3>
            {data.facturas.length === 0 ? (
              <p className="ats-empty">No hay facturas autorizadas en este período.</p>
            ) : (
              <div className="ats-tabla-wrap">
                <table className="ats-tabla">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Fecha</th>
                      <th>Comprador</th>
                      <th>Identificación</th>
                      <th>Base 0%</th>
                      <th>Base 15%</th>
                      <th>IVA 15%</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.facturas.map(f => (
                      <tr key={f.id}>
                        <td className="ats-num">{f.numeroFactura}</td>
                        <td>{fmtFecha(f.fechaEmision)}</td>
                        <td>{f.razonSocialComprador}</td>
                        <td>{f.identificacionComprador}</td>
                        <td className="ats-money">{fmt(f.subtotal0)}</td>
                        <td className="ats-money">{fmt(f.subtotal15)}</td>
                        <td className="ats-money">{fmt(f.totalIva)}</td>
                        <td className="ats-money ats-money-total">{fmt(f.importeTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="ats-tfoot">
                      <td colSpan={4}><strong>TOTALES</strong></td>
                      <td className="ats-money"><strong>{fmt(data.facturas.reduce((s, f) => s + parseFloat(f.subtotal0 || 0), 0))}</strong></td>
                      <td className="ats-money"><strong>{fmt(data.facturas.reduce((s, f) => s + parseFloat(f.subtotal15 || 0), 0))}</strong></td>
                      <td className="ats-money"><strong>{fmt(data.facturas.reduce((s, f) => s + parseFloat(f.totalIva || 0), 0))}</strong></td>
                      <td className="ats-money ats-money-total"><strong>{fmt(data.totales.totalVentasFacturas)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Tabla: Liquidaciones */}
          <div className="ats-seccion">
            <h3 className="ats-seccion-titulo">
              Liquidaciones de Compra — {data.periodo.label}
              <span className="ats-sec-count">{data.liquidaciones.length}</span>
            </h3>
            {data.liquidaciones.length === 0 ? (
              <p className="ats-empty">No hay liquidaciones autorizadas en este período.</p>
            ) : (
              <div className="ats-tabla-wrap">
                <table className="ats-tabla">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Fecha</th>
                      <th>Proveedor</th>
                      <th>Identificación</th>
                      <th>Base 0%</th>
                      <th>Base 15%</th>
                      <th>IVA 15%</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.liquidaciones.map(liq => (
                      <tr key={liq.id}>
                        <td className="ats-num">{liq.numeroLiquidacion}</td>
                        <td>{fmtFecha(liq.fechaEmision)}</td>
                        <td>{liq.razonSocialProveedor}</td>
                        <td>{liq.identificacionProveedor}</td>
                        <td className="ats-money">{fmt(liq.subtotal0)}</td>
                        <td className="ats-money">{fmt(liq.subtotal15)}</td>
                        <td className="ats-money">{fmt(liq.totalIva)}</td>
                        <td className="ats-money ats-money-total">{fmt(liq.importeTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="ats-tfoot">
                      <td colSpan={4}><strong>TOTALES</strong></td>
                      <td className="ats-money"><strong>{fmt(data.liquidaciones.reduce((s, l) => s + parseFloat(l.subtotal0 || 0), 0))}</strong></td>
                      <td className="ats-money"><strong>{fmt(data.liquidaciones.reduce((s, l) => s + parseFloat(l.subtotal15 || 0), 0))}</strong></td>
                      <td className="ats-money"><strong>{fmt(data.liquidaciones.reduce((s, l) => s + parseFloat(l.totalIva || 0), 0))}</strong></td>
                      <td className="ats-money ats-money-total"><strong>{fmt(data.totales.totalVentasLiquidaciones)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Tabla: Retenciones */}
          <div className="ats-seccion">
            <h3 className="ats-seccion-titulo">
              Comprobantes de Retención — {data.periodo.label}
              <span className="ats-sec-count">{data.retenciones.length}</span>
            </h3>
            {data.retenciones.length === 0 ? (
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
                      <th>Período Fiscal</th>
                      <th>Ret. Renta</th>
                      <th>Ret. IVA</th>
                      <th>Total Ret.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.retenciones.map(ret => {
                      const imps = Array.isArray(ret.impuestos) ? ret.impuestos : (typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : []);
                      const retRenta = imps.filter(i => String(i.codigo) === '1').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
                      const retIva   = imps.filter(i => String(i.codigo) === '2').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
                      return (
                        <tr key={ret.id}>
                          <td className="ats-num">{ret.numeroRetencion}</td>
                          <td>{fmtFecha(ret.fechaEmision)}</td>
                          <td>{ret.razonSocialProveedor}</td>
                          <td>{ret.identificacionProveedor}</td>
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
                      <td colSpan={5}><strong>TOTALES</strong></td>
                      <td className="ats-money">
                        <strong>{fmt(data.retenciones.reduce((s, ret) => {
                          const imps = Array.isArray(ret.impuestos) ? ret.impuestos : [];
                          return s + imps.filter(i => String(i.codigo) === '1').reduce((a, i) => a + parseFloat(i.valorRetenido || 0), 0);
                        }, 0))}</strong>
                      </td>
                      <td className="ats-money">
                        <strong>{fmt(data.retenciones.reduce((s, ret) => {
                          const imps = Array.isArray(ret.impuestos) ? ret.impuestos : [];
                          return s + imps.filter(i => String(i.codigo) === '2').reduce((a, i) => a + parseFloat(i.valorRetenido || 0), 0);
                        }, 0))}</strong>
                      </td>
                      <td className="ats-money ats-money-total"><strong>{fmt(data.totales.totalRetenciones)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {!data && !loading && (
        <div className="ats-placeholder">
          Seleccione el período y haga clic en <strong>Generar ATS</strong> para ver el resumen
          de transacciones autorizadas y descargar el XML para el SRI.
        </div>
      )}
    </div>
  );
}
