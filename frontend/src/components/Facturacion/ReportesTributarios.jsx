// ====================================
// REPORTES TRIBUTARIOS SRI
// frontend/src/components/Facturacion/ReportesTributarios.jsx
// Resumen mensual de IVA: Facturas + NC + Retenciones
// ====================================

import { useState, useCallback } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import './ReportesTributarios.css';
import { buildDataTable, buildKvTable, printHtmlReport } from '../../utils/reportPrint';

async function obtenerEmpresaParaReporte() {
  const stored = JSON.parse(localStorage.getItem('aela_empresa') || '{}');
  try {
    const { data: cfg } = await api.get('/facturas/configuracion');
    return {
      razonSocial: cfg.data?.razonSocial || stored.razonSocial || '',
      ruc:         cfg.data?.ruc         || stored.ruc         || '',
      direccion:   cfg.data?.dirMatriz   || stored.direccion   || '',
      telefono:    cfg.data?.telefono    || stored.telefono    || '',
      email:       cfg.data?.emailNotificaciones || stored.email || '',
      logoUrl:     cfg.data?.logoUrl     || null,
    };
  } catch {
    return {
      razonSocial: stored.razonSocial || '',
      ruc:         stored.ruc         || '',
      direccion:   stored.direccion   || '',
      telefono:    stored.telefono    || '',
      email:       stored.email       || '',
      logoUrl:     null,
    };
  }
}

export default function ReportesTributarios() {
  const hoy = new Date();
  const [mes,  setMes]  = useState(String(hoy.getMonth() + 1).padStart(2, '0'));
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: resp } = await api.get('/facturas/reportes/tributario', {
        params: { mes: parseInt(mes), anio: parseInt(anio) },
      });
      setData(resp.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al cargar el reporte');
    } finally {
      setLoading(false);
    }
  }, [mes, anio]);

  const meses = [
    { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' },
    { v: '04', l: 'Abril' }, { v: '05', l: 'Mayo' },    { v: '06', l: 'Junio' },
    { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' },  { v: '09', l: 'Septiembre' },
    { v: '10', l: 'Octubre' },{ v: '11', l: 'Noviembre' },{ v: '12', l: 'Diciembre' },
  ];

  const anios = Array.from({ length: 5 }, (_, i) => String(hoy.getFullYear() - i));

  const fmtFecha = (f) => f ? formatFechaCorta(f) : '-';
  const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

  const imprimirPDF = async () => {
    if (!data) return;
    const empresa = await obtenerEmpresaParaReporte();

    const resumenRows = [
      ['Período', data.periodo.label],
      ['Facturas', data.resumen.ventas.cantidadFacturas],
      ['Total facturado', fmt(data.resumen.ventas.importeTotal)],
      ['Notas de crédito', data.resumen.notasCredito.cantidad],
      ['Total NC', fmt(data.resumen.notasCredito.importeTotal)],
      ['Retenciones', data.resumen.retenciones.cantidad],
      ['Retención renta', fmt(data.resumen.retenciones.retencionRentaCobrada)],
      ['Retención IVA', fmt(data.resumen.retenciones.retencionIvaCobrada)],
      ['IVA neto', fmt(data.resumen.ivaNeto)],
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
      f.estadoSri,
    ]));

    const notasRows = (data.notasCredito || []).map((nc) => ([
      nc.numeroNC,
      fmtFecha(nc.fechaEmision),
      nc.razonSocialComprador,
      nc.identificacionComprador,
      fmt(nc.totalSinImpuestos),
      fmt(nc.totalIva),
      fmt(nc.importeTotal),
      nc.estadoSri,
    ]));

    const retRows = (data.retenciones || []).map((ret) => {
      const imps = typeof ret.impuestos === 'string'
        ? JSON.parse(ret.impuestos)
        : (ret.impuestos || []);
      const retRenta = imps.filter((i) => String(i.codigo) === '1').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
      const retIva = imps.filter((i) => String(i.codigo) === '2').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
      return [
        ret.numeroRetencion,
        fmtFecha(ret.fechaEmision),
        ret.razonSocialProveedor,
        ret.identificacionProveedor,
        fmt(retRenta),
        fmt(retIva),
        fmt(ret.totalRetenido),
        ret.estadoSri,
      ];
    });

    printHtmlReport({
      title: 'Reporte Tributario SRI',
      subtitle: data.periodo.label,
      empresa,
      sections: [
        { title: 'Resumen', html: buildKvTable(resumenRows) },
        {
          title: 'Facturas',
          html: buildDataTable(
            ['Número', 'Fecha', 'Comprador', 'Identificación', 'Base 0%', 'Base 15%', 'IVA', 'Total', 'Estado'],
            facturasRows,
          ),
        },
        {
          title: 'Notas de Crédito',
          html: buildDataTable(
            ['Número NC', 'Fecha', 'Comprador', 'Identificación', 'Base', 'IVA', 'Total NC', 'Estado'],
            notasRows,
          ),
        },
        {
          title: 'Retenciones',
          html: buildDataTable(
            ['Número', 'Fecha', 'Proveedor', 'Identificación', 'Ret. Renta', 'Ret. IVA', 'Total', 'Estado'],
            retRows,
          ),
        },
      ],
    });
  };

  return (
    <div className="rep-container">
      {/* Header */}
      <div className="rep-header">
        <h1 className="rep-title">Reportes Tributarios</h1>
        <p className="rep-subtitle">Resumen mensual de IVA — Formulario 104 referencial</p>
      </div>

      {/* Selector de período */}
      <div className="rep-periodo-box">
        <div className="rep-periodo-selector">
          <label>Mes:</label>
          <select value={mes} onChange={e => setMes(e.target.value)} className="rep-select">
            {meses.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
          <label>Año:</label>
          <select value={anio} onChange={e => setAnio(e.target.value)} className="rep-select">
            {anios.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn-generar-rep" onClick={cargar} disabled={loading}>
            {loading ? 'Cargando...' : 'Generar Reporte'}
          </button>
          <button
            type="button"
            className="btn-imprimir-rep"
            onClick={imprimirPDF}
            disabled={!data}
          >
            Imprimir PDF
          </button>
        </div>
      </div>

      {error && <div className="rep-error">{error}</div>}

      {data && (
        <>
          {/* ── RESUMEN (cuadros estilo Formulario 104) ────────────────────── */}
          <div className="rep-resumen-grid">

            {/* Ventas */}
            <div className="rep-card rep-card-ventas">
              <div className="rep-card-titulo">Ventas / Ingresos</div>
              <div className="rep-card-periodo">{data.periodo.label}</div>
              <div className="rep-card-rows">
                <div className="rep-card-row">
                  <span>Ventas tarifa 0%</span>
                  <strong>{fmt(data.resumen.ventas.subtotal0)}</strong>
                </div>
                <div className="rep-card-row">
                  <span>Ventas tarifa 15%</span>
                  <strong>{fmt(data.resumen.ventas.subtotal15)}</strong>
                </div>
                <div className="rep-card-row rep-card-row-total">
                  <span>IVA Cobrado (15%)</span>
                  <strong>{fmt(data.resumen.ventas.totalIva)}</strong>
                </div>
                <div className="rep-card-row rep-card-row-subtotal">
                  <span>Total Facturado</span>
                  <strong>{fmt(data.resumen.ventas.importeTotal)}</strong>
                </div>
                <div className="rep-card-badge">
                  {data.resumen.ventas.cantidadFacturas} facturas
                </div>
              </div>
            </div>

            {/* Notas de Crédito */}
            <div className="rep-card rep-card-nc">
              <div className="rep-card-titulo">Notas de Crédito</div>
              <div className="rep-card-periodo">{data.periodo.label}</div>
              <div className="rep-card-rows">
                <div className="rep-card-row">
                  <span>Base sin impuestos</span>
                  <strong>{fmt(data.resumen.notasCredito.totalSinImpuestos)}</strong>
                </div>
                <div className="rep-card-row rep-card-row-total">
                  <span>IVA en NC</span>
                  <strong>{fmt(data.resumen.notasCredito.totalIva)}</strong>
                </div>
                <div className="rep-card-row rep-card-row-subtotal">
                  <span>Total NC</span>
                  <strong>{fmt(data.resumen.notasCredito.importeTotal)}</strong>
                </div>
                <div className="rep-card-badge">
                  {data.resumen.notasCredito.cantidad} notas de crédito
                </div>
              </div>
            </div>

            {/* Retenciones */}
            <div className="rep-card rep-card-ret">
              <div className="rep-card-titulo">Retenciones Emitidas</div>
              <div className="rep-card-periodo">{data.periodo.label}</div>
              <div className="rep-card-rows">
                <div className="rep-card-row">
                  <span>Ret. de Renta (IR)</span>
                  <strong>{fmt(data.resumen.retenciones.retencionRentaCobrada)}</strong>
                </div>
                <div className="rep-card-row rep-card-row-total">
                  <span>Ret. de IVA</span>
                  <strong>{fmt(data.resumen.retenciones.retencionIvaCobrada)}</strong>
                </div>
                <div className="rep-card-badge">
                  {data.resumen.retenciones.cantidad} comprobantes
                </div>
              </div>
            </div>

            {/* IVA Resultante */}
            <div className={`rep-card rep-card-iva ${data.resumen.ivaNeto >= 0 ? 'positivo' : 'negativo'}`}>
              <div className="rep-card-titulo">IVA a Declarar</div>
              <div className="rep-card-periodo">Referencial — Formulario 104</div>
              <div className="rep-iva-formula">
                <div className="rep-formula-row">
                  <span>IVA cobrado en ventas</span>
                  <span>{fmt(data.resumen.ventas.totalIva)}</span>
                </div>
                <div className="rep-formula-row rep-formula-menos">
                  <span>(-) IVA en NC emitidas</span>
                  <span>- {fmt(data.resumen.notasCredito.totalIva)}</span>
                </div>
                <div className="rep-formula-row rep-formula-menos">
                  <span>(-) Ret. de IVA emitidas</span>
                  <span>- {fmt(data.resumen.retenciones.retencionIvaCobrada)}</span>
                </div>
                <div className="rep-formula-total">
                  <span>IVA NETO</span>
                  <strong className={data.resumen.ivaNeto >= 0 ? 'iva-positivo' : 'iva-negativo'}>
                    {fmt(data.resumen.ivaNeto)}
                  </strong>
                </div>
              </div>
              <p className="rep-iva-nota">
                * Este resumen es referencial. Consulte a su contador para la declaración oficial.
              </p>
            </div>
          </div>

          {/* ── TABLA: FACTURAS ──────────────────────────────────────────────── */}
          <div className="rep-seccion">
            <h3 className="rep-seccion-titulo">
              Facturas emitidas — {data.periodo.label}
              <span className="rep-sec-count">{data.facturas.length}</span>
            </h3>
            {data.facturas.length === 0 ? (
              <p className="rep-empty">No hay facturas en este período.</p>
            ) : (
              <div className="rep-tabla-wrap">
                <table className="rep-tabla">
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
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.facturas.map(f => (
                      <tr key={f.id}>
                        <td className="rep-num">{f.numeroFactura}</td>
                        <td>{fmtFecha(f.fechaEmision)}</td>
                        <td>{f.razonSocialComprador}</td>
                        <td>{f.identificacionComprador}</td>
                        <td className="rep-money">{fmt(f.subtotal0)}</td>
                        <td className="rep-money">{fmt(f.subtotal15)}</td>
                        <td className="rep-money">{fmt(f.totalIva)}</td>
                        <td className="rep-money rep-money-total">{fmt(f.importeTotal)}</td>
                        <td>
                          <span className={`rep-badge ${f.estadoSri === 'AUTORIZADO' ? 'badge-success' : 'badge-warning'}`}>
                            {f.estadoSri}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="rep-tfoot">
                      <td colSpan={4}><strong>TOTALES</strong></td>
                      <td className="rep-money"><strong>{fmt(data.resumen.ventas.subtotal0)}</strong></td>
                      <td className="rep-money"><strong>{fmt(data.resumen.ventas.subtotal15)}</strong></td>
                      <td className="rep-money"><strong>{fmt(data.resumen.ventas.totalIva)}</strong></td>
                      <td className="rep-money rep-money-total"><strong>{fmt(data.resumen.ventas.importeTotal)}</strong></td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* ── TABLA: NOTAS DE CRÉDITO ──────────────────────────────────────── */}
          {data.notasCredito.length > 0 && (
            <div className="rep-seccion">
              <h3 className="rep-seccion-titulo">
                Notas de Crédito — {data.periodo.label}
                <span className="rep-sec-count">{data.notasCredito.length}</span>
              </h3>
              <div className="rep-tabla-wrap">
                <table className="rep-tabla">
                  <thead>
                    <tr>
                      <th>Número NC</th>
                      <th>Fecha</th>
                      <th>Comprador</th>
                      <th>Identificación</th>
                      <th>Base</th>
                      <th>IVA</th>
                      <th>Total NC</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.notasCredito.map(nc => (
                      <tr key={nc.id}>
                        <td className="rep-num">{nc.numeroNC}</td>
                        <td>{fmtFecha(nc.fechaEmision)}</td>
                        <td>{nc.razonSocialComprador}</td>
                        <td>{nc.identificacionComprador}</td>
                        <td className="rep-money">{fmt(nc.totalSinImpuestos)}</td>
                        <td className="rep-money">{fmt(nc.totalIva)}</td>
                        <td className="rep-money rep-money-total">{fmt(nc.importeTotal)}</td>
                        <td>
                          <span className={`rep-badge ${nc.estadoSri === 'AUTORIZADO' ? 'badge-success' : 'badge-warning'}`}>
                            {nc.estadoSri}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── TABLA: RETENCIONES ───────────────────────────────────────────── */}
          {data.retenciones.length > 0 && (
            <div className="rep-seccion">
              <h3 className="rep-seccion-titulo">
                Comprobantes de Retención — {data.periodo.label}
                <span className="rep-sec-count">{data.retenciones.length}</span>
              </h3>
              <div className="rep-tabla-wrap">
                <table className="rep-tabla">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Fecha</th>
                      <th>Proveedor</th>
                      <th>Identificación</th>
                      <th>Ret. Renta</th>
                      <th>Ret. IVA</th>
                      <th>Total Ret.</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.retenciones.map(ret => {
                      const imps = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
                      const retRenta = imps.filter(i => String(i.codigo) === '1').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
                      const retIva   = imps.filter(i => String(i.codigo) === '2').reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);
                      return (
                        <tr key={ret.id}>
                          <td className="rep-num">{ret.numeroRetencion}</td>
                          <td>{fmtFecha(ret.fechaEmision)}</td>
                          <td>{ret.razonSocialProveedor}</td>
                          <td>{ret.identificacionProveedor}</td>
                          <td className="rep-money">{fmt(retRenta)}</td>
                          <td className="rep-money">{fmt(retIva)}</td>
                          <td className="rep-money rep-money-total">{fmt(ret.totalRetenido)}</td>
                          <td>
                            <span className={`rep-badge ${ret.estadoSri === 'AUTORIZADO' ? 'badge-success' : 'badge-warning'}`}>
                              {ret.estadoSri}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="rep-placeholder">
          Seleccione el período y haga clic en <strong>Generar Reporte</strong> para ver el resumen tributario del mes.
        </div>
      )}
    </div>
  );
}
