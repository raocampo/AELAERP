import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';
import './Bancos.css';

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LibroBancos() {
  const [cuentas, setCuentas] = useState([]);
  const [cuentaId, setCuentaId] = useState('');
  const [modoFecha, setModoFecha] = useState('mes');
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [movimientos, setMovimientos] = useState([]);
  const [saldoAnterior, setSaldoAnterior] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.get('/bancos').then((r) => {
      const lista = r.data?.data || [];
      setCuentas(lista);
      if (lista.length > 0) setCuentaId(String(lista[0].id));
    }).catch(() => {});
  }, []);

  const getPeriodo = useCallback(() => {
    if (modoFecha === 'mes' && mes) {
      const [yyyy, mm] = mes.split('-');
      const lastDay = new Date(parseInt(yyyy), parseInt(mm), 0).getDate();
      return { desde: `${yyyy}-${mm}-01`, hasta: `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}` };
    }
    return { desde: fechaDesde, hasta: fechaHasta };
  }, [modoFecha, mes, fechaDesde, fechaHasta]);

  const cargar = useCallback(async () => {
    if (!cuentaId) return;
    setCargando(true);
    setSeleccionados(new Set());
    try {
      const { desde, hasta } = getPeriodo();
      const params = new URLSearchParams({ limit: 500 });
      if (desde) params.set('fechaDesde', desde);
      if (hasta) params.set('fechaHasta', hasta);

      const r = await api.get(`/bancos/${cuentaId}/movimientos?${params}`);
      setMovimientos(r.data?.data || []);

      // Calcular saldo anterior: todos los movimientos ANTES del período
      if (desde) {
        const dPrev = new Date(desde);
        dPrev.setDate(dPrev.getDate() - 1);
        const prevFecha = dPrev.toISOString().slice(0, 10);
        const rPrev = await api.get(`/bancos/${cuentaId}/movimientos?limit=9999&fechaHasta=${prevFecha}`);
        const movsPrev = rPrev.data?.data || [];
        const cuenta = cuentas.find((c) => String(c.id) === cuentaId);
        const saldoInicial = parseFloat(cuenta?.saldoInicial || 0);
        const anterior = movsPrev.reduce((acc, m) => acc + parseFloat(m.debe) - parseFloat(m.haber), saldoInicial);
        setSaldoAnterior(anterior);
      } else {
        const cuenta = cuentas.find((c) => String(c.id) === cuentaId);
        setSaldoAnterior(parseFloat(cuenta?.saldoInicial || 0));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [cuentaId, getPeriodo, cuentas]);

  useEffect(() => { if (cuentaId) cargar(); }, [cargar]); // eslint-disable-line

  const toggleSeleccionado = (id) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const conciliarLote = async (ids, conciliado) => {
    if (ids.length === 0) return;
    setGuardando(true);
    try {
      await api.patch(`/bancos/${cuentaId}/movimientos/conciliar-lote`, { ids, conciliado });
      await cargar();
    } catch (e) {
      alert(e.response?.data?.mensaje || 'Error al conciliar');
    } finally {
      setGuardando(false);
    }
  };

  const totalDebe = movimientos.reduce((s, m) => s + parseFloat(m.debe), 0);
  const totalHaber = movimientos.reduce((s, m) => s + parseFloat(m.haber), 0);
  const saldoFinal = saldoAnterior !== null ? saldoAnterior + totalDebe - totalHaber : null;
  const todosSeleccionados = movimientos.length > 0 && seleccionados.size === movimientos.length;

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.25rem', padding: '1rem', background: 'var(--color-surface, #f8fafc)', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Cuenta bancaria</label>
          <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} style={{ minWidth: '240px' }}>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Filtro por</label>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button
              className={`btn btn-sm ${modoFecha === 'mes' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setModoFecha('mes')}
            >
              Mes / Año
            </button>
            <button
              className={`btn btn-sm ${modoFecha === 'rango' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setModoFecha('rango')}
            >
              Rango de fechas
            </button>
          </div>
        </div>

        {modoFecha === 'mes' ? (
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Mes</label>
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </div>
        ) : (
          <>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Desde</label>
              <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Hasta</label>
              <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {/* Resumen de saldos */}
      {saldoAnterior !== null && (
        <div className="saldo-resumen" style={{ marginBottom: '1rem' }}>
          <div className="saldo-item">
            <div className="saldo-item-label">Saldo anterior</div>
            <div className="saldo-item-valor">${formatMoney(saldoAnterior)}</div>
          </div>
          <div className="saldo-item">
            <div className="saldo-item-label">Total ingresos</div>
            <div className="saldo-item-valor monto-debe">${formatMoney(totalDebe)}</div>
          </div>
          <div className="saldo-item">
            <div className="saldo-item-label">Total egresos</div>
            <div className="saldo-item-valor monto-haber">${formatMoney(totalHaber)}</div>
          </div>
          {saldoFinal !== null && (
            <div className="saldo-item">
              <div className="saldo-item-label">Saldo al cierre</div>
              <div className={`saldo-item-valor ${saldoFinal < 0 ? 'saldo-negativo' : 'saldo-positivo'}`}>
                ${formatMoney(saldoFinal)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Acciones de conciliación */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #64748b)' }}>
          {seleccionados.size > 0 ? `${seleccionados.size} seleccionado${seleccionados.size > 1 ? 's' : ''}` : 'Seleccione movimientos'}
        </span>
        <button
          className="btn btn-sm btn-success"
          disabled={seleccionados.size === 0 || guardando}
          onClick={() => conciliarLote(Array.from(seleccionados), true)}
        >
          ✓ Conciliar seleccionadas
        </button>
        <button
          className="btn btn-sm btn-ghost"
          disabled={seleccionados.size === 0 || guardando}
          onClick={() => conciliarLote(Array.from(seleccionados), false)}
        >
          ✗ Desconciliar
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={movimientos.length === 0 || guardando}
          onClick={() => conciliarLote(movimientos.map((m) => m.id), true)}
        >
          ✓✓ Conciliar todo
        </button>
        {movimientos.some((m) => m.conciliado) && (
          <button
            className="btn btn-sm btn-ghost"
            disabled={guardando}
            onClick={() => conciliarLote(movimientos.map((m) => m.id), false)}
          >
            Desconciliar todo
          </button>
        )}
      </div>

      {/* Tabla de movimientos */}
      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted, #64748b)' }}>Cargando movimientos...</p>
      ) : movimientos.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">📋</div>
          <p>Sin movimientos en el período seleccionado</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th style={{ width: '36px' }}>
                  <input
                    type="checkbox"
                    checked={todosSeleccionados}
                    onChange={(e) => setSeleccionados(e.target.checked ? new Set(movimientos.map((m) => m.id)) : new Set())}
                  />
                </th>
                <th style={{ width: '60px' }}>Conc.</th>
                <th>N° Comprobante</th>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Concepto</th>
                <th>Referencia</th>
                <th style={{ textAlign: 'right' }}>Debe (+)</th>
                <th style={{ textAlign: 'right' }}>Haber (−)</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id} style={m.conciliado ? { background: 'var(--color-success-bg, #f0fdf4)' } : {}}>
                  <td>
                    <input type="checkbox" checked={seleccionados.has(m.id)} onChange={() => toggleSeleccionado(m.id)} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {m.conciliado
                      ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '1rem' }}>✓</span>
                      : <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                  <td style={{ fontSize: '0.8rem', fontWeight: 600 }}>{m.numero || '—'}</td>
                  <td>{formatFechaCorta(m.fecha)}</td>
                  <td>
                    <span className={`tipo-badge tipo-${m.tipo}`}>{m.tipo.replace(/_/g, ' ')}</span>
                  </td>
                  <td>{m.concepto}</td>
                  <td style={{ fontSize: '0.78rem', color: 'var(--color-text-muted, #64748b)' }}>{m.referencia || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {parseFloat(m.debe) > 0 ? <span className="monto-debe">${formatMoney(m.debe)}</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {parseFloat(m.haber) > 0 ? <span className="monto-haber">${formatMoney(m.haber)}</span> : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={m.saldoAcumulado < 0 ? 'saldo-negativo' : 'saldo-positivo'}>
                      ${formatMoney(m.saldoAcumulado)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, borderTop: '2px solid #e2e8f0', background: 'var(--color-surface, #f8fafc)' }}>
                <td colSpan="7" style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }}>TOTALES DEL PERÍODO</td>
                <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }} className="monto-debe">${formatMoney(totalDebe)}</td>
                <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }} className="monto-haber">${formatMoney(totalHaber)}</td>
                <td style={{ textAlign: 'right', padding: '0.5rem 0.75rem' }} className={saldoFinal !== null && saldoFinal < 0 ? 'saldo-negativo' : 'saldo-positivo'}>
                  {saldoFinal !== null ? `$${formatMoney(saldoFinal)}` : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
