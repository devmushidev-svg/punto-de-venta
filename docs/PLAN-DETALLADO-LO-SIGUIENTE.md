# Plan detallado — Lo siguiente (post bloque amplio)

Documento de continuación después del bloque **“Continuación amplia: manual Smart + Punto Flow”** (venta táctil, preventas/cotizaciones, diario de caja, reportes, CxC/CxP, pedidos proveedor, configuración JSON, backup, ticket v1, granel, usuarios CRUD).

**Referencia funcional:** manual Smart POS (índice / PDF en `C:\Users\djjoh\Downloads\Manual-de-Usuario-Smart-Punto-de-Venta.pdf`). **Producto:** Punto Flow (web, UI propia).

---

## 1. Estado cubierto (línea base actual)

| Área | Rutas / piezas principales | Notas |
|------|----------------------------|--------|
| Venta táctil | `/venta/tactil` | Favoritos en settings, rejilla, `POST /sales` |
| PreVentas / cotizaciones | `/venta/preventas`, `/cotizaciones`, `…/nueva` | Modelo `Quote`, convertir a venta |
| Pedidos proveedor | `/pedidos-proveedor` | `SupplierOrder`, estados |
| Diario digital | `/caja` + `GET /cash-sessions/current/diary` | Resumen turno, enlaces CxC/CxP |
| Reportes | `/reportes` | Resumen ventas, inventario, top productos, CSV |
| CxC / CxP | `/cxc`, `/cxp` | Abonos vía API existente |
| Configuración | `/configuracion` | JSON general + factura/ticket, backup admin |
| Ticket | `SaleTicketPage` + `invoice.ticket` en settings | `headerLine`, `footerLine`, `showTaxBreakdown` |
| Productos granel | `esGranel` en Prisma + productos UI | Táctil usa incrementos decimales |
| Usuarios | `/usuarios` | POST/PATCH usuarios, roles admin/cajero/vendedor |
| Lista ventas | `/ventas` | Filtros fecha, cliente, términos, búsqueda |

Lo anterior debe validarse en **pruebas funcionales** antes de asumir regresiones cero.

---

## 2. Objetivo de este plan

Definir el **siguiente trabajo** en orden lógico: primero consolidación y paridad útil con el manual, luego módulos que aún no existen en UI o modelo.

---

## 3. Fase N1 — Consolidación tras pruebas (corto plazo)

**Meta:** cerrar huecos detectados en QA sin abrir módulos grandes.

| ID | Tarea | Detalle |
|----|--------|---------|
| N1.1 | Checklist funcional | Recorrer rutas de la tabla §1 con rol admin y rol cajero/vendedor; anotar fallos en issues o al final de este doc |
| N1.2 | Permisos reales en API | Hoy el rol limita pocas rutas; decidir qué endpoints exigen `requireAdmin` (productos, usuarios, backup, settings) y aplicar de forma consistente |
| N1.3 | Términos de venta extendidos | Manual muestra `TARJETA`, `30 DIAS`, etc.; hoy el modelo usa `terms` string — valorar enum o catálogo + UI en nueva venta/lista |
| N1.4 | Cotización → venta crédito | La conversión actual fuerza contado; si el negocio lo pide, permitir términos y abono al convertir |
| N1.5 | Diario: sesión cerrada | Opcional: ver último cierre o `GET /cash-sessions/:id/diary` desde historial (UI mínima) |

**Listo:** checklist §6 ejecutado y decisiones N1.2–N1.4 documentadas (aunque sea “no hacer en v1”).

---

## 4. Fase N2 — Paridad productos / ventas con capturas manual (medio)

**Meta:** acercarse a pantallas densas del manual sin copiar ribbon Windows.

| ID | Tarea | Detalle técnico |
|----|--------|-----------------|
| N2.1 | Precios por cantidad (rejilla Smart) | Modelo `PriceTier` o JSON en `Product` (minQty + price); UI tabla en pestaña Precios; `POST /sales` elige precio por `priceTier` o por umbral de cantidad |
| N2.2 | Kits / paquetes | Modelo kit (cabecera + líneas componentes) o `productType=KIT` con explosión en venta; stock de componentes |
| N2.3 | Lista ventas: toggle Ventas / PreVentas | Misma pantalla con pestañas o `SalesPage` + sub-ruta que lista quotes sin salir de contexto (hoy hay rutas separadas) |
| N2.4 | Columna utilidad en ventas | Si hay `cost` en líneas o snapshot: calcular margen por venta o por línea en API + columna opcional |
| N2.5 | Filtros productos avanzados | “Sugeridos”, “con vencimiento” requieren campos nuevos (`suggested`, `expiresAt`) o aplazar |

**Listo:** al menos **N2.1** o **N2.2** cerrado con seed de prueba (el otro puede quedar en backlog explícito).

---

## 5. Fase N3 — Traslados y sucursales (manual ~58–66)

**Meta:** stock por ubicación o movimientos entre almacenes.

| ID | Tarea | Detalle |
|----|--------|---------|
| N3.1 | Diseño | Elegir: (A) `Branch` + `StockByBranch` o (B) solo `StockTransfer` entre códigos de ubicación sin multi-sucursal real |
| N3.2 | API | CRUD traslado, confirmación recepción, trazabilidad |
| N3.3 | UI | Lista + alta traslado; no duplicar lógica de compras |

**Listo:** seed con 2 ubicaciones y un traslado que mueve existencias correctamente.

---

## 6. Fase N4 — Auditoría e historial de producto (manual ~82–88)

| ID | Tarea | Detalle |
|----|--------|---------|
| N4.1 | Ajustes de inventario | Tabla `StockAdjustment` (motivo, usuario, fecha, líneas) |
| N4.2 | Historial | `GET /products/:id/movements` agregando ventas, compras, ajustes, traslados |
| N4.3 | UI | Pantalla producto → “Movimientos”; lista auditorías |

**Listo:** un ajuste queda registrado y visible en historial.

---

## 7. Fase N5 — Empleados, gastos, planillas (manual ~90–103)

| ID | Tarea | Detalle |
|----|--------|---------|
| N5.1 | Modelos mínimos | `Employee`, `ExpenseCategory`, `Expense` (y opcional `PayrollMovement`) |
| N5.2 | Diario digital | Incluir totales de gastos del día/sesión si aplica |
| N5.3 | UI | CRUD gastos; lista empleados; planillas en alcance reducido v1 |

**Listo:** registrar un gasto categorizado y listarlo.

---

## 8. Fase N6 — Permisos finos y multiempresa (manual ~104–116)

| ID | Tarea | Detalle |
|----|--------|---------|
| N6.1 | Matriz permisos | JSON por usuario o tabla `UserPermission`; middleware por ruta o por “recurso” |
| N6.2 | Verificación | Caso de prueba: cajero sin PATCH productos ni backup |
| N6.3 | Multiempresa UI | Solo si el producto lo requiere: admin sistema que cree orgs; si no, mantener flujo actual login + una org |

**Listo:** política documentada y al menos un rol distinto de admin con límites reales en API.

---

## 9. Fase N7 — Comprobantes e impresión (iteración)

| ID | Tarea | Detalle |
|----|--------|---------|
| N7.1 | Factura PDF/HTML | Plantilla aparte del ticket; datos fiscales desde org |
| N7.2 | Impresoras / gaveta | FAQ interno (navegador, drivers); sin depender de binarios Smart |
| N7.3 | Pulido móvil | `375px` en venta táctil, listas largas, modales |

---

## 10. Orden recomendado de ejecución

1. **N1** — inmediatamente después de tus pruebas funcionales.  
2. **N2** — según prioridad comercial (kits vs precios por cantidad).  
3. **N3 → N4 → N5** — orden sugerido por dependencia de inventario.  
4. **N6** — en paralelo o justo después de N1 si hay riesgo de seguridad.  
5. **N7** — continuo o al cierre de un hito.

---

## 11. Checklist sugerido para pruebas funcionales (antes de N2)

- [ ] Login admin y usuario restringido (comportamiento menú y rutas directas).  
- [ ] CRUD producto (incl. granel, tipos PRODUCTO/SERVICIO/INSUMO) y venta que no baje stock en servicio.  
- [ ] Venta estándar, táctil, ticket impreso con texto de configuración.  
- [ ] PreVenta/cotización → convertir → ticket y stock una sola vez.  
- [ ] Caja: abrir, vender, ver diario, cerrar.  
- [ ] CxC: abono reduce saldo; CxP: pago reduce saldo.  
- [ ] Reportes: fechas, top productos, CSV descarga.  
- [ ] Pedido proveedor: crear y cambiar estado.  
- [ ] Configuración: guardar JSON, descargar backup (admin).  
- [ ] Usuario nuevo, edición contraseña, usuario inactivo no entra.

---

## 12. Notas

- Las capturas de manual (págs. ~10–18 y siguientes) sirven como **checklist visual**; la implementación sigue siendo **Punto Flow**.  
- Para pantallas nuevas muy densas (planillas, diseñador factura completo), **1–3 capturas por módulo** antes de implementar ahorran retrabajo.  
- Este archivo puede actualizarse tras cada hito (marcar Nx como hecho o dividir tareas).

---

*Generado como plan de trabajo posterior al bloque amplio ya integrado en código.*
