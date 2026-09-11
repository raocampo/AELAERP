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
import type { ClienteVendedor } from '../../../types';

// "Mis Clientes" — cartera asignada al vendedor logueado (o todos si es
// admin/supervisor viendo el módulo). El scoping real vive en el backend
// (GET /api/vendedor/clientes ya devuelve solo lo que corresponde).
export default function MisClientesScreen() {
  const router = useRouter();
  const [clientes, setClientes] = useState<ClienteVendedor[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async (q?: string) => {
    try {
      const res = await api.get('/vendedor/clientes', { params: q ? { q } : undefined });
      setClientes(res.data?.data || []);
    } catch {
      // silencioso — pantalla queda vacía, se puede reintentar con pull-to-refresh
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => cargar(busqueda.trim() || undefined), busqueda ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busqueda]);

  const refrescar = () => {
    setRefrescando(true);
    cargar(busqueda.trim() || undefined);
  };

  const totalPorCobrar = clientes.reduce((acc, c) => acc + (c.saldoPendiente || 0), 0);

  if (cargando) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.resumenRow}>
        <View style={[s.resCard, { flex: 1 }]}>
          <Text style={s.resNum}>{clientes.length}</Text>
          <Text style={s.resLbl}>Clientes</Text>
        </View>
        <View style={[s.resCard, { flex: 1 }]}>
          <Text style={s.resNum}>${totalPorCobrar.toFixed(2)}</Text>
          <Text style={s.resLbl}>Por cobrar</Text>
        </View>
      </View>

      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={17} color="#94a3b8" style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar cliente por nombre o RUC/cédula..."
          placeholderTextColor="#94a3b8"
        />
        {busqueda.length > 0 && (
          <TouchableOpacity onPress={() => setBusqueda('')}>
            <Ionicons name="close-circle" size={17} color="#94a3b8" style={{ marginRight: 10 }} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={clientes}
        keyExtractor={(item) => String(item.id)}
        style={s.lista}
        contentContainerStyle={s.listaContent}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor="#1e40af" />}
        ListFooterComponent={<View style={{ height: 20 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="people-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyTxt}>
              {busqueda ? 'Sin resultados' : 'Todavía no tenés clientes asignados'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.card}
            onPress={() => router.push({ pathname: '/(tabs)/vendedor/cliente', params: { id: item.id } })}
          >
            <View style={s.info}>
              <Text style={s.nombre} numberOfLines={1}>{item.nombreComercial || item.razonSocial}</Text>
              <Text style={s.identificacion}>{item.identificacion}</Text>
            </View>
            {item.saldoPendiente > 0 ? (
              <View style={s.saldoBadge}>
                <Text style={s.saldoNum}>${item.saldoPendiente.toFixed(2)}</Text>
                <Text style={s.saldoLbl}>por cobrar</Text>
              </View>
            ) : (
              <View style={s.alDiaBadge}>
                <Text style={s.alDiaTxt}>Al día</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resumenRow: { flexDirection: 'row', gap: 8, padding: 12 },
  resCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  resNum: { fontSize: 20, fontWeight: '800', color: '#1e40af' },
  resLbl: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '600' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
  },
  searchIcon: { marginLeft: 10 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  lista: { flex: 1 },
  listaContent: { paddingHorizontal: 12, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  info: { flex: 1, marginRight: 12 },
  nombre: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  identificacion: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  saldoBadge: { alignItems: 'flex-end' },
  saldoNum: { fontSize: 15, fontWeight: '800', color: '#dc2626' },
  saldoLbl: { fontSize: 10, color: '#94a3b8', fontWeight: '500' },
  alDiaBadge: { backgroundColor: '#f0fdf4', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  alDiaTxt: { fontSize: 11, color: '#16a34a', fontWeight: '700' },
});
