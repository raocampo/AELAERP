// ====================================
// COMPONENTE: CONFIGURACIÓN SRI
// frontend/src/components/Facturacion/ConfiguracionSRI.jsx
// ====================================

import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './ConfiguracionSRI.css';

// El logo ahora se guarda como data URI en la BD (no requiere URL del servidor)
const SERVER_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5600').replace(/\/api$/, '');

const ConfiguracionSRI = () => {
  const navigate  = useNavigate();
  const location = useLocation();
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [form, setForm] = useState({
    ruc:                   '',
    razonSocial:           '',
    nombreComercial:       '',
    dirMatriz:             '',
    dirEstablecimiento:    '',
    establecimiento:       '001',
    puntoEmision:          '001',
    ambiente:              '1',
    // Info Tributaria (todos booleanos en el form)
    contribuyenteRimpe:    false,
    contribuyenteEspecial: false,   // se manda como "" o "SI"
    negocioPopular:        false,
    obligadoContabilidad:  false,
    agenteRetencion:       false,   // se manda como "" o "SI"
    emailNotificaciones:   '',
    telefono:              '',
  });
  const [tipoCertificado, setTipoCertificado] = useState('archivo');

  // Punto de emisión — secuenciales iniciales
  const [showModalPunto, setShowModalPunto] = useState(false);
  const [puntoDatos,     setPuntoDatos]     = useState(null);
  const [puntoForm,      setPuntoForm]      = useState({
    secInicialFactura:      0,
    secInicialNotaCredito:  0,
    secInicialNotaDebito:   0,
    secInicialRetencion:    0,
    secInicialLiquidacion:  0,
    secInicialGuiaRemision: 0,
    secInicialNotaVenta:    0,
  });
  const [savingPunto, setSavingPunto] = useState(false);

  const abrirModalPunto = async () => {
    const defaults = {
      secInicialFactura: 0, secInicialNotaCredito: 0, secInicialNotaDebito: 0,
      secInicialRetencion: 0, secInicialLiquidacion: 0,
      secInicialGuiaRemision: 0, secInicialNotaVenta: 0,
    };
    try {
      const res = await api.get('/puntos-emision/activo');
      const p   = res.data.punto;
      setPuntoDatos(p);
      setPuntoForm({
        secInicialFactura:      p.secInicialFactura      ?? 0,
        secInicialNotaCredito:  p.secInicialNotaCredito  ?? 0,
        secInicialNotaDebito:   p.secInicialNotaDebito   ?? 0,
        secInicialRetencion:    p.secInicialRetencion    ?? 0,
        secInicialLiquidacion:  p.secInicialLiquidacion  ?? 0,
        secInicialGuiaRemision: p.secInicialGuiaRemision ?? 0,
        secInicialNotaVenta:    p.secInicialNotaVenta    ?? 0,
      });
    } catch (err) {
      console.error('[puntos-emision] error al cargar:', err.response?.data || err.message);
      toast.error('No se pudo cargar el punto de emisión — mostrando valores por defecto');
      setPuntoDatos({ establecimiento: form.establecimiento, puntoEmision: form.puntoEmision });
      setPuntoForm(defaults);
    }
    setShowModalPunto(true);
  };

  const handlePuntoChange = (e) => {
    const { name, value } = e.target;
    const n = parseInt(value, 10);
    setPuntoForm(prev => ({ ...prev, [name]: isNaN(n) ? 0 : Math.max(0, n) }));
  };

  const guardarPunto = async () => {
    if (!puntoDatos) return;
    setSavingPunto(true);
    try {
      await api.put(`/puntos-emision/${puntoDatos.id}`, puntoForm);
      toast.success('Secuenciales actualizados');
      setShowModalPunto(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al guardar');
    } finally {
      setSavingPunto(false);
    }
  };

  // Logo
  const [logoUrl,   setLogoUrl]   = useState(null);
  const [logoFile,  setLogoFile]  = useState(null);
  const [logoUp,    setLogoUp]    = useState(false);
  const logoRef = useRef();

  // Certificado
  const [certInfo,  setCertInfo]  = useState(null);
  const [certFile,  setCertFile]  = useState(null);
  const [certClave, setCertClave] = useState('');
  const [probando,  setProbando]  = useState(false);
  const certRef = useRef();

  useEffect(() => { cargar(); }, []);

  const cargar = async () => {
    try {
      const res = await api.get('/facturas/configuracion');
      if (res.data.data) {
        const d = res.data.data;
        setForm({
          ruc:                   d.ruc                   || '',
          razonSocial:           d.razonSocial           || '',
          nombreComercial:       d.nombreComercial       || '',
          dirMatriz:             d.dirMatriz             || '',
          dirEstablecimiento:    d.dirEstablecimiento    || '',
          establecimiento:       d.establecimiento       || '001',
          puntoEmision:          d.puntoEmision          || '001',
          ambiente:              String(d.ambiente       || 1),
          // checkboxes
          contribuyenteRimpe:    !!d.contribuyenteRimpe,
          contribuyenteEspecial: !!(d.contribuyenteEspecial && d.contribuyenteEspecial !== ''),
          negocioPopular:        !!d.negocioPopular,
          obligadoContabilidad:  !!d.obligadoContabilidad,
          agenteRetencion:       !!(d.agenteRetencion && d.agenteRetencion !== ''),
          emailNotificaciones:   d.emailNotificaciones   || '',
          telefono:              d.telefono              || '',
        });
        setCertInfo({ cargado: !!d.certificadoP12 });
        setLogoUrl(d.logoUrl || null);
        setTipoCertificado(d.tipoCertificado || 'archivo');
      }
    } catch {
      toast.error('Error al cargar configuración SRI');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (!form.ruc || !form.razonSocial || !form.dirMatriz) {
      return toast.error('RUC, Razón Social y Dirección son obligatorios');
    }
    if (form.ruc.length !== 13) {
      return toast.error('El RUC debe tener 13 dígitos');
    }
    setSaving(true);
    try {
      await api.put('/facturas/configuracion', {
        ...form,
        // Convertir booleanos a strings para los campos String? del esquema
        contribuyenteEspecial: form.contribuyenteEspecial ? 'SI' : '',
        agenteRetencion:       form.agenteRetencion       ? 'SI' : '',
        tipoCertificado,
      });
      toast.success('Configuración guardada');

      if (location.state?.returnTo) {
        navigate(location.state.returnTo, {
          state: location.state?.tab ? { tab: location.state.tab } : undefined,
        });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  // ─── Logo ────────────────────────────────────────────────────────────────
  const handleSubirLogo = async () => {
    if (!logoFile) return toast.error('Selecciona una imagen');
    setLogoUp(true);
    try {
      const fd = new FormData();
      fd.append('logo', logoFile);
      const res = await api.post('/facturas/configuracion/logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLogoUrl(res.data.data.logoUrl);
      setLogoFile(null);
      if (logoRef.current) logoRef.current.value = '';
      toast.success('Logo subido correctamente');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al subir logo');
    } finally {
      setLogoUp(false);
    }
  };

  // ─── Certificado ─────────────────────────────────────────────────────────
  const handleSubirCertificado = async () => {
    if (!certFile) return toast.error('Selecciona un archivo .p12');
    const fd = new FormData();
    fd.append('certificado', certFile);
    fd.append('clave', certClave);
    try {
      await api.post('/facturas/configuracion/certificado', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Certificado cargado correctamente');
      setCertInfo({ cargado: true, archivo: certFile.name });
      setCertFile(null);
      setCertClave('');
      if (certRef.current) certRef.current.value = '';
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error al subir certificado');
    }
  };

  const handleEliminarCert = async () => {
    if (!window.confirm('¿Eliminar el certificado? El sistema pasará a modo offline.')) return;
    try {
      await api.delete('/facturas/configuracion/certificado');
      setCertInfo({ cargado: false });
      toast.success('Certificado eliminado');
    } catch {
      toast.error('Error al eliminar certificado');
    }
  };

  const handleProbarConexion = async () => {
    setProbando(true);
    try {
      const res = await api.get('/facturas/configuracion');
      const amb = parseInt(res.data.data?.ambiente);
      const url = amb === 1 ? 'https://celcer.sri.gob.ec' : 'https://cel.sri.gob.ec';
      toast.success(`Configuración OK. Ambiente: ${amb === 1 ? 'PRUEBAS' : 'PRODUCCIÓN'} (${url})`);
    } catch {
      toast.error('No se pudo verificar la configuración');
    } finally {
      setProbando(false);
    }
  };

  if (loading) return <div className="loading">Cargando configuración SRI...</div>;

  return (
    <>
    <div className="sri-config-container">
      <div className="sri-config-header">
        <div>
          <h1>⚙️ Configuración SRI</h1>
          <p className="sri-config-subtitle">
            Datos del emisor de comprobantes electrónicos (SRI Ecuador)
          </p>
          <p className="sri-config-note">
            Los datos básicos de empresa se precargan desde el registro inicial y aquí se afinan solo para emisión electrónica.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={() => navigate('/facturas')}>
            ← Volver
          </button>
          <button className="btn-secondary" onClick={handleProbarConexion} disabled={probando}>
            {probando ? 'Verificando...' : '🔗 Probar conexión'}
          </button>
        </div>
      </div>

      {/* Banner de ambiente */}
      <div className={`sri-ambiente-banner ${form.ambiente === '1' ? 'pruebas' : 'produccion'}`}>
        {form.ambiente === '1'
          ? '⚠️ MODO PRUEBAS — Las facturas NO tienen validez tributaria real.'
          : '✅ MODO PRODUCCIÓN — Las facturas tienen plena validez legal y tributaria.'}
      </div>

      <form onSubmit={handleGuardar} className="sri-config-form">

        {/* ─── Datos del Emisor ─── */}
        <div className="sri-section">
          <h2>🏢 Datos del Emisor</h2>
          <div className="sri-grid-2">
            <div className="sri-field">
              <label>RUC *</label>
              <input name="ruc" value={form.ruc} onChange={handleChange}
                placeholder="1234567890001" maxLength={13}
                className={form.ruc && form.ruc.length !== 13 ? 'input-error' : ''}
                required />
              {form.ruc && form.ruc.length !== 13 && (
                <span className="field-hint error">El RUC debe tener 13 dígitos</span>
              )}
            </div>
            <div className="sri-field">
              <label>Razón Social *</label>
              <input name="razonSocial" value={form.razonSocial} onChange={handleChange}
                placeholder="CLÍNICA MÉDICA EJEMPLO S.A." maxLength={300} required />
            </div>
            <div className="sri-field">
              <label>Nombre Comercial</label>
              <input name="nombreComercial" value={form.nombreComercial} onChange={handleChange}
                placeholder="Nombre que aparece en facturas" maxLength={300} />
            </div>
            <div className="sri-field">
              <label>Email para notificaciones</label>
              <input type="email" name="emailNotificaciones" value={form.emailNotificaciones}
                onChange={handleChange} placeholder="facturas@clinica.com" />
              <span className="field-hint">Aparece en la Información Adicional del RIDE</span>
            </div>
            <div className="sri-field">
              <label>Teléfono</label>
              <input type="tel" name="telefono" value={form.telefono}
                onChange={handleChange} placeholder="02-123-4567" maxLength={50} />
              <span className="field-hint">Aparece en la Información Adicional del RIDE</span>
            </div>
          </div>

          <div className="sri-field full" style={{ marginTop: 14 }}>
            <label>Dirección Matriz *</label>
            <input name="dirMatriz" value={form.dirMatriz} onChange={handleChange}
              placeholder="Av. Principal 123 y Secundaria, Ciudad" maxLength={300} required />
          </div>
          <div className="sri-field full" style={{ marginTop: 14 }}>
            <label>Dirección Establecimiento <span className="field-hint">(si difiere de la matriz)</span></label>
            <input name="dirEstablecimiento" value={form.dirEstablecimiento}
              onChange={handleChange} placeholder="Dejar vacío para usar la misma dirección de la matriz" />
          </div>

          {/* Logo de la factura */}
          <div className="sri-logo-section">
            <label className="sri-logo-label">Logo de la Factura (RIDE)</label>
            <div className="sri-logo-body">
              {logoUrl ? (
                <div className="sri-logo-preview">
                  <img
                    src={logoUrl.startsWith('data:') ? logoUrl : `${SERVER_BASE}${logoUrl}`}
                    alt="Logo actual"
                    className="sri-logo-img"
                  />
                  <span className="field-hint">Logo actual — sube uno nuevo para reemplazarlo</span>
                </div>
              ) : (
                <div className="sri-logo-empty">Sin logo cargado</div>
              )}
              <div className="sri-logo-upload">
                <input type="file" accept="image/*" ref={logoRef}
                  onChange={e => setLogoFile(e.target.files[0] || null)} />
                {logoFile && <span className="field-hint">🖼 {logoFile.name}</span>}
                <button type="button" className="btn-secondary"
                  onClick={handleSubirLogo} disabled={!logoFile || logoUp}>
                  {logoUp ? 'Subiendo...' : '⬆️ Subir logo'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Numeración y Ambiente ─── */}
        <div className="sri-section">
          <h2>🔢 Numeración y Ambiente</h2>
          <div className="sri-grid-3">
            <div className="sri-field">
              <label>Establecimiento</label>
              <input name="establecimiento" value={form.establecimiento}
                onChange={handleChange} placeholder="001" maxLength={3} />
              <span className="field-hint">Código SRI del establecimiento</span>
            </div>
            <div className="sri-field">
              <label>Punto de Emisión</label>
              <input name="puntoEmision" value={form.puntoEmision}
                onChange={handleChange} placeholder="001" maxLength={3} />
              <span className="field-hint">Punto de emisión</span>
            </div>
            <div className="sri-field">
              <label>Ambiente</label>
              <select name="ambiente" value={form.ambiente} onChange={handleChange}>
                <option value="1">1 — Pruebas</option>
                <option value="2">2 — Producción</option>
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn-secondary" onClick={abrirModalPunto}>
              🔢 Configurar secuenciales iniciales
            </button>
            <span className="field-hint" style={{ marginLeft: 10 }}>
              Útil si ya tiene documentos emitidos en otro sistema
            </span>
          </div>
        </div>

        {/* ─── Información Tributaria Adicional ─── */}
        <div className="sri-section">
          <h2>📋 Información Tributaria Adicional</h2>
          <div className="sri-check-grid">
            <label className="sri-check-item">
              <input type="checkbox" name="contribuyenteRimpe"
                checked={form.contribuyenteRimpe} onChange={handleChange} />
              <span>Contribuyente RIMPE</span>
            </label>
            <label className="sri-check-item">
              <input type="checkbox" name="contribuyenteEspecial"
                checked={form.contribuyenteEspecial} onChange={handleChange} />
              <span>Contribuyente Especial</span>
            </label>
            <label className="sri-check-item">
              <input type="checkbox" name="negocioPopular"
                checked={form.negocioPopular} onChange={handleChange} />
              <span>Negocio Popular</span>
            </label>
            <label className="sri-check-item">
              <input type="checkbox" name="obligadoContabilidad"
                checked={form.obligadoContabilidad} onChange={handleChange} />
              <span>Obligado a llevar contabilidad</span>
            </label>
            <label className="sri-check-item">
              <input type="checkbox" name="agenteRetencion"
                checked={form.agenteRetencion} onChange={handleChange} />
              <span>Agente de Retención</span>
            </label>
          </div>
        </div>

        <div className="sri-form-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : '💾 Guardar Configuración'}
          </button>
        </div>
      </form>

      {/* ─── Firma Electrónica ─── */}
      <div className="sri-section sri-cert-section">
        <h2>🔐 Firma Electrónica</h2>
        <p className="sri-cert-desc">
          La firma electrónica es emitida por el{' '}
          <strong>Banco Central del Ecuador</strong> o <strong>Security Data</strong>.
          Sin firma configurada, las facturas se generan en modo <em>pendiente de firma</em>.
        </p>

        {/* Selector tipo de firma */}
        <div className="sri-tipo-firma-selector">
          <label className="sri-tipo-firma-label">Tipo de firma electrónica:</label>
          <div className="sri-tipo-firma-options">
            <label className={`sri-tipo-option ${tipoCertificado === 'archivo' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="tipoCertificado"
                value="archivo"
                checked={tipoCertificado === 'archivo'}
                onChange={() => setTipoCertificado('archivo')}
              />
              <span className="sri-tipo-icon">💾</span>
              <div>
                <strong>Archivo .p12 / .pfx</strong>
                <small>Certificado en archivo. El sistema firma automáticamente al emitir.</small>
              </div>
            </label>
            <label className={`sri-tipo-option ${tipoCertificado === 'token' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="tipoCertificado"
                value="token"
                checked={tipoCertificado === 'token'}
                onChange={() => setTipoCertificado('token')}
              />
              <span className="sri-tipo-icon">🔑</span>
              <div>
                <strong>Token (dispositivo físico USB)</strong>
                <small>Firma con token SafeNet, eToken u otro dispositivo. Se descarga el XML sin firmar.</small>
              </div>
            </label>
          </div>
        </div>

        {/* Panel según tipo seleccionado */}
        {tipoCertificado === 'archivo' && (
          <>
            <div className={`sri-cert-status ${certInfo?.cargado ? 'cargado' : 'vacio'}`}>
              {certInfo?.cargado
                ? <><span>✅</span> Certificado .p12 cargado — el sistema firmará y enviará automáticamente al SRI</>
                : <><span>⚠️</span> Sin certificado — las facturas quedarán en estado <strong>PENDIENTE_FIRMA</strong></>
              }
            </div>

            {!certInfo?.cargado && (
              <div className="sri-cert-upload">
                <div className="sri-grid-2">
                  <div className="sri-field">
                    <label>Archivo .p12 / .pfx</label>
                    <input type="file" accept=".p12,.pfx" ref={certRef}
                      onChange={e => setCertFile(e.target.files[0] || null)} />
                    {certFile && <span className="field-hint">📄 {certFile.name}</span>}
                  </div>
                  <div className="sri-field">
                    <label>Contraseña del certificado</label>
                    <input type="password" value={certClave}
                      onChange={e => setCertClave(e.target.value)}
                      placeholder="Contraseña del .p12" />
                  </div>
                </div>
                <button className="btn-primary" onClick={handleSubirCertificado} disabled={!certFile}>
                  ⬆️ Subir certificado
                </button>
              </div>
            )}

            {certInfo?.cargado && (
              <button className="btn-danger-outline" onClick={handleEliminarCert}>
                🗑️ Eliminar certificado
              </button>
            )}
          </>
        )}

        {tipoCertificado === 'token' && (
          <div className="sri-token-info">
            <div className="sri-cert-status cargado">
              <span>🔑</span> Modo Token activo — el sistema generará el XML sin firmar para que lo firmes con tu dispositivo
            </div>
            <div className="sri-token-steps">
              <h4>Flujo de emisión con Token:</h4>
              <ol>
                <li>Emite la factura normalmente desde <strong>+ Nueva Factura</strong></li>
                <li>La factura queda en estado <strong>PENDIENTE_FIRMA</strong></li>
                <li>En el detalle de la factura, descarga el <strong>XML sin firmar</strong></li>
                <li>Firma el XML con tu token usando la herramienta del SRI o <strong>FirmaEC</strong></li>
                <li>Sube el XML firmado desde el detalle de la factura</li>
                <li>El sistema enviará el XML firmado al SRI automáticamente</li>
              </ol>
            </div>
            <div className="sri-token-hint">
              <strong>Herramientas de firma compatibles:</strong> FirmaEC (BCE), SRI Móvil, o cualquier firmador PKCS#11.
            </div>
          </div>
        )}

        {/* Botón guardar tipo de firma */}
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleGuardar}
            disabled={saving}
          >
            💾 Guardar tipo de firma
          </button>
        </div>
      </div>
    </div>

    {/* ─── Modal: Secuenciales iniciales del punto de emisión ─── */}
    {showModalPunto && (
      <div
        onClick={() => setShowModalPunto(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(15,23,42,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
            background: '#f8fafc',
          }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1e293b' }}>
              🔢 Secuenciales iniciales — Punto {puntoDatos?.establecimiento}-{puntoDatos?.puntoEmision}
            </h3>
            <button
              onClick={() => setShowModalPunto(false)}
              style={{
                background: 'none', border: 'none', fontSize: 18,
                cursor: 'pointer', color: '#64748b', lineHeight: 1,
              }}
            >✕</button>
          </div>

          {/* Body */}
          <div style={{ padding: '16px 20px' }}>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0, marginBottom: 16 }}>
              Ingrese el último número emitido en cada tipo de documento.
              El sistema continuará desde el número siguiente.
              Deje en <strong>0</strong> si empieza desde el inicio.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
              {[
                { campo: 'secInicialFactura',      label: 'Factura' },
                { campo: 'secInicialNotaCredito',  label: 'Nota de Crédito' },
                { campo: 'secInicialNotaDebito',   label: 'Nota de Débito' },
                { campo: 'secInicialRetencion',    label: 'Comp. de Retención' },
                { campo: 'secInicialLiquidacion',  label: 'Liquidación de Compra' },
                { campo: 'secInicialGuiaRemision', label: 'Guía de Remisión' },
                { campo: 'secInicialNotaVenta',    label: 'Nota de Venta' },
              ].map(({ campo, label }) => (
                <div key={campo} className="sri-field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 13 }}>{label}</label>
                  <input
                    type="number"
                    name={campo}
                    min="0"
                    value={puntoForm[campo]}
                    onChange={handlePuntoChange}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: '12px 20px', borderTop: '1px solid #e5e7eb',
            display: 'flex', gap: 10, justifyContent: 'flex-end',
            background: '#f8fafc',
          }}>
            <button className="btn-secondary" onClick={() => setShowModalPunto(false)}>
              Cancelar
            </button>
            <button className="btn-primary" onClick={guardarPunto} disabled={savingPunto}>
              {savingPunto ? 'Guardando…' : '💾 Guardar'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default ConfiguracionSRI;
