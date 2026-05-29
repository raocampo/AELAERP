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
import { useAuth } from '../context/AuthContext';
import type { Empresa } from '../types';

export default function EmpresaScreen() {
  const { usuario, empresa: empresaActual, empresasDisponibles, cargarEmpresasDisponibles, confirmarEmpresa, logout } = useAuth();
  const [seleccionada, setSeleccionada] = useState<number | null>(empresaActual?.id ?? null);
  const [confirmando, setConfirmando] = useState(false);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (empresasDisponibles.length === 0) {
      setCargando(true);
      cargarEmpresasDisponibles().finally(() => setCargando(false));
    }
  }, []);

  // Si hay una sola empresa, pre-seleccionar
  useEffect(() => {
    if (empresasDisponibles.length === 1) {
      setSeleccionada(empresasDisponibles[0].id);
    }
  }, [empresasDisponibles]);

  const handleConfirmar = async () => {
    if (!seleccionada) {
      Alert.alert('Selecciona una empresa', 'Debes elegir la empresa con la que vas a trabajar.');
      return;
    }
    setConfirmando(true);
    const result = await confirmarEmpresa(seleccionada);
    setConfirmando(false);
    if (!result.success) {
      Alert.alert('Error', result.mensaje || 'No se pudo seleccionar la empresa');
    }
    // El RouteGuard detecta empresaConfirmada=true y navega a tabs automáticamente
  };

  // Lista a mostrar: empresasDisponibles o al menos la empresa actual
  const lista: Empresa[] = empresasDisponibles.length > 0
    ? empresasDisponibles
    : empresaActual ? [empresaActual] : [];

  const planColor = (plan?: string) => {
    if (plan === 'pro') return '#7c3aed';
    if (plan === 'medium') return '#0891b2';
    return '#64748b';
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.bienvenido}>Bienvenido</Text>
        <Text style={s.nombre}>{usuario?.nombre}</Text>
        <Text style={s.email}>{usuario?.email}</Text>
      </View>

      {/* Instrucción */}
      <View style={s.instruccion}>
        <Ionicons name="business-outline" size={22} color="#1e40af" />
        <Text style={s.instruccionTxt}>
          {lista.length > 1
            ? 'Selecciona la empresa con la que vas a trabajar'
            : 'Confirma tu empresa para continuar'}
        </Text>
      </View>

      {/* Lista de empresas */}
      {cargando ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#1e40af" />
          <Text style={s.cargandoTxt}>Cargando empresas...</Text>
        </View>
      ) : (
        <FlatList
          data={lista}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.lista}
          renderItem={({ item }) => {
            const activa = seleccionada === item.id;
            return (
              <TouchableOpacity
                style={[s.empCard, activa && s.empCardActive]}
                onPress={() => setSeleccionada(item.id)}
                activeOpacity={0.8}
              >
                <View style={[s.empRadio, activa && s.empRadioActive]}>
                  {activa && <View style={s.empRadioDot} />}
                </View>
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
                {activa && (
                  <Ionicons name="checkmark-circle" size={24} color="#1e40af" style={{ marginLeft: 8 }} />
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={s.center}>
              <Ionicons name="business-outline" size={48} color="#cbd5e1" />
              <Text style={s.emptyTxt}>No se encontraron empresas asignadas</Text>
            </View>
          }
        />
      )}

      {/* Botones */}
      <View style={s.footer}>
        <TouchableOpacity
          style={[s.confirmarBtn, (!seleccionada || confirmando) && s.btnDisabled]}
          onPress={handleConfirmar}
          disabled={!seleccionada || confirmando}
          activeOpacity={0.85}
        >
          {confirmando
            ? <ActivityIndicator color="#fff" />
            : <>
              <Ionicons name="log-in-outline" size={20} color="#fff" />
              <Text style={s.confirmarBtnTxt}>Entrar al sistema</Text>
            </>
          }
        </TouchableOpacity>
        <TouchableOpacity style={s.salirBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={16} color="#64748b" />
          <Text style={s.salirBtnTxt}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    backgroundColor: '#1e40af', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 28,
  },
  bienvenido: { fontSize: 13, color: '#bfdbfe', fontWeight: '500', marginBottom: 4 },
  nombre: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 4 },
  email: { fontSize: 13, color: '#93c5fd' },
  instruccion: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 16, backgroundColor: '#eff6ff',
    borderBottomWidth: 1, borderBottomColor: '#dbeafe',
  },
  instruccionTxt: { fontSize: 14, color: '#1e40af', fontWeight: '500', flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  cargandoTxt: { marginTop: 12, color: '#64748b', fontSize: 14 },
  lista: { padding: 16, gap: 10 },
  empCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 12, padding: 16, borderWidth: 1.5, borderColor: '#e2e8f0', gap: 12,
  },
  empCardActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  empRadio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#cbd5e1',
    alignItems: 'center', justifyContent: 'center',
  },
  empRadioActive: { borderColor: '#1e40af' },
  empRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1e40af' },
  empInfo: { flex: 1 },
  empNombre: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 2 },
  empNombreActive: { color: '#1e40af' },
  empRazon: { fontSize: 12, color: '#64748b', marginBottom: 2 },
  empRuc: { fontSize: 11, color: '#94a3b8' },
  planBadge: { borderRadius: 6, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeTxt: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  emptyTxt: { fontSize: 14, color: '#94a3b8', marginTop: 12, textAlign: 'center' },
  footer: { padding: 20, gap: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  confirmarBtn: {
    backgroundColor: '#1e40af', borderRadius: 12, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  btnDisabled: { opacity: 0.5 },
  confirmarBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '700' },
  salirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 },
  salirBtnTxt: { fontSize: 14, color: '#64748b' },
});
