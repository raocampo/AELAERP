// ====================================
// FORMULARIO GUÍA DE REMISIÓN — AELA
// frontend/src/components/GuiasRemision/FormGuiaRemision.jsx
// Nuevo / Editar
// ====================================

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import './GuiasRemision.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

const DETALLE_VACIO = { codigoInterno: '', descripcion: '', cantidad: 1 };

function hoy() {
  return new Date().toISOString().split('T')[0];
}
function manana() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export default function FormGuiaRemision() {
  const navigate = useNavigate();
  const { id }   = useParams();
  const esEdicion = Boolean(id);

  const [form, setForm] = useState({
    establecimiento:    '001',
    puntoEmision:       '001',
    fechaIniTransporte: hoy(),
    fechaFinTransporte: manana(),
    dirPartida:         '',
    rucTransportista:   '',
    nombreTransportista:'',
    placaVehiculo:      '',
    rucDestinatario:    '',
    nombreDestinatario: '',
    dirDestinatario:    '',
    motivoTraslado:     '',
    docAduaneroUnico:   '',
    codDocSustento:     '01',
    numDocSustento:     '',
    numAutDocSustento:  '',
    fechaEmisionDocSustento: hoy(),
    observaciones:      '',
    detalles:           [{ ...DETALLE_VACIO }],
  });

  const [saving,  setSaving]  = useState(false);
  const [loading, setLoading] = useState(esEdicion);
  const [error,   setError]   = useState('');
  const [transportistasSug, setTransportistasSug] = useState([]);

  // ── Autocompletado de transportistas (catálogo) ──
  useEffect(() => {
    const termino = form.nombreTransportista?.trim();
    if (!termino || termino.length < 2) { setTransportistasSug([]); return; }
    const timeout = setTimeout(() => {
      api.get('/transportistas', { params: { q: termino } })
        .then((r) => setTransportistasSug(r.data?.data || []))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [form.nombreTransportista]);

  const seleccionarTransportista = (nombreSeleccionado) => {
    const encontrado = transportistasSug.find((t) => t.nombre === nombreSeleccionado);
    if (!encontrado) return;
    setForm((f) => ({
      ...f,
      nombreTransportista: encontrado.nombre,
      rucTransportista: encontrado.identificacion,
      placaVehiculo: encontrado.placaVehiculo || f.placaVehiculo,
    }));
  };

  // ── Cargar datos en modo edición ──
  useEffect(() => {
    if (!esEdicion) return;
    const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
    fetch(`${API_URL}/guias-remision/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.mensaje);
        const g = data.guia;
        setForm({
          establecimiento:    g.establecimiento,
          puntoEmision:       g.puntoEmision,
          fechaIniTransporte: g.fechaIniTransporte?.split('T')[0] || hoy(),
          fechaFinTransporte: g.fechaFinTransporte?.split('T')[0] || manana(),
          dirPartida:         g.dirPartida || '',
          rucTransportista:   g.rucTransportista || '',
          nombreTransportista:g.nombreTransportista || '',
          placaVehiculo:      g.placaVehiculo || '',
          rucDestinatario:    g.rucDestinatario || '',
          nombreDestinatario: g.nombreDestinatario || '',
          dirDestinatario:    g.dirDestinatario || '',
          motivoTraslado:     g.motivoTraslado || '',
          docAduaneroUnico:   g.docAduaneroUnico || '',
          observaciones:      g.observaciones || '',
          detalles:           Array.isArray(g.detalles) && g.detalles.length > 0
                                ? g.detalles
                                : [{ ...DETALLE_VACIO }],
          codDocSustento:     g.codDocSustento || '01',
          numDocSustento:     g.numDocSustento || '',
          numAutDocSustento:  g.numAutDocSustento || '',
          fechaEmisionDocSustento: g.fechaEmisionDocSustento?.split('T')[0] || hoy(),
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, esEdicion]);

  const set = (campo, valor) => setForm((f) => ({ ...f, [campo]: valor }));

  // ── Detalles ──
  const addDetalle = () =>
    setForm((f) => ({ ...f, detalles: [...f.detalles, { ...DETALLE_VACIO }] }));

  const removeDetalle = (idx) =>
    setForm((f) => ({
      ...f,
      detalles: f.detalles.filter((_, i) => i !== idx),
    }));

  const setDetalle = (idx, campo, valor) =>
    setForm((f) => ({
      ...f,
      detalles: f.detalles.map((d, i) => (i === idx ? { ...d, [campo]: valor } : d)),
    }));

  // ── Guardar ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const url    = esEdicion ? `${API_URL}/guias-remision/${id}` : `${API_URL}/guias-remision`;
      const method = esEdicion ? 'PATCH' : 'POST';

      const res  = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.mensaje || 'Error al guardar');

      // Guarda/actualiza el transportista en el catálogo para autocompletar la
      // próxima guía — no bloqueante, si falla (ej. ya existe) no interrumpe.
      if (form.rucTransportista && form.nombreTransportista) {
        api.post('/transportistas', {
          identificacion: form.rucTransportista,
          nombre: form.nombreTransportista,
          placaVehiculo: form.placaVehiculo || null,
        }).catch(() => {});
      }

      navigate('/guias-remision');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="gr-loading">Cargando guía…</div>;

  return (
    <div className="gr-container">
      <div className="gr-header">
        <div className="gr-header-left">
          <h1 className="gr-titulo">
            {esEdicion ? 'Editar Guía de Remisión' : 'Nueva Guía de Remisión'}
          </h1>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/guias-remision')}>
          ← Volver
        </button>
      </div>

      {error && <div className="gr-alert gr-alert-danger">{error}</div>}

      <form className="gr-form" onSubmit={handleSubmit}>

        {/* ── Sección: Establecimiento y fechas ── */}
        <div className="gr-section">
          <h2 className="gr-section-title">Datos de Transporte</h2>
          <div className="gr-grid-3">
            <div className="gr-field">
              <label>Establecimiento</label>
              <input type="text" maxLength={3} value={form.establecimiento}
                onChange={(e) => set('establecimiento', e.target.value.replace(/\D/g,'').padStart(3,'0').slice(-3))}
                className="gr-input" />
            </div>
            <div className="gr-field">
              <label>Punto Emisión</label>
              <input type="text" maxLength={3} value={form.puntoEmision}
                onChange={(e) => set('puntoEmision', e.target.value.replace(/\D/g,'').padStart(3,'0').slice(-3))}
                className="gr-input" />
            </div>
          </div>
          <div className="gr-grid-3">
            <div className="gr-field">
              <label>Fecha Inicio Transporte *</label>
              <input type="date" required value={form.fechaIniTransporte}
                onChange={(e) => set('fechaIniTransporte', e.target.value)}
                className="gr-input" />
            </div>
            <div className="gr-field">
              <label>Fecha Fin Transporte *</label>
              <input type="date" required value={form.fechaFinTransporte}
                onChange={(e) => set('fechaFinTransporte', e.target.value)}
                className="gr-input" />
            </div>
            <div className="gr-field">
              <label>Dirección de Partida *</label>
              <input type="text" required value={form.dirPartida}
                onChange={(e) => set('dirPartida', e.target.value)}
                className="gr-input" placeholder="Ej: Av. Principal 123, Quito" />
            </div>
          </div>
        </div>

        {/* ── Sección: Transportista ── */}
        <div className="gr-section">
          <h2 className="gr-section-title">Transportista</h2>
          <div className="gr-grid-3">
            <div className="gr-field">
              <label>RUC Transportista *</label>
              <input type="text" required maxLength={13} value={form.rucTransportista}
                onChange={(e) => set('rucTransportista', e.target.value.replace(/\D/g,''))}
                className="gr-input" placeholder="RUC / Cédula" />
            </div>
            <div className="gr-field">
              <label>Nombre / Razón Social *</label>
              <input type="text" required value={form.nombreTransportista}
                onChange={(e) => set('nombreTransportista', e.target.value)}
                onBlur={(e) => seleccionarTransportista(e.target.value)}
                list="dl-transportistas"
                className="gr-input" placeholder="Escribe para buscar en el catálogo..." />
              <datalist id="dl-transportistas">
                {transportistasSug.map((t) => (
                  <option key={t.id} value={t.nombre} />
                ))}
              </datalist>
            </div>
            <div className="gr-field">
              <label>Placa del Vehículo</label>
              <input type="text" maxLength={8} value={form.placaVehiculo}
                onChange={(e) => set('placaVehiculo', e.target.value.toUpperCase())}
                className="gr-input" placeholder="Ej: ABC-1234" />
            </div>
          </div>
        </div>

        {/* ── Sección: Destinatario ── */}
        <div className="gr-section">
          <h2 className="gr-section-title">Destinatario</h2>
          <div className="gr-grid-3">
            <div className="gr-field">
              <label>RUC / Cédula Destinatario *</label>
              <input type="text" required maxLength={13} value={form.rucDestinatario}
                onChange={(e) => set('rucDestinatario', e.target.value.replace(/\D/g,''))}
                className="gr-input" />
            </div>
            <div className="gr-field">
              <label>Nombre / Razón Social *</label>
              <input type="text" required value={form.nombreDestinatario}
                onChange={(e) => set('nombreDestinatario', e.target.value)}
                className="gr-input" />
            </div>
            <div className="gr-field">
              <label>Dirección Destino *</label>
              <input type="text" required value={form.dirDestinatario}
                onChange={(e) => set('dirDestinatario', e.target.value)}
                className="gr-input" placeholder="Calle, ciudad" />
            </div>
          </div>
          <div className="gr-grid-3">
            <div className="gr-field" style={{ gridColumn: '1 / 3' }}>
              <label>Motivo de Traslado *</label>
              <input type="text" required value={form.motivoTraslado}
                onChange={(e) => set('motivoTraslado', e.target.value)}
                className="gr-input" placeholder="Ej: Venta, Transferencia, Consignación…" />
            </div>
            <div className="gr-field">
              <label>Doc. Aduanero Único</label>
              <input type="text" value={form.docAduaneroUnico}
                onChange={(e) => set('docAduaneroUnico', e.target.value)}
                className="gr-input" placeholder="Opcional" />
            </div>
          </div>
        </div>

        {/* ── Sección: Documento Sustento (requerido SRI) ── */}
        <div className="gr-section">
          <h2 className="gr-section-title">📄 Documento Sustento del Traslado</h2>
          <div className="gr-grid-3">
            <div className="gr-field">
              <label>Tipo de Documento</label>
              <select value={form.codDocSustento} onChange={e => set('codDocSustento', e.target.value)} className="gr-input">
                <option value="01">01 - Factura</option>
                <option value="03">03 - Liquidación de compra</option>
                <option value="04">04 - Nota de crédito</option>
                <option value="05">05 - Nota de débito</option>
                <option value="06">06 - Guía de remisión</option>
                <option value="07">07 - Comprobante de retención</option>
              </select>
            </div>
            <div className="gr-field">
              <label>Número del Documento *</label>
              <input type="text" value={form.numDocSustento}
                onChange={e => set('numDocSustento', e.target.value)}
                className="gr-input" placeholder="001-001-000000001" />
            </div>
            <div className="gr-field">
              <label>Fecha Emisión Doc. *</label>
              <input type="date" value={form.fechaEmisionDocSustento}
                onChange={e => set('fechaEmisionDocSustento', e.target.value)}
                className="gr-input" />
            </div>
          </div>
          <div className="gr-grid-3">
            <div className="gr-field" style={{ gridColumn: '1 / 4' }}>
              <label>Número Autorización / Clave Acceso</label>
              <input type="text" value={form.numAutDocSustento}
                onChange={e => set('numAutDocSustento', e.target.value)}
                className="gr-input" placeholder="49 dígitos o número de autorización" maxLength={49} />
            </div>
          </div>
        </div>

        {/* ── Sección: Detalles ── */}
        <div className="gr-section">
          <div className="gr-section-header">
            <h2 className="gr-section-title">Detalle de Productos / Bienes</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addDetalle}>
              ➕ Agregar ítem
            </button>
          </div>
          <table className="gr-detalles-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción *</th>
                <th style={{ width: 100 }}>Cantidad *</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {form.detalles.map((d, i) => (
                <tr key={i}>
                  <td>
                    <input type="text" className="gr-input" value={d.codigoInterno}
                      onChange={(e) => setDetalle(i, 'codigoInterno', e.target.value)}
                      placeholder="Opcional" />
                  </td>
                  <td>
                    <input type="text" required className="gr-input" value={d.descripcion}
                      onChange={(e) => setDetalle(i, 'descripcion', e.target.value)}
                      placeholder="Nombre del bien o producto" />
                  </td>
                  <td>
                    <input type="number" required min={0.01} step={0.01} className="gr-input"
                      value={d.cantidad}
                      onChange={(e) => setDetalle(i, 'cantidad', parseFloat(e.target.value) || 1)} />
                  </td>
                  <td>
                    {form.detalles.length > 1 && (
                      <button type="button" className="btn btn-icon danger"
                        onClick={() => removeDetalle(i)} title="Eliminar fila">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Observaciones ── */}
        <div className="gr-section">
          <div className="gr-field">
            <label>Observaciones</label>
            <textarea rows={2} className="gr-input" value={form.observaciones}
              onChange={(e) => set('observaciones', e.target.value)}
              placeholder="Información adicional" />
          </div>
        </div>

        {/* ── Botones ── */}
        <div className="gr-form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/guias-remision')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando…' : esEdicion ? '💾 Guardar cambios' : '✅ Crear Guía'}
          </button>
        </div>

      </form>
    </div>
  );
}
