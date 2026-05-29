/**
 * usePrint — Impresión de recibos con doble estrategia:
 *
 * 1. ESC/POS por red (WiFi): si el usuario configuró una IP de impresora,
 *    llama a POST /api/impresora/recibo/:tipo/:id  → el backend envía
 *    los comandos ESC/POS directamente a la impresora por TCP.
 *    También abre el cajón de dinero si está habilitado.
 *
 * 2. Fallback PDF: descarga el PDF del recibo y abre el diálogo de
 *    compartir/imprimir del sistema operativo (expo-sharing).
 *    Funciona para cualquier impresora visible en el OS.
 */
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import api, { getToken } from '../services/api';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || 'https://aelaerp-production.up.railway.app/api')
  .replace(/\/api$/, '');

export function usePrint() {
  const [imprimiendo, setImprimiendo] = useState(false);

  const imprimir = useCallback(async (
    id: number,
    tipo: 'nota_venta' | 'factura',
    opciones?: { silencioso?: boolean },
  ) => {
    setImprimiendo(true);
    try {
      // ── Intento 1: ESC/POS por red local ───────────────────
      try {
        const res = await api.post(`/impresora/recibo/${tipo}/${id}`);
        if (res.data?.success) {
          if (!opciones?.silencioso) {
            Alert.alert('Impreso', 'Recibo enviado a la impresora térmica.');
          }
          return;
        }
      } catch (errRed: any) {
        // 400 = impresora no configurada → ir a fallback sin avisar
        // 500 = error de red → avisar y ofrecer fallback
        if (errRed?.response?.status !== 400) {
          const continuar = await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Error de impresora',
              `No se pudo imprimir en la impresora de red.\n${errRed?.response?.data?.mensaje || errRed.message}\n\n¿Compartir el PDF en su lugar?`,
              [
                { text: 'Cancelar', onPress: () => resolve(false), style: 'cancel' },
                { text: 'Compartir PDF', onPress: () => resolve(true) },
              ],
            );
          });
          if (!continuar) return;
        }
        // Si 400 (no configurada) → caer al PDF silenciosamente
      }

      // ── Intento 2: PDF por expo-sharing ────────────────────
      const token = await getToken();
      if (!token) { Alert.alert('Error', 'No hay sesión activa'); return; }

      const endpoint = tipo === 'nota_venta'
        ? `${API_BASE}/api/notas-venta/${id}/recibo`
        : `${API_BASE}/api/facturas/${id}/recibo`;

      const localUri = `${FileSystem.cacheDirectory}recibo-${tipo}-${id}.pdf`;

      const result = await FileSystem.downloadAsync(endpoint, localUri, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (result.status !== 200) {
        Alert.alert('Error', 'No se pudo descargar el recibo del servidor');
        return;
      }

      const puedeCompartir = await Sharing.isAvailableAsync();
      if (!puedeCompartir) {
        Alert.alert('Sin soporte', 'Este dispositivo no puede compartir archivos');
        return;
      }

      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Imprimir / Compartir recibo',
        UTI: 'com.adobe.pdf',
      });
    } catch (err: any) {
      Alert.alert('Error al imprimir', err.message || 'No se pudo procesar el recibo');
    } finally {
      setImprimiendo(false);
    }
  }, []);

  /** Abre el cajón de dinero sin imprimir recibo */
  const abrirCajon = useCallback(async () => {
    try {
      await api.post('/impresora/cajon');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo abrir el cajón');
    }
  }, []);

  return { imprimir, abrirCajon, imprimiendo };
}
