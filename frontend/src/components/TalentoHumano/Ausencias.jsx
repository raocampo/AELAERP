import { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './TalentoHumano.css';

const TIPOS_AUSENCIA = [
  { value: 'vacacion',   label: 'Vacación' },
  { value: 'permiso',    label: 'Permiso Personal' },
  { value: 'enfermedad', label: 'Enfermedad' },
  { value: 'maternidad', label: 'Maternidad' },
  { value: 'paternidad', label: 'Paternidad' },
  { value: 'licencia',   label: 'Licencia' },
];

const EMPTY = { empleadoId: '', tipo: 'vacacion', fechaInicio: '', fechaFin: '', observaciones: '' };

const Ausencias = () => {
  const [lista, setLista] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [empFiltro, setEmpFiltro] = useState('');
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [aprobadoFiltro, setAprobadoFiltro] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [guardando, setGuardando] = useState(false);
  const PER_PAGE = 50;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PER_PAGE };
      if (empFiltro) params.empleadoId = empFiltro;
      if (tipoFiltro) params.tipo = tipoFiltro;
      if (aprobadoFiltro !== '') params.aprobado = aprobadoFiltro;
      const [r, emps] = await Promise.all([
        api.get('/talento-humano/ausencias', { params }),
        empleados.length === 0 ? api.get('/talento-humano/empleados', { params: { activo:'true', limit: 500 } }) : Promise.resolve(null),
      ]);
      setLista(r.data.data);
      setTotal(r.data.total);
      if (emps) setEmpleados(emps.data.data);
    } catch {
      toast.error('Error al cargar ausencias');
    } finally {
      setLoading(false);
    }
  }, [empFiltro, tipoFiltro, aprobadoFiltro, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      await api.post('/talento-humano/ausencias', form);
      toast.success('Ausencia registrada');
      setModal(false);
      setForm(EMPTY);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al registrar');
    } finally {
      setGuardando(false);
    }
  };

  const toggleAprobar = async (aus) => {
    try {
      await api.patch(`/talento-humano/ausencias/${aus.id}/aprobar`);
      toast.success(aus.aprobado ? 'Aprobación retirada' : 'Ausencia aprobada');
      cargar();
    } catch {
      toast.error('Error');
    }
  };

  const eliminar = async (aus) => {
    if (!confirm('¿Eliminar este registro de ausencia?')) return;
    try {
      await api.delete(`/talento-humano/ausencias/${aus.id}`);
      toast.success('Eliminado');
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error');
    }
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>📅 Ausencias y Vacaciones</h1>
        <div className="th-toolbar">
          <select
            className="th-search"
            style={{ minWidth: 180 }}
            value={empFiltro}
            onChange={e => { setEmpFiltro(e.target.value); setPage(1); }}
          >
            <option value="">Todos los empleados</option>
            {empleados.map(e => <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres}</option>)}
          </select>
          <select
            className="th-search"
            style={{ minWidth: 130 }}
            value={tipoFiltro}
            onChange={e => { setTipoFiltro(e.target.value); setPage(1); }}
          >
            <option value="">Todos los tipos</option>
            {TIPOS_AUSENCIA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select
            className="th-search"
            style={{ minWidth: 130 }}
            value={aprobadoFiltro}
            onChange={e => { setAprobadoFiltro(e.target.value); setPage(1); }}
          >
            <option value="">Todos</option>
            <option value="false">Pendientes</option>
            <option value="true">Aprobados</option>
          </select>
          <button className="btn-th-primary" onClick={() => { setForm(EMPTY); setModal(true); }}>+ Registrar</button>
        </div>
      </div>

      {loading ? (
        <div className="th-loading">Cargando…</div>
      ) : (
        <>
          <div className="th-table-wrapper">
            <table className="th-table">
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Tipo</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                  <th>Días</th>
                  <th>Estado</th>
                  <th>Observaciones</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#a0aec0' }}>Sin registros</td></tr>
                ) : lista.map(aus => (
                  <tr key={aus.id}>
                    <td style={{ fontWeight:500 }}>
                      {aus.empleado.apellidos}, {aus.empleado.nombres}
                    </td>
                    <td>{TIPOS_AUSENCIA.find(t => t.value === aus.tipo)?.label || aus.tipo}</td>
                    <td>{new Date(aus.fechaInicio).toLocaleDateString('es-EC')}</td>
                    <td>{new Date(aus.fechaFin).toLocaleDateString('es-EC')}</td>
                    <td>{aus.dias}</td>
                    <td>
                      <span className={aus.aprobado ? 'badge-aprobado' : 'badge-pendiente'}>
                        {aus.aprobado ? 'Aprobado' : 'Pendiente'}
                      </span>
                    </td>
                    <td style={{ maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {aus.observaciones || '—'}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn-th-sm" onClick={() => toggleAprobar(aus)}>
                          {aus.aprobado ? '↩ Retirar' : '✅ Aprobar'}
                        </button>
                        <button className="btn-th-danger" onClick={() => eliminar(aus)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="th-pagination">
              <span>{total} registros — Página {page} de {totalPages}</span>
              <div className="th-pagination-btns">
                <button className="btn-th-secondary" disabled={page === 1} onClick={() => setPage(p => p-1)}>← Anterior</button>
                <button className="btn-th-secondary" disabled={page === totalPages} onClick={() => setPage(p => p+1)}>Siguiente →</button>
              </div>
            </div>
          )}
        </>
      )}

      {modal && (
        <div className="th-modal-overlay" onClick={e => e.target === e.currentTarget && setModal(false)}>
          <div className="th-modal">
            <h2>Registrar Ausencia / Vacación</h2>
            <form onSubmit={guardar}>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.9rem' }}>
                <div className="th-form-group">
                  <label>Empleado *</label>
                  <select value={form.empleadoId} onChange={e => set('empleadoId', e.target.value)} required>
                    <option value="">— Seleccionar empleado —</option>
                    {empleados.map(e => <option key={e.id} value={e.id}>{e.apellidos}, {e.nombres}</option>)}
                  </select>
                </div>
                <div className="th-form-group">
                  <label>Tipo *</label>
                  <select value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                    {TIPOS_AUSENCIA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="th-form-grid">
                  <div className="th-form-group">
                    <label>Fecha inicio *</label>
                    <input type="date" value={form.fechaInicio} onChange={e => set('fechaInicio', e.target.value)} required />
                  </div>
                  <div className="th-form-group">
                    <label>Fecha fin *</label>
                    <input type="date" value={form.fechaFin} onChange={e => set('fechaFin', e.target.value)} required />
                  </div>
                </div>
                <div className="th-form-group">
                  <label>Observaciones</label>
                  <textarea value={form.observaciones} onChange={e => set('observaciones', e.target.value)} rows={3} />
                </div>
              </div>
              <div className="th-modal-actions">
                <button type="button" className="btn-th-secondary" onClick={() => setModal(false)}>Cancelar</button>
                <button type="submit" className="btn-th-primary" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Registrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Ausencias;
