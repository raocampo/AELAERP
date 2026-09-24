import { useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './ComprobantePublico.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

// Página pública (sin login) para que el cliente final de un negocio que usa
// AELA pueda volver a descargar su factura (PDF y XML autorizado) sin
// depender del portal del SRI ni de haber guardado el correo original —
// mismo criterio que MenuPublico.jsx: instancia de axios propia (sin tocar
// la sesión que pueda haber abierta en el mismo navegador) y el tenant se
// identifica por el slug de la URL, no por login.
export default function ComprobantePublico() {
  const { slug } = useParams();
  const headers = slug ? { 'X-Tenant-Slug': slug } : {};

  const [identificacion, setIdentificacion] = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [factura, setFactura] = useState(null);

  const buscar = async (e) => {
    e.preventDefault();
    setError('');
    setFactura(null);
    setBuscando(true);
    try {
      const res = await axios.post(
        `${API_URL}/comprobantes-publicos/buscar`,
        { identificacion: identificacion.trim(), numeroFactura: numeroFactura.trim() },
        { headers },
      );
      setFactura(res.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.mensaje || 'No se pudo realizar la búsqueda. Intenta de nuevo.');
    } finally {
      setBuscando(false);
    }
  };

  const descargar = async (tipo) => {
    try {
      const res = await axios.get(`${API_URL}/comprobantes-publicos/${tipo}`, {
        headers,
        params: { identificacion: identificacion.trim(), numeroFactura: numeroFactura.trim() },
        responseType: 'blob',
      });
      const mime = tipo === 'pdf' ? 'application/pdf' : 'application/xml';
      const url = URL.createObjectURL(new Blob([res.data], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `factura-${factura?.numeroFactura || 'comprobante'}.${tipo}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError(`No se pudo descargar el ${tipo.toUpperCase()}. Intenta de nuevo.`);
    }
  };

  return (
    <div className="cp-page">
      <div className="cp-card">
        <h1>🧾 Descarga tu factura</h1>
        <p className="cp-subtitulo">
          Ingresa tu RUC o cédula (el mismo con el que te facturaron) y el número
          de factura para descargar tu comprobante en PDF o XML.
        </p>

        <form onSubmit={buscar} className="cp-form">
          <label>
            RUC / Cédula
            <input
              value={identificacion}
              onChange={(e) => setIdentificacion(e.target.value)}
              placeholder="1234567890"
              required
            />
          </label>
          <label>
            Número de factura
            <input
              value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
              placeholder="001-001-000123456"
              required
            />
          </label>
          <button type="submit" disabled={buscando}>
            {buscando ? 'Buscando…' : 'Buscar factura'}
          </button>
        </form>

        {error && <div className="cp-error">{error}</div>}

        {factura && (
          <div className="cp-resultado">
            <div className="cp-resultado-fila"><span>N° Factura</span><strong>{factura.numeroFactura}</strong></div>
            <div className="cp-resultado-fila"><span>Fecha</span><strong>{new Date(factura.fechaEmision).toLocaleDateString('es-EC')}</strong></div>
            <div className="cp-resultado-fila"><span>Emitida por</span><strong>{factura.razonSocialEmisor}</strong></div>
            <div className="cp-resultado-fila"><span>Total</span><strong>${Number(factura.importeTotal).toFixed(2)}</strong></div>
            <div className="cp-botones">
              <button type="button" onClick={() => descargar('pdf')}>⬇ Descargar PDF</button>
              <button type="button" className="cp-btn-secundario" onClick={() => descargar('xml')}>⬇ Descargar XML</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
