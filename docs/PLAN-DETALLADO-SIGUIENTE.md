# Plan detallado — Punto Flow (siguiente trabajo)

> **Estado marzo 2026 — lectura histórica:** Este archivo es un **mapa por fases A–L** frente al índice del manual Smart. La **priorización viva** del producto está en **`PLAN-NUEVO-SIGUIENTE.md`** y **`PLAN-CONTINUACION.md`**. Muchas casillas `[ ]` **no reflejan** el código actual (ya hay productos por tipo, KIT, caja, permisos, PDF servidor, etc.). Úselo como **contexto o ideas**, no como checklist único de implementación. FAQ operativo: [`FAQ-INTERNO.md`](FAQ-INTERNO.md).

---

Referencia funcional: **Manual de Usuario Smart Punto de Venta v1.9.x** (PDF).  
**Archivo de referencia:** `C:\Users\djjoh\Downloads\Manual-de-Usuario-Smart-Punto-de-Venta.pdf` (no usar copias en el repo como fuente si difieren).  
Objetivo: completar el producto **por bloques del manual**, sin copiar marca ni interfaz propietaria.

---

## 1. Cómo usamos este plan

- Cada **fase** corresponde a secciones consecutivas del índice del manual.
- Dentro de cada fase, las tareas están **ordenadas** (dependencias primero).
- Al terminar una tarea: API + UI + datos de prueba (seed) si aplica, y una **definición de “listo”** breve.

---

## 2. Estado actual (línea base)

| Área | Hecho |
|------|--------|
| Auth | Login, selector de empresa, JWT, `/auth/organizations` |
| Shell | Menús Facturación / Empresa / Administración, barra empresa–usuario |
| Empresa | Panel en inicio + `/empresa` (datos fiscales, dirección, logo URL, moneda) |
| Productos | Lista, búsqueda, alta/edición admin, stock, 4 precios en modelo |
| Ventas | Nueva venta, lista, ticket imprimible |
| Clientes / proveedores | CRUD básico |
| Compras | Registro con líneas, stock |
| Caja | Apertura/cierre por usuario |
| Usuarios | Lista admin (sin crear usuario desde UI) |
| API (sin UI completa) | Reportes agregados, CxC/CxP, cotizaciones, pedidos proveedor, settings JSON, export backup |

---

## 3. Fase A — Productos al nivel del manual (págs. ~10–16)

**Meta:** acercar el módulo Productos a lo que describe el manual: tipos, granel, columnas y filtros básicos.

### A.1 Modelo de datos

- [ ] Añadir campo **`tipoProducto`** (o equivalente): `PRODUCTO` \| `SERVICIO` \| `INSUMO` (manual: servicio no descuenta stock; insumo no se “vende” al cliente en POS estándar).
- [ ] Añadir flags/campos para **venta a granel** (manual pág. ~14): por ejemplo `esGranel` + `unidadGranel` o factor de conversión respecto a `unit` (definir regla clara en documentación interna de 1 línea).
- [ ] Opcionales en esta fase o A.2: `ubicacion`, `marca`, `codigoBarras` (string), `imagenUrl` (URL como logo).

### A.2 Reglas de negocio

- [ ] En **POST/PATCH venta**: si tipo es `SERVICIO`, **no decrementar** `stock`.
- [ ] En **nueva venta UI**: filtrar o marcar insumos (no listar en búsqueda por defecto, o lista separada “solo productos”).
- [ ] Compras: solo incrementar stock en líneas cuyo producto sea inventariable (`PRODUCTO` o insumo según decisión; documentar).

### A.3 UI Productos

- [ ] Tabla: columnas alineadas al manual donde sea posible: código, nombre, existencia, precio, categoría, impuesto (y “ubicación” si existe en modelo).
- [ ] Formulario crear/editar: pestañas o secciones — **General** (tipo, granel, unidad, costos, ISV, existencias, mínimos), **Precios** (4 precios), **Opcional** imagen URL.
- [ ] Búsqueda: mantener por nombre/SKU; si el modelo tiene barcode, búsqueda por ese campo.

### A.4 Definición de “listo” (Fase A)

- Crear producto **servicio**, venderlo y comprobar que **no baja stock**.
- Crear producto **granel** con regla acordada y documentada en comentario corto en código o en este doc.
- Admin puede ver/editar tipo y granel; lista refleja tipo o badge.

---

## 4. Fase B — Ventas: estándar, táctil y preventas (manual ~17–28)

**Meta:** separar flujos que el manual distingue.

### B.1 Lista de ventas

- [ ] Filtros: **rango de fechas**, cliente, condición contado/crédito (manual: filtros).
- [ ] Columnas: fecha, documento, cliente, total, estado si existe en modelo.

### B.2 Nueva venta “estándar” vs “táctil”

- [ ] **Estándar** (`/venta`): flujo actual optimizado teclado/búsqueda (renombrar en UI si hace falta).
- [ ] **Táctil** (`/venta/tactil`): rejilla de productos favoritos / categorías, botones grandes, menos teclado; misma API `POST /api/sales`.
- [ ] Configuración mínima: lista de **productos favoritos** o “recientes” (tabla o JSON en `OrganizationSettings`).

### B.3 PreVentas (manual ~25–27)

- [ ] Modelo o uso de `Quote` como preventa: estados `BORRADOR` / `PREVENTA_CERRADA` (ajustar enum string).
- [ ] UI: lista de preventas, crear desde pantalla similar a venta sin descontar stock hasta convertir.
- [ ] Acción: **convertir a venta** (ya existe conversión cotización→venta; unificar naming con manual).

### B.4 Definición de “listo” (Fase B)

- Tres entradas de menú o subrutas claras: Lista ventas con filtros, Venta estándar, Venta táctil.
- Flujo preventa creada → convertida → aparece en ventas y descuenta stock una sola vez.

---

## 5. Fase C — Diario digital y caja (manual ~29–36)

**Meta:** acercarse al “Diario Digital”: cierre por usuario, vínculo con abonos.

### C.1 Datos

- [ ] Revisar si `CashSession` necesita **resumen** de ventas del periodo, efectivo esperado, o notas de movimientos (manual: ventas, gastos, abonos en el diario).
- [ ] En cierre: mostrar **totales del periodo** (ventas contado, abonos recibidos) como lectura desde API agregada.

### C.2 UI

- [ ] Pantalla “Diario digital” que muestre sesión abierta, movimientos resumidos y formulario de cierre alineado al manual (campos que el PDF describe).
- [ ] Enlaces rápidos a **registrar abono cliente** y **pago proveedor** (pueden ser atajos a CxC/CxP).

### C.3 Definición de “listo” (Fase C)

- Usuario abre caja, vende, ve resumen en diario, cierra con arqueo; datos persisten.

---

## 6. Fase D — Reportes (manual ~37–39)

- [ ] Pantalla **Lista de reportes** con enlaces.
- [ ] Reportes mínimos v1: resumen ventas por rango (ya hay API), inventario valorizado (ya hay API), **top productos** (nuevo endpoint agregando `SaleLine`).
- [ ] Export CSV opcional para uno de ellos.

**Listo:** 3 reportes usables desde UI con fechas.

---

## 7. Fase E — Cuentas por cobrar / pagar (manual ~33–34, 73–81)

- [ ] UI **CxC**: lista de saldos (API `/api/accounts/receivable`), registrar abono (POST pay).
- [ ] UI **CxP**: análogo con compras a crédito.
- [ ] Opcional manual: **recargo** (nuevo campo o tabla si no existe).

**Listo:** operador registra abono y ve saldo actualizado.

---

## 8. Fase F — Cotizaciones y pedidos (manual ~52–71)

- [ ] UI **cotizaciones**: lista + nueva + líneas (API ya existe en gran parte).
- [ ] UI **pedidos a proveedor**: lista + nuevo + cambio estado (API existe).

**Listo:** flujo completo solo con pantallas.

---

## 9. Fase G — Traslados y sucursales (manual ~58–66)

- [ ] Modelo **Branch** / `Sucursal` + stock por sucursal **o** traslados como movimientos entre “almacenes” (decisión única de arquitectura).
- [ ] UI traslado: enviar / recibir; afecta existencias por ubicación.

**Listo:** traslado entre dos sucursales de prueba en seed.

---

## 10. Fase H — Auditoría e historial de producto (manual ~82–88)

- [ ] **Auditoría**: conteo físico vs sistema, ajuste de stock con registro (tabla `StockAdjustment` o líneas de auditoría).
- [ ] **Historial**: vista por producto de movimientos (ventas, compras, ajustes) — endpoint de lectura.

**Listo:** una auditoría cerrada deja trazabilidad.

---

## 11. Fase I — Empleados, gastos, planillas (manual ~90–103)

- [ ] Modelos `Employee`, `ExpenseBook`, `ExpenseCategory`, `Expense`, `PayrollMovement` (alcance mínimo según manual resumido).
- [ ] Pantallas CRUD esenciales; integración opcional con “Diario digital”.

**Listo:** registrar un gasto y verlo listado.

---

## 12. Fase J — Usuarios, permisos y empresas (manual ~104–116, 114)

- [ ] UI **crear/editar usuario**, hash con misma lógica que seed.
- [ ] **Permisos**: matriz módulo × rol (tabla o JSON); middleware en API por ruta.
- [ ] **Multiempresa UI**: lista empresas (admin sistema) — solo si el producto lo requiere; si no, mantener solo selector login + PATCH org actual.

**Listo:** rol “cajero” sin acceso a productos admin verificado.

---

## 13. Fase K — Respaldos, configuración general, comprobantes (manual ~112–127)

- [ ] UI **descargar respaldo** (GET export ya existe).
- [ ] UI **configuración general** leyendo/escribiendo `/api/settings` (pestañas: general, factura).
- [ ] **Diseñador ticket** v1: plantilla HTML simple + variables (nombre empresa, líneas, totales) guardadas en `invoiceJson` o similar.

**Listo:** backup descargable y ticket usa plantilla guardada.

---

## 14. Fase L — Pulido móvil, impresión, FAQ operativo

- [ ] Revisar flujos en viewport 375px (venta táctil, listas).
- [x] Documento interno **FAQ** (marzo 2026): [`FAQ-INTERNO.md`](FAQ-INTERNO.md) — térmica, PDF, backup, permisos (sin textos legales del PDF Smart).

---

## 15. Orden recomendado de ejecución

1. **Fase A** (productos) — desbloquea ventas correctas con servicios/granel.  
2. **Fase B** (ventas + preventas).  
3. **Fase C** (diario/caja).  
4. **Fase D** (reportes).  
5. **Fase E** (CxC/CxP UI).  
6. **Fases F–K** según prioridad comercial.  
7. **Fase L** continuo o al final de cada fase grande.

---

## 16. Notas

- Cada fase puede ser un **PR o hito** con prueba manual breve.  
- Lo que el manual atribuye a **licencia Windows / activación / Google Drive** se sustituye por equivalentes web (export JSON, almacenamiento propio, sin copiar textos legales del PDF).  
- Mantener **identidad Punto Flow** (nombre, colores, UX ya definidos).

---

*Última actualización: generado como plan de continuación alineado al índice del manual Smart POS.*
