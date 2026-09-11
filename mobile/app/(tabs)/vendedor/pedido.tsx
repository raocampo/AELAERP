import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import api from '../../../services/api';
import type { ItemCarrito, Producto } from '../../../types';

// "Nuevo Pedido" — mismo patrón de búsqueda+carrito que pos/index.tsx, pero
// sin formas de pago (el pedido es solo informativo hasta que la oficina lo
// convierte a factura) y sin selector de cliente (ya viene fijo de la
// cartera del vendedor). Ver docs/roadmap-agente-vendedor.md Fase 2.
export default function NuevoPedidoScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { clienteId, nombre } = useLocalSearchParams<{ clienteId: string; nombre?: string }>();

  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscandoProd, setBuscandoProd] = useState(false);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const busquedaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (nombre) navigation.setOptions({ title: `Pedido — ${nombre}` });
  }, [nombre, navigation]);

  useEffect(() => {
    if (busqueda.trim().length < 1) { setResultados([]); return; }
    setBuscandoProd(true);
    if (busquedaTimer.current) clearTimeout(busquedaTimer.current);
    busquedaTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/productos/buscar', { params: { q: busqueda } });
        setResultados(res.data?.data || []);
      } catch { setResultados([]); }
      finally { setBuscandoProd(false); }
    }, 300);
    return () => { if (busquedaTimer.current) clearTimeout(busquedaTimer.current); };
  }, [busqueda]);

  const agregarProducto = useCallback((producto: Producto) => {
    setCarrito((prev) => {
      const existe = prev.find((i) => i.codigoPrincipal === producto.codigoPrincipal);
      if (existe) return prev.map((i) => i.codigoPrincipal === producto.codigoPrincipal ? { ...i, cantidad: i.cantidad + 1 } : i);
      return [...prev, {
        codigoPrincipal: producto.codigoPrincipal,
        descripcion: producto.nombre,
        cantidad: 1,
        precioUnitario: Number(producto.precioUnitario || 0),
        ivaPorcentaje: Number(producto.tarifaIva || 0),
      }];
    });
    setBusqueda(''); setResultados([]);
  }, []);

  const cambiarCantidad = (codigo: string, delta: number) =>
    setCarrito((prev) => prev.map((i) => i.codigoPrincipal === codigo ? { ...i, cantidad: Math.max(1, i.cantidad + delta) } : i));

  const quitarItem = (codigo: string) =>
    setCarrito((prev) => prev.filter((i) => i.codigoPrincipal !== codigo));

  const subtotal = useMemo(() => carrito.reduce((a, i) => a + i.cantidad * i.precioUnitario, 0), [carrito]);
  const totalConIva = useMemo(() => carrito.reduce((a, i) => {
    const l = i.cantidad * i.precioUnitario; return a + l + l * (i.ivaPorcentaje / 100);
  }, 0), [carrito]);

  const enviarPedido = async () => {
    if (carrito.length === 0) { Alert.alert('Carrito vacío', 'Agrega al menos un producto.'); return; }
    setEnviando(true);
    try {
      const res = await api.post('/vendedor/pedidos', {
        clienteId: Number(clienteId),
        detalles: carrito,
        observaciones: observaciones.trim() || undefined,
      });
      Alert.alert(
        'Pedido enviado',
        `Pedido ${res.data?.data?.numero || ''} registrado por $${totalConIva.toFixed(2)}. La oficina lo convertirá a factura.`,
        [{ text: 'OK', onPress: () => router.replace('/(tabs)/vendedor/pedidos') }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo enviar el pedido');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* Búsqueda de productos */}
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={18} color="#94a3b8" style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar producto por nombre o código..."
          placeholderTextColor="#94a3b8"
          returnKeyType="search"
        />
        {buscandoProd && <ActivityIndicator size="small" color="#1e40af" style={{ marginRight: 10 }} />}
        {busqueda.length > 0 && !buscandoProd && (
          <TouchableOpacity onPress={() => { setBusqueda(''); setResultados([]); }}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" style={{ marginRight: 10 }} />
          </TouchableOpacity>
        )}
      </View>

      {resultados.length > 0 && (
        <View style={s.resultados}>
          <FlatList
            data={resultados}
            keyExtractor={(i) => i.codigoPrincipal}
            style={{ maxHeight: 200 }}
            keyboardShouldPersistTaps="always"
            renderItem={({ item }) => (
              <TouchableOpacity style={s.resultItem} onPress={() => agregarProducto(item)}>
                <View style={s.resultInfo}>
                  <Text style={s.resultNombre}>{item.nombre}</Text>
                  <Text style={s.resultCodigo}>{item.codigoPrincipal}</Text>
                </View>
                <Text style={s.resultPrecio}>${Number(item.precioUnitario).toFixed(2)}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <FlatList
        data={carrito}
        keyExtractor={(i) => i.codigoPrincipal}
        style={s.carrito}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <TextInput
            style={s.obsInput}
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Observaciones del pedido (opcional)"
            placeholderTextColor="#94a3b8"
            multiline
          />
        }
        ListEmptyComponent={
          <View style={s.emptyCarrito}>
            <Ionicons name="clipboard-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyCarritoTxt}>Pedido vacío — busca un producto</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.carritoItem}>
            <View style={s.carritoInfo}>
              <Text style={s.carritoNombre} numberOfLines={2}>{item.descripcion}</Text>
              <Text style={s.carritoSub}>${item.precioUnitario.toFixed(2)} c/u{item.ivaPorcentaje > 0 ? ` + IVA ${item.ivaPorcentaje}%` : ''}</Text>
            </View>
            <View style={s.carritoCtrl}>
              <TouchableOpacity style={s.ctrBtn} onPress={() => cambiarCantidad(item.codigoPrincipal, -1)}>
                <Ionicons name="remove" size={16} color="#1e40af" />
              </TouchableOpacity>
              <Text style={s.ctrQty}>{item.cantidad}</Text>
              <TouchableOpacity style={s.ctrBtn} onPress={() => cambiarCantidad(item.codigoPrincipal, 1)}>
                <Ionicons name="add" size={16} color="#1e40af" />
              </TouchableOpacity>
            </View>
            <View style={s.carritoTotalCol}>
              <Text style={s.carritoTotal}>${(item.cantidad * item.precioUnitario).toFixed(2)}</Text>
              <TouchableOpacity onPress={() => quitarItem(item.codigoPrincipal)}>
                <Ionicons name="trash-outline" size={16} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {carrito.length > 0 && (
        <View style={s.footer}>
          <View style={s.footerTotales}>
            <Text style={s.footerLabel}>Subtotal</Text>
            <Text style={s.footerValor}>${subtotal.toFixed(2)}</Text>
          </View>
          <View style={s.footerTotales}>
            <Text style={s.footerLabel}>IVA</Text>
            <Text style={s.footerValor}>${(totalConIva - subtotal).toFixed(2)}</Text>
          </View>
          <View style={[s.footerTotales, s.footerTotalBig]}>
            <Text style={s.footerTotalLbl}>TOTAL</Text>
            <Text style={s.footerTotalVal}>${totalConIva.toFixed(2)}</Text>
          </View>
          <TouchableOpacity style={s.enviarBtn} onPress={enviarPedido} activeOpacity={0.85} disabled={enviando}>
            {enviando
              ? <ActivityIndicator color="#fff" />
              : <>
                <Ionicons name="send-outline" size={20} color="#fff" />
                <Text style={s.enviarBtnTxt}>Enviar pedido</Text>
              </>
            }
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  searchBox: { flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10 },
  searchIcon: { marginLeft: 10 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  resultados: { marginHorizontal: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8, elevation: 3 },
  resultItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  resultInfo: { flex: 1 },
  resultNombre: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  resultCodigo: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  resultPrecio: { fontSize: 15, fontWeight: '700', color: '#1e40af' },
  carrito: { flex: 1, paddingHorizontal: 12 },
  obsInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    padding: 12, fontSize: 13, color: '#1e293b', marginBottom: 10, minHeight: 44,
  },
  emptyCarrito: { alignItems: 'center', paddingVertical: 48 },
  emptyCarritoTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
  carritoItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  carritoInfo: { flex: 1 },
  carritoNombre: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  carritoSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  carritoCtrl: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10 },
  ctrBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  ctrQty: { fontSize: 15, fontWeight: '700', color: '#1e293b', minWidth: 24, textAlign: 'center' },
  carritoTotalCol: { alignItems: 'flex-end', gap: 6 },
  carritoTotal: { fontSize: 15, fontWeight: '700', color: '#1e40af' },
  footer: { backgroundColor: '#fff', padding: 16, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  footerTotales: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  footerLabel: { fontSize: 13, color: '#64748b' },
  footerValor: { fontSize: 13, color: '#1e293b', fontWeight: '500' },
  footerTotalBig: { borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8, marginTop: 4, marginBottom: 12 },
  footerTotalLbl: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  footerTotalVal: { fontSize: 20, fontWeight: '800', color: '#1e40af' },
  enviarBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  enviarBtnTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
