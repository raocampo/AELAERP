// ====================================
// FORMULARIO: NUEVA RETENCION
// frontend/src/components/Facturacion/FormRetencion.jsx
// ====================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { normalizarPeriodoMMYYYY, periodoActualMMYYYY } from '../../utils/periodo';
import './FormRetencion.css';

const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function fmtFechaInput(valor) {
  if (!valor) return hoy();
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return hoy();
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function fmtFecha(valor) {
  if (!valor) return 'Sin fecha';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return 'Sin fecha';
  return fecha.toLocaleDateString('es-EC');
}

function fmtMoneda(valor) {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Number(valor || 0));
}

function etiquetaEstado(estado) {
  const mapa = {
    PENDIENTE_FIRMA: 'Pendiente firma',
    ENVIADO: 'Enviado',
    AUTORIZADO: 'Autorizado',
    RECHAZADO: 'Rechazado',
    ERROR: 'Error',
    ANULADO: 'Anulado',
    FIRMADO_PENDIENTE_ENVIO: 'Pendiente envio',
  };
  return mapa[estado] || estado;
}

function compraLabel(compra) {
  const numero = compra?.numeroDocSustento || compra?.numeroFactura || '';
  const proveedor = compra?.razonSocialProveedor || '';
  return [numero, proveedor].filter(Boolean).join(' · ');
}

export default function FormRetencion() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [catalogos, setCatalogos] = useState({ renta: [], iva: [], tiposDocSustento: [], tiposIdentificacion: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState(null);
  const [compraBusqueda, setCompraBusqueda] = useState('');
  const [comprasSugeridas, setComprasSugeridas] = useState([]);
  const [buscandoCompra, setBuscandoCompra] = useState(false);
  const [cargandoCompra, setCargandoCompra] = useState(false);
  const [compraSeleccionada, setCompraSeleccionada] = useState(null);

  const [form, setForm] = useState({
    periodoFiscal: periodoActualMMYYYY(),
    tipoIdentificacionProveedor: '04',
    identificacionProveedor: '',
    razonSocialProveedor: '',
    tipoDocSustento: '01',
    numeroDocSustento: '',
    fechaEmisionDocSustento: hoy(),
    observaciones: '',
  });

  const [impuestos, setImpuestos] = useState([
    {
      tipo: 'renta',
      codigo: '1',
      codigoPorcentaje: '303',
      descripcion: 'Honorarios profesionales',
      porcentajeRetener: 8,
      baseImponible: '',
      valorRetenido: '',
    },
  ]);

  useEffect(() => {
    api.get('/retenciones/catalogos/impuestos')
      .then((r) => setCatalogos(r.data.data))
      .catch(() => setError('No se pudieron cargar los catálogos de retención'));
  }, []);

  const aplicarCompraSeleccionada = useCallback((compra, actualizarUrl = true) => {
    setCompraSeleccionada(compra);
    setCompraBusqueda(compraLabel(compra));
    setComprasSugeridas([]);
    setError('');
    setForm((prev) => ({
      ...prev,
      tipoIdentificacionProveedor: compra.tipoIdentificacionProveedor || prev.tipoIdentificacionProveedor,
      identificacionProveedor: compra.identificacionProveedor || prev.identificacionProveedor,
      razonSocialProveedor: compra.razonSocialProveedor || prev.razonSocialProveedor,
      tipoDocSustento: compra.tipoDocSustento || '01',
      numeroDocSustento: compra.numeroDocSustento || prev.numeroDocSustento,
      fechaEmisionDocSustento: fmtFechaInput(compra.fechaEmisionDocSustento),
    }));

    if (actualizarUrl) {
      setSearchParams({ compraId: String(compra.id) });
    }
  }, [setSearchParams]);

  const compraIdParam = searchParams.get('compraId');

  useEffect(() => {
    if (!compraIdParam) return;
    if (String(compraSeleccionada?.id) === compraIdParam) return;

    let ignore = false;
    const cargarCompra = async () => {
      setCargandoCompra(true);
      try {
        const { data } = await api.get(`/retenciones/compras/${compraIdParam}/preload`);
        if (!ignore) aplicarCompraSeleccionada(data.data, false);
      } catch (err) {
        if (!ignore) {
          setError(err.response?.data?.error || 'No se pudo cargar la compra seleccionada');
          setSearchParams({});
        }
      } finally {
        if (!ignore) setCargandoCompra(false);
      }
    };

    cargarCompra();
    return () => { ignore = true; };
  }, [aplicarCompraSeleccionada, compraIdParam, compraSeleccionada?.id, setSearchParams]);

  useEffect(() => {
    let ignore = false;
    const termino = compraBusqueda.trim();
    if (compraSeleccionada && termino === compraLabel(compraSeleccionada)) {
      setComprasSugeridas([]);
      return undefined;
    }
    if (termino.length < 2) {
      setComprasSugeridas([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setBuscandoCompra(true);
      try {
        const { data } = await api.get('/retenciones/compras/buscar', { params: { q: termino } });
        if (!ignore) setComprasSugeridas(data.data || []);
      } catch {
        if (!ignore) setComprasSugeridas([]);
      } finally {
        if (!ignore) setBuscandoCompra(false);
      }
    }, 250);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [compraBusqueda, compraSeleccionada]);

  const handleForm = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const calcValor = (base, pct) => {
    const b = parseFloat(base) || 0;
    const p = parseFloat(pct) || 0;
    return b > 0 ? (b * p / 100).toFixed(2) : '';
  };

  const limpiarCompraSeleccionada = () => {
    setCompraSeleccionada(null);
    setCompraBusqueda('');
    setComprasSugeridas([]);
    setSearchParams({});
  };

  const cargarCompraDesdeSugerencia = async (compraId) => {
    setCargandoCompra(true);
    setError('');
    try {
      const { data } = await api.get(`/retenciones/compras/${compraId}/preload`);
      aplicarCompraSeleccionada(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo precargar la compra');
    } finally {
      setCargandoCompra(false);
    }
  };

  const agregarImpuesto = () => {
    setImpuestos((prev) => [...prev, {
      tipo: 'renta',
      codigo: '1',
      codigoPorcentaje: '303',
      descripcion: 'Honorarios profesionales',
      porcentajeRetener: 8,
      baseImponible: '',
      valorRetenido: '',
    }]);
  };

  const eliminarImpuesto = (idx) => {
    setImpuestos((prev) => prev.filter((_, i) => i !== idx));
  };

  const cambiarTipo = (idx, tipo) => {
    const lista = tipo === 'renta' ? catalogos.renta : catalogos.iva;
    const primero = lista[0] || {};
    setImpuestos((prev) => prev.map((imp, i) => (i !== idx ? imp : {
      ...imp,
      tipo,
      codigo: tipo === 'renta' ? '1' : '2',
      codigoPorcentaje: primero.codigoPorcentaje || '',
      descripcion: primero.descripcion || '',
      porcentajeRetener: primero.porcentaje || 0,
      baseImponible: imp.baseImponible,
      valorRetenido: calcValor(imp.baseImponible, primero.porcentaje || 0),
    })));
  };

  const cambiarCodigo = (idx, codigoPorcentaje) => {
    setImpuestos((prev) => prev.map((imp, i) => {
      if (i !== idx) return imp;
      const lista = imp.tipo === 'renta' ? catalogos.renta : catalogos.iva;
      const item = lista.find((l) => l.codigoPorcentaje === codigoPorcentaje) || {};
      const pct = item.porcentaje || imp.porcentajeRetener;
      return {
        ...imp,
        codigoPorcentaje,
        descripcion: item.descripcion || imp.descripcion,
        porcentajeRetener: pct,
        valorRetenido: calcValor(imp.baseImponible, pct),
      };
    }));
  };

  const cambiarBase = (idx, base) => {
    setImpuestos((prev) => prev.map((imp, i) => (i !== idx ? imp : {
      ...imp,
      baseImponible: base,
      valorRetenido: calcValor(base, imp.porcentajeRetener),
    })));
  };

  const cambiarPct = (idx, pct) => {
    setImpuestos((prev) => prev.map((imp, i) => (i !== idx ? imp : {
      ...imp,
      porcentajeRetener: pct,
      valorRetenido: calcValor(imp.baseImponible, pct),
    })));
  };

  const totalRetenido = impuestos.reduce((s, i) => s + (parseFloat(i.valorRetenido) || 0), 0);
  const compraVinculada = Boolean(compraSeleccionada?.id);
  const retenidoCompraActual = Number(compraSeleccionada?.retencionIVA || 0) + Number(compraSeleccionada?.retencionRenta || 0);

  const guardar = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.identificacionProveedor.trim()) {
      return setError('Identificación del proveedor es requerida');
    }
    if (!form.razonSocialProveedor.trim()) {
      return setError('Razón social del proveedor es requerida');
    }
    if (!form.numeroDocSustento.trim()) {
      return setError('Número del documento sustento es requerido');
    }
    const periodoFiscal = normalizarPeriodoMMYYYY(form.periodoFiscal);
    if (!periodoFiscal) {
      return setError('Período fiscal inválido. Use MM/YYYY, por ejemplo 03/2026');
    }
    if (impuestos.length === 0) {
      return setError('Ingrese al menos un impuesto retenido');
    }
    if (impuestos.some((i) => !i.baseImponible || parseFloat(i.baseImponible) <= 0)) {
      return setError('La base imponible debe ser mayor a 0 en todos los impuestos');
    }

    setLoading(true);
    try {
      const payload = {
        ...form,
        compraId: compraSeleccionada?.id || null,
        periodoFiscal,
        impuestos: impuestos.map((i) => ({
          codigo: i.codigo,
          codigoPorcentaje: i.codigoPorcentaje,
          baseImponible: parseFloat(i.baseImponible),
          porcentajeRetener: parseFloat(i.porcentajeRetener),
          valorRetenido: parseFloat(i.valorRetenido),
        })),
      };

      const { data } = await api.post('/retenciones', payload);
      setGuardado(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al emitir la retención');
    } finally {
      setLoading(false);
    }
  };

  if (guardado) {
    const descargarPDF = async () => {
      try {
        const resp = await api.get(`/retenciones/${guardado.id}/pdf`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' }));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `retencion-${guardado.numeroRetencion}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (err) {
        alert(`Error: ${err.message}`);
      }
    };

    return (
      <div className="ret-form-container">
        <div className="ret-exito">
          <div className="ret-exito-icono">✅</div>
          <h2>Retención Emitida</h2>
          <p className="ret-exito-num">Nro. {guardado.numeroRetencion}</p>
          <p>Proveedor: <strong>{guardado.razonSocialProveedor}</strong></p>
          <p>Total retenido: <strong>{fmtMoneda(guardado.totalRetenido)}</strong></p>
          <div className={`ret-badge badge-${guardado.estadoSri === 'AUTORIZADO' ? 'success' : 'warning'} ret-badge-lg`}>
            {guardado.estadoSri}
          </div>
          <div className="ret-exito-acciones">
            <button className="btn-exito-pdf" onClick={descargarPDF}>Descargar RIDE PDF</button>
            <button className="btn-exito-lista" onClick={() => navigate('/retenciones')}>Ver Lista</button>
            <button className="btn-exito-nueva" onClick={() => {
              setGuardado(null);
              limpiarCompraSeleccionada();
            }}
            >
              Nueva Retención
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ret-form-container">
      <div className="ret-form-header">
        <button className="btn-back-ret" onClick={() => navigate('/retenciones')}>← Volver</button>
        <h1>Nueva Retención</h1>
        <p>Comprobante de Retención electrónico — tipo 07</p>
      </div>

      {error && <div className="ret-form-error">{error}</div>}

      <form onSubmit={guardar} className="ret-form">
        <div className="ret-seccion">
          <div className="ret-seccion-header">
            <div>
              <h3 className="ret-seccion-titulo">Compra Relacionada (opcional)</h3>
              <p className="ret-seccion-desc">
                Busca una compra para precargar proveedor y documento sustento. Si la vinculas, la compra acumulará automáticamente sus retenciones.
              </p>
            </div>
            {compraVinculada && (
              <button type="button" className="btn-ret-link" onClick={() => navigate(`/compras/${compraSeleccionada.id}`)}>
                Ver compra
              </button>
            )}
          </div>

          <div className="ret-compra-search">
            <input
              type="text"
              value={compraBusqueda}
              onChange={(e) => setCompraBusqueda(e.target.value)}
              placeholder="Buscar por proveedor, RUC o número de factura"
              className="ret-input-form"
            />
            {compraVinculada ? (
              <button type="button" className="btn-clear-compra" onClick={limpiarCompraSeleccionada}>
                Desvincular
              </button>
            ) : (
              <button type="button" className="btn-ret-link" onClick={() => navigate('/compras')}>
                Ir a compras
              </button>
            )}
          </div>

          {(buscandoCompra || cargandoCompra) && (
            <div className="ret-compra-helper">
              {cargandoCompra ? 'Cargando compra seleccionada...' : 'Buscando compras...'}
            </div>
          )}

          {comprasSugeridas.length > 0 && (
            <div className="ret-compra-results">
              {comprasSugeridas.map((compra) => (
                <button
                  key={compra.id}
                  type="button"
                  className="ret-compra-option"
                  onClick={() => cargarCompraDesdeSugerencia(compra.id)}
                >
                  <div>
                    <strong>{compra.numeroFactura}</strong>
                    <span>{compra.razonSocialProveedor} · {compra.identificacionProveedor}</span>
                  </div>
                  <div className="ret-compra-option-meta">
                    <span>{fmtFecha(compra.fechaEmision)}</span>
                    <strong>{fmtMoneda(compra.importeTotal)}</strong>
                  </div>
                </button>
              ))}
            </div>
          )}

          {compraSeleccionada && (
            <div className="ret-compra-card">
              <div className="ret-compra-card-grid">
                <div>
                  <span>Documento sustento</span>
                  <strong>{compraSeleccionada.numeroDocSustento}</strong>
                </div>
                <div>
                  <span>Fecha compra</span>
                  <strong>{fmtFecha(compraSeleccionada.fechaEmisionDocSustento)}</strong>
                </div>
                <div>
                  <span>Proveedor</span>
                  <strong>{compraSeleccionada.razonSocialProveedor}</strong>
                </div>
                <div>
                  <span>Identificación</span>
                  <strong>{compraSeleccionada.identificacionProveedor}</strong>
                </div>
                <div>
                  <span>Total compra</span>
                  <strong>{fmtMoneda(compraSeleccionada.importeTotal)}</strong>
                </div>
                <div>
                  <span>IVA compra</span>
                  <strong>{fmtMoneda(compraSeleccionada.totalIva)}</strong>
                </div>
                <div>
                  <span>Renta ya retenida</span>
                  <strong>{fmtMoneda(compraSeleccionada.retencionRenta)}</strong>
                </div>
                <div>
                  <span>IVA ya retenido</span>
                  <strong>{fmtMoneda(compraSeleccionada.retencionIVA)}</strong>
                </div>
              </div>

              {retenidoCompraActual > 0 && (
                <div className="ret-compra-warning">
                  Esta compra ya tiene {fmtMoneda(retenidoCompraActual)} en retenciones registradas. Revisa si corresponde emitir otra.
                </div>
              )}

              {compraSeleccionada.retenciones?.length > 0 && (
                <div className="ret-compra-linked-list">
                  <span>Retenciones vinculadas</span>
                  {compraSeleccionada.retenciones.map((ret) => (
                    <div key={ret.id} className="ret-compra-linked-item">
                      <div>
                        <strong>{ret.numeroRetencion}</strong>
                        <p>{fmtFecha(ret.fechaEmision)} · {fmtMoneda(ret.totalRetenido)}</p>
                      </div>
                      <span className={`ret-mini-badge estado-${String(ret.estadoSri || '').toLowerCase()}`}>
                        {etiquetaEstado(ret.estadoSri)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ret-seccion">
          <h3 className="ret-seccion-titulo">Documento Sustento</h3>
          <div className="ret-grid-3">
            <div className="ret-campo">
              <label>Período Fiscal <span className="req">*</span></label>
              <input
                type="text"
                name="periodoFiscal"
                value={form.periodoFiscal}
                onChange={handleForm}
                onBlur={() => {
                  const normalizado = normalizarPeriodoMMYYYY(form.periodoFiscal);
                  if (normalizado) {
                    setForm((prev) => ({ ...prev, periodoFiscal: normalizado }));
                  }
                }}
                placeholder="MM/YYYY"
                className="ret-input-form"
              />
              <small>Formato: 01/2026</small>
            </div>
            <div className="ret-campo">
              <label>Tipo Documento Sustento <span className="req">*</span></label>
              <select
                name="tipoDocSustento"
                value={form.tipoDocSustento}
                onChange={handleForm}
                className="ret-input-form"
                disabled={compraVinculada}
              >
                {catalogos.tiposDocSustento.map((t) => (
                  <option key={t.codigo} value={t.codigo}>{t.codigo} — {t.descripcion}</option>
                ))}
              </select>
            </div>
            <div className="ret-campo">
              <label>Nro. Documento Sustento <span className="req">*</span></label>
              <input
                type="text"
                name="numeroDocSustento"
                value={form.numeroDocSustento}
                onChange={handleForm}
                placeholder="001-001-000000001"
                className="ret-input-form"
                disabled={compraVinculada}
              />
            </div>
            <div className="ret-campo">
              <label>Fecha Emisión Doc. Sustento <span className="req">*</span></label>
              <input
                type="date"
                name="fechaEmisionDocSustento"
                value={form.fechaEmisionDocSustento}
                onChange={handleForm}
                className="ret-input-form"
                disabled={compraVinculada}
              />
            </div>
          </div>
          {compraVinculada && (
            <div className="ret-compra-helper">
              Los datos del documento sustento se están usando desde la compra vinculada.
            </div>
          )}
        </div>

        <div className="ret-seccion">
          <h3 className="ret-seccion-titulo">Sujeto Retenido (Proveedor)</h3>
          <div className="ret-grid-3">
            <div className="ret-campo">
              <label>Tipo Identificación <span className="req">*</span></label>
              <select
                name="tipoIdentificacionProveedor"
                value={form.tipoIdentificacionProveedor}
                onChange={handleForm}
                className="ret-input-form"
                disabled={compraVinculada}
              >
                {catalogos.tiposIdentificacion.map((t) => (
                  <option key={t.codigo} value={t.codigo}>{t.codigo} — {t.descripcion}</option>
                ))}
              </select>
            </div>
            <div className="ret-campo">
              <label>Identificación (RUC/Cédula) <span className="req">*</span></label>
              <input
                type="text"
                name="identificacionProveedor"
                value={form.identificacionProveedor}
                onChange={handleForm}
                placeholder="Ej: 1234567890001"
                className="ret-input-form"
                disabled={compraVinculada}
              />
            </div>
            <div className="ret-campo ret-campo-wide">
              <label>Razón Social <span className="req">*</span></label>
              <input
                type="text"
                name="razonSocialProveedor"
                value={form.razonSocialProveedor}
                onChange={handleForm}
                placeholder="Nombre completo / Razón social"
                className="ret-input-form"
                disabled={compraVinculada}
              />
            </div>
          </div>
          {compraVinculada && (
            <div className="ret-compra-helper">
              El proveedor se está tomando desde la compra vinculada para evitar inconsistencias.
            </div>
          )}
        </div>

        <div className="ret-seccion">
          <div className="ret-seccion-header">
            <h3 className="ret-seccion-titulo">Impuestos Retenidos</h3>
            <button type="button" className="btn-add-impuesto" onClick={agregarImpuesto}>
              + Agregar Impuesto
            </button>
          </div>

          {impuestos.length === 0 && (
            <div className="ret-empty-imp">Agregue al menos un impuesto retenido.</div>
          )}

          {impuestos.map((imp, idx) => (
            <div key={idx} className="ret-impuesto-fila">
              <div className="ret-impuesto-num">#{idx + 1}</div>

              <div className="ret-campo ret-campo-tipo">
                <label>Tipo</label>
                <div className="ret-tipo-btns">
                  <button
                    type="button"
                    className={`btn-tipo ${imp.tipo === 'renta' ? 'activo' : ''}`}
                    onClick={() => cambiarTipo(idx, 'renta')}
                  >
                    Renta (IR)
                  </button>
                  <button
                    type="button"
                    className={`btn-tipo ${imp.tipo === 'iva' ? 'activo' : ''}`}
                    onClick={() => cambiarTipo(idx, 'iva')}
                  >
                    IVA
                  </button>
                </div>
              </div>

              <div className="ret-campo ret-campo-cod">
                <label>Concepto</label>
                <select
                  value={imp.codigoPorcentaje}
                  onChange={(e) => cambiarCodigo(idx, e.target.value)}
                  className="ret-input-form"
                >
                  {(imp.tipo === 'renta' ? catalogos.renta : catalogos.iva).map((c) => (
                    <option key={c.codigoPorcentaje} value={c.codigoPorcentaje}>
                      {c.codigoPorcentaje} — {c.descripcion}
                    </option>
                  ))}
                </select>
              </div>

              <div className="ret-campo ret-campo-pct">
                <label>% Retención</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={imp.porcentajeRetener}
                  onChange={(e) => cambiarPct(idx, e.target.value)}
                  className="ret-input-form ret-input-num"
                />
              </div>

              <div className="ret-campo ret-campo-base">
                <label>Base Imponible ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={imp.baseImponible}
                  onChange={(e) => cambiarBase(idx, e.target.value)}
                  className="ret-input-form ret-input-num"
                  placeholder="0.00"
                />
              </div>

              <div className="ret-campo ret-campo-valor">
                <label>Valor Retenido ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={imp.valorRetenido}
                  onChange={(e) => setImpuestos((prev) => prev.map((im, i) => (i !== idx ? im : { ...im, valorRetenido: e.target.value })))}
                  className="ret-input-form ret-input-num ret-valor-calc"
                  placeholder="0.00"
                />
              </div>

              {impuestos.length > 1 && (
                <button type="button" className="btn-del-impuesto" onClick={() => eliminarImpuesto(idx)}>✕</button>
              )}
            </div>
          ))}

          <div className="ret-total-box">
            <span>TOTAL RETENIDO:</span>
            <strong>{fmtMoneda(totalRetenido)}</strong>
          </div>
        </div>

        <div className="ret-seccion">
          <div className="ret-campo">
            <label>Observaciones (opcional)</label>
            <textarea
              name="observaciones"
              value={form.observaciones}
              onChange={handleForm}
              rows={2}
              className="ret-textarea-form"
              placeholder="Información adicional..."
            />
          </div>
        </div>

        <div className="ret-form-acciones">
          <button type="button" className="btn-cancelar-ret" onClick={() => navigate('/retenciones')}>
            Cancelar
          </button>
          <button type="submit" className="btn-emitir-ret" disabled={loading || cargandoCompra}>
            {loading ? 'Emitiendo...' : 'Emitir Retención'}
          </button>
        </div>
      </form>
    </div>
  );
}
