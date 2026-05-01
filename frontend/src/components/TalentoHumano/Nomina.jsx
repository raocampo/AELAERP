import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './TalentoHumano.css';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const fmt = (n) => `$${Number(n || 0).toLocaleString('es-EC', { minimumFractionDigits: 2 })}`;
const fmtN = (n) => Number(n || 0).toFixed(2);

const badgeEstado = (estado) => {
  const map = { BORRADOR:'badge-borrador', PROCESADA:'badge-procesada', PAGADA:'badge-pagada' };
  return <span className={map[estado] || 'badge-borrador'}>{estado}</span>;
};

// Abre ventana de impresión con el rol de pagos completo
const imprimirRolPagos = (nomina) => {
  const mes = MESES[nomina.mes - 1];
  const rows = (nomina.detalles || []).map((d) => `
    <tr>
      <td>${d.empleado.cedula}</td>
      <td>${d.empleado.apellidos}, ${d.empleado.nombres}</td>
      <td>${d.empleado.departamento?.nombre || ''}</td>
      <td>${d.empleado.cargo?.nombre || ''}</td>
      <td class="num">${fmtN(d.salarioBase)}</td>
      <td class="num">${fmtN(d.valorHorasExtraSuplemento)}</td>
      <td class="num">${fmtN(d.valorHorasExtraExtraordinario)}</td>
      <td class="num">${fmtN(d.otrosIngresos)}</td>
      <td class="num total-ing">${fmtN(d.totalIngresos)}</td>
      <td class="num">${fmtN(d.aportePersonalIESS)}</td>
      <td class="num">${fmtN(d.impuestoRenta)}</td>
      <td class="num">${fmtN(d.prestamosIESS)}</td>
      <td class="num">${fmtN(d.anticipos)}</td>
      <td class="num">${fmtN(d.otrosDescuentos)}</td>
      <td class="num total-desc">${fmtN(d.totalDescuentos)}</td>
      <td class="num neto">${fmtN(d.netoApagar)}</td>
    </tr>`).join('');

  const sum = (campo) => (nomina.detalles || []).reduce((s, d) => s + Number(d[campo] || 0), 0);
  const totRow = `
    <tr class="totales">
      <td colspan="4"><strong>TOTALES</strong></td>
      <td class="num">${fmtN(sum('salarioBase'))}</td>
      <td class="num">${fmtN(sum('valorHorasExtraSuplemento'))}</td>
      <td class="num">${fmtN(sum('valorHorasExtraExtraordinario'))}</td>
      <td class="num">${fmtN(sum('otrosIngresos'))}</td>
      <td class="num total-ing">${fmtN(sum('totalIngresos'))}</td>
      <td class="num">${fmtN(sum('aportePersonalIESS'))}</td>
      <td class="num">${fmtN(sum('impuestoRenta'))}</td>
      <td class="num">${fmtN(sum('prestamosIESS'))}</td>
      <td class="num">${fmtN(sum('anticipos'))}</td>
      <td class="num">${fmtN(sum('otrosDescuentos'))}</td>
      <td class="num total-desc">${fmtN(sum('totalDescuentos'))}</td>
      <td class="num neto">${fmtN(sum('netoApagar'))}</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Rol de Pagos — ${mes} ${nomina.anio}</title>
  <style>
    @media print { @page { size: landscape; margin: 1cm; } }
    body { font-family: Arial, sans-serif; font-size: 9pt; color: #111; }
    h1 { font-size: 13pt; margin-bottom: 2px; }
    p  { margin: 0; font-size: 9pt; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th { background: #2563eb; color: #fff; padding: 4px 5px; font-size: 8pt; text-align: center; }
    td { padding: 3px 5px; border-bottom: 1px solid #e5e7eb; font-size: 8.5pt; }
    td.num { text-align: right; }
    tr:nth-child(even) td { background: #f8fafc; }
    .total-ing { background: #dbeafe !important; font-weight: bold; }
    .total-desc { background: #fee2e2 !important; font-weight: bold; }
    .neto { background: #dcfce7 !important; font-weight: bold; color: #166534; }
    tr.totales td { background: #f1f5f9 !important; font-weight: bold; border-top: 2px solid #94a3b8; }
    .firma { margin-top: 40px; display: flex; gap: 60px; }
    .firma-item { text-align: center; min-width: 180px; }
    .firma-item .linea { border-top: 1px solid #111; margin-bottom: 4px; padding-top: 4px; font-size: 8pt; }
  </style>
</head>
<body>
  <h1>ROL DE PAGOS — ${mes.toUpperCase()} ${nomina.anio}</h1>
  <p>Estado: ${nomina.estado} &nbsp;|&nbsp; Empleados: ${(nomina.detalles || []).length}</p>
  <table>
    <thead>
      <tr>
        <th>Cédula</th><th>Nombre</th><th>Dpto.</th><th>Cargo</th>
        <th>Sueldo</th><th>H.E.Sup.</th><th>H.E.Ext.</th><th>Otros Ing.</th>
        <th>Total Ing.</th>
        <th>IESS 9.45%</th><th>Imp.Renta</th><th>Prést.IESS</th><th>Anticipos</th><th>Otros Desc.</th>
        <th>Total Desc.</th><th>Neto Pagar</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>${totRow}</tfoot>
  </table>
  <div class="firma">
    <div class="firma-item"><div class="linea">Elaborado por</div></div>
    <div class="firma-item"><div class="linea">Revisado por</div></div>
    <div class="firma-item"><div class="linea">Autorizado por</div></div>
  </div>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=1200,height=800');
  w.document.write(html);
  w.document.close();
};

const Nomina = () => {
  const hoy = new Date();
  const [nominas, setNominas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nominaSel, setNominaSel] = useState(null);
  const [detLoading, setDetLoading] = useState(false);
  const [anioFiltro, setAnioFiltro] = useState(hoy.getFullYear().toString());
  const [modalNueva, setModalNueva] = useState(false);
  const [formNueva, setFormNueva] = useState({ mes: hoy.getMonth() + 1, anio: hoy.getFullYear(), observaciones: '' });
  const [creando, setCreando] = useState(false);
  const [detalleEdit, setDetalleEdit] = useState(null); // empleadoId seleccionado para editar

  const cargarNominas = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/talento-humano/nomina', { params: { anio: anioFiltro } });
      setNominas(r.data.data);
    } catch {
      toast.error('Error al cargar nóminas');
    } finally {
      setLoading(false);
    }
  }, [anioFiltro]);

  const cargarDetalle = useCallback(async (nominaId) => {
    setDetLoading(true);
    try {
      const r = await api.get(`/talento-humano/nomina/${nominaId}`);
      setNominaSel(r.data.data);
    } catch {
      toast.error('Error al cargar detalle');
    } finally {
      setDetLoading(false);
    }
  }, []);

  useEffect(() => { cargarNominas(); }, [cargarNominas]);

  const crearNomina = async (e) => {
    e.preventDefault();
    setCreando(true);
    try {
      await api.post('/talento-humano/nomina', formNueva);
      toast.success('Nómina creada y calculada automáticamente');
      setModalNueva(false);
      cargarNominas();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al crear nómina');
    } finally {
      setCreando(false);
    }
  };

  const cambiarEstado = async (nominaId, estado) => {
    if (!confirm(`¿Cambiar el estado a ${estado}?`)) return;
    try {
      await api.patch(`/talento-humano/nomina/${nominaId}/estado`, { estado });
      toast.success('Estado actualizado');
      cargarNominas();
      if (nominaSel?.id === nominaId) cargarDetalle(nominaId);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error');
    }
  };

  const descargarCSV = async (nominaId) => {
    try {
      const r = await api.get(`/talento-humano/nomina/${nominaId}/csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement('a');
      a.href = url;
      const mes = nominaSel ? `${String(nominaSel.mes).padStart(2,'0')}_${nominaSel.anio}` : nominaId;
      a.download = `nomina_${mes}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Error al descargar CSV');
    }
  };

  const eliminar = async (nominaId) => {
    if (!confirm('¿Eliminar esta nómina? Esta acción no se puede deshacer.')) return;
    try {
      await api.delete(`/talento-humano/nomina/${nominaId}`);
      toast.success('Nómina eliminada');
      if (nominaSel?.id === nominaId) setNominaSel(null);
      cargarNominas();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error');
    }
  };

  const aniosDisponibles = [];
  for (let a = hoy.getFullYear(); a >= hoy.getFullYear() - 3; a--) aniosDisponibles.push(a);

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>💰 Nómina / Rol de Pagos</h1>
        <div className="th-toolbar">
          <select
            className="th-search"
            style={{ minWidth: 110 }}
            value={anioFiltro}
            onChange={e => setAnioFiltro(e.target.value)}
          >
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn-th-primary" onClick={() => setModalNueva(true)}>+ Nueva Nómina</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: nominaSel ? '1fr 2fr' : '1fr', gap: '1rem' }}>
        {/* Lista de nóminas */}
        <div>
          {loading ? (
            <div className="th-loading">Cargando…</div>
          ) : (
            <div className="th-table-wrapper">
              <table className="th-table">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Empleados</th>
                    <th>Neto</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {nominas.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign:'center', padding:'2rem', color:'#a0aec0' }}>
                      Sin nóminas para {anioFiltro}
                    </td></tr>
                  ) : nominas.map(n => (
                    <tr key={n.id} style={{ cursor:'pointer', background: nominaSel?.id === n.id ? 'var(--color-surface-alt,#f7fafc)' : '' }}>
                      <td onClick={() => cargarDetalle(n.id)}>
                        {MESES[n.mes - 1]} {n.anio}
                      </td>
                      <td onClick={() => cargarDetalle(n.id)}>{n._count?.detalles ?? '—'}</td>
                      <td onClick={() => cargarDetalle(n.id)}>{fmt(n.totalNeto)}</td>
                      <td onClick={() => cargarDetalle(n.id)}>{badgeEstado(n.estado)}</td>
                      <td>
                        <div className="actions">
                          {n.estado === 'BORRADOR' && (
                            <button className="btn-th-sm" onClick={() => cambiarEstado(n.id, 'PROCESADA')}>▶ Procesar</button>
                          )}
                          {n.estado === 'PROCESADA' && (
                            <button className="btn-th-sm" onClick={() => cambiarEstado(n.id, 'PAGADA')}>✅ Pagar</button>
                          )}
                          {n.estado !== 'PAGADA' && (
                            <button className="btn-th-danger" onClick={() => eliminar(n.id)}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detalle de nómina */}
        {nominaSel && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
              <h2 style={{ margin:0, fontSize:'1.1rem', fontWeight:700 }}>
                {MESES[nominaSel.mes - 1]} {nominaSel.anio} — {badgeEstado(nominaSel.estado)}
              </h2>
              <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                <button className="btn-th-secondary" onClick={() => descargarCSV(nominaSel.id)} title="Descargar CSV">
                  📥 CSV
                </button>
                <button className="btn-th-secondary" onClick={() => imprimirRolPagos(nominaSel)} title="Imprimir Rol de Pagos">
                  🖨️ Imprimir
                </button>
                <button className="btn-th-secondary" onClick={() => setNominaSel(null)}>✕ Cerrar</button>
              </div>
            </div>

            {/* Resumen */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.75rem', marginBottom:'1rem' }}>
              {[
                { label:'Total Bruto', value: fmt(nominaSel.totalBruto) },
                { label:'Total Descuentos', value: fmt(nominaSel.totalDescuentos) },
                { label:'Total Neto', value: fmt(nominaSel.totalNeto), bold: true },
              ].map(c => (
                <div key={c.label} style={{ background:'var(--color-surface-alt,#f7fafc)', border:'1px solid var(--color-border,#e2e8f0)', borderRadius:8, padding:'0.75rem' }}>
                  <div style={{ fontSize:'0.75rem', color:'var(--color-text-muted,#718096)', textTransform:'uppercase' }}>{c.label}</div>
                  <div style={{ fontSize: c.bold ? '1.2rem' : '1rem', fontWeight: c.bold ? 700 : 600, color: c.bold ? 'var(--color-primary,#3b82f6)' : 'inherit' }}>{c.value}</div>
                </div>
              ))}
            </div>

            {detLoading ? <div className="th-loading">Cargando detalles…</div> : (
              <div className="th-table-wrapper" style={{ maxHeight: 420, overflowY:'auto' }}>
                <table className="th-table">
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Salario</th>
                      <th>Ingresos extra</th>
                      <th>Descuentos</th>
                      <th>Neto</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nominaSel.detalles?.map(det => (
                      <tr key={det.id}>
                        <td>
                          <div style={{ fontWeight:500 }}>{det.empleado.apellidos}, {det.empleado.nombres}</div>
                          <div style={{ fontSize:'0.75rem', color:'#a0aec0' }}>{det.empleado.cargo?.nombre}</div>
                        </td>
                        <td>{fmt(det.salarioBase)}</td>
                        <td>{fmt(Number(det.valorHorasExtraSuplemento) + Number(det.valorHorasExtraExtraordinario) + Number(det.otrosIngresos))}</td>
                        <td>{fmt(det.totalDescuentos)}</td>
                        <td style={{ fontWeight:600 }}>{fmt(det.netoApagar)}</td>
                        <td>
                          {nominaSel.estado !== 'PAGADA' && (
                            <button className="btn-th-sm" onClick={() => setDetalleEdit(det)}>✏️</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal nueva nómina */}
      {modalNueva && (
        <div className="th-modal-overlay" onClick={e => e.target === e.currentTarget && setModalNueva(false)}>
          <div className="th-modal">
            <h2>Nueva Nómina</h2>
            <p style={{ fontSize:'0.85rem', color:'#718096', marginTop:'-0.5rem', marginBottom:'1rem' }}>
              Se calculará automáticamente para todos los empleados activos.
            </p>
            <form onSubmit={crearNomina}>
              <div className="th-form-grid">
                <div className="th-form-group">
                  <label>Mes *</label>
                  <select value={formNueva.mes} onChange={e => setFormNueva(f => ({ ...f, mes: parseInt(e.target.value) }))}>
                    {MESES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <div className="th-form-group">
                  <label>Año *</label>
                  <select value={formNueva.anio} onChange={e => setFormNueva(f => ({ ...f, anio: parseInt(e.target.value) }))}>
                    {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="th-form-group full">
                  <label>Observaciones</label>
                  <textarea
                    value={formNueva.observaciones}
                    onChange={e => setFormNueva(f => ({ ...f, observaciones: e.target.value }))}
                    rows={2}
                  />
                </div>
              </div>
              <div className="th-modal-actions">
                <button type="button" className="btn-th-secondary" onClick={() => setModalNueva(false)}>Cancelar</button>
                <button type="submit" className="btn-th-primary" disabled={creando}>
                  {creando ? 'Calculando…' : 'Crear nómina'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal edición detalle */}
      {detalleEdit && nominaSel && (
        <DetalleEditModal
          detalle={detalleEdit}
          nominaId={nominaSel.id}
          onClose={() => setDetalleEdit(null)}
          onSaved={() => { setDetalleEdit(null); cargarDetalle(nominaSel.id); cargarNominas(); }}
        />
      )}
    </div>
  );
};

// ── Sub-componente edición detalle de nómina ──────────────────────────────────
const DetalleEditModal = ({ detalle, nominaId, onClose, onSaved }) => {
  const irCalculadoInicial = parseFloat(detalle.impuestoRenta || 0);
  const [form, setForm] = useState({
    horasExtraSuplemento: detalle.horasExtraSuplemento || 0,
    horasExtraExtraordinario: detalle.horasExtraExtraordinario || 0,
    otrosIngresos: detalle.otrosIngresos || 0,
    otrosIngresosDetalle: detalle.otrosIngresosDetalle || '',
    impuestoRenta: irCalculadoInicial,
    irManual: false,           // false = dejar que el backend recalcule con LORTI
    prestamosIESS: detalle.prestamosIESS || 0,
    anticipos: detalle.anticipos || 0,
    otrosDescuentos: detalle.otrosDescuentos || 0,
    otrosDescuentosDetalle: detalle.otrosDescuentosDetalle || '',
    observaciones: detalle.observaciones || '',
  });
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.put(`/talento-humano/nomina/${nominaId}/detalle/${detalle.empleadoId}`, form);
      toast.success('Detalle actualizado');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error');
    } finally {
      setGuardando(false);
    }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="th-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="th-modal th-modal-lg">
        <h2>Editar detalle: {detalle.empleado?.apellidos}, {detalle.empleado?.nombres}</h2>
        <p style={{ fontSize:'0.8rem', color:'#718096', marginTop:'-0.5rem', marginBottom:'1rem' }}>
          Salario base: <strong>${Number(detalle.salarioBase || 0).toFixed(2)}</strong>
          &nbsp;·&nbsp; IESS 9.45%: <strong>${Number(detalle.aportePersonalIESS || 0).toFixed(2)}</strong>
          &nbsp;·&nbsp; IR LORTI calculado al crear: <strong>${irCalculadoInicial.toFixed(2)}</strong>
        </p>
        <form onSubmit={guardar}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
            <fieldset style={{ border:'1px solid var(--color-border,#e2e8f0)', borderRadius:8, padding:'1rem' }}>
              <legend style={{ fontSize:'0.8rem', fontWeight:600, color:'#718096', padding:'0 0.4rem' }}>INGRESOS EXTRA</legend>
              {[
                ['horasExtraSuplemento','Horas extra suplementarias (25%)','number'],
                ['horasExtraExtraordinario','Horas extra extraordinarias (50%)','number'],
                ['otrosIngresos','Otros ingresos ($)','number'],
                ['otrosIngresosDetalle','Detalle otros ingresos','text'],
              ].map(([k, label, type]) => (
                <div className="th-form-group" key={k} style={{ marginBottom:'0.65rem' }}>
                  <label>{label}</label>
                  <input type={type} step="0.01" value={form[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
            </fieldset>
            <fieldset style={{ border:'1px solid var(--color-border,#e2e8f0)', borderRadius:8, padding:'1rem' }}>
              <legend style={{ fontSize:'0.8rem', fontWeight:600, color:'#718096', padding:'0 0.4rem' }}>DESCUENTOS</legend>

              {/* Impuesto Renta con override manual */}
              <div className="th-form-group" style={{ marginBottom:'0.65rem' }}>
                <label style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <span>Impuesto a la Renta ($)</span>
                  <small style={{
                    background: form.irManual ? '#fef3c7' : '#dbeafe',
                    color: form.irManual ? '#92400e' : '#1e40af',
                    borderRadius:4, padding:'1px 6px', fontSize:'0.7rem', fontWeight:600,
                  }}>
                    {form.irManual ? '⚠️ Manual' : '⚡ LORTI Auto'}
                  </small>
                </label>
                <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
                  <input
                    type="number" step="0.01"
                    value={form.impuestoRenta}
                    onChange={e => set('impuestoRenta', e.target.value)}
                    disabled={!form.irManual}
                    style={{ flex:1, opacity: form.irManual ? 1 : 0.6 }}
                  />
                  <button
                    type="button"
                    className={form.irManual ? 'btn-th-danger' : 'btn-th-sm'}
                    style={{ whiteSpace:'nowrap', fontSize:'0.75rem' }}
                    onClick={() => set('irManual', !form.irManual)}
                    title={form.irManual ? 'Volver a cálculo automático LORTI' : 'Ingresar valor manual'}
                  >
                    {form.irManual ? '↩ Auto' : '✏️ Manual'}
                  </button>
                </div>
                {!form.irManual && (
                  <small style={{ color:'#64748b', fontSize:'0.7rem' }}>
                    Al guardar se recalculará con la tabla LORTI 2024 incluyendo las HE y otros ingresos.
                  </small>
                )}
              </div>

              {[
                ['prestamosIESS','Préstamos IESS ($)','number'],
                ['anticipos','Anticipos ($)','number'],
                ['otrosDescuentos','Otros descuentos ($)','number'],
                ['otrosDescuentosDetalle','Detalle otros descuentos','text'],
              ].map(([k, label, type]) => (
                <div className="th-form-group" key={k} style={{ marginBottom:'0.65rem' }}>
                  <label>{label}</label>
                  <input type={type} step="0.01" value={form[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
            </fieldset>
          </div>
          <div className="th-form-group" style={{ marginTop:'0.75rem' }}>
            <label>Observaciones</label>
            <textarea value={form.observaciones} onChange={e => set('observaciones', e.target.value)} rows={2} />
          </div>
          <div className="th-modal-actions">
            <button type="button" className="btn-th-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-th-primary" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Nomina;
