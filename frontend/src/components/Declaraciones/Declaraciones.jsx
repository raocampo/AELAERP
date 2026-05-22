// ====================================
// MÓDULO DECLARACIONES TRIBUTARIAS
// F104 — IVA mensual
// F103 — Retenciones en la Fuente mensual
// F101 — Resumen anual IR
// ====================================

import { useCallback, useState, useEffect, Component } from 'react';
import axios from 'axios';

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

const API = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

function token() {
  return localStorage.getItem('aela_token') || localStorage.getItem('token');
}

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
        ? `${API}/declaraciones/f101?anio=${anio}`
        : `${API}/declaraciones/${tab}?anio=${anio}&mes=${mes}`;
      const { data: resp } = await axios.get(endpoint, {
        headers: { Authorization: `Bearer ${token()}` },
      });
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
          {[anioActual, anioActual - 1, anioActual - 2].map((a) => (
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

      {data && tab === 'f104' && <ErrorBoundary key="f104"><F104View data={data} /></ErrorBoundary>}
      {data && tab === 'f103' && <ErrorBoundary key="f103"><F103View data={data} /></ErrorBoundary>}
      {data && tab === 'f101' && <ErrorBoundary key="f101"><F101View data={data} /></ErrorBoundary>}
    </div>
  );
}

// ─── F104 ────────────────────────────────────────────────────────────────────────
function F104View({ data }) {
  if (!data?.ventas || !data?.resultado) return null;
  const { ventas, compras, retenciones, resultado, meta } = data;
  const esDebito  = resultado.ivaACobrarPagar > 0;
  const esCredito = resultado.ivaACobrarPagar < 0;

  return (
    <div className="decl-formulario">
      <div className="decl-formulario-header">
        <span className="decl-form-badge">Formulario 104</span>
        <span>IVA Mensual — {MESES[data.periodo.mes - 1]} {data.periodo.anio}</span>
      </div>

      <div className="decl-secciones">
        {/* VENTAS */}
        <section className="decl-seccion">
          <h3>Ventas / Ingresos</h3>
          <FilaDecl label="Ventas tarifa 0%" valor={fmtNum(ventas.subtotalNeto0)} />
          {ventas.subtotalNeto5 > 0 && <FilaDecl label="Ventas tarifa 5%" valor={fmtNum(ventas.subtotalNeto5)} />}
          <FilaDecl label="Ventas tarifa 15%" valor={fmtNum(ventas.subtotalNeto15)} />
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
          {compras.liquidaciones.iva > 0 && (
            <FilaDecl label="IVA en liquidaciones de compra" valor={fmtNum(compras.liquidaciones.iva)} />
          )}
          <FilaDecl label="IVA crédito fiscal total" valor={fmtNum(compras.ivaCreditoFiscal)} highlight />
        </section>

        {/* RETENCIONES */}
        {(retenciones.iva30 > 0 || retenciones.iva70 > 0 || retenciones.iva100 > 0) && (
          <section className="decl-seccion">
            <h3>Retenciones de IVA recibidas</h3>
            {retenciones.iva30  > 0 && <FilaDecl label="Retención 30% IVA (cód. 725)" valor={fmtNum(retenciones.iva30)} />}
            {retenciones.iva70  > 0 && <FilaDecl label="Retención 70% IVA (cód. 726)" valor={fmtNum(retenciones.iva70)} />}
            {retenciones.iva100 > 0 && <FilaDecl label="Retención 100% IVA (cód. 727)" valor={fmtNum(retenciones.iva100)} />}
            <FilaDecl label="Total retenido por clientes" valor={fmtNum(retenciones.totalRetenido)} highlight />
          </section>
        )}

        {/* RESULTADO */}
        <section className={`decl-resultado ${esDebito ? 'a-pagar' : esCredito ? 'credito' : 'cero'}`}>
          <div className="decl-resultado-label">
            {esDebito ? '⚠️ IVA a PAGAR al SRI' : esCredito ? '✅ Crédito tributario a favor' : '✅ Declaración en cero'}
          </div>
          <div className="decl-resultado-valor">
            {esDebito ? fmt(resultado.ivaACobrarPagar) : fmt(Math.abs(resultado.ivaACobrarPagar))}
          </div>
        </section>

        <div className="decl-meta">
          <span>{meta.cantidadFacturas} facturas</span>
          <span>{meta.cantidadCompras} compras</span>
          {meta.cantidadLiquidaciones > 0 && <span>{meta.cantidadLiquidaciones} liquidaciones</span>}
          {meta.cantidadRetenciones > 0 && <span>{meta.cantidadRetenciones} retenciones</span>}
        </div>
      </div>
    </div>
  );
}

// ─── F103 ────────────────────────────────────────────────────────────────────────
function F103View({ data }) {
  if (!data?.periodo || !Array.isArray(data?.detallePorCodigo)) return null;
  const { detallePorCodigo, totalRetenido, cantidadComprobantes, meta } = data;

  return (
    <div className="decl-formulario">
      <div className="decl-formulario-header">
        <span className="decl-form-badge">Formulario 103</span>
        <span>Retenciones en la Fuente — {MESES[data.periodo.mes - 1]} {data.periodo.anio}</span>
      </div>

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
    </div>
  );
}

// ─── F101 ────────────────────────────────────────────────────────────────────────
function F101View({ data }) {
  if (!data?.ingresos || !data?.gastos || !data?.retenciones) return null;
  const { ingresos, gastos, retenciones, nota } = data;
  const utilidadBruta = ingresos.totalFacturado - gastos.totalCompras;

  return (
    <div className="decl-formulario">
      <div className="decl-formulario-header">
        <span className="decl-form-badge">F101</span>
        <span>Resumen Anual IR — {data.anio}</span>
      </div>

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
        </section>

        <section className={`decl-resultado ${utilidadBruta >= 0 ? 'credito' : 'a-pagar'}`}>
          <div className="decl-resultado-label">Utilidad bruta estimada</div>
          <div className="decl-resultado-valor">{fmt(utilidadBruta)}</div>
        </section>

        <div className="alert-info" style={{ marginTop: 16, fontSize: 12 }}>
          ⚠️ {nota}
        </div>
      </div>
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
