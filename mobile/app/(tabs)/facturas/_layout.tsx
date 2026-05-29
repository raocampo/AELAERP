import { Stack } from 'expo-router';

export default function FacturasLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1e40af' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="nueva" options={{ title: 'Nueva factura', headerBackTitle: 'Facturas' }} />
    </Stack>
  );
}
