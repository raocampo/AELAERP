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
    // Mesas y Comandas: si esta venta viene de "Cobrar" en una comanda
    // (ver restaurante/comanda.tsx), estos vienen presentes — al emitir con
    // éxito se enlaza el documento y se libera (o no, si es cuenta
    // dividida) la mesa, igual que PuntoVenta.jsx en la web.
    comandaId?: string; mesaNombre?: string; indices?: string;
  }>();
  const vieneDeComanda = Boolean(params.comandaId);

  const carrito: ItemCarrito[] = JSON.parse(params.carrito || '[]');
  const tipoDocumento = params.tipoDocumento as 'factura' | 'nota_venta';
  const total = parseFloat(params.total || '0');
  const totalConIva = parseFloat(params.totalConIva || '0');

  // Pagos mixtos: 1+ líneas {formaPago, monto}. Con 1 sola línea se permite
  // recibir de más y calcular cambio (comportamiento de siempre en mobile);
  // con 2+ líneas la suma debe cuadrar EXACTO con el total (mismo criterio
  // que PuntoVenta.jsx en la web — no tiene sentido "dar vuelto" repartido
  // entre varias formas de pago).
  const [pagos, setPagos] = useState<{ formaPago: string; monto: string }[]>([
    { formaPago: tipoDocumento === 'factura' ? '01' : 'Efectivo', monto: total.toFixed(2) },
  ]);
  const [emitiendo, setEmitiendo] = useState(false);
  const [docEmitido, setDocEmitido] = useState<{ id: number; numero: string; total: number; tipo: 'nota_venta' | 'factura'; cierre?: { ok: boolean; mesaLiberada: boolean; totalRestante: number } } | null>(null);

  const totalPagos = pagos.reduce((a, p) => a + (parseFloat(p.monto) || 0), 0);
  const cambio = pagos.length === 1 ? Math.max(0, totalPagos - total) : 0;
  const restante = Number((total - totalPagos).toFixed(2));
  const pagosCuadran = pagos.length === 1 ? totalPagos >= total : Math.abs(restante) < 0.01;

  const agregarLineaPago = () => {
    setPagos((prev) => [
      ...prev,
      { formaPago: tipoDocumento === 'factura' ? '01' : 'Efectivo', monto: restante > 0 ? restante.toFixed(2) : '' },
    ]);
  };
  const quitarLineaPago = (index: number) => setPagos((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  const actualizarLineaPago = (index: number, campo: 'formaPago' | 'monto', valor: string) =>
    setPagos((prev) => prev.map((p, i) => (i === index ? { ...p, [campo]: valor } : p)));

  const cerrarComandaSiCorresponde = async (tipo: 'factura' | 'nota_venta', documentoId: number) => {
    if (!vieneDeComanda || !documentoId) return undefined;
    try {
      const indices = params.indices ? JSON.parse(params.indices) : undefined;
      const res = await api.post(`/mesas/comandas/${params.comandaId}/cerrar`, { tipo, documentoId, ...(indices && { indices }) });
      return { ok: true, mesaLiberada: Boolean(res.data?.mesaLiberada), totalRestante: Number(res.data?.totalRestante || 0) };
    } catch (err: any) {
      Alert.alert('Aviso', err.response?.data?.mensaje || 'La venta se registró, pero no se pudo actualizar la comanda automáticamente — revisa Mesas.');
      return { ok: false, mesaLiberada: false, totalRestante: 0 };
    }
  };

  const emitir = async () => {
    if (pagos.some((p) => !(parseFloat(p.monto) > 0))) {
      Alert.alert('Falta el monto', 'Cada forma de pago necesita un monto mayor a cero');
      return;
    }
    if (!pagosCuadran) {
      Alert.alert('Las formas de pago no cuadran', restante > 0 ? `Faltan $${restante.toFixed(2)} por cubrir` : `Sobran $${Math.abs(restante).toFixed(2)}`);
      return;
    }

    setEmitiendo(true);
    try {
      const fechaEmision = new Date().toISOString().slice(0, 10);

      if (tipoDocumento === 'nota_venta') {
        const res = await api.post('/notas-venta', {
          tipoIdentificacion: params.tipoId,
          identificacion: params.identificacion,
          razonSocial: params.razonSocial,
          formaPago: pagos.length === 1 ? pagos[0].formaPago : 'Mixto',
          pagos: pagos.length > 1 ? pagos.map((p) => ({ formaPago: p.formaPago, total: Number(p.monto) || 0 })) : undefined,
          fechaEmision,
          detalles: carrito.map((i) => ({
            codigoPrincipal: i.codigoPrincipal, descripcion: i.descripcion,
            cantidad: i.cantidad, precioUnitario: i.precioUnitario, descuento: 0,
          })),
        });
        const d = res.data?.data;
        const cierre = await cerrarComandaSiCorresponde('nota_venta', d?.id);
        setDocEmitido({ id: d?.id, numero: d?.numeroNota || '—', total: d?.total ?? total, tipo: 'nota_venta', cierre });
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
          pagos: pagos.map((p) => ({
            formaPago: FORMAS_PAGO_FACTURA.find((f) => f.value === p.formaPago)?.value || p.formaPago,
            total: Number(p.monto) || 0, plazo: 0, unidadTiempo: 'dias',
          })),
        });
        const d = res.data?.data;
        const cierre = await cerrarComandaSiCorresponde('factura', d?.id);
        setDocEmitido({ id: d?.id, numero: d?.numeroFactura || '—', total: d?.importeTotal ?? total, tipo: 'factura', cierre });
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
          {vieneDeComanda && docEmitido.cierre?.ok && (
            <Text style={s.mesaLiberadaTxt}>
              {!docEmitido.cierre.mesaLiberada
                ? `🔀 Cobrado — quedan $${docEmitido.cierre.totalRestante.toFixed(2)} pendientes en ${params.mesaNombre || 'la mesa'}`
                : `🍽️ ${params.mesaNombre || 'Mesa'} liberada`}
            </Text>
          )}
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

          <TouchableOpacity
            style={s.nuevoBtn}
            onPress={() => router.replace(vieneDeComanda ? '/(tabs)/restaurante' : '/(tabs)/pos')}
            activeOpacity={0.85}
          >
            <Ionicons name={vieneDeComanda ? 'restaurant-outline' : 'add-circle-outline'} size={20} color="#fff" />
            <Text style={s.nuevoBtnTxt}>{vieneDeComanda ? 'Volver a Mesas' : 'Nueva venta'}</Text>
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

        {/* Forma(s) de pago */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Forma(s) de pago</Text>
          {pagos.map((pago, index) => (
            <View key={index} style={s.pagoLinea}>
              <View style={s.pagoLineaOpts}>
                {(tipoDocumento === 'nota_venta' ? FORMAS_PAGO_NOTA : FORMAS_PAGO_FACTURA.map((f) => f.value)).map((valor) => {
                  const label = tipoDocumento === 'factura' ? FORMAS_PAGO_FACTURA.find((f) => f.value === valor)?.label : valor;
                  return (
                    <TouchableOpacity
                      key={valor}
                      style={[s.fpChip, pago.formaPago === valor && s.fpChipActive]}
                      onPress={() => actualizarLineaPago(index, 'formaPago', valor)}
                    >
                      <Text style={[s.fpChipTxt, pago.formaPago === valor && s.fpChipTxtActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.pagoMontoRow}>
                <TextInput
                  style={s.pagoMontoInput}
                  value={pago.monto}
                  onChangeText={(v) => actualizarLineaPago(index, 'monto', v)}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#94a3b8"
                />
                {pagos.length > 1 && (
                  <TouchableOpacity onPress={() => quitarLineaPago(index)} style={{ padding: 8 }}>
                    <Ionicons name="close-circle" size={20} color="#ef4444" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
          <TouchableOpacity onPress={agregarLineaPago} style={s.agregarPagoBtn}>
            <Ionicons name="add-circle-outline" size={18} color="#1e40af" />
            <Text style={s.agregarPagoTxt}>Agregar forma de pago</Text>
          </TouchableOpacity>
          {pagos.length === 1 && cambio > 0 && (
            <View style={s.cambioRow}>
              <Text style={s.cambioLblInline}>Cambio</Text>
              <Text style={s.cambioValInline}>${cambio.toFixed(2)}</Text>
            </View>
          )}
          {!pagosCuadran && pagos.length > 1 && (
            <Text style={s.restanteTxt}>{restante > 0 ? `Falta $${restante.toFixed(2)}` : `Sobran $${Math.abs(restante).toFixed(2)}`}</Text>
          )}
        </View>

        {/* Emitir */}
        <TouchableOpacity
          style={[s.emitirBtn, (emitiendo || !pagosCuadran) && s.btnDisabled]}
          onPress={emitir}
          disabled={emitiendo || !pagosCuadran}
          activeOpacity={0.85}
        >
          {emitiendo
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={s.emitirBtnTxt}>
                {!pagosCuadran ? 'Formas de pago no cuadran' : `Emitir ${tipoDocumento === 'factura' ? 'Factura' : 'Nota de venta'}`}
              </Text>
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
  pagoLinea: { marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  pagoLineaOpts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  fpChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  fpChipActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  fpChipTxt: { fontSize: 12, color: '#475569', fontWeight: '500' },
  fpChipTxtActive: { color: '#1e40af', fontWeight: '700' },
  pagoMontoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pagoMontoInput: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 18, color: '#1e293b', fontWeight: '700' },
  agregarPagoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  agregarPagoTxt: { color: '#1e40af', fontSize: 14, fontWeight: '600' },
  restanteTxt: { fontSize: 13, fontWeight: '700', color: '#dc2626', marginTop: 6 },
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
  mesaLiberadaTxt: { fontSize: 14, fontWeight: '700', color: '#166534', marginBottom: 12 },
  cambioBox: { backgroundColor: '#f0fdf4', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, alignItems: 'center', marginBottom: 24 },
  cambioLbl: { fontSize: 13, color: '#166534' },
  cambioVal: { fontSize: 28, fontWeight: '800', color: '#166534' },
  imprimirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 2, borderColor: '#1e40af', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 24, marginBottom: 12, backgroundColor: '#eff6ff' },
  imprimirBtnTxt: { color: '#1e40af', fontSize: 15, fontWeight: '700' },
  nuevoBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nuevoBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
