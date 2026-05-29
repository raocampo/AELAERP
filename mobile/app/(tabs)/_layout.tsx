import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';

function HeaderRight() {
  const { empresa } = useAuth();
  return (
    <View style={h.row}>
      {empresa && (
        <Text style={h.empNombre} numberOfLines={1}>
          {empresa.nombreComercial || empresa.razonSocial}
        </Text>
      )}
    </View>
  );
}

const h = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  empNombre: { fontSize: 13, color: '#bfdbfe', fontWeight: '600', maxWidth: 160 },
});

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  // Altura del tab bar: 56 fijos + inset inferior del dispositivo (botones de nav)
  const TAB_HEIGHT = 56 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1e40af',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#e2e8f0',
          borderTopWidth: 1,
          height: TAB_HEIGHT,
          paddingBottom: insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerStyle: { backgroundColor: '#1e40af' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700', fontSize: 17 },
        headerRight: () => <HeaderRight />,
      }}
    >
      <Tabs.Screen
        name="pos"
        options={{
          title: 'Punto de Venta',
          tabBarLabel: 'POS',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventario"
        options={{
          title: 'Inventario',
          tabBarLabel: 'Inventario',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="facturas"
        options={{
          title: 'Facturación',
          tabBarLabel: 'Facturas',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="configuracion"
        options={{
          title: 'Configuración',
          tabBarLabel: 'Config',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
