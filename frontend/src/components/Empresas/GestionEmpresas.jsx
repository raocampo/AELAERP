// ====================================
// GESTIÓN DE EMPRESAS — Solo modo multiempresa / admin
// frontend/src/components/Empresas/GestionEmpresas.jsx
// ====================================

import { useState, useEffect } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/useAuth';
import { tienePermiso } from '../../utils/roles';

const FORM_VACIO = {
  ruc: '', razonSocial: '', nombreComercial: '', direccion: '',
  email: '', telefono: '', plan: 'full', crearConfiguracionSri: true,
};

export default function GestionEmpresas() {
  const { modoMulti, usuario } = useAuth();
  const [empresas,    setEmpresas]    = useState([]);
  const [cargando,    setCargando]    = useState(true);
  const [form,        setForm]        = useState(FORM_VACIO);
  const [editando,    setEditando]    = useState(null); // id empresa en edición
  const [mostrarForm, setMostrarForm] = useState(false);
  const [guardando,   setGuardando]   = useState(false);
  const [consultandoSri, setConsultandoSri] = useState(false);
  const [mensajeSri, setMensajeSri] = useState('');

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await api.get('/empresas');
      setEmpresas(res.data.data || []);
    } catch {
      toast.error('Error al cargar empresas');
    } finally {
      setCargando(false);
    }
  };

  const abrirNueva = () => {
    setForm(FORM_VACIO);
    setEditando(null);
    setMostrarForm(true);
  };

  const abrirEditar = (e) => {
    setForm({
      ruc: e.ruc, razonSocial: e.razonSocial,
      nombreComercial: e.nombreComercial || '',
      direccion: e.direccion || '', email: e.email || '',
      telefono: e.telefono || '', plan: e.plan, crearConfiguracionSri: true,
    });
    setEditando(e.id);
    setMostrarForm(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const consultarSri = async (rucIngresado = form.ruc) => {
    const rucLimpio = String(rucIngresado || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(rucLimpio) || editando) {
      setMensajeSri('');
      return;
    }

    setConsultandoSri(true);
    setMensajeSri('');
    try {
      const res = await api.get(`/empresas/consultar-sri/${rucLimpio}`);
      if (res.data?.encontrado && res.data?.data) {
        const empresaSri = res.data.data;
        setForm((prev) => ({
          ...prev,
          ruc: empresaSri.ruc || prev.ruc,
          razonSocial: empresaSri.razonSocial || prev.razonSocial,
          nombreComercial: empresaSri.nombreComercial || prev.nombreComercial,
          direccion: empresaSri.direccion || prev.direccion,
        }));
        setMensajeSri(`✓ Empresa encontrada en SRI: ${empresaSri.razonSocial}`);
        return;
      }

      setMensajeSri('No se encontró la empresa en SRI. Puedes crearla solo para control interno.');
    } catch (err) {
      setMensajeSri(err.response?.data?.mensaje || 'No se pudo consultar el SRI.');
    } finally {
      setConsultandoSri(false);
    }
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!form.ruc || !form.razonSocial) {
      return toast.error('RUC y razón social son requeridos');
    }
    setGuardando(true);
    try {
      if (editando) {
        await api.put(`/empresas/${editando}`, form);
        toast.success('Empresa actualizada');
      } else {
        await api.post('/empresas', form);
        toast.success('Empresa creada');
      }
      setMostrarForm(false);
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  };

  const toggleActivo = async (empresa) => {
    try {
      await api.put(`/empresas/${empresa.id}`, { activo: !empresa.activo });
      toast.success(empresa.activo ? 'Empresa desactivada' : 'Empresa activada');
      cargar();
    } catch {
      toast.error('Error al cambiar estado');
    }
  };

  if (!modoMulti && !tienePermiso(usuario?.rol, 'empresas.gestionar')) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
        <h2>Gestión de Empresas</h2>
        <p>Esta funcionalidad está disponible solo en modo multiempresa.</p>
        <p>Para activarlo, cambia el modo de operación a <code>Multiempresa</code> desde la pantalla de configuración del sistema.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0 }}>🏢 Gestión de Empresas</h1>
          <p style={{ color: '#666', margin: '4px 0 0' }}>Administra las empresas/tenants del sistema</p>
        </div>
        <button className="btn-primary" onClick={abrirNueva}>+ Nueva Empresa</button>
      </div>

      {/* Modal formulario */}
      {mostrarForm && (
        <div className="modal-overlay" onClick={() => setMostrarForm(false)}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>{editando ? 'Editar Empresa' : 'Nueva Empresa'}</h3>
              <button className="btn-close" onClick={() => setMostrarForm(false)}>✕</button>
            </div>
            <form onSubmit={handleGuardar}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="fact-field" style={{ gridColumn: '1/-1' }}>
                  <label>RUC *</label>
                  <input name="ruc" value={form.ruc} onChange={handleChange}
                    placeholder="0000000000001" maxLength={13} required
                    readOnly={!!editando} onBlur={(e) => consultarSri(e.target.value)} />
                  {consultandoSri && (
                    <small style={{ color: '#64748b' }}>Consultando datos en el SRI...</small>
                  )}
                  {mensajeSri && !consultandoSri && (
                    <small style={{ color: mensajeSri.startsWith('✓') ? '#2E7D32' : '#B45309' }}>{mensajeSri}</small>
                  )}
                </div>
                <div className="fact-field" style={{ gridColumn: '1/-1' }}>
                  <label>Razón Social *</label>
                  <input name="razonSocial" value={form.razonSocial} onChange={handleChange}
                    placeholder="Nombre o razón social" required />
                </div>
                <div className="fact-field">
                  <label>Nombre Comercial</label>
                  <input name="nombreComercial" value={form.nombreComercial} onChange={handleChange}
                    placeholder="Nombre comercial" />
                </div>
                <div className="fact-field">
                  <label>Teléfono</label>
                  <input name="telefono" value={form.telefono} onChange={handleChange}
                    placeholder="02-000-0000" />
                </div>
                <div className="fact-field" style={{ gridColumn: '1/-1' }}>
                  <label>Dirección</label>
                  <input name="direccion" value={form.direccion} onChange={handleChange}
                    placeholder="Dirección" />
                </div>
                <div className="fact-field">
                  <label>Email</label>
                  <input type="email" name="email" value={form.email} onChange={handleChange}
                    placeholder="empresa@ejemplo.com" />
                </div>
                <div className="fact-field">
                  <label>Plan</label>
                  <select name="plan" value={form.plan} onChange={handleChange}>
                    <option value="full">Full (ilimitado)</option>
                    <option value="lite">Lite (máx 100 comprobantes/año)</option>
                  </select>
                </div>
                {!editando && (
                  <div className="fact-field" style={{ gridColumn: '1/-1' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        name="crearConfiguracionSri"
                        checked={form.crearConfiguracionSri}
                        onChange={handleChange}
                      />
                      Preparar también la configuración SRI con los datos de esta empresa
                    </label>
                    <small style={{ color: '#64748b' }}>
                      Si la desmarcas, la empresa se creará solo para control interno y podrás configurar el SRI después.
                    </small>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button type="button" className="btn-secondary" onClick={() => setMostrarForm(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tabla */}
      {cargando ? (
        <div style={{ textAlign: 'center', padding: 40 }}>Cargando...</div>
      ) : (
        <div style={{ background: 'white', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left' }}>RUC</th>
                <th style={{ padding: '12px 16px', textAlign: 'left' }}>Razón Social</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Plan</th>
                <th style={{ padding: '12px 8px', textAlign: 'center' }}>Estado</th>
                <th style={{ padding: '12px 16px', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {empresas.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#999' }}>
                  No hay empresas registradas
                </td></tr>
              ) : empresas.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'monospace' }}>{e.ruc}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontWeight: 600 }}>{e.razonSocial}</div>
                    {e.nombreComercial && (
                      <div style={{ fontSize: 12, color: '#888' }}>{e.nombreComercial}</div>
                    )}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                      background: e.plan === 'lite' ? '#FFF8E1' : '#E3F2FD',
                      color: e.plan === 'lite' ? '#F57F17' : '#1565C0',
                    }}>
                      {e.plan === 'lite' ? 'LITE' : 'FULL'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                      background: e.activo ? '#E8F5E9' : '#FFEBEE',
                      color: e.activo ? '#2E7D32' : '#C62828',
                    }}>
                      {e.activo ? 'ACTIVA' : 'INACTIVA'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', marginRight: 6 }}
                      onClick={() => abrirEditar(e)}>
                      Editar
                    </button>
                    <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => toggleActivo(e)}>
                      {e.activo ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
