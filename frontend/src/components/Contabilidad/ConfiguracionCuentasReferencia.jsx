import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';

// Tabla Referencia (fija) | Cuenta contable (elegible) para catálogos largos
// de configuración contable — retenciones por código SRI, conceptos de
// nómina, cuentas generales. Ver backend/utils/catalogosCuentasReferencia.js.
const ConfiguracionCuentasReferencia = ({ categoria, titulo, plan }) => {
  const [filas, setFilas] = useState([]);
  const [cambios, setCambios] = useState({});
  const [loading, setLoading] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/contabilidad/configuracion-referencias/${categoria}`);
      setFilas(res.data?.data || []);
      setCambios({});
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo cargar la configuración');
    } finally {
      setLoading(false);
    }
  }, [categoria]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    const items = Object.entries(cambios).map(([codigoReferencia, cuentaId]) => ({
      codigoReferencia,
      cuentaId: cuentaId || null,
    }));
    if (items.length === 0) {
      toast('No hay cambios que guardar');
      return;
    }
    setGuardando(true);
    try {
      await api.put(`/contabilidad/configuracion-referencias/${categoria}`, { items });
      toast.success('Configuración guardada');
      await cargar();
    } catch (error) {
      toast.error(error.response?.data?.mensaje || 'No se pudo guardar la configuración');
    } finally {
      setGuardando(false);
    }
  };

  const cuentasDisponibles = plan.filter((c) => c.aceptaMovimiento && c.activo);

  return (
    <div className="conta-subcard">
      <h4>{titulo}</h4>
      {loading ? (
        <div className="conta-loading">Cargando…</div>
      ) : (
        <>
          <div className="conta-table-scroll">
            <table className="conta-table">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Cuenta contable</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const valorActual = cambios[f.codigoReferencia] !== undefined
                    ? cambios[f.codigoReferencia]
                    : (f.cuenta?.id || '');
                  return (
                    <tr key={f.codigoReferencia}>
                      <td>{f.etiqueta}</td>
                      <td>
                        <select
                          value={valorActual}
                          onChange={(e) => setCambios((prev) => ({ ...prev, [f.codigoReferencia]: e.target.value }))}
                        >
                          <option value="">— Sin configurar (usa la cuenta por defecto) —</option>
                          {cuentasDisponibles.map((c) => (
                            <option key={c.codigo} value={c.id}>{c.codigo} — {c.nombre}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {filas.length === 0 && (
                  <tr><td colSpan="2" className="conta-empty">No hay referencias en esta categoría.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="conta-form-actions">
            <button type="button" className="btn-primary" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ConfiguracionCuentasReferencia;
