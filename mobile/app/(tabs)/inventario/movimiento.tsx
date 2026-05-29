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

const TIPOS = [
  { valor: 'entrada', label: 'Entrada', icon: 'arrow-down-circle-outline', color: '#16a34a' },
  { valor: 'salida', label: 'Salida', icon: 'arrow-up-circle-outline', color: '#dc2626' },
  { valor: 'ajuste', label: 'Ajuste', icon: 'refresh-circle-outline', color: '#d97706' },
] as const;

type TipoMov = 'entrada' | 'salida' | 'ajuste';

export default function MovimientoScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    productoId: string;
    nombre: string;
    stock: string;
    codigo: string;
  }>();

  const [tipo, setTipo] = useState<TipoMov>('entrada');
  const [cantidad, setCantidad] = useState('');
  const [observacion, setObservacion] = useState('');
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    const cant = parseFloat(cantidad);
    if (isNaN(cant) || cant <= 0) {
      Alert.alert('Cantidad inválida', 'Ingresa una cantidad mayor a 0.');
      return;
    }

    setGuardando(true);
    try {
      await api.post('/inventario/movimientos', {
        productoId: parseInt(params.productoId, 10),
        tipo,
        cantidad: cant,
        observacion: observacion.trim() || undefined,
      });

      Alert.alert(
        'Movimiento registrado',
        `${tipo === 'entrada' ? 'Entrada' : tipo === 'salida' ? 'Salida' : 'Ajuste'} de ${cant} unidades registrada.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo registrar el movimiento');
    } finally {
      setGuardando(false);
    }
  };

  const stockActual = parseInt(params.stock || '0', 10);

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Producto */}
        <View style={s.prodCard}>
          <View style={s.prodIcono}>
            <Ionicons name="cube-outline" size={28} color="#1e40af" />
          </View>
          <View>
            <Text style={s.prodNombre}>{params.nombre}</Text>
            <Text style={s.prodCodigo}>{params.codigo}</Text>
          </View>
          <View style={s.stockActual}>
            <Text style={s.stockNum}>{stockActual}</Text>
            <Text style={s.stockLbl}>stock actual</Text>
          </View>
        </View>

        {/* Tipo movimiento */}
        <Text style={s.sectionLbl}>Tipo de movimiento</Text>
        <View style={s.tipoRow}>
          {TIPOS.map((t) => (
            <TouchableOpacity
              key={t.valor}
              style={[s.tipoBt, tipo === t.valor && { borderColor: t.color, backgroundColor: `${t.color}10` }]}
              onPress={() => setTipo(t.valor)}
            >
              <Ionicons name={t.icon as any} size={24} color={tipo === t.valor ? t.color : '#94a3b8'} />
              <Text style={[s.tipoBtTxt, tipo === t.valor && { color: t.color }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cantidad */}
        <Text style={s.sectionLbl}>Cantidad</Text>
        <TextInput
          style={s.cantInput}
          value={cantidad}
          onChangeText={setCantidad}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#94a3b8"
        />
        {cantidad && !isNaN(parseFloat(cantidad)) && (
          <View style={s.preview}>
            <Ionicons
              name={tipo === 'entrada' ? 'trending-up' : tipo === 'salida' ? 'trending-down' : 'swap-horizontal'}
              size={16}
              color={tipo === 'entrada' ? '#16a34a' : tipo === 'salida' ? '#dc2626' : '#d97706'}
            />
            <Text style={s.previewTxt}>
              Stock: {stockActual} →{' '}
              <Text style={{ fontWeight: '800' }}>
                {tipo === 'entrada'
                  ? stockActual + parseFloat(cantidad)
                  : tipo === 'salida'
                    ? stockActual - parseFloat(cantidad)
                    : parseFloat(cantidad)
                }
              </Text>
            </Text>
          </View>
        )}

        {/* Observación */}
        <Text style={s.sectionLbl}>Observación (opcional)</Text>
        <TextInput
          style={s.obsInput}
          value={observacion}
          onChangeText={setObservacion}
          placeholder="Motivo del movimiento..."
          placeholderTextColor="#94a3b8"
          multiline
          numberOfLines={3}
        />

        {/* Guardar */}
        <TouchableOpacity
          style={[s.guardarBtn, guardando && s.guardarBtnDisabled]}
          onPress={guardar}
          disabled={guardando}
          activeOpacity={0.85}
        >
          {guardando
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={s.guardarBtnTxt}>Registrar movimiento</Text>
            </>
          }
        </TouchableOpacity>

        <TouchableOpacity style={s.cancelarBtn} onPress={() => router.back()} disabled={guardando}>
          <Text style={s.cancelarBtnTxt}>Cancelar</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { padding: 16, paddingBottom: 32 },
  prodCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 16, marginBottom: 20, gap: 12,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  prodIcono: {
    width: 48, height: 48, borderRadius: 12, backgroundColor: '#eff6ff',
    alignItems: 'center', justifyContent: 'center',
  },
  prodNombre: { fontSize: 15, fontWeight: '700', color: '#1e293b', flex: 1 },
  prodCodigo: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  stockActual: { alignItems: 'center', marginLeft: 'auto' },
  stockNum: { fontSize: 24, fontWeight: '800', color: '#1e40af' },
  stockLbl: { fontSize: 10, color: '#64748b', fontWeight: '600' },
  sectionLbl: { fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  tipoRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tipoBt: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 14,
    borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', gap: 6,
  },
  tipoBtTxt: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
  cantInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, padding: 14, fontSize: 24, color: '#1e293b',
    fontWeight: '700', textAlign: 'center', marginBottom: 10,
  },
  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 20,
  },
  previewTxt: { fontSize: 14, color: '#475569' },
  obsInput: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 10, padding: 12, fontSize: 14, color: '#1e293b',
    textAlignVertical: 'top', minHeight: 80, marginBottom: 20,
  },
  guardarBtn: {
    backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginBottom: 10,
  },
  guardarBtnDisabled: { opacity: 0.6 },
  guardarBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelarBtn: { alignItems: 'center', padding: 12 },
  cancelarBtnTxt: { fontSize: 15, color: '#64748b' },
});
