// ====================================
// LOGIN — AELA
// frontend/src/components/Auth/Login.jsx
// ====================================

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './Login.css';

export default function Login() {
  const { login, bootstrap } = useAuth();
  const navigate         = useNavigate();
  const [loginId, setLoginId]   = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);
  const [verificandoSetup, setVerificandoSetup] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [mostrarOlvidePassword, setMostrarOlvidePassword] = useState(false);
  const [configurando, setConfigurando] = useState(false);
  const [buscandoSriEmpresa, setBuscandoSriEmpresa] = useState(false);
  const [mensajeSriEmpresa, setMensajeSriEmpresa] = useState('');
  const [setupForm, setSetupForm] = useState({
    ruc: '',
    razonSocial: '',
    nombreComercial: '',
    direccion: '',
    telefono: '',
    emailEmpresa: '',
    nombre: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    let activo = true;

    const verificarSetup = async () => {
      try {
        const res = await api.get('/auth/bootstrap-status');
        if (!activo) return;
        setSetupRequired(Boolean(res.data?.data?.setupRequired));
      } catch (err) {
        if (!activo) return;
        toast.error(err.response?.data?.mensaje || 'No se pudo verificar la configuración inicial');
      } finally {
        if (activo) setVerificandoSetup(false);
      }
    };

    verificarSetup();
    return () => { activo = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setCargando(true);
    try {
      const res = await login(loginId, password);
      if (res.success) {
        toast.success(`Bienvenido, ${res.usuario.nombre}`);
        navigate('/dashboard');
      } else {
        toast.error(res.mensaje || 'Credenciales inválidas');
      }
    } catch (err) {
      if (err.response?.data?.setupRequired) {
        setSetupRequired(true);
      }
      toast.error(err.response?.data?.mensaje || 'Error al iniciar sesión');
    } finally {
      setCargando(false);
    }
  };

  const handleSetupChange = (e) => {
    const { name, value } = e.target;
    setSetupForm((prev) => ({ ...prev, [name]: value }));
  };

  const consultarEmpresaSri = async (rucIngresado = setupForm.ruc) => {
    const rucLimpio = String(rucIngresado || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(rucLimpio)) {
      setMensajeSriEmpresa('');
      return;
    }

    setBuscandoSriEmpresa(true);
    setMensajeSriEmpresa('');
    try {
      const res = await api.get(`/auth/empresa-sri/${rucLimpio}`);
      if (res.data?.encontrado && res.data?.data) {
        const empresa = res.data.data;
        setSetupForm((prev) => ({
          ...prev,
          ruc: empresa.ruc || prev.ruc,
          razonSocial: empresa.razonSocial || prev.razonSocial,
          nombreComercial: empresa.nombreComercial || prev.nombreComercial,
          direccion: empresa.direccion || prev.direccion,
        }));
        setMensajeSriEmpresa(`✓ Empresa encontrada en SRI: ${empresa.razonSocial}`);
        return;
      }

      setMensajeSriEmpresa('No se encontró información en el SRI. Puedes continuar ingresando los datos manualmente.');
    } catch (err) {
      setMensajeSriEmpresa(err.response?.data?.mensaje || 'No se pudo consultar el SRI en este momento.');
    } finally {
      setBuscandoSriEmpresa(false);
    }
  };

  const handleBootstrap = async (e) => {
    e.preventDefault();

    if (setupForm.password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (setupForm.password !== setupForm.confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    if (!/^\d{13}$/.test(setupForm.ruc.replace(/\D/g, ''))) {
      toast.error('El RUC debe tener 13 dígitos');
      return;
    }

    if (!/^[a-z0-9._-]{3,40}$/i.test(setupForm.username.trim())) {
      toast.error('El usuario debe tener entre 3 y 40 caracteres y solo usar letras, números, punto, guion o guion bajo');
      return;
    }

    setConfigurando(true);
    try {
      const res = await bootstrap({
        ruc: setupForm.ruc,
        razonSocial: setupForm.razonSocial,
        nombreComercial: setupForm.nombreComercial,
        direccion: setupForm.direccion,
        telefono: setupForm.telefono,
        emailEmpresa: setupForm.emailEmpresa,
        nombre: setupForm.nombre,
        username: setupForm.username,
        email: setupForm.email,
        password: setupForm.password,
      });

      if (res.success) {
        toast.success('Configuración inicial completada');
        navigate('/dashboard');
      } else {
        toast.error(res.mensaje || 'No se pudo completar la configuración inicial');
      }
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al completar la configuración inicial');
    } finally {
      setConfigurando(false);
    }
  };

  const cardClassName = `login-card ${setupRequired ? 'login-card-setup' : ''}`;

  return (
    <div className="login-root">
      <div className={cardClassName}>
        <div className="login-logo">
          <svg width="52" height="52" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{display:'block',margin:'0 auto 10px'}}>
            <defs>
              <linearGradient id="lg-login" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#7C3AED"/>
                <stop offset="100%" stopColor="#06B6D4"/>
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="url(#lg-login)"/>
            <rect x="14" y="18" width="36" height="25" rx="5" fill="none" stroke="white" strokeWidth="2.5"/>
            <rect x="22" y="35" width="20" height="16" rx="4" fill="white" opacity="0.95"/>
            <circle cx="32" cy="29" r="4.5" fill="white"/>
          </svg>
          <span className="login-logo-sigla">AELA</span>
          <span className="login-logo-sub">ERP Ecuador · by CorpSimtelec</span>
        </div>
        {verificandoSetup ? (
          <div className="login-status-box">
            <h2 className="login-titulo">Verificando sistema</h2>
            <p className="login-subtitulo">
              Estamos comprobando si el sistema ya tiene un usuario administrador inicial.
            </p>
          </div>
        ) : setupRequired ? (
          <>
            <span className="login-badge">Primer ingreso</span>
            <h2 className="login-titulo">Configuración inicial</h2>
            <p className="login-subtitulo">
              Crea la primera empresa y el usuario administrador para empezar a usar AELA ERP.
            </p>

            <form onSubmit={handleBootstrap} className="login-form">
              <div className="login-section-title">Empresa</div>
              <div className="login-grid">
                <div className="login-field">
                  <label>RUC</label>
                  <input
                    type="text"
                    name="ruc"
                    value={setupForm.ruc}
                    onChange={handleSetupChange}
                    placeholder="1790012345001"
                    maxLength={13}
                    required
                    autoFocus
                    onBlur={(e) => consultarEmpresaSri(e.target.value)}
                  />
                  {buscandoSriEmpresa && (
                    <small className="login-field-hint">Consultando datos en el SRI...</small>
                  )}
                  {mensajeSriEmpresa && !buscandoSriEmpresa && (
                    <small className={`login-field-hint ${mensajeSriEmpresa.startsWith('✓') ? 'success' : 'warning'}`}>
                      {mensajeSriEmpresa}
                    </small>
                  )}
                </div>
                <div className="login-field">
                  <label>Razón social</label>
                  <input
                    type="text"
                    name="razonSocial"
                    value={setupForm.razonSocial}
                    onChange={handleSetupChange}
                    placeholder="Mi Empresa S.A."
                    required
                  />
                </div>
              </div>

              <div className="login-field">
                <label>Nombre comercial</label>
                <input
                  type="text"
                  name="nombreComercial"
                  value={setupForm.nombreComercial}
                  onChange={handleSetupChange}
                  placeholder="Opcional"
                />
              </div>
              <div className="login-field">
                <label>Dirección matriz</label>
                <input
                  type="text"
                  name="direccion"
                  value={setupForm.direccion}
                  onChange={handleSetupChange}
                  placeholder="Se usará para precargar Configuración SRI"
                />
              </div>
              <div className="login-grid">
                <div className="login-field">
                  <label>Teléfono de la empresa</label>
                  <input
                    type="text"
                    name="telefono"
                    value={setupForm.telefono}
                    onChange={handleSetupChange}
                    placeholder="Opcional"
                  />
                </div>
                <div className="login-field">
                  <label>Correo de notificaciones</label>
                  <input
                    type="email"
                    name="emailEmpresa"
                    value={setupForm.emailEmpresa}
                    onChange={handleSetupChange}
                    placeholder="facturas@empresa.com"
                  />
                </div>
              </div>

              <div className="login-section-title">Administrador</div>
              <div className="login-grid">
                <div className="login-field">
                  <label>Nombre completo</label>
                  <input
                    type="text"
                    name="nombre"
                    value={setupForm.nombre}
                    onChange={handleSetupChange}
                    placeholder="Administrador principal"
                    required
                  />
                </div>
                <div className="login-field">
                  <label>Usuario</label>
                  <input
                    type="text"
                    name="username"
                    value={setupForm.username}
                    onChange={handleSetupChange}
                    placeholder="admin, caja01, operador.ventas"
                    required
                  />
                </div>
                <div className="login-field">
                  <label>Correo electrónico</label>
                  <input
                    type="email"
                    name="email"
                    value={setupForm.email}
                    onChange={handleSetupChange}
                    placeholder="Opcional"
                  />
                </div>
                <div className="login-field">
                  <label>Contraseña</label>
                  <input
                    type="password"
                    name="password"
                    value={setupForm.password}
                    onChange={handleSetupChange}
                    placeholder="Mínimo 8 caracteres"
                    required
                  />
                </div>
                <div className="login-field">
                  <label>Confirmar contraseña</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={setupForm.confirmPassword}
                    onChange={handleSetupChange}
                    placeholder="Repite la contraseña"
                    required
                  />
                </div>
              </div>

              <button type="submit" className="login-btn" disabled={configurando}>
                {configurando ? 'Configurando...' : 'Crear empresa y administrador'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2 className="login-titulo">Iniciar Sesión</h2>
            <p className="login-subtitulo">
              Ingresa con tu usuario o con tu correo electrónico, según cómo se haya creado tu cuenta.
            </p>
            <form onSubmit={handleSubmit} className="login-form">
              <div className="login-field">
                <label>Usuario o correo electrónico</label>
                <input
                  type="text"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  placeholder="admin o usuario@empresa.com"
                  required
                  autoFocus
                />
              </div>
              <div className="login-field">
                <label>Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </div>
              <button type="submit" className="login-btn" disabled={cargando}>
                {cargando ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                className="login-link-btn"
                onClick={() => setMostrarOlvidePassword(!mostrarOlvidePassword)}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>
            {mostrarOlvidePassword && (
              <div className="login-olvide-box">
                <p style={{ fontWeight: 700, marginBottom: 8 }}>¿Cómo recuperar el acceso?</p>
                <p>
                  <strong>Si eres un usuario normal:</strong> solicita al administrador del sistema que resetee tu contraseña desde
                  {' '}<em>Usuarios → Editar → Nueva contraseña</em>.
                </p>
                <p>
                  <strong>Si eres el administrador:</strong> ejecuta el siguiente comando en el servidor:
                </p>
                <code className="login-code-block">
                  node scripts/resetPassword.js &lt;tu_usuario&gt; &lt;nueva_contraseña&gt;
                </code>
                <p style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
                  Ejemplo: <code>node scripts/resetPassword.js admin NuevaClave2026!</code>
                </p>
              </div>
            )}
          </>
        )}
        <p className="login-footer">AELA ERP © {new Date().getFullYear()} · <a href="https://corpsimtelec.com" target="_blank" rel="noopener noreferrer" style={{color:'#7C3AED',textDecoration:'none'}}>CorpSimtelec</a></p>
      </div>
    </div>
  );
}
