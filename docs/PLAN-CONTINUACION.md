# Plan de continuación — Punto Flow (siguiente bloque de trabajo)

Documento **complementario** a [`PLAN-NUEVO-SIGUIENTE.md`](PLAN-NUEVO-SIGUIENTE.md) (sigue siendo la hoja de ruta maestra). Este archivo concentra **qué hacer a continuación**, en orden, alineado al manual Smart v1.9.x y al estado real del código.

**Texto buscable del manual:** [`manual-smart-texto-extraido.txt`](manual-smart-texto-extraido.txt) (`npm run manual:extract`).

---

## 1. Dónde vamos respecto al PDF (índice aproximado)

No hace falta recordar un número de página exacto: el **orden del índice** del manual (págs. 1–127 del contenido útil) es la brújula.

| Bloque del manual (índice PDF) | Estado en Punto Flow |
|--------------------------------|----------------------|
| Login, empresa, pantalla principal (~4–8) | Cubierto (web propia). |
| Productos, granel, precios (~10–14) | Cubierto (tipos, KIT, tramos, UI P2). |
| Lista de ventas, venta táctil/estándar, registrar venta (~15–24) | Funcional; filtros en lista (Q2) listos en código; QA layout §Q2.3. |
| PreVentas (~25–28) | Cubierto + **edición** (`PATCH` cotización, rutas editar). |
| **Diario digital / caja** (~29–36) | Cubierto (Q3): diario por sesión, métricas, enlace gastos/CxC/CxP. |
| Abonos CxC/CxP (~33–34, 73–81) | Cubierto en módulos dedicados; enlazar desde caja si aplica. |
| Reportes (~37–39) | Cubierto v1; revisar exportes y copy «Qué es» si falta. |
| Clientes, compras, proveedores (~40–51) | Cubierto. |
| Cotizaciones, traslados, pedidos (~52–71) | Cubierto (traslados vía ubicaciones, no red Smart). |
| CxC/CxP, auditoría, historial (~73–88) | Cubierto. |
| RH gastos/planillas (~90–103) | v1 hecho; refinamientos §3.4. |
| Usuarios, permisos (~104–106) | v1 + matriz; opcional más claves §3.5. |
| Respaldo, config, diseñador ticket (~112–127) | Parcial; PDF servidor / plantillas §3.3. |

**Conclusión:** priorizar **Q1** (checklist §10b manual) y pulido **Q5**; **Q4.3** PDF servidor listo en código (comprobante). Revisar exportes/reportes si hace falta.

---

## 2. Prioridad recomendada (órdenes de trabajo)

### Fase Q1 — Cierre de calidad (P1)

| ID | Tarea | Notas |
|----|--------|--------|
| Q1.1 | Ejecutar checklist **§10b** de `PLAN-NUEVO-SIGUIENTE.md` en navegador (admin + cajero). | Incluir: crédito **con** cliente, PreVenta editar → convertir, cotización idem. |
| Q1.2 | Marcar ítems del checklist en el doc al validar. | Tras `npm run verify`. |

**Listo:** §10b con casillas marcadas y sin regresiones obvias.

---

### Fase Q2 — Lista de ventas vs manual (~pág. 15) — Fase B.1 del plan detallado

| ID | Tarea | Notas |
|----|--------|--------|
| Q2.1 | `GET /sales`: `from`/`to`, `q`, `customerId`, `terms`, `termsGroup=credit` (**crédito = no contado/tarjeta/efectivo**, incluye `90 DIAS` etc.) y `termsGroup=cash` (contado/tarjeta/efectivo). | [`apps/api/src/index.ts`](../apps/api/src/index.ts) — actualizado mar 2026. |
| Q2.2 | UI [`SalesPage`](../apps/web/src/pages/SalesPage.tsx): «Qué es», filtros, **Contado/tarjeta/efectivo** vs **Todos los créditos**, limpiar filtros, tabla con scroll + `thead` sticky. | Actualizado mar 2026. |
| Q2.3 | Probar en **1366×768** que filtros + tabla no rompen layout. | Manual QA. |

**Listo (código):** localizar documentos por fecha, cliente, condición y búsqueda; validar en navegador (Q2.3).

---

### Fase Q3 — Diario digital / caja (~pág. 29–36) — Fase C del plan detallado

| ID | Tarea | Notas |
|----|--------|--------|
| Q3.1 | API `GET .../diary` (actual + por id): totales con **`isImmediateSaleTerm` / `isCreditSaleTerm`** (ya no solo `CONTADO`); **`tarjetaTotal`**, **`efectivoVentasTotal`**, **`gastosSesion`** (Expense mismo usuario en rango), **`efectivoCajaSugerido`** (fondo + efectivo ventas + cobrado en créditos del turno − gastos). | [`index.ts`](../apps/api/src/index.ts) `buildCashDiaryForSession` — mar 2026. |
| Q3.2 | UI [`CashPage`](../apps/web/src/pages/CashPage.tsx): «Qué es», rejilla de métricas, enlace **Gastos** (admin), CxC/CxP; referencia de arqueo en etiqueta **Efectivo esperado**. | mar 2026. |
| Q3.3 | **Hecho (2026-03-31):** abonos en CxC a facturas fuera de la ventana de la sesión no entran al sugerido (API solo ve `Sale` del turno). Límites explicados en copy de [`CashPage`](../apps/web/src/pages/CashPage.tsx) (cabecera + tarjeta «Efectivo en caja»). Ampliar con tabla de pagos fechados: futuro si hace falta. |

**Listo (código v1):** diario alineado a términos reales y referencia de efectivo en cajón; validar con datos reales.

**Fuera de alcance explícito (§11c PLAN-NUEVO):** “cierre general de empresa” único tipo Smart — seguir con caja por usuario + reportes.

---

### Fase Q4 — Refinamientos ya anotados en PLAN-NUEVO

| ID | Tarea | Ref. |
|----|--------|------|
| Q4.1 | **Hecho (2026-03-31):** modelo `PayrollLineDeduction`; `POST/PATCH` líneas con `deductionItems[]`; neto = bruto − Σ si hay conceptos; respaldo incluye ítems; UI planillas + detalle con desglose. | §6 P4 PLAN-NUEVO. |
| Q4.2 | **Hecho (2026-03-31):** `expenses.view` y `payroll.view` (matriz); `GET /expenses`, resumen gastos, `GET /payroll-periods*`, resumen planillas; alta/cierre siguen **solo admin**. | §6 P6 PLAN-NUEVO. |
| Q4.3 | **Hecho (2026-03-31):** `GET /sales/:id/comprobante.pdf` (pdfkit); botón en comprobante carta. **Logo en PDF (2026-03-31):** `Organization.logoUrl` PNG/JPEG por HTTPS o data URL. Plantilla HTML más rica / personalización avanzada: opcional. | §7 P5 PLAN-NUEVO. |
| Q4.4 | **Hecho (2026-03-31):** clave `purchases.view` (solo lista); `GET /purchases` con `record` **o** `view`; `POST /purchases` solo `record`; `/compras` y menú con cualquiera de los dos. | §8 P6 PLAN-NUEVO. |

---

### Fase Q5 — Pulido y manual (opcional continuo)

| ID | Tarea | Notas |
|----|--------|--------|
| Q5.1 | **Hecho (2026-03-31):** aviso “histórico / no checklist único” en cabecera de `PLAN-DETALLADO-SIGUIENTE.md`; enlace a FAQ. Casillas no re-sincronizadas una a una (obsoleto masivo). | Evita confusiones. |
| Q5.2 | **Hecho (2026-03-31):** `PATCH /quotes` normaliza `notes` `null` / `""` → `null` en BD. | Detalle menor. |
| Q5.3 | **Hecho (2026-03-31):** [`docs/FAQ-INTERNO.md`](FAQ-INTERNO.md) (térmica, PDF, backup, permisos, PWA, dev). Fase L en plan detallado referencia el FAQ. | Sin textos legales del PDF Smart. |
| Q5.4 | **Hecho (2026-03-31):** Pantalla **[`/ayuda`](../apps/web/src/pages/HelpPage.tsx)** en la web (contenido alineado al FAQ); **Empresa → Ayuda / FAQ**; enlace en Configuración. | §10 PLAN-NUEVO; ediciones futuras: doc + `HelpPage`. |
| Q5.5 | **Hecho (2026-03-31):** **[`/ayuda-publica`](../apps/web/src/pages/PublicHelpPage.tsx)** — mismo FAQ **sin** iniciar sesión; enlace en login. Reportes: **CSV inventario** (todos los productos activos). | Producción / soporte en mostrador. |

---

## 3. Orden sugerido de ejecución (sprints cortos)

1. **Q1** — QA §10b (bloquea confianza en lo ya hecho).  
2. **Q2** — Filtros lista de ventas (rápido impacto vs manual pág. ~15).  
3. **Q3** — Diario de caja (mayor esfuerzo, mayor paridad con pág. ~29–36).  
4. **Q4** según negocio (RH, PDF, permisos).  
5. **Q5** en paralelo o al final.

Tras cada bloque: `npm run verify` y una línea en §10 de `PLAN-NUEVO-SIGUIENTE.md`.

---

## 4. Referencias cruzadas

| Documento | Rol |
|-----------|-----|
| [`PLAN-NUEVO-SIGUIENTE.md`](PLAN-NUEVO-SIGUIENTE.md) | P1–P6, equivalencias §11b, brechas §11c, permisos §10c. |
| [`FAQ-INTERNO.md`](FAQ-INTERNO.md) | Soporte: térmica, PDF, backup, permisos, PWA; en app **`/ayuda`** y **`/ayuda-publica`**. |
| [`PLAN-DETALLADO-SIGUIENTE.md`](PLAN-DETALLADO-SIGUIENTE.md) | Mapa A–L (histórico; ver aviso en cabecera del archivo). |
| [`manual-smart-texto-extraido.txt`](manual-smart-texto-extraido.txt) | Buscar texto por sección cuando haga falta literal del manual. |

---

*Creado para continuar el desarrollo sin perder el hilo del plan original ni del índice del PDF.*
