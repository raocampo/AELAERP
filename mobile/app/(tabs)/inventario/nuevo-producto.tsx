import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../services/api';

const TARIFAS_IVA = [
  { valor: 0,  label: '0% — Exento' },
  { valor: 15, label: '15% — General' },
  { valor: 5,  label: '5% — Reducido' },
];

const UNIDADES = ['UND', 'KG', 'LT', 'MT', 'CJA', 'PAR', 'SET', 'DOC', 'PAQ', 'SRV'];

export default function NuevoProductoScreen() {
  const router = useRouter();

  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [costo, setCosto] = useState('');
  const [tarifaIva, setTarifaIva] = useState(15);
  const [unidad, setUnidad] = useState('UND');
  const [inventariable, setInventariable] = useState(true);
  const [stockInicial, setStockInicial] = useState('0');
  const [stockMinimo, setStockMinimo] = useState('5');
  const [guardando, setGuardar] = useState(false);

  const guardar = async () => {
    if (!codigo.trim()) { Alert.alert('Campo requerido', 'Ingresa el código del producto.'); return; }
    if (!nombre.trim()) { Alert.alert('Campo requerido', 'Ingresa el nombre del producto.'); return; }
    if (!precio.trim() || isNaN(parseFloat(precio))) { Alert.alert('Campo requerido', 'Ingresa un precio válido.'); return; }

    setGuardar(true);
    try {
      await api.post('/productos', {
        codigoPrincipal: codigo.trim().toUpperCase(),
        nombre: nombre.trim(),
        precioUnitario: parseFloat(precio),
        costoUnitario: costo ? parseFloat(costo) : undefined,
        tarifaIva,
        unidadMedida: unidad,
        inventariable,
        stockActual: inventariable ? parseFloat(stockInicial || '0') : 0,
        stockMinimo: inventariable ? parseFloat(stockMinimo || '0') : 0,
        activo: true,
      });

      Alert.alert('Producto creado', `"${nombre.trim()}" fue agregado al catálogo.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo crear el producto');
    } finally {
      setGuardar(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Código */}
        <Text style={s.label}>Código principal *</Text>
        <TextInput
          style={s.input}
          value={codigo}
          onChangeText={setCodigo}
          placeholder="Ej: PROD001"
          placeholderTextColor="#94a3b8"
          autoCapitalize="characters"
          returnKeyType="next"
        />

        {/* Nombre */}
        <Text style={s.label}>Nombre / descripción *</Text>
        <TextInput
          style={s.input}
          value={nombre}
          onChangeText={setNombre}
          placeholder="Nombre del producto o servicio"
          placeholderTextColor="#94a3b8"
          returnKeyType="next"
        />

        {/* Precio y costo */}
        <View style={s.doble}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Precio de venta *</Text>
            <TextInput style={s.input} value={precio} onChangeText={setPrecio} placeholder="0.00" placeholderTextColor="#94a3b8" keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Costo (opcional)</Text>
            <TextInput style={s.input} value={costo} onChangeText={setCosto} placeholder="0.00" placeholderTextColor="#94a3b8" keyboardType="decimal-pad" />
          </View>
        </View>

        {/* Tarifa IVA */}
        <Text style={s.label}>Tarifa IVA</Text>
        <View style={s.opcionesRow}>
          {TARIFAS_IVA.map((t) => (
            <TouchableOpacity
              key={t.valor}
              style={[s.opcionBt, tarifaIva === t.valor && s.opcionBtActive]}
              onPress={() => setTarifaIva(t.valor)}
            >
              <Text style={[s.opcionBtTxt, tarifaIva === t.valor && s.opcionBtTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Unidad de medida */}
        <Text style={s.label}>Unidad de medida</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.unidadScroll}>
          <View style={s.unidadesRow}>
            {UNIDADES.map((u) => (
              <TouchableOpacity
                key={u}
                style={[s.unidadBt, unidad === u && s.unidadBtActive]}
                onPress={() => setUnidad(u)}
              >
                <Text style={[s.unidadBtTxt, unidad === u && s.unidadBtTxtActive]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Inventariable */}
        <View style={s.switchRow}>
          <View>
            <Text style={s.switchLbl}>Controlar inventario</Text>
            <Text style={s.switchSub}>Activa el seguimiento de stock</Text>
          </View>
          <Switch
            value={inventariable}
            onValueChange={setInventariable}
            trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
            thumbColor={inventariable ? '#1e40af' : '#94a3b8'}
          />
        </View>

        {inventariable && (
          <View style={s.doble}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Stock inicial</Text>
              <TextInput style={s.input} value={stockInicial} onChangeText={setStockInicial} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#94a3b8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>Stock mínimo (alerta)</Text>
              <TextInput style={s.input} value={stockMinimo} onChangeText={setStockMinimo} keyboardType="decimal-pad" placeholder="5" placeholderTextColor="#94a3b8" />
            </View>
          </View>
        )}

        {/* Botones */}
        <TouchableOpacity style={[s.guardarBtn, guardando && s.btnDisabled]} onPress={guardar} disabled={guardando} activeOpacity={0.85}>
          {guardando
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
              <Text style={s.guardarBtnTxt}>Crear producto</Text>
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
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 14, color: '#1e293b', marginBottom: 16 },
  doble: { flexDirection: 'row', gap: 12 },
  opcionesRow: { gap: 8, marginBottom: 16 },
  opcionBt: { padding: 12, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  opcionBtActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  opcionBtTxt: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  opcionBtTxtActive: { color: '#1e40af', fontWeight: '700' },
  unidadScroll: { marginBottom: 16 },
  unidadesRow: { flexDirection: 'row', gap: 8 },
  unidadBt: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  unidadBtActive: { borderColor: '#1e40af', backgroundColor: '#dbeafe' },
  unidadBtTxt: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  unidadBtTxtActive: { color: '#1e40af' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  switchLbl: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  switchSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  guardarBtn: { backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 },
  btnDisabled: { opacity: 0.6 },
  guardarBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelarBtn: { alignItems: 'center', padding: 14 },
  cancelarBtnTxt: { fontSize: 15, color: '#64748b' },
});
