import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
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
import { useSRILookup } from '../../../hooks/useSRILookup';
import { usePrint } from '../../../hooks/usePrint';
import type { ItemCarrito, Producto } from '../../../types';

const TIPOS_ID = [
  { valor: '07', label: 'Consumidor Final' },
  { valor: '05', label: 'Cédula' },
  { valor: '04', label: 'RUC' },
];
const FORMAS_PAGO = [
  { value: '01', label: 'Efectivo' },
  { value: '16', label: 'Tarjeta débito' },
  { value: '19', label: 'Tarjeta crédito' },
  { value: '20', label: 'Transferencia' },
];

export default function NuevaFacturaScreen() {
  const router = useRouter();
  const { buscar: buscarSRI, buscando: buscandoSRI, mensaje: mensajeSRI, limpiar: limpiarMensajeSRI } = useSRILookup();
  const { imprimir, imprimiendo } = usePrint();

  const [tipoId, setTipoId] = useState('07');
  const [identificacion, setIdentificacion] = useState('9999999999999');
  const [razonSocial, setRazonSocial] = useState('CONSUMIDOR FINAL');
  const [formaPago, setFormaPago] = useState('01');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscandoProd, setBuscandoProd] = useState(false);
  const [carrito, setCarrito] = useState<ItemCarrito[]>([]);
  const [emitiendo, setEmitiendo] = useState(false);
  const [facturaEmitida, setFacturaEmitida] = useState<{ id: number; numero: string; total: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetCliente = (tipo: string) => {
    if (tipo === '07') { setIdentificacion('9999999999999'); setRazonSocial('CONSUMIDOR FINAL'); }
    else { setIdentificacion(''); setRazonSocial(''); }
    limpiarMensajeSRI();
  };

  const handleIdBlur = () => {
    buscarSRI(identificacion, tipoId, (datos) => {
      setRazonSocial(datos.razonSocial);
    });
  };

  useEffect(() => {
    if (busqueda.trim().length < 1) { setResultados([]); return; }
    setBuscandoProd(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await api.get('/productos/buscar', { params: { q: busqueda } });
        setResultados(res.data?.data || []);
      } catch { setResultados([]); }
      finally { setBuscandoProd(false); }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [busqueda]);

  const agregar = useCallback((prod: Producto) => {
    setCarrito((prev) => {
      const existe = prev.find((i) => i.codigoPrincipal === prod.codigoPrincipal);
      if (existe) return prev.map((i) => i.codigoPrincipal === prod.codigoPrincipal ? { ...i, cantidad: i.cantidad + 1 } : i);
      return [...prev, { codigoPrincipal: prod.codigoPrincipal, descripcion: prod.nombre, cantidad: 1, precioUnitario: Number(prod.precioUnitario || 0), ivaPorcentaje: Number(prod.tarifaIva || 0) }];
    });
    setBusqueda(''); setResultados([]);
  }, []);

  const quitar = (codigo: string) => setCarrito((prev) => prev.filter((i) => i.codigoPrincipal !== codigo));

  const totalConIva = carrito.reduce((acc, i) => {
    const l = i.cantidad * i.precioUnitario; return acc + l + l * (i.ivaPorcentaje / 100);
  }, 0);

  const emitir = async () => {
    if (carrito.length === 0) { Alert.alert('Carrito vacío', 'Agrega al menos un producto.'); return; }
    if (tipoId !== '07' && !identificacion.trim()) { Alert.alert('Identificación requerida'); return; }
    setEmitiendo(true);
    try {
      const res = await api.post('/facturas', {
        tipoIdentificacionComprador: tipoId,
        identificacionComprador: identificacion,
        razonSocialComprador: razonSocial,
        fechaEmision: new Date().toISOString().slice(0, 10),
        detalles: carrito.map((i) => ({ codigoPrincipal: i.codigoPrincipal, descripcion: i.descripcion, cantidad: i.cantidad, precioUnitario: i.precioUnitario, descuento: 0, ivaPorcentaje: i.ivaPorcentaje })),
        pagos: [{ formaPago, total: totalConIva, plazo: 0, unidadTiempo: 'dias' }],
      });
      const d = res.data?.data;
      setFacturaEmitida({ id: d?.id, numero: d?.numeroFactura || '—', total: Number(d?.importeTotal || totalConIva) });
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo emitir la factura');
    } finally {
      setEmitiendo(false);
    }
  };

  // ── Pantalla de éxito ──────────────────────────────────────────────────────
  if (facturaEmitida) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.exito}>
          <Ionicons name="checkmark-circle" size={72} color="#22c55e" />
          <Text style={s.exitoTitulo}>¡Factura emitida!</Text>
          <Text style={s.exitoNumero}>{facturaEmitida.numero}</Text>
          <Text style={s.exitoTotal}>${facturaEmitida.total.toFixed(2)}</Text>
          <TouchableOpacity
            style={[s.imprimirBtn, imprimiendo && s.btnDisabled]}
            onPress={() => imprimir(facturaEmitida.id, 'factura')}
            disabled={imprimiendo}
            activeOpacity={0.85}
          >
            {imprimiendo
              ? <ActivityIndicator color="#1e40af" />
              : <>
                <Ionicons name="print-outline" size={20} color="#1e40af" />
                <Text style={s.imprimirBtnTxt}>Imprimir / Compartir</Text>
              </>
            }
          </TouchableOpacity>
          <TouchableOpacity style={s.volverBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
            <Text style={s.volverBtnTxt}>Volver a facturas</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Formulario ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Tipo cliente */}
        <Text style={s.sectionLbl}>Tipo de cliente</Text>
        <View style={s.tipoRow}>
          {TIPOS_ID.map((t) => (
            <TouchableOpacity key={t.valor} style={[s.tipoBt, tipoId === t.valor && s.tipoBtActive]}
              onPress={() => { setTipoId(t.valor); resetCliente(t.valor); }}>
              <Text style={[s.tipoBtTxt, tipoId === t.valor && s.tipoBtTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tipoId !== '07' && (
          <>
            <Text style={s.label}>Identificación</Text>
            <View style={s.idRow}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={identificacion}
                onChangeText={(v) => { setIdentificacion(v); limpiarMensajeSRI(); }}
                onBlur={handleIdBlur}
                onSubmitEditing={handleIdBlur}
                keyboardType="numeric"
                placeholder={tipoId === '04' ? 'RUC (13 dígitos)' : 'Cédula (10 dígitos)'}
                placeholderTextColor="#94a3b8"
                returnKeyType="search"
              />
              <TouchableOpacity style={s.sriBt} onPress={handleIdBlur} disabled={buscandoSRI}>
                {buscandoSRI
                  ? <ActivityIndicator size="small" color="#1e40af" />
                  : <Ionicons name="search" size={18} color="#1e40af" />
                }
              </TouchableOpacity>
            </View>
            {mensajeSRI ? <Text style={s.mensajeSRI}>{mensajeSRI}</Text> : null}
            <Text style={s.label}>Razón social</Text>
            <TextInput style={s.input} value={razonSocial} onChangeText={setRazonSocial} placeholder="Nombre del cliente" placeholderTextColor="#94a3b8" />
          </>
        )}

        {/* Productos */}
        <Text style={s.sectionLbl}>Productos</Text>
        <View style={s.searchBox}>
          <Ionicons name="search-outline" size={17} color="#94a3b8" style={{ marginLeft: 10 }} />
          <TextInput style={s.searchInput} value={busqueda} onChangeText={setBusqueda} placeholder="Buscar producto..." placeholderTextColor="#94a3b8" />
          {buscandoProd && <ActivityIndicator size="small" color="#1e40af" style={{ marginRight: 10 }} />}
        </View>

        {resultados.length > 0 && (
          <View style={s.resultados}>
            {resultados.slice(0, 8).map((item) => (
              <TouchableOpacity key={item.codigoPrincipal} style={s.resultItem} onPress={() => agregar(item)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultNombre}>{item.nombre}</Text>
                  <Text style={s.resultCodigo}>{item.codigoPrincipal}</Text>
                </View>
                <Text style={s.resultPrecio}>${Number(item.precioUnitario).toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {carrito.length > 0 && (
          <View style={s.carritoBox}>
            {carrito.map((item) => (
              <View key={item.codigoPrincipal} style={s.carritoItem}>
                <View style={{ flex: 1 }}>
                  <Text style={s.carritoNombre} numberOfLines={1}>{item.descripcion}</Text>
                  <Text style={s.carritoSub}>{item.cantidad}x ${item.precioUnitario.toFixed(2)}{item.ivaPorcentaje > 0 ? ` +IVA${item.ivaPorcentaje}%` : ''}</Text>
                </View>
                <Text style={s.carritoTotal}>${(item.cantidad * item.precioUnitario).toFixed(2)}</Text>
                <TouchableOpacity onPress={() => quitar(item.codigoPrincipal)} style={{ marginLeft: 8 }}>
                  <Ionicons name="close-circle" size={20} color="#ef4444" />
                </TouchableOpacity>
              </View>
            ))}
            <View style={s.totalRow}>
              <Text style={s.totalLbl}>TOTAL (con IVA)</Text>
              <Text style={s.totalVal}>${totalConIva.toFixed(2)}</Text>
            </View>
          </View>
        )}

        {/* Forma de pago */}
        <Text style={s.sectionLbl}>Forma de pago</Text>
        <View style={s.fpRow}>
          {FORMAS_PAGO.map((fp) => (
            <TouchableOpacity key={fp.value} style={[s.fpBt, formaPago === fp.value && s.fpBtActive]} onPress={() => setFormaPago(fp.value)}>
              <Text style={[s.fpBtTxt, formaPago === fp.value && s.fpBtTxtActive]}>{fp.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={[s.emitirBtn, emitiendo && s.btnDisabled]} onPress={emitir} disabled={emitiendo} activeOpacity={0.85}>
          {emitiendo
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              <Text style={s.emitirBtnTxt}>Emitir factura</Text>
            </>
          }
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelarBtn} onPress={() => router.back()}>
          <Text style={s.cancelarBtnTxt}>Cancelar</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 32 },
  sectionLbl: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16 },
  tipoRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  tipoBt: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', alignItems: 'center' },
  tipoBtActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  tipoBtTxt: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tipoBtTxtActive: { color: '#1e40af' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 6 },
  idRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 11, fontSize: 14, color: '#1e293b', marginBottom: 10 },
  sriBt: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#93c5fd', borderRadius: 8, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  mensajeSRI: { fontSize: 12, color: '#d97706', marginBottom: 8, paddingHorizontal: 4 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, marginBottom: 8 },
  searchInput: { flex: 1, padding: 11, fontSize: 14, color: '#1e293b' },
  resultados: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10, overflow: 'hidden' },
  resultItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  resultNombre: { fontSize: 14, color: '#1e293b' },
  resultCodigo: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  resultPrecio: { fontSize: 14, fontWeight: '700', color: '#1e40af', marginLeft: 8 },
  carritoBox: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, marginBottom: 4 },
  carritoItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  carritoNombre: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  carritoSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  carritoTotal: { fontSize: 14, fontWeight: '700', color: '#1e40af' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10, marginTop: 6 },
  totalLbl: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  totalVal: { fontSize: 18, fontWeight: '800', color: '#1e40af' },
  fpRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  fpBt: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  fpBtActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  fpBtTxt: { fontSize: 13, color: '#64748b' },
  fpBtTxtActive: { color: '#1e40af', fontWeight: '700' },
  emitirBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  btnDisabled: { opacity: 0.6 },
  emitirBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelarBtn: { alignItems: 'center', padding: 14 },
  cancelarBtnTxt: { fontSize: 15, color: '#64748b' },
  // Éxito
  exito: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  exitoTitulo: { fontSize: 24, fontWeight: '800', color: '#1e293b', marginTop: 16, marginBottom: 8 },
  exitoNumero: { fontSize: 18, fontWeight: '700', color: '#1e40af', marginBottom: 4 },
  exitoTotal: { fontSize: 32, fontWeight: '800', color: '#22c55e', marginBottom: 24 },
  imprimirBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 2, borderColor: '#1e40af', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginBottom: 12, backgroundColor: '#eff6ff' },
  imprimirBtnTxt: { color: '#1e40af', fontSize: 15, fontWeight: '700' },
  volverBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  volverBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
