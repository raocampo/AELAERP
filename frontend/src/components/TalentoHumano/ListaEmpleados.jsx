import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatFechaCorta } from '../../utils/fecha';
import './TalentoHumano.css';

const ListaEmpleados = () => {
  const navigate = useNavigate();
  const [lista, setLista] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [deptFiltro, setDeptFiltro] = useState('');
  const [activoFiltro, setActivoFiltro] = useState('true');
  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = { q, activo: activoFiltro, page, limit: PER_PAGE };
      if (deptFiltro) params.departamentoId = deptFiltro;
      const [r, deps] = await Promise.all([
        api.get('/talento-humano/empleados', { params }),
        departamentos.length === 0 ? api.get('/talento-humano/departamentos') : Promise.resolve(null),
      ]);
      setLista(r.data.data);
      setTotal(r.data.total);
      if (deps) setDepartamentos(deps.data.data.filter(d => d.activo));
    } catch {
      toast.error('Error al cargar empleados');
    } finally {
      setLoading(false);
    }
  }, [q, activoFiltro, deptFiltro, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>👤 Empleados</h1>
        <div className="th-toolbar">
          <input
            className="th-search"
            placeholder="Buscar por nombre, cédula…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />
          <select
            className="th-search"
            style={{ minWidth: 160 }}
            value={deptFiltro}
            onChange={e => { setDeptFiltro(e.target.value); setPage(1); }}
          >
            <option value="">Todos los departamentos</option>
            {departamentos.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
          <select
            className="th-search"
            style={{ minWidth: 120 }}
            value={activoFiltro}
            onChange={e => { setActivoFiltro(e.target.value); setPage(1); }}
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="">Todos</option>
          </select>
          <button className="btn-th-primary" onClick={() => navigate('/talento-humano/empleados/nuevo')}>
            + Nuevo empleado
          </button>
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
                  <th>Cédula</th>
                  <th>Nombre</th>
                  <th>Cargo</th>
                  <th>Departamento</th>
                  <th>Salario</th>
                  <th>Ingreso</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign:'center', padding:'2rem', color:'#a0aec0' }}>Sin resultados</td></tr>
                ) : lista.map(emp => (
                  <tr key={emp.id}>
                    <td>{emp.cedula}</td>
                    <td style={{ fontWeight: 500 }}>{emp.apellidos}, {emp.nombres}</td>
                    <td>{emp.cargo?.nombre || <span style={{ color:'#a0aec0' }}>—</span>}</td>
                    <td>{emp.departamento?.nombre || <span style={{ color:'#a0aec0' }}>—</span>}</td>
                    <td>${Number(emp.salarioBase).toLocaleString('es-EC', { minimumFractionDigits: 2 })}</td>
                    <td>{emp.fechaIngreso ? formatFechaCorta(emp.fechaIngreso) : '—'}</td>
                    <td>
                      <span className={emp.activo ? 'badge-activo' : 'badge-inactivo'}>
                        {emp.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-th-sm" onClick={() => navigate(`/talento-humano/empleados/${emp.id}`)}>
                        ✏️ Ver / Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="th-pagination">
              <span>{total} empleados — Página {page} de {totalPages}</span>
              <div className="th-pagination-btns">
                <button className="btn-th-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Anterior</button>
                <button className="btn-th-secondary" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Siguiente →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ListaEmpleados;
