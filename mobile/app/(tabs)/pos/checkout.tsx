import { useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../services/api';
import { usePrint } from '../../../hooks/usePrint';
import type { ItemCarrito } from '../../../types';

const FORMAS_PAGO_NOTA = ['Efectivo', 'Transferencia', 'Tarjeta débito', 'Tarjeta crédito', 'Aplicaciones'];
const FORMAS_PAGO_FACTURA = [
  { value: '01', label: 'Efectivo' },
  { value: '16', label: 'Tarjeta débito' },
  { value: '19', label: 'Tarjeta crédito' },
  { value: '20', label: 'Transferencia' },
];

export default function CheckoutScreen() {
  const router = useRouter();
  const { imprimir, imprimiendo } = usePrint();

  const params = useLocalSearchParams<{
    carrito: string; tipoDocumento: string; tipoId: string;
    identificacion: string; razonSocial: string;
    total: string; totalConIva: string; subtotal: string;
  }>();

  const carrito: ItemCarrito[] = JSON.parse(params.carrito || '[]');
  const tipoDocumento = params.tipoDocumento as 'factura' | 'nota_venta';
  const total = parseFloat(params.total || '0');
  const totalConIva = parseFloat(params.totalConIva || '0');

  const [formaPago, setFormaPago] = useState(tipoDocumento === 'factura' ? '01' : 'Efectivo');
  const [montoPagado, setMontoPagado] = useState(total.toFixed(2));
  const [emitiendo, setEmitiendo] = useState(false);
  const [docEmitido, setDocEmitido] = useState<{ id: number; numero: string; total: number; tipo: 'nota_venta' | 'factura' } | null>(null);

  const cambio = Math.max(0, parseFloat(montoPagado || '0') - total);

  const emitir = async () => {
    setEmitiendo(true);
    try {
      const fechaEmision = new Date().toISOString().slice(0, 10);

      if (tipoDocumento === 'nota_venta') {
        const res = await api.post('/notas-venta', {
          tipoIdentificacion: params.tipoId,
          identificacion: params.identificacion,
          razonSocial: params.razonSocial,
          formaPago,
          fechaEmision,
          detalles: carrito.map((i) => ({
            codigoPrincipal: i.codigoPrincipal, descripcion: i.descripcion,
            cantidad: i.cantidad, precioUnitario: i.precioUnitario, descuento: 0,
          })),
        });
        const d = res.data?.data;
        setDocEmitido({ id: d?.id, numero: d?.numeroNota || '—', total: d?.total ?? total, tipo: 'nota_venta' });
      } else {
        const res = await api.post('/facturas', {
          tipoIdentificacionComprador: params.tipoId,
          identificacionComprador: params.identificacion,
          razonSocialComprador: params.razonSocial,
          fechaEmision,
          detalles: carrito.map((i) => ({
            codigoPrincipal: i.codigoPrincipal, descripcion: i.descripcion,
            cantidad: i.cantidad, precioUnitario: i.precioUnitario,
            descuento: 0, ivaPorcentaje: i.ivaPorcentaje,
          })),
          pagos: [{ formaPago, total: totalConIva, plazo: 0, unidadTiempo: 'dias' }],
        });
        const d = res.data?.data;
        setDocEmitido({ id: d?.id, numero: d?.numeroFactura || '—', total: d?.importeTotal ?? total, tipo: 'factura' });
      }
    } catch (err: any) {
      Alert.alert('Error al emitir', err.response?.data?.mensaje || err.response?.data?.error || 'No se pudo emitir el documento');
    } finally {
      setEmitiendo(false);
    }
  };

  // ── Pantalla de éxito ──────────────────────────────────────────────────────
  if (docEmitido) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={s.exitoScroll}>
          <View style={s.exitoIcono}>
            <Ionicons name="checkmark-circle" size={80} color="#22c55e" />
          </View>
          <Text style={s.exitoTitulo}>¡Documento emitido!</Text>
          <Text style={s.exitoTipo}>{docEmitido.tipo === 'factura' ? 'Factura' : 'Nota de venta'}</Text>
          <Text style={s.exitoNumero}>{docEmitido.numero}</Text>
          <Text style={s.exitoTotal}>${docEmitido.total.toFixed(2)}</Text>
          {cambio > 0 && (
            <View style={s.cambioBox}>
              <Text style={s.cambioLbl}>Cambio al cliente</Text>
              <Text style={s.cambioVal}>${cambio.toFixed(2)}</Text>
            </View>
          )}

          {/* Botón imprimir */}
          <TouchableOpacity
            style={[s.imprimirBtn, imprimiendo && s.btnDisabled]}
            onPress={() => imprimir(docEmitido.id, docEmitido.tipo)}
            disabled={imprimiendo}
            activeOpacity={0.85}
          >
            {imprimiendo
              ? <ActivityIndicator color="#1e40af" />
              : <>
                <Ionicons name="print-outline" size={20} color="#1e40af" />
                <Text style={s.imprimirBtnTxt}>Imprimir / Compartir recibo</Text>
              </>
            }
          </TouchableOpacity>

          <TouchableOpacity style={s.nuevoBtn} onPress={() => router.replace('/(tabs)/pos')} activeOpacity={0.85}>
            <Ionicons name="add-circle-outline" size={20} color="#fff" />
            <Text style={s.nuevoBtnTxt}>Nueva venta</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Formulario de cobro ────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Cliente */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Cliente</Text>
          <Text style={s.clienteNombre}>{params.razonSocial}</Text>
          {params.tipoId !== '07' && <Text style={s.clienteId}>{params.identificacion}</Text>}
        </View>

        {/* Productos */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Productos ({carrito.length})</Text>
          {carrito.map((item) => (
            <View key={item.codigoPrincipal} style={s.itemRow}>
              <Text style={s.itemNombre} numberOfLines={1}>{item.descripcion}</Text>
              <Text style={s.itemQty}>{item.cantidad}x</Text>
              <Text style={s.itemTotal}>${(item.cantidad * item.precioUnitario).toFixed(2)}</Text>
            </View>
          ))}
          <View style={s.divider} />
          <View style={s.totalRow}>
            <Text style={s.totalLbl}>Subtotal</Text>
            <Text style={s.totalVal}>${params.subtotal}</Text>
          </View>
          {tipoDocumento === 'factura' && (
            <View style={s.totalRow}>
              <Text style={s.totalLbl}>IVA</Text>
              <Text style={s.totalVal}>${(totalConIva - parseFloat(params.subtotal)).toFixed(2)}</Text>
            </View>
          )}
          <View style={[s.totalRow, s.totalFinal]}>
            <Text style={s.totalFinalLbl}>TOTAL</Text>
            <Text style={s.totalFinalVal}>${total.toFixed(2)}</Text>
          </View>
        </View>

        {/* Forma de pago */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Forma de pago</Text>
          {tipoDocumento === 'nota_venta'
            ? FORMAS_PAGO_NOTA.map((fp) => (
              <TouchableOpacity key={fp} style={[s.fpOpt, formaPago === fp && s.fpOptActive]} onPress={() => setFormaPago(fp)}>
                <View style={[s.fpRadio, formaPago === fp && s.fpRadioActive]} />
                <Text style={[s.fpLabel, formaPago === fp && s.fpLabelActive]}>{fp}</Text>
              </TouchableOpacity>
            ))
            : FORMAS_PAGO_FACTURA.map((fp) => (
              <TouchableOpacity key={fp.value} style={[s.fpOpt, formaPago === fp.value && s.fpOptActive]} onPress={() => setFormaPago(fp.value)}>
                <View style={[s.fpRadio, formaPago === fp.value && s.fpRadioActive]} />
                <Text style={[s.fpLabel, formaPago === fp.value && s.fpLabelActive]}>{fp.label}</Text>
              </TouchableOpacity>
            ))
          }
        </View>

        {/* Monto recibido */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Monto recibido</Text>
          <TextInput
            style={s.montoInput}
            value={montoPagado}
            onChangeText={setMontoPagado}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#94a3b8"
          />
          {cambio > 0 && (
            <View style={s.cambioRow}>
              <Text style={s.cambioLblInline}>Cambio</Text>
              <Text style={s.cambioValInline}>${cambio.toFixed(2)}</Text>
            </View>
          )}
        </View>

        {/* Emitir */}
        <TouchableOpacity style={[s.emitirBtn, emitiendo && s.btnDisabled]} onPress={emitir} disabled={emitiendo} activeOpacity={0.85}>
          {emitiendo
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={s.emitirBtnTxt}>Emitir {tipoDocumento === 'factura' ? 'Factura' : 'Nota de venta'}</Text>
            </>
          }
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelarBtn} onPress={() => router.back()} disabled={emitiendo}>
          <Text style={s.cancelarBtnTxt}>Cancelar</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  cardTitle: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  clienteNombre: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  clienteId: { fontSize: 13, color: '#64748b', marginTop: 2 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  itemNombre: { flex: 1, fontSize: 14, color: '#1e293b' },
  itemQty: { fontSize: 13, color: '#64748b', marginHorizontal: 8 },
  itemTotal: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  totalLbl: { fontSize: 13, color: '#64748b' },
  totalVal: { fontSize: 13, color: '#1e293b' },
  totalFinal: { marginTop: 6 },
  totalFinalLbl: { fontSize: 16, fontWeight: '800', color: '#1e293b' },
  totalFinalVal: { fontSize: 20, fontWeight: '800', color: '#1e40af' },
  fpOpt: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 8, gap: 10 },
  fpOptActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  fpRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#cbd5e1' },
  fpRadioActive: { borderColor: '#1e40af', backgroundColor: '#1e40af' },
  fpLabel: { fontSize: 15, color: '#475569' },
  fpLabelActive: { color: '#1e40af', fontWeight: '600' },
  montoInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 22, color: '#1e293b', fontWeight: '700' },
  cambioRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, backgroundColor: '#f0fdf4', borderRadius: 8, padding: 10 },
  cambioLblInline: { fontSize: 14, color: '#166534', fontWeight: '600' },
  cambioValInline: { fontSize: 16, color: '#166534', fontWeight: '800' },
  emitirBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  btnDisabled: { opacity: 0.6 },
  emitirBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelarBtn: { alignItems: 'center', padding: 12 },
  cancelarBtnTxt: { fontSize: 15, color: '#64748b' },
  // Éxito
  exitoScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  exitoIcono: { marginBottom: 16 },
  exitoTitulo: { fontSize: 24, fontWeight: '800', color: '#1e293b', marginBottom: 6 },
  exitoTipo: { fontSize: 14, color: '#64748b', marginBottom: 4 },
  exitoNumero: { fontSize: 18, fontWeight: '700', color: '#1e40af', marginBottom: 4 },
  exitoTotal: { fontSize: 36, fontWeight: '800', color: '#22c55e', marginBottom: 16 },
  cambioBox: { backgroundColor: '#f0fdf4', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, alignItems: 'center', marginBottom: 24 },
  cambioLbl: { fontSize: 13, color: '#166534' },
  cambioVal: { fontSize: 28, fontWeight: '800', color: '#166534' },
  imprimirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderColor: '#1e40af', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginBottom: 12, backgroundColor: '#eff6ff' },
  imprimirBtnTxt: { color: '#1e40af', fontSize: 15, fontWeight: '700' },
  nuevoBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nuevoBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
