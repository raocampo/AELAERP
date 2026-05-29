import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const { login } = useAuth();
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [cargando, setCargando] = useState(false);

  const handleLogin = async () => {
    const c = credential.trim();
    const p = password.trim();
    if (!c || !p) {
      Alert.alert('Campos requeridos', 'Ingresa tu usuario y contraseña.');
      return;
    }
    setCargando(true);
    try {
      const result = await login(c, p);
      if (!result.success) {
        Alert.alert('Error de acceso', result.mensaje || 'Credenciales incorrectas');
      }
    } finally {
      setCargando(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.header}>
            <Text style={s.logo}>AELA</Text>
            <Text style={s.subtitle}>Sistema ERP · Facturación Electrónica</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Iniciar sesión</Text>

            <Text style={s.label}>Usuario o email</Text>
            <TextInput
              style={s.input}
              value={credential}
              onChangeText={setCredential}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
              placeholder="usuario@empresa.com"
              placeholderTextColor="#94a3b8"
            />

            <Text style={s.label}>Contraseña</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleLogin}
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
            />

            <TouchableOpacity
              style={[s.btn, cargando && s.btnDisabled]}
              onPress={handleLogin}
              disabled={cargando}
              activeOpacity={0.8}
            >
              {cargando
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.btnText}>Ingresar</Text>
              }
            </TouchableOpacity>
          </View>

          <Text style={s.footer}>corpsimtelec.com · AELA ERP</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1e40af' },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 48, fontWeight: '800', color: '#fff', letterSpacing: 4 },
  subtitle: { fontSize: 13, color: '#bfdbfe', marginTop: 6, textAlign: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  cardTitle: { fontSize: 20, fontWeight: '700', color: '#1e293b', marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 6 },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 13,
    fontSize: 15,
    color: '#1e293b',
    marginBottom: 16,
  },
  btn: {
    backgroundColor: '#1e40af',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: { textAlign: 'center', color: '#bfdbfe', fontSize: 12, marginTop: 32 },
});
