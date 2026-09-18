# Entrega de Claude — navegación global e inicio

Alcance cubierto: `apps/web/src/index.css`, `apps/web/src/layouts/AppShell.tsx`,
`apps/web/src/pages/DashboardPage.tsx`. No toqué `NewSalePage.tsx` ni `CustomerModal.tsx`.

## 1. Contrato de integración: intacto

`SaleDocumentToolbarContext.tsx` no cambió. La venta sigue registrando sus acciones con
`useSaleDocumentToolbarSetter` y `AppShell` las pinta en una franja compacta.

Cambió **dónde** se pinta: la franja ahora vive dentro de la cabecera `sticky`, así que se
desplaza junto con ella sin cálculos de desplazamiento, y **se ve también en móvil**
(antes estaba dentro del `<header>` de escritorio con `max-md:hidden`, por lo que en
teléfono las acciones del documento no aparecían nunca).

El contenedor que recibe tus acciones es:

```tsx
<div className="flex min-h-12 flex-row items-center gap-1 px-2 py-1.5 lg:px-4"
     role="toolbar" aria-label="Acciones del documento de venta">
  {saleToolbarSlot}
</div>
```

Envuelto en un contenedor con `overflow-x-auto`, así que una fila larga hace scroll horizontal.

## 2. Lo que necesito de vos

**La franja mide hoy 225px de alto** (medido en `/venta` a 1440px; la barra interna 214px).
Tus fichas envuelven en dos filas dentro de cada grupo. El contenedor pide `min-h-12` (48px).
Al compactar a una sola fila la cabecera total baja de 274px a ~97px, que es el objetivo de
dejarle el alto a los productos.

**No dupliques "Nueva venta".** El acceso global vive en la barra lateral. Dentro de una venta
activa ese botón se pinta en estado activo (fondo `--pf-primary-soft` + borde `--pf-primary-mid`),
no como acción repetida. Tampoco hace falta que el shell muestre cobrar ni guardar: eso es tuyo.

## 3. Tokens — fundamento visual compartido

Conservé todos los nombres `--pf-*` y su significado. Cambiaron los valores.

### Marca (terracota)

| Token | Valor | Uso |
|---|---|---|
| `--pf-primary` | `#b4502f` | Rellenos sólidos con texto blanco. **5.08:1, cumple AA a cualquier tamaño** |
| `--pf-primary-hover` | `#993f24` | Hover de esos rellenos |
| `--pf-primary-mid` | `#c35d3b` | Terracota de identidad: bordes, rieles activos, iconos |
| `--pf-primary-soft` | `#f6e7e0` | Fondos suaves, fila seleccionada, estado activo |

**Cuidado con `--pf-primary-mid`:** la terracota `#c35d3b` del brief da **4.27:1** sobre blanco,
así que no cumple AA para texto normal. La dejé como color de identidad en bordes, rieles e
iconos, y para texto/rellenos usá `--pf-primary` (`#b4502f`). Es el único punto donde me aparté
del valor literal del brief, y fue por el pedido de validar contraste.

### Superficies y tinta

| Token | Valor |
|---|---|
| `--pf-surface` | `#f7f4ef` (marfil, fondo) |
| `--pf-surface-elevated` | `#ffffff` (superficie de trabajo) |
| `--pf-surface-muted` | `#ede8e0` |
| `--pf-border` | `#e0d9cf` |
| `--pf-text` | `#1f2421` (carbón, 14.4:1 sobre marfil) |
| `--pf-text-tertiary` | `#55605a` (5.98:1) |
| `--pf-muted` | `#726b62` (4.79:1) |

Todo el texto verificado ≥ 4.5:1. Verde `--pf-success: #2f6f4e` reservado a lo positivo.

### Otros cambios que te afectan

- **`--radius-pf` pasó de `1rem` a `0.625rem`** (radios moderados).
- **Sombras muy reducidas.** `--pf-shadow-card` y similares ahora son `0 1px 2px`, solo para
  separar capas. No las uses como decoración.
- **La malla del fondo quedó neutralizada**: `--pf-mesh-*` en `transparent` y `--pf-mesh-base-*`
  en marfil, así que el `body` es plano. La maquinaria sigue ahí para los temas `slate` y `ocean`.
- **`--pf-control-shadow` ahora es `none`** y los bordes de control son cálidos (`#d9d1c6`).

### Gradientes de texto eliminados

Estas utilidades eran texto con degradado y ahora son color plano:

`pf-hero-title` · `pf-drawer-title` · `pf-app-title-xl` · `pf-page-eyebrow` · `pf-doc-section-title`

**`pf-doc-section-title` la usa `NewSalePage.tsx`.** Sigue funcionando, ahora rinde carbón sólido.

### Utilidades nuevas

`pf-sidebar-shell` · `pf-sidebar-item-idle` · `pf-sidebar-item-active` · `pf-sidebar-section-label`
· `pf-menu-panel` · `pf-menu-item`

También `.tabular-nums` global y el atributo `[data-pf-money]`, ambos aplican
`font-variant-numeric: tabular-nums` para alinear cifras en columna.

`pf-ribbon-shell` ahora es blanco y plano, sin degradado ni sombra.

Quité las anulaciones `.pf-app-shell-header .text-pf-*` que forzaban texto claro: la cabecera
ya no es oscura, así que esos `!important` rompían el contraste.

## 4. Decisión de criterio que conviene que sepas

**Eliminé la cinta de fichas grandes en los módulos normales.** Con una barra lateral que ya
contiene todos los destinos, la cinta solo repetía navegación y se comía ~76px de alto en cada
pantalla. La franja contextual quedó reservada exclusivamente a tu barra de venta.

Ningún destino se perdió: los 23 que había en la cinta están en la barra lateral, con los mismos
permisos. También respeté `general.salesWorkflow`: con `preorder_focus` las cotizaciones suben
al inicio de Facturación, con `pos_focus` bajan al final.

Los chips de documento abierto (venta en curso, lista de ventas) siguen existiendo, ahora
compactos en la cabecera en vez de ocupar una fila de pestañas.
