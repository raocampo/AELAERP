import { useCallback, useEffect, useState } from 'react';
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
import { useAuth } from '../../../context/AuthContext';
import api from '../../../services/api';

const ANCHOS = [
  { valor: 58, label: '58 mm', desc: '~32 caracteres por línea' },
  { valor: 80, label: '80 mm', desc: '~42 caracteres por línea' },
];

interface ImpresoraConfig {
  impresoraHabilitada:  boolean;
  impresoraIp:          string;
  impresoraPuerto:      number;
  impresoraAncho:       number;
  cajaDineroHabilitada: boolean;
  impresionAutoReciboPos: boolean;
  impresionAutoMobile:  boolean;
}

export default function ConfiguracionScreen() {
  const { empresa, sistema, logout } = useAuth();

  const [cfg, setCfg] = useState<ImpresoraConfig>({
    impresoraHabilitada:   false,
    impresoraIp:           '',
    impresoraPuerto:       9100,
    impresoraAncho:        80,
    cajaDineroHabilitada:  false,
    impresionAutoReciboPos: false,
    impresionAutoMobile:   false,
  });

  const [cargando,  setCargando]  = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [probando,  setProbando]  = useState(false);

  // ── Cargar config desde backend ────────────────────────────
  const cargar = useCallback(async () => {
    try {
      const res = await api.get('/impresora/config');
      if (res.data?.success && res.data.data) {
        const d = res.data.data;
        setCfg({
          impresoraHabilitada:   d.impresoraHabilitada   ?? false,
          impresoraIp:           d.impresoraIp           ?? '',
          impresoraPuerto:       d.impresoraPuerto       ?? 9100,
          impresoraAncho:        d.impresoraAncho        ?? 80,
          cajaDineroHabilitada:  d.cajaDineroHabilitada  ?? false,
          impresionAutoReciboPos: d.impresionAutoReciboPos ?? false,
          impresionAutoMobile:   d.impresionAutoMobile   ?? false,
        });
      }
    } catch { /* sin impresora configurada aún */ }
    finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const actualizar = (campo: keyof ImpresoraConfig, valor: any) =>
    setCfg((prev) => ({ ...prev, [campo]: valor }));

  // ── Guardar ────────────────────────────────────────────────
  const guardar = async () => {
    setGuardando(true);
    try {
      await api.put('/impresora/config', cfg);
      Alert.alert('Guardado', 'Configuración de impresora guardada correctamente.');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  // ── Probar conexión ────────────────────────────────────────
  const probar = async () => {
    if (!cfg.impresoraIp.trim()) {
      Alert.alert('IP requerida', 'Ingresa la dirección IP de la impresora primero.');
      return;
    }
    setProbando(true);
    try {
      const res = await api.post('/impresora/test', {
        ip: cfg.impresoraIp.trim(),
        puerto: cfg.impresoraPuerto,
      });
      Alert.alert('Conexión exitosa', res.data.mensaje || 'La impresora respondió correctamente.');
    } catch (err: any) {
      Alert.alert('Sin conexión', err.response?.data?.mensaje || 'No se pudo alcanzar la impresora. Verifica la IP y que estén en la misma red WiFi.');
    } finally {
      setProbando(false);
    }
  };

  // ── Abrir cajón manualmente ────────────────────────────────
  const abrirCajon = async () => {
    try {
      await api.post('/impresora/cajon');
      Alert.alert('Cajón abierto', 'Comando enviado correctamente.');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.mensaje || 'No se pudo abrir el cajón');
    }
  };

  if (cargando) {
    return <View style={s.center}><ActivityIndicator size="large" color="#1e40af" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Info empresa */}
        <View style={s.empresaCard}>
          <Ionicons name="business-outline" size={20} color="#1e40af" />
          <View style={{ flex: 1 }}>
            <Text style={s.empresaNombre}>{empresa?.nombreComercial || empresa?.razonSocial}</Text>
            <Text style={s.empresaRuc}>RUC: {empresa?.ruc}</Text>
          </View>
        </View>

        {/* ── SECCIÓN IMPRESORA ── */}
        <Text style={s.seccion}>Impresora térmica</Text>

        {/* Info de cómo funciona */}
        <View style={s.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color="#1e40af" />
          <Text style={s.infoTxt}>
            La impresora debe estar conectada a la misma red WiFi que este celular.
            Necesita una IP fija asignada en el router.
          </Text>
        </View>

        {/* Habilitar impresora */}
        <View style={s.switchCard}>
          <View>
            <Text style={s.switchLbl}>Activar impresora de red</Text>
            <Text style={s.switchSub}>Imprime por WiFi/Ethernet (ESC/POS)</Text>
          </View>
          <Switch
            value={cfg.impresoraHabilitada}
            onValueChange={(v) => actualizar('impresoraHabilitada', v)}
            trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
            thumbColor={cfg.impresoraHabilitada ? '#1e40af' : '#94a3b8'}
          />
        </View>

        {cfg.impresoraHabilitada && (
          <>
            {/* IP */}
            <Text style={s.label}>Dirección IP de la impresora</Text>
            <TextInput
              style={s.input}
              value={cfg.impresoraIp}
              onChangeText={(v) => actualizar('impresoraIp', v)}
              placeholder="Ej: 192.168.1.100"
              placeholderTextColor="#94a3b8"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />

            {/* Puerto */}
            <Text style={s.label}>Puerto TCP (default: 9100)</Text>
            <TextInput
              style={s.input}
              value={String(cfg.impresoraPuerto)}
              onChangeText={(v) => actualizar('impresoraPuerto', parseInt(v) || 9100)}
              keyboardType="numeric"
              placeholder="9100"
              placeholderTextColor="#94a3b8"
            />

            {/* Ancho del papel */}
            <Text style={s.label}>Ancho del papel</Text>
            <View style={s.opcionesRow}>
              {ANCHOS.map((a) => (
                <TouchableOpacity
                  key={a.valor}
                  style={[s.opcionBt, cfg.impresoraAncho === a.valor && s.opcionBtActive]}
                  onPress={() => actualizar('impresoraAncho', a.valor)}
                >
                  <Text style={[s.opcionBtLbl, cfg.impresoraAncho === a.valor && s.opcionBtLblActive]}>
                    {a.label}
                  </Text>
                  <Text style={s.opcionBtSub}>{a.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Botón probar conexión */}
            <TouchableOpacity
              style={[s.probarBtn, probando && s.btnDisabled]}
              onPress={probar}
              disabled={probando}
              activeOpacity={0.85}
            >
              {probando
                ? <ActivityIndicator color="#0891b2" />
                : <>
                  <Ionicons name="wifi-outline" size={18} color="#0891b2" />
                  <Text style={s.probarBtnTxt}>Probar conexión</Text>
                </>
              }
            </TouchableOpacity>
          </>
        )}

        {/* ── CAJÓN DE DINERO ── */}
        <Text style={s.seccion}>Cajón de dinero</Text>
        <View style={s.infoBox}>
          <Ionicons name="information-circle-outline" size={18} color="#1e40af" />
          <Text style={s.infoTxt}>
            El cajón se conecta a la impresora por cable RJ11. Se abre automáticamente al imprimir el recibo.
          </Text>
        </View>

        <View style={s.switchCard}>
          <View>
            <Text style={s.switchLbl}>Habilitar cajón de dinero</Text>
            <Text style={s.switchSub}>Se abre al cobrar o con el botón manual</Text>
          </View>
          <Switch
            value={cfg.cajaDineroHabilitada}
            onValueChange={(v) => actualizar('cajaDineroHabilitada', v)}
            trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
            thumbColor={cfg.cajaDineroHabilitada ? '#1e40af' : '#94a3b8'}
            disabled={!cfg.impresoraHabilitada}
          />
        </View>

        {cfg.cajaDineroHabilitada && cfg.impresoraHabilitada && (
          <TouchableOpacity style={s.cajonBtn} onPress={abrirCajon} activeOpacity={0.85}>
            <Ionicons name="cash-outline" size={18} color="#16a34a" />
            <Text style={s.cajonBtnTxt}>Abrir cajón ahora (prueba)</Text>
          </TouchableOpacity>
        )}

        {/* ── OPCIONES DE AUTO-IMPRESIÓN ── */}
        <Text style={s.seccion}>Impresión automática</Text>

        <View style={s.switchCard}>
          <View style={{ flex: 1 }}>
            <Text style={s.switchLbl}>Auto-imprimir al cobrar (móvil)</Text>
            <Text style={s.switchSub}>Imprime sin tocar nada después del cobro</Text>
          </View>
          <Switch
            value={cfg.impresionAutoMobile}
            onValueChange={(v) => actualizar('impresionAutoMobile', v)}
            trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
            thumbColor={cfg.impresionAutoMobile ? '#1e40af' : '#94a3b8'}
            disabled={!cfg.impresoraHabilitada}
          />
        </View>

        <View style={[s.switchCard, { marginBottom: 24 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.switchLbl}>Auto-imprimir en POS web</Text>
            <Text style={s.switchSub}>Al emitir desde el navegador del PC</Text>
          </View>
          <Switch
            value={cfg.impresionAutoReciboPos}
            onValueChange={(v) => actualizar('impresionAutoReciboPos', v)}
            trackColor={{ false: '#e2e8f0', true: '#93c5fd' }}
            thumbColor={cfg.impresionAutoReciboPos ? '#1e40af' : '#94a3b8'}
          />
        </View>

        {/* ── GUARDAR ── */}
        <TouchableOpacity
          style={[s.guardarBtn, guardando && s.btnDisabled]}
          onPress={guardar}
          disabled={guardando}
          activeOpacity={0.85}
        >
          {guardando
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="save-outline" size={20} color="#fff" />
              <Text style={s.guardarBtnTxt}>Guardar configuración</Text>
            </>
          }
        </TouchableOpacity>

        {/* ── CERRAR SESIÓN ── */}
        <TouchableOpacity style={s.logoutBtn} onPress={logout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
          <Text style={s.logoutBtnTxt}>Cerrar sesión</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  empresaCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#eff6ff', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#dbeafe', marginBottom: 20,
  },
  empresaNombre: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
  empresaRuc: { fontSize: 12, color: '#64748b', marginTop: 2 },
  seccion: {
    fontSize: 11, fontWeight: '800', color: '#475569', marginBottom: 10,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8,
  },
  infoBox: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: '#f0f9ff', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#bae6fd', marginBottom: 12,
  },
  infoTxt: { flex: 1, fontSize: 12, color: '#0369a1', lineHeight: 18 },
  switchCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 10, gap: 12,
  },
  switchLbl: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  switchSub: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 8, padding: 12, fontSize: 15, color: '#1e293b',
    fontFamily: 'monospace', marginBottom: 14,
  },
  opcionesRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  opcionBt: {
    flex: 1, padding: 12, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff',
  },
  opcionBtActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  opcionBtLbl: { fontSize: 15, fontWeight: '700', color: '#64748b', marginBottom: 2 },
  opcionBtLblActive: { color: '#1e40af' },
  opcionBtSub: { fontSize: 11, color: '#94a3b8' },
  probarBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#0891b2', borderRadius: 10,
    paddingVertical: 11, backgroundColor: '#f0f9ff', marginBottom: 14,
  },
  probarBtnTxt: { fontSize: 14, fontWeight: '700', color: '#0891b2' },
  cajonBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#16a34a', borderRadius: 10,
    paddingVertical: 11, backgroundColor: '#f0fdf4', marginBottom: 14,
  },
  cajonBtnTxt: { fontSize: 14, fontWeight: '700', color: '#16a34a' },
  guardarBtn: {
    backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginBottom: 12,
  },
  btnDisabled: { opacity: 0.6 },
  guardarBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14,
  },
  logoutBtnTxt: { fontSize: 15, color: '#ef4444', fontWeight: '600' },
});
