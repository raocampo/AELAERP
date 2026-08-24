// ====================================
// MÓDULO DECLARACIONES TRIBUTARIAS
// F104 — IVA mensual
// F103 — Retenciones en la Fuente mensual
// F101 — Resumen anual IR
// ====================================

import { useCallback, useState, useEffect, Component } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';

// ─── ErrorBoundary — evita pantalla en blanco por crash de render ─────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="alert-danger" style={{ margin: '16px 0' }}>
          <strong>Error al mostrar declaración:</strong> {this.state.error.message}
          <br />
          <button
            className="btn-secondary"
            style={{ marginTop: 10, fontSize: 12 }}
            onClick={() => this.setState({ error: null })}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import './Declaraciones.css';

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

function fmt(v) { return `$${parseFloat(v || 0).toFixed(2)}`; }
function fmtNum(v) { return parseFloat(v || 0).toFixed(2); }

const anioActual = new Date().getFullYear();
const mesActual  = new Date().getMonth() + 1;

export default function Declaraciones() {
  const [tab, setTab]     = useState('f104');
  const [anio, setAnio]   = useState(anioActual);
  const [mes, setMes]     = useState(mesActual);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cambiarTab = (nuevoTab) => {
    setData(null);
    setError('');
    setTab(nuevoTab);
  };

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const endpoint = tab === 'f101'
        ? `/declaraciones/f101?anio=${anio}`
        : `/declaraciones/${tab}?anio=${anio}&mes=${mes}`;
      const { data: resp } = await api.get(endpoint);
      setData(resp.data);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al cargar declaración');
    } finally {
      setLoading(false);
    }
  }, [anio, mes, tab]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="declaraciones-container">
      <h2 className="declaraciones-title">Declaraciones Tributarias</h2>
      <p className="declaraciones-subtitle">
        Resumen de datos para el llenado de formularios SRI. No reemplaza el sistema oficial DIMM.
      </p>

      {/* Tabs */}
      <div className="decl-tabs">
        {[
          { id: 'f104', label: 'F104 — IVA Mensual' },
          { id: 'f103', label: 'F103 — Retenciones' },
          { id: 'f101', label: 'F101 — Resumen IR Anual' },
        ].map((t) => (
          <button key={t.id} className={`decl-tab ${tab === t.id ? 'active' : ''}`} onClick={() => cambiarTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Período */}
      <div className="decl-periodo">
        <label>Año</label>
        <select value={anio} onChange={(e) => setAnio(parseInt(e.target.value))}>
          {Array.from({ length: anioActual - 2019 }, (_, i) => anioActual - i).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {tab !== 'f101' && (
          <>
            <label>Mes</label>
            <select value={mes} onChange={(e) => setMes(parseInt(e.target.value))}>
              {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </>
        )}
        <button className="btn-primary" onClick={cargar} disabled={loading}>
          {loading ? 'Cargando...' : 'Actualizar'}
        </button>
      </div>

      {error && <div className="alert-danger">{error}</div>}

      {loading && <div className="decl-loading">Calculando datos...</div>}

      {data && tab === 'f104' && <ErrorBoundary key="f104"><F104View data={data} onRecargar={cargar} /></ErrorBoundary>}
      {data && tab === 'f103' && <ErrorBoundary key="f103"><F103View data={data} /></ErrorBoundary>}
      {data && tab === 'f101' && <ErrorBoundary key="f101"><F101View data={data} /></ErrorBoundary>}
    </div>
  );
}

// ─── F104 ────────────────────────────────────────────────────────────────────────
function F104View({ data, onRecargar }) {
  if (!data?.ventas || !data?.resultado) return null;
  const { ventas, compras, retenciones, retencionesEmitidas, resultado, meta } = data;
  const esDebito  = resultado.ivaACobrarPagar > 0;
  const esCredito = resultado.ivaACobrarPagar < 0;
  const { anio, mes } = data.periodo;
  const [vista, setVista] = useState('resumen'); // 'resumen' | 'formulario'

  const descargarPdf = async () => {
    try {
      const res = await api.get(`/declaraciones/f104/pdf?anio=${anio}&mes=${mes}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.setAttribute('download', `f104_${anio}_${String(mes).padStart(2, '0')}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo generar el PDF del Formulario 104');
    }
  };

  return (
    <div className="decl-formulario">
      <div className="decl-formulario-header">
        <span className="decl-form-badge">Formulario 104</span>
        <span>IVA Mensual — {MESES[mes - 1]} {anio}</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <div className="decl-vista-toggle">
            <button className={vista === 'resumen' ? 'active' : ''} onClick={() => setVista('resumen')}>Resumen</button>
            <button className={vista === 'formulario' ? 'active' : ''} onClick={() => setVista('formulario')}>Formulario</button>
          </div>
          <button className="btn-secondary" onClick={descargarPdf}>
            📄 Generar Formulario (PDF)
          </button>
        </div>
      </div>

      {vista === 'formulario' && data.casilleros && <F104FormularioView casilleros={data.casilleros} />}

      {vista === 'resumen' && (
      <div className="decl-secciones">
        {/* VENTAS */}
        <section className="decl-seccion">
          <h3>Ventas / Ingresos</h3>
          <FilaDecl label="Ventas tarifa 0%" valor={fmtNum(ventas.subtotalNeto0)} />
          {ventas.subtotalNeto5 > 0 && <FilaDecl label="Ventas tarifa 5%" valor={fmtNum(ventas.subtotalNeto5)} />}
          <FilaDecl label="Ventas tarifa 15%" valor={fmtNum(ventas.subtotalNeto15)} />
          {ventas.subtotalNoObjeto > 0 && <FilaDecl label="Ventas no objeto / exentas de IVA" valor={fmtNum(ventas.subtotalNoObjeto)} />}
          <FilaDecl label="IVA cobrado en ventas" valor={fmtNum(ventas.ivaGenerado)} highlight />
          {ventas.notasCredito.iva > 0 && (
            <FilaDecl label="(-) Notas de crédito IVA" valor={`-${fmtNum(ventas.notasCredito.iva)}`} warn />
          )}
        </section>

        {/* COMPRAS */}
        <section className="decl-seccion">
          <h3>Compras / Gastos</h3>
          <FilaDecl label="Compras tarifa 0%" valor={fmtNum(compras.subtotal0)} />
          {compras.subtotal5 > 0 && <FilaDecl label="Compras tarifa 5%" valor={fmtNum(compras.subtotal5)} />}
          <FilaDecl label="Compras tarifa 15%" valor={fmtNum(compras.subtotal15)} />
          {compras.subtotalNoObjeto > 0 && <FilaDecl label="Compras no objeto de IVA" valor={fmtNum(compras.subtotalNoObjeto)} />}
          {compras.subtotalExento > 0 && <FilaDecl label="Compras exentas de IVA" valor={fmtNum(compras.subtotalExento)} />}
          {compras.liquidaciones.iva > 0 && (
            <FilaDecl label="IVA en liquidaciones de compra" valor={fmtNum(compras.liquidaciones.iva)} />
          )}
          {compras.ncRecibidas?.iva > 0 && (
            <FilaDecl label={`(-) NC recibidas de proveedores (${compras.ncRecibidas.cantidad})`} valor={`-${fmtNum(compras.ncRecibidas.iva)}`} warn />
          )}
          <FilaDecl label="IVA crédito fiscal total" valor={fmtNum(compras.ivaCreditoFiscal)} highlight />
        </section>

        {/* RETENCIONES */}
        {(retenciones.iva30 > 0 || retenciones.iva70 > 0 || retenciones.iva100 > 0 || retenciones.otro > 0) && (
          <section className="decl-seccion">
            <h3>Retenciones de IVA recibidas</h3>
            <p className="decl-seccion-hint">IVA que sus clientes (agentes de retención) le retuvieron al pagarle — reduce el IVA a pagar de este período.</p>
            {retenciones.iva30  > 0 && <FilaDecl label="Retención 30% IVA" valor={fmtNum(retenciones.iva30)} />}
            {retenciones.iva70  > 0 && <FilaDecl label="Retención 70% IVA" valor={fmtNum(retenciones.iva70)} />}
            {retenciones.iva100 > 0 && <FilaDecl label="Retención 100% IVA" valor={fmtNum(retenciones.iva100)} />}
            {retenciones.otro   > 0 && <FilaDecl label="Retención IVA (otro %)" valor={fmtNum(retenciones.otro)} />}
            <FilaDecl label="Total retenido por clientes" valor={fmtNum(retenciones.totalRetenido)} highlight />
          </section>
        )}

        {/* RETENCIONES EMITIDAS — agente de retención de IVA a proveedores */}
        {retencionesEmitidas?.ivaRetenidoAProveedores > 0 && (
          <section className="decl-seccion">
            <h3>Agente de retención de IVA (a proveedores)</h3>
            <p className="decl-seccion-hint">IVA que su empresa retuvo a sus proveedores al pagarles — es una obligación aparte, se suma al total a pagar (casillero 799/801/859).</p>
            {retencionesEmitidas.iva10  > 0 && <FilaDecl label="Retención 10% IVA" valor={fmtNum(retencionesEmitidas.iva10)} />}
            {retencionesEmitidas.iva20  > 0 && <FilaDecl label="Retención 20% IVA" valor={fmtNum(retencionesEmitidas.iva20)} />}
            {retencionesEmitidas.iva30  > 0 && <FilaDecl label="Retención 30% IVA" valor={fmtNum(retencionesEmitidas.iva30)} />}
            {retencionesEmitidas.iva50  > 0 && <FilaDecl label="Retención 50% IVA" valor={fmtNum(retencionesEmitidas.iva50)} />}
            {retencionesEmitidas.iva70  > 0 && <FilaDecl label="Retención 70% IVA" valor={fmtNum(retencionesEmitidas.iva70)} />}
            {retencionesEmitidas.iva100 > 0 && <FilaDecl label="Retención 100% IVA" valor={fmtNum(retencionesEmitidas.iva100)} />}
            <FilaDecl label="Total retenido a proveedores" valor={fmtNum(retencionesEmitidas.ivaRetenidoAProveedores)} highlight />
          </section>
        )}

        {/* CRÉDITO TRIBUTARIO ARRASTRADO */}
        <CreditoAnteriorSection
          anio={data.periodo.anio}
          mes={data.periodo.mes}
          resultado={resultado}
          onRecargar={onRecargar}
        />

        {/* RESULTADO */}
        <section className={`decl-resultado ${esDebito ? 'a-pagar' : esCredito ? 'credito' : 'cero'}`}>
          <div className="decl-resultado-label">
            {esDebito ? '⚠️ IVA a PAGAR al SRI' : esCredito ? '✅ Crédito tributario a favor' : '✅ Declaración en cero'}
          </div>
          <div className="decl-resultado-valor">
            {esDebito ? fmt(resultado.ivaACobrarPagar) : fmt(Math.abs(resultado.ivaACobrarPagar))}
          </div>
          {esCredito && (
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>
              Saldo para el próximo mes — 615 (adquisiciones): {fmt(resultado.saldoCreditoAdquisicionesProximoMes)} · 617 (retenciones): {fmt(resultado.saldoCreditoRetencionesProximoMes)}
            </div>
          )}
          {retencionesEmitidas?.ivaRetenidoAProveedores > 0 && (
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>
              + {fmt(retencionesEmitidas.ivaRetenidoAProveedores)} de retención a proveedores (799/801) → Total consolidado (859): {fmt(resultado.totalConsolidado)}
            </div>
          )}
        </section>

        <div className="decl-meta">
          <span>{meta.cantidadFacturas} facturas</span>
          <span>{meta.cantidadCompras} compras</span>
          {meta.cantidadLiquidaciones > 0 && <span>{meta.cantidadLiquidaciones} liquidaciones</span>}
          {meta.cantidadRetencionesRecibidas > 0 && <span>{meta.cantidadRetencionesRecibidas} retenciones recibidas</span>}
        </div>

        {meta.comprasExcluidasCedula > 0 && (
          <div className="alert-danger" style={{ marginTop: 8, fontSize: 12 }}>
            ⚠️ {meta.comprasExcluidasCedula} compra(s) de este período están facturadas a una cédula personal, no al RUC
            de la empresa — no se incluyeron en este cálculo. Si el proveedor puede reemitir el comprobante a nombre del
            RUC, pídeselo; si corresponde a la actividad económica y no es posible reemitirlo, en Compras → Editar puedes
            marcarla como "Revisado por contador" para que sí cuente aquí.
          </div>
        )}
        {meta.gastosPersonalesExcluidos > 0 && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#fffbeb', border: '1px solid #f59e0b', fontSize: 12, color: '#92400e' }}>
            ℹ️ {meta.gastosPersonalesExcluidos} compra(s) marcada(s) como <strong>gasto personal</strong> fueron excluidas
            de esta declaración. Los gastos personales (alimentación, salud, vivienda, vestimenta, educación) no generan
            crédito de IVA — son deducibles del Impuesto a la Renta (F102).
          </div>
        )}
        {meta.desglose && (meta.desglose.liquidaciones0 > 0 || meta.desglose.liquidaciones15 > 0) && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: '#f0f9ff', border: '1px solid #7dd3fc', fontSize: 12, color: '#075985' }}>
            📊 Desglose de compras: facturas 0%: ${meta.desglose.facturasCompra0.toFixed(2)},
            facturas 15%: ${meta.desglose.facturasCompra15.toFixed(2)};
            liquidaciones 0%: ${meta.desglose.liquidaciones0.toFixed(2)},
            liquidaciones 15%: ${meta.desglose.liquidaciones15.toFixed(2)}.
            {(meta.desglose.liquidaciones0 > 0 || meta.desglose.liquidaciones15 > 0) && (
              <> Las liquidaciones de compra son documentos separados (no aparecen en Facturas de Compra).</>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ─── Vista "tipo formulario" — replica el layout del F104 oficial (Casillero
// + Descripción + valores) en pantalla, usando data.casilleros que ya calculó
// el backend (mismos números que el PDF, un solo lugar de cómputo) ─────────
function F104FormularioView({ casilleros }) {
  const TablaCasillero = ({ titulo, filas, columnas }) => (
    <div className="decl-formvista-seccion">
      <h4>{titulo}</h4>
      <table className="decl-tabla decl-tabla-formvista">
        <thead>
          <tr>
            <th style={{ width: 110 }}>Casillero</th>
            <th>Descripción</th>
            {columnas.map((c) => <th key={c.key} style={{ textAlign: 'right', width: 120 }}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className={f.destacado ? 'decl-tabla-total' : ''}>
              <td><span className="decl-formvista-cas">{f.cas}</span></td>
              <td>{f.desc}</td>
              {columnas.map((c) => (
                <td key={c.key} style={{ textAlign: 'right' }}>{f[c.key] == null ? '—' : fmt(f[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="decl-formvista">
      <TablaCasillero titulo="RESUMEN DE VENTAS Y OTRAS OPERACIONES" filas={casilleros.ventas} columnas={[{ key: 'base', label: 'Base Imp.' }, { key: 'iva', label: 'IVA' }]} />
      <TablaCasillero titulo="RESUMEN DE ADQUISICIONES Y PAGOS" filas={casilleros.compras} columnas={[{ key: 'base', label: 'Base Imp.' }, { key: 'iva', label: 'IVA' }]} />
      <TablaCasillero titulo="FACTOR DE PROPORCIONALIDAD Y CRÉDITO TRIBUTARIO" filas={casilleros.factorProporcionalidad} columnas={[{ key: 'valor', label: 'Valor' }]} />
      <TablaCasillero titulo="RESUMEN IMPOSITIVO: AGENTE DE PERCEPCIÓN DEL IVA" filas={casilleros.resumenImpositivo} columnas={[{ key: 'valor', label: 'Valor' }]} />
      <TablaCasillero titulo="AGENTE DE RETENCIÓN DEL IVA (a proveedores)" filas={casilleros.agenteRetencion} columnas={[{ key: 'valor', label: 'Valor' }]} />
      <p className="decl-formvista-nota">
        Documento de apoyo — no es el formulario oficial ni lo reemplaza. Verifique cada casillero contra "SRI en Línea" antes de presentar la declaración.
      </p>
    </div>
  );
}

// ─── Crédito tributario arrastrado del mes anterior — 605 (adquisiciones) y
// 606 (retenciones) por separado desde 2026-08-19, antes era un solo valor
// combinado ─────────────────────────────────────────────────────────────────
function CreditoAnteriorSection({ anio, mes, resultado, onRecargar }) {
  const [valorAdq, setValorAdq] = useState(String(resultado.creditoPorAdquisicionesAnterior ?? 0));
  const [valorRet, setValorRet] = useState(String(resultado.creditoPorRetencionesAnterior ?? 0));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setValorAdq(String(resultado.creditoPorAdquisicionesAnterior ?? 0));
    setValorRet(String(resultado.creditoPorRetencionesAnterior ?? 0));
    setMsg('');
  }, [anio, mes, resultado.creditoPorAdquisicionesAnterior, resultado.creditoPorRetencionesAnterior]);

  const guardar = async () => {
    const montoAdq = parseFloat(valorAdq);
    const montoRet = parseFloat(valorRet);
    if (Number.isNaN(montoAdq) || montoAdq < 0 || Number.isNaN(montoRet) || montoRet < 0) {
      setMsg('Ingresa montos válidos (0 o mayor) en ambos campos.');
      return;
    }
    setGuardando(true);
    setMsg('');
    try {
      await api.put('/declaraciones/f104/credito-anterior', {
        anio, mes, creditoPorAdquisiciones: montoAdq, creditoPorRetenciones: montoRet,
      });
      setMsg('Guardado.');
      onRecargar?.();
    } catch (err) {
      setMsg(err.response?.data?.mensaje || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <section className="decl-seccion">
      <h3>Crédito tributario arrastrado del mes anterior</h3>
      <p className="decl-seccion-hint">
        Ingresa el saldo a favor que arrastras de tu última declaración real ante el SRI, separado por casillero
        — el 605 arrastra el 615 y el 606 arrastra el 617 de la declaración de {MESES[mes - 1]} {anio} anterior.
        Este sistema no lo calcula encadenando meses automáticamente, se guarda una vez por período.
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>605 · Por adquisiciones e importaciones</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>$</span>
            <input
              type="number" min="0" step="0.01" value={valorAdq}
              onChange={(e) => setValorAdq(e.target.value)}
              style={{ width: 130, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>606 · Por retenciones de IVA efectuadas</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>$</span>
            <input
              type="number" min="0" step="0.01" value={valorRet}
              onChange={(e) => setValorRet(e.target.value)}
              style={{ width: 130, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
        {msg && <span style={{ fontSize: 12, color: msg === 'Guardado.' ? '#22c55e' : '#ef4444' }}>{msg}</span>}
        {!resultado.creditoTributarioGuardado && (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>(sin guardar para este período — usando $0.00)</span>
        )}
      </div>
      {(resultado.creditoPorAdquisicionesAnterior > 0 || resultado.creditoPorRetencionesAnterior > 0) && (
        <>
          {resultado.creditoPorAdquisicionesAnterior > 0 && (
            <FilaDecl label="(-) 605 Crédito mes anterior (adquisiciones)" valor={`-${fmtNum(resultado.creditoPorAdquisicionesAnterior)}`} warn />
          )}
          {resultado.creditoPorRetencionesAnterior > 0 && (
            <FilaDecl label="(-) 606 Crédito mes anterior (retenciones)" valor={`-${fmtNum(resultado.creditoPorRetencionesAnterior)}`} warn />
          )}
        </>
      )}
    </section>
  );
}

// ─── F103 ────────────────────────────────────────────────────────────────────────
function F103View({ data }) {
  if (!data?.periodo || !Array.isArray(data?.detallePorCodigo)) return null;
  const { detallePorCodigo, totalRetenido, cantidadComprobantes, meta } = data;
  const { anio, mes } = data.periodo;
  const [vista, setVista] = useState('resumen'); // 'resumen' | 'formulario'

  const descargarPdf = async () => {
    try {
      const res = await api.get(`/declaraciones/f103/pdf?anio=${anio}&mes=${mes}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.setAttribute('download', `f103_${anio}_${String(mes).padStart(2, '0')}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo generar el PDF del Formulario 103');
    }
  };

  return (
    <div className="decl-formulario">
      <div className="decl-formulario-header">
        <span className="decl-form-badge">Formulario 103</span>
        <span>Retenciones en la Fuente — {MESES[mes - 1]} {anio}</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <div className="decl-vista-toggle">
            <button className={vista === 'resumen' ? 'active' : ''} onClick={() => setVista('resumen')}>Resumen</button>
            <button className={vista === 'formulario' ? 'active' : ''} onClick={() => setVista('formulario')}>Formulario</button>
          </div>
          <button className="btn-secondary" onClick={descargarPdf}>
            📄 Generar Formulario (PDF)
          </button>
        </div>
      </div>

      {vista === 'formulario' && data.casilleros ? (
        <F103FormularioView casilleros={data.casilleros} />
      ) : (
      <>
      <div className="decl-meta" style={{ marginBottom: 16 }}>
        <span>{cantidadComprobantes} comprobantes</span>
        <span>{meta.comprobantesAutorizados} autorizados</span>
        {meta.comprobantesPendientes > 0 && (
          <span style={{ color: '#fbbf24' }}>{meta.comprobantesPendientes} pendientes de autorización</span>
        )}
      </div>

      {detallePorCodigo.length === 0 ? (
        <div style={{ padding: 24, color: '#94a3b8', textAlign: 'center' }}>
          No hay retenciones en la fuente en este período
        </div>
      ) : (
        <table className="decl-tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descripción</th>
              <th>%</th>
              <th>Base Imponible</th>
              <th>Valor Retenido</th>
              <th>Comprobantes</th>
            </tr>
          </thead>
          <tbody>
            {detallePorCodigo.map((r) => (
              <tr key={r.codigo}>
                <td>{r.codigo}</td>
                <td>{r.descripcion}</td>
                <td>{r.porcentaje}%</td>
                <td>{fmt(r.baseImponible)}</td>
                <td style={{ fontWeight: 600 }}>{fmt(r.valorRetenido)}</td>
                <td>{r.cantidad}</td>
              </tr>
            ))}
            <tr className="decl-tabla-total">
              <td colSpan={4}>TOTAL RETENIDO EN LA FUENTE</td>
              <td style={{ fontWeight: 700 }}>{fmt(totalRetenido)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )}

      {data.proveedores?.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 13 }}>
            Ver detalle por proveedor ({data.proveedores.length})
          </summary>
          <table className="decl-tabla" style={{ marginTop: 12 }}>
            <thead>
              <tr><th>Identificación</th><th>Razón Social</th><th>Comprobantes</th><th>Total retenido</th></tr>
            </thead>
            <tbody>
              {data.proveedores.map((p) => (
                <tr key={p.identificacion}>
                  <td>{p.identificacion}</td>
                  <td>{p.razonSocial}</td>
                  <td>{p.comprobantes}</td>
                  <td>{fmt(p.totalRetenido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      </>
      )}
    </div>
  );
}

// ─── Vista "tipo formulario" del F103 — replica el layout del formulario
// oficial (Casillero + Descripción + valores) usando data.casilleros que ya
// calculó el backend (mismos números que el PDF, un solo lugar de cómputo) ──
function F103FormularioView({ casilleros }) {
  const { filas, sinCasillero } = casilleros;
  return (
    <div className="decl-formvista">
      <div className="decl-formvista-seccion">
        <h4>DETALLE POR CÓDIGO DE RETENCIÓN</h4>
        <table className="decl-tabla decl-tabla-formvista">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Cas. Base</th>
              <th style={{ width: 90 }}>Cas. Ret.</th>
              <th>Descripción</th>
              <th style={{ textAlign: 'right', width: 70 }}>%</th>
              <th style={{ textAlign: 'right', width: 120 }}>Base Imp.</th>
              <th style={{ textAlign: 'right', width: 120 }}>Val. Retenido</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className={f.destacado ? 'decl-tabla-total' : ''}>
                <td>{f.mapeado ? <span className="decl-formvista-cas">{f.casBase}</span> : <span className="decl-formvista-cas decl-formvista-cas-warn">(!)</span>}</td>
                <td>{f.mapeado ? <span className="decl-formvista-cas">{f.casRetenido || '—'}</span> : <span className="decl-formvista-cas decl-formvista-cas-warn">(!)</span>}</td>
                <td>{f.codigo ? `${f.descripcion} (código ${f.codigo})` : f.descripcion}</td>
                <td style={{ textAlign: 'right' }}>{f.porcentaje == null ? '—' : `${f.porcentaje}%`}</td>
                <td style={{ textAlign: 'right' }}>{fmt(f.baseImponible)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(f.valorRetenido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sinCasillero.length > 0 && (
        <p style={{ fontSize: 12, color: '#b45309', margin: 0 }}>
          ⚠ {sinCasillero.length} código(s) sin casillero confirmado (marcados con "(!)") — verificar manualmente contra "SRI en Línea": {sinCasillero.join(', ')}.
        </p>
      )}
      <p className="decl-formvista-nota">
        Documento de apoyo — no es el formulario oficial ni lo reemplaza. Verifique cada casillero contra "SRI en Línea" antes de presentar la declaración.
      </p>
    </div>
  );
}

// ─── F101 ────────────────────────────────────────────────────────────────────────
function F101View({ data }) {
  if (!data?.ingresos || !data?.gastos || !data?.retenciones) return null;
  const { ingresos, gastos, retenciones, nota } = data;
  const utilidadBruta = ingresos.totalFacturado - gastos.totalCompras;
  const [vista, setVista] = useState('resumen'); // 'resumen' | 'formulario'

  const descargarPdf = async () => {
    try {
      const res = await api.get(`/declaraciones/f101/pdf?anio=${data.anio}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.setAttribute('download', `f101_${data.anio}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo generar el PDF del Formulario 101');
    }
  };

  return (
    <div className="decl-formulario">
      <div className="decl-formulario-header">
        <span className="decl-form-badge">F101</span>
        <span>Resumen Anual IR — {data.anio}</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <div className="decl-vista-toggle">
            <button className={vista === 'resumen' ? 'active' : ''} onClick={() => setVista('resumen')}>Resumen</button>
            <button className={vista === 'formulario' ? 'active' : ''} onClick={() => setVista('formulario')}>Formulario</button>
          </div>
          <button className="btn-secondary" onClick={descargarPdf}>
            📄 Generar Formulario (PDF)
          </button>
        </div>
      </div>

      {vista === 'formulario' && data.casilleros ? (
        <F101FormularioView casilleros={data.casilleros} balance={data.balance} anticipoIR={data.anticipoIR} />
      ) : (
      <div className="decl-secciones">
        <section className="decl-seccion">
          <h3>Ingresos del ejercicio</h3>
          <FilaDecl label="Total facturado" valor={fmtNum(ingresos.totalFacturado)} />
          <FilaDecl label="IVA cobrado" valor={fmtNum(ingresos.totalIvaVentas)} />
          <FilaDecl label="Cantidad de facturas emitidas" valor={ingresos.cantidadFacturas} />
        </section>

        <section className="decl-seccion">
          <h3>Costos y Gastos</h3>
          <FilaDecl label="Total en compras/gastos" valor={fmtNum(gastos.totalCompras)} />
          <FilaDecl label="IVA en compras" valor={fmtNum(gastos.totalIvaCompras)} />
          <FilaDecl label="Cantidad de compras registradas" valor={gastos.cantidadCompras} />
        </section>

        <section className="decl-seccion">
          <h3>Retenciones</h3>
          <FilaDecl label="Comprobantes de retención emitidos" valor={retenciones.cantidadComprobantes} />
          {retenciones.totalRetencionRentaRecibida > 0 && (
            <FilaDecl label="Retención de renta recibida en el año" valor={fmtNum(retenciones.totalRetencionRentaRecibida)} />
          )}
        </section>

        <section className={`decl-resultado ${utilidadBruta >= 0 ? 'credito' : 'a-pagar'}`}>
          <div className="decl-resultado-label">Utilidad bruta estimada</div>
          <div className="decl-resultado-valor">{fmt(utilidadBruta)}</div>
        </section>

        <div className="alert-info" style={{ marginTop: 16, fontSize: 12 }}>
          ⚠️ {nota}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Vista "tipo formulario" del F101 — solo los ~7 casilleros que AELA
// puede respaldar con datos reales (ingresos/costos netos, utilidad
// contable, retención de renta recibida y, si Contabilidad está activa,
// Activo/Pasivo/Patrimonio). El F101 real tiene 869 casilleros — ver el
// aviso y la nota al pie sobre lo que queda fuera. ──────────────────────────
function F101FormularioView({ casilleros, balance, anticipoIR }) {
  return (
    <div className="decl-formvista">
      <div className="decl-formvista-seccion">
        <h4>TOTALES DISPONIBLES CON DATOS DEL SISTEMA</h4>
        <table className="decl-tabla decl-tabla-formvista">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Casillero</th>
              <th>Descripción</th>
              <th style={{ textAlign: 'right', width: 130 }}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {casilleros.map((f, i) => (
              <tr key={i} className={f.destacado ? 'decl-tabla-total' : ''}>
                <td><span className="decl-formvista-cas">{f.cas}</span></td>
                <td>{f.desc}</td>
                <td style={{ textAlign: 'right' }}>{fmt(f.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!balance && (
        <p style={{ fontSize: 12, color: '#b45309', margin: 0 }}>
          ⚠ Casilleros 499/599/698 (Balance General) no disponibles — el módulo de Contabilidad no tiene asientos registrados para este ejercicio.
        </p>
      )}
      {anticipoIR && !anticipoIR.aplicable && (
        <p style={{ fontSize: 12, color: '#b45309', margin: 0 }}>
          ⚠ Anticipo de Impuesto a la Renta (Art. 41 LRTI) no calculado: {anticipoIR.motivo}
        </p>
      )}
      {anticipoIR?.aplicable && anticipoIR.advertencias?.length > 0 && (
        <div style={{ fontSize: 12, color: '#b45309' }}>
          <strong>Anticipo de IR — advertencias:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {anticipoIR.advertencias.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      <p className="decl-formvista-nota">
        El F101 real tiene 869 casilleros (balance NIIF completo + conciliación tributaria: gastos no deducibles,
        amortización de pérdidas, ISD, etc.) — este resumen cubre solo los totales grandes que AELA puede calcular con
        datos reales (el Impuesto Causado y Anticipo de IR de arriba sí incluyen la participación a trabajadores 15%,
        de forma simplificada). El resto requiere llenado manual con un contador.
      </p>
    </div>
  );
}

// ─── Componente auxiliar ─────────────────────────────────────────────────────────
function FilaDecl({ label, valor, highlight, warn }) {
  return (
    <div className={`decl-fila ${highlight ? 'hl' : ''} ${warn ? 'warn' : ''}`}>
      <span className="decl-fila-label">{label}</span>
      <span className="decl-fila-valor">{valor}</span>
    </div>
  );
}
