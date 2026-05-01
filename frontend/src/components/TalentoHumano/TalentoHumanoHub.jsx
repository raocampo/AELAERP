import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import './TalentoHumano.css';

const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const TalentoHumanoHub = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/talento-humano/dashboard')
      .then(r => setStats(r.data.data))
      .catch(() => {});
  }, []);

  const hoy = new Date();
  const nominaMes = stats?.nominaMes;

  return (
    <div className="th-hub">
      <div className="th-hub-header">
        <div>
          <h1>👔 Talento Humano</h1>
          <p>Gestión de empleados, nómina y ausencias</p>
        </div>
      </div>

      {/* Métricas */}
      <div className="th-metrics">
        <div className="th-metric-card">
          <span className="metric-icon">👥</span>
          <span className="metric-value">{stats?.empleadosActivos ?? '—'}</span>
          <span className="metric-label">Empleados activos</span>
        </div>
        <div className="th-metric-card">
          <span className="metric-icon">📅</span>
          <span className="metric-value">{stats?.pendientesAprobar ?? '—'}</span>
          <span className="metric-label">Ausencias pendientes</span>
        </div>
        <div className="th-metric-card">
          <span className="metric-icon">💰</span>
          <span className="metric-value">
            {nominaMes
              ? `$${Number(nominaMes.totalNeto).toLocaleString('es-EC', { minimumFractionDigits: 2 })}`
              : '—'}
          </span>
          <span className="metric-label">Nómina {meses[hoy.getMonth()]} {hoy.getFullYear()}</span>
        </div>
        <div className="th-metric-card">
          <span className="metric-icon">📊</span>
          <span className="metric-value">
            {nominaMes
              ? <span className={`badge-${nominaMes.estado.toLowerCase()}`}>{nominaMes.estado}</span>
              : 'Sin nómina'}
          </span>
          <span className="metric-label">Estado nómina actual</span>
        </div>
      </div>

      {/* Accesos rápidos */}
      <div className="th-quick-links">
        <button className="th-quick-card" onClick={() => navigate('/talento-humano/empleados')}>
          <span className="qc-icon">👤</span>
          <span className="qc-title">Empleados</span>
          <span className="qc-desc">Registro, datos laborales y personales</span>
        </button>
        <button className="th-quick-card" onClick={() => navigate('/talento-humano/departamentos')}>
          <span className="qc-icon">🏢</span>
          <span className="qc-title">Departamentos</span>
          <span className="qc-desc">Estructura organizacional</span>
        </button>
        <button className="th-quick-card" onClick={() => navigate('/talento-humano/cargos')}>
          <span className="qc-icon">📋</span>
          <span className="qc-title">Cargos</span>
          <span className="qc-desc">Puestos de trabajo y funciones</span>
        </button>
        <button className="th-quick-card" onClick={() => navigate('/talento-humano/nomina')}>
          <span className="qc-icon">💵</span>
          <span className="qc-title">Nómina / Rol de Pagos</span>
          <span className="qc-desc">Procesamiento mensual con cálculo IESS</span>
        </button>
        <button className="th-quick-card" onClick={() => navigate('/talento-humano/ausencias')}>
          <span className="qc-icon">🗓️</span>
          <span className="qc-title">Ausencias y Vacaciones</span>
          <span className="qc-desc">Control de permisos y licencias</span>
        </button>
      </div>
    </div>
  );
};

export default TalentoHumanoHub;
