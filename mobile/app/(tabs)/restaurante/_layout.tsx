import { Stack } from 'expo-router';

export default function RestauranteLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1e40af' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="comanda" options={{ title: 'Comanda', headerBackTitle: 'Mesas' }} />
      <Stack.Screen name="cocina" options={{ title: 'Cocina', headerBackTitle: 'Mesas' }} />
      <Stack.Screen name="reportes" options={{ title: 'Reportes', headerBackTitle: 'Mesas' }} />
    </Stack>
  );
}
