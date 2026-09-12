import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../services/api';

interface FilaComision {
  vendedorId: number;
  nombre: string;
  comisionDevengada: number;
  meta: number | null;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// "Mis Comisiones" — acumulado devengado del mes vs meta. Admin/supervisor
// ven la lista completa de vendedores; el vendedor solo se ve a sí mismo.
// Ver docs/roadmap-agente-vendedor.md Fase 4.
export default function ComisionesScreen() {
  const [filas, setFilas] = useState<FilaComision[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const now = new Date();

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/vendedor/comisiones');
      setFilas(res.data?.data || []);
    } catch {
      // silencioso — pull-to-refresh
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const refrescar = () => { setRefrescando(true); cargar(); };

  if (cargando) {
    return <View style={s.center}><ActivityIndicator size="large" color="#1e40af" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.header}>
        <Text style={s.headerTxt}>{MESES[now.getMonth()]} {now.getFullYear()}</Text>
      </View>
      <FlatList
        data={filas}
        keyExtractor={(item) => String(item.vendedorId)}
        contentContainerStyle={s.lista}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor="#1e40af" />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="cash-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyTxt}>Sin comisiones devengadas este mes</Text>
          </View>
        }
        renderItem={({ item }) => {
          const tieneMeta = item.meta != null && item.meta > 0;
          const pct: number = tieneMeta ? Math.min(100, (item.comisionDevengada / (item.meta as number)) * 100) : 0;
          return (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.nombre} numberOfLines={1}>{item.nombre}</Text>
                <Text style={s.monto}>${item.comisionDevengada.toFixed(2)}</Text>
              </View>
              {tieneMeta && (
                <>
                  <View style={s.barraFondo}>
                    <View style={[s.barraRelleno, { width: `${pct}%` }]} />
                  </View>
                  <Text style={s.metaTxt}>Meta: ${(item.meta as number).toFixed(2)} ({pct.toFixed(0)}%)</Text>
                </>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { padding: 16, paddingBottom: 8 },
  headerTxt: { fontSize: 13, fontWeight: '700', color: '#64748b', textTransform: 'capitalize' },
  lista: { padding: 12, paddingTop: 4, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nombre: { fontSize: 14, fontWeight: '600', color: '#1e293b', flex: 1, marginRight: 8 },
  monto: { fontSize: 18, fontWeight: '800', color: '#16a34a' },
  barraFondo: { height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, marginTop: 10, overflow: 'hidden' },
  barraRelleno: { height: 6, backgroundColor: '#1e40af', borderRadius: 3 },
  metaTxt: { fontSize: 11, color: '#94a3b8', marginTop: 6 },
});
