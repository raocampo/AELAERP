import { useEffect, useState } from 'react';
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
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import api from '../../../services/api';

interface Banco { id: number; nombre: string; banco: string; }

// Registrar un cobro en ruta contra una factura pendiente. El dinero ya
// entra a Caja/Bancos al guardar — Contabilidad genera el asiento después
// (ver docs/roadmap-agente-vendedor.md Fase 3).
export default function CobrarScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    facturaId: string; numeroFactura?: string; clienteNombre?: string; saldo?: string;
  }>();

  const saldo = Number(params.saldo || 0);
  const [monto, setMonto] = useState(saldo > 0 ? saldo.toFixed(2) : '');
  const [metodoPago, setMetodoPago] = useState<'efectivo' | 'transferencia'>('efectivo');
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [bancoId, setBancoId] = useState<number | null>(null);
  const [referencia, setReferencia] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: `Cobrar — ${params.numeroFactura || ''}` });
  }, [params.numeroFactura, navigation]);

  useEffect(() => {
    if (metodoPago === 'transferencia' && bancos.length === 0) {
      api.get('/bancos').then((res) => setBancos(res.data?.data || [])).catch(() => {});
    }
  }, [metodoPago]);

  const enviar = async () => {
    const montoNum = Number(monto);
    if (!(montoNum > 0)) { Alert.alert('Monto inválido', 'Ingresa un monto mayor a cero.'); return; }
    if (montoNum > saldo + 0.01) { Alert.alert('Monto excede el saldo', `El saldo pendiente es $${saldo.toFixed(2)}.`); return; }
    if (metodoPago === 'transferencia' && !bancoId) {
      Alert.alert('Banco requerido', 'Selecciona la cuenta bancaria donde se depositó la transferencia.');
      return;
    }
    setEnviando(true);
    try {
      await api.post('/vendedor/cobros', {
        facturaId: Number(params.facturaId),
        monto: montoNum,
        metodoPago,
        bancoId: metodoPago === 'transferencia' ? bancoId : undefined,
        referencia: referencia.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      Alert.alert(
        'Cobro registrado',
        `Se registró el cobro de $${montoNum.toFixed(2)}. Contabilidad lo revisará para generar el asiento.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo registrar el cobro');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.infoBox}>
          <Text style={s.infoCliente}>{params.clienteNombre}</Text>
          <Text style={s.infoFactura}>Factura {params.numeroFactura}</Text>
          <Text style={s.infoSaldo}>Saldo pendiente: ${saldo.toFixed(2)}</Text>
        </View>

        <Text style={s.label}>Monto a cobrar</Text>
        <TextInput
          style={s.input}
          value={monto}
          onChangeText={setMonto}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor="#94a3b8"
        />

        <Text style={s.label}>Forma de pago</Text>
        <View style={s.opcionesRow}>
          {(['efectivo', 'transferencia'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[s.opcionBt, metodoPago === m && s.opcionBtActive]}
              onPress={() => setMetodoPago(m)}
            >
              <Ionicons
                name={m === 'efectivo' ? 'cash-outline' : 'swap-horizontal-outline'}
                size={18}
                color={metodoPago === m ? '#1e40af' : '#64748b'}
              />
              <Text style={[s.opcionBtTxt, metodoPago === m && s.opcionBtTxtActive]}>
                {m === 'efectivo' ? 'Efectivo' : 'Transferencia'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {metodoPago === 'transferencia' && (
          <>
            <Text style={s.label}>Cuenta bancaria (donde se depositó)</Text>
            {bancos.length === 0 ? (
              <Text style={s.sinBancos}>No hay cuentas bancarias configuradas.</Text>
            ) : (
              <View style={s.bancosList}>
                {bancos.map((b) => (
                  <TouchableOpacity
                    key={b.id}
                    style={[s.bancoItem, bancoId === b.id && s.bancoItemActive]}
                    onPress={() => setBancoId(b.id)}
                  >
                    <Text style={[s.bancoTxt, bancoId === b.id && s.bancoTxtActive]}>{b.nombre}</Text>
                    {bancoId === b.id && <Ionicons name="checkmark-circle" size={18} color="#1e40af" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <Text style={s.label}>Referencia (opcional)</Text>
        <TextInput
          style={s.input}
          value={referencia}
          onChangeText={setReferencia}
          placeholder={metodoPago === 'transferencia' ? '# de comprobante' : 'Opcional'}
          placeholderTextColor="#94a3b8"
        />

        <Text style={s.label}>Observaciones (opcional)</Text>
        <TextInput
          style={[s.input, s.inputMultiline]}
          value={observaciones}
          onChangeText={setObservaciones}
          multiline
          placeholderTextColor="#94a3b8"
        />

        <TouchableOpacity style={s.enviarBtn} onPress={enviar} activeOpacity={0.85} disabled={enviando}>
          {enviando
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={s.enviarBtnTxt}>Registrar cobro</Text>
            </>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 40 },
  infoBox: {
    backgroundColor: '#eff6ff', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#dbeafe', marginBottom: 20,
  },
  infoCliente: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  infoFactura: { fontSize: 13, color: '#64748b', marginTop: 2 },
  infoSaldo: { fontSize: 16, fontWeight: '800', color: '#dc2626', marginTop: 6 },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 8, padding: 12, fontSize: 15, color: '#1e293b',
  },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  opcionesRow: { flexDirection: 'row', gap: 10 },
  opcionBt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff',
  },
  opcionBtActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  opcionBtTxt: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  opcionBtTxtActive: { color: '#1e40af' },
  sinBancos: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },
  bancosList: { gap: 8 },
  bancoItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff',
  },
  bancoItemActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  bancoTxt: { fontSize: 14, color: '#1e293b', fontWeight: '500' },
  bancoTxtActive: { color: '#1e40af', fontWeight: '700' },
  enviarBtn: {
    backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15, marginTop: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  enviarBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
