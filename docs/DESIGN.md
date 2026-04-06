# Guía visual corta

## Marca de producto

Nombre en UI: **Punto Flow** como marca base. La interfaz debe poder rebrandearse por negocio sin tocar cada pantalla.

## Fuente de verdad

- El sistema visual vive en `apps/web/src/index.css`.
- Los presets de tema viven en `apps/web/src/theme/pfTheme.ts`.
- Los componentes base reutilizables viven en `apps/web/src/components/ui.tsx`.
- La regla principal es: usar tokens `--pf-*` y utilidades `pf-*`; evitar `stone/slate/gray` hardcoded en componentes y layouts.

## Presets de tema

Actualmente hay tres presets base:

- `default`: cálido/comercial
- `slate`: sobrio/neutro
- `ocean`: frío/empresarial

Cada preset se activa con `data-pf-theme` sobre `<html>` y puede persistirse vía `pfTheme.ts`.

## Estructura de tokens

Los tokens están organizados por intención, no por color crudo:

- **Marca**: `--pf-primary`, `--pf-primary-hover`, `--pf-primary-soft`, `--pf-primary-foreground`
- **Superficies**: `--pf-surface`, `--pf-surface-elevated`, `--pf-surface-muted`, `--pf-surface-soft`, `--pf-surface-overlay`
- **Texto**: `--pf-text`, `--pf-text-secondary`, `--pf-text-tertiary`, `--pf-text-soft`, `--pf-text-on-brand`
- **Bordes**: `--pf-border`, `--pf-border-soft`, `--pf-border-strong`
- **Estados**: `--pf-success`, `--pf-warning`, `--pf-danger`, `--pf-info` y sus variantes `*-soft`
- **Controles**: `--pf-control-bg`, `--pf-control-border`, `--pf-control-placeholder`, `--pf-focus-ring`
- **Navegación / ribbon**: `--pf-tab-*`, `--pf-ribbon-*`, `--pf-nav-*`, `--pf-sale-tab-*`
- **Tablas**: `--pf-table-head-*`, `--pf-table-border`, `--pf-table-body`, `--pf-row-hover-from`, `--pf-row-selected-*`
- **Sombras**: `--pf-shadow-*`

## Tipografía

- **Familia base**: `Plus Jakarta Sans`, `ui-sans-serif`, `system-ui`, `sans-serif`
- **Títulos**: peso alto, tracking ligeramente cerrado
- **Cuerpo**: legible y compacto, orientado a ERP/POS

## Componentes base

Todos los componentes reutilizables deben depender de tokens:

- `Card` usa `pf-card-surface`
- `Button` usa variantes semánticas: `primary`, `secondary`, `ghost`, `danger`
- `Input`, `Textarea`, `Select` usan `pf-control-surface`
- `Modal` usa superficies overlay tokenizadas

## Patrones visuales normalizados

- **Chrome global**: `AppShell` usa tokens para header, tabs, ribbon, drawer móvil y documento de venta
- **Hero de página**: `PageHero`
- **Tablas**: `pf-table-shell`, `pf-table-thead`, `pf-table-body`, `pf-table-row`, `pf-table-row-hoverable`
- **Navegación secundaria**: `pf-hub-nav-*`
- **Documento de venta**: reutiliza el lenguaje de ribbon del shell

## Cómo agregar un nuevo tema

1. Agregue un preset nuevo en `apps/web/src/theme/pfTheme.ts`.
2. Cree un bloque `[data-pf-theme="nuevo-id"]` en `apps/web/src/index.css`.
3. Sobrescriba tokens semánticos, no clases o componentes individuales.
4. Verifique al menos:
   - navegación principal
   - ribbon
   - formularios
   - modales
   - tablas
   - documentos de venta

## Reglas de mantenimiento

- No introducir `stone-*`, `slate-*`, `gray-*`, hex o gradientes ad hoc para definir el estilo principal de nuevas vistas.
- Si hace falta un color o estado nuevo, agregar token primero.
- Si un patrón se repite en varias pantallas, crear utilidad `pf-*` antes de copiar clases.
