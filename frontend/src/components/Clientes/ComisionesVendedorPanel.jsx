// Panel de Comisiones y Metas del Agente Vendedor (Fase 4).
// Ver docs/roadmap-agente-vendedor.md. Visible solo para quien puede asignar
// vendedores (mismo permiso que la asignación de cartera en GestionClientes).
import { useEffect, useState } from 'react';
import api from '../../services/api';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export default function ComisionesVendedorPanel() {
  const hoy = new Date();
  const [abierto, setAbierto] = useState(false);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [metasEdit, setMetasEdit] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);

  useEffect(() => {
    if (!abierto) return;
    setCargando(true);
    api.get(`/vendedor/comisiones?anio=${anio}&mes=${mes}`)
      .then((r) => {
        const data = r.data?.data || [];
        setFilas(data);
        setMetasEdit(Object.fromEntries(data.map((f) => [f.vendedorId, f.meta ?? ''])));
      })
      .catch(() => setFilas([]))
      .finally(() => setCargando(false));
  }, [abierto, anio, mes]);

  const guardarMeta = async (vendedorId) => {
    const montoMeta = parseFloat(metasEdit[vendedorId]);
    if (!(montoMeta >= 0)) return;
    setGuardandoId(vendedorId);
    try {
      await api.post('/vendedor/metas', { vendedorId, anio, mes, montoMeta });
      setFilas((prev) => prev.map((f) => (f.vendedorId === vendedorId ? { ...f, meta: montoMeta } : f)));
    } catch (err) {
      alert(err.response?.data?.mensaje || 'No se pudo guardar la meta');
    } finally {
      setGuardandoId(null);
    }
  };

  return (
    <div style={{ marginTop: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '.6rem', background: '#fff' }}>
      <button
        onClick={() => setAbierto((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '.85rem 1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '.95rem', fontWeight: 700,
        }}
      >
        <span>📈 Comisiones y metas de vendedores</span>
        <span style={{ fontSize: '.8rem', color: '#64748b' }}>{abierto ? '▲ Ocultar' : '▼ Ver'}</span>
      </button>

      {abierto && (
        <div style={{ padding: '0 1rem 1rem' }}>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1rem' }}>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '.88rem' }}>
              {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '.88rem' }}>
              {[hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {cargando ? (
            <p style={{ color: '#94a3b8', fontSize: '.9rem' }}>Cargando…</p>
          ) : filas.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '.9rem' }}>No hay vendedores registrados.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="movimientos-tabla">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    <th style={{ textAlign: 'right' }}>Comisión devengada</th>
                    <th style={{ textAlign: 'right' }}>Meta ($)</th>
                    <th style={{ textAlign: 'right' }}>% cumplido</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const metaNum = parseFloat(metasEdit[f.vendedorId]);
                    const pct = metaNum > 0 ? Math.min(100, (f.comisionDevengada / metaNum) * 100) : null;
                    return (
                      <tr key={f.vendedorId}>
                        <td style={{ fontWeight: 600 }}>{f.nombre}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>${f.comisionDevengada.toFixed(2)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="number" step="0.01" min="0"
                            value={metasEdit[f.vendedorId] ?? ''}
                            onChange={(e) => setMetasEdit((prev) => ({ ...prev, [f.vendedorId]: e.target.value }))}
                            style={{ width: 100, textAlign: 'right', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: '.35rem' }}
                          />
                        </td>
                        <td style={{ textAlign: 'right' }}>{pct != null ? `${pct.toFixed(0)}%` : '—'}</td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={guardandoId === f.vendedorId}
                            onClick={() => guardarMeta(f.vendedorId)}
                          >
                            {guardandoId === f.vendedorId ? 'Guardando…' : 'Guardar meta'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
