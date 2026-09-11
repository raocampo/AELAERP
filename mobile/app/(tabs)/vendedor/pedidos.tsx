import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../../../services/api';
import type { PedidoVendedor } from '../../../types';

const ESTADO_COLOR: Record<string, { fg: string; bg: string }> = {
  BORRADOR:   { fg: '#64748b', bg: '#f1f5f9' },
  ENVIADA:    { fg: '#2563eb', bg: '#dbeafe' },
  ACEPTADA:   { fg: '#16a34a', bg: '#dcfce7' },
  RECHAZADA:  { fg: '#dc2626', bg: '#fee2e2' },
  CONVERTIDA: { fg: '#7c3aed', bg: '#ede9fe' },
  ANULADA:    { fg: '#374151', bg: '#e5e7eb' },
};

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "Mis Pedidos" — historial de pedidos (proformas) que este vendedor envió.
// Estado CONVERTIDA = la oficina ya lo facturó (docs/roadmap-agente-vendedor.md).
export default function MisPedidosScreen() {
  const [pedidos, setPedidos] = useState<PedidoVendedor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/vendedor/pedidos');
      setPedidos(res.data?.data || []);
    } catch {
      // silencioso — pull-to-refresh para reintentar
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
      <FlatList
        data={pedidos}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={s.lista}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor="#1e40af" />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="clipboard-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyTxt}>Todavía no enviaste ningún pedido</Text>
          </View>
        }
        renderItem={({ item }) => {
          const c = ESTADO_COLOR[item.estado] || ESTADO_COLOR.BORRADOR;
          return (
            <View style={s.card}>
              <View style={{ flex: 1 }}>
                <Text style={s.numero}>{item.numero}</Text>
                <Text style={s.cliente} numberOfLines={1}>{item.razonSocial}</Text>
                <Text style={s.fecha}>{fmtFecha(item.fechaEmision || item.createdAt)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={s.monto}>${Number(item.importeTotal).toFixed(2)}</Text>
                <View style={[s.badge, { backgroundColor: c.bg }]}>
                  <Text style={[s.badgeTxt, { color: c.fg }]}>{item.estado}</Text>
                </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lista: { padding: 12, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  numero: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  cliente: { fontSize: 13, color: '#475569', marginTop: 2 },
  fecha: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  monto: { fontSize: 15, fontWeight: '800', color: '#1e40af' },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
});
