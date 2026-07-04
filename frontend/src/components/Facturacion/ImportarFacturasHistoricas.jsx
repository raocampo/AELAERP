// ====================================
// IMPORTAR FACTURAS HISTÓRICAS
// frontend/src/components/Facturacion/ImportarFacturasHistoricas.jsx
// ====================================

import { useRef, useState } from 'react';
import api from '../../services/api';
import './ImportarFacturasHistoricas.css';

const PASOS = ['Instrucciones', 'Cargar archivo', 'Vista previa', 'Resultado'];

function PasoIndicador({ paso }) {
  return (
    <div className="ifh-pasos">
      {PASOS.map((label, i) => (
        <div key={i} className={`ifh-paso ${i === paso ? 'activo' : i < paso ? 'completado' : ''}`}>
          <div className="ifh-paso-circulo">{i < paso ? '✓' : i + 1}</div>
          <span className="ifh-paso-label">{label}</span>
          {i < PASOS.length - 1 && <div className="ifh-paso-linea" />}
        </div>
      ))}
    </div>
  );
}

export default function ImportarFacturasHistoricas() {
  const [paso, setPaso]         = useState(0);
  const [archivo, setArchivo]   = useState(null);
  const [preview, setPreview]   = useState(null);
  const [resultado, setResultado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError]       = useState('');
  const inputRef = useRef();

  const descargarPlantilla = async () => {
    try {
      const resp = await api.get('/facturas/importar/plantilla', { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([resp.data]));
      const a    = document.createElement('a');
      a.href     = url;
      a.setAttribute('download', 'plantilla-facturas-historicas.xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setError('No se pudo descargar la plantilla');
    }
  };

  const seleccionarArchivo = (e) => {
    const f = e.target.files?.[0];
    if (f) { setArchivo(f); setError(''); }
  };

  const cargarPreview = async () => {
    if (!archivo) { setError('Seleccione un archivo primero'); return; }
    setCargando(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const { data } = await api.post('/facturas/importar/preview', fd);
      setPreview(data);
      setPaso(2);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al procesar el archivo');
    } finally {
      setCargando(false);
    }
  };

  const ejecutarImportacion = async () => {
    if (!archivo) return;
    if (!window.confirm(`¿Confirmar la importación de ${preview?.validas || 0} facturas válidas? Esta acción no se puede deshacer.`)) return;

    setCargando(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const { data } = await api.post('/facturas/importar/ejecutar', fd);
      setResultado(data);
      setPaso(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Error durante la importación');
    } finally {
      setCargando(false);
    }
  };

  const reiniciar = () => {
    setPaso(0);
    setArchivo(null);
    setPreview(null);
    setResultado(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="ifh-container">
      <div className="ifh-header">
        <h1 className="ifh-titulo">Importar Facturas Históricas</h1>
        <p className="ifh-subtitulo">
          Carga facturas de ventas emitidas en años anteriores desde Excel para llevar la contabilidad completa en AELA.
        </p>
      </div>

      <PasoIndicador paso={paso} />

      {error && <div className="ifh-alerta-error">{error}</div>}

      {/* ── PASO 0: Instrucciones ── */}
      {paso === 0 && (
        <div className="ifh-card">
          <h2 className="ifh-card-titulo">¿Cómo funciona?</h2>

          <div className="ifh-info-grid">
            <div className="ifh-info-item">
              <span className="ifh-info-num">1</span>
              <div>
                <strong>Descarga la plantilla Excel</strong>
                <p>Contiene columnas predefinidas con ejemplos y una hoja de instrucciones detallada.</p>
              </div>
            </div>
            <div className="ifh-info-item">
              <span className="ifh-info-num">2</span>
              <div>
                <strong>Llena tus datos históricos</strong>
                <p>Una fila por factura. Solo necesitas fecha, cliente, montos y forma de pago.</p>
              </div>
            </div>
            <div className="ifh-info-item">
              <span className="ifh-info-num">3</span>
              <div>
                <strong>Carga y revisa la vista previa</strong>
                <p>AELA valida cada fila y te muestra los errores antes de importar nada.</p>
              </div>
            </div>
            <div className="ifh-info-item">
              <span className="ifh-info-num">4</span>
              <div>
                <strong>Confirma la importación</strong>
                <p>Solo se importan las filas válidas. Las históricas aparecen en reportes y declaraciones.</p>
              </div>
            </div>
          </div>

          <div className="ifh-estados-info">
            <h3>Estados que se asignan automáticamente</h3>
            <div className="ifh-estado-row">
              <span className="ifh-badge ifh-badge-autorizado">Autorizado</span>
              <span>Si proporcionas el <strong>número de autorización SRI</strong> (49 dígitos) — la factura ya fue autorizada en su momento.</span>
            </div>
            <div className="ifh-estado-row">
              <span className="ifh-badge ifh-badge-historico">Histórica</span>
              <span>Sin número de autorización — solo para registros contables internos. <strong>No se envía al SRI.</strong></span>
            </div>
          </div>

          <div className="ifh-nota">
            <strong>Tasas de IVA históricas soportadas:</strong> 0% · 5% · 12% (2002–2021) · 14% (2016) · 15% (2016, 2022–presente)
          </div>

          <div className="ifh-acciones">
            <button className="btn-secondary" onClick={descargarPlantilla}>
              Descargar plantilla Excel
            </button>
            <button className="btn-primary" onClick={() => setPaso(1)}>
              Continuar → Cargar archivo
            </button>
          </div>
        </div>
      )}

      {/* ── PASO 1: Cargar archivo ── */}
      {paso === 1 && (
        <div className="ifh-card">
          <h2 className="ifh-card-titulo">Seleccionar archivo</h2>
          <p className="ifh-card-desc">Formatos aceptados: <strong>.xlsx, .xls</strong> — Máximo 1000 filas por importación.</p>

          <div
            className={`ifh-dropzone ${archivo ? 'ifh-dropzone-ok' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) { setArchivo(f); setError(''); }
            }}
          >
            {archivo ? (
              <>
                <span className="ifh-dropzone-icon">✓</span>
                <span className="ifh-dropzone-nombre">{archivo.name}</span>
                <span className="ifh-dropzone-size">({(archivo.size / 1024).toFixed(1)} KB)</span>
              </>
            ) : (
              <>
                <span className="ifh-dropzone-icon">📂</span>
                <span>Haz clic o arrastra tu archivo aquí</span>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={seleccionarArchivo}
          />

          <div className="ifh-acciones">
            <button className="btn-secondary" onClick={() => setPaso(0)}>← Volver</button>
            <button className="btn-secondary" onClick={descargarPlantilla}>Descargar plantilla</button>
            <button className="btn-primary" onClick={cargarPreview} disabled={!archivo || cargando}>
              {cargando ? 'Procesando...' : 'Validar archivo →'}
            </button>
          </div>
        </div>
      )}

      {/* ── PASO 2: Vista previa ── */}
      {paso === 2 && preview && (
        <div className="ifh-card">
          <div className="ifh-preview-header">
            <h2 className="ifh-card-titulo">Vista previa</h2>
            <div className="ifh-preview-stats">
              <span className="ifh-stat ifh-stat-ok">{preview.validas} válidas</span>
              {preview.invalidas > 0 && (
                <span className="ifh-stat ifh-stat-err">{preview.invalidas} con errores</span>
              )}
              <span className="ifh-stat">{preview.total} total</span>
            </div>
          </div>

          {preview.invalidas > 0 && (
            <div className="ifh-alerta-warning">
              Se encontraron {preview.invalidas} filas con errores. Solo se importarán las filas válidas.
              Puede corregir el archivo y volver a cargarlo.
            </div>
          )}

          <div className="ifh-tabla-wrap">
            <table className="ifh-tabla">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Descripción</th>
                  <th>Exento</th>
                  <th>Gravado</th>
                  <th>IVA</th>
                  <th>Total</th>
                  <th>N° Factura</th>
                  <th>SRI</th>
                </tr>
              </thead>
              <tbody>
                {preview.filas.map((f) => (
                  <tr key={f.fila} className={f.valida ? '' : 'ifh-fila-error'}>
                    <td>{f.fila}</td>
                    <td>
                      {f.valida
                        ? <span className="ifh-badge ifh-badge-ok">OK</span>
                        : <span className="ifh-badge ifh-badge-err">Error</span>
                      }
                    </td>
                    {f.valida ? (
                      <>
                        <td>{f.datos.fecha ? new Date(f.datos.fecha).toLocaleDateString('es-EC') : '-'}</td>
                        <td className="ifh-td-cliente" title={f.datos.razonSocial}>{f.datos.razonSocial}</td>
                        <td className="ifh-td-desc" title={f.datos.descripcion}>{f.datos.descripcion}</td>
                        <td>{f.datos.subtotalExento > 0 ? `$${f.datos.subtotalExento.toFixed(2)}` : '-'}</td>
                        <td>{f.datos.subtotalGravado > 0 ? `$${f.datos.subtotalGravado.toFixed(2)}` : '-'}</td>
                        <td>{f.datos.ivaTotal > 0 ? `$${f.datos.ivaTotal.toFixed(2)}` : '-'}</td>
                        <td className="ifh-td-total">${f.datos.importeTotal.toFixed(2)}</td>
                        <td>{f.datos.parsedNum ? `${f.datos.parsedNum.estab}-${f.datos.parsedNum.ptoEmi}-${f.datos.parsedNum.secuencial}` : '(auto)'}</td>
                        <td>
                          {f.datos.numeroAutorizacion
                            ? <span className="ifh-badge ifh-badge-autorizado" title={f.datos.numeroAutorizacion}>Autorizado</span>
                            : <span className="ifh-badge ifh-badge-historico">Histórica</span>
                          }
                        </td>
                      </>
                    ) : (
                      <td colSpan={9} className="ifh-errores-celda">
                        {f.errores.join(' · ')}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.validas > 0 && (
            <div className="ifh-resumen-totales">
              <strong>Total a importar:</strong>{' '}
              ${preview.filas.filter(f => f.valida).reduce((s, f) => s + (f.datos.importeTotal || 0), 0).toFixed(2)}{' '}
              en {preview.validas} facturas
            </div>
          )}

          <div className="ifh-acciones">
            <button className="btn-secondary" onClick={() => setPaso(1)}>← Cambiar archivo</button>
            {preview.validas > 0 && (
              <button className="btn-primary" onClick={ejecutarImportacion} disabled={cargando}>
                {cargando ? 'Importando...' : `Importar ${preview.validas} facturas →`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── PASO 3: Resultado ── */}
      {paso === 3 && resultado && (
        <div className="ifh-card">
          <div className={`ifh-resultado-header ${resultado.importadas > 0 ? 'ifh-resultado-ok' : 'ifh-resultado-err'}`}>
            <span className="ifh-resultado-icon">{resultado.importadas > 0 ? '✓' : '⚠'}</span>
            <div>
              <h2>{resultado.importadas > 0 ? 'Importación completada' : 'Sin facturas importadas'}</h2>
              <p>
                {resultado.importadas > 0 && <><strong>{resultado.importadas}</strong> facturas importadas exitosamente. </>}
                {resultado.errores > 0 && <><strong>{resultado.errores}</strong> filas con errores no importadas.</>}
              </p>
            </div>
          </div>

          {resultado.detalle?.importadas?.length > 0 && (
            <div className="ifh-resultado-seccion">
              <h3>Facturas importadas</h3>
              <table className="ifh-tabla ifh-tabla-compact">
                <thead>
                  <tr><th>Fila</th><th>N° Factura</th><th>Total</th><th>Estado</th><th>Libro Diario</th></tr>
                </thead>
                <tbody>
                  {resultado.detalle.importadas.map(r => (
                    <tr key={r.id}>
                      <td>{r.fila}</td>
                      <td>{r.numeroFactura}</td>
                      <td>${parseFloat(r.total).toFixed(2)}</td>
                      <td>
                        {r.estadoSri === 'AUTORIZADO'
                          ? <span className="ifh-badge ifh-badge-autorizado">Autorizado</span>
                          : <span className="ifh-badge ifh-badge-historico">Histórica</span>
                        }
                      </td>
                      <td>
                        {r.asientoOk
                          ? <span className="ifh-badge ifh-badge-autorizado" title="Se generó el asiento de venta en el Libro Diario">✓ Enlazada</span>
                          : <span className="ifh-badge ifh-badge-historico" title="No se pudo generar el asiento contable — revisa el Plan de Cuentas o crea el asiento manualmente en Contabilidad">⚠ Sin asiento</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ifh-nota-diario">
                💡 Cada factura importada genera automáticamente su asiento de venta en el
                <strong> Libro Diario</strong> (Contabilidad → Libro Diario). Si un producto es
                inventariable, el costo de venta y el stock <strong>no</strong> se ajustan
                automáticamente para facturas históricas (para no alterar tu inventario actual) —
                regístralos manualmente si corresponde.
              </p>
            </div>
          )}

          {resultado.detalle?.errores?.length > 0 && (
            <div className="ifh-resultado-seccion">
              <h3>Filas con errores (no importadas)</h3>
              <table className="ifh-tabla ifh-tabla-compact">
                <thead>
                  <tr><th>Fila</th><th>Errores</th></tr>
                </thead>
                <tbody>
                  {resultado.detalle.errores.map((e, i) => (
                    <tr key={i} className="ifh-fila-error">
                      <td>{e.fila}</td>
                      <td>{Array.isArray(e.errores) ? e.errores.join(' · ') : e.errores}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="ifh-acciones">
            <button className="btn-secondary" onClick={reiniciar}>Nueva importación</button>
            <a href="/facturas?estado=HISTORICO" className="btn-primary">Ver facturas históricas →</a>
          </div>
        </div>
      )}
    </div>
  );
}
