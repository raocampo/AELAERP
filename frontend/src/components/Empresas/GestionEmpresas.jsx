// ====================================
// GESTIÓN DE EMPRESAS — Solo modo multiempresa / admin
// frontend/src/components/Empresas/GestionEmpresas.jsx
// ====================================

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/useAuth';
import { tienePermiso } from '../../utils/roles';
import './GestionEmpresas.css';

const FORM_VACIO = {
  ruc: '', razonSocial: '', nombreComercial: '', direccion: '',
  email: '', telefono: '', plan: 'full', crearConfiguracionSri: true,
  esMatriz: false, parentEmpresaId: '',
  tipoContribuyente: 'JURIDICA',
  repLegalNombre: '', repLegalCedula: '', repLegalCargo: '', repLegalEmail: '',
  contadoraNombre: '', contadoraCedula: '', contadoraEmail: '', contadoraTelefono: '',
};

export default function GestionEmpresas() {
  const { usuario } = useAuth();
  const [empresas,        setEmpresas]        = useState([]);
  const [cargando,        setCargando]        = useState(true);
  const [form,            setForm]            = useState(FORM_VACIO);
  const [editando,        setEditando]        = useState(null);
  const [mostrarForm,     setMostrarForm]     = useState(false);
  const [guardando,       setGuardando]       = useState(false);
  const [consultandoSri,  setConsultandoSri]  = useState(false);
  const [mensajeSri,      setMensajeSri]      = useState('');
  // Panel de usuarios por empresa
  const [empresaUsuarios, setEmpresaUsuarios] = useState(null);  // id empresa expandida
  const [usuariosEmpresa, setUsuariosEmpresa] = useState([]);
  const [cargandoUsuarios,setCargandoUsuarios]= useState(false);
  const [todosUsuarios,   setTodosUsuarios]   = useState([]);    // para selector
  const [asignarId,       setAsignarId]       = useState('');
  const [asignarRol,      setAsignarRol]      = useState('operador');
  const [asignando,       setAsignando]       = useState(false);

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    setCargando(true);
    try {
      const [resEmp, resUsr] = await Promise.all([
        api.get('/empresas'),
        api.get('/usuarios').catch(() => ({ data: { data: [] } })),
      ]);
      setEmpresas(resEmp.data.data || []);
      setTodosUsuarios(resUsr.data.data || []);
    } catch {
      toast.error('Error al cargar empresas');
    } finally {
      setCargando(false);
    }
  };

  const cargarUsuariosEmpresa = useCallback(async (empresaId) => {
    setCargandoUsuarios(true);
    try {
      const res = await api.get(`/empresas/${empresaId}/usuarios`);
      setUsuariosEmpresa(res.data.data || []);
    } catch {
      toast.error('Error al cargar usuarios de la empresa');
    } finally {
      setCargandoUsuarios(false);
    }
  }, []);

  const togglePanelUsuarios = (empresaId) => {
    if (empresaUsuarios === empresaId) {
      setEmpresaUsuarios(null);
    } else {
      setEmpresaUsuarios(empresaId);
      setAsignarId('');
      setAsignarRol('operador');
      cargarUsuariosEmpresa(empresaId);
    }
  };

  const handleAsignarUsuario = async (e) => {
    e.preventDefault();
    if (!asignarId) return toast.error('Selecciona un usuario');
    setAsignando(true);
    try {
      await api.post(`/empresas/${empresaUsuarios}/usuarios`, { usuarioId: asignarId, rol: asignarRol });
      toast.success('Usuario asignado');
      setAsignarId('');
      cargarUsuariosEmpresa(empresaUsuarios);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al asignar usuario');
    } finally {
      setAsignando(false);
    }
  };

  const handleQuitarUsuario = async (usuarioId) => {
    if (!confirm('¿Quitar acceso de este usuario a la empresa?')) return;
    try {
      await api.delete(`/empresas/${empresaUsuarios}/usuarios/${usuarioId}`);
      toast.success('Acceso removido');
      cargarUsuariosEmpresa(empresaUsuarios);
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al remover acceso');
    }
  };

  const abrirNueva = () => {
    setForm(FORM_VACIO);
    setEditando(null);
    setMensajeSri('');
    setMostrarForm(true);
  };

  const abrirEditar = (e) => {
    setForm({
      ruc: e.ruc,
      razonSocial: e.razonSocial,
      nombreComercial: e.nombreComercial || '',
      direccion: e.direccion || '',
      email: e.email || '',
      telefono: e.telefono || '',
      plan: e.plan,
      crearConfiguracionSri: true,
      esMatriz: e.esMatriz || false,
      parentEmpresaId: e.parentEmpresaId || '',
      tipoContribuyente: e.tipoContribuyente || 'JURIDICA',
      repLegalNombre:    e.repLegalNombre  || '',
      repLegalCedula:    e.repLegalCedula  || '',
      repLegalCargo:     e.repLegalCargo   || '',
      repLegalEmail:     e.repLegalEmail   || '',
      contadoraNombre:   e.contadoraNombre || '',
      contadoraCedula:   e.contadoraCedula || '',
      contadoraEmail:    e.contadoraEmail  || '',
      contadoraTelefono: e.contadoraTelefono || '',
    });
    setEditando(e.id);
    setMensajeSri('');
    setMostrarForm(true);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const consultarSri = async (rucIngresado = form.ruc) => {
    const rucLimpio = String(rucIngresado || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(rucLimpio) || editando) { setMensajeSri(''); return; }

    setConsultandoSri(true);
    setMensajeSri('');
    try {
      const res = await api.get(`/empresas/consultar-sri/${rucLimpio}`);
      if (res.data?.encontrado && res.data?.data) {
        const s = res.data.data;
        // Determinar tipo: si tipoContribuyente dice "PERSONAS NATURALES" → NATURAL
        const tipo = s.tipoContribuyente
          ? (String(s.tipoContribuyente).toUpperCase().includes('NATURAL') ? 'NATURAL' : 'JURIDICA')
          : 'JURIDICA';
        setForm(prev => ({
          ...prev,
          ruc: s.ruc || prev.ruc,
          razonSocial: s.razonSocial || prev.razonSocial,
          nombreComercial: s.nombreComercial || prev.nombreComercial,
          direccion: s.direccion || prev.direccion,
          tipoContribuyente: tipo,
        }));
        const fuente = res.data.fuente === 'local' ? '(catastro local)' : '(SRI en línea)';
        setMensajeSri(`✓ Empresa encontrada ${fuente}: ${s.razonSocial} — ${tipo === 'NATURAL' ? 'Persona Natural' : 'Persona Jurídica'}`);
        return;
      }
      setMensajeSri('No se encontró la empresa en el catastro ni en el SRI. Puedes crearla solo para control interno.');
    } catch (err) {
      setMensajeSri(err.response?.data?.mensaje || 'No se pudo consultar el SRI.');
    } finally {
      setConsultandoSri(false);
    }
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!form.ruc || !form.razonSocial) return toast.error('RUC y razón social son requeridos');
    setGuardando(true);
    try {
      const payload = {
        ...form,
        parentEmpresaId: form.parentEmpresaId ? parseInt(form.parentEmpresaId, 10) : null,
      };
      if (editando) {
        await api.put(`/empresas/${editando}`, payload);
        toast.success('Empresa actualizada correctamente');
      } else {
        await api.post('/empresas', payload);
        toast.success('Empresa creada correctamente');
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

  if (!tienePermiso(usuario?.rol, 'empresas.gestionar')) {
    return (
      <div className="ge-page">
        <div className="ge-card ge-empty">
          <p style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>🔒</p>
          <strong>Acceso denegado</strong>
          <p style={{ marginTop: '.5rem' }}>
            Solo los administradores pueden gestionar empresas.
          </p>
        </div>
      </div>
    );
  }

  // Empresas disponibles para selector de empresa matriz
  const empresasParent = empresas.filter(e => e.id !== editando);

  return (
    <div className="ge-page">

      {/* Cabecera */}
      <div className="ge-header">
        <div className="ge-header-info">
          <h1>🏢 Gestión de Empresas</h1>
          <p>Administra las empresas y subsidiarias del sistema</p>
        </div>
        <button className="ge-btn-primary" onClick={abrirNueva}>+ Nueva Empresa</button>
      </div>

      {/* Tabla */}
      <div className="ge-card">
        {cargando ? (
          <div className="ge-loading">Cargando empresas...</div>
        ) : empresas.length === 0 ? (
          <div className="ge-empty">No hay empresas registradas. Crea la primera con el botón de arriba.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ge-table">
              <thead>
                <tr>
                  <th>RUC</th>
                  <th>Razón Social</th>
                  <th style={{ textAlign: 'center' }}>Plan</th>
                  <th style={{ textAlign: 'center' }}>Tipo</th>
                  <th style={{ textAlign: 'center' }}>Estado</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map(e => (
                  <React.Fragment key={e.id}>
                  <tr>
                    <td><span className="ge-ruc">{e.ruc}</span></td>
                    <td>
                      <div className="ge-razon">{e.razonSocial}</div>
                      {e.nombreComercial && <div className="ge-nombre-com">{e.nombreComercial}</div>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`ge-chip ${e.plan === 'lite' ? 'ge-chip-lite' : 'ge-chip-full'}`}>
                        {e.plan === 'lite' ? 'LITE' : 'FULL'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {e.esMatriz
                        ? <span className="ge-chip ge-chip-matriz">MATRIZ</span>
                        : e.parentEmpresaId
                          ? <span className="ge-chip" style={{ background: '#f0fdf4', color: '#16a34a' }}>FILIAL</span>
                          : <span style={{ color: '#94a3b8', fontSize: '.8rem' }}>—</span>
                      }
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`ge-chip ${e.activo ? 'ge-chip-activa' : 'ge-chip-inactiva'}`}>
                        {e.activo ? 'ACTIVA' : 'INACTIVA'}
                      </span>
                    </td>
                    <td>
                      <div className="ge-acciones">
                        {tienePermiso(e.rolUsuario, 'usuarios.gestionar') && (
                          <>
                            <button className="ge-btn-sm" onClick={() => abrirEditar(e)}>✏️ Editar</button>
                            <button
                              className={`ge-btn-sm ${empresaUsuarios === e.id ? 'active' : ''}`}
                              onClick={() => togglePanelUsuarios(e.id)}
                              title="Gestionar usuarios con acceso a esta empresa"
                            >
                              👥 Usuarios
                            </button>
                            <button
                              className={`ge-btn-sm ${e.activo ? 'danger' : ''}`}
                              onClick={() => toggleActivo(e)}
                            >
                              {e.activo ? '🔴 Desactivar' : '🟢 Activar'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Panel de usuarios por empresa */}
                  {empresaUsuarios === e.id && (
                    <tr key={`${e.id}-usuarios`}>
                      <td colSpan={6} style={{ padding: '0 1rem 1rem', background: '#f8fafc' }}>
                        <div className="ge-usuarios-panel">
                          <h4>👥 Usuarios con acceso a: {e.nombreComercial || e.razonSocial}</h4>

                          {/* Asignar nuevo usuario */}
                          <form className="ge-asignar-form" onSubmit={handleAsignarUsuario}>
                            <select
                              className="ge-input"
                              value={asignarId}
                              onChange={ev => setAsignarId(ev.target.value)}
                              style={{ flex: 2 }}
                            >
                              <option value="">— Seleccionar usuario —</option>
                              {todosUsuarios
                                .filter(u => !usuariosEmpresa.find(eu => eu.id === u.id))
                                .map(u => (
                                  <option key={u.id} value={u.id}>
                                    {u.nombre} ({u.username})
                                  </option>
                                ))}
                            </select>
                            <select
                              className="ge-input"
                              value={asignarRol}
                              onChange={ev => setAsignarRol(ev.target.value)}
                              style={{ flex: 1 }}
                            >
                              <option value="operador">Operador</option>
                              <option value="admin">Admin</option>
                              <option value="contador">Contador</option>
                              <option value="vendedor">Vendedor</option>
                            </select>
                            <button
                              type="submit"
                              className="ge-btn-primary"
                              disabled={asignando || !asignarId}
                              style={{ whiteSpace: 'nowrap' }}
                            >
                              {asignando ? 'Asignando...' : '+ Asignar'}
                            </button>
                          </form>

                          {/* Lista de usuarios actuales */}
                          {cargandoUsuarios ? (
                            <p style={{ color: '#64748b', padding: '.5rem 0' }}>Cargando usuarios...</p>
                          ) : usuariosEmpresa.length === 0 ? (
                            <p style={{ color: '#94a3b8', padding: '.5rem 0' }}>No hay usuarios asignados aún.</p>
                          ) : (
                            <table className="ge-table" style={{ marginTop: '.5rem' }}>
                              <thead>
                                <tr>
                                  <th>Usuario</th>
                                  <th>Email</th>
                                  <th style={{ textAlign: 'center' }}>Rol</th>
                                  <th style={{ textAlign: 'center' }}>Tipo acceso</th>
                                  <th style={{ textAlign: 'center' }}>Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {usuariosEmpresa.map(u => (
                                  <tr key={u.id}>
                                    <td><strong>{u.nombre}</strong><br /><small>{u.username}</small></td>
                                    <td>{u.email || '—'}</td>
                                    <td style={{ textAlign: 'center' }}>
                                      <span className="ge-chip">{u.rolAsignado || u.rol}</span>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      {u.tipoAcceso === 'default'
                                        ? <span className="ge-chip ge-chip-matriz" title="Esta es su empresa principal">Empresa base</span>
                                        : <span className="ge-chip" style={{ background: '#f0fdf4', color: '#16a34a' }}>Asignado</span>
                                      }
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                      {u.tipoAcceso === 'asignado' ? (
                                        <button
                                          className="ge-btn-sm danger"
                                          onClick={() => handleQuitarUsuario(u.id)}
                                        >
                                          🗑️ Quitar
                                        </button>
                                      ) : (
                                        <span style={{ color: '#94a3b8', fontSize: '.8rem' }}>—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal formulario */}
      {mostrarForm && (
        <div className="ge-modal-overlay">
          <div className="ge-modal" onClick={e => e.stopPropagation()}>

            <div className="ge-modal-header">
              <h2>{editando ? '✏️ Editar Empresa' : '🏢 Nueva Empresa'}</h2>
              <button className="ge-modal-close" onClick={() => setMostrarForm(false)}>✕</button>
            </div>

            <form onSubmit={handleGuardar}>
              <div className="ge-modal-body">
                <div className="ge-grid">

                  {/* RUC */}
                  <div className="ge-field ge-col-full">
                    <label>RUC <span className="ge-required">*</span></label>
                    <input
                      className="ge-input"
                      name="ruc"
                      value={form.ruc}
                      onChange={handleChange}
                      placeholder="0000000000001"
                      maxLength={13}
                      required
                      readOnly={!!editando}
                      onBlur={(e) => consultarSri(e.target.value)}
                    />
                    {consultandoSri && (
                      <span className="ge-sri-msg ge-sri-loading">⏳ Consultando datos en el SRI...</span>
                    )}
                    {mensajeSri && !consultandoSri && (
                      <span className={`ge-sri-msg ${mensajeSri.startsWith('✓') ? 'ge-sri-ok' : 'ge-sri-warn'}`}>
                        {mensajeSri}
                      </span>
                    )}
                  </div>

                  {/* Razón Social */}
                  <div className="ge-field ge-col-full">
                    <label>Razón Social <span className="ge-required">*</span></label>
                    <input className="ge-input" name="razonSocial" value={form.razonSocial}
                      onChange={handleChange} placeholder="Nombre legal de la empresa" required />
                  </div>

                  {/* Nombre Comercial */}
                  <div className="ge-field">
                    <label>Nombre Comercial</label>
                    <input className="ge-input" name="nombreComercial" value={form.nombreComercial}
                      onChange={handleChange} placeholder="Nombre comercial" />
                  </div>

                  {/* Teléfono */}
                  <div className="ge-field">
                    <label>Teléfono</label>
                    <input className="ge-input" name="telefono" value={form.telefono}
                      onChange={handleChange} placeholder="02-000-0000" />
                  </div>

                  {/* Dirección */}
                  <div className="ge-field ge-col-full">
                    <label>Dirección</label>
                    <input className="ge-input" name="direccion" value={form.direccion}
                      onChange={handleChange} placeholder="Calle, número, ciudad" />
                  </div>

                  {/* Email */}
                  <div className="ge-field">
                    <label>Email</label>
                    <input className="ge-input" type="email" name="email" value={form.email}
                      onChange={handleChange} placeholder="empresa@ejemplo.com" />
                  </div>

                  {/* Plan */}
                  <div className="ge-field">
                    <label>Plan</label>
                    <select className="ge-input" name="plan" value={form.plan} onChange={handleChange}>
                      <option value="full">Full (ilimitado)</option>
                      <option value="lite">Lite (máx 100 comprobantes/año)</option>
                    </select>
                  </div>

                  {/* Tipo de empresa */}
                  <div className="ge-field">
                    <label>Tipo de empresa</label>
                    <select className="ge-input" name="esMatriz"
                      value={form.esMatriz ? 'true' : 'false'}
                      onChange={e => setForm(prev => ({ ...prev, esMatriz: e.target.value === 'true' }))}>
                      <option value="false">Empresa independiente</option>
                      <option value="true">Empresa matriz</option>
                    </select>
                  </div>

                  {/* Tipo de contribuyente */}
                  <div className="ge-field">
                    <label>Tipo de contribuyente</label>
                    <select className="ge-input" name="tipoContribuyente"
                      value={form.tipoContribuyente}
                      onChange={handleChange}>
                      <option value="JURIDICA">Persona Jurídica (Sociedad)</option>
                      <option value="NATURAL">Persona Natural</option>
                    </select>
                  </div>

                  {/* Empresa matriz (si es filial) */}
                  {!form.esMatriz && empresasParent.length > 0 && (
                    <div className="ge-field">
                      <label>Empresa matriz (opcional)</label>
                      <select className="ge-input" name="parentEmpresaId"
                        value={form.parentEmpresaId} onChange={handleChange}>
                        <option value="">— Sin empresa matriz —</option>
                        {empresasParent.map(ep => (
                          <option key={ep.id} value={ep.id}>
                            {ep.nombreComercial || ep.razonSocial}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Representante Legal — solo Persona Jurídica */}
                  {form.tipoContribuyente === 'JURIDICA' && (
                    <>
                      <div className="ge-field ge-col-full">
                        <div className="ge-section-title">👤 Representante Legal</div>
                      </div>
                      <div className="ge-field">
                        <label>Nombre del representante legal</label>
                        <input className="ge-input" name="repLegalNombre" value={form.repLegalNombre}
                          onChange={handleChange} placeholder="Nombre completo" />
                      </div>
                      <div className="ge-field">
                        <label>Cédula del representante legal</label>
                        <input className="ge-input" name="repLegalCedula" value={form.repLegalCedula}
                          onChange={handleChange} placeholder="0000000000" maxLength={10} />
                      </div>
                      <div className="ge-field">
                        <label>Cargo</label>
                        <input className="ge-input" name="repLegalCargo" value={form.repLegalCargo}
                          onChange={handleChange} placeholder="Ej: Gerente General" />
                      </div>
                      <div className="ge-field">
                        <label>Email del representante</label>
                        <input className="ge-input" type="email" name="repLegalEmail" value={form.repLegalEmail}
                          onChange={handleChange} placeholder="representante@empresa.com" />
                      </div>
                      <div className="ge-field ge-col-full">
                        <div className="ge-section-title">📊 Contadora / Contador</div>
                      </div>
                      <div className="ge-field">
                        <label>Nombre de la contadora</label>
                        <input className="ge-input" name="contadoraNombre" value={form.contadoraNombre}
                          onChange={handleChange} placeholder="Nombre completo" />
                      </div>
                      <div className="ge-field">
                        <label>Cédula de la contadora</label>
                        <input className="ge-input" name="contadoraCedula" value={form.contadoraCedula}
                          onChange={handleChange} placeholder="0000000000" maxLength={10} />
                      </div>
                      <div className="ge-field">
                        <label>Email de la contadora</label>
                        <input className="ge-input" type="email" name="contadoraEmail" value={form.contadoraEmail}
                          onChange={handleChange} placeholder="contadora@empresa.com" />
                      </div>
                      <div className="ge-field">
                        <label>Teléfono de la contadora</label>
                        <input className="ge-input" name="contadoraTelefono" value={form.contadoraTelefono}
                          onChange={handleChange} placeholder="09xxxxxxxx" />
                      </div>
                    </>
                  )}

                  {/* Checkbox configurar SRI */}
                  {!editando && (
                    <div className="ge-field ge-col-full">
                      <div className="ge-checkbox-field">
                        <input
                          type="checkbox"
                          name="crearConfiguracionSri"
                          id="chk-sri"
                          checked={form.crearConfiguracionSri}
                          onChange={handleChange}
                        />
                        <div>
                          <label className="ge-checkbox-label" htmlFor="chk-sri">
                            Preparar configuración SRI con los datos de esta empresa
                          </label>
                          <small>
                            Si lo desmarcas, la empresa se creará solo para control interno y podrás configurar el SRI después.
                          </small>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </div>

              <div className="ge-modal-footer">
                <button type="button" className="ge-btn-secondary" onClick={() => setMostrarForm(false)}>
                  Cancelar
                </button>
                <button type="submit" className="ge-btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear empresa'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
}
