import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';

interface FacturaPendiente {
  id: number;
  numeroFactura: string;
  clienteNombre: string;
  fechaEmision: string;
  importeTotal: number;
  saldo: number;
}

function fmtFecha(iso: string) {
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// "Cobros pendientes" — todas las facturas con saldo de mi cartera, aplanadas
// (a diferencia del detalle por cliente en cliente.tsx). Ver
// docs/roadmap-agente-vendedor.md Fase 3.
export default function CobrosPendientesScreen() {
  const router = useRouter();
  const [facturas, setFacturas] = useState<FacturaPendiente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/vendedor/cobros/pendientes');
      setFacturas(res.data?.data || []);
    } catch {
      // silencioso — pull-to-refresh para reintentar
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const refrescar = () => { setRefrescando(true); cargar(); };

  const totalPendiente = facturas.reduce((a, f) => a + f.saldo, 0);

  if (cargando) {
    return <View style={s.center}><ActivityIndicator size="large" color="#1e40af" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {facturas.length > 0 && (
        <View style={s.resumen}>
          <Text style={s.resumenLbl}>Total por cobrar</Text>
          <Text style={s.resumenNum}>${totalPendiente.toFixed(2)}</Text>
        </View>
      )}
      <FlatList
        data={facturas}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={s.lista}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor="#1e40af" />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color="#16a34a" />
            <Text style={s.emptyTxt}>Ningún cliente de tu cartera tiene saldo pendiente</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.card}
            onPress={() => router.push({
              pathname: '/(tabs)/vendedor/cobro',
              params: {
                facturaId: item.id, numeroFactura: item.numeroFactura,
                clienteNombre: item.clienteNombre, saldo: item.saldo.toFixed(2),
              },
            })}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.cliente} numberOfLines={1}>{item.clienteNombre}</Text>
              <Text style={s.factura}>{item.numeroFactura} · {fmtFecha(item.fechaEmision)}</Text>
            </View>
            <Text style={s.saldo}>${item.saldo.toFixed(2)}</Text>
            <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  resumen: {
    backgroundColor: '#fff', margin: 12, marginBottom: 4, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  resumenLbl: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  resumenNum: { fontSize: 18, fontWeight: '800', color: '#dc2626' },
  lista: { padding: 12, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8, gap: 10,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  cliente: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  factura: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  saldo: { fontSize: 15, fontWeight: '800', color: '#dc2626' },
});
