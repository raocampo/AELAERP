import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { formatFechaCorta } from '../../utils/fecha';

const TIPOS_META = {
  INGRESO: {
    titulo: 'Comprobantes de Ingreso',
    icono: '⬇️',
    subtipos: ['GENERAL', 'DEVOLUCION_ANTICIPOS'],
    subtitposLabel: { GENERAL: 'General', DEVOLUCION_ANTICIPOS: 'Devolución de anticipos' },
    conProveedor: false,
  },
  PAGO: {
    titulo: 'Comprobantes de Pago',
    icono: '⬆️',
    subtipos: ['GENERAL', 'CANCELACION_CXP', 'PAGO_EMPLEADOS', 'DEVOLUCION_ANTICIPOS'],
    subtitposLabel: {
      GENERAL: 'General',
      CANCELACION_CXP: 'Cancelación de cuentas por pagar',
      PAGO_EMPLEADOS: 'Pago a empleados',
      DEVOLUCION_ANTICIPOS: 'Devolución de anticipos',
    },
    conProveedor: true,
  },
  CREDITO: {
    titulo: 'Notas de Crédito Bancarias',
    icono: '✚',
    subtipos: ['GENERAL'],
    subtitposLabel: { GENERAL: 'General' },
    conProveedor: false,
  },
  DEBITO: {
    titulo: 'Notas de Débito Bancarias',
    icono: '−',
    subtipos: ['GENERAL'],
    subtitposLabel: { GENERAL: 'General' },
    conProveedor: true,
  },
};

const TIPOS_PAGO_OPT = ['EFECTIVO', 'CHEQUE', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO'];

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2 });
}
function formatFecha(d) { return d ? formatFechaCorta(d) : '—'; }

// ─── Hook cuentas contables ────────────────────────────────
function usePlanCuentas() {
  const [cuentas, setCuentas] = useState([]);
  useEffect(() => {
    api.get('/contabilidad/plan-cuentas', { params: { activo: true, soloMovimiento: true } })
      .then((r) => setCuentas(r.data?.data?.flat || []))
      .catch(() => {});
  }, []);
  return cuentas;
}

// ─── Hook cuentas bancarias ────────────────────────────────
function useCuentasBancarias() {
  const [cuentas, setCuentas] = useState([]);
  useEffect(() => {
    api.get('/bancos').then((r) => setCuentas(r.data?.data || [])).catch(() => {});
  }, []);
  return cuentas;
}

// ─── Modal selección de subtipo ───────────────────────────
function ModalSubtipo({ tipo, onContinuar, onCancelar }) {
  const meta = TIPOS_META[tipo];
  const [subtipo, setSubtipo] = useState(meta.subtipos[0]);
  return (
    <div className="bancos-modal-overlay">
      <div className="bancos-modal" style={{ maxWidth: 480 }}>
        <h2>Nuevo {meta.titulo.replace('s', '').replace('Comprobantes de ', 'Comprobante de ')}</h2>
        <p style={{ margin: '0.5rem 0 1rem', fontSize: '0.88rem', color: 'var(--color-text-muted,#64748b)' }}>
          Seleccione el tipo de comprobante que desea registrar:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {meta.subtipos.map((s) => (
            <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="radio" name="subtipo" value={s} checked={subtipo === s} onChange={() => setSubtipo(s)} />
              {meta.subtitposLabel[s]}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => onContinuar(subtipo)}>Continuar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Formulario de comprobante ────────────────────────────
function FormComprobante({ tipo, subtipo, onCancelar, onGuardado }) {
  const meta = TIPOS_META[tipo];
  const planCuentas = usePlanCuentas();
  const cuentasBancarias = useCuentasBancarias();

  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10),
    notas: '',
    cuentaBancariaId: '',
    proveedorId: '',
    proveedorNombre: '',
    proveedorRuc: '',
    cuentas: [{ notas: '', valor: '', cuentaContableId: '' }],
    pagos: [{ tipoPago: 'EFECTIVO', valor: '', cuentaContableId: '', notas: '' }],
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [buscandoProv, setBuscandoProv] = useState(false);

  // Buscar proveedor por RUC
  const buscarProveedor = async () => {
    if (!form.proveedorRuc) return;
    setBuscandoProv(true);
    try {
      const r = await api.get('/proveedores', { params: { q: form.proveedorRuc, limit: 5 } });
      const prov = (r.data?.data?.items || r.data?.data || [])[0];
      if (prov) setForm((f) => ({ ...f, proveedorId: String(prov.id), proveedorNombre: prov.razonSocial }));
      else setError('Proveedor no encontrado');
    } catch { setError('Error buscando proveedor'); }
    finally { setBuscandoProv(false); }
  };

  const totalCuentas = form.cuentas.reduce((s, c) => s + Number(c.valor || 0), 0);
  const totalPagos   = form.pagos.reduce((s, p) => s + Number(p.valor || 0), 0);

  const agregarCuenta = () => setForm((f) => ({ ...f, cuentas: [...f.cuentas, { notas: '', valor: '', cuentaContableId: '' }] }));
  const quitarCuenta = (i) => setForm((f) => ({ ...f, cuentas: f.cuentas.filter((_, idx) => idx !== i) }));
  const cambiarCuenta = (i, k, v) => setForm((f) => ({ ...f, cuentas: f.cuentas.map((c, idx) => idx === i ? { ...c, [k]: v } : c) }));

  const agregarPago = () => setForm((f) => ({ ...f, pagos: [...f.pagos, { tipoPago: 'EFECTIVO', valor: '', cuentaContableId: '', notas: '' }] }));
  const quitarPago = (i) => setForm((f) => ({ ...f, pagos: f.pagos.filter((_, idx) => idx !== i) }));
  const cambiarPago = (i, k, v) => setForm((f) => ({ ...f, pagos: f.pagos.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.cuentas.length === 0) return setError('Agregue al menos una cuenta');
    setError('');
    setGuardando(true);
    try {
      await api.post('/comprobantes-bancarios', {
        tipo, subtipo,
        fecha: form.fecha,
        notas: form.notas || null,
        cuentaBancariaId: form.cuentaBancariaId || null,
        proveedorId: form.proveedorId || null,
        cuentas: form.cuentas.map((c) => ({ notas: c.notas, valor: Number(c.valor || 0), cuentaContableId: c.cuentaContableId || null })),
        pagos: form.pagos.map((p) => ({ tipoPago: p.tipoPago, valor: Number(p.valor || 0), cuentaContableId: p.cuentaContableId || null, notas: p.notas })),
      });
      onGuardado();
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0 }}>Nuevo {meta.titulo.replace('s', '').replace('Comprobantes de ', 'Comprobante de ')}</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
          <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ─ Información General ─ */}
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#0f766e', padding: '0 6px' }}>Información general</legend>
          <div className="bancos-form-grid">
            <div className="form-group">
              <label>Fecha de emisión *</label>
              <input type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Cuenta bancaria</label>
              <select value={form.cuentaBancariaId} onChange={(e) => setForm((f) => ({ ...f, cuentaBancariaId: e.target.value }))}>
                <option value="">— Sin cuenta bancaria —</option>
                {cuentasBancarias.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.banco})</option>)}
              </select>
            </div>
            <div className="form-group full-col">
              <label>Notas *</label>
              <input value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Descripción del comprobante" required />
            </div>
          </div>
        </fieldset>

        {/* ─ Proveedor (solo cuando aplica) ─ */}
        {meta.conProveedor && (
          <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
            <legend style={{ fontWeight: 600, color: '#0f766e', padding: '0 6px' }}>Proveedor</legend>
            <div className="bancos-form-grid">
              <div className="form-group">
                <label>RUC / Cédula</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input value={form.proveedorRuc} onChange={(e) => setForm((f) => ({ ...f, proveedorRuc: e.target.value }))} placeholder="Búsqueda por RUC" />
                  <button type="button" className="btn btn-primary btn-sm" onClick={buscarProveedor} disabled={buscandoProv}>🔍</button>
                </div>
              </div>
              <div className="form-group">
                <label>Nombre</label>
                <input value={form.proveedorNombre} onChange={(e) => setForm((f) => ({ ...f, proveedorNombre: e.target.value }))} placeholder="Razón social" />
              </div>
            </div>
          </fieldset>
        )}

        {/* ─ Cuentas ─ */}
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#0f766e', padding: '0 6px' }}>Cuentas</legend>
          <button type="button" className="btn btn-primary btn-sm" style={{ marginBottom: '0.75rem' }} onClick={agregarCuenta}>+ Agregar nueva</button>
          <div style={{ overflowX: 'auto' }}>
            <table className="movimientos-tabla">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Notas</th>
                  <th style={{ width: 140 }}>Valor *</th>
                  <th>Cuenta contable</th>
                </tr>
              </thead>
              <tbody>
                {form.cuentas.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }} onClick={() => quitarCuenta(i)}>✕</button>
                    </td>
                    <td><input value={c.notas} onChange={(e) => cambiarCuenta(i, 'notas', e.target.value)} style={{ width: '100%' }} /></td>
                    <td>
                      <input type="number" step="0.01" value={c.valor} onChange={(e) => cambiarCuenta(i, 'valor', e.target.value)} style={{ width: '100%' }} required />
                    </td>
                    <td>
                      <select value={c.cuentaContableId} onChange={(e) => cambiarCuenta(i, 'cuentaContableId', e.target.value)} style={{ width: '100%' }}>
                        <option value="">— Búsqueda —</option>
                        {planCuentas.map((pc) => <option key={pc.id} value={pc.id}>{pc.codigo} {pc.nombre}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600, paddingRight: '0.5rem' }}>Total</td>
                  <td style={{ fontWeight: 700 }}>${formatMoney(totalCuentas)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </fieldset>

        {/* ─ Detalle de Pagos ─ */}
        <fieldset style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <legend style={{ fontWeight: 600, color: '#0f766e', padding: '0 6px' }}>Detalle de pagos</legend>
          <button type="button" className="btn btn-primary btn-sm" style={{ marginBottom: '0.75rem' }} onClick={agregarPago}>+ Agregar pago</button>
          {form.pagos.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="movimientos-tabla">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th>Tipo de pago</th>
                    <th style={{ width: 140 }}>Valor</th>
                    <th>Cuenta contable</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {form.pagos.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }} onClick={() => quitarPago(i)}>✕</button>
                      </td>
                      <td>
                        <select value={p.tipoPago} onChange={(e) => cambiarPago(i, 'tipoPago', e.target.value)}>
                          {TIPOS_PAGO_OPT.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                      </td>
                      <td><input type="number" step="0.01" value={p.valor} onChange={(e) => cambiarPago(i, 'valor', e.target.value)} /></td>
                      <td>
                        <select value={p.cuentaContableId} onChange={(e) => cambiarPago(i, 'cuentaContableId', e.target.value)}>
                          <option value="">— Sin cuenta —</option>
                          {planCuentas.map((pc) => <option key={pc.id} value={pc.id}>{pc.codigo} {pc.nombre}</option>)}
                        </select>
                      </td>
                      <td><input value={p.notas} onChange={(e) => cambiarPago(i, 'notas', e.target.value)} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>Total pagos</td>
                    <td style={{ fontWeight: 700 }}>${formatMoney(totalPagos)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </fieldset>

        {error && <p style={{ color: 'var(--color-danger)', marginTop: '0.5rem' }}>{error}</p>}

        {Math.abs(totalCuentas - totalPagos) > 0.01 && totalPagos > 0 && (
          <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginTop: '0.5rem' }}>
            ⚠ El total de cuentas (${formatMoney(totalCuentas)}) difiere del total de pagos (${formatMoney(totalPagos)}).
          </div>
        )}
      </form>
    </div>
  );
}

// ─── Lista de comprobantes ─────────────────────────────────
function ListaComprobantes({ tipo, onNuevo, onVer }) {
  const meta = TIPOS_META[tipo];
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [filtros, setFiltros] = useState({ desde: '', hasta: '', q: '', estado: '' });
  const [pagina, setPagina] = useState(0);
  const LIMIT = 25;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = { tipo, limit: LIMIT, offset: pagina * LIMIT };
      if (filtros.desde) params.desde = filtros.desde;
      if (filtros.hasta) params.hasta = filtros.hasta;
      if (filtros.q)     params.q = filtros.q;
      if (filtros.estado) params.estado = filtros.estado;
      const r = await api.get('/comprobantes-bancarios', { params });
      setItems(r.data?.data?.items || []);
      setTotal(Number(r.data?.data?.total || 0));
    } catch (e) {
      console.error(e);
    } finally {
      setCargando(false);
    }
  }, [tipo, filtros, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  const anular = async (id) => {
    if (!window.confirm('¿Anular este comprobante?')) return;
    try {
      await api.post(`/comprobantes-bancarios/${id}/anular`);
      cargar();
    } catch (err) {
      alert(err.response?.data?.mensaje || 'Error al anular');
    }
  };

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '1rem', padding: '0.75rem', background: '#f8fafc', borderRadius: 8 }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Número</label>
          <input value={filtros.q} onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))} placeholder="Buscar..." style={{ width: 140 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Fecha inicio</label>
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} style={{ width: 140 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Fecha fin</label>
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} style={{ width: 140 }} />
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Estado</label>
          <select value={filtros.estado} onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))} style={{ width: 140 }}>
            <option value="">Todos</option>
            <option value="ARCHIVADO">ARCHIVADO</option>
            <option value="ANULADO">ANULADO</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setPagina(0); cargar(); }}>Aplicar filtros</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setFiltros({ desde: '', hasta: '', q: '', estado: '' }); setPagina(0); }}>Restablecer</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontWeight: 600, color: '#0f766e' }}>{meta.icono} {meta.titulo} ({total})</span>
        <button className="btn btn-primary btn-sm" onClick={onNuevo}>+ Nuevo</button>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>Cargando...</p>
      ) : items.length === 0 ? (
        <div className="bancos-empty">
          <div className="bancos-empty-icon">{meta.icono}</div>
          <p>No hay {meta.titulo.toLowerCase()} registrados</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="movimientos-tabla">
            <thead>
              <tr>
                <th>Acciones</th>
                <th>Fecha</th>
                <th>Identificación</th>
                <th>Nombre</th>
                <th>Número</th>
                <th>Notas</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ opacity: item.estado === 'ANULADO' ? 0.5 : 1 }}>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-ghost btn-sm" title="Ver" onClick={() => onVer(item.id)}>👁</button>
                      {item.estado !== 'ANULADO' && (
                        <button className="btn btn-danger btn-sm" title="Anular" onClick={() => anular(item.id)}>✕</button>
                      )}
                    </div>
                  </td>
                  <td>{formatFecha(item.fecha)}</td>
                  <td style={{ fontSize: '0.82rem' }}>{item.proveedor?.identificacion || '—'}</td>
                  <td>{item.proveedor?.razonSocial || '—'}</td>
                  <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{item.numero}</td>
                  <td style={{ fontSize: '0.82rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.notas}</td>
                  <td>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: '0.78rem', background: item.estado === 'ANULADO' ? '#fee2e2' : '#dcfce7', color: item.estado === 'ANULADO' ? '#991b1b' : '#166534' }}>
                      {item.estado}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>${formatMoney(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMIT && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}>← Anterior</button>
          <span style={{ padding: '6px 12px', fontSize: '0.85rem' }}>Pág {pagina + 1} / {Math.ceil(total / LIMIT)}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setPagina((p) => p + 1)} disabled={(pagina + 1) * LIMIT >= total}>Siguiente →</button>
        </div>
      )}
    </div>
  );
}

// ─── ComprobantesView — componente principal ──────────────
export default function ComprobantesView({ tipo }) {
  const [vista, setVista] = useState('lista'); // lista | subtipo | form
  const [subtipoSel, setSubtipoSel] = useState(null);
  const [detalle, setDetalle] = useState(null);

  const handleNuevo = () => setVista('subtipo');
  const handleSubtipo = (s) => { setSubtipoSel(s); setVista('form'); };
  const handleCancelar = () => setVista('lista');
  const handleGuardado = () => { setVista('lista'); };
  const handleVer = (id) => setDetalle(id); // placeholder — podría abrir un modal de detalle

  const meta = TIPOS_META[tipo] || {};

  return (
    <div>
      {vista === 'lista' && (
        <ListaComprobantes tipo={tipo} onNuevo={handleNuevo} onVer={handleVer} />
      )}

      {vista === 'subtipo' && (
        <ModalSubtipo tipo={tipo} onContinuar={handleSubtipo} onCancelar={handleCancelar} />
      )}

      {vista === 'form' && (
        <FormComprobante tipo={tipo} subtipo={subtipoSel} onCancelar={handleCancelar} onGuardado={handleGuardado} />
      )}
    </div>
  );
}
