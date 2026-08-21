import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../../../services/api';
import type { Mesa } from '../../../types';

export default function MesasScreen() {
  const router = useRouter();
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [abriendoId, setAbriendoId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/mesas');
      setMesas(res.data?.data || []);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudieron cargar las mesas');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  // Recarga cada vez que se vuelve a esta pantalla (ej. al regresar de
  // cobrar una mesa) — expo-router no remonta el screen automáticamente.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const onRefresh = () => { setRefrescando(true); cargar(); };

  const abrirMesa = async (mesa: Mesa) => {
    if (mesa.comanda) {
      router.push({ pathname: '/(tabs)/restaurante/comanda', params: { mesaId: mesa.id } });
      return;
    }
    setAbriendoId(mesa.id);
    try {
      await api.post(`/mesas/${mesa.id}/comanda`, {});
      router.push({ pathname: '/(tabs)/restaurante/comanda', params: { mesaId: mesa.id } });
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo abrir la mesa');
    } finally {
      setAbriendoId(null);
    }
  };

  if (cargando) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.centro}><ActivityIndicator size="large" color="#1e40af" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🍽️ Mesas</Text>
        <Text style={s.headerSub}>Toca una mesa libre para abrirla, u ocupada para ver su pedido.</Text>
      </View>
      <FlatList
        data={mesas}
        keyExtractor={(m) => String(m.id)}
        numColumns={2}
        columnWrapperStyle={s.fila}
        contentContainerStyle={s.lista}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={onRefresh} colors={['#1e40af']} />}
        ListEmptyComponent={
          <View style={s.vacio}>
            <Ionicons name="restaurant-outline" size={48} color="#cbd5e1" />
            <Text style={s.vacioTxt}>No hay mesas configuradas todavía. Créalas desde la web (Mesas → Administrar).</Text>
          </View>
        }
        renderItem={({ item }) => {
          const ocupada = Boolean(item.comanda);
          return (
            <TouchableOpacity
              style={[s.mesaCard, ocupada ? s.mesaOcupada : s.mesaLibre]}
              onPress={() => abrirMesa(item)}
              disabled={abriendoId === item.id}
              activeOpacity={0.8}
            >
              <Text style={s.mesaNombre}>{item.nombre}</Text>
              {item.capacidad ? <Text style={s.mesaCap}>👥 {item.capacidad}</Text> : null}
              {ocupada ? (
                <>
                  <Text style={[s.mesaEstado, s.estadoOcupada]}>Ocupada</Text>
                  <Text style={s.mesaTotal}>${item.comanda!.total.toFixed(2)}</Text>
                  {item.comanda!.pendientesCocina > 0 && (
                    <View style={s.badge}><Text style={s.badgeTxt}>🔥 {item.comanda!.pendientesCocina} sin enviar</Text></View>
                  )}
                </>
              ) : (
                <Text style={[s.mesaEstado, s.estadoLibre]}>
                  {abriendoId === item.id ? 'Abriendo...' : 'Libre'}
                </Text>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { padding: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1e293b' },
  headerSub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  lista: { padding: 12 },
  fila: { gap: 12 },
  vacio: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 32 },
  vacioTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center' },
  mesaCard: {
    flex: 1, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 2, minHeight: 110, justifyContent: 'center', gap: 4,
  },
  mesaLibre: { backgroundColor: '#ecfdf5', borderColor: '#10b981' },
  mesaOcupada: { backgroundColor: '#fef2f2', borderColor: '#ef4444' },
  mesaNombre: { fontSize: 17, fontWeight: '800', color: '#1e293b' },
  mesaCap: { fontSize: 12, color: '#64748b' },
  mesaEstado: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  estadoLibre: { color: '#059669' },
  estadoOcupada: { color: '#dc2626' },
  mesaTotal: { fontSize: 18, fontWeight: '800', color: '#1e293b' },
  badge: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: '#b45309' },
});
