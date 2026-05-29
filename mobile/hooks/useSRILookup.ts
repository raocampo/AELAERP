import { useCallback, useState } from 'react';
import api from '../services/api';

interface DatosSRI {
  razonSocial: string;
  direccion: string;
  email: string;
  telefono: string;
  clienteId: number | null;
}

export function useSRILookup() {
  const [buscando, setBuscando] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const buscar = useCallback(async (
    identificacion: string,
    tipoId: string,
    onResult: (datos: DatosSRI) => void,
  ) => {
    const limpio = identificacion.trim();
    if (tipoId === '07') return;

    const esCedula = /^\d{10}$/.test(limpio);
    const esRuc    = /^\d{13}$/.test(limpio);

    if (!esCedula && !esRuc) {
      if (limpio.length > 0) setMensaje('Ingresa 10 dígitos (cédula) o 13 dígitos (RUC)');
      return;
    }

    setBuscando(true);
    setMensaje('Consultando SRI…');
    try {
      const res = await api.get(`/clientes/sri/${limpio}`);
      const d = res.data;

      if (d.success && d.data) {
        const c = d.data;
        onResult({
          razonSocial: c.razonSocial || '',
          direccion:   c.direccion   || '',
          email:       c.email       || '',
          telefono:    c.telefono    || '',
          clienteId:   c.id          ?? null,
        });
        setMensaje(d.requiereDatosManuales ? 'Completa los datos del cliente' : '');
      } else if (d.servicioNoDisponible) {
        setMensaje('SRI no disponible — ingresa los datos manualmente');
      } else {
        setMensaje('No encontrado — ingresa los datos manualmente');
      }
    } catch {
      setMensaje('Error al consultar el SRI');
    } finally {
      setBuscando(false);
    }
  }, []);

  const limpiar = useCallback(() => setMensaje(''), []);

  return { buscar, buscando, mensaje, limpiar };
}
