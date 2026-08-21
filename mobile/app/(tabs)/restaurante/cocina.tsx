import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import api from '../../../services/api';
import type { ItemCocinaPendiente } from '../../../types';

const POLL_MS = 15_000;

function minutosDesde(fecha: string) {
  if (!fecha) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 60_000));
}

export default function CocinaScreen() {
  const [items, setItems] = useState<ItemCocinaPendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  const cargar = useCallback(() => {
    api.get('/mesas/cocina/pendientes')
      .then((res) => { setItems(res.data?.data || []); setSinPermiso(false); })
      .catch((err) => { if (err.response?.status === 403) setSinPermiso(true); })
      .finally(() => setCargando(false));
  }, []);

  useFocusEffect(useCallback(() => {
    cargar();
    const id = setInterval(cargar, POLL_MS);
    return () => clearInterval(id);
  }, [cargar]));

  const marcarListo = async (item: ItemCocinaPendiente) => {
    const clave = `${item.comandaId}-${item.codigoPrincipal}-${item.nota || ''}`;
    setMarcando(clave);
    try {
      await api.post(`/mesas/comandas/${item.comandaId}/items/listo`, {
        codigoPrincipal: item.codigoPrincipal, nota: item.nota,
      });
      setItems((prev) => prev.filter((it) => (
        !(it.comandaId === item.comandaId && it.codigoPrincipal === item.codigoPrincipal && (it.nota || '') === (item.nota || ''))
      )));
    } catch { /* se reintenta en el próximo polling */ }
    finally { setMarcando(null); }
  };

  if (sinPermiso) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.centro}>
          <Ionicons name="lock-closed-outline" size={48} color="#cbd5e1" />
          <Text style={s.vacioTxt}>No tienes permiso para ver la cola de cocina.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🔥 Cocina</Text>
        <Text style={s.headerSub}>Se actualiza solo cada 15 segundos.</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it) => `${it.comandaId}-${it.codigoPrincipal}-${it.nota || ''}`}
        contentContainerStyle={s.lista}
        refreshing={cargando}
        onRefresh={cargar}
        ListEmptyComponent={
          <View style={s.centro}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color="#cbd5e1" />
            <Text style={s.vacioTxt}>No hay pedidos pendientes por ahora 🎉</Text>
          </View>
        }
        renderItem={({ item }) => {
          const clave = `${item.comandaId}-${item.codigoPrincipal}-${item.nota || ''}`;
          const minutos = minutosDesde(item.enviadoCocinaEn);
          return (
            <View style={[s.card, minutos >= 10 && s.cardUrgente]}>
              <Text style={s.mesa}>{item.mesaNombre}</Text>
              <Text style={s.itemTxt}><Text style={s.cant}>{item.cantidad}×</Text> {item.descripcion}</Text>
              {item.nota ? <Text style={s.nota}>📝 {item.nota}</Text> : null}
              <View style={s.footer}>
                <Text style={[s.tiempo, minutos >= 10 && s.tiempoUrgente]}>
                  {minutos <= 0 ? 'recién' : `hace ${minutos} min`}
                </Text>
                <TouchableOpacity
                  style={[s.listoBtn, marcando === clave && s.btnDisabled]}
                  onPress={() => marcarListo(item)}
                  disabled={marcando === clave}
                >
                  <Text style={s.listoBtnTxt}>{marcando === clave ? 'Marcando...' : '✓ Listo'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 12 },
  header: { padding: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#1e293b' },
  headerSub: { fontSize: 13, color: '#64748b', marginTop: 2 },
  lista: { padding: 12, flexGrow: 1 },
  vacioTxt: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
  card: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: '#94a3b8' },
  cardUrgente: { borderLeftColor: '#ef4444', backgroundColor: '#fef2f2' },
  mesa: { fontSize: 13, fontWeight: '800', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 },
  itemTxt: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginTop: 4 },
  cant: { color: '#7c3aed' },
  nota: { fontSize: 12, color: '#64748b', marginTop: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  tiempo: { fontSize: 12, color: '#94a3b8' },
  tiempoUrgente: { color: '#dc2626', fontWeight: '700' },
  listoBtn: { backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  listoBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
});
