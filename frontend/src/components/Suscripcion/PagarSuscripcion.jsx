// ====================================
// PAGAR SUSCRIPCIÓN — AELA ERP
// Permite al cliente renovar o actualizar su plan directamente desde la app.
// ====================================

import { useState, useEffect } from 'react';
import api from '../../services/api';
import './PagarSuscripcion.css';

const PLAN_LABELS = { lite: 'Lite', medium: 'Medium', pro: 'Pro' };

export default function PagarSuscripcion() {
  const [info, setInfo]         = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError]       = useState('');
  const [paso, setPaso]         = useState('seleccionar'); // seleccionar | pago-forma | confirmado
  const [planSel, setPlanSel]   = useState(null);
  const [periodoSel, setPeriodoSel] = useState('mensual');
  const [formaSel, setFormaSel] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  // Formulario transferencia
  const [refTransf, setRefTransf] = useState('');

  useEffect(() => {
    api.get('/suscripcion-pago/info')
      .then(r => { setInfo(r.data.data); setPlanSel(r.data.data.planActual !== 'lite' ? r.data.data.planActual : 'medium'); })
      .catch(e => setError(e.response?.data?.mensaje || 'Error al cargar info de suscripción'))
      .finally(() => setCargando(false));
  }, []);

  const precioActual = info?.precios?.[planSel]?.[periodoSel] || 0;
  const descuentoAnual = planSel && info
    ? ((info.precios[planSel]?.mensual || 0) * 12 - (info.precios[planSel]?.anual || 0))
    : 0;

  const iniciarPago = async () => {
    if (!formaSel) return;
    setEnviando(true);
    try {
      if (formaSel === 'transferencia') {
        if (!refTransf.trim()) { alert('Ingresa el número de comprobante de la transferencia'); setEnviando(false); return; }
        const r = await api.post('/suscripcion-pago/transferencia', { plan: planSel, periodo: periodoSel, referencia: refTransf, monto: precioActual });
        setResultado({ tipo: 'transferencia', mensaje: r.data.mensaje });
        setPaso('confirmado');
      } else if (formaSel === 'payphone') {
        const r = await api.post('/suscripcion-pago/payphone', { plan: planSel, periodo: periodoSel });
        const { checkoutUrl, payphoneAppUrl } = r.data.data;
        if (checkoutUrl) window.location.href = checkoutUrl;
        else if (payphoneAppUrl) window.location.href = payphoneAppUrl;
      }
    } catch (e) {
      alert(e.response?.data?.mensaje || 'Error al procesar el pago');
    } finally {
      setEnviando(false);
    }
  };

  if (cargando) return <div className="suscr-loading">Cargando información…</div>;
  if (error)    return <div className="suscr-error">{error}</div>;

  return (
    <div className="suscr-wrapper">
      <div className="suscr-header">
        <h1>Suscripción y Pagos</h1>
        <p>Gestiona tu plan y forma de pago</p>
      </div>

      {/* Estado actual */}
      <div className="suscr-estado-card">
        <div className="suscr-estado-row">
          <div>
            <span className="suscr-label">Plan actual</span>
            <span className={`suscr-plan-badge suscr-plan--${info.planActual}`}>
              {PLAN_LABELS[info.planActual] || info.planActual}
            </span>
            {info.esTrial && <span className="suscr-trial-tag">Trial</span>}
          </div>
          <div>
            <span className="suscr-label">Estado</span>
            <span className={`suscr-estado-badge suscr-estado--${info.estado}`}>{info.estado}</span>
          </div>
          {info.fechaVencimiento && (
            <div>
              <span className="suscr-label">Vence el</span>
              <strong>{new Date(info.fechaVencimiento).toLocaleDateString('es-EC')}</strong>
            </div>
          )}
          {info.esTrial && info.trialExpiresAt && (
            <div>
              <span className="suscr-label">Trial expira</span>
              <strong>{new Date(info.trialExpiresAt).toLocaleDateString('es-EC')}</strong>
            </div>
          )}
        </div>
      </div>

      {paso === 'confirmado' ? (
        <div className="suscr-confirmado">
          <div className="suscr-ok-icon">✅</div>
          <h2>¡Solicitud registrada!</h2>
          <p>{resultado?.mensaje}</p>
          <button className="btn-primary" onClick={() => { setPaso('seleccionar'); setRefTransf(''); setResultado(null); }}>
            Volver
          </button>
        </div>
      ) : paso === 'seleccionar' ? (
        <>
          {/* Selector de plan */}
          <div className="suscr-section">
            <h2>1. Elige tu plan</h2>
            <div className="suscr-planes">
              {['medium', 'pro'].map(p => (
                <button
                  key={p}
                  className={`suscr-plan-card ${planSel === p ? 'suscr-plan-card--selected' : ''}`}
                  onClick={() => setPlanSel(p)}
                >
                  <div className="suscr-plan-nombre">{PLAN_LABELS[p]}</div>
                  <div className="suscr-plan-precio">
                    ${info.precios[p]?.mensual || 0}<span>/mes</span>
                  </div>
                  {p === 'medium' && <div className="suscr-plan-desc">Hasta 5 usuarios · Módulos base</div>}
                  {p === 'pro'    && <div className="suscr-plan-desc">Usuarios ilimitados · Todos los módulos</div>}
                </button>
              ))}
            </div>
          </div>

          {/* Período */}
          <div className="suscr-section">
            <h2>2. Período de facturación</h2>
            <div className="suscr-periodo-toggle">
              <button
                className={periodoSel === 'mensual' ? 'active' : ''}
                onClick={() => setPeriodoSel('mensual')}
              >Mensual</button>
              <button
                className={periodoSel === 'anual' ? 'active' : ''}
                onClick={() => setPeriodoSel('anual')}
              >
                Anual
                {descuentoAnual > 0 && <span className="suscr-descuento-tag">Ahorra ${descuentoAnual}</span>}
              </button>
            </div>
            {planSel && (
              <div className="suscr-precio-total">
                Total: <strong>${precioActual} USD</strong>
                {periodoSel === 'anual' && <span className="suscr-precio-hint"> / año (${(precioActual / 12).toFixed(2)}/mes)</span>}
              </div>
            )}
          </div>

          <button
            className="btn-primary suscr-btn-siguiente"
            onClick={() => setPaso('pago-forma')}
            disabled={!planSel || precioActual === 0}
          >
            Continuar con el pago →
          </button>

          {precioActual === 0 && planSel && (
            <p className="suscr-hint">El plan seleccionado no tiene costo. Contacta a soporte para activarlo.</p>
          )}
        </>
      ) : (
        /* Paso 2: Forma de pago */
        <>
          <div className="suscr-resumen-pago">
            <strong>{PLAN_LABELS[planSel]}</strong> — {periodoSel} — <strong>${precioActual} USD</strong>
            <button className="suscr-cambiar-plan" onClick={() => setPaso('seleccionar')}>Cambiar</button>
          </div>

          <div className="suscr-section">
            <h2>3. Forma de pago</h2>
            <div className="suscr-formas">
              {info.pagosDisponibles.map(fp => (
                <button
                  key={fp.id}
                  className={`suscr-forma-card ${formaSel === fp.id ? 'suscr-forma-card--selected' : ''}`}
                  onClick={() => setFormaSel(fp.id)}
                >
                  <span className="suscr-forma-icono">{fp.icono}</span>
                  <div>
                    <div className="suscr-forma-label">{fp.label}</div>
                    <div className="suscr-forma-desc">{fp.descripcion}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Datos según forma de pago */}
          {formaSel === 'transferencia' && (
            <div className="suscr-section suscr-transferencia-info">
              <h3>Datos para la transferencia</h3>
              {info.cuentasBancarias.map((cb, i) => (
                <div key={i} className="suscr-cuenta-bancaria">
                  <div><span>Banco:</span> <strong>{cb.banco}</strong></div>
                  <div><span>Tipo:</span> {cb.tipo}</div>
                  <div><span>Número:</span> <strong>{cb.numero}</strong></div>
                  <div><span>Titular:</span> {cb.titular}</div>
                  {cb.ruc && <div><span>RUC:</span> {cb.ruc}</div>}
                </div>
              ))}
              <p className="suscr-instr">
                Realiza la transferencia por <strong>${precioActual} USD</strong> e ingresa el número de comprobante:
              </p>
              <input
                type="text"
                className="suscr-input"
                placeholder="Ej: 12345678 o referencia del comprobante"
                value={refTransf}
                onChange={e => setRefTransf(e.target.value)}
              />
            </div>
          )}

          {formaSel === 'payphone' && (
            <div className="suscr-section">
              <p className="suscr-instr">
                Serás redirigido al checkout de PayPhone para pagar con tarjeta o la app PayPhone.
                El pago se confirma automáticamente.
              </p>
            </div>
          )}

          {formaSel === 'stripe' && (
            <div className="suscr-section">
              <p className="suscr-instr">
                Próximamente disponible. Por ahora usa transferencia bancaria o PayPhone.
              </p>
            </div>
          )}

          {formaSel === 'paypal' && (
            <div className="suscr-section">
              <p className="suscr-instr">
                Próximamente disponible. Por ahora usa transferencia bancaria o PayPhone.
              </p>
            </div>
          )}

          <div className="suscr-footer-btns">
            <button className="btn-secondary" onClick={() => setPaso('seleccionar')}>← Atrás</button>
            <button
              className="btn-primary"
              onClick={iniciarPago}
              disabled={!formaSel || enviando || ['stripe','paypal'].includes(formaSel)}
            >
              {enviando ? 'Procesando…' : formaSel === 'transferencia' ? 'Registrar pago' : formaSel === 'payphone' ? 'Ir a PayPhone' : 'Pagar'}
            </button>
          </div>
        </>
      )}

      {/* Historial */}
      <SolicitudesRecientes />
    </div>
  );
}

function SolicitudesRecientes() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api.get('/suscripcion-pago/mis-solicitudes')
      .then(r => setSolicitudes(r.data.data || []))
      .catch(() => {})
      .finally(() => setCargando(false));
  }, []);

  if (cargando || !solicitudes.length) return null;

  return (
    <div className="suscr-section suscr-historial">
      <h2>Historial de pagos</h2>
      <table className="suscr-tabla">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Plan</th>
            <th>Período</th>
            <th>Monto</th>
            <th>Forma</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {solicitudes.map(s => (
            <tr key={s.id}>
              <td>{new Date(s.createdAt).toLocaleDateString('es-EC')}</td>
              <td>{PLAN_LABELS[s.plan] || s.plan}</td>
              <td>{s.periodo}</td>
              <td>${s.monto}</td>
              <td>{s.proveedor}</td>
              <td>
                <span className={`suscr-estado-badge suscr-estado--${s.estado}`}>{s.estado}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
