import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Alert, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { esVendedor } from '../../utils/roles';

// `sistema` null/undefined (aún no cargó, o sesión vieja sin el campo) se
// trata como habilitado — evita ocultar un tab por un instante mientras
// recargarSistema() todavía no responde. Una vez que sistema llega, cada
// módulo se oculta del tab bar (no se desmonta la ruta) si el tenant no lo
// tiene contratado — mismo criterio que ModuleRoute en el frontend web.
// `visibleRol` (opcional) lo oculta además si el rol no debería verlo.
function href(habilitado: boolean | undefined, visibleRol = true) {
  return habilitado === false || !visibleRol ? null : undefined;
}

// Menú de cuenta (⋮): "Cambiar de empresa" y "Cerrar sesión" visibles desde
// cualquier tab — antes solo existían al fondo de Configuración (poco
// visible) y "cambiar de empresa" no existía en ningún lado tras el login.
function HeaderRight() {
  const { empresa, empresasDisponibles, logout } = useAuth();
  const router = useRouter();

  const abrirMenu = () => {
    const botones: any[] = [];
    if (empresasDisponibles.length > 1) {
      botones.push({ text: 'Cambiar de empresa', onPress: () => router.push('/cambiar-empresa') });
    }
    botones.push({ text: 'Cerrar sesión', style: 'destructive', onPress: () => logout() });
    botones.push({ text: 'Cancelar', style: 'cancel' });
    Alert.alert(empresa?.nombreComercial || empresa?.razonSocial || 'Cuenta', undefined, botones);
  };

  return (
    <View style={h.row}>
      {empresa && (
        <Text style={h.empNombre} numberOfLines={1}>
          {empresa.nombreComercial || empresa.razonSocial}
        </Text>
      )}
      <TouchableOpacity onPress={abrirMenu} style={h.menuBtn} hitSlop={10}>
        <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const h = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginRight: 8, gap: 10 },
  empNombre: { fontSize: 13, color: '#bfdbfe', fontWeight: '600', maxWidth: 140 },
  menuBtn: { padding: 4 },
});

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { sistema, usuario, puede } = useAuth();

  // El vendedor (rol de campo) no ve POS/Mesas/Inventario/Facturas — sus
  // pantallas propias llegan en la Fase 1 del módulo Agente Vendedor.
  const noEsVendedor = !esVendedor(usuario?.rol);
  // El tab "Vendedor" lo ve quien tenga el permiso (vendedor, y también
  // admin/supervisor para supervisión) — no depende de un módulo del tenant.
  const veTabVendedor = puede('vendedor.ver');

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
          href: href(sistema?.posHabilitado, noEsVendedor),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="restaurante"
        options={{
          title: 'Mesas',
          tabBarLabel: 'Mesas',
          href: href(sistema?.restauranteHabilitado, noEsVendedor),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="restaurant-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventario"
        options={{
          title: 'Inventario',
          tabBarLabel: 'Inventario',
          href: href(sistema?.inventarioHabilitado, noEsVendedor),
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
          href: href(sistema?.facturacionHabilitada, noEsVendedor),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="vendedor"
        options={{
          title: 'Mis Clientes',
          tabBarLabel: 'Vendedor',
          href: href(true, veTabVendedor),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="briefcase-outline" size={size} color={color} />
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
