# Plan nuevo — Siguiente trabajo (Punto Flow)

Documento **actual** de continuación. Sustituye en la práctica la priorización del archivo `PLAN-DETALLADO-LO-SIGUIENTE.md` para lo que viene; ese archivo sigue siendo referencia de contexto histórico.

**Referencia:** manual Smart POS (**PDF autorizado**). Copia habitual:  
`C:\Users\djjoh\Downloads\Manual-de-Usuario-Smart-Punto-de-Venta.pdf`  
(también puede estar en la raíz del repo para extraer). **Producto:** Punto Flow (web, identidad propia).

### Cómo “pasar” el PDF al trabajo (para seguir el manual al pie de la letra)

1. El asistente **no puede leer el PDF binario** como texto; hace falta **texto plano buscable** en el proyecto.
2. Desde la raíz del repo ejecutar:
   - `npm run manual:extract` — si el archivo se llama `Manual-de-Usuario-Smart-Punto-de-Venta.pdf` en la **raíz** del repo, o  
   - `npm run manual:extract -- "C:\Users\djjoh\Downloads\Manual-de-Usuario-Smart-Punto-de-Venta.pdf"` — para usar el de Descargas.
3. Eso genera o actualiza **`docs/manual-smart-texto-extraido.txt`** (v1.9.x, **158 páginas**, incluye el **Contenido** / índice y el cuerpo). **Regla:** al implementar o revisar, el orden y los requisitos deben alinearse con ese archivo (sección + página como en el índice del PDF), salvo lo explícitamente fuera de alcance web en **§11c** (licencias, red Smart, import Excel, gaveta, etc.).
4. Si actualizas el PDF en Descargas, vuelve a ejecutar el comando del punto 2 antes de pedir cambios “según el manual”.

---

## 0. Estimación de avance (orientativa, respecto al manual / roadmap)

No leemos el PDF automáticamente; este porcentaje resume el **plan P1–P6** más la **línea base** ya descrita en §1.

| Mirada | % aprox. | Qué significa |
|--------|----------|----------------|
| **Operación diaria típica** (ventas, táctil, productos, clientes, compras, caja, reportes básicos, CxC/CxP, cotizaciones, pedidos, config, ticket, usuarios) | **~88–92%** | Un negocio puede operar el día a día; faltan refinamientos y módulos “gruesos” del manual. |
| **Roadmap completo P1–P6** (incl. inventario avanzado, RH/gastos, comprobante PDF formal, permisos finos, multiempresa si aplica) | **~82–88%** | P6 v1 (permisos granulares) en código; multiempresa sin cambio (selector login). |
| **Por fase** | P1 ~**93%**; P2 ~**85%**; P3 ~**90%**; P4 ~**55%**; P5 ~**45%**; P6 ~**50%** (matriz + JWT `perms`/`permRev`) | Refinamiento: más claves, QA manual §10b. |

*Actualizar esta tabla al cerrar cada fase.*

---

## 1. Línea base reciente (ya en código)

Además del bloque amplio (táctil, cotizaciones, caja, reportes, CxC/CxP, settings, ticket, granel, usuarios), quedó incorporado:

| Tema | Detalle |
|------|---------|
| Navegación | Barra superior: pestañas con subrayado + **una sola fila** de enlaces por sección (scroll horizontal); sin doble cinta gris |
| Inicio | Panel minimalista: tarjeta empresa + resumen en una línea + enlaces discretos |
| Nueva venta | Cabecera tipo documento, tabla con columnas tipo manual, notas, barra de totales inferior |
| Menú Facturación vs Admin | CxC/CxP y reportes bajo **Administración**; nombres claros (“Cuentas por cobrar”) |
| Móvil | Menú lateral deslizable desde la derecha |

**Pendiente validar** con pruebas funcionales en roles admin / cajero / vendedor.

---

## 2. Principios para lo que sigue

1. **Menos ruido en pantalla** — mismos criterios que inicio y nueva venta en el resto de módulos.  
2. **API alineada a permisos** — lo que el menú oculta, el backend debe rechazar.  
3. **Manual como guía**, no como clon visual del Smart de escritorio.

---

## 3. Fase P1 — Consolidación (1–2 semanas según ritmo)

| ID | Entrega | Descripción |
|----|---------|-------------|
| P1.1 | QA checklist | Matriz corta: login, venta contado/crédito, táctil, preventa→convertir, caja abrir/cerrar, CxC/CxP abono, backup admin, usuario nuevo |
| P1.2 | `requireAdmin` / roles | **Hecho (marzo 2026):** proveedores POST/PATCH; ya existían productos, settings, backup, usuarios, PATCH org. Clientes/compras/ventas abiertas a cajero/vendedor; favoritos táctil siguen para cualquier usuario. |
| P1.3 | Navegación opcional “Más” | **Hecho:** en Facturación, cinta corta + desplegable «Más» (Compras, Proveedores, PreVentas, Cotizaciones, Pedidos). |
| P1.4 | Términos de venta | **Hecho** (catálogo UI + API `saleTerms`). |
| P1.5 | Convertir cotización | **Hecho** (modal términos + abono). |

**Definición de listo:** checklist verde + política de permisos documentada en 5–10 líneas al final de este doc o en README interno.

---

## 4. Fase P2 — UX homogénea del resto de pantallas

Alinear cabeceras, tablas y acciones con el nivel de **Nueva venta** / **Inicio** (sin bloques redundantes).

*Avance:* cabeceras homogéneas y ayudas breves en **Ventas**, **Productos** (incl. pestañas del modal), **Compras**, **Clientes**, **Proveedores**, **Reportes**, **CxC/CxP**, **Caja**, **Pedidos proveedor**, **Configuración** (pestañas superiores), **Usuarios**, **Empresa**; subnavegación unificada Ventas \| PreVentas \| Cotizaciones en lista de ventas. Pendiente menor: densidad de algunos formularios largos, revisión 1366×768 explícita.

| Pantalla | Objetivo |
|----------|----------|
| Lista de ventas | **Hecho (mar 2026):** pestañas Ventas \| PreVentas \| Cotizaciones bajo `/ventas` + `/ventas/preventas`; redirección desde `/venta/preventas`; toolbar existente. |
| Productos | **Hecho (mar 2026):** cabecera «Qué es» + nota; tabla con scroll vertical acotado y `thead` fijo; filtros algo más compactos. |
| Compras / Clientes / Proveedores | **Hecho (abr 2026):** cabecera tipo «Qué es» + nota breve (compras/clientes/proveedores). |
| Reportes | **Hecho (abr 2026):** subnav por tipo; pestañas Gastos/Planillas (RH) si admin o `expenses.view` / `payroll.view`. |
| CxC / CxP | **Hecho (abr 2026):** línea «Qué es» + detalle breve abonos/recargos. |

**Listo:** revisión visual en 5 pantallas clave sin scroll innecesario en laptop 1366×768.

---

## 5. Fase P3 — Inventario avanzado (manual ~14–16, ~82–88)

| ID | Tema | Notas |
|----|------|--------|
| P3.1 | Precios por tramo / cantidad | **Hecho:** `Product.volumePricesJson` + resolución en API (`POST /sales`, `POST /quotes`) y web (venta, táctil, cotización, modal productos). Demo: SEED-023. |
| P3.2 | Kits / paquetes | **Hecho:** tipo `KIT`, tabla `ProductKitLine`, venta/cotización→venta descuenta componentes; UI pestaña «Combo»; compras rechazan KIT; demo `KIT-DEMO-01`. |
| P3.3 | Traslados | **Hecho:** `StockLocation` + `StockTransfer` / líneas; enviar/recibir/anular con ajuste de `Product.stock` (tránsito); UI `/traslados` y menú Más; ubicaciones demo `PRIN`/`BODE` en seed. |
| P3.4 | Auditoría + historial por producto | **Hecho:** `StockAdjustment` + líneas; `POST/GET /stock-adjustments` (admin); `GET /products/:id/movements`; UI `/auditoria-inventario` y modal «Mov.» en productos; backup incluye ajustes. |

**Listo:** fase **P3** (P3.1–P3.4) cubierta en código. Las fases P4–P6 se describen en §6–§8.

---

## 6. Fase P4 — Operación y RH (manual ~90–103)

- **Hecho (v1):** modelos `Expense`, `Employee`, `PayrollPeriod` + `PayrollLine`; API admin `GET/POST /expenses`, `GET/POST/PATCH /employees`, `GET/POST/PATCH /payroll-periods`; UI `/gastos`, `/empleados`, `/planillas`; backup incluye tablas; seed demo empleado `E001` + gasto; inicio admin muestra **Gastos hoy** enlazando a `/gastos`.
- **Refinamiento (abr 2026):** en Reportes, pestañas **Gastos** y **Planillas** si el usuario es admin o tiene `expenses.view` / `payroll.view` — `GET /reports/expenses-summary` y `GET /reports/payroll-summary`; export CSV. **Deducciones por concepto (mar 2026):** tabla `PayrollLineDeduction`. **RH consulta (mar 2026):** claves `expenses.view` y `payroll.view`; menú Gastos/Planillas y listados; `POST /expenses` y `POST/PATCH /payroll-periods` siguen solo administrador.

**Listo (v1):** gasto en listado + empleado demo en BD ✓

---

## 7. Fase P5 — Comprobantes e impresión

- **Hecho (v1):** Ruta `/ventas/:id/comprobante` — documento tipo carta con datos de empresa (`/organizations/current`), líneas detalladas (SKU opcional vía `invoice.comprobante.showSku`), totales y pie compartido con `ticket.footerLine` / `headerLine`. **Imprimir / Guardar como PDF** desde el navegador; ayuda en pantalla y cromado del shell oculto al imprimir esta ruta. Enlaces **Carta** en lista de ventas y desde ticket térmico.
- **PDF servidor (mar 2026):** `GET /api/sales/:saleId/comprobante.pdf` (pdfkit), botón en pantalla comprobante. **Logo (mar 2026):** si `Organization.logoUrl` es PNG/JPEG vía `https://` o data URL, se incrusta en el encabezado del PDF (el servidor debe poder descargar la URL). Pendiente opcional: plantillas HTML/PDF más ricas más allá del JSON actual.

---

## 8. Fase P6 — Permisos finos y multiempresa (si aplica)

- **Hecho (v1):** `User.permissionsJson` con `{ "allow": [], "deny": [] }` de claves conocidas; baseline por rol (`vendedor` → reportes + traslados + CxC/CxP/compras; `cajero` → CxC/CxP/compras). API `requirePermission` en `GET /reports/*`, traslados, `POST /purchases`, `GET /purchases` con `requireAnyPermission(record, view)`, y rutas de cuentas por cobrar/pagar. Con JWT nuevo: claims `permRev` + `perms` (copia de `permissionsRev` y lista efectiva al login); si coincide rev con BD, no se reparsea `permissionsJson`. Al cambiar rol o matriz en `PATCH /users/:id`, `permissionsRev` incrementa → 401 `PERM_STALE` en `auth/me` y rutas con `requirePermission`. Tokens sin claims nuevos siguen validando solo desde BD. `requireAdmin` comprueba rol en BD (no solo en JWT). Web: evento `pf-auth-stale` limpia sesión; `apiFetch`/`apiDownload` reconocen el código.
- **Multiempresa:** sin cambio (selector en login).
- **Solo lectura compras (2026-03-31):** clave `purchases.view` (no está en baseline; se concede en matriz). **UI matriz (abr 2026):** bloques «Incluido en el rol», «Restringido» y «Añadido manualmente» en edición de usuario.

---

## 9. Orden sugerido de ejecución

1. **P1** completo (base sólida).  
2. **P2** en paralelo o justo después (mejora percibida por usuarios).  
3. **P3** según prioridad del negocio (margen vs kits vs traslados).  
4. **P4 → P5 → P6** cuando P1–P3 estén estables.

---

## 10. Registro de decisiones (rellenar al avanzar)

| Fecha | Decisión |
|-------|----------|
| 2026-03-31 | **P1.2 API:** `POST/PATCH /suppliers` solo `admin`. Catálogo de productos, usuarios, backup, `PATCH /settings` y `PATCH /organizations/current` ya restringidos. Clientes y compras siguen disponibles para cajero/vendedor (alta en mostrador). `POST /settings/touch-favorites` permanece para cualquier usuario autenticado (favoritos táctil). |
| 2026-03-31 | **P1.1 QA (checklist corto):** login admin y cajero; nueva venta contado/crédito; táctil; preventa→convertir; caja abrir/cerrar; CxC/CxP abono; backup solo admin; usuario nuevo solo admin; proveedor nuevo solo admin. |
| 2026-03-31 | **P3.1 precios por volumen:** `volumePricesJson` en `Product`; precio = lista (1–4) y, si hay tramos, el del mayor `minQty` ≤ cantidad. Cotizaciones usan lista 1. Productos existentes en BD deben recibir `db push` para la nueva columna (default `[]`). |
| 2026-03-31 | **P3.2 kits:** `ProductKitLine` (componente `PRODUCTO` + cantidad por kit). Stock del kit en 0; validación y descuento por componentes en `POST /sales` y convertir cotización. Sin kits anidados. Compras no aceptan líneas KIT. |
| 2026-03-31 | **P3.3 traslados:** Stock global `Product.stock`; al enviar descuenta, al recibir suma (tránsito = menos stock total). Ubicaciones administrables; empresas nuevas sin seed deben crear al menos dos ubicaciones (admin) o usar POST `/stock-locations`. |
| 2026-04-01 | **P3.4 auditoría:** Ajustes con motivo y `qtyDelta` por línea (admin). Movimientos = ventas (sin KIT/SERVICIO en línea), compras, traslado envío/recepción, ajustes. Ventas de combo no generan línea de movimiento en componentes (solo en cabecera KIT si se vendiera con stock — hoy KIT no mueve stock de cabecera). |
| 2026-04-01 | **P4 v1:** Gastos categorizados; empleados (catálogo RH); planilla mensual por empleado (bruto/deducciones/neto, cerrar borrador). Rutas y API con `requireAdmin`; resumen «Gastos hoy» en inicio para admin. |
| 2026-04-01 | **P5 v1:** Comprobante carta en `/ventas/:id/comprobante` (impresión/PDF del navegador); `invoice.comprobante.title` y `showSku`; shell sin cabecera al imprimir esa URL. |
| 2026-04-01 | **P6 v1:** `permissionsJson` + claves `reports.view` e `inventory.transfers`; cajero sin reportes/traslados por defecto; vendedor con ambos; admin omite matriz. Comprobación en API por consulta a usuario. |
| 2026-04-01 | **Alineación manual Smart (PDF v1.9):** Tabla de equivalencias §11b + brechas §11c; política permisos §10c; `npm run verify` para build; ayuda login/caja enlazada al flujo tipo manual. |
| 2026-03-31 | **CxC/CxP recargos:** modelos `ReceivableSurcharge` / `PayableSurcharge`; saldo = total + Σ recargos − pagado; `POST .../surcharge`; UI en `/cxc` y `/cxp`; backup JSON incluye recargos anidados en ventas/compras. |
| 2026-03-31 | **P6 permisos ampliados:** claves `accounts.receivable`, `accounts.payable`, `purchases.record` en baseline cajero/vendedor; API + rutas web + menú; denegación vía matriz en Usuarios. |
| 2026-03-31 | **P6 JWT permisos:** `User.permissionsRev`; token con `permRev` + `perms`; invalidación al cambiar rol/`permissionsJson`; `requireAdmin` vs rol en BD; cliente reacciona a `PERM_STALE`. |
| 2026-04-01 | **P2 lista ventas:** `SalesHubLayout` con subnavegación Ventas / PreVentas / Cotizaciones; rutas anidadas `ventas`, `ventas/preventas`, `ventas/preventas/nueva`; `Lista de ventas` en cinta con `end: true` para resaltar solo el índice. |
| 2026-04-01 | **P4 reportes + P6 UI:** `/reports/expenses-summary` y `/reports/payroll-summary`; pestañas en `/reportes`; Usuarios con resumen rol/deny/allow antes de las casillas. *(Actualización mar 2026: resúmenes RH con `expenses.view` / `payroll.view`.)* |
| 2026-04-01 | **P2 ayudas CxC/CxP + catálogos:** frase «Qué es» en cobrar/pagar/compras/clientes/proveedores; etiqueta permiso `reports.view` aclara pestañas admin. |
| 2026-03-31 | **Paridad manual / ventas:** `POST /sales` y `convert-to-sale` exigen `customerId` válido si el término es crédito; UI (nueva venta, táctil, modal convertir cotización) valida y selector de cliente en crédito al convertir. |
| 2026-03-31 | **PreVenta / cotización editable:** `PATCH /quotes/:id` (no `CONVERTIDA`); insumos rechazados en cotización; rutas `/ventas/preventas/:quoteId/editar` y `/cotizaciones/:quoteId/editar`; lista con **Editar**. |
| 2026-03-31 | **P2 Productos:** «Qué es» al estilo Compras; tabla con `max-h` + scroll y encabezado sticky. |
| 2026-03-31 | **P6 compras consulta:** `purchases.view` + `requireAnyPermission` en `GET /purchases`; `POST /purchases` sigue con `purchases.record`; web `/compras` y cinta con cualquiera de los dos; formulario de alta solo con `record`. `PATCH /quotes`: `notes` vacío/`null` → `null` en BD. |
| 2026-03-31 | **P4 planillas:** `PayrollLineDeduction` (concepto + monto + orden); líneas con `deductionItems` opcional en JSON; sin ítems se mantiene bruto/deducción única/neto manual; respaldo exporta ítems anidados. |
| 2026-03-31 | **P6 RH consulta:** `expenses.view` / `payroll.view`; API listados y reportes RH; UI menú, `/gastos`, `/planillas`, pestañas en `/reportes`, inicio y caja; alta gastos/planillas solo admin. |
| 2026-03-31 | **P5 PDF servidor:** comprobante carta vía `GET /sales/:saleId/comprobante.pdf` (pdfkit); botón «Descargar PDF (servidor)» en `/ventas/:id/comprobante`. |
| 2026-03-31 | **Q5 docs:** `FAQ-INTERNO.md`; plan detallado A–L marcado como referencia histórica con enlace al FAQ. |
| 2026-03-31 | **Q5 app:** pantalla **`/ayuda`** (mismo contenido operativo que `FAQ-INTERNO.md`); menú **Empresa → Ayuda / FAQ**; enlace desde **Configuración**. Mantener doc y pantalla alineados al editar. |
| 2026-03-31 | **Ayuda pública + reportes:** ruta **`/ayuda-publica`** (FAQ sin JWT); login con enlace. **Reportes → Inventario:** export **CSV** de todos los productos activos (columna bajo mínimo). |
| 2026-03-31 | **Q3.3 caja (copy):** la referencia de efectivo solo incluye abonado en créditos de ventas **creadas en la sesión**; abonos CxC a facturas antiguas quedan fuera. Texto aclaratorio en **`/caja`** y `FAQ-INTERNO.md`; ver `PLAN-CONTINUACION` Q3.3. |

## 10b. Checklist QA P1.1 (marcar al probar)

- [ ] Login **ADMIN** y **CAJERO** (menú y rutas coherentes).
- [ ] Venta estándar: contado, tarjeta/efectivo, crédito con abono.
- [ ] Venta táctil y ticket.
- [ ] PreVenta / cotización → convertir (términos + abono).
- [ ] Caja: abrir, registrar venta, diario, cerrar.
- [ ] CxC y CxP: abono reduce saldo; recargo aumenta saldo.
- [ ] Backup: solo admin descarga; cajero recibe 403.
- [ ] Usuarios: alta/edición solo admin.
- [ ] Proveedores: alta solo admin; lista visible para todos.
- [ ] Productos: CRUD solo admin; listado y búsqueda para venta.

**Verificación técnica (antes de marcar checklist):** en la raíz del repo ejecutar `npm run verify` (compila API + web). No sustituye prueba manual en navegador.

**Último `npm run verify` (build API + web):** OK tras `/ayuda-publica` + CSV inventario en reportes (2026-03-31).

---

## 10c. Política de permisos (resumen operativo)

1. **Administrador** — acceso total; `permissionsJson` se guarda como `{}` y no aplica matriz fina.  
2. **Vendedor** — por defecto incluye **reportes** y **traslados de inventario**; el admin puede quitar uno u otro con la matriz en *Usuarios*.  
3. **Cajero** — por defecto **sin** reportes ni traslados; el admin puede concederlos. Por defecto **sí** tiene CxC, CxP y compras (`accounts.receivable`, `accounts.payable`, `purchases.record`); el admin puede denegarlos en la matriz (comportamiento tipo manual salvo que se restrinja). Caja y ventas siguen para cualquier usuario autenticado.  
4. Lo que el menú oculta por permiso debe responder **403** en API: aplicado a `/reports/sales-summary`, `/reports/inventory`, `/reports/top-products` con `reports.view`; traslados; `GET /purchases` (`purchases.record` **o** `purchases.view`); `POST /purchases` (solo `purchases.record`); CxC/CxP. **`/reports/expenses-summary`** y **`GET /expenses`** requieren `expenses.view` (admin pasa siempre). **`/reports/payroll-summary`** y **`GET /payroll-periods`** requieren `payroll.view`. Registrar gastos y crear/cerrar planillas: **`requireAdmin`**. El resto mantiene reglas históricas (`requireAdmin` en catálogos sensibles).  
5. Tras cambiar **rol o matriz** de un usuario, su JWT anterior queda inválido (`permissionsRev`): la siguiente petición puede devolver **401** con código `PERM_STALE` y la app cerrará sesión; debe **iniciar sesión de nuevo**. Para cambios solo en nombre/contraseña no sube el rev.

---

## 11. Relación con otros documentos

- `docs/PLAN-CONTINUACION.md` — **siguiente bloque priorizado** (dónde vamos en el índice del PDF, Q1–Q5: QA, lista ventas, diario caja, refinamientos).  
- `docs/FAQ-INTERNO.md` — respuestas cortas (térmica, PDF, backup, permisos, PWA, dev); en app: **`/ayuda`** y **`/ayuda-publica`** (sin sesión).  
- `docs/PLAN-DETALLADO-SIGUIENTE.md` — mapa frente al índice del manual (fases A–L); **histórico / no checklist único** (ver aviso en su cabecera).  
- `docs/PLAN-DETALLADO-LO-SIGUIENTE.md` — plan post–bloque amplio (fases N1–N7); muchas tareas se **trasladan** aquí como P3–P6.  
- Este archivo **`PLAN-NUEVO-SIGUIENTE.md`** es la **hoja de ruta operativa actual**.

---

## 11b. Equivalencias Manual Smart POS (v1.9.x) → Punto Flow

Referencia cruzada con el *Manual de Usuario* (PDF en `Downloads`, ver cabecera del doc). La UI y marca son **Punto Flow**; el flujo funcional busca paridad donde aplica.

| Módulo / tema (manual Smart) | En Punto Flow |
|------------------------------|---------------|
| Inicio de sesión / empresas | Login + selector de organización |
| Información de la empresa | `/empresa` |
| Productos (incl. granel, combos) | `/productos` (tipos, tramos, KIT) |
| Lista de ventas | `/ventas` |
| Nueva venta táctil | `/venta/tactil` |
| Nueva venta estándar | `/venta` |
| PreVentas | `/ventas/preventas` (antes `/venta/preventas` → redirige) |
| Cotizaciones | `/cotizaciones` |
| Diario digital / caja | `/caja` |
| Cuentas por cobrar / abonos | `/cxc` (`accounts.receivable`) |
| Cuentas por pagar / pagos | `/cxp` (`accounts.payable`) |
| Reportes | `/reportes` (permiso `reports.view`) |
| Clientes | `/clientes` |
| Compras | `/compras` (`purchases.record` registrar; `purchases.view` solo lista) |
| Proveedores | `/proveedores` |
| Pedidos | `/pedidos-proveedor` |
| Traslados / sucursales* | `/traslados` (permiso `inventory.transfers`); *red multi-PC como Smart no aplica en web |
| Auditoría / historial producto | `/auditoria-inventario`, modal **Mov.** en productos |
| Empleados / gastos / planillas | `/empleados` (admin); `/gastos` (admin o `expenses.view`); `/planillas` (admin o `payroll.view`) |
| Usuarios y permisos | `/usuarios` + matriz fina P6 |
| Ticket / factura carta | `/ventas/:id/ticket`, `/ventas/:id/comprobante` (PDF carta también `GET /api/sales/:id/comprobante.pdf`) |
| Respaldo | Configuración → respaldo JSON (admin) |
| Ayuda operativa / soporte interno | `/ayuda` (autenticado); **`/ayuda-publica`** antes del login (`FAQ-INTERNO.md`) |

## 11c. Brechas conocidas vs manual Smart (no bloquean operación básica)

- **Cierre general de empresa** (manual ~35): no hay equivalente único; usar caja por usuario + reportes.  
- **Red local/remota, licencias, activación, import Excel, gaveta**: propios del escritorio Smart; Punto Flow es web + JSON backup.  
- **Diseñador de facturas** avanzado: ticket + JSON `invoice` en ajustes; comprobante carta en P5 v1.

---

*Creado para continuar el desarrollo tras ajustes de UX (shell, inicio, nueva venta, menús).*
