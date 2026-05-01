// ====================================
// COMPONENTE: DETALLE DE NOTA DE VENTA
// frontend/src/components/NotasVenta/DetalleNotaVenta.jsx
// RIDE PDF + Recibo POS para RIMPE Negocio Popular
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import api from '../../services/api';
import toast from 'react-hot-toast';

const DetalleNotaVenta = () => {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const [nota,       setNota]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [anulando,   setAnulando]   = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/notas-venta/${id}`);
      setNota(res.data.data || res.data);
    } catch {
      toast.error('No se pudo cargar la nota de venta');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  // ─── Abrir PDF en nueva pestaña ─────────────────────────────────────────────
  const abrirDocumento = async (endpoint, nombreArchivo) => {
    try {
      const token = localStorage.getItem('aela_token') || localStorage.getItem('token');
      const base  = (import.meta.env.VITE_API_URL || 'http://localhost:5600/api').replace(/\/api$/, '');
      const res   = await fetch(`${base}/api${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast.error('No se pudo generar el documento'); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.target   = '_blank';
      a.rel      = 'noopener noreferrer';
      if (nombreArchivo) a.download = nombreArchivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.error('Error al abrir el documento');
    }
  };

  const verRIDE   = () => abrirDocumento(`/notas-venta/${id}/pdf`);
  const verRecibo = () => abrirDocumento(`/notas-venta/${id}/recibo`);

  // ─── Anular ─────────────────────────────────────────────────────────────────
  const anular = async () => {
    const motivo = window.prompt('Ingrese el motivo de anulación:');
    if (!motivo?.trim()) return;
    setAnulando(true);
    try {
      await api.put(`/notas-venta/${id}/anular`, { motivo });
      toast.success('Nota de venta anulada');
      cargar();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al anular');
    } finally {
      setAnulando(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        Cargando nota de venta...
      </div>
    );
  }

  if (!nota) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>❌</div>
        <p>Nota de venta no encontrada</p>
        <button className="btn btn-secondary" onClick={() => navigate('/notas-venta')}>
          ← Volver a la lista
        </button>
      </div>
    );
  }

  const detalles = typeof nota.detalles === 'string' ? JSON.parse(nota.detalles) : (nota.detalles || []);
  const subtotal = parseFloat(nota.subtotal       || 0);
  const totDesc  = parseFloat(nota.totalDescuento || 0);
  const total    = parseFloat(nota.total          || 0);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px 40px' }}>

      {/* ── Barra superior ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingTop: 8 }}>
        <button
          className="btn btn-secondary"
          style={{ fontSize: 13 }}
          onClick={() => navigate('/notas-venta')}
        >
          ← Volver
        </button>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={verRIDE}>
            📄 PDF RIDE
          </button>
          <button className="btn btn-secondary" onClick={verRecibo}>
            🖨️ Recibo POS
          </button>
          {!nota.anulada && (
            <button
              className="btn btn-danger"
              onClick={anular}
              disabled={anulando}
              style={{ background: '#dc2626', color: '#fff', border: 'none' }}
            >
              {anulando ? '...' : '🚫 Anular'}
            </button>
          )}
        </div>
      </div>

      {/* ── Cabecera del documento ──────────────────────────────────────────── */}
      <div style={{
        background: nota.anulada ? '#fff5f5' : '#ffffff',
        border: `1px solid ${nota.anulada ? '#fca5a5' : '#e2e8f0'}`,
        borderRadius: 12,
        padding: 24,
        marginBottom: 20,
        boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
      }}>
        {/* RIMPE badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{
              display: 'inline-block',
              background: '#1B3A6B', color: '#fff',
              fontSize: 10, fontWeight: 700,
              padding: '3px 10px', borderRadius: 6, marginBottom: 8,
              letterSpacing: 0.5,
            }}>
              CONTRIBUYENTE NEGOCIO POPULAR — RÉGIMEN RIMPE
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1a1a2e' }}>
              🗒️ NOTA DE VENTA
            </h1>
            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginTop: 4 }}>
              No. {nota.numeroNota}
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{
              display: 'inline-block',
              padding: '5px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: nota.anulada ? '#FFEBEE' : '#E8F5E9',
              color:      nota.anulada ? '#C62828' : '#2E7D32',
            }}>
              {nota.anulada ? '🚫 ANULADA' : '✅ EMITIDA'}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
              {nota.fechaEmision
                ? format(new Date(nota.fechaEmision), "dd 'de' MMMM yyyy", { locale: es })
                : '—'}
            </div>
          </div>
        </div>

        {/* Datos emisor y receptor */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Emisor
            </div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{nota.razonSocialEmisor || '—'}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>RUC: {nota.rucEmisor || '—'}</div>
          </div>

          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Cliente
            </div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{nota.razonSocial || 'Consumidor Final'}</div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
              {nota.tipoIdentificacion || 'CI/RUC'}: {nota.identificacion || '—'}
            </div>
            {nota.direccion && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{nota.direccion}</div>}
            {nota.email && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{nota.email}</div>}
          </div>
        </div>

        {nota.anulada && nota.motivoAnulacion && (
          <div style={{ background: '#FFF3E0', border: '1px solid #FFB74D', borderRadius: 8, padding: '10px 14px', marginTop: 14 }}>
            <span style={{ fontWeight: 700, color: '#E65100' }}>Motivo de anulación:</span>{' '}
            <span style={{ color: '#B45309' }}>{nota.motivoAnulacion}</span>
          </div>
        )}
      </div>

      {/* ── Tabla de detalles ───────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
        overflow: 'hidden', marginBottom: 20,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>📋 Detalle de productos / servicios</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1B3A6B', color: '#fff' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left',  fontWeight: 600, fontSize: 11 }}>Código</th>
              <th style={{ padding: '10px 14px', textAlign: 'left',  fontWeight: 600, fontSize: 11 }}>Descripción</th>
              <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>Cantidad</th>
              <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>P. Unitario</th>
              <th style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>Descuento</th>
              <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, fontSize: 11 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {detalles.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#aaa' }}>
                  Sin detalles
                </td>
              </tr>
            ) : detalles.map((d, i) => {
              const cant  = parseFloat(d.cantidad)       || 0;
              const prec  = parseFloat(d.precioUnitario) || 0;
              const desc  = parseFloat(d.descuento)      || 0;
              const tot   = cant * prec - desc;
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
                    {d.codigoPrincipal || '—'}
                  </td>
                  <td style={{ padding: '9px 14px' }}>{d.descripcion || '—'}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>{cant.toFixed(2)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right' }}>${prec.toFixed(2)}</td>
                  <td style={{ padding: '9px 10px', textAlign: 'right', color: desc > 0 ? '#dc2626' : '#ccc' }}>
                    {desc > 0 ? `-$${desc.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 600 }}>
                    ${tot.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Totales + Forma de pago ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

        {/* Forma de pago */}
        <div style={{
          flex: 1, minWidth: 240,
          background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
          padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💳 Forma de pago</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: '#555' }}>{nota.formaPago || 'Efectivo'}</span>
            <span style={{ fontWeight: 700 }}>${total.toFixed(2)}</span>
          </div>
          {nota.observaciones && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#666', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
              <span style={{ fontWeight: 600 }}>Obs.:</span> {nota.observaciones}
            </div>
          )}
        </div>

        {/* Totales */}
        <div style={{
          width: 240,
          background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
          overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}>
          {[
            { label: 'Subtotal',  value: subtotal, bold: false },
            { label: 'Descuento', value: totDesc,  bold: false },
          ].map(row => (
            <div key={row.label} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '9px 16px', fontSize: 13, borderBottom: '1px solid #f1f5f9',
            }}>
              <span style={{ color: '#666' }}>{row.label}</span>
              <span>${row.value.toFixed(2)}</span>
            </div>
          ))}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '12px 16px', fontSize: 16, fontWeight: 800,
            background: '#1B3A6B', color: '#fff',
          }}>
            <span>TOTAL</span>
            <span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* ── Aviso RIMPE ─────────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 20, padding: '10px 16px',
        background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 8,
        fontSize: 11, color: '#B45309', textAlign: 'center',
      }}>
        <strong>CONTRIBUYENTE NEGOCIO POPULAR — RÉGIMEN RIMPE</strong>
        {' · '}Este documento no es válido para crédito tributario de IVA
      </div>

    </div>
  );
};

export default DetalleNotaVenta;
