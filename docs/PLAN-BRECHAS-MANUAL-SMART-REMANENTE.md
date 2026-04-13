# Plan detallado: brechas remanentes vs Manual Smart v1.9.x (índice)

**Fuente del índice:** `docs/manual-smart-texto-extraido.txt` (líneas 8–98), alineado al PDF *Manual de Usuario Smart Punto de Venta*.  
**Producto actual:** Punto-flow (web + API única). Este plan **no** sustituye el plan maestro del usuario; documenta **lo que aún falta o está parcial** tras la implementación ya hecha en código.

**Metodología sugerida:** por cada fila, abrir el apartado en el PDF (o el `.txt`), contrastar pasos 1…N con la pantalla/API, y marcar hecho solo con evidencia (captura o checklist).

---

## Leyenda

| Estado        | Significado |
|---------------|-------------|
| **Cubierto**  | Paridad razonable web/API con el flujo del manual. |
| **Parcial**   | Existe base; faltan pasos, reglas o UX del manual. |
| **No**        | No implementado o solo documentable. |
| **Fuera web** | Licencia por PC, VPN Radmin, drivers locales, Google Drive sin OAuth, etc. |

---

## A. Plataforma, login, pantalla principal (manual ~pp. 1–7)

| Tema (índice) | Estado | Qué falta / trabajo propuesto |
|---------------|--------|-------------------------------|
| Licencia / activación / portal Smart | **Fuera web** | Mantener omisión o producto comercial aparte. |
| Inicio de sesión (empresa + usuario) | **Cubierto** | `LoginPage`, selector de organización. |
| Configuración login: crear empresa, empresa remota, ejemplo, recuperación ADMIN | **Parcial** | **(1)** API o flujo admin para **crear organización + usuario inicial** desde entorno seguro, o script/documentación operativa. **(2)** “Empresa remota” en Smart = otra BD/servidor; en web = misma API con `pf_api_base` o multi-tenant documentado. **(3)** “Empresa de ejemplo”: seed opcional o `POST /admin/demo-org`. **(4)** Recuperación contraseña: campo `recoveryEmail` existe; falta **token + SMTP + endpoints** (`POST /auth/forgot`, `POST /auth/reset`). |
| Pantalla principal / menú por permisos | **Cubierto** | `AppShell`, permisos. |
| Tutoriales / actualizar app | **Parcial** | Enlaces explícitos a `HelpPage`, vídeos externos; chip de build (`VITE_APP_BUILD`) ya apoyado en `vite.config`. |

**Entregables:** decisión explícita sobre creación de org (UI vs solo backend); spec mínima de reset password (proveedor correo).

---

## B. Información de la empresa (manual ~p. 8)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Datos fiscales, logo, moneda | **Parcial** | **Subida de logo** (`multipart` → disco/S3) vs solo URL. **Exportar logo** = descarga del archivo servido. |
| Recuperación ADMIN (correo) | **Parcial** | Mismo bloque que Parte A (SMTP + flujo). |

**Archivos típicos:** `apps/api/src/index.ts` (nueva ruta), `CompanyInfoPage.tsx`, posible carpeta `uploads/` o storage.

---

## C. Productos (manual ~pp. 10–14)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Alta,4 precios, granel, kit, insumo, código barras | **Cubierto** | — |
| Búsqueda multi-término, filtros existencia/mínimo | **Cubierto** | — |
| Etiquetas | **Cubierto** | Vista previa HTML; opcional: tamaños estándar extra. |
| Stock por sucursal / vista bodegas | **Parcial** | Panel por ubicación en edición de producto **hecho**; falta **documentar** migración `ProductStock` y comando admin si aplica. |
| **Vencimiento / lotes** | **No** | Modelo (`StockLot` o `expiresAt` + informes); filtros “con vencimiento”. Fase 2 del manual. |
| Import Excel | **Cubierto** | Plantilla + `POST /import/excel`. |

---

## D. Ventas: lista, táctil, estándar, PreVentas (manual ~pp. 15–28)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Lista de ventas + columnas | **Cubierto** | — |
| Venta táctil / estándar + vendedor | **Cubierto** | Revisar textos de ayuda vs atajos F2–F11 del manual. |
| **Configurar PreVentas: Modo PreVenta / Caja / Mixto** | **No** (como en manual) | Persistir en `OrganizationSettings.generalJson` (ej. `salesWorkflow`: `preorder_focus` \| `pos_focus` \| `mixed`) y **reflejar en UI**: orden de enlaces en cinta, mensajes en `HelpPage`, opcional ocultar entradas no usadas. |
| PreVenta: mesa/cliente, lista, filtro | **Cubierto** | `serviceLabel`, columna y filtro en listado. |
| Cobrar PreVenta (F5/F8 en manual) | **Parcial** | En web: flujo “convertir a venta” existe; opcional **atajos de teclado** o textos que mapeen F5/F8 a acciones. |
| Orden cocina / exclusión por producto | **Cubierto** | Flags + impresión al guardar cotización/preventa. |

**Archivos típicos:** `SettingsPage.tsx`, `AppShell.tsx` (nav condicional), `HelpPage.tsx`, `generalJson` schema mental.

---

## E. Diario digital y cierre de caja (manual ~pp. 29–36)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Movimientos categorizados + comprobante | **Cubierto** | `CashMovement`, `hasVoucher`. |
| CxC/CxP enlazados a caja | **Cubierto** | Checkbox registrar movimiento. |
| Diario por fecha / otro usuario (admin) | **Cubierto** | Query `cash-diary`. |
| Diario general / agregado | **Cubierto** | `admin-summary`. |
| **Transferir diarios** entre cajeros | **No** / **Parcial** | Definir semántica Smart: ¿mover movimientos entre sesiones? ¿solo reporte consolidado? Implementar según spec. |
| **Reportes impresos de cierre** (detalle productos, resumen) | **Parcial** | Endpoint HTML/PDF que consuma `buildCashDiaryForSession` + datos agregados; botón en `CashPage`. |
| Reclasificar movimientos del diario | **No** | Pantalla admin: editar categoría/nota (con auditoría). |

**Archivos típicos:** `index.ts` (o `routes/cash.ts`), `CashPage.tsx`, nuevo `cashCloseReportPdf.ts` o similar.

---

## F. Reportes (manual ~p. 37)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Reportes operativos | **Cubierto** | Contrastar nombres y filtros con cada subapartado del PDF. |

---

## G. Clientes (manual ~pp. 40–42)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Registro, edición, lista por defecto | **Cubierto** | Incl. `defaultPriceTier`. |

---

## H. Compras y proveedores (manual ~pp. 43–51)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Lista compras, nueva compra, proveedores | **Cubierto** | Auditar estados y textos vs manual. |

---

## I. Cotizaciones (manual ~pp. 52–57)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Lista, nueva, registrar | **Cubierto** | — |

---

## J. Traslados y sucursales (manual ~pp. 58–66)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Traslado enviar/recibir | **Cubierto** | — |
| Export/import archivo entre tiendas | **Cubierto** | JSON; documentar “equivalente a red” con una API. |
| **Registrar sucursales** como módulo con nombre propio | **Parcial** | Alta en `StockTransfersPage`; opcional página **“Sucursales / bodegas”** dedicada (solo CRUD ubicaciones). |
| Enlazar sucursales en red (VPN/IP) | **Fuera web** | Documentar despliegue HTTPS + `pf_api_base`. |
| **Imprimir traslado / precios / reporte por producto** | **Parcial** | Plantilla `window.print` o PDF desde API. |

---

## K. Pedidos a proveedor (manual ~pp. 67–72)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Lista, nuevo, registrar | **Cubierto** | Validar **estados** SIN ENVIAR / ENVIADO / RECIBIDO vs `SupplierOrder.status` y UI `SupplierOrdersPage`. |

---

## L. Cuentas por cobrar / pagar (manual ~pp. 73–81)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Abonos, recargos | **Cubierto** | Pruebas de regresión vs pasos del PDF. |

---

## M. Auditoría e historial (manual ~pp. 82–88)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Auditoría, nueva auditoría | **Cubierto** | — |
| Historial del producto | **Cubierto** | Opcional: **enlace desde línea de venta** a historial del producto (manual sugiere trazabilidad rápida). |

---

## N. RRHH: empleados, planillas, gastos (manual ~pp. 90–103)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Empleados, planillas | **Cubierto** | — |
| Buscar y organizar gastos / libros / categorías | **Cubierto** | **Organizar movimientos del diario** (reclasificar) sigue en Parte E. |

---

## O. Usuarios y permisos (manual ~pp. 104–106)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Usuarios, permisos | **Cubierto** | — |
| Asistente de activación / licencia | **Fuera web** | — |

---

## P. Respaldos y empresas locales/remotas (manual ~pp. 112–114)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Crear respaldo | **Cubierto** | Export JSON. |
| **Restaurar información** (un clic, reemplazo) | **Parcial** | Solo **MERGE_MASTER**; falta modo **REPLACE_FULL** (con doble confirmación + export previo obligatorio) o restauración por tablas. |
| Lista de respaldos automáticos / eliminar viejos | **No** | Tabla `BackupJob`, cron servidor (fuera del repo opcional). |
| Google Drive | **Fuera web** sin OAuth | Documentar “subir export manualmente”. |
| Admin empresas locales y remotas | **Parcial** | Alineado con “crear org” y documentación multi-instancia. |

**Riesgo:** restore total puede borrar datos; diseño obligatorio: backup previo + palabra de confirmación + dry-run.

---

## Q. Configuración general y diseñador (manual ~pp. 116–127+)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Ticket, comprobante, cocina, SAR (serie, tope, fecha límite, pie) | **Cubierto** | Validaciones en venta; pie en ticket/PDF. |
| **Diseñador visual** de factura/ticket | **Parcial** | Editor de orden de campos, márgenes, copias, media carta: ampliar `invoiceJson` + `saleComprobantePdf.ts` por fases. |
| **Opciones de comportamiento** (`generalJson`) | **No** / auditar | Flags tipo `warnOutOfStock`, `barcodeAddsLineDirectly`, `showStockWhileSelling`, `roundTotals`, `retainInventoryOnSaleEdit`: **inventariar** manual vs `NewSalePage`/`TouchSalePage`/API e implementar los acordados. |
| Impresora física por tipo | **Fuera web** pura | `window.print` + doc; app híbrida si se exige ESC/POS nativo. |

---

## R. FAQ e importación Excel (manual ~pp. 130–142)

| Tema | Estado | Qué falta |
|------|--------|-----------|
| Red local/remota, migrar PC | **Fuera web** | Sustituir por guía de despliegue en `HelpPage` / `docs/ARCHITECTURE.md`. |
| Import Excel | **Cubierto** | — |
| Impresoras, etiquetas, lector, gaveta | **Parcial** | Ampliar **HelpPage** con secciones espejo del FAQ (expectativas navegador vs Windows). |
| Recuperar contraseña | **Parcial** | Mismo bloque SMTP. |

---

## Orden de implementación recomendado (valor / riesgo)

1. **`salesWorkflow` (Modo PreVenta / POS / Mixto)** — alto impacto operativo, bajo riesgo si solo es nav + ayuda.  
2. **Reporte impreso/PDF de cierre de caja** — cierra expectativa del ítem “Cierre”.  
3. **Onboarding: crear org + usuario inicial** (o documentación + script) — desbloquea entornos nuevos.  
4. **Recuperación de contraseña** (si hay SMTP disponible).  
5. **Upload de logo** + export.  
6. **`generalJson` comportamiento en POS** — según prioridad del negocio.  
7. **Restore backup controlado** (`REPLACE_FULL` o por dominios de datos).  
8. **Traslado: impresión/PDF**.  
9. **Lotes/vencimiento** (si el rubro lo exige).  
10. **Transferir diarios / reclasificación** — tras congelar reglas con el usuario.

---

## Criterios de aceptación globales

- Cada ítem **Parcial** o **No** de esta tabla tiene un **issue** o subtarea con: referencia a **página del PDF**, pasos del manual, ruta web o endpoint, y prueba manual.  
- Nada se marca **Cubierto** sin checklist reproducible.  
- Lo **Fuera web** aparece explícito en ayuda al operador para no esperar paridad con Windows.

---

*Última actualización: alineado al índice del extracto en `docs/manual-smart-texto-extraido.txt` y al estado del monorepo `apps/web` + `apps/api`.*
