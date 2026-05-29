import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../context/AuthContext';

function RouteGuard({ children }: { children: React.ReactNode }) {
  const { usuario, cargando, empresaConfirmada } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (cargando) return;

    const ruta0 = segments[0] as string | undefined;
    const inLogin   = ruta0 === 'login';
    const inEmpresa = ruta0 === 'empresa';
    const inTabs    = ruta0 === '(tabs)';

    if (!usuario) {
      // Sin sesión → siempre al login
      if (!inLogin) router.replace('/login');
    } else if (!empresaConfirmada) {
      // Logueado pero sin empresa confirmada → selector de empresa
      if (!inEmpresa) router.replace('/empresa');
    } else {
      // Sesión completa → tabs
      if (inLogin || inEmpresa) router.replace('/(tabs)/pos');
    }
  }, [usuario, cargando, empresaConfirmada, segments, router]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <RouteGuard>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }} />
          </RouteGuard>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
