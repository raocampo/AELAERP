// ====================================
// PANEL VENDEDOR — vista web de solo consulta para el rol Agente Vendedor
// ====================================
// Hasta ahora Fases 0-4 del módulo Agente Vendedor solo tenían UI en la app
// móvil (tomar pedidos, cobrar) — la web no tenía NADA propio para este rol
// y un vendedor que entraba por el navegador caía en el Dashboard genérico
// de administrador. Este panel reusa los mismos endpoints que ya consume la
// app móvil (GET /vendedor/clientes, GET /vendedor/comisiones) para dar una
// vista de consulta: cartera de clientes + saldo, y comisiones del mes vs
// meta. Registrar pedidos/cobros sigue siendo una acción de la app móvil.
import { useEffect, useState } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/useAuth';

function formatMoney(v) {
  return parseFloat(v || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export default function PanelVendedor() {
  const { usuario } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [comisiones, setComisiones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    setCargando(true);
    Promise.allSettled([
      api.get('/vendedor/clientes'),
      api.get('/vendedor/comisiones'),
    ]).then(([resClientes, resComisiones]) => {
      if (resClientes.status === 'fulfilled') setClientes(resClientes.value.data?.data || []);
      if (resComisiones.status === 'fulfilled') setComisiones(resComisiones.value.data?.data || []);
    }).finally(() => setCargando(false));
  }, []);

  const totalPorCobrar = clientes.reduce((s, c) => s + parseFloat(c.saldoPendiente || 0), 0);
  const miComision = comisiones.find((c) => c.vendedorId === usuario?.id) || comisiones[0] || null;
  const pctMeta = miComision?.meta > 0 ? Math.min(100, (miComision.comisionDevengada / miComision.meta) * 100) : null;

  const clientesFiltrados = busqueda.trim()
    ? clientes.filter((c) => {
        const q = busqueda.trim().toLowerCase();
        return (c.razonSocial || '').toLowerCase().includes(q)
          || (c.nombreComercial || '').toLowerCase().includes(q)
          || (c.identificacion || '').includes(q);
      })
    : clientes;

  const hoy = new Date();

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 .25rem' }}>👋 Hola, {usuario?.nombre}</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted,#64748b)' }}>
          Este es tu panel de Agente Vendedor. Para tomar pedidos o registrar cobros en la calle, usa la app móvil de AELA.
        </p>
      </div>

      {cargando ? (
        <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted,#64748b)' }}>Cargando...</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <div style={{ flex: '1 1 180px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '.6rem', padding: '1rem' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1e40af' }}>{clientes.length}</div>
              <div style={{ fontSize: '.85rem', color: '#64748b' }}>Clientes asignados</div>
            </div>
            <div style={{ flex: '1 1 180px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '.6rem', padding: '1rem' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#dc2626' }}>${formatMoney(totalPorCobrar)}</div>
              <div style={{ fontSize: '.85rem', color: '#64748b' }}>Por cobrar</div>
            </div>
            <div style={{ flex: '1 1 220px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '.6rem', padding: '1rem' }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#16a34a' }}>
                ${formatMoney(miComision?.comisionDevengada || 0)}
              </div>
              <div style={{ fontSize: '.85rem', color: '#64748b', textTransform: 'capitalize' }}>
                Comisión de {MESES[hoy.getMonth()]}
                {pctMeta != null && ` — ${pctMeta.toFixed(0)}% de la meta`}
              </div>
              {pctMeta != null && (
                <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                  <div style={{ height: 6, width: `${pctMeta}%`, background: '#16a34a', borderRadius: 3 }} />
                </div>
              )}
            </div>
          </div>

          <h2 style={{ fontSize: '1.05rem', margin: '0 0 .75rem' }}>Mi cartera de clientes</h2>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="🔍 Buscar cliente por nombre o identificación..."
            style={{
              width: '100%', maxWidth: 420, padding: '.5rem .75rem', marginBottom: '1rem',
              border: '1px solid #e2e8f0', borderRadius: '.5rem', fontSize: '.9rem', boxSizing: 'border-box',
            }}
          />

          {clientesFiltrados.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '.6rem' }}>
              <p style={{ margin: 0, color: '#94a3b8' }}>
                {busqueda ? 'Sin resultados' : 'Todavía no tienes clientes asignados'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="movimientos-tabla">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Identificación</th>
                    <th>Teléfono</th>
                    <th style={{ textAlign: 'right' }}>Saldo pendiente</th>
                  </tr>
                </thead>
                <tbody>
                  {clientesFiltrados.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.nombreComercial || c.razonSocial}</td>
                      <td>{c.identificacion}</td>
                      <td>{c.telefono || '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: parseFloat(c.saldoPendiente) > 0 ? '#dc2626' : '#16a34a' }}>
                        {parseFloat(c.saldoPendiente) > 0 ? `$${formatMoney(c.saldoPendiente)}` : 'Al día'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
