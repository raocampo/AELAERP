import { Stack } from 'expo-router';

export default function PosLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1e40af' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="checkout" options={{ title: 'Confirmar venta', headerBackTitle: 'POS' }} />
    </Stack>
  );
}
