import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './TalentoHumano.css';

const EMPTY_EMP = {
  cedula: '', nombres: '', apellidos: '', email: '', telefono: '', direccion: '',
  fechaNacimiento: '', sexo: '', estadoCivil: '',
  tipoContrato: 'indefinido', fechaIngreso: '', salarioBase: '',
  departamentoId: '', cargoId: '',
  afiliadoIESS: true, codigoIESS: '', tieneRenta: false, fondosReserva: false,
  observaciones: '',
};

const TIPOS_CONTRATO = ['indefinido','plazo_fijo','por_obra','eventual','aprendizaje'];
const SEXOS = ['masculino','femenino','otro'];
const ESTADOS_CIVILES = ['soltero','casado','divorciado','viudo','union_libre'];

const FormEmpleado = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const esNuevo = !id || id === 'nuevo';

  const [form, setForm] = useState(EMPTY_EMP);
  const [departamentos, setDepartamentos] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [loading, setLoading] = useState(!esNuevo);
  const [guardando, setGuardando] = useState(false);

  const cargarDatos = useCallback(async () => {
    try {
      const [deps, crgs] = await Promise.all([
        api.get('/talento-humano/departamentos'),
        api.get('/talento-humano/cargos'),
      ]);
      setDepartamentos(deps.data.data.filter(d => d.activo));
      setCargos(crgs.data.data.filter(c => c.activo));
      if (!esNuevo) {
        const r = await api.get(`/talento-humano/empleados/${id}`);
        const emp = r.data.data;
        setForm({
          ...EMPTY_EMP,
          ...emp,
          fechaNacimiento: emp.fechaNacimiento ? emp.fechaNacimiento.slice(0,10) : '',
          fechaIngreso: emp.fechaIngreso ? emp.fechaIngreso.slice(0,10) : '',
          departamentoId: emp.departamentoId || '',
          cargoId: emp.cargoId || '',
          salarioBase: emp.salarioBase?.toString() || '',
        });
      }
    } catch {
      toast.error('Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [id, esNuevo]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      if (esNuevo) {
        await api.post('/talento-humano/empleados', form);
        toast.success('Empleado creado exitosamente');
      } else {
        await api.put(`/talento-humano/empleados/${id}`, form);
        toast.success('Empleado actualizado');
      }
      navigate('/talento-humano/empleados');
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const cargosFiltrados = form.departamentoId
    ? cargos.filter(c => !c.departamento || c.departamento.id === parseInt(form.departamentoId))
    : cargos;

  if (loading) return <div className="th-loading">Cargando…</div>;

  return (
    <div className="th-page">
      <div className="th-page-header">
        <h1>{esNuevo ? '👤 Nuevo Empleado' : `✏️ Editar: ${form.nombres} ${form.apellidos}`}</h1>
        <button className="btn-th-secondary" onClick={() => navigate('/talento-humano/empleados')}>
          ← Volver a la lista
        </button>
      </div>

      <form onSubmit={guardar}>
        {/* DATOS PERSONALES */}
        <fieldset style={{ border:'1px solid var(--color-border,#e2e8f0)', borderRadius:10, padding:'1.25rem', marginBottom:'1.25rem' }}>
          <legend style={{ fontWeight:700, fontSize:'0.9rem', padding:'0 0.5rem', color:'var(--color-text-muted,#718096)' }}>
            DATOS PERSONALES
          </legend>
          <div className="th-form-grid">
            <div className="th-form-group">
              <label>Cédula / Pasaporte *</label>
              <input value={form.cedula} onChange={e => set('cedula', e.target.value)} required placeholder="0912345678" />
            </div>
            <div className="th-form-group">
              <label>Nombres *</label>
              <input value={form.nombres} onChange={e => set('nombres', e.target.value)} required placeholder="Juan Carlos" />
            </div>
            <div className="th-form-group">
              <label>Apellidos *</label>
              <input value={form.apellidos} onChange={e => set('apellidos', e.target.value)} required placeholder="Pérez Rodríguez" />
            </div>
            <div className="th-form-group">
              <label>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="empleado@empresa.com" />
            </div>
            <div className="th-form-group">
              <label>Teléfono</label>
              <input value={form.telefono} onChange={e => set('telefono', e.target.value)} placeholder="0991234567" />
            </div>
            <div className="th-form-group">
              <label>Fecha de nacimiento</label>
              <input type="date" value={form.fechaNacimiento} onChange={e => set('fechaNacimiento', e.target.value)} />
            </div>
            <div className="th-form-group">
              <label>Sexo</label>
              <select value={form.sexo} onChange={e => set('sexo', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {SEXOS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="th-form-group">
              <label>Estado civil</label>
              <select value={form.estadoCivil} onChange={e => set('estadoCivil', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {ESTADOS_CIVILES.map(s => <option key={s} value={s}>{s.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
              </select>
            </div>
            <div className="th-form-group full">
              <label>Dirección</label>
              <input value={form.direccion} onChange={e => set('direccion', e.target.value)} placeholder="Dirección domiciliaria" />
            </div>
          </div>
        </fieldset>

        {/* DATOS LABORALES */}
        <fieldset style={{ border:'1px solid var(--color-border,#e2e8f0)', borderRadius:10, padding:'1.25rem', marginBottom:'1.25rem' }}>
          <legend style={{ fontWeight:700, fontSize:'0.9rem', padding:'0 0.5rem', color:'var(--color-text-muted,#718096)' }}>
            DATOS LABORALES
          </legend>
          <div className="th-form-grid">
            <div className="th-form-group">
              <label>Tipo de contrato</label>
              <select value={form.tipoContrato} onChange={e => set('tipoContrato', e.target.value)}>
                {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t.replace('_',' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
              </select>
            </div>
            <div className="th-form-group">
              <label>Fecha de ingreso *</label>
              <input type="date" value={form.fechaIngreso} onChange={e => set('fechaIngreso', e.target.value)} required />
            </div>
            <div className="th-form-group">
              <label>Salario base *</label>
              <input
                type="number" min="0" step="0.01"
                value={form.salarioBase}
                onChange={e => set('salarioBase', e.target.value)}
                required placeholder="460.00"
              />
            </div>
            <div className="th-form-group">
              <label>Departamento</label>
              <select value={form.departamentoId} onChange={e => { set('departamentoId', e.target.value); set('cargoId',''); }}>
                <option value="">— Sin departamento —</option>
                {departamentos.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            <div className="th-form-group">
              <label>Cargo</label>
              <select value={form.cargoId} onChange={e => set('cargoId', e.target.value)}>
                <option value="">— Sin cargo —</option>
                {cargosFiltrados.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          </div>
        </fieldset>

        {/* IESS Y BENEFICIOS */}
        <fieldset style={{ border:'1px solid var(--color-border,#e2e8f0)', borderRadius:10, padding:'1.25rem', marginBottom:'1.25rem' }}>
          <legend style={{ fontWeight:700, fontSize:'0.9rem', padding:'0 0.5rem', color:'var(--color-text-muted,#718096)' }}>
            IESS Y BENEFICIOS
          </legend>
          <div className="th-form-grid">
            <div className="th-form-group">
              <label>Código IESS</label>
              <input value={form.codigoIESS} onChange={e => set('codigoIESS', e.target.value)} placeholder="Número afiliado IESS" />
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.75rem', paddingTop:'1.4rem' }}>
              <label style={{ display:'flex', gap:'0.5rem', alignItems:'center', cursor:'pointer', fontSize:'0.875rem' }}>
                <input type="checkbox" checked={form.afiliadoIESS} onChange={e => set('afiliadoIESS', e.target.checked)} />
                Afiliado al IESS (descuento 9.45%)
              </label>
              <label style={{ display:'flex', gap:'0.5rem', alignItems:'center', cursor:'pointer', fontSize:'0.875rem' }}>
                <input type="checkbox" checked={form.tieneRenta} onChange={e => set('tieneRenta', e.target.checked)} />
                Aplica retención en la fuente (Impuesto Renta)
              </label>
              <label style={{ display:'flex', gap:'0.5rem', alignItems:'center', cursor:'pointer', fontSize:'0.875rem' }}>
                <input type="checkbox" checked={form.fondosReserva} onChange={e => set('fondosReserva', e.target.checked)} />
                Acumula fondos de reserva (&gt;1 año)
              </label>
            </div>
          </div>
        </fieldset>

        {/* OBSERVACIONES */}
        <div className="th-form-group" style={{ marginBottom:'1.5rem' }}>
          <label>Observaciones</label>
          <textarea
            value={form.observaciones}
            onChange={e => set('observaciones', e.target.value)}
            rows={3}
            placeholder="Notas adicionales sobre el empleado…"
          />
        </div>

        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
          <button type="button" className="btn-th-secondary" onClick={() => navigate('/talento-humano/empleados')}>
            Cancelar
          </button>
          <button type="submit" className="btn-th-primary" disabled={guardando}>
            {guardando ? 'Guardando…' : esNuevo ? 'Crear empleado' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default FormEmpleado;
