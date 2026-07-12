import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(Number(valor || 0));
}

// ─── Dropdown ⋯ — portal a body para evitar clipping de scroll ───
function DropdownOps({ item, onVer, onCuenta }) {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    const handler = (e) => {
      if (
        dropRef.current && !dropRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setAbierto(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [abierto]);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setAbierto((v) => !v);
  };

  return (
    <>
      <button ref={btnRef} className="compras-btn-dots" onClick={handleOpen} title="Más acciones">
        ···
      </button>
      {abierto && createPortal(
        <div ref={dropRef} className="compras-dropdown" style={{ position: 'fixed', top: pos.top, right: pos.right }}>
          <button onClick={() => { setAbierto(false); onVer(); }}>
            <IcVer /> Ver detalle
          </button>
          {!item.anulada && (
            <button onClick={() => { setAbierto(false); onCuenta(); }}>
              📒 Cuenta contable
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Modal Cuenta Contable ───────────────────────────────────────
function ModalCuenta({ modalCuenta, cuentasContables, editCuentaId, setEditCuentaId, onClose, onGuardar, guardando }) {
  const [busqueda, setBusqueda] = useState('');
  const [regenerar, setRegenenar] = useState(false);

  const cuentasFiltradas = busqueda.trim()
    ? cuentasContables.filter((c) =>
        `${c.codigo} ${c.nombre}`.toLowerCase().includes(busqueda.toLowerCase())
      )
    : cuentasContables;

  const puedeRegenerary = modalCuenta.tieneAsientoContable && !modalCuenta.asientoCerrado;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: '1rem', padding: '1.5rem', width: '100%', maxWidth: 480, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 .25rem', fontSize: '1rem' }}>Cuenta contable de gasto</h3>
        <p style={{ margin: '0 0 1rem', fontSize: '.82rem', color: '#64748b' }}>
          Factura {modalCuenta.numeroFactura}
        </p>

        {puedeRegenerary && (
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '.6rem', padding: '.65rem .85rem', marginBottom: '.85rem', fontSize: '.82rem', color: '#92400e' }}>
            ⚠ Esta compra ya tiene asiento contable generado. Al cambiar la cuenta, el asiento no se actualiza automáticamente — usa "Guardar y regenerar" para actualizarlo.
          </div>
        )}
        {modalCuenta.tieneAsientoContable && modalCuenta.asientoCerrado && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '.6rem', padding: '.65rem .85rem', marginBottom: '.85rem', fontSize: '.82rem', color: '#991b1b' }}>
            🔒 El asiento está cerrado. Puedes cambiar la cuenta pero no regenerar el asiento.
          </div>
        )}

        <input
          autoFocus
          placeholder="Buscar cuenta por código o nombre..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ padding: '.55rem .8rem', border: '1.5px solid #e2e8f0', borderRadius: '.6rem', fontSize: '.88rem', marginBottom: '.6rem' }}
        />

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '.6rem', marginBottom: '.85rem' }}>
          <div
            className={`cuenta-opcion ${!editCuentaId ? 'cuenta-opcion-sel' : ''}`}
            onClick={() => setEditCuentaId(null)}
          >
            <span style={{ color: '#64748b', fontStyle: 'italic' }}>Default de la empresa (global)</span>
          </div>
          {cuentasFiltradas.map((c) => (
            <div
              key={c.id}
              className={`cuenta-opcion ${editCuentaId === c.id ? 'cuenta-opcion-sel' : ''}`}
              onClick={() => setEditCuentaId(c.id)}
            >
              <span style={{ fontWeight: 600, color: '#6366f1', marginRight: '.4rem' }}>{c.codigo}</span>
              {c.nombre}
            </div>
          ))}
          {cuentasFiltradas.length === 0 && (
            <div style={{ padding: '.75rem', color: '#94a3b8', fontSize: '.82rem', textAlign: 'center' }}>
              Sin resultados
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button
            style={{ padding: '.45rem 1rem', borderRadius: '.5rem', border: '1.5px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', fontSize: '.88rem' }}
            onClick={onClose}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button
            style={{ padding: '.45rem 1rem', borderRadius: '.5rem', border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '.88rem' }}
            onClick={() => onGuardar(false)}
            disabled={guardando}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          {puedeRegenerary && (
            <button
              style={{ padding: '.45rem 1rem', borderRadius: '.5rem', border: 'none', background: '#0f172a', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '.88rem' }}
              onClick={() => onGuardar(true)}
              disabled={guardando}
            >
              {guardando ? 'Procesando…' : '↺ Guardar y regenerar asiento'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────
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
  const [quickEdit, setQuickEdit] = useState(null);
  const [guardandoGasto, setGuardandoGasto] = useState(false);
  const [autoClasificando, setAutoClasificando] = useState(false);
  const [marcandoReceptor, setMarcandoReceptor] = useState(false);
  const [generandoAsientoId, setGenerandoAsientoId] = useState(null);

  // Cuenta contable
  const [modalCuenta, setModalCuenta] = useState(null);
  const [cuentasContables, setCuentasContables] = useState([]);
  const [editCuentaId, setEditCuentaId] = useState(null);
  const [guardandoCuenta, setGuardandoCuenta] = useState(false);

  const cargarLista = () => setFiltros((p) => ({ ...p }));

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
    setFiltros((prev) => ({ ...prev, [campo]: valor, ...(campo !== 'page' ? { page: 1 } : {}) }));
  };

  const guardarTipoGasto = async () => {
    if (!quickEdit) return;
    setGuardandoGasto(true);
    try {
      await api.put(`/compras/${quickEdit.id}`, { tipoGasto: quickEdit.tipoGasto || null });
      setItems((prev) => prev.map((it) => it.id === quickEdit.id ? { ...it, tipoGasto: quickEdit.tipoGasto || null } : it));
      toast.success('Tipo de gasto actualizado');
      setQuickEdit(null);
    } catch {
      toast.error('No se pudo actualizar el tipo de gasto');
    } finally {
      setGuardandoGasto(false);
    }
  };

  const generarAsiento = async (id) => {
    setGenerandoAsientoId(id);
    try {
      const res = await api.post(`/compras/${id}/generar-asiento`);
      setItems((prev) => prev.map((it) => it.id === id ? { ...it, tieneAsientoContable: true } : it));
      toast.success(res.data?.mensaje || 'Asiento contable generado');
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo generar el asiento contable');
    } finally {
      setGenerandoAsientoId(null);
    }
  };

  const autoClasificar = async () => {
    setAutoClasificando(true);
    try {
      const res = await api.post('/compras/auto-clasificar');
      const { clasificadas, noClasificadas, mensaje } = res.data;
      if (clasificadas > 0) { toast.success(mensaje); cargarLista(); }
      else toast(mensaje || 'No se pudieron clasificar compras automáticamente', { icon: 'ℹ️' });
      if (noClasificadas > 0) toast(`${noClasificadas} factura(s) requieren clasificación manual (✏)`, { icon: '⚠️' });
    } catch {
      toast.error('Error al auto-clasificar');
    } finally {
      setAutoClasificando(false);
    }
  };

  const marcarReceptorRucCedula = async () => {
    setMarcandoReceptor(true);
    try {
      const res = await api.post('/compras/backfill-receptor-ruc');
      const { total, marcadas, sinDato } = res.data;
      toast.success(`${marcadas} de ${total} compra(s) revisadas${sinDato ? ` (${sinDato} sin XML para determinar)` : ''}`);
      cargarLista();
    } catch {
      toast.error('Error al revisar RUC/cédula de las compras');
    } finally {
      setMarcandoReceptor(false);
    }
  };

  const exportarCsv = async () => {
    setExportando(true);
    try {
      await descargarCsv(api, '/compras/exportar/csv', filtros, `compras-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success('CSV exportado correctamente');
    } catch {
      toast.error('No se pudo exportar el CSV');
    } finally {
      setExportando(false);
    }
  };

  // ── Cuenta contable ──────────────────────────────────────────
  const abrirModalCuenta = async (item) => {
    let lista = cuentasContables;
    if (lista.length === 0) {
      try {
        const res = await api.get('/contabilidad/plan-cuentas', { params: { soloMovimiento: 'true' } });
        const data = res.data?.data;
        lista = Array.isArray(data) ? data : (data?.flat || []);
        setCuentasContables(lista);
      } catch {
        toast.error('No se pudo cargar el plan de cuentas');
        return;
      }
    }
    setEditCuentaId(item.cuentaGastoId || null);
    setModalCuenta({
      id: item.id,
      numeroFactura: item.numeroFactura,
      tieneAsientoContable: Boolean(item.tieneAsientoContable),
      asientoCerrado: Boolean(item.asientoCerrado),
    });
  };

  const guardarCuenta = async (regenerar) => {
    if (!modalCuenta) return;
    setGuardandoCuenta(true);
    try {
      await api.put(`/compras/${modalCuenta.id}`, { cuentaGastoId: editCuentaId || null });
      if (regenerar) {
        await api.post(`/compras/${modalCuenta.id}/regenerar-asiento`);
        toast.success('Cuenta actualizada y asiento regenerado');
      } else {
        toast.success(editCuentaId ? 'Cuenta contable configurada' : 'Restablecida al default global');
      }
      setItems((prev) => prev.map((it) =>
        it.id === modalCuenta.id ? { ...it, cuentaGastoId: editCuentaId } : it
      ));
      setModalCuenta(null);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'No se pudo guardar');
    } finally {
      setGuardandoCuenta(false);
    }
  };

  // Stats
  const conInventario = items.filter((it) => it.movimientosInventario > 0).length;
  const totalCompras  = totalesGenerales.total;
  const totalBase0    = totalesGenerales.base0;
  const totalBase15   = totalesGenerales.base15;
  const totalIvaItems = totalesGenerales.iva;
  const resumenPorTipo = resumenGrupos;

  const exportarResumenCsv = () => {
    const labelDe = (v) => TIPO_GASTO_OPCIONES.find(o => o.value === v)?.label?.replace(/[^\w ]/g, '').trim() || v;
    const lineas = [
      'Clasificación,Facturas,Base 0%,Base IVA,IVA,Total',
      ...resumenPorTipo.map(r => `"${labelDe(r.tipo)}",${r.count},${r.base0.toFixed(2)},${r.base15.toFixed(2)},${r.iva.toFixed(2)},${r.total.toFixed(2)}`),
      `"TOTAL",${items.length},${totalBase0.toFixed(2)},${totalBase15.toFixed(2)},${totalIvaItems.toFixed(2)},${totalCompras.toFixed(2)}`,
    ];
    const blob = new Blob(['﻿' + lineas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `resumen-compras-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="compras-page">
      {/* ── Header ──────────────────────────────────────────────── */}
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
          <button className="btn-secondary" onClick={marcarReceptorRucCedula} disabled={marcandoReceptor}
            title="Revisa el XML original de cada compra para saber si llegó dirigida al RUC (deducible) o a una cédula personal (no válida para declaraciones)">
            {marcandoReceptor ? 'Revisando…' : '🪪 Marcar RUC/Cédula'}
          </button>
          <button className="btn-primary" onClick={() => navigate('/compras/nueva')}>Nueva compra</button>
        </div>
      </div>

      {/* ── KPIs ────────────────────────────────────────────────── */}
      <section className="compras-summary">
        <article className="compras-summary-card"><span>Total registros</span><strong>{total}</strong></article>
        <article className="compras-summary-card"><span>Total período</span><strong>{fmtMoneda(totalCompras)}</strong></article>
        <article className="compras-summary-card"><span>Base 0% IVA</span><strong>{fmtMoneda(totalBase0)}</strong></article>
        <article className="compras-summary-card"><span>Base con IVA</span><strong>{fmtMoneda(totalBase15)}</strong></article>
        <article className="compras-summary-card compras-summary-card--iva"><span>IVA pagado</span><strong>{fmtMoneda(totalIvaItems)}</strong></article>
        <article className="compras-summary-card"><span>Con inventario</span><strong>{conInventario}</strong></article>
      </section>

      {/* ── Resumen clasificación ────────────────────────────────── */}
      {items.length > 0 && resumenPorTipo.length > 0 && (
        <section className="compras-resumen-tipo">
          <div className="compras-resumen-tipo-header">
            <h3>Resumen por clasificación de gasto</h3>
            <button className="btn-secondary" onClick={exportarResumenCsv}>📊 Descargar resumen CSV</button>
          </div>
          <table className="compras-resumen-tabla">
            <thead>
              <tr>
                <th>Clasificación</th><th className="num">Facturas</th>
                <th className="num">Base 0%</th><th className="num">Base IVA</th>
                <th className="num">IVA</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {resumenPorTipo.map((r) => {
                const label = TIPO_GASTO_OPCIONES.find(o => o.value === r.tipo)?.label || r.tipo;
                return (
                  <tr key={r.tipo}>
                    <td>{label}</td><td className="num">{r.count}</td>
                    <td className="num">{fmtMoneda(r.base0)}</td><td className="num">{fmtMoneda(r.base15)}</td>
                    <td className="num iva-cell">{fmtMoneda(r.iva)}</td><td className="num total-cell">{fmtMoneda(r.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>TOTAL</strong></td><td className="num"><strong>{total}</strong></td>
                <td className="num"><strong>{fmtMoneda(totalBase0)}</strong></td><td className="num"><strong>{fmtMoneda(totalBase15)}</strong></td>
                <td className="num iva-cell"><strong>{fmtMoneda(totalIvaItems)}</strong></td><td className="num total-cell"><strong>{fmtMoneda(totalCompras)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {/* ── Filtros ──────────────────────────────────────────────── */}
      <section className="compras-filtros">
        <input value={filtros.busqueda} onChange={(e) => actualizarFiltro('busqueda', e.target.value)} placeholder="Buscar por proveedor, RUC o número" />
        <input type="date" value={filtros.fechaDesde} onChange={(e) => actualizarFiltro('fechaDesde', e.target.value)} />
        <input type="date" value={filtros.fechaHasta} onChange={(e) => actualizarFiltro('fechaHasta', e.target.value)} />
        <select value={filtros.tipoGasto} onChange={(e) => actualizarFiltro('tipoGasto', e.target.value)}>
          {TIPO_GASTO_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

      {/* ── Paginación superior ──────────────────────────────────── */}
      {pages > 1 && (
        <div className="compras-pagination">
          <button className="btn-secondary" disabled={filtros.page <= 1} onClick={() => actualizarFiltro('page', filtros.page - 1)}>← Anterior</button>
          <span className="compras-pagination-info">Página <strong>{filtros.page}</strong> de <strong>{pages}</strong> — mostrando {items.length} de {total} registros</span>
          <button className="btn-secondary" disabled={filtros.page >= pages} onClick={() => actualizarFiltro('page', filtros.page + 1)}>Siguiente →</button>
        </div>
      )}

      {/* ── Tabla ────────────────────────────────────────────────── */}
      <section className="compras-card">
        {loading ? (
          <div className="compras-empty">Cargando compras...</div>
        ) : items.length === 0 ? (
          <div className="compras-empty">
            {filtros.tipoGasto && filtros.tipoGasto !== 'SIN_CLASIFICAR'
              ? `No hay facturas clasificadas como "${TIPO_GASTO_OPCIONES.find(o => o.value === filtros.tipoGasto)?.label || filtros.tipoGasto}". Haz clic en el ícono ✏ de la columna Tipo Gasto para clasificar las facturas.`
              : filtros.tipoGasto === 'SIN_CLASIFICAR' ? 'No hay facturas sin clasificar. ¡Todo está categorizado!'
              : 'No hay facturas de compra registradas todavía. Puedes empezar con una carga manual, XML o autorización SRI.'
            }
          </div>
        ) : (
          <div className="compras-table-wrap">
            <table className="compras-table">
              <thead>
                <tr>
                  <th>Fecha</th><th>Factura</th><th>Proveedor</th>
                  <th className="compras-col-auth">Autorización</th><th>Total</th><th>Operación</th>
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
                        {/* Fila 1: tipo gasto + origen */}
                        <div className="compras-op-row">
                          <span className={`compras-chip${item.tipoGasto ? ` tipo-gasto-${item.tipoGasto.toLowerCase()}` : ' sin-clasificar'}`}>
                            {item.tipoGasto || '—'}
                          </span>
                          <button className="btn-icon ic-editar" title="Clasificar tipo de gasto"
                            onClick={() => setQuickEdit({ id: item.id, tipoGasto: item.tipoGasto || '' })}>
                            <IcEditar />
                          </button>
                          <span className={`compras-chip ${String(item.origenRegistro || 'manual').toLowerCase()}`}>
                            {item.origenRegistro || 'MANUAL'}
                          </span>
                          {item.receptorEsRuc === false && (
                            <span className="compras-chip" style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#b91c1c' }}
                              title="Facturado a cédula personal, no al RUC de la empresa — no cuenta para declaraciones">
                              ⚠️ A cédula
                            </span>
                          )}
                          {item.cuentaGastoId && (
                            <span className="compras-chip" style={{ background: '#ede9fe', borderColor: '#c4b5fd', color: '#6d28d9' }} title="Cuenta contable personalizada configurada">
                              📒
                            </span>
                          )}
                        </div>
                        {/* Fila 2: estado + asiento + dropdown */}
                        <div className="compras-op-row">
                          {item.movimientosInventario > 0 && <span className="compras-flag ok">Inventario</span>}
                          {item.egresoCajaRegistrado && <span className="compras-flag warn">Caja</span>}
                          {!item.egresoCajaRegistrado && item.movimientosInventario === 0 && (
                            <span className="compras-flag">Solo registro</span>
                          )}
                          {item.tieneAsientoContable ? (
                            <span className="compras-flag ok" title="Ya tiene asiento en el Libro Diario">✓ Con asiento</span>
                          ) : (
                            <button
                              className="compras-btn-asiento"
                              disabled={generandoAsientoId === item.id}
                              onClick={() => generarAsiento(item.id)}
                              title="Esta compra no tiene asiento contable en el Libro Diario"
                            >
                              {generandoAsientoId === item.id ? 'Generando…' : '⚠ Generar asiento'}
                            </button>
                          )}
                          <DropdownOps
                            item={item}
                            onVer={() => navigate(`/compras/${item.id}`)}
                            onCuenta={() => abrirModalCuenta(item)}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="compras-pagination compras-pagination--bottom">
            <button className="btn-secondary" disabled={filtros.page <= 1} onClick={() => actualizarFiltro('page', filtros.page - 1)}>← Anterior</button>
            <span className="compras-pagination-info">Página <strong>{filtros.page}</strong> de <strong>{pages}</strong></span>
            <button className="btn-secondary" disabled={filtros.page >= pages} onClick={() => actualizarFiltro('page', filtros.page + 1)}>Siguiente →</button>
          </div>
        )}
      </section>

      {/* ── Modal Quick-edit tipo gasto ──────────────────────────── */}
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
              {TIPO_GASTO_EDIT.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

      {/* ── Modal Cuenta Contable ────────────────────────────────── */}
      {modalCuenta && (
        <ModalCuenta
          modalCuenta={modalCuenta}
          cuentasContables={cuentasContables}
          editCuentaId={editCuentaId}
          setEditCuentaId={setEditCuentaId}
          onClose={() => setModalCuenta(null)}
          onGuardar={guardarCuenta}
          guardando={guardandoCuenta}
        />
      )}
    </div>
  );
}
