// ====================================
// FORMULARIO: NOTA DE DÉBITO (tipo 05)
// frontend/src/components/Facturacion/FormNotaDebito.jsx
// ====================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import './FormNotaDebito.css';

const TIPOS_ID = [
  { value: '04', label: 'RUC' },
  { value: '05', label: 'Cédula' },
  { value: '06', label: 'Pasaporte' },
  { value: '07', label: 'Consumidor Final' },
];

const IVA_OPCIONES = [
  { value: 0,  label: '0%' },
  { value: 5,  label: '5%' },
  { value: 15, label: '15%' },
];

export default function FormNotaDebito() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const [form, setForm] = useState({
    tipoIdentificacionComprador: '04',
    identificacionComprador:     '',
    razonSocialComprador:        '',
    codDocSustento:              '01',
    numeroDocSustento:           '',
    fechaEmisionDocSustento:     '',
    ivaPorcentaje:               15,
    observaciones:               '',
  });

  const [motivos, setMotivos] = useState([{ razon: '', valor: '' }]);

  const handleForm = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleMotivo = (idx, field, val) => {
    setMotivos((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: val } : m)));
  };

  const addMotivo = () => setMotivos((p) => [...p, { razon: '', valor: '' }]);
  const removeMotivo = (idx) => setMotivos((p) => p.filter((_, i) => i !== idx));

  const totalSin = motivos.reduce((acc, m) => acc + (parseFloat(m.valor) || 0), 0);
  const iva      = totalSin * (form.ivaPorcentaje / 100);
  const total    = totalSin + iva;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (motivos.some((m) => !m.razon.trim() || !m.valor)) {
      return setError('Todos los motivos deben tener razón y valor');
    }
    if (!form.numeroDocSustento.trim()) {
      return setError('Número del documento sustento requerido');
    }
    if (!form.fechaEmisionDocSustento) {
      return setError('Fecha del documento sustento requerida');
    }

    setSaving(true);
    try {
      await api.post('/notas-debito', {
        ...form,
        motivos: motivos.map((m) => ({ razon: m.razon, valor: parseFloat(m.valor) })),
      });
      navigate('/notas-debito');
    } catch (err) {
      setError(err.response?.data?.mensaje || 'Error al crear nota de débito');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-container">
      <div className="form-header">
        <button className="btn-back" onClick={() => navigate('/notas-debito')}>← Volver</button>
        <h2>Nueva Nota de Débito</h2>
      </div>

      {error && <div className="alert-danger">{error}</div>}

      <form onSubmit={handleSubmit} className="form-card">

        {/* Comprador */}
        <section className="form-section">
          <h3>Deudor / Comprador</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Tipo identificación</label>
              <select name="tipoIdentificacionComprador" value={form.tipoIdentificacionComprador} onChange={handleForm}>
                {TIPOS_ID.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Identificación *</label>
              <input name="identificacionComprador" value={form.identificacionComprador} onChange={handleForm} required />
            </div>
            <div className="form-group span-2">
              <label>Razón social *</label>
              <input name="razonSocialComprador" value={form.razonSocialComprador} onChange={handleForm} required />
            </div>
          </div>
        </section>

        {/* Documento sustento */}
        <section className="form-section">
          <h3>Documento Sustento (Factura afectada)</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>Tipo doc. sustento</label>
              <select name="codDocSustento" value={form.codDocSustento} onChange={handleForm}>
                <option value="01">01 - Factura</option>
                <option value="04">04 - Nota de Crédito</option>
                <option value="05">05 - Nota de Débito</option>
              </select>
            </div>
            <div className="form-group">
              <label>Número *</label>
              <input name="numeroDocSustento" value={form.numeroDocSustento} onChange={handleForm}
                placeholder="001-001-000000001" required />
            </div>
            <div className="form-group">
              <label>Fecha emisión doc. sustento *</label>
              <input type="date" name="fechaEmisionDocSustento" value={form.fechaEmisionDocSustento} onChange={handleForm} required />
            </div>
            <div className="form-group">
              <label>IVA aplicable</label>
              <select name="ivaPorcentaje" value={form.ivaPorcentaje} onChange={handleForm}>
                {IVA_OPCIONES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Motivos */}
        <section className="form-section">
          <h3>Motivos del Débito</h3>
          {motivos.map((m, idx) => (
            <div key={idx} className="motivo-row">
              <input
                placeholder="Razón / descripción del cargo"
                value={m.razon}
                onChange={(e) => handleMotivo(idx, 'razon', e.target.value)}
                style={{ flex: 2 }}
                required
              />
              <input
                type="number"
                placeholder="Valor $"
                value={m.valor}
                onChange={(e) => handleMotivo(idx, 'valor', e.target.value)}
                step="0.01"
                min="0.01"
                style={{ flex: 1, maxWidth: 130 }}
                required
              />
              {motivos.length > 1 && (
                <button type="button" className="btn-icon btn-danger-icon" onClick={() => removeMotivo(idx)}>✕</button>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={addMotivo} style={{ marginTop: 8 }}>
            + Agregar motivo
          </button>
        </section>

        {/* Resumen */}
        <section className="form-section totales-section">
          <div className="totales-row"><span>Subtotal (sin IVA):</span><strong>${totalSin.toFixed(2)}</strong></div>
          <div className="totales-row"><span>IVA {form.ivaPorcentaje}%:</span><strong>${iva.toFixed(2)}</strong></div>
          <div className="totales-row total-final"><span>TOTAL:</span><strong>${total.toFixed(2)}</strong></div>
        </section>

        {/* Observaciones */}
        <div className="form-group">
          <label>Observaciones</label>
          <textarea name="observaciones" value={form.observaciones} onChange={handleForm} rows={2} />
        </div>

        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate('/notas-debito')}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Procesando...' : 'Emitir Nota de Débito'}
          </button>
        </div>
      </form>

    </div>
  );
}
