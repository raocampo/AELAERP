import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { descargarCsv } from '../../utils/exportCsv';
import { parseFechaLocal } from '../../utils/fecha';
import { IcVer, IcEditar } from '../../utils/icons';
import './ListaCompras.css';

const FILTROS_INICIALES = {
  busqueda: '',
  fechaDesde: '',
  fechaHasta: '',
  tipoGasto: '',
  origenRegistro: '',
  page: 1,
};

const TIPO_GASTO_OPCIONES = [
  { value: '', label: 'Todos los tipos' },
  { value: 'SALUD', label: '🏥 Salud' },
  { value: 'EDUCACION', label: '📚 Educación' },
  { value: 'ALIMENTACION', label: '🍽 Alimentación' },
  { value: 'VIVIENDA', label: '🏠 Vivienda' },
  { value: 'VESTIMENTA', label: '👔 Vestimenta' },
  { value: 'TURISMO', label: '✈ Turismo' },
  { value: 'GASTOS_PERSONALES', label: '👤 Gastos Personales' },
  { value: 'GASTOS_PROFESIONALES', label: '💼 Gastos Profesionales' },
  { value: 'OTROS', label: '📦 Otros deducibles' },
  { value: 'SIN_CLASIFICAR', label: '⚠ Sin clasificar' },
];

// Opciones para el quick-edit inline (sin la opción "Todos")
const TIPO_GASTO_EDIT = [
  { value: '', label: '— Sin clasificar —' },
  { value: 'SALUD', label: '🏥 Salud' },
  { value: 'EDUCACION', label: '📚 Educación' },
  { value: 'ALIMENTACION', label: '🍽 Alimentación' },
  { value: 'VIVIENDA', label: '🏠 Vivienda' },
  { value: 'VESTIMENTA', label: '👔 Vestimenta' },
  { value: 'TURISMO', label: '✈ Turismo' },
  { value: 'GASTOS_PERSONALES', label: '👤 Gastos Personales' },
  { value: 'GASTOS_PROFESIONALES', label: '💼 Gastos Profesionales' },
  { value: 'OTROS', label: '📦 Otros deducibles' },
];

function fmtFecha(valor) {
  if (!valor) return 'Sin fecha';
  const fecha = parseFechaLocal(valor);
  return Number.isNaN(fecha.getTime()) ? 'Sin fecha' : fecha.toLocaleDateString('es-EC');
}

function fmtMoneda(valor) {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(valor || 0));
}

export default function ListaCompras() {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState(FILTROS_INICIALES);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [totalesGenerales, setTotalesGenerales] = useState({ base0: 0, base15: 0, iva: 0, total: 0 });
  const [resumenGrupos, setResumenGrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [quickEdit, setQuickEdit] = useState(null); // { id, tipoGasto }
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  const [autoClasificando, setAutoClasificando] = useState(false);

  useEffect(() => {
    let ignore = false;

    const cargar = async () => {
      setLoading(true);
      try {
        const res = await api.get('/compras', { params: filtros });
        if (!ignore) {
          setItems(res.data?.data || []);
          setTotal(res.data?.total || 0);
          setPages(res.data?.pages || 1);
          setTotalesGenerales(res.data?.totalesGenerales || { base0: 0, base15: 0, iva: 0, total: 0 });
          setResumenGrupos(res.data?.resumenGrupos || []);
        }
      } catch (error) {
        if (!ignore) toast.error(error.response?.data?.mensaje || 'No se pudo cargar el módulo de compras');
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    cargar();
    return () => { ignore = true; };
  }, [filtros]);

  const actualizarFiltro = (campo, valor) => {
    setFiltros((prev) => ({
      ...prev,
      [campo]: valor,
      ...(campo !== 'page' ? { page: 1 } : {}),
    }));
  };

  const guardarTipoGasto = async () => {
    if (!quickEdit) return;
    setGuardandoGasto(true);
    try {
      await api.put(`/compras/${quickEdit.id}`, { tipoGasto: quickEdit.tipoGasto || null });
      setItems((prev) => prev.map((it) =>
        it.id === quickEdit.id ? { ...it, tipoGasto: quickEdit.tipoGasto || null } : it
      ));
      toast.success('Tipo de gasto actualizado');
      setQuickEdit(null);
    } catch {
      toast.error('No se pudo actualizar el tipo de gasto');
    } finally {
      setGuardandoGasto(false);
    }
  };

  const autoClasificar = async () => {
    setAutoClasificando(true);
    try {
      const res = await api.post('/compras/auto-clasificar');
      const { clasificadas, noClasificadas, mensaje } = res.data;
      if (clasificadas > 0) {
        toast.success(mensaje);
        // Recargar lista para ver cambios
        setFiltros((prev) => ({ ...prev }));
      } else {
        toast(mensaje || 'No se pudieron clasificar compras automáticamente', { icon: 'ℹ️' });
      }
      if (noClasificadas > 0) {
        toast(`${noClasificadas} factura(s) requieren clasificación manual (✏)`, { icon: '⚠️' });
      }
    } catch {
      toast.error('Error al auto-clasificar');
    } finally {
      setAutoClasificando(false);
    }
  };

  const exportarCsv = async () => {
    setExportando(true);
    try {
      const fecha = new Date().toISOString().slice(0, 10);
      await descargarCsv(api, '/compras/exportar/csv', filtros, `compras-${fecha}.csv`);
      toast.success('CSV exportado correctamente');
    } catch {
      toast.error('No se pudo exportar el CSV');
    } finally {
      setExportando(false);
    }
  };

  // Stats de la página actual (para "Con inventario" y el conteo visible)
  const conInventario = items.filter((it) => it.movimientosInventario > 0).length;

  // Totales globales del filtro (vienen del backend, cubren TODOS los registros, no solo esta página)
  const totalCompras  = totalesGenerales.total;
  const totalBase0    = totalesGenerales.base0;
  const totalBase15   = totalesGenerales.base15;
  const totalIvaItems = totalesGenerales.iva;

  // Resumen por clasificación (backend groupBy — cubre TODOS los registros filtrados)
  const resumenPorTipo = resumenGrupos;

  const exportarResumenCsv = () => {
    const labelDe = (v) => TIPO_GASTO_OPCIONES.find(o => o.value === v)?.label?.replace(/[^\w ]/g, '').trim() || v;
    const lineas = [
      'Clasificación,Facturas,Base 0%,Base IVA,IVA,Total',
      ...resumenPorTipo.map(r =>
        `"${labelDe(r.tipo)}",${r.count},${r.base0.toFixed(2)},${r.base15.toFixed(2)},${r.iva.toFixed(2)},${r.total.toFixed(2)}`
      ),
      `"TOTAL",${items.length},${totalBase0.toFixed(2)},${totalBase15.toFixed(2)},${totalIvaItems.toFixed(2)},${totalCompras.toFixed(2)}`,
    ];
    const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `resumen-compras-${new Date().toISOString().slice(0,10)}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="compras-page">
      <div className="compras-header">
        <div>
          <h1>Compras</h1>
          <p>Registro formal de facturas de compra con impacto opcional en productos, inventario y caja.</p>
        </div>
        <div className="compras-header-actions">
          <button className="btn-secondary" onClick={() => navigate('/dashboard')}>Volver</button>
          <button className="btn-secondary" onClick={exportarCsv} disabled={exportando || items.length === 0}>
            {exportando ? 'Exportando…' : '⬇ CSV'}
          </button>
          <button className="btn-secondary" onClick={autoClasificar} disabled={autoClasificando}
            title="Analiza el nombre del proveedor y productos para asignar categoría SRI automáticamente">
            {autoClasificando ? 'Clasificando…' : '⚡ Auto-clasificar'}
          </button>
          <button className="btn-primary" onClick={() => navigate('/compras/nueva')}>Nueva compra</button>
        </div>
      </div>

      <section className="compras-summary">
        <article className="compras-summary-card">
          <span>Total registros</span>
          <strong>{total}</strong>
        </article>
        <article className="compras-summary-card">
          <span>Total período</span>
          <strong>{fmtMoneda(totalCompras)}</strong>
        </article>
        <article className="compras-summary-card">
          <span>Base 0% IVA</span>
          <strong>{fmtMoneda(totalBase0)}</strong>
        </article>
        <article className="compras-summary-card">
          <span>Base con IVA</span>
          <strong>{fmtMoneda(totalBase15)}</strong>
        </article>
        <article className="compras-summary-card compras-summary-card--iva">
          <span>IVA pagado</span>
          <strong>{fmtMoneda(totalIvaItems)}</strong>
        </article>
        <article className="compras-summary-card">
          <span>Con inventario</span>
          <strong>{conInventario}</strong>
        </article>
      </section>

      {items.length > 0 && resumenPorTipo.length > 0 && (
        <section className="compras-resumen-tipo">
          <div className="compras-resumen-tipo-header">
            <h3>Resumen por clasificación de gasto</h3>
            <button className="btn-secondary" onClick={exportarResumenCsv}>
              📊 Descargar resumen CSV
            </button>
          </div>
          <table className="compras-resumen-tabla">
            <thead>
              <tr>
                <th>Clasificación</th>
                <th className="num">Facturas</th>
                <th className="num">Base 0%</th>
                <th className="num">Base IVA</th>
                <th className="num">IVA</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {resumenPorTipo.map((r) => {
                const label = TIPO_GASTO_OPCIONES.find(o => o.value === r.tipo)?.label || r.tipo;
                return (
                  <tr key={r.tipo}>
                    <td>{label}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{fmtMoneda(r.base0)}</td>
                    <td className="num">{fmtMoneda(r.base15)}</td>
                    <td className="num iva-cell">{fmtMoneda(r.iva)}</td>
                    <td className="num total-cell">{fmtMoneda(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>TOTAL</strong></td>
                <td className="num"><strong>{total}</strong></td>
                <td className="num"><strong>{fmtMoneda(totalBase0)}</strong></td>
                <td className="num"><strong>{fmtMoneda(totalBase15)}</strong></td>
                <td className="num iva-cell"><strong>{fmtMoneda(totalIvaItems)}</strong></td>
                <td className="num total-cell"><strong>{fmtMoneda(totalCompras)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      <section className="compras-filtros">
        <input
          value={filtros.busqueda}
          onChange={(e) => actualizarFiltro('busqueda', e.target.value)}
          placeholder="Buscar por proveedor, RUC o número"
        />
        <input
          type="date"
          value={filtros.fechaDesde}
          onChange={(e) => actualizarFiltro('fechaDesde', e.target.value)}
        />
        <input
          type="date"
          value={filtros.fechaHasta}
          onChange={(e) => actualizarFiltro('fechaHasta', e.target.value)}
        />
        <select
          value={filtros.tipoGasto}
          onChange={(e) => actualizarFiltro('tipoGasto', e.target.value)}
        >
          {TIPO_GASTO_OPCIONES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          className={`btn-${filtros.origenRegistro === 'BUZON_SRI' ? 'primary' : 'secondary'}`}
          onClick={() => actualizarFiltro('origenRegistro', filtros.origenRegistro === 'BUZON_SRI' ? '' : 'BUZON_SRI')}
          title="Mostrar solo facturas importadas desde el Buzón SRI"
        >
          {filtros.origenRegistro === 'BUZON_SRI' ? '✅ Buzón SRI' : '📥 Buzón SRI'}
        </button>
        <button className="btn-secondary" onClick={() => setFiltros(FILTROS_INICIALES)}>Limpiar</button>
      </section>

      {/* ── Paginación ──────────────────────────────────────── */}
      {pages > 1 && (
        <div className="compras-pagination">
          <button
            className="btn-secondary"
            disabled={filtros.page <= 1}
            onClick={() => actualizarFiltro('page', filtros.page - 1)}
          >
            ← Anterior
          </button>
          <span className="compras-pagination-info">
            Página <strong>{filtros.page}</strong> de <strong>{pages}</strong>
            {' '}— mostrando {items.length} de {total} registros
          </span>
          <button
            className="btn-secondary"
            disabled={filtros.page >= pages}
            onClick={() => actualizarFiltro('page', filtros.page + 1)}
          >
            Siguiente →
          </button>
        </div>
      )}

      <section className="compras-card">
        {loading ? (
          <div className="compras-empty">Cargando compras...</div>
        ) : items.length === 0 ? (
          <div className="compras-empty">
            {filtros.tipoGasto && filtros.tipoGasto !== 'SIN_CLASIFICAR'
              ? `No hay facturas clasificadas como "${TIPO_GASTO_OPCIONES.find(o => o.value === filtros.tipoGasto)?.label || filtros.tipoGasto}". Haz clic en el ícono ✏ de la columna Tipo Gasto para clasificar las facturas.`
              : filtros.tipoGasto === 'SIN_CLASIFICAR'
              ? 'No hay facturas sin clasificar. ¡Todo está categorizado!'
              : 'No hay facturas de compra registradas todavía. Puedes empezar con una carga manual, XML o autorización SRI.'
            }
          </div>
        ) : (
          <div className="compras-table-wrap">
            <table className="compras-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Factura</th>
                  <th>Proveedor</th>
                  <th className="compras-col-auth">Autorización</th>
                  <th>Total</th>
                  <th>Operación</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.anulada ? 'fila-anulada' : ''}>
                    <td data-label="Fecha">{fmtFecha(item.fechaEmision)}</td>
                    <td data-label="Factura">
                      <div>
                        <strong style={{ textDecoration: item.anulada ? 'line-through' : 'none', color: item.anulada ? '#94a3b8' : undefined }}>
                          {item.numeroFactura}
                        </strong>
                        {item.anulada && <span className="compras-chip anulada" style={{ marginLeft: 6 }}>Anulada</span>}
                      </div>
                    </td>
                    <td data-label="Proveedor">
                      <div className="compras-provider">
                        <strong>{item.razonSocialProveedor}</strong>
                        <span>{item.identificacionProveedor}</span>
                      </div>
                    </td>
                    <td data-label="Autorización" className="compras-col-auth compras-auth-cell">
                      {item.numeroAutorizacion
                        ? <span title={item.numeroAutorizacion}>{item.numeroAutorizacion}</span>
                        : <span className="compras-muted">—</span>}
                    </td>
                    <td data-label="Total"><strong>{fmtMoneda(item.importeTotal)}</strong></td>
                    <td data-label="Operación">
                      <div className="compras-op-wrap">
                        <div className="compras-op-row">
                          <span className={`compras-chip${item.tipoGasto ? ` tipo-gasto-${item.tipoGasto.toLowerCase()}` : ' sin-clasificar'}`}>
                            {item.tipoGasto || '—'}
                          </span>
                          <button className="btn-icon ic-editar" title="Clasificar tipo de gasto"
                            onClick={() => setQuickEdit({ id: item.id, tipoGasto: item.tipoGasto || '' })}>
                            <IcEditar/>
                          </button>
                          <span className={`compras-chip ${String(item.origenRegistro || 'manual').toLowerCase()}`}>
                            {item.origenRegistro || 'MANUAL'}
                          </span>
                        </div>
                        <div className="compras-op-row">
                          {item.movimientosInventario > 0 && <span className="compras-flag ok">Inventario</span>}
                          {item.egresoCajaRegistrado && <span className="compras-flag warn">Caja</span>}
                          {!item.egresoCajaRegistrado && item.movimientosInventario === 0 && (
                            <span className="compras-flag">Solo registro</span>
                          )}
                          <button className="btn-icon ic-ver" title="Ver detalle de compra"
                            onClick={() => navigate(`/compras/${item.id}`)}>
                            <IcVer/>
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación inferior */}
        {pages > 1 && (
          <div className="compras-pagination compras-pagination--bottom">
            <button
              className="btn-secondary"
              disabled={filtros.page <= 1}
              onClick={() => actualizarFiltro('page', filtros.page - 1)}
            >
              ← Anterior
            </button>
            <span className="compras-pagination-info">
              Página <strong>{filtros.page}</strong> de <strong>{pages}</strong>
            </span>
            <button
              className="btn-secondary"
              disabled={filtros.page >= pages}
              onClick={() => actualizarFiltro('page', filtros.page + 1)}
            >
              Siguiente →
            </button>
          </div>
        )}
      </section>

      {/* MODAL QUICK-EDIT TIPO GASTO */}
      {quickEdit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setQuickEdit(null)}>
          <div style={{ background: '#fff', borderRadius: '1rem', padding: '1.5rem', minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Clasificar tipo de gasto SRI</h3>
            <select
              style={{ width: '100%', padding: '.5rem .75rem', borderRadius: '.5rem', border: '1.5px solid #e2e8f0', fontSize: '.9rem', marginBottom: '1rem' }}
              value={quickEdit.tipoGasto}
              onChange={(e) => setQuickEdit((prev) => ({ ...prev, tipoGasto: e.target.value }))}
            >
              {TIPO_GASTO_EDIT.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end' }}>
              <button style={{ padding: '.45rem 1rem', borderRadius: '.5rem', border: '1.5px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer' }}
                onClick={() => setQuickEdit(null)} disabled={guardandoGasto}>Cancelar</button>
              <button style={{ padding: '.45rem 1rem', borderRadius: '.5rem', border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                onClick={guardarTipoGasto} disabled={guardandoGasto}>
                {guardandoGasto ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
