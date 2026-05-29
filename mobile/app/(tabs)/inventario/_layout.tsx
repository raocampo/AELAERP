import { Stack } from 'expo-router';

export default function InventarioLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1e40af' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="movimiento" options={{ title: 'Registrar movimiento', headerBackTitle: 'Inventario' }} />
      <Stack.Screen name="nuevo-producto" options={{ title: 'Nuevo producto', headerBackTitle: 'Inventario' }} />
    </Stack>
  );
}
