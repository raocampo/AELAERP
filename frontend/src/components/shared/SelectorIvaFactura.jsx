import { opcionesIvaFactura } from '../../utils/ivaFactura';
import './SelectorIvaFactura.css';

export default function SelectorIvaFactura({ value, fechaEmision, onChange, style }) {
  const opciones = opcionesIvaFactura(fechaEmision);
  const disponible = opciones.some((opcion) => opcion.valor === Number(value));
  return (
    <select className="iva-factura-selector" value={value} onChange={onChange} style={style}
      aria-label="IVA del ítem" aria-invalid={!disponible}
      title={disponible ? 'Tarifa de IVA' : 'Selecciona una tarifa vigente para esta factura'}>
      {!disponible && <option value={value} disabled>{value}% (no disponible)</option>}
      {opciones.map((opcion) => <option key={opcion.valor} value={opcion.valor}>{opcion.label}</option>)}
    </select>
  );
}
