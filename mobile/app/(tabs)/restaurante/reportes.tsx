import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../../../services/api';

function primerDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function hoy() {
  return new Date().toISOString().slice(0, 10);
}

type GrupoVentas = { clave: string | number; etiqueta: string; cantidadComandas: number; subtotal: number; totalIva: number; total: number };
type Ventas = { data: GrupoVentas[]; totalGeneral: number; cantidadComandas: number };
type Equilibrio = {
  configurado: boolean; mensaje?: string; costosFijosMensuales?: number;
  ratioCostoVariable?: number; margenContribucion?: number; ticketPromedio?: number;
  puntoEquilibrioVentas?: number; puntoEquilibrioComandas?: number; ventasNetasPeriodo?: number;
};

const AGRUPACIONES: { valor: 'mesa' | 'mesero' | 'hora'; label: string }[] = [
  { valor: 'mesa', label: 'Mesa' },
  { valor: 'mesero', label: 'Mesero' },
  { valor: 'hora', label: 'Franja horaria' },
];

export default function ReportesScreen() {
  const [tab, setTab] = useState<'ventas' | 'equilibrio'>('ventas');
  const [agruparPor, setAgruparPor] = useState<'mesa' | 'mesero' | 'hora'>('mesa');
  const [ventas, setVentas] = useState<Ventas | null>(null);
  const [equilibrio, setEquilibrio] = useState<Equilibrio | null>(null);
  const [cargando, setCargando] = useState(true);
  const [sinPermiso, setSinPermiso] = useState(false);

  useEffect(() => {
    setCargando(true);
    const params = { desde: primerDiaMes(), hasta: hoy(), agruparPor };
    const req = tab === 'ventas'
      ? api.get('/mesas/reportes/ventas', { params })
      : api.get('/mesas/reportes/punto-equilibrio', { params: { desde: params.desde, hasta: params.hasta } });
    req
      .then((res) => { tab === 'ventas' ? setVentas(res.data) : setEquilibrio(res.data); setSinPermiso(false); })
      .catch((err) => { if (err.response?.status === 403) setSinPermiso(true); })
      .finally(() => setCargando(false));
  }, [tab, agruparPor]);

  if (sinPermiso) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.centro}><Text style={s.vacioTxt}>No tienes permiso para ver los reportes.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, tab === 'ventas' && s.tabActive]} onPress={() => setTab('ventas')}>
          <Text style={[s.tabTxt, tab === 'ventas' && s.tabTxtActive]}>Ventas</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'equilibrio' && s.tabActive]} onPress={() => setTab('equilibrio')}>
          <Text style={[s.tabTxt, tab === 'equilibrio' && s.tabTxtActive]}>Punto de equilibrio</Text>
        </TouchableOpacity>
      </View>

      {tab === 'ventas' && (
        <View style={s.agruparRow}>
          {AGRUPACIONES.map((a) => (
            <TouchableOpacity key={a.valor} style={[s.chip, agruparPor === a.valor && s.chipActive]} onPress={() => setAgruparPor(a.valor)}>
              <Text style={[s.chipTxt, agruparPor === a.valor && s.chipTxtActive]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {cargando ? (
        <View style={s.centro}><ActivityIndicator size="large" color="#1e40af" /></View>
      ) : tab === 'ventas' ? (
        <FlatList
          data={ventas?.data || []}
          keyExtractor={(g) => String(g.clave)}
          contentContainerStyle={s.lista}
          ListHeaderComponent={
            <View style={s.kpis}>
              <View style={s.kpi}><Text style={s.kpiLbl}>Comandas</Text><Text style={s.kpiVal}>{ventas?.cantidadComandas ?? 0}</Text></View>
              <View style={s.kpi}><Text style={s.kpiLbl}>Total</Text><Text style={s.kpiVal}>${(ventas?.totalGeneral ?? 0).toFixed(2)}</Text></View>
            </View>
          }
          ListEmptyComponent={<Text style={s.vacioTxt}>Sin ventas cerradas en este período.</Text>}
          renderItem={({ item }) => (
            <View style={s.filaVenta}>
              <View style={{ flex: 1 }}>
                <Text style={s.filaEtiqueta}>{item.etiqueta}</Text>
                <Text style={s.filaSub}>{item.cantidadComandas} comanda(s)</Text>
              </View>
              <Text style={s.filaTotal}>${item.total.toFixed(2)}</Text>
            </View>
          )}
        />
      ) : !equilibrio?.configurado ? (
        <View style={s.centro}>
          <Text style={s.vacioTxt}>{equilibrio?.mensaje || 'Configura tus costos fijos mensuales en Configuración.'}</Text>
        </View>
      ) : !equilibrio?.puntoEquilibrioVentas ? (
        <View style={s.centro}>
          <Text style={s.vacioTxt}>{equilibrio?.mensaje || 'No hay suficiente información para calcular el punto de equilibrio.'}</Text>
        </View>
      ) : (
        <View style={s.lista}>
          <View style={s.kpis}>
            <View style={s.kpi}><Text style={s.kpiLbl}>Costos fijos</Text><Text style={s.kpiVal}>${equilibrio.costosFijosMensuales!.toFixed(2)}</Text></View>
            <View style={s.kpi}><Text style={s.kpiLbl}>Margen</Text><Text style={s.kpiVal}>{(equilibrio.margenContribucion! * 100).toFixed(1)}%</Text></View>
          </View>
          <View style={s.equilibrioBox}>
            <Text style={s.equilibrioLbl}>Punto de equilibrio (ventas/mes)</Text>
            <Text style={s.equilibrioVal}>${equilibrio.puntoEquilibrioVentas.toFixed(2)}</Text>
            {equilibrio.puntoEquilibrioComandas ? (
              <Text style={s.equilibrioSub}>~{equilibrio.puntoEquilibrioComandas} comandas/mes</Text>
            ) : null}
          </View>
          <Text style={s.nota}>
            Costo variable estimado en {(equilibrio.ratioCostoVariable! * 100).toFixed(1)}% de las ventas del período
            (ventas netas: ${equilibrio.ventasNetasPeriodo?.toFixed(2)}). No reemplaza un análisis de costos completo.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  vacioTxt: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
  tabs: { flexDirection: 'row', margin: 12, marginBottom: 4, gap: 8 },
  tab: { flex: 1, padding: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', alignItems: 'center' },
  tabActive: { borderColor: '#1e40af', backgroundColor: '#eff6ff' },
  tabTxt: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tabTxtActive: { color: '#1e40af' },
  agruparRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, marginBottom: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipActive: { backgroundColor: '#dbeafe', borderColor: '#93c5fd' },
  chipTxt: { fontSize: 12, color: '#475569', fontWeight: '500' },
  chipTxtActive: { color: '#1e40af', fontWeight: '700' },
  lista: { padding: 12 },
  kpis: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  kpiLbl: { fontSize: 11, color: '#64748b' },
  kpiVal: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginTop: 2 },
  filaVenta: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  filaEtiqueta: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  filaSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  filaTotal: { fontSize: 16, fontWeight: '800', color: '#1e40af' },
  equilibrioBox: { backgroundColor: '#fff', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 12 },
  equilibrioLbl: { fontSize: 12, color: '#64748b' },
  equilibrioVal: { fontSize: 26, fontWeight: '800', color: '#7c3aed', marginTop: 4 },
  equilibrioSub: { fontSize: 13, color: '#64748b', marginTop: 4 },
  nota: { fontSize: 12, color: '#64748b', lineHeight: 18 },
});
