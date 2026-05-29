import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import type { Factura } from '../../../types';

const ESTADOS_SRI: Record<string, { label: string; color: string; bg: string }> = {
  AUTORIZADO: { label: 'Autorizada', color: '#16a34a', bg: '#f0fdf4' },
  PENDIENTE:  { label: 'Pendiente',  color: '#d97706', bg: '#fffbeb' },
  ERROR:      { label: 'Error',      color: '#dc2626', bg: '#fef2f2' },
  ANULADO:    { label: 'Anulada',    color: '#64748b', bg: '#f1f5f9' },
};

function EstadoBadge({ estado }: { estado: string }) {
  const info = ESTADOS_SRI[estado?.toUpperCase()] || { label: estado, color: '#64748b', bg: '#f1f5f9' };
  return (
    <View style={[badge.wrap, { backgroundColor: info.bg }]}>
      <Text style={[badge.txt, { color: info.color }]}>{info.label}</Text>
    </View>
  );
}
const badge = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  txt: { fontSize: 11, fontWeight: '700' },
});

export default function FacturasScreen() {
  const router = useRouter();
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<string>('TODOS');
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [totalPags, setTotalPags] = useState(1);

  const cargar = useCallback(async (p = 1, reset = false) => {
    try {
      const params: Record<string, unknown> = { page: p, limit: 30 };
      if (filtroEstado !== 'TODOS') params.estadoSri = filtroEstado;
      if (busqueda.trim()) params.q = busqueda.trim();
      const res = await api.get('/facturas', { params });
      const data: Factura[] = res.data?.data || [];
      setFacturas(reset ? data : (prev) => p === 1 ? data : [...prev, ...data]);
      setTotalPags(res.data?.totalPaginas || 1);
      setPagina(p);
    } catch {
      // silencioso
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [filtroEstado, busqueda]);

  useEffect(() => { setCargando(true); cargar(1, true); }, [filtroEstado, cargar]);

  const refrescar = () => { setRefrescando(true); cargar(1, true); };

  const cargarMas = () => {
    if (pagina < totalPags) cargar(pagina + 1);
  };

  const formatFecha = (iso: string) => {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  };

  if (cargando) {
    return <View style={s.center}><ActivityIndicator size="large" color="#1e40af" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* Búsqueda */}
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={17} color="#94a3b8" style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          value={busqueda}
          onChangeText={(t) => { setBusqueda(t); }}
          onSubmitEditing={() => cargar(1, true)}
          placeholder="Buscar por número, cliente o RUC..."
          placeholderTextColor="#94a3b8"
          returnKeyType="search"
        />
        {busqueda.length > 0 && (
          <TouchableOpacity onPress={() => { setBusqueda(''); }}>
            <Ionicons name="close-circle" size={17} color="#94a3b8" style={{ marginRight: 10 }} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filtros estado */}
      <View style={s.filtroScroll}>
        {['TODOS', 'AUTORIZADO', 'PENDIENTE', 'ERROR', 'ANULADO'].map((est) => (
          <TouchableOpacity
            key={est}
            style={[s.filtroBt, filtroEstado === est && s.filtroBtActive]}
            onPress={() => setFiltroEstado(est)}
          >
            <Text style={[s.filtroBtTxt, filtroEstado === est && s.filtroBtTxtActive]}>
              {est === 'TODOS' ? 'Todas' : est === 'AUTORIZADO' ? 'Autorizadas' : est === 'PENDIENTE' ? 'Pendientes' : est === 'ERROR' ? 'Error' : 'Anuladas'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Lista de facturas */}
      <FlatList
        data={facturas}
        keyExtractor={(item) => String(item.id)}
        style={s.lista}
        contentContainerStyle={s.listaContent}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor="#1e40af" />}
        onEndReached={cargarMas}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="document-text-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyTxt}>No se encontraron facturas</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.factCard}>
            <View style={s.factHeader}>
              <Text style={s.factNumero}>{item.numeroFactura}</Text>
              <EstadoBadge estado={item.estadoSri} />
            </View>
            <Text style={s.factCliente} numberOfLines={1}>{item.razonSocialComprador}</Text>
            <Text style={s.factId}>{item.identificacionComprador}</Text>
            <View style={s.factFooter}>
              <Text style={s.factFecha}>{formatFecha(item.fechaEmision || item.createdAt)}</Text>
              <Text style={s.factTotal}>${Number(item.importeTotal).toFixed(2)}</Text>
            </View>
          </View>
        )}
      />

      {/* FAB — Nueva factura */}
      <TouchableOpacity
        style={s.fab}
        onPress={() => router.push('/(tabs)/facturas/nueva')}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
  },
  searchIcon: { marginLeft: 10 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  filtroScroll: { flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, gap: 6 },
  filtroBt: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  filtroBtActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  filtroBtTxt: { fontSize: 12, color: '#475569', fontWeight: '500' },
  filtroBtTxtActive: { color: '#1e40af', fontWeight: '700' },
  lista: { flex: 1 },
  listaContent: { paddingHorizontal: 12, paddingBottom: 80 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
  factCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  factHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  factNumero: { fontSize: 15, fontWeight: '800', color: '#1e40af' },
  factCliente: { fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 2 },
  factId: { fontSize: 12, color: '#94a3b8', marginBottom: 8 },
  factFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  factFecha: { fontSize: 12, color: '#64748b' },
  factTotal: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  fab: {
    position: 'absolute', right: 20, bottom: 20, width: 56, height: 56,
    borderRadius: 28, backgroundColor: '#1e40af', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#1e40af', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4,
    shadowRadius: 8, elevation: 8,
  },
});
