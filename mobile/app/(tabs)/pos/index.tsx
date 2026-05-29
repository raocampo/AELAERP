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
import { useRouter } from 'expo-router';
import api from '../../../services/api';
import { useAuth } from '../../../context/AuthContext';
import { useSRILookup } from '../../../hooks/useSRILookup';
import type { ItemCarrito, Producto } from '../../../types';

const TIPOS_ID = [
  { valor: '07', label: 'Consumidor Final' },
  { valor: '05', label: 'Cédula' },
  { valor: '04', label: 'RUC' },
  { valor: '06', label: 'Pasaporte' },
];

export default function PosScreen() {
  const router = useRouter();
  const { sistema } = useAuth();
  const { buscar: buscarSRI, buscando: buscandoSRI, mensaje: mensajeSRI, limpiar: limpiarMensajeSRI } = useSRILookup();

  const [tipoDocumento, setTipoDocumento] = useState<'factura' | 'nota_venta'>(
    sistema?.documentoPosDefault || 'nota_venta',
  );
  const [tipoId, setTipoId] = useState('07');
  const [identificacion, setIdentificacion] = useState('9999999999999');
  const [razonSocial, setRazonSocial] = useState('CONSUMIDOR FINAL');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscandoProd, setBuscandoProd] = useState(false);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const busquedaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetCliente = (tipo: string) => {
    if (tipo === '07') {
      setIdentificacion('9999999999999');
      setRazonSocial('CONSUMIDOR FINAL');
    } else {
      setIdentificacion('');
      setRazonSocial('');
    }
    limpiarMensajeSRI();
  };

  // Búsqueda SRI al perder foco en identificación
  const handleIdentificacionBlur = () => {
    buscarSRI(identificacion, tipoId, (datos) => {
      setRazonSocial(datos.razonSocial);
    });
  };

  // Búsqueda productos con debounce
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
  const total = tipoDocumento === 'factura' ? totalConIva : subtotal;

  const irACheckout = () => {
    if (carrito.length === 0) { Alert.alert('Carrito vacío', 'Agrega al menos un producto.'); return; }
    router.push({
      pathname: '/(tabs)/pos/checkout',
      params: {
        carrito: JSON.stringify(carrito),
        tipoDocumento,
        tipoId,
        identificacion,
        razonSocial,
        total: total.toFixed(2),
        totalConIva: totalConIva.toFixed(2),
        subtotal: subtotal.toFixed(2),
      },
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* Selector tipo documento */}
      <View style={s.tipoRow}>
        {(['nota_venta', 'factura'] as const).map((tipo) => (
          <TouchableOpacity key={tipo} style={[s.tipoBt, tipoDocumento === tipo && s.tipoBtActive]} onPress={() => setTipoDocumento(tipo)}>
            <Text style={[s.tipoBtTxt, tipoDocumento === tipo && s.tipoBtTxtActive]}>
              {tipo === 'factura' ? 'Factura' : 'Nota de venta'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Selector tipo cliente — chips compactos */}
      <View style={s.clienteRow}>
        {TIPOS_ID.map((t) => (
          <TouchableOpacity
            key={t.valor}
            style={[s.idBt, tipoId === t.valor && s.idBtActive]}
            onPress={() => { setTipoId(t.valor); resetCliente(t.valor); }}
          >
            <Text style={[s.idBtTxt, tipoId === t.valor && s.idBtTxtActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Datos cliente cuando no es consumidor final */}
      {tipoId !== '07' && (
        <View style={s.clienteInputs}>
          <View style={s.idRow}>
            <TextInput
              style={[s.inputSm, { flex: 1 }]}
              value={identificacion}
              onChangeText={(v) => { setIdentificacion(v); limpiarMensajeSRI(); }}
              onBlur={handleIdentificacionBlur}
              onSubmitEditing={handleIdentificacionBlur}
              placeholder={tipoId === '04' ? 'RUC (13 dígitos)' : 'Cédula (10 dígitos)'}
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
              returnKeyType="search"
            />
            <TouchableOpacity
              style={s.sriBt}
              onPress={handleIdentificacionBlur}
              disabled={buscandoSRI}
            >
              {buscandoSRI
                ? <ActivityIndicator size="small" color="#1e40af" />
                : <Ionicons name="search" size={18} color="#1e40af" />
              }
            </TouchableOpacity>
          </View>
          {mensajeSRI ? (
            <Text style={[s.mensajeSRI, mensajeSRI.startsWith('Completa') && s.mensajeSRIWarn]}>
              {mensajeSRI}
            </Text>
          ) : null}
          <TextInput
            style={s.inputSm}
            value={razonSocial}
            onChangeText={setRazonSocial}
            placeholder="Razón social / Nombre"
            placeholderTextColor="#94a3b8"
          />
        </View>
      )}

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

      {/* Resultados búsqueda */}
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
                <View style={s.resultRight}>
                  <Text style={s.resultPrecio}>${Number(item.precioUnitario).toFixed(2)}</Text>
                  {item.inventariable && (
                    <Text style={[s.resultStock, item.stockActual <= 0 && s.stockAgotado]}>
                      Stock: {item.stockActual}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Carrito */}
      <FlatList
        data={carrito}
        keyExtractor={(i) => i.codigoPrincipal}
        style={s.carrito}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={s.emptyCarrito}>
            <Ionicons name="cart-outline" size={48} color="#cbd5e1" />
            <Text style={s.emptyCarritoTxt}>Carrito vacío — busca un producto</Text>
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

      {/* Footer */}
      {carrito.length > 0 && (
        <View style={s.footer}>
          <View style={s.footerTotales}>
            <Text style={s.footerLabel}>Subtotal</Text>
            <Text style={s.footerValor}>${subtotal.toFixed(2)}</Text>
          </View>
          {tipoDocumento === 'factura' && (
            <View style={s.footerTotales}>
              <Text style={s.footerLabel}>IVA</Text>
              <Text style={s.footerValor}>${(totalConIva - subtotal).toFixed(2)}</Text>
            </View>
          )}
          <View style={[s.footerTotales, s.footerTotalBig]}>
            <Text style={s.footerTotalLbl}>TOTAL</Text>
            <Text style={s.footerTotalVal}>${total.toFixed(2)}</Text>
          </View>
          <TouchableOpacity style={s.cobrarBtn} onPress={irACheckout} activeOpacity={0.85}>
            <Ionicons name="cash-outline" size={20} color="#fff" />
            <Text style={s.cobrarBtnTxt}>Cobrar ${total.toFixed(2)}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  tipoRow: { flexDirection: 'row', margin: 12, gap: 8 },
  tipoBt: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', alignItems: 'center' },
  tipoBtActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  tipoBtTxt: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  tipoBtTxtActive: { color: '#1e40af' },
  // Fila de chips tipo cliente — NO usar ScrollView (se expande en Android)
  clienteRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 12, paddingBottom: 8,
  },
  idBt: {
    paddingHorizontal: 11, paddingVertical: 5,
    borderRadius: 14, backgroundColor: '#f1f5f9',
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  idBtActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  idBtTxt: { fontSize: 12, color: '#475569', fontWeight: '500' },
  idBtTxtActive: { color: '#1e40af', fontWeight: '700' },
  clienteInputs: { paddingHorizontal: 12, gap: 6, marginBottom: 6 },
  idRow: { flexDirection: 'row', gap: 6 },
  inputSm: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: '#1e293b' },
  sriBt: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#93c5fd', borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  mensajeSRI: { fontSize: 12, color: '#64748b', paddingHorizontal: 4 },
  mensajeSRIWarn: { color: '#d97706' },
  searchBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10 },
  searchIcon: { marginLeft: 10 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  resultados: { marginHorizontal: 12, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8, elevation: 3 },
  resultItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  resultInfo: { flex: 1 },
  resultNombre: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  resultCodigo: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  resultRight: { alignItems: 'flex-end', marginLeft: 12 },
  resultPrecio: { fontSize: 15, fontWeight: '700', color: '#1e40af' },
  resultStock: { fontSize: 11, color: '#22c55e', marginTop: 2 },
  stockAgotado: { color: '#ef4444' },
  carrito: { flex: 1, paddingHorizontal: 12 },
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
  cobrarBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  cobrarBtnTxt: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
