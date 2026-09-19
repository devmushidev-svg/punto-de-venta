# Auditoría de seguridad — resultados del carril Codex

Fecha: 2026-09-19  
Base observada: `3f8530a0`  
Alcance: ventas reenviadas/offline, importadores y almacenamiento del token.

## Modelo de amenaza

- El atacante puede modificar el payload que sale del navegador y cualquier dato
  almacenado en IndexedDB o `localStorage`.
- No puede modificar el código del servidor ni la base de datos directamente.
- Los datos actuales son de prueba; la prueba de venta usó la organización demo.

## Hallazgos

### CODEX-01 — precio de venta controlado por el cliente

- **Nivel:** CONFIRMADO POR INDUCCIÓN.
- **Categoría:** vulnerabilidad de integridad económica.
- **Predicción:** si `/api/sales` acepta `unitPrice` del payload sin compararlo
  con el precio autorizado del producto, una venta manipulada podrá persistir con
  un precio distinto al catálogo.
- **Prueba:** autenticación como `ADMIN` en `demo`; producto SKU `1`, precio de
  catálogo `5.00`; petición a `POST /api/sales` con `unitPrice: 0.01`, cantidad 1,
  `discountPercent: 0` y un `clientRef` nuevo.
- **Resultado observado:** HTTP `201`; la línea y el total persistieron como
  `0.01` (`subtotal: 0.008695...`, `tax: 0.001304...`).
- **Causa:** el servidor usa `line.unitPrice ?? resolveProductUnitPrice(...)`.
  El impuesto sí se recalcula, pero el precio base no.
- **Decisión pendiente:** no corregido todavía. Hay edición manual de precio en
  la UI; primero hay que acordar si esa capacidad requiere permiso, un precio
  autorizado por rol o una validación contra catálogo.

### CODEX-02 — importadores sin límite de tamaño visible

- **Nivel:** CODE FACT / HIPÓTESIS PLAUSIBLE; no se ejecutó una carga grande.
- **Categoría:** endurecimiento y posible agotamiento de recursos.
- `POST /api/import/excel` convierte el archivo completo a `Uint8Array` y lo
  entrega a ExcelJS sin límite de bytes, filas, hojas o profundidad.
- `POST /api/backup/import` recibe un JSON completo y lo procesa sin un límite
  de cuerpo explícito ni límites por colección antes de la transacción.
- **Predicción falsable:** una petición multipart/JSON suficientemente grande
  será leída y procesada hasta agotar memoria o tiempo antes de que exista una
  decisión de rechazo en el borde.
- **Siguiente prueba:** ejecutar una carga controlada con límite de tiempo y
  observar memoria/latencia; no se ejecutó para no degradar el servidor activo.

### CODEX-03 — token accesible desde scripts de la página

- **Nivel:** CODE FACT; no es un bypass por sí solo.
- **Categoría:** decisión de arquitectura / endurecimiento.
- `apps/web/src/auth/AuthContext.tsx` lee y escribe `pf_token` en
  `localStorage`; `apps/web/src/api/client.ts` lo adjunta a cada petición.
- Cualquier JavaScript que ejecute en el origen puede leer el token. Esto eleva
  el impacto de un XSS, pero no demuestra XSS ni una exfiltración en esta prueba.
- **Decisión pendiente:** documentar explícitamente la elección o migrar a una
  cookie `HttpOnly` con protección CSRF; requiere coordinación con autenticación,
  offline y despliegue.

## Vectores descartados en este pase

| Vector | Resultado |
|---|---|
| Recalcular impuesto en venta manipulada | Falsificado como mitigación suficiente: el impuesto se recalcula, pero el precio queda controlado por el cliente. |
| Declarar el precio como hallazgo de autenticación | Descartado: la petición requiere un usuario autenticado; el problema es integridad económica dentro de la frontera de confianza. |

## Estado honesto

- Ejecutado: login demo y petición real contra el servidor local.
- Confirmado: CODEX-01.
- No ejecutado: carga grande de importadores.
- No modificado: política de precios, token ni rutas de importación.
