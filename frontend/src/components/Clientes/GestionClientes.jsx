// ====================================
// GESTIÓN DE CLIENTES — AELA
// ====================================

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { IcEditar, IcActivar, IcDesactivar } from '../../utils/icons';
import DropZone from '../shared/DropZone';
import './GestionClientes.css';

const TIPOS_IDENTIFICACION = [
  { valor: '04', label: 'RUC' },
  { valor: '05', label: 'Cédula' },
  { valor: '06', label: 'Pasaporte' },
  { valor: '07', label: 'Consumidor Final' },
];

const FORM_INICIAL = {
  id: null,
  tipoIdentificacion: '05',
  identificacion: '',
  razonSocial: '',
  nombreComercial: '',
  direccion: '',
  email: '',
  telefono: '',
  activo: true,
};

export default function GestionClientes() {
  const [clientes, setClientes] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [form, setForm] = useState(FORM_INICIAL);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [buscandoSri, setBuscandoSri] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  // ─── Catastro SRI — búsqueda por nombre ──────────────────────────────────────
  const [catastroResultados, setCatastroResultados] = useState([]);
  const [buscandoCatastro, setBuscandoCatastro] = useState(false);
  const [mostrarCatastro, setMostrarCatastro] = useState(false);

  // ─── Importar Excel ──────────────────────────────────────────────────────────
  const [modalImport, setModalImport] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const cargar = async () => {
    setCargando(true);
    try {
      const res = await api.get('/clientes', { params: { q: busqueda, page, limit: LIMIT } });
      setClientes(res.data?.data || []);
      setTotal(res.data?.total || 0);
    } catch {
      toast.error('No se pudo cargar la lista de clientes');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(cargar, busqueda ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda, page]);

  // Búsqueda en catastro SRI cuando la query es alfabética y >= 3 chars
  useEffect(() => {
    const q = busqueda.trim();
    // Solo búsqueda alfabética (no RUC/cédula)
    if (q.length < 3 || /^\d+$/.test(q)) {
      setCatastroResultados([]);
      setMostrarCatastro(false);
      return;
    }
    setBuscandoCatastro(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get('/clientes/buscar-catastro', { params: { q, limit: 20 } });
        const data = res.data?.data || [];
        setCatastroResultados(data);
        // Auto-expandir si hay resultados
        if (data.length > 0) setMostrarCatastro(true);
      } catch {
        setCatastroResultados([]);
      } finally {
        setBuscandoCatastro(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Pre-llenar formulario desde un resultado del catastro
  const agregarDesdeCatastro = (c) => {
    const tipoId = c.tipoContribuyente === 'PERSONAS NATURALES' ? '05' : '04';
    setForm({
      ...FORM_INICIAL,
      tipoIdentificacion: tipoId,
      identificacion:     c.ruc,
      razonSocial:        c.razonSocial,
      nombreComercial:    c.nombreComercial || '',
    });
    setMostrarCatastro(false);
    setModalAbierto(true);
  };


  const handleIdentificacionBlur = async () => {
    const id = form.identificacion.trim();
    if (!id || form.id) return; // No buscar al editar
    if (!/^\d{10}$/.test(id) && !/^\d{13}$/.test(id)) return;

    setBuscandoSri(true);
    try {
      const res = await api.get(`/clientes/sri/${id}`);
      const d = res.data;

      if (d.success && d.data) {
        if (d.requiereDatosManuales) {
          toast('Identificación válida en SRI. Completa los datos manualmente.', { icon: 'ℹ️' });
          setForm((prev) => ({ ...prev, ...d.data }));
        } else {
          toast.success(d.fuente === 'bd' ? 'Cliente encontrado en BD' : 'Datos cargados desde SRI');
          setForm((prev) => ({
            ...prev,
            tipoIdentificacion: d.data.tipoIdentificacion || prev.tipoIdentificacion,
            razonSocial: d.data.razonSocial || '',
            nombreComercial: d.data.nombreComercial || '',
            direccion: d.data.direccion || '',
            email: d.data.email || '',
            telefono: d.data.telefono || '',
          }));
        }
      } else if (d.servicioNoDisponible) {
        toast('SRI no disponible. Ingresa los datos manualmente.', { icon: '⚠️' });
      } else if (d.encontrado === false) {
        toast('Identificación no encontrada en SRI.', { icon: '⚠️' });
      }
    } catch {
      // Silencioso — el usuario puede ingresar datos manualmente
    } finally {
      setBuscandoSri(false);
    }
  };

  // ─── Abrir modal (nuevo o editar) ────────────────────────────────────────────
  const abrirNuevo = () => {
    setForm(FORM_INICIAL);
    setModalAbierto(true);
  };

  const abrirEditar = (cliente) => {
    setForm({
      id: cliente.id,
      tipoIdentificacion: cliente.tipoIdentificacion,
      identificacion: cliente.identificacion,
      razonSocial: cliente.razonSocial,
      nombreComercial: cliente.nombreComercial || '',
      direccion: cliente.direccion || '',
      email: cliente.email || '',
      telefono: cliente.telefono || '',
      activo: cliente.activo,
    });
    setModalAbierto(true);
  };

  const cerrarModal = () => {
    setModalAbierto(false);
    setForm(FORM_INICIAL);
  };

  // ─── Guardar (crear o actualizar) ────────────────────────────────────────────
  const guardar = async (e) => {
    e.preventDefault();
    if (!form.tipoIdentificacion || !form.identificacion.trim() || !form.razonSocial.trim()) {
      toast.error('Tipo de identificación, identificación y razón social son requeridos');
      return;
    }

    setGuardando(true);
    try {
      if (form.id) {
        await api.put(`/clientes/${form.id}`, form);
        toast.success('Cliente actualizado');
      } else {
        await api.post('/clientes', form);
        toast.success('Cliente creado');
      }
      cerrarModal();
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al guardar el cliente');
    } finally {
      setGuardando(false);
    }
  };

  // ─── Activar / Desactivar ────────────────────────────────────────────────────
  const toggleActivo = async (cliente) => {
    try {
      await api.put(`/clientes/${cliente.id}`, { activo: !cliente.activo });
      toast.success(cliente.activo ? 'Cliente desactivado' : 'Cliente activado');
      cargar();
    } catch {
      toast.error('No se pudo actualizar el estado');
    }
  };

  const camposCompletos = clientes.filter((c) => c.email || c.telefono).length;

  const abrirImport = () => { setImportResult(null); setModalImport(true); };
  const cerrarImport = () => { setModalImport(false); setImportResult(null); };

  const handleImportExcel = async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setImportando(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const res = await api.post('/clientes/importar-excel', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      if (res.data.resumen?.creados > 0) cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al importar el archivo');
    } finally {
      setImportando(false);
    }
  };

  const descargarPlantilla = async () => {
    try {
      const res = await api.get('/clientes/plantilla-excel', { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_clientes.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar la plantilla');
    }
  };

  return (
    <div className="clientes-page">
      {/* HEADER */}
      <div className="clientes-header">
        <div>
          <h1>Clientes</h1>
          <p>Gestiona tu base de clientes con consulta automática al catastro del SRI.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-secondary" onClick={abrirImport}>Importar Excel</button>
          <button className="btn-primary" onClick={abrirNuevo}>Nuevo cliente</button>
        </div>
      </div>

      {/* RESUMEN */}
      <div className="clientes-summary">
        <article className="clientes-summary-card">
          <span>Total clientes</span>
          <strong>{total}</strong>
        </article>
        <article className="clientes-summary-card">
          <span>Activos</span>
          <strong>{clientes.filter((c) => c.activo).length}</strong>
        </article>
        <article className="clientes-summary-card">
          <span>Con contacto</span>
          <strong>{camposCompletos}</strong>
        </article>
      </div>

      {/* FILTROS */}
      <div className="clientes-filtros">
        <input
          type="search"
          placeholder="Buscar por RUC, cédula o nombre..."
          value={busqueda}
          onChange={(e) => { setBusqueda(e.target.value); setPage(1); }}
          className="clientes-busqueda"
        />
      </div>

      {/* CATASTRO SRI — aparece inmediatamente debajo del buscador al escribir un nombre */}
      {busqueda.trim().length >= 3 && !/^\d+$/.test(busqueda.trim()) && (
        <div className="clientes-card" style={{ marginBottom: '12px', border: '1px solid #6366f1', borderRadius: '10px', overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                     padding: '10px 16px', background: '#eef2ff', cursor: 'pointer' }}
            onClick={() => setMostrarCatastro((v) => !v)}
          >
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#4338ca' }}>
              🗂 Catastro SRI
              {buscandoCatastro
                ? ' — buscando...'
                : catastroResultados.length > 0
                  ? ` — ${catastroResultados.length} resultados para "${busqueda.trim().toUpperCase()}"`
                  : ' — sin resultados'}
            </span>
            <span style={{ color: '#6366f1', fontSize: '0.82rem' }}>
              {mostrarCatastro ? '▲ ocultar' : '▼ ver'}
            </span>
          </div>

          {mostrarCatastro && catastroResultados.length > 0 && (
            <div className="clientes-table-wrap">
              <table className="clientes-table">
                <thead>
                  <tr>
                    <th>RUC</th>
                    <th>Razón Social</th>
                    <th>Tipo</th>
                    <th>Provincia</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {catastroResultados.map((c) => (
                    <tr key={c.ruc}>
                      <td><span className="tipo-badge">RUC</span> {c.ruc}</td>
                      <td>{c.razonSocial}</td>
                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                        {c.tipoContribuyente === 'PERSONAS NATURALES' ? 'Natural' : 'Sociedad'}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: '#64748b' }}>{c.provincia || '—'}</td>
                      <td className="acciones">
                        <button className="btn-secondary btn-sm" onClick={() => agregarDesdeCatastro(c)}>
                          + Agregar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {mostrarCatastro && !buscandoCatastro && catastroResultados.length === 0 && (
            <div className="clientes-empty" style={{ padding: '14px' }}>
              No se encontraron contribuyentes activos en el catastro SRI.
            </div>
          )}
        </div>
      )}

      {/* TABLA */}
      <div className="clientes-card">
        {cargando ? (
          <div className="clientes-loading">Cargando...</div>
        ) : clientes.length === 0 ? (
          <div className="clientes-empty">
            {busqueda ? 'No se encontraron clientes con ese criterio.' : 'No hay clientes registrados. Crea el primero.'}
          </div>
        ) : (
          <div className="clientes-table-wrap">
            <table className="clientes-table">
              <thead>
                <tr>
                  <th>Identificación</th>
                  <th>Razón Social</th>
                  <th>Nombre Comercial</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr
                    key={c.id}
                    className={!c.activo ? 'row-inactivo' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={() => abrirEditar(c)}
                  >
                    <td>
                      <span className="tipo-badge">
                        {TIPOS_IDENTIFICACION.find((t) => t.valor === c.tipoIdentificacion)?.label || c.tipoIdentificacion}
                      </span>{' '}
                      {c.identificacion}
                    </td>
                    <td>{c.razonSocial}</td>
                    <td>{c.nombreComercial || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td>{c.telefono || '—'}</td>
                    <td>
                      <span className={`estado-badge ${c.activo ? 'activo' : 'inactivo'}`}>
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="acciones" onClick={(e) => e.stopPropagation()}>
                      <div className="tbl-acciones">
                        <button className="btn-icon ic-editar" title="Editar cliente" onClick={() => abrirEditar(c)}><IcEditar/></button>
                        <button
                          className={`btn-icon ${c.activo ? 'ic-desactivar' : 'ic-activar'}`}
                          title={c.activo ? 'Desactivar cliente' : 'Activar cliente'}
                          onClick={() => toggleActivo(c)}
                        >
                          {c.activo ? <IcDesactivar/> : <IcActivar/>}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* PAGINACIÓN */}
        {total > LIMIT && (
          <div className="clientes-pagination">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span>Página {page} de {Math.ceil(total / LIMIT)}</span>
            <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      {/* MODAL IMPORTAR EXCEL */}
      {modalImport && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '660px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Importar clientes desde Excel</h2>
              <button className="modal-close" onClick={cerrarImport}>✕</button>
            </div>

            <div className="modal-form">
              <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
                Columnas <strong>obligatorias</strong>: <code>identificacion</code> +{' '}
                <code>razonSocial</code> <em>(empresas)</em> ó{' '}
                <code>apellidos</code> y <code>nombres</code> <em>(personas naturales)</em>.{' '}
                Opcionales: email, telefono, direccion.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b', marginBottom: '2px' }}>Paso 1 — Descarga la plantilla</div>
                  <div style={{ fontSize: '0.82rem', color: '#64748b' }}>Incluye ejemplos de formato para RUC, cédula y pasaporte</div>
                </div>
                <button className="btn-secondary" onClick={descargarPlantilla}>
                  Descargar plantilla
                </button>
              </div>

              {!importResult ? (
                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b', marginBottom: '10px' }}>Paso 2 — Sube tu archivo Excel</div>
                  <DropZone
                    accept=".xlsx,.xls"
                    icon="📊"
                    label="Arrastra o selecciona el archivo Excel"
                    sublabel="Acepta .xlsx o .xls"
                    disabled={importando}
                    onChange={([f]) => { if (f) handleImportExcel({ target: { files: [f] } }); }}
                  />
                  {importando && (
                    <p style={{ marginTop: '10px', color: '#64748b', fontSize: '0.9rem' }}>Procesando archivo...</p>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '5px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
                      ✓ Creados: {importResult.resumen.creados}
                    </span>
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '5px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
                      Omitidos: {importResult.resumen.omitidos}
                    </span>
                    {importResult.resumen.errores > 0 && (
                      <span style={{ background: '#fee2e2', color: '#991b1b', padding: '5px 14px', borderRadius: '20px', fontWeight: 600, fontSize: '0.9rem' }}>
                        Errores: {importResult.resumen.errores}
                      </span>
                    )}
                  </div>
                  <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Fila</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Identificación</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Razón Social</th>
                          <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>Estado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.resultados.map((r, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '6px 10px', color: '#94a3b8' }}>{r.fila}</td>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.identificacion}</td>
                            <td style={{ padding: '6px 10px' }}>{r.razonSocial || '—'}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: '10px', fontSize: '0.8rem', fontWeight: 600,
                                background: r.estado === 'creado' ? '#dcfce7' : r.estado === 'error' ? '#fee2e2' : '#f1f5f9',
                                color: r.estado === 'creado' ? '#166534' : r.estado === 'error' ? '#991b1b' : '#475569',
                              }}>
                                {r.estado === 'creado' ? 'Creado' : r.estado === 'error' ? `Error: ${r.motivo}` : r.motivo || 'Omitido'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="btn-secondary" onClick={() => setImportResult(null)} style={{ marginTop: '10px' }}>
                    Importar otro archivo
                  </button>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={cerrarImport}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL */}
      {modalAbierto && (
        <div className="modal-overlay">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{form.id ? 'Ver / Editar cliente' : 'Nuevo cliente'}</h2>
              <button className="modal-close" onClick={cerrarModal}>✕</button>
            </div>

            <form onSubmit={guardar} className="modal-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de identificación</label>
                  <select
                    value={form.tipoIdentificacion}
                    onChange={(e) => setForm((p) => ({ ...p, tipoIdentificacion: e.target.value }))}
                    disabled={!!form.id}
                  >
                    {TIPOS_IDENTIFICACION.map((t) => (
                      <option key={t.valor} value={t.valor}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>
                    Identificación
                    {buscandoSri && <span className="sri-loading"> Consultando SRI...</span>}
                  </label>
                  <input
                    type="text"
                    value={form.identificacion}
                    onChange={(e) => setForm((p) => ({ ...p, identificacion: e.target.value }))}
                    onBlur={handleIdentificacionBlur}
                    placeholder="RUC o cédula"
                    disabled={!!form.id}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Razón Social *</label>
                <input
                  type="text"
                  value={form.razonSocial}
                  onChange={(e) => setForm((p) => ({ ...p, razonSocial: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>Nombre Comercial</label>
                <input
                  type="text"
                  value={form.nombreComercial}
                  onChange={(e) => setForm((p) => ({ ...p, nombreComercial: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Dirección</label>
                <input
                  type="text"
                  value={form.direccion}
                  onChange={(e) => setForm((p) => ({ ...p, direccion: e.target.value }))}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    type="text"
                    value={form.telefono}
                    onChange={(e) => setForm((p) => ({ ...p, telefono: e.target.value }))}
                  />
                </div>
              </div>

              {form.id && (
                <div className="form-group form-check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.activo}
                      onChange={(e) => setForm((p) => ({ ...p, activo: e.target.checked }))}
                    />
                    {' '}Cliente activo
                  </label>
                </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={cerrarModal}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={guardando}>
                  {guardando ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Crear cliente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
