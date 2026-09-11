import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import api from '../../../services/api';
import type { EstadoCuentaVendedor } from '../../../types';

function formatFecha(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function DetalleClienteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const [datos, setDatos] = useState<EstadoCuentaVendedor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(`/vendedor/clientes/${id}`);
        setDatos(res.data?.data || null);
        if (res.data?.data?.cliente) {
          navigation.setOptions({ title: res.data.data.cliente.nombreComercial || res.data.data.cliente.razonSocial });
        }
      } catch (err: any) {
        setError(err.response?.data?.mensaje || 'No se pudo cargar el cliente');
      } finally {
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (cargando) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  if (error || !datos) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={40} color="#dc2626" />
        <Text style={s.errorTxt}>{error || 'Cliente no encontrado'}</Text>
      </View>
    );
  }

  const { cliente, saldoTotal, facturasPendientes } = datos;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.header}>
        <Text style={s.razonSocial}>{cliente.razonSocial}</Text>
        <Text style={s.identificacion}>{cliente.identificacion}</Text>

        {cliente.direccion && (
          <View style={s.row}>
            <Ionicons name="location-outline" size={15} color="#64748b" />
            <Text style={s.rowTxt}>{cliente.direccion}</Text>
          </View>
        )}
        {cliente.telefono && (
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL(`tel:${cliente.telefono}`)}>
            <Ionicons name="call-outline" size={15} color="#1e40af" />
            <Text style={[s.rowTxt, s.rowLink]}>{cliente.telefono}</Text>
          </TouchableOpacity>
        )}
        {cliente.email && (
          <TouchableOpacity style={s.row} onPress={() => Linking.openURL(`mailto:${cliente.email}`)}>
            <Ionicons name="mail-outline" size={15} color="#1e40af" />
            <Text style={[s.rowTxt, s.rowLink]} numberOfLines={1}>{cliente.email}</Text>
          </TouchableOpacity>
        )}

        <View style={s.saldoBox}>
          <Text style={s.saldoLbl}>Saldo pendiente</Text>
          <Text style={[s.saldoNum, saldoTotal > 0 ? s.saldoRojo : s.saldoVerde]}>
            ${saldoTotal.toFixed(2)}
          </Text>
        </View>

        <TouchableOpacity
          style={s.pedidoBtn}
          activeOpacity={0.85}
          onPress={() => router.push({
            pathname: '/(tabs)/vendedor/pedido',
            params: { clienteId: cliente.id, nombre: cliente.nombreComercial || cliente.razonSocial },
          })}
        >
          <Ionicons name="add-circle-outline" size={19} color="#fff" />
          <Text style={s.pedidoBtnTxt}>Nuevo pedido</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.seccionTitulo}>Facturas pendientes</Text>
      <FlatList
        data={facturasPendientes}
        keyExtractor={(item) => String(item.id)}
        style={s.lista}
        contentContainerStyle={s.listaContent}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color="#16a34a" />
            <Text style={s.emptyTxt}>Sin facturas pendientes — cliente al día</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.facturaCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.facturaNumero}>{item.numeroFactura}</Text>
              <Text style={s.facturaFecha}>{formatFecha(item.fechaEmision)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.facturaSaldo}>${item.saldo.toFixed(2)}</Text>
              <Text style={s.facturaTotal}>de ${item.importeTotal.toFixed(2)}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  errorTxt: { fontSize: 14, color: '#dc2626', textAlign: 'center' },
  header: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  razonSocial: { fontSize: 17, fontWeight: '700', color: '#1e293b' },
  identificacion: { fontSize: 13, color: '#94a3b8', marginTop: 2, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rowTxt: { fontSize: 13, color: '#475569', flexShrink: 1 },
  rowLink: { color: '#1e40af', fontWeight: '600' },
  saldoBox: {
    marginTop: 12, padding: 12, backgroundColor: '#f8fafc', borderRadius: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  saldoLbl: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  saldoNum: { fontSize: 20, fontWeight: '800' },
  saldoRojo: { color: '#dc2626' },
  saldoVerde: { color: '#16a34a' },
  pedidoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#1e40af', borderRadius: 10, paddingVertical: 12, marginTop: 12,
  },
  pedidoBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  seccionTitulo: { fontSize: 13, fontWeight: '700', color: '#64748b', marginTop: 16, marginHorizontal: 16, marginBottom: 4, textTransform: 'uppercase' },
  lista: { flex: 1 },
  listaContent: { paddingHorizontal: 12, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyTxt: { fontSize: 13, color: '#94a3b8', marginTop: 10, textAlign: 'center' },
  facturaCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  facturaNumero: { fontSize: 13, fontWeight: '600', color: '#1e293b' },
  facturaFecha: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  facturaSaldo: { fontSize: 15, fontWeight: '800', color: '#dc2626' },
  facturaTotal: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
});
