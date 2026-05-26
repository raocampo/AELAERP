// Iconos SVG para botones de acción en tablas — 15×15 px, stroke-based
// Uso: import { IcVer, IcEditar, ... } from '../../utils/icons'
//      <button className="btn-icon" title="Ver detalle"><IcVer/></button>

export const IcVer = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="8" cy="8" rx="6.5" ry="4.5"/>
    <circle cx="8" cy="8" r="1.8"/>
  </svg>
);

export const IcEditar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2.5l2.5 2.5-8 8H3v-2.5l8-8z"/>
  </svg>
);

export const IcPDF = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/>
    <path d="M9 2v4h4"/>
    <text x="4.2" y="11.5" fontSize="3.8" fontWeight="700" fill="currentColor" stroke="none" fontFamily="sans-serif">PDF</text>
  </svg>
);

export const IcXML = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z"/>
    <path d="M9 2v4h4"/>
    <text x="3.8" y="11.5" fontSize="3.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="sans-serif">XML</text>
  </svg>
);

export const IcDescargar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v8m-3.5-3.5L8 10l3.5-3.5"/>
    <path d="M3 13h10"/>
  </svg>
);

export const IcReenviar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 8A5.5 5.5 0 112.5 8"/>
    <path d="M13.5 5v3h-3"/>
  </svg>
);

export const IcAnular = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="8" cy="8" r="5.5"/>
    <line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/>
    <line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>
  </svg>
);

export const IcEliminar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4h10m-4 0V3H7v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4"/>
    <line x1="7" y1="7" x2="7" y2="10"/>
    <line x1="9" y1="7" x2="9" y2="10"/>
  </svg>
);

export const IcActivar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="5.5"/>
    <path d="M5.5 8.5l2 2 3-3.5"/>
  </svg>
);

export const IcDesactivar = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
    <circle cx="8" cy="8" r="5.5"/>
    <line x1="5.5" y1="8" x2="10.5" y2="8"/>
  </svg>
);
