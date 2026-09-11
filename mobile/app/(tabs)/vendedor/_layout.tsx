import { Stack } from 'expo-router';

export default function VendedorLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1e40af' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="cliente" options={{ title: 'Cliente', headerBackTitle: 'Mis Clientes' }} />
      <Stack.Screen name="pedido" options={{ title: 'Nuevo Pedido', headerBackTitle: 'Cliente' }} />
      <Stack.Screen name="pedidos" options={{ title: 'Mis Pedidos', headerBackTitle: 'Mis Clientes' }} />
      <Stack.Screen name="cobros" options={{ title: 'Cobros Pendientes', headerBackTitle: 'Mis Clientes' }} />
      <Stack.Screen name="cobro" options={{ title: 'Registrar Cobro', headerBackTitle: 'Atrás' }} />
    </Stack>
  );
}
