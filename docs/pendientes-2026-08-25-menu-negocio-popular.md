# AELA ERP — Sesión 2026-08-25 (parte 2) — Ocultar menú de régimen general para Negocio Popular

## Pedido del usuario

"Sería bueno que si es negocio popular en el menú ya no aparezca
facturas, ni lo que se relaciona con otro tipo de contribuyente, si no
solo a lo que se refiere en contribuyente de tipo negocio popular."

## Investigación

Se mapeó el sidebar completo (`Layout.jsx`, `GRUPOS_MENU`) y los otros 4
lugares con enlaces "tipo menú": `QuickBar.jsx` (accesos rápidos
contextuales), `FinanzasHub.jsx` (hub financiero con tarjetas por
módulo), `Dashboard.jsx` (accesos rápidos + "Módulos activos" + tarjeta
de estadística "Facturas {año}").

Se decidió el criterio de qué ocultar basado en si el documento/reporte
es exclusivo del régimen general (factura electrónica y todo lo que
depende de esa infraestructura) vs. algo que cualquier negocio necesita
sin importar su régimen de ventas:

**Se oculta** (exclusivo de régimen general, Negocio Popular no lo usa):
`/facturas`, `/facturas/importar-historicas`, `/facturas/nueva`,
`/notas-debito` (SRI, ligadas a facturas), `/guias-remision` (misma
infraestructura de comprobante electrónico), `/retenciones`,
`/retenciones-recibidas`, `/ats`, `/declaraciones`, `/reportes-tributarios`.

**Se mantiene** (no depende del régimen de ventas propio): Compras,
Liquidaciones de compra (se emite hacia el vendedor sin RUC, no depende
de cómo factura el comprador), Inventario, Clientes y Proveedores,
Contabilidad/CxC/CxP/Caja Chica (herramienta general de gestión, no
exclusiva de "otro tipo de contribuyente" aunque Negocio Popular
normalmente no esté obligado a llevar contabilidad formal), Bancos
(las "Notas de Crédito/Débito" de este grupo son conciliación bancaria,
concepto distinto a los comprobantes SRI del mismo nombre), Config SRI/
Sistema, Talento Humano.

## Implementación

- `frontend/src/utils/sistema.js`: nueva fuente única
  `RUTAS_OCULTAS_NEGOCIO_POPULAR` (array de rutas) + helper
  `ocultoPorNegocioPopular(ruta, sistema)` — reutilizada en todos los
  lugares de abajo para que la lista de exclusión no se duplique ni
  quede desincronizada.
- `Layout.jsx`: aplicado en el filtro de `ITEMS_SUELTOS` y en el filtro
  de ítems dentro de cada grupo del sidebar. El grupo "Tributario" ya
  tenía la lógica de "ocultar grupo si queda sin ítems visibles" (mismo
  patrón que `soloMulti`) — al ocultar sus 5 ítems, el grupo entero
  desaparece automáticamente, sin cambios adicionales.
- `QuickBar.jsx`: mismo helper en el filtro de accesos rápidos
  contextuales (reemplaza el chequeo puntual que se había agregado ayer
  solo para `/facturas/nueva`).
- `FinanzasHub.jsx`: se oculta la tarjeta completa (no solo una acción
  dentro de ella) cuando `m.ruta` está en la lista — esto también
  oculta correctamente la tarjeta "Notas de Crédito" (su ruta es
  `/facturas`, ya que corrige facturas que este régimen no emite).
- `Dashboard.jsx`: accesos rápidos filtrados igual; "Módulos activos"
  quita las píldoras "Retenciones"/"ATS" en vez de mostrarlas apagadas
  (se decidió que verlas "off" seguía insinuando que son módulos
  activables para este régimen, cuando no aplican en absoluto); la
  tarjeta de estadística que decía "Facturas {año}: 0 / Notas: N" pasa
  a decir "Notas de Venta {año}: N" para Negocio Popular.

## Verificación

- `node --test` (backend): 62/62.
- `npx vitest run` (frontend): 16/17 — el 1 que falla es preexistente,
  confirmado con `git stash` que ya fallaba en `main` antes de esta
  sesión (no relacionado, en `construirSistemaFallback`/plan lite).
- `npx vite build`: sin errores.
- Test nuevo `ocultoPorNegocioPopular` en `sistema.test.js` (7
  aserciones: rutas restringidas, no restringidas, con y sin query
  string, régimen general no filtra nada).
- Verificado visualmente contra los datos reales de Deportivo Cat
  (Playwright, mismo mecanismo de servidor local + BD de Railway de
  sesiones anteriores): sidebar sin grupo "Tributario" y sin los 4
  ítems de facturación electrónica en "Ventas"; Dashboard con "Notas de
  Venta 2026: 22" en vez de "Facturas 2026: 0"; "Módulos activos" sin
  Retenciones/ATS; accesos rápidos (Dashboard y QuickBar) sin "Nueva
  Factura"/"Retenciones".

## Pendiente para retomar

Ninguno — el pedido quedó completamente implementado y verificado
contra datos reales.
