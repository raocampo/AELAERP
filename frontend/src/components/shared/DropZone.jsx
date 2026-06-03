import { useRef, useState } from 'react';
import './DropZone.css';

/**
 * DropZone — área de carga con drag-and-drop y click.
 *
 * Props:
 *  accept      string   — tipos de archivo aceptados (igual que <input accept>)
 *  multiple    bool     — permite seleccionar varios archivos
 *  label       string   — texto principal del área
 *  sublabel    string   — texto secundario (tipos aceptados)
 *  icon        string   — emoji o texto para el ícono (default "📁")
 *  files       File[]   — archivos actualmente seleccionados (para mostrar nombres)
 *  disabled    bool     — deshabilita la zona
 *  onChange    fn(File[]) — llamado con la lista de archivos seleccionados/soltados
 */
export default function DropZone({
  accept,
  multiple = false,
  label,
  sublabel,
  icon = '📁',
  files = [],           // File[] o File (normalizado abajo)
  disabled = false,
  onChange,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Normalizar: puede recibir un File suelto o un array
  const fileList = files
    ? (Array.isArray(files) ? files : [files]).filter(Boolean)
    : [];

  const handleFiles = (rawFiles) => {
    if (disabled || !rawFiles?.length) return;
    const lista = Array.from(rawFiles);
    if (onChange) onChange(multiple ? lista : lista.slice(0, 1));
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };

  const onDragLeave = (e) => {
    // Solo limpiar si salimos del área (no de un hijo)
    if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const onClick = () => {
    if (!disabled) inputRef.current?.click();
  };

  const labelTexto = fileList.length > 0
    ? fileList.length === 1
      ? fileList[0].name
      : `${fileList.length} archivos seleccionados`
    : (label || 'Haz clic o arrastra un archivo aquí');

  return (
    <div
      className={[
        'dropzone',
        dragging  ? 'dropzone--over'     : '',
        disabled  ? 'dropzone--disabled' : '',
        fileList.length > 0 ? 'dropzone--loaded' : '',
      ].filter(Boolean).join(' ')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      aria-label={label}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
        // Limpiar el valor para permitir volver a seleccionar el mismo archivo
        onClick={(e) => { e.target.value = null; }}
      />

      <span className="dropzone__icon">
        {fileList.length > 0 ? '✅' : icon}
      </span>

      <span className="dropzone__label">
        {labelTexto}
      </span>

      {sublabel && fileList.length === 0 && (
        <span className="dropzone__sublabel">{sublabel}</span>
      )}

      {!disabled && (
        <span className="dropzone__hint">
          {dragging ? 'Suelta aquí ↓' : 'clic o arrastra'}
        </span>
      )}
    </div>
  );
}
