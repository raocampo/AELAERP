import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import type { Empresa } from '../types';

// Pantalla accesible en cualquier momento (menú del header) para un usuario
// con acceso a más de una empresa. A diferencia de `empresa.tsx` (solo se
// usa recién logueado, antes de confirmar), acá la sesión ya está activa:
// `cambiarEmpresa()` cambia el token/empresa sin pasar por el flujo de
// "primer ingreso", y al terminar volvemos a Configuración (tab siempre
// disponible sin importar los módulos contratados por la nueva empresa).
export default function CambiarEmpresaScreen() {
  const router = useRouter();
  const { empresa: empresaActual, empresasDisponibles, cargarEmpresasDisponibles, cambiarEmpresa } = useAuth();
  const [cargando, setCargando] = useState(empresasDisponibles.length === 0);
  const [cambiando, setCambiando] = useState<number | null>(null);

  useEffect(() => {
    if (empresasDisponibles.length === 0) {
      cargarEmpresasDisponibles().finally(() => setCargando(false));
    }
  }, []);

  const planColor = (plan?: string) => {
    if (plan === 'pro') return '#7c3aed';
    if (plan === 'medium') return '#0891b2';
    return '#64748b';
  };

  const seleccionar = async (item: Empresa) => {
    if (item.id === empresaActual?.id) {
      router.back();
      return;
    }
    setCambiando(item.id);
    const result = await cambiarEmpresa(item.id);
    setCambiando(null);
    if (result.success) {
      router.replace('/(tabs)/configuracion');
    } else {
      Alert.alert('Error', 'No se pudo cambiar de empresa. Intenta de nuevo.');
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTxt}>Cambiar de empresa</Text>
        <View style={{ width: 22 }} />
      </View>

      {cargando ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#1e40af" />
        </View>
      ) : (
        <FlatList
          data={empresasDisponibles}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.lista}
          renderItem={({ item }) => {
            const activa = item.id === empresaActual?.id;
            return (
              <TouchableOpacity
                style={[s.empCard, activa && s.empCardActive]}
                onPress={() => seleccionar(item)}
                activeOpacity={0.8}
                disabled={cambiando !== null}
              >
                <View style={s.empInfo}>
                  <Text style={[s.empNombre, activa && s.empNombreActive]} numberOfLines={1}>
                    {item.nombreComercial || item.razonSocial}
                  </Text>
                  <Text style={s.empRazon} numberOfLines={1}>{item.razonSocial}</Text>
                  <Text style={s.empRuc}>RUC: {item.ruc}</Text>
                </View>
                {item.plan && (
                  <View style={[s.planBadge, { borderColor: planColor(item.plan) }]}>
                    <Text style={[s.planBadgeTxt, { color: planColor(item.plan) }]}>
                      {item.plan?.toUpperCase()}
                    </Text>
                  </View>
                )}
                {cambiando === item.id
                  ? <ActivityIndicator color="#1e40af" style={{ marginLeft: 8 }} />
                  : activa && <Ionicons name="checkmark-circle" size={22} color="#1e40af" style={{ marginLeft: 8 }} />
                }
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={s.center}>
              <Text style={s.emptyTxt}>No se encontraron empresas asignadas</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    backgroundColor: '#1e40af', paddingHorizontal: 16, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backBtn: { padding: 4 },
  headerTxt: { fontSize: 17, fontWeight: '700', color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  lista: { padding: 16, gap: 10 },
  empCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 16, borderWidth: 1.5, borderColor: '#e2e8f0', gap: 12,
  },
  empCardActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  empInfo: { flex: 1 },
  empNombre: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
  empNombreActive: { color: '#1e40af' },
  empRazon: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  empRuc: { fontSize: 11, color: '#94a3b8' },
  planBadge: { borderRadius: 6, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
});
