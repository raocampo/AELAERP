import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Comanda, ItemComanda, Producto } from '../../../types';

export default function ComandaScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { mesaId } = useLocalSearchParams<{ mesaId: string }>();

  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [enviandoCocina, setEnviandoCocina] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const busquedaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cuentas separadas: null = modo normal; Set<number> = modo "dividir
  // cuenta" activo con los índices (dentro de comanda.items, arreglo
  // completo incluyendo ítems ya facturados) seleccionados para esta ronda.
  const [seleccion, setSeleccion] = useState<Set<number> | null>(null);

  const cargar = useCallback(() => {
    api.get(`/mesas/${mesaId}/comanda`)
      .then((res) => {
        if (!res.data?.data) {
          Alert.alert('Sin comanda', 'Esta mesa no tiene una comanda abierta');
          router.back();
          return;
        }
        setComanda(res.data.data);
      })
      .catch((err) => Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo cargar la comanda'))
      .finally(() => setCargando(false));
  }, [mesaId, router]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (comanda?.mesa?.nombre) {
      navigation.setOptions({ title: comanda.mesa.nombre });
    }
  }, [comanda?.mesa?.nombre, navigation]);

  useEffect(() => {
    if (busqueda.trim().length < 1) { setResultados([]); return; }
    if (busquedaTimer.current) clearTimeout(busquedaTimer.current);
    busquedaTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/productos/buscar', { params: { q: busqueda } });
        setResultados(res.data?.data || []);
      } catch { setResultados([]); }
    }, 300);
    return () => { if (busquedaTimer.current) clearTimeout(busquedaTimer.current); };
  }, [busqueda]);

  const guardarItems = async (nuevosItems: ItemComanda[]) => {
    if (!comanda) return;
    setGuardando(true);
    try {
      const res = await api.put(`/mesas/comandas/${comanda.id}`, { items: nuevosItems });
      setComanda((prev) => (prev ? { ...prev, ...res.data.data } : prev));
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo guardar el pedido');
    } finally {
      setGuardando(false);
    }
  };

  const agregarProducto = (producto: Producto) => {
    if (!comanda) return;
    const items = [...comanda.items];
    const existente = items.find((it) => it.codigoPrincipal === producto.codigoPrincipal && !it.nota && !it.enviadoCocina);
    if (existente) {
      existente.cantidad = Number(existente.cantidad) + 1;
    } else {
      items.push({
        codigoPrincipal: producto.codigoPrincipal,
        descripcion: producto.nombre,
        cantidad: 1,
        precioUnitario: Number(producto.precioUnitario || 0),
        ivaPorcentaje: Number(producto.tarifaIva || 0),
        nota: '',
        enviadoCocina: false,
      });
    }
    setBusqueda(''); setResultados([]);
    guardarItems(items);
  };

  const cambiarCantidad = (idx: number, delta: number) => {
    if (!comanda) return;
    const items = [...comanda.items];
    const nueva = Number(items[idx].cantidad) + delta;
    if (nueva <= 0) items.splice(idx, 1); else items[idx] = { ...items[idx], cantidad: nueva };
    guardarItems(items);
  };

  const quitarItem = (idx: number) => {
    if (!comanda) return;
    guardarItems(comanda.items.filter((_, i) => i !== idx));
  };

  const enviarCocina = async () => {
    if (!comanda) return;
    setEnviandoCocina(true);
    try {
      const res = await api.post(`/mesas/comandas/${comanda.id}/enviar-cocina`);
      Alert.alert(
        res.data?.impreso ? 'Enviado' : 'Guardado',
        res.data?.mensaje || (res.data?.impreso ? 'Pedido enviado a cocina' : 'Pedido guardado'),
      );
      setComanda((prev) => (prev ? { ...prev, items: res.data.data.items } : prev));
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo enviar a cocina');
    } finally {
      setEnviandoCocina(false);
    }
  };

  const anular = () => {
    if (!comanda) return;
    Alert.alert('Anular mesa', '¿Anular esta comanda? La mesa quedará libre sin generar ninguna venta.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Anular', style: 'destructive',
        onPress: async () => {
          try {
            await api.post(`/mesas/comandas/${comanda.id}/anular`);
            router.back();
          } catch (err: any) {
            Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo anular la comanda');
          }
        },
      },
    ]);
  };

  // Sin selección activa: cobra TODOS los ítems pendientes (de siempre).
  // Con selección activa (modo "dividir cuenta"): cobra solo los índices
  // marcados y le pasa `indices` a checkout.tsx para que POST
  // /comandas/:id/cerrar sepa que es una cuenta dividida.
  const irACobrar = () => {
    if (!comanda) return;
    const pendientes = comanda.items.filter((it) => !it.facturado);
    if (!pendientes.length) { Alert.alert('Sin ítems', 'No hay ítems pendientes por cobrar'); return; }

    const indices = seleccion ? [...seleccion] : null;
    const itemsACobrar = indices ? comanda.items.filter((_, i) => indices.includes(i)) : pendientes;
    if (indices && itemsACobrar.length === 0) { Alert.alert('Sin selección', 'Selecciona al menos un ítem para dividir la cuenta'); return; }

    const subtotal = itemsACobrar.reduce((a, i) => a + i.cantidad * i.precioUnitario, 0);
    const totalConIva = itemsACobrar.reduce((a, i) => a + i.cantidad * i.precioUnitario * (1 + i.ivaPorcentaje / 100), 0);
    router.push({
      pathname: '/(tabs)/pos/checkout',
      params: {
        carrito: JSON.stringify(itemsACobrar.map((it) => ({
          codigoPrincipal: it.codigoPrincipal, descripcion: it.descripcion,
          cantidad: it.cantidad, precioUnitario: it.precioUnitario, ivaPorcentaje: it.ivaPorcentaje,
        }))),
        tipoDocumento: 'nota_venta',
        tipoId: '07',
        identificacion: '9999999999999',
        razonSocial: 'CONSUMIDOR FINAL',
        total: subtotal.toFixed(2),
        totalConIva: totalConIva.toFixed(2),
        subtotal: subtotal.toFixed(2),
        comandaId: String(comanda.id),
        mesaNombre: comanda.mesa?.nombre || '',
        ...(indices && { indices: JSON.stringify(indices) }),
      },
    });
  };

  const toggleModoDividir = () => setSeleccion((prev) => (prev ? null : new Set()));
  const toggleSeleccion = (idx: number) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  if (cargando || !comanda) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.centro}><ActivityIndicator size="large" color="#1e40af" /></View>
      </SafeAreaView>
    );
  }

  const pendientesCocina = comanda.items.filter((it) => !it.enviadoCocina).length;
  const editablesCount = comanda.items.filter((it) => !it.facturado).length;
  const totalSeleccionado = seleccion
    ? comanda.items.reduce((acc, it, i) => (seleccion.has(i) ? acc + it.cantidad * it.precioUnitario * (1 + it.ivaPorcentaje / 100) : acc), 0)
    : 0;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={18} color="#94a3b8" style={{ marginLeft: 10 }} />
        <TextInput
          style={s.searchInput}
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Buscar producto para agregar..."
          placeholderTextColor="#94a3b8"
        />
      </View>
      {resultados.length > 0 && (
        <View style={s.resultados}>
          <FlatList
            data={resultados}
            keyExtractor={(p) => p.codigoPrincipal}
            keyboardShouldPersistTaps="always"
            style={{ maxHeight: 220 }}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.resultItem} onPress={() => agregarProducto(item)}>
                <Text style={s.resultNombre} numberOfLines={1}>{item.nombre}</Text>
                <Text style={s.resultPrecio}>${Number(item.precioUnitario).toFixed(2)}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <FlatList
        data={comanda.items}
        keyExtractor={(_, i) => String(i)}
        style={s.lista}
        contentContainerStyle={{ paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={s.vacio}>
            <Ionicons name="fast-food-outline" size={48} color="#cbd5e1" />
            <Text style={s.vacioTxt}>Busca un producto arriba para agregarlo al pedido.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          return (
            <View style={[s.itemRow, item.enviadoCocina ? s.itemEnviado : s.itemNuevo, item.facturado && s.itemFacturado]}>
              {seleccion && !item.facturado && (
                <TouchableOpacity onPress={() => toggleSeleccion(index)} style={s.checkbox}>
                  <Ionicons
                    name={seleccion.has(index) ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={seleccion.has(index) ? '#1e40af' : '#94a3b8'}
                  />
                </TouchableOpacity>
              )}
              <View style={s.itemCant}>
                <TouchableOpacity style={s.ctrBtn} onPress={() => cambiarCantidad(index, -1)} disabled={item.facturado || !!seleccion}>
                  <Ionicons name="remove" size={16} color="#1e40af" />
                </TouchableOpacity>
                <Text style={s.ctrQty}>{item.cantidad}</Text>
                <TouchableOpacity style={s.ctrBtn} onPress={() => cambiarCantidad(index, 1)} disabled={item.facturado || !!seleccion}>
                  <Ionicons name="add" size={16} color="#1e40af" />
                </TouchableOpacity>
              </View>
              <View style={s.itemInfo}>
                <Text style={s.itemNombre} numberOfLines={2}>{item.descripcion}</Text>
                {item.nota ? <Text style={s.itemNota}>📝 {item.nota}</Text> : null}
              </View>
              <Text style={s.itemPrecio}>${(item.cantidad * item.precioUnitario).toFixed(2)}</Text>
              {!item.facturado && !seleccion && (
                <TouchableOpacity onPress={() => quitarItem(index)}>
                  <Ionicons name="trash-outline" size={18} color="#ef4444" />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      <View style={s.footer}>
        <View style={s.footerTotales}>
          <Text style={s.footerLabel}>Subtotal</Text>
          <Text style={s.footerValor}>${comanda.subtotal.toFixed(2)}</Text>
          <Text style={s.footerLabel}>IVA</Text>
          <Text style={s.footerValor}>${comanda.totalIva.toFixed(2)}</Text>
        </View>
        <View style={[s.footerTotales, s.footerTotalBig]}>
          <Text style={s.footerTotalLbl}>{seleccion ? 'Pendiente' : 'Total'}</Text>
          <Text style={s.footerTotalVal}>${comanda.total.toFixed(2)}</Text>
        </View>
        {seleccion && seleccion.size > 0 && (
          <View style={s.footerTotales}>
            <Text style={s.footerLabel}>Seleccionado</Text>
            <Text style={s.footerValor}>${totalSeleccionado.toFixed(2)}</Text>
          </View>
        )}
        <View style={s.acciones}>
          {!seleccion && (
            <TouchableOpacity style={s.anularBtn} onPress={anular}>
              <Text style={s.anularBtnTxt}>Anular</Text>
            </TouchableOpacity>
          )}
          {!seleccion && (
            <TouchableOpacity
              style={[s.cocinaBtn, (enviandoCocina || pendientesCocina === 0) && s.btnDisabled]}
              onPress={enviarCocina}
              disabled={enviandoCocina || pendientesCocina === 0}
            >
              {enviandoCocina
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.cocinaBtnTxt}>🔥 Cocina{pendientesCocina ? ` (${pendientesCocina})` : ''}</Text>}
            </TouchableOpacity>
          )}
          {editablesCount > 1 && (
            <TouchableOpacity style={s.dividirBtn} onPress={toggleModoDividir}>
              <Text style={s.dividirBtnTxt}>{seleccion ? 'Cancelar' : '🔀 Dividir'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.cobrarBtn, seleccion && seleccion.size === 0 && s.btnDisabled]}
            onPress={irACobrar}
            disabled={!!seleccion && seleccion.size === 0}
          >
            <Text style={s.cobrarBtnTxt}>{seleccion ? `💳 Cobrar (${seleccion.size})` : '💳 Cobrar'}</Text>
          </TouchableOpacity>
        </View>
        {guardando && <Text style={s.guardandoTxt}>Guardando...</Text>}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  resultados: { marginHorizontal: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8, elevation: 3 },
  resultItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  resultNombre: { flex: 1, fontSize: 14, color: '#1e293b' },
  resultPrecio: { fontSize: 14, fontWeight: '700', color: '#1e40af' },
  lista: { flex: 1, paddingHorizontal: 12 },
  vacio: { alignItems: 'center', paddingVertical: 48 },
  vacioTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, marginBottom: 8, borderLeftWidth: 4, borderLeftColor: '#94a3b8' },
  checkbox: { padding: 2 },
  itemNuevo: { borderLeftColor: '#f59e0b', backgroundColor: '#fffbeb' },
  itemEnviado: { borderLeftColor: '#10b981' },
  itemFacturado: { opacity: 0.6, borderLeftColor: '#16a34a' },
  itemCant: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ctrBtn: { width: 26, height: 26, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  ctrQty: { fontSize: 14, fontWeight: '700', minWidth: 18, textAlign: 'center', color: '#1e293b' },
  itemInfo: { flex: 1 },
  itemNombre: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  itemNota: { fontSize: 12, color: '#64748b', marginTop: 2 },
  itemPrecio: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  footer: { backgroundColor: '#fff', padding: 14, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  footerTotales: { flexDirection: 'row', gap: 10, marginBottom: 4, alignItems: 'baseline' },
  footerLabel: { fontSize: 12, color: '#64748b' },
  footerValor: { fontSize: 13, color: '#1e293b', fontWeight: '600' },
  footerTotalBig: { marginTop: 4, marginBottom: 10 },
  footerTotalLbl: { fontSize: 15, fontWeight: '800', color: '#1e293b' },
  footerTotalVal: { fontSize: 20, fontWeight: '800', color: '#1e40af' },
  acciones: { flexDirection: 'row', gap: 8 },
  anularBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  anularBtnTxt: { color: '#64748b', fontWeight: '600', fontSize: 13 },
  cocinaBtn: { flex: 1, backgroundColor: '#f59e0b', borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  cocinaBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  dividirBtn: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#7c3aed' },
  dividirBtnTxt: { color: '#7c3aed', fontWeight: '700', fontSize: 13 },
  cobrarBtn: { flex: 1, backgroundColor: '#1e40af', borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  cobrarBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  guardandoTxt: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8 },
});
