# Manual para rediseñar una app que se ve "vibecodeada"

Esto es lo que funcionó para rediseñar MultiPOS. Está escrito para pegarlo en un chat
nuevo, en otro repositorio, y que el agente sepa qué hacer sin haber visto nada de esto.

**Lo primero, y lo que más cuesta aceptar:** una app se ve fea casi nunca por falta de
efectos, y casi siempre por falta de decisiones. Colores escritos a mano en cada archivo,
ocho radios distintos para la misma idea, tarjetas que muestran números porque quedaba un
hueco. Agregar sombras y degradados encima de eso la hace más fea, no menos. El trabajo es
al revés: decidir pocas cosas y aplicarlas en todos lados.

---

## 1. Cómo usar este manual

Abrí un chat nuevo en el repositorio de la otra app y pegá esto:

> Vas a rediseñar la interfaz de esta aplicación siguiendo el manual que te paso abajo.
> Empezá por la Fase 0 (auditoría) y **no modifiques código todavía**: quiero leer el
> diagnóstico antes de que toques nada. Cuando termines la auditoría, pará y mostrámela.
>
> [pegar de la sección 3 en adelante]

El "no modifiques código todavía" no es formalidad. Si el agente empieza a editar en el
primer mensaje, va a maquillar síntomas durante horas sin saber qué está roto de fondo.

---

## 2. Antes de empezar: dos cosas que evitan el desastre

**Confirmá en qué carpeta estás trabajando.** A mí me pasó: edité durante un buen rato una
copia del repositorio que estaba tres commits atrás, mientras el servidor de desarrollo
corría desde otra carpeta. Todo "funcionaba" y nada se veía.

```bash
git rev-parse --show-toplevel && git log --oneline -1 && git status --short
```

**Revisá que no haya trabajo sin guardar antes de sobrescribir archivos.** También me pasó:
sobrescribí dos archivos con cambios sin commitear y destruí 535 líneas de trabajo ajeno.
`git status` primero, siempre. Si hay algo sin guardar, `git stash` o commit antes de tocar.

---

## 3. El método, en orden

El orden importa. Cada fase depende de que la anterior esté cerrada.

### Fase 0 — Auditoría, sin tocar código

Pedile al agente un diagnóstico escrito antes de cualquier cambio:

- **Inventario de colores fijos.** Cuántos valores hexadecimales hay escritos directamente
  en componentes en vez de venir de una variable. En MultiPOS eran 184. Ese número solo ya
  explica por qué nada se veía consistente.
- **Inventario de radios de borde.** Cuántos valores distintos y para qué. En MultiPOS iban
  de 7px a 24px **para el mismo concepto** (una tarjeta). Eso es lo que el ojo lee como
  "hecho a las apuradas", aunque nadie sepa nombrarlo.
- **Contraste de todo el texto**, medido en el navegador (ver sección 7).
- **Qué pantalla muestra información que nadie usa.** Tarjetas de métricas puestas para
  llenar espacio.
- **Cuántos sistemas de diseño conviven.** Hojas de estilo que se pisan entre sí.

Una advertencia de mi propia experiencia: **medí antes de afirmar.** Yo dije tres veces que
la app tenía "dos sistemas de diseño en conflicto". Cuando por fin lo medí, las dos hojas
que acusaba tenían **cero** colores fijos y **cero** colisiones de nombres. El problema real
eran los radios, y el archivo peor era el mío. Una auditoría que confirma prejuicios no
sirve.

### Fase 1 — Elegir una dirección y escribirla

Una dirección es un párrafo corto que se pueda contradecir. "Moderno y limpio" no sirve
porque nadie puede estar en desacuerdo. La de MultiPOS fue:

> **Mostrador cálido.** Fondo marfil, superficies de trabajo blancas, texto carbón, un solo
> acento terracota. Tipografía Plus Jakarta Sans. Bordes cálidos y discretos, radios
> moderados. **Sin degradados decorativos.** Las sombras solo separan capas, nunca adornan.

Fijate que la mitad son prohibiciones. Eso es lo que la hace útil.

Para una app de taller la dirección cambia, pero el formato es el mismo: un fondo, una
superficie, una tinta, **un** acento, una tipografía, y dos o tres prohibiciones explícitas.

### Fase 2 — Tokens primero, pantallas después

Todos los colores, radios y sombras pasan a variables CSS con un prefijo propio
(`--pf-*`, `--tl-*`, lo que sea). **Ninguna pantalla vuelve a escribir un color.** Esta fase
es aburrida y es la que hace que todo lo demás funcione.

### Fase 3 — Pantalla por pantalla, con un criterio explícito

El criterio que más cambió el resultado, dicho por el usuario:

> «asegurate que sea bien entendibles y no solo muestren información por mostrar información»

En la práctica, para cada pantalla:

1. ¿Qué pregunta viene a responder quien la abre?
2. ¿Cuál es el único dato que contesta esa pregunta? Ese va grande.
3. Todo lo demás es contexto o sobra. **Si sobra, se borra.**

Un ejemplo real del panel de inicio: decía "Ventas de hoy: L 13,307.50". Un número grande y
solo. No contesta la pregunta de verdad, que es *¿hoy va bien o mal?*. Le agregué una curva
de 14 días y la comparación contra el promedio. El número pasó a significar algo.

(De paso descubrí que los L 13,307.50 estaban **mal**: la pantalla pedía el resumen sin
rango de fechas y el servidor devolvía el acumulado histórico. El día real eran L 10.05.
Los errores de datos salen solos cuando ponés dos vistas del mismo número en la misma
pantalla.)

### Fase 4 — Verificar en el navegador, no en el código

Ver sección 7. Es la fase que más errores míos atrapó.

---

## 4. Las reglas concretas

Estas se pueden revisar una por una. Ninguna es cuestión de gusto.

### Color

- **Un solo acento.** Todo lo demás es fondo, superficie, texto y estados.
- **Verde, ámbar y rojo se reservan a estados** (bien, atención, error). Si usás verde de
  adorno, perdés el verde para decir "pagado".
- **Cero colores escritos a mano** fuera del archivo de tokens.
- **Sin degradados decorativos.** Un degradado en un botón o en un título es la marca más
  reconocible de app generada a las apuradas.

### Contraste — esto no es opinión

- Texto normal: **mínimo 4.5:1**. Bordes e íconos: **3:1**.
- **Cuidado con el color de marca.** La terracota del brief (`#c35d3b`) da 4.27:1 sobre
  blanco: **no cumple**. La solución no fue abandonarla, fue partirla en dos:
  - `--pf-primary: #b4502f` (5.08:1) para rellenos y texto,
  - `--pf-primary-mid: #c35d3b` para bordes, rieles e íconos, donde 3:1 alcanza.
  
  La identidad se conserva y el texto se lee. Vale la pena hacer esto en vez de aguar el
  color hasta que quede genérico.

### Radios

Un valor base y a lo sumo dos derivados. En MultiPOS: `--radius-pf: 0.625rem`. Lo que sea,
pero **el mismo concepto siempre con el mismo radio**.

### Sombras

Solo para separar capas: `0 1px 2px`. Si una sombra existe para que algo "resalte", sobra.

Y un detalle que descubrí por accidente: **verificá que los tokens de sombra existan.** Dos
hojas usaban `--pf-shadow-sm` y `--pf-shadow-lg`, que nunca habían sido definidos. El
navegador no avisa: simplemente no pinta nada. Buscá cada `var(--x)` y confirmá que `--x`
está declarado.

### Tipografía

Una familia. Tres o cuatro tamaños. Los números de dinero siempre con
`font-variant-numeric: tabular-nums` para que las columnas queden alineadas.

### Densidad

Objetivos táctiles de 44px mínimo. En una app de taller que se usa con las manos sucias o
con guantes, esto importa más que cualquier color.

### Estados vacíos

Cada lista necesita tres estados: cargando, vacía de verdad, y "el filtro no encontró nada".
Son mensajes distintos. "No hay clientes" cuando en realidad el buscador no encontró nada es
un bug de comunicación.

---

## 5. Tokens de arranque

Esto es una **plantilla**, no un dogma. Los valores neutros (superficies, texto, bordes)
sirven casi para cualquier app y ya están verificados en contraste. El acento se cambia.

```css
:root {
  --xx-font-sans: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;

  /* Acento — cambiar estos tres por el color de la otra app */
  --xx-primary: #b4502f;        /* rellenos y texto: necesita >= 4.5:1 sobre blanco */
  --xx-primary-hover: #993f24;  /* el mismo, mas oscuro */
  --xx-primary-mid: #c35d3b;    /* identidad: bordes, iconos, rieles. >= 3:1 alcanza */
  --xx-primary-soft: #f6e7e0;   /* fondos suaves, fila seleccionada */
  --xx-primary-foreground: #ffffff;

  /* Superficies */
  --xx-surface: #f7f4ef;          /* fondo de la pagina */
  --xx-surface-elevated: #ffffff; /* superficie de trabajo */
  --xx-surface-muted: #ede8e0;
  --xx-border: #e0d9cf;
  --xx-border-strong: #c9bfb1;

  /* Texto — todos verificados >= 4.5:1 sobre el fondo */
  --xx-text: #1f2421;           /* 14.4:1 */
  --xx-text-secondary: #2e3531;
  --xx-text-tertiary: #55605a;  /* 5.98:1 */
  --xx-muted: #726b62;          /* 4.79:1 */

  /* Estados — reservados, no decorativos */
  --xx-success: #2f6f4e;
  --xx-warning: #9a6516;
  --xx-danger: #b3261e;
  --xx-info: #2b5f7e;

  /* Radios y sombras */
  --xx-radius: 0.625rem;
  --xx-shadow-sm: 0 1px 2px 0 rgb(31 36 33 / 0.05);
  --xx-shadow-lg: 0 8px 24px -8px rgb(31 36 33 / 0.12);
}
```

**Para cambiar de color:** elegí el tono, buscá la variante que dé ≥ 4.5:1 sobre blanco para
`--xx-primary`, y usá el tono original (más vivo) en `--xx-primary-mid`. Si la app de taller
va con azul acero o verde industrial, el resto de la paleta sigue funcionando: solo hay que
enfriar levemente el marfil del fondo.

---

## 6. Los errores que cometí

Están acá porque son los que un agente va a repetir.

**Pintar sin diagnosticar.** Ya dicho, pero es el que más tiempo cuesta.

**Afirmar sin medir.** Tres veces dije que había sistemas de diseño en conflicto. Medí: era
falso. El problema estaba en el archivo que yo mismo había escrito.

**Confiar en mi propio script de verificación.** Escribí dos veces un medidor de contraste
que daba falsos positivos: el primero leía solo `backgroundColor` e ignoraba los degradados
de fondo, así que marcaba como ilegibles botones que se leían perfecto. El segundo no sabía
interpretar la notación `color(srgb 1 1 1)` y leía el blanco como casi negro. **Antes de
cambiar algo porque un script lo marcó, mirá una captura de pantalla.**

**Creer que la interfaz está rota porque la automatización no la manejó.** Estuve a punto de
reportar dos fallas falsas: un campo que "no respondía" (los eventos de teclado sintéticos no
llegaban al estado de React, pero el campo andaba bien) y un guardado de permisos que
"no hacía nada" (yo mandaba el formato equivocado). Cuando algo parece roto, probá el camino
de verdad antes de escribirlo como hallazgo.

**Creer que compila = funciona.** Un cambio mío pasó la compilación y las 31 pruebas, y
rompía **todos** los endpoints de la API. Lo detectó una tanda de peticiones reales contra el
servidor. La compilación no prueba comportamiento.

---

## 7. Cómo verificar de verdad

**Medí en el navegador, nunca calculando desde el código.** El color efectivo de un texto
depende de herencia, de la capa de abajo, de transparencias y del tema activo. Leer el
archivo CSS no te dice qué se ve.

Con el navegador abierto en la app, este script recorre todo el texto visible y reporta lo
que no llega a 4.5:1:

```js
function lum(c){const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});
  return 0.2126*r+0.7152*g+0.0722*b}
function rgb(s){const m=s.match(/[\d.]+/g);return m?m.slice(0,3).map(Number):null}
function fondoReal(el){for(let e=el;e;e=e.parentElement){const b=getComputedStyle(e).backgroundColor;
  const v=rgb(b);if(v&&!/,\s*0\)$/.test(b))return v}return [255,255,255]}
const malos=[];
for(const el of document.querySelectorAll('*')){
  if(!el.textContent?.trim()||el.children.length)continue;
  const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
  const s=getComputedStyle(el);if(s.visibility==='hidden'||s.opacity==='0')continue;
  const f=rgb(s.color),b=fondoReal(el);if(!f)continue;
  const L1=lum(f),L2=lum(b),ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
  if(ratio<4.5)malos.push({texto:el.textContent.trim().slice(0,40),ratio:ratio.toFixed(2),color:s.color});
}
console.table(malos.slice(0,40));
```

El script marca también los caracteres decorativos —el `·` que separa dos datos, por
ejemplo—, que llevan `aria-hidden` y no son texto que alguien tenga que leer. Es el falso
positivo esperable: revisá cada hallazgo contra una captura antes de cambiar nada. En la
última pasada sobre MultiPOS revisó 98 elementos y marcó 3, los tres separadores.

Esto encontró en MultiPOS cuando estaba sin rediseñar:
- Tres enlaces "Volver" a **1.1:1** — invisibles.
- La marca "MultiPOS" a **1:1** — texto blanco sobre blanco. Literalmente no estaba.
- El indicador de "sin conexión", invisible.

Ninguno se veía en el código. Los tres eran visibles en pantalla como "algo acá está raro".

**Además:** revisá a 375px de ancho y confirmá que no haya desplazamiento horizontal.

```js
document.documentElement.scrollWidth - document.documentElement.clientWidth  // tiene que dar 0
```

---

## 8. Gráficos, si hacen falta

Regla única: **pocos y buenos**. Cinco tarjetas con curvas saturan y no dicen nada.

- La forma la decide el trabajo del dato: tendencia en el tiempo → línea o área. Un valor
  único con su tendencia → cifra grande con línea chica al lado. Comparar categorías →
  barras. **Nunca dos ejes verticales.**
- Un solo tono, en degradado de opacidad. Nada de arcoíris.
- Líneas de referencia horizontales y discretas. **Sin líneas verticales** en un eje de tiempo.
- Barras de 24px máximo.
- El texto usa los tokens de texto, **nunca el color de la serie**.
- Los topes del eje tienen que ser números redondos. Si el eje dice `0 / 550 / 1k / 2k`,
  está mal: calculá un techo divisible en tres pasos para que diga `0 / 600 / 1.2k / 1.8k`.

**Truco útil si usás Recharts:** no le pases los colores por props leyendo tokens desde
JavaScript. Recharts dibuja SVG real, así que se le puede dar estilo por CSS:

```css
.mi-grafico .recharts-area-curve { stroke: var(--xx-primary-mid); }
.mi-grafico text.recharts-cartesian-axis-tick-value { fill: var(--xx-muted); }
.mi-grafico .recharts-cartesian-grid line { stroke: var(--xx-border); }
```

Así el gráfico sigue al tema claro/oscuro solo, sin una línea de JavaScript.

---

## 9. Habilidades y herramientas que usé

Instaladas como skills de Claude Code:

| Habilidad | Para qué |
|---|---|
| `/impeccable audit` | Auditoría de diseño de una pantalla |
| `/impeccable critique` | Jerarquía y claridad, no estética |
| `/impeccable polish` | Repaso final antes de dar por terminado |
| `/impeccable distill` | Quitar complejidad visual |
| `/impeccable layout` | Tipografía, espaciado, jerarquía |
| `/dataviz` | **Cargar antes** de hacer cualquier gráfico |
| `/ponytail` | Criterio de no sobre-construir |
| `/run` | Levantar la app y verificar en el navegador |

MCP de [21st.dev](https://21st.dev) para buscar componentes de React ya hechos. Útil para no
reinventar un selector de fechas; **inútil si todavía no decidiste la dirección**, porque vas
a pegar componentes de cinco estéticas distintas.

Instalación del MCP (`.mcp.json` en la raíz del repositorio):

```json
{
  "mcpServers": {
    "21st": {
      "type": "http",
      "url": "https://21st.dev/api/mcp",
      "headers": { "x-api-key": "${API_KEY_21ST}" }
    }
  }
}
```

La clave va en una variable de entorno, no escrita en el archivo. Ese archivo se commitea.

Sobre [shadcn/ui](https://ui.shadcn.com): lo que vale la pena copiar **no son los
componentes**, es el criterio. Superficies planas, bordes sutiles, radios consistentes,
ningún degradado, sombras casi inexistentes. Se puede aplicar sin instalar nada.

---

## 10. Lista de verificación final

Antes de dar una pantalla por terminada:

- [ ] Cero colores escritos a mano fuera del archivo de tokens
- [ ] Todo `var(--algo)` que se usa está declarado
- [ ] Un solo radio por concepto
- [ ] Todo el texto ≥ 4.5:1, **medido en el navegador**
- [ ] Bordes e íconos ≥ 3:1
- [ ] Ningún degradado decorativo
- [ ] Objetivos táctiles ≥ 44px
- [ ] Anillo de foco visible al navegar con el teclado
- [ ] Sin desplazamiento horizontal a 375px
- [ ] Cada lista tiene sus tres estados: cargando / vacía / sin resultados
- [ ] Ninguna tarjeta muestra un número que nadie va a usar
- [ ] Alguien que abre la pantalla por primera vez sabe qué está mirando

Y el último, que es el que de verdad importa: **abrí la pantalla y preguntate qué viene a
resolver quien la abre.** Si no lo podés contestar en una frase, ningún color lo va a
arreglar.
