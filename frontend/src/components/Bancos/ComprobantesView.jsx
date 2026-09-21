import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { formatFechaCorta, hoyLocal } from '../../utils/fecha';
import { abrirComprobanteBancario, descargarComprobanteBancario } from '../../utils/comprobantesBancos';
import { descargarExcel } from '../../utils/exportCsv';
import { IcVer, IcPDF, IcDescargar, IcEditar, IcAnular } from '../../utils/icons';

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
// `comprobanteExistente` (detalle completo de GET /:id) activa el modo
// edición: precarga el formulario, exige "motivo de la corrección" y
// guarda con PUT en vez de POST. El asiento contable nunca se edita —
// el backend lo reversa y crea uno nuevo (ver PUT /:id en
// routes/comprobantes-bancarios.js).
function FormComprobante({ tipo, subtipo, comprobanteExistente, onCancelar, onGuardado }) {
  const meta = TIPOS_META[tipo];
  const planCuentas = usePlanCuentas();
  const cuentasBancarias = useCuentasBancarias();
  const editando = Boolean(comprobanteExistente);

  const [form, setForm] = useState(() => {
    if (!comprobanteExistente) {
      return {
        fecha: hoyLocal(),
        notas: '',
        cuentaBancariaId: '',
        proveedorId: '',
        proveedorNombre: '',
        proveedorRuc: '',
        cuentas: [{ notas: '', valor: '', cuentaContableId: '' }],
        pagos: [{ tipoPago: 'EFECTIVO', valor: '', cuentaContableId: '', notas: '', referencia: '' }],
        motivoEdicion: '',
      };
    }
    const c = comprobanteExistente;
    return {
      fecha: c.fecha ? String(c.fecha).slice(0, 10) : hoyLocal(),
      notas: c.notas || '',
      cuentaBancariaId: c.cuentaBancariaId ? String(c.cuentaBancariaId) : '',
      proveedorId: c.proveedorId ? String(c.proveedorId) : '',
      proveedorNombre: c.proveedor?.razonSocial || '',
      proveedorRuc: c.proveedor?.identificacion || '',
      cuentas: c.cuentas?.length
        ? c.cuentas.map((x) => ({ notas: x.notas || '', valor: String(x.valor ?? ''), cuentaContableId: x.cuentaContableId ? String(x.cuentaContableId) : '' }))
        : [{ notas: '', valor: '', cuentaContableId: '' }],
      pagos: c.pagos?.length
        ? c.pagos.map((x) => ({ tipoPago: x.tipoPago, valor: String(x.valor ?? ''), cuentaContableId: x.cuentaContableId ? String(x.cuentaContableId) : '', notas: x.notas || '', referencia: x.referencia || '' }))
        : [{ tipoPago: 'EFECTIVO', valor: '', cuentaContableId: '', notas: '', referencia: '' }],
      motivoEdicion: '',
    };
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [buscandoProv, setBuscandoProv] = useState(false);
  // Comprobante ya guardado: se muestra el panel de éxito con "Imprimir".
  const [creado, setCreado] = useState(null);

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

  const agregarPago = () => setForm((f) => ({ ...f, pagos: [...f.pagos, { tipoPago: 'EFECTIVO', valor: '', cuentaContableId: '', notas: '', referencia: '' }] }));
  const quitarPago = (i) => setForm((f) => ({ ...f, pagos: f.pagos.filter((_, idx) => idx !== i) }));
  const cambiarPago = (i, k, v) => setForm((f) => ({ ...f, pagos: f.pagos.map((p, idx) => idx === i ? { ...p, [k]: v } : p) }));

  // Caso simple (1 cuenta + 1 pago, el más común): el valor y la nota de
  // "Cuentas" se reflejan solos en "Detalle de pagos" mientras el usuario no
  // haya escrito algo DISTINTO ahí — así solo falta elegir tipo/forma y
  // cuenta contable del pago, sin volver a teclear el mismo monto.
  //
  // "¿el usuario ya lo tocó?" no puede ser "¿está vacío o en 0?" — después
  // del primer auto-completado el valor deja de estar vacío, así que un
  // 2do dígito escrito en "Cuentas" (120 → 12, luego 120) dejaba de
  // propagarse (bug real: cuentas $120 vs pagos $1). Se recuerda en un ref
  // cuál fue el último valor que ESTE efecto escribió — si el campo sigue
  // siendo igual a eso, todavía es "nuestro" y se puede seguir actualizando.
  const ultimoAutoValor = useRef(null);
  const ultimaAutoNota = useRef(null);
  useEffect(() => {
    if (form.cuentas.length !== 1 || form.pagos.length !== 1) return;
    const cuenta = form.cuentas[0];
    const pago = form.pagos[0];
    const valorEsAuto = pago.valor === '' || pago.valor === ultimoAutoValor.current;
    const notaEsAuto = !pago.notas || pago.notas === ultimaAutoNota.current;
    const nuevoValor = valorEsAuto ? cuenta.valor : pago.valor;
    const nuevasNotas = notaEsAuto ? (cuenta.notas || form.notas) : pago.notas;
    ultimoAutoValor.current = nuevoValor;
    ultimaAutoNota.current = nuevasNotas;
    if (nuevoValor === pago.valor && nuevasNotas === pago.notas) return;
    setForm((f) => ({ ...f, pagos: [{ ...f.pagos[0], valor: nuevoValor, notas: nuevasNotas }] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cuentas, form.notas]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.cuentas.length === 0) return setError('Agregue al menos una cuenta');
    if (editando && !form.motivoEdicion.trim()) return setError('Debes indicar el motivo de la corrección');
    setError('');
    setGuardando(true);
    try {
      const payload = {
        tipo, subtipo,
        fecha: form.fecha,
        notas: form.notas || null,
        cuentaBancariaId: form.cuentaBancariaId || null,
        proveedorId: form.proveedorId || null,
        cuentas: form.cuentas.map((c) => ({ notas: c.notas, valor: Number(c.valor || 0), cuentaContableId: c.cuentaContableId || null })),
        pagos: form.pagos.map((p) => ({ tipoPago: p.tipoPago, valor: Number(p.valor || 0), cuentaContableId: p.cuentaContableId || null, notas: p.notas, referencia: p.referencia || null })),
      };
      let id, numero;
      if (editando) {
        await api.put(`/comprobantes-bancarios/${comprobanteExistente.id}`, { ...payload, motivoEdicion: form.motivoEdicion.trim() });
        id = comprobanteExistente.id;
        numero = comprobanteExistente.numero;
      } else {
        const r = await api.post('/comprobantes-bancarios', payload);
        id = r.data?.data?.id;
        numero = r.data?.data?.numero;
      }
      setCreado({ id, numero });
      // Se manda a imprimir solo — abrirComprobanteBancario usa un <a>
      // sintético con blob, no window.open, así que el navegador no lo
      // bloquea aunque venga justo después del await de guardado.
      abrirComprobanteBancario(id);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  if (creado) {
    return (
      <div style={{ padding: '1.5rem', maxWidth: 900 }}>
        <h2 style={{ margin: '0 0 0.5rem' }}>✓ Comprobante {editando ? 'corregido' : 'registrado'}</h2>
        <p style={{ margin: '0 0 1rem' }}>N° <strong>{creado.numero}</strong></p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={() => abrirComprobanteBancario(creado.id)}>🧾 Ver / imprimir comprobante</button>
          <button className="btn btn-ghost" onClick={onGuardado}>Volver a la lista</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0 }}>{editando ? 'Editar' : 'Nuevo'} {meta.titulo.replace('s', '').replace('Comprobantes de ', 'Comprobante de ')}</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar corrección' : 'Guardar'}</button>
          <button className="btn btn-ghost" onClick={onCancelar}>Cancelar</button>
        </div>
      </div>

      {editando && (
        <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '1rem', marginBottom: '1rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            Motivo de la corrección *
          </label>
          <textarea
            rows={2}
            value={form.motivoEdicion}
            onChange={(e) => setForm((f) => ({ ...f, motivoEdicion: e.target.value }))}
            placeholder="Ej: el cliente registró el año 2023 por error, corresponde a 2026"
            style={{ width: '100%', boxSizing: 'border-box' }}
            required
          />
          <p style={{ fontSize: '0.78rem', color: '#78350f', margin: '0.4rem 0 0' }}>
            El asiento contable anterior se reversa automáticamente y se crea uno nuevo con los datos
            corregidos — este motivo queda guardado como historial, visible en "Ver detalle".
          </p>
        </div>
      )}

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
              <textarea rows={3} value={form.notas} onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} placeholder="Descripción del comprobante — a qué corresponde este ingreso/egreso" required />
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
                    <th>N° referencia</th>
                    <th>Cuenta contable</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {form.pagos.map((p, i) => {
                    const requiereReferencia = p.tipoPago === 'CHEQUE' || p.tipoPago === 'TRANSFERENCIA';
                    return (
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
                        {requiereReferencia ? (
                          <input
                            value={p.referencia}
                            onChange={(e) => cambiarPago(i, 'referencia', e.target.value)}
                            placeholder={p.tipoPago === 'CHEQUE' ? 'N° de cheque' : 'N° de transferencia'}
                          />
                        ) : (
                          <span style={{ color: 'var(--color-text-muted, #94a3b8)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td>
                        <select value={p.cuentaContableId} onChange={(e) => cambiarPago(i, 'cuentaContableId', e.target.value)}>
                          <option value="">— Sin cuenta —</option>
                          {planCuentas.map((pc) => <option key={pc.id} value={pc.id}>{pc.codigo} {pc.nombre}</option>)}
                        </select>
                      </td>
                      <td><input value={p.notas} onChange={(e) => cambiarPago(i, 'notas', e.target.value)} /></td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>Total pagos</td>
                    <td style={{ fontWeight: 700 }}>${formatMoney(totalPagos)}</td>
                    <td colSpan={3}></td>
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

// ─── Modal: ver detalle (solo lectura + historial de correcciones) ──
function ModalDetalleComprobante({ id, onClose, onEditar }) {
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let ignore = false;
    setCargando(true);
    api.get(`/comprobantes-bancarios/${id}`)
      .then((r) => { if (!ignore) setData(r.data?.data || null); })
      .catch(() => { if (!ignore) alert('No se pudo cargar el comprobante'); })
      .finally(() => { if (!ignore) setCargando(false); });
    return () => { ignore = true; };
  }, [id]);

  return (
    <div className="bancos-modal-overlay" onClick={onClose}>
      <div className="bancos-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        {cargando ? (
          <p>Cargando...</p>
        ) : !data ? (
          <p>No se encontró el comprobante.</p>
        ) : (
          <>
            <h2 style={{ margin: '0 0 0.75rem' }}>Comprobante {data.numero}</h2>
            <p style={{ margin: '0 0 0.3rem', fontSize: '0.88rem' }}>
              <strong>Fecha:</strong> {formatFecha(data.fecha)} &nbsp;·&nbsp; <strong>Estado:</strong> {data.estado}
            </p>
            {data.proveedor && (
              <p style={{ margin: '0 0 0.3rem', fontSize: '0.88rem' }}>
                <strong>Proveedor:</strong> {data.proveedor.razonSocial} ({data.proveedor.identificacion})
              </p>
            )}
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}><strong>Notas:</strong> {data.notas || '—'}</p>

            <h3 style={{ fontSize: '0.9rem', margin: '0.75rem 0 0.4rem' }}>Cuentas</h3>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
              {data.cuentas.map((c) => (
                <li key={c.id}>{c.codigo ? `${c.codigo} — ` : ''}{c.cuentaNombre || 'Sin cuenta contable'}{c.notas ? ` (${c.notas})` : ''}: ${formatMoney(c.valor)}</li>
              ))}
            </ul>

            {data.pagos.length > 0 && (
              <>
                <h3 style={{ fontSize: '0.9rem', margin: '0.75rem 0 0.4rem' }}>Detalle de pagos</h3>
                <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.85rem' }}>
                  {data.pagos.map((p) => (
                    <li key={p.id}>{p.tipoPago.replace(/_/g, ' ')}{p.referencia ? ` (Ref. ${p.referencia})` : ''}: ${formatMoney(p.valor)}</li>
                  ))}
                </ul>
              </>
            )}

            <p style={{ margin: '0.75rem 0 0', fontWeight: 700 }}>Total: ${formatMoney(data.total)}</p>

            {data.historialEdiciones?.length > 0 && (
              <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 8, padding: '0.6rem 0.75rem', marginTop: '0.85rem' }}>
                <strong style={{ fontSize: '0.85rem' }}>Historial de correcciones</strong>
                <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem' }}>
                  {data.historialEdiciones.map((h, i) => (
                    <li key={i} style={{ fontSize: '0.8rem' }}>{formatFecha(h.fecha)} — {h.motivo}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          {data && data.estado !== 'ANULADO' && (
            <button className="btn btn-primary" onClick={() => onEditar(data.id)}>✏️ Editar</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Lista de comprobantes ─────────────────────────────────
function ListaComprobantes({ tipo, onNuevo, onVer, onDescargar, onEditar, onVisualizar }) {
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
      // Antes fallaba en silencio: el listado quedaba en 0 sin avisar que la
      // consulta realmente reventó (bug real: parámetro NULL sin tipo en el
      // filtro — ver fix en routes/comprobantes-bancarios.js).
      alert(e.response?.data?.mensaje || 'No se pudo cargar el listado de comprobantes');
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

  // Excel del listado completo (mismos filtros aplicados en pantalla, sin
  // paginar) — para análisis/corroboración fuera del sistema.
  const exportarExcel = async () => {
    try {
      const params = { tipo };
      if (filtros.desde) params.desde = filtros.desde;
      if (filtros.hasta) params.hasta = filtros.hasta;
      if (filtros.q)     params.q = filtros.q;
      if (filtros.estado) params.estado = filtros.estado;
      await descargarExcel(api, '/comprobantes-bancarios/export/excel', params, `comprobantes-${tipo.toLowerCase()}.xlsx`);
    } catch {
      alert('No se pudo generar el Excel del listado');
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportarExcel} disabled={items.length === 0} title="Exportar el listado a Excel">
            📊 Exportar Excel
          </button>
          <button className="btn btn-primary btn-sm" onClick={onNuevo}>+ Nuevo</button>
        </div>
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
                    <div className="tbl-acciones">
                      <button className="btn-icon ic-ver" title="Visualizar" onClick={() => onVisualizar(item.id)}><IcVer /></button>
                      <button className="btn-icon ic-pdf" title="Imprimir" onClick={() => onVer(item.id)}><IcPDF /></button>
                      <button className="btn-icon ic-descargar" title="Descargar PDF" onClick={() => onDescargar(item.id, item.numero)}><IcDescargar /></button>
                      {item.estado !== 'ANULADO' && (
                        <>
                          <button className="btn-icon ic-editar" title="Editar" onClick={() => onEditar(item.id)}><IcEditar /></button>
                          <button className="btn-icon ic-anular" title="Anular" onClick={() => anular(item.id)}><IcAnular /></button>
                        </>
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
  const [comprobanteEditar, setComprobanteEditar] = useState(null); // detalle completo (GET /:id) en modo edición
  const [modalDetalleId, setModalDetalleId] = useState(null);
  const [cargandoEditar, setCargandoEditar] = useState(false);

  const handleNuevo = () => { setComprobanteEditar(null); setVista('subtipo'); };
  const handleSubtipo = (s) => { setSubtipoSel(s); setVista('form'); };
  const handleCancelar = () => { setVista('lista'); setComprobanteEditar(null); };
  const handleGuardado = () => { setVista('lista'); setComprobanteEditar(null); };
  const handleVer = (id) => abrirComprobanteBancario(id);
  const handleDescargar = (id, numero) => descargarComprobanteBancario(id, numero);
  const handleVisualizar = (id) => setModalDetalleId(id);

  const handleEditar = async (id) => {
    setModalDetalleId(null);
    setCargandoEditar(true);
    try {
      const r = await api.get(`/comprobantes-bancarios/${id}`);
      const data = r.data?.data;
      setComprobanteEditar(data);
      setSubtipoSel(data?.subtipo || 'GENERAL');
      setVista('form');
    } catch {
      alert('No se pudo cargar el comprobante para editar');
    } finally {
      setCargandoEditar(false);
    }
  };

  return (
    <div>
      {vista === 'lista' && (
        <ListaComprobantes
          tipo={tipo}
          onNuevo={handleNuevo}
          onVer={handleVer}
          onDescargar={handleDescargar}
          onEditar={handleEditar}
          onVisualizar={handleVisualizar}
        />
      )}

      {vista === 'subtipo' && (
        <ModalSubtipo tipo={tipo} onContinuar={handleSubtipo} onCancelar={handleCancelar} />
      )}

      {vista === 'form' && (
        <FormComprobante
          tipo={tipo}
          subtipo={subtipoSel}
          comprobanteExistente={comprobanteEditar}
          onCancelar={handleCancelar}
          onGuardado={handleGuardado}
        />
      )}

      {modalDetalleId && (
        <ModalDetalleComprobante id={modalDetalleId} onClose={() => setModalDetalleId(null)} onEditar={handleEditar} />
      )}

      {cargandoEditar && (
        <div className="bancos-modal-overlay">
          <div className="bancos-modal" style={{ maxWidth: 320, textAlign: 'center' }}>Cargando comprobante…</div>
        </div>
      )}
    </div>
  );
}
