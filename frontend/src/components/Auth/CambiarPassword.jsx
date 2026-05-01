// ====================================
// CAMBIAR CONTRASEÑA — Modal
// frontend/src/components/Auth/CambiarPassword.jsx
// ====================================

import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function CambiarPassword({ onClose }) {
  const [form, setForm] = useState({ passwordActual: '', passwordNuevo: '', confirmar: '' });
  const [guardando, setGuardando] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleGuardar = async (e) => {
    e.preventDefault();

    if (form.passwordNuevo.length < 8) {
      toast.error('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (form.passwordNuevo !== form.confirmar) {
      toast.error('Las contraseñas nuevas no coinciden');
      return;
    }

    setGuardando(true);
    try {
      await api.post('/auth/cambiar-password', {
        passwordActual: form.passwordActual,
        passwordNuevo: form.passwordNuevo,
      });
      toast.success('Contraseña actualizada correctamente');
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.mensaje || 'Error al cambiar la contraseña');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0 }}>🔑 Cambiar contraseña</h3>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleGuardar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="fact-field">
            <label>Contraseña actual</label>
            <input
              type="password"
              name="passwordActual"
              value={form.passwordActual}
              onChange={handleChange}
              placeholder="Tu contraseña actual"
              required
              autoFocus
            />
          </div>
          <div className="fact-field">
            <label>Nueva contraseña</label>
            <input
              type="password"
              name="passwordNuevo"
              value={form.passwordNuevo}
              onChange={handleChange}
              placeholder="Mínimo 8 caracteres"
              required
            />
          </div>
          <div className="fact-field">
            <label>Confirmar nueva contraseña</label>
            <input
              type="password"
              name="confirmar"
              value={form.confirmar}
              onChange={handleChange}
              placeholder="Repite la nueva contraseña"
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
