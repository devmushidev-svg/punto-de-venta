# FAQ interno — Punto Flow (operación y soporte)

Respuestas cortas para equipo y clientes. **No** sustituye el manual comercial Smart POS ni textos legales de terceros.

**En la aplicación:** misma información en **`/ayuda`** (menú **Empresa → Ayuda / FAQ**) y, **sin sesión**, en **`/ayuda-publica`** (enlace desde el login). Mantener este archivo y las pantallas alineados al cambiar contenido.

---

## Impresión térmica (80 mm)

- Use **`/ventas/:id/ticket`** (desde la lista de ventas o el enlace en el comprobante carta).
- El contenido del ticket sale de **Configuración → Factura / ticket** (`invoice.ticket`: pie, cabecera, desglose ISV, etc.).
- El navegador imprime en la impresora térmica como en cualquier página: **Imprimir** y elija la impresora correcta. No hay driver especial en el servidor; en el puesto debe estar instalada la impresora en el SO.

## Comprobante carta y PDF

- **Vista HTML:** `/ventas/:id/comprobante` — **Imprimir / PDF (navegador)** → “Guardar como PDF”.
- **PDF generado en API:** botón **Descargar PDF (servidor)** en esa misma pantalla; equivale a `GET /api/sales/:id/comprobante.pdf` (misma lógica de título, SKU e ISV que el JSON de factura). Útil cuando se quiere un archivo sin depender del diálogo de impresión.
- **Logo en el PDF servidor:** si en **Empresa** hay **URL del logo** y es una imagen **PNG o JPEG** en `https://` (o **data URL** base64), el servidor intenta incrustarla en el encabezado. Debe ser una URL que **el servidor pueda descargar** (pública o en la misma red); SVG u orígenes inaccesibles se omiten sin error.

## Copia de seguridad (backup)

- Solo **administrador:** **Configuración → Respaldo** descarga un **JSON** con datos de la organización.
- **Restaurar** no está automatizado en la UI: es un proceso manual (importar/ajustar según procedimiento interno). Guarde copias en lugar seguro fuera del PC del mostrador.

## Permisos y sesión (`PERM_STALE`)

- Si el admin cambia **rol** o **matriz de permisos** de un usuario, el token anterior deja de valer: la app puede cerrar sesión con código **PERM_STALE**. El usuario debe **volver a iniciar sesión**.
- Lo que el menú oculta debe dar **403** en API si se llama la ruta directamente; ver `PLAN-NUEVO-SIGUIENTE.md` §10c.

## PWA / “instalar app”

- Si el proyecto está publicado con **HTTPS** y manifest/service worker configurados, el navegador puede ofrecer “Instalar”. En **desarrollo local** suele bastar **marcar favorito** o acceso directo al URL. Comportamiento exacto depende del navegador (Chrome, Edge, etc.).

## Desarrollo y base de datos local

- Esquema: `npm run db:push -w apps/api` (o desde la raíz el script que ejecute push en API).
- Datos demo: `npm run db:seed -w apps/api`.
- Build: `npm run verify` en la raíz del repo.

## Caja y “efectivo sugerido”

- El diario resume **ventas del usuario con fecha dentro de la sesión** y **gastos** del mismo usuario en ese intervalo. La referencia de efectivo suma el **abonado** solo en facturas a crédito **emitidas en ese turno**; un abono en CxC a una factura **antigua** no entra al cálculo (no hay historial de pagos por fecha en el diario). Detalle en pantalla **`/caja`** y `PLAN-CONTINUACION.md` Q3.3.

---

*Mantener este FAQ alineado con `PLAN-NUEVO-SIGUIENTE.md` y `PLAN-CONTINUACION.md`.*
