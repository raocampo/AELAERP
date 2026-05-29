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
import type { Producto, ResumenInventario } from '../../../types';

function tarjetaStock(producto: Producto) {
  if (!producto.inventariable) return null;
  if (producto.stockActual <= 0) return 'agotado';
  if (producto.stockActual <= producto.stockMinimo) return 'bajo';
  return 'ok';
}

export default function InventarioScreen() {
  const router = useRouter();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [resumen, setResumen] = useState<ResumenInventario | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [filtro, setFiltro] = useState<'todos' | 'bajo' | 'agotado'>('todos');

  const cargar = useCallback(async () => {
    try {
      const [prodRes, resRes] = await Promise.all([
        api.get('/productos', { params: { inventariable: true, limit: 200 } }),
        api.get('/inventario/resumen'),
      ]);
      setProductos(prodRes.data?.data || []);
      if (resRes.data?.success) setResumen(resRes.data.data);
    } catch {
      // silencioso
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const refrescar = () => {
    setRefrescando(true);
    cargar();
  };

  const productosFiltrados = productos.filter((p) => {
    const matchBusqueda = !busqueda.trim() ||
      p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      p.codigoPrincipal.toLowerCase().includes(busqueda.toLowerCase());
    if (!matchBusqueda) return false;
    if (filtro === 'bajo') return p.inventariable && p.stockActual > 0 && p.stockActual <= p.stockMinimo;
    if (filtro === 'agotado') return p.inventariable && p.stockActual <= 0;
    return true;
  });

  if (cargando) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#1e40af" />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* Tarjetas resumen */}
      {resumen && (
        <View style={s.resumenRow}>
          <View style={[s.resCard, { flex: 1 }]}>
            <Text style={s.resNum}>{resumen.totalInventariables}</Text>
            <Text style={s.resLbl}>Productos</Text>
          </View>
          <TouchableOpacity style={[s.resCard, s.resCardWarning, { flex: 1 }]} onPress={() => setFiltro('bajo')}>
            <Text style={[s.resNum, { color: '#d97706' }]}>{resumen.stockBajo}</Text>
            <Text style={[s.resLbl, { color: '#92400e' }]}>Stock bajo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.resCard, s.resCardDanger, { flex: 1 }]} onPress={() => setFiltro('agotado')}>
            <Text style={[s.resNum, { color: '#dc2626' }]}>{resumen.sinStock}</Text>
            <Text style={[s.resLbl, { color: '#991b1b' }]}>Agotados</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Búsqueda + filtros */}
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={17} color="#94a3b8" style={s.searchIcon} />
        <TextInput
          style={s.searchInput}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar por nombre o código..."
          placeholderTextColor="#94a3b8"
        />
        {busqueda.length > 0 && (
          <TouchableOpacity onPress={() => setBusqueda('')}>
            <Ionicons name="close-circle" size={17} color="#94a3b8" style={{ marginRight: 10 }} />
          </TouchableOpacity>
        )}
      </View>
      <View style={s.filtroRow}>
        {(['todos', 'bajo', 'agotado'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[s.filtroBt, filtro === f && s.filtroBtActive]}
            onPress={() => setFiltro(f)}
          >
            <Text style={[s.filtroBtTxt, filtro === f && s.filtroBtTxtActive]}>
              {f === 'todos' ? 'Todos' : f === 'bajo' ? 'Stock bajo' : 'Agotados'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Botón Nuevo producto — visible encima de la lista */}
      <TouchableOpacity
        style={s.nuevoProductoBtn}
        onPress={() => router.push('/(tabs)/inventario/nuevo-producto')}
        activeOpacity={0.85}
      >
        <Ionicons name="add-circle-outline" size={18} color="#1e40af" />
        <Text style={s.nuevoProductoBtnTxt}>Nuevo producto</Text>
      </TouchableOpacity>

      {/* Lista de productos */}
      <FlatList
        data={productosFiltrados}
        keyExtractor={(item) => item.codigoPrincipal}
        style={s.lista}
        contentContainerStyle={s.listaContent}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} tintColor="#1e40af" />}
        ListFooterComponent={<View style={{ height: 20 }} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="cube-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyTxt}>No se encontraron productos</Text>
          </View>
        }
        renderItem={({ item }) => {
          const estado = tarjetaStock(item);
          return (
            <TouchableOpacity
              style={s.prodCard}
              onPress={() => router.push({
                pathname: '/(tabs)/inventario/movimiento',
                params: { productoId: item.id, nombre: item.nombre, stock: item.stockActual, codigo: item.codigoPrincipal },
              })}
            >
              <View style={s.prodInfo}>
                <Text style={s.prodNombre} numberOfLines={2}>{item.nombre}</Text>
                <Text style={s.prodCodigo}>{item.codigoPrincipal}</Text>
              </View>
              <View style={s.prodRight}>
                {item.inventariable ? (
                  <View style={[
                    s.stockBadge,
                    estado === 'ok' && s.stockOk,
                    estado === 'bajo' && s.stockBajo,
                    estado === 'agotado' && s.stockAgotado,
                  ]}>
                    <Text style={[
                      s.stockNum,
                      estado === 'ok' && s.stockNumOk,
                      estado === 'bajo' && s.stockNumBajo,
                      estado === 'agotado' && s.stockNumAgotado,
                    ]}>{item.stockActual}</Text>
                    <Text style={[
                      s.stockLbl,
                      estado === 'ok' && s.stockNumOk,
                      estado === 'bajo' && s.stockNumBajo,
                      estado === 'agotado' && s.stockNumAgotado,
                    ]}>uds.</Text>
                  </View>
                ) : (
                  <View style={s.servicioTag}>
                    <Text style={s.servicioTagTxt}>Servicio</Text>
                  </View>
                )}
                <Text style={s.prodPrecio}>${Number(item.precioUnitario).toFixed(2)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
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
  resCardWarning: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  resCardDanger: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  resNum: { fontSize: 22, fontWeight: '800', color: '#1e40af' },
  resLbl: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '600' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
  },
  searchIcon: { marginLeft: 10 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  filtroRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  filtroBt: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0',
  },
  filtroBtActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  filtroBtTxt: { fontSize: 12, color: '#475569', fontWeight: '500' },
  filtroBtTxtActive: { color: '#1e40af', fontWeight: '700' },
  lista: { flex: 1 },
  listaContent: { paddingHorizontal: 12, paddingBottom: 20 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12 },
  prodCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 10, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  prodInfo: { flex: 1, marginRight: 12 },
  prodNombre: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  prodCodigo: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  prodRight: { alignItems: 'flex-end', gap: 6 },
  stockBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center', minWidth: 50 },
  stockOk: { backgroundColor: '#f0fdf4' },
  stockBajo: { backgroundColor: '#fffbeb' },
  stockAgotado: { backgroundColor: '#fef2f2' },
  stockNum: { fontSize: 16, fontWeight: '800' },
  stockLbl: { fontSize: 10, fontWeight: '500' },
  stockNumOk: { color: '#16a34a' },
  stockNumBajo: { color: '#d97706' },
  stockNumAgotado: { color: '#dc2626' },
  servicioTag: { backgroundColor: '#f1f5f9', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  servicioTagTxt: { fontSize: 11, color: '#64748b' },
  prodPrecio: { fontSize: 13, fontWeight: '700', color: '#1e40af' },
  nuevoProductoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 12, marginBottom: 8, paddingVertical: 10,
    backgroundColor: '#eff6ff', borderRadius: 10,
    borderWidth: 1.5, borderColor: '#93c5fd',
    borderStyle: 'dashed',
  },
  nuevoProductoBtnTxt: { fontSize: 14, fontWeight: '700', color: '#1e40af' },
});
