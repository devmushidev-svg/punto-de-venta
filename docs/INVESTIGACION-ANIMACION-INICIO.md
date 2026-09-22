# Investigación — formas animadas en Inicio

## Decisión recomendada

Para el dashboard de Punto Flow conviene una capa **puramente decorativa de CSS**: dos o tres formas grandes, semitransparentes y desenfocadas, absolutas, detrás del contenido y sin interacción. Para el efecto pedido no hace falta una librería de animación ni estado React: la animación es continua, no responde a datos ni a gestos y CSS permite declararla sin trabajo de JavaScript.

Las animaciones CSS sencillas no requieren JavaScript y dejan que el navegador reduzca trabajo en pestañas no visibles; MDN las señala como una opción que puede rendir mejor que técnicas dirigidas por script bajo carga moderada. [MDN: Using CSS animations](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Animations/Using)

## Cómo debería comportarse

- Una capa `aria-hidden="true"`, `pointer-events: none`, con `overflow: hidden` dentro del hero o dashboard, nunca sobre controles ni datos.
- Formas estáticas en color y desenfoque; animar solo `transform` y, como mucho, una variación sutil de `opacity`.
- Movimiento amplio y lento: ciclos de 18–30 segundos, `ease-in-out`, `alternate`, y desplazamientos pequeños. No usar rebotes, zooms rápidos ni rotaciones perceptibles.
- Mantener contraste y legibilidad: la capa debe quedar por debajo de las tarjetas/contenido (`z-index`) y no debe convertirse en un indicador de estado.

`transform` permite trasladar, escalar o rotar sin cambiar la geometría de layout; las propiedades individuales `translate`, `rotate` y `scale` están ampliamente disponibles. [MDN: transform](https://developer.mozilla.org/en-US/docs/Web/CSS/transform) Google recomienda mover con `transform` y mostrar/ocultar con `opacity`, evitando animar propiedades que provocan layout o pintura. [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide)

## Accesibilidad obligatoria

Debe existir una anulación explícita:

```css
@media (prefers-reduced-motion: reduce) {
  .pf-dashboard-orb {
    animation: none;
  }
}
```

`prefers-reduced-motion` comunica que la persona solicitó reducir el movimiento no esencial; los paneos y escalados grandes pueden generar malestar vestibular. [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

## Rendimiento y límites

El desenfoque es el detalle visual más costoso: `filter: blur()` mezcla píxeles vecinos y el coste sube con el radio. Por eso debe permanecer **fijo**; no animar `filter`, `backdrop-filter`, sombras, tamaño, posición `top/left`, márgenes ni gradientes. [web.dev: Understanding CSS filter effects](https://web.dev/articles/understanding-css) [MDN: filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/filter)

Propuesta de límites iniciales:

- Máximo tres formas, sin imágenes ni canvas.
- Una forma de 20–32rem como máximo en escritorio; reducirlas u ocultar una en móvil.
- Un único `filter: blur()` fijo por forma, con radio moderado; medir en un equipo de tienda antes de subirlo.
- Animar exclusivamente `transform` y `opacity`; inspeccionar la fluidez con el panel Performance/Paint Flashing si se observan saltos.

No añadir `will-change` por defecto. Es una pista que puede ayudar a evitar saltos, pero aplicada a una zona grande o demasiados elementos puede empeorar el rendimiento; solo se justifica después de medir, y únicamente en cada forma aislada. [MDN: will-change](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change) [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide)

## Boceto técnico (no implementado)

```css
.pf-dashboard-ambient {
  pointer-events: none;
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.pf-dashboard-orb {
  position: absolute;
  border-radius: 9999px;
  filter: blur(44px); /* fijo */
  opacity: 0.22;
  animation: pf-dashboard-drift 24s ease-in-out infinite alternate;
}

@keyframes pf-dashboard-drift {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(2.5rem, -1.5rem, 0) scale(1.04); }
}
```

Al implementarlo se deben usar tokens `--pf-*` existentes —no colores nuevos— y verificar Inicio con movimiento normal y reducido, en móvil y en un equipo modesto. Una librería (por ejemplo, para gestos, secuencias ligadas a datos o transiciones entre rutas) solo tendría sentido si aparece una interacción que CSS no pueda expresar de forma declarativa.
