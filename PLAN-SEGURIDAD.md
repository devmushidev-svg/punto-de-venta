# Plan de seguridad — MultiPOS

Estado al escribir esto: se probaron ~90 peticiones sobre autorización (3 actores ×
14 lecturas × 15 escrituras + bootstrap + firma JWT). **La autorización se sostuvo en
todo lo probado.** Lo que sigue son las superficies que *no* se probaron, ordenadas por
lo que se pierde si fallan.

Regla que gobierna todo el plan: **una revisión se prueba con una petición, no leyendo
el código.** Leer el middleware demuestra que el control existe; solo una petición
demuestra que se dispara. Ningún ítem se da por cerrado con "lo leí y está bien".

Segunda regla: **la autorización se demuestra con la negación, no con el permiso.** Una
prueba que pasa como el dueño legítimo demuestra que la función sirve; no dice nada
sobre el control de acceso.

---

## Reparto

| Ámbito | Dueño | Motivo |
|---|---|---|
| `apps/api/src/**` — autorización, aislamiento, validación de entrada | **Claude** | Ya tiene armado el banco de réplicas y la matriz de actores |
| `apps/web/src/lib/offlineSales.ts`, sincronización, almacenamiento del token | **Codex** | Construyó las ventas offline (PR #3); conoce el invariante |
| `apps/web/src/pages/NewSalePage.tsx`, `CustomerModal.tsx` | **Codex** | Su lane de siempre |
| Pruebas negativas en CI | **Claude** arma el molde, **Codex** agrega las suyas | El molde debe existir una sola vez |

Nadie edita los archivos del otro. Si un hallazgo cruza la frontera, se anota y se pasa.

---

## Fase 0 — Prerrequisitos (bloquean la Fase 1)

**0.1 Segunda organización — Claude — HECHO**
Hoy la base demo tiene una sola empresa, así que el actor más importante —*un usuario
válido de otra empresa*— no se puede probar. Sin esto, la Fase 1.1 no existe.
Vía: habilitar `BOOTSTRAP_SECRET` en `apps/api/.env` y usar `POST /admin/bootstrap-org`,
que ya funciona y falla cerrado.
**Hecho cuando:** existen dos empresas con datos propios y un usuario en cada una.

**0.2 Limpiar datos de prueba — Claude — BLOQUEADO**
Quedaron 3 ventas (A-000002, A-000003, 000019) y la cotización SEED-Q-03 convertida.
No se pueden borrar: **`DELETE /api/sales/:id` no existe en la API** (la única ruta
delete es `/products/:id`), pero `SalesPage.tsx:193` la llama. Ver hallazgo F-1.
No se borran por fuera de la API: que un sistema fiscal no permita borrar facturas es
probablemente correcto.

---

## Fase 1 — Crítico

**1.1 Aislamiento entre empresas — Claude — HECHO, sin hallazgos**
*Pregunta falsable:* ¿un usuario de la empresa B puede leer o modificar un objeto de la
empresa A conociendo su id?
Método: capturar cada petición como dueño legítimo en A, repetirla con **solo** la
credencial cambiada a un usuario de B. Todo lo demás idéntico byte a byte — si se cambia
el id *y* el token, el resultado no dice cuál causó la negación.
Objetivos: `/sales/:id`, `/customers/:id`, `/products/:id`, `/quotes/:id`,
`/stock-transfers/:id`, `/payroll-periods/:id`, `/cash-sessions/:id/diary`,
`/sales/:saleId/comprobante.pdf`, `/products/:id/movements`.
**Un 200 no es un hallazgo todavía:** hay que confirmar que el cuerpo trae datos de la
otra empresa, no una lista vacía ni los propios.
**Hecho cuando:** cada objetivo tiene un 404/403 registrado, o un hallazgo con el diff
de la petición.

> **Resultado (probado con dos empresas reales):** lecturas de objeto por id →
> 404 al ajeno contra 200 al dueño, en venta, cliente, producto, cotización y
> movimientos. Listados → la empresa B ve 0 mientras A ve 13/84/6/12. Escritura
> con cuerpo válido sobre venta ajena → 404 "Venta no encontrada", objeto intacto.
> El filtro vive en la consulta (`findFirst({ where: { id, organizationId } })`),
> que es el mejor lugar. **No se encontraron hallazgos.**

**1.2 Frontera de confianza del cliente en ventas offline — Codex**
*Pregunta falsable:* ¿puede un cliente manipulado empujar por `/sync/push` una venta con
precio, total, descuento o fecha que el servidor acepte sin recalcular?
El navegador es hardware que el usuario controla: cualquier decisión tomada ahí es una
sugerencia. La cola offline guarda líneas de venta en el dispositivo y las envía después.
Método: tomar una venta encolada, alterar `unitPrice`, `discountPercent` y `total` en el
almacenamiento local, empujarla y ver qué persiste el servidor.
**Hecho cuando:** está escrito cuáles de esos campos el servidor recalcula y cuáles
acepta tal cual. Si acepta el precio, es escalamiento económico.

**1.3 Principal obsoleto — Claude — HECHO, sin hallazgos**
*Pregunta falsable:* si a un usuario se le quitan permisos o se lo desactiva, ¿su token
ya emitido sigue funcionando?
El JWT trae `permRev`, lo que sugiere que hay revisión de permisos. Hay que probar que
dispara: emitir token, cambiar permisos del usuario, reintentar con el token viejo.
**Hecho cuando:** está medido cuánto sobrevive una autoridad ya emitida.

---

## Fase 2 — Superficies de inyección

**2.1 XSS en los HTML generados — Claude — HECHO, HALLAZGO CORREGIDO**
*Pregunta falsable:* ¿un valor que escribe un usuario termina sin escapar dentro del HTML
generado?
`apps/api/src/index.ts` interpola `${p.sku}`, `${quote.quoteNumber}` y
`${localContext.device.invoiceSeries}` en plantillas para
`/stock-transfers/:id/print.html` y `/cash-diary/close-report.html`. El SKU lo escribe un
administrador desde el catálogo.
Método: crear un producto con SKU `<img src=x onerror=...>`, meterlo en un traslado,
abrir el HTML.
**Hecho cuando:** o se demuestra el escape, o se corrige con escapado en la plantilla —
no con una lista negra de entrada.

**2.2 Importadores — Codex**
*Pregunta falsable:* ¿qué pasa con un archivo hostil?
`POST /import/excel`, `POST /backup/import`, `POST /stock-transfers/import-file`. Son las
tres entradas que aceptan un archivo completo de fuera. `backup/import` es la más grave:
restaurar un respaldo es reemplazar la base.
Revisar: límite de tamaño, tipo declarado vs real, profundidad del JSON, y si el import
respeta la empresa del llamante o confía en el id que viene dentro del archivo.
**Hecho cuando:** cada importador valida en el borde y está probado con un archivo
malformado y uno de otra empresa.

**2.3 Travesía de rutas en logos — Claude — HECHO, sin hallazgos**
`GET /uploads/logos/:file` valida con `^[a-zA-Z0-9._-]+$`, que bloquea `/` y `\`. Parece
correcto, pero `..` pasa el patrón. Hay que probarlo con `..`, `%2e%2e%2f`, nombres
largos y dobles extensiones, no deducirlo.
**Hecho cuando:** hay una tabla de intentos con su código de respuesta.

---

## Fase 3 — Secretos y sesión

**3.1 Inventario de secretos — Claude**
Dónde vive cada uno, quién lo puede leer, qué pasa si se filtra, cómo se rota:
`JWT_SECRET`, `BOOTSTRAP_SECRET`, `DATABASE_URL`, la API key de 21st, credenciales de
Supabase si siguen.
Verificar que `.env` no esté versionado y que ningún secreto llegue al bundle del
navegador (`import.meta.env.VITE_*` es público por definición).

**3.2 Almacenamiento del token — Codex**
El token vive en `localStorage` bajo `pf_token`, legible por cualquier script de la
página. Evaluar el riesgo real en este contexto y documentar la decisión; si se queda en
`localStorage`, que sea una decisión escrita, no un accidente.

---

## Fase 4 — Que no se vuelva a abrir

**4.1 Pruebas negativas generadas desde la matriz — Claude arma, Codex extiende**
Una prueba parametrizada sobre (actor, recurso, acción) cuya afirmación es **denegado**,
que falle ruidosamente cuando se agregue un endpoint sin su fila. Es la corrección que
sobrevive a las próximas veinte funciones; sin esto, el próximo endpoint reabre el hueco.

**4.2 Cerrar por defecto en el enrutado — Claude**
Hoy cada handler comprueba lo suyo, que es donde aparecerá el próximo olvido. Evaluar
mover la decisión: una capa de datos con alcance por empresa que *no pueda* expresar una
lectura sin filtrar > un middleware que niega por defecto y obliga a cada ruta a declarar
su regla > el chequeo dentro de cada handler.
Esto es una propuesta a discutir, no un cambio a hacer sin acuerdo: toca toda la API.

**4.3 Filtrado por campo en `/settings` — Claude**
Hoy devuelve el blob completo a cualquier autenticado. No es explotable: solo contiene
los favoritos de venta táctil, que el cajero necesita. Pero no filtra por campo, así que
lo que se agregue mañana queda expuesto a todos los roles.

---

## Lo que ya se verificó (no repetir)

- 13 de 14 endpoints de lectura → 403 al cajero, 401 sin credencial.
- 15 de 15 endpoints de escritura → 403 al cajero, incluidos `POST /users`,
  `POST /backup/import`, `DELETE /products/:id`, `PATCH /organizations/current`.
- `POST /admin/bootstrap-org` → 503 sin cabecera, con secreto falso y con cabecera vacía.
  Falla cerrado: comprueba `if (!secret)` antes de comparar.
- JWT con rol falsificado a `admin` → 401 en los cuatro endpoints probados.
- `/settings` a 200 para cajero: **no es hallazgo**, el cuerpo solo trae favoritos.

---

## Hallazgos abiertos

**F-1 — El botón "Eliminar venta" llama a un endpoint que no existe.**
`SalesPage.tsx:193` hace `DELETE /api/sales/:id`; la API solo define
`delete("/products/:id")`. El administrador selecciona una venta, confirma un aviso que
dice "esta acción no se puede deshacer" y recibe "No se pudo eliminar la venta."
No es un fallo de seguridad: es una acción destructiva prometida y no implementada.
Decisión de producto pendiente — lo más probable es que **no** deba existir (una factura
no se borra, se anula), y entonces sobra el botón. Dueño: Claude (`SalesPage.tsx`).

**F-2 — `/settings` sin filtrado por campo.** Ver 4.3.

**F-3 — `DELETE /products/<id-inexistente>` responde 200 en vez de 404.** Cosmético.

---

## Estado del entorno de pruebas

- Existe una segunda empresa, `pruebab` / **Empresa Prueba B**, con usuario `ADMINB`.
  Se creó para 1.1 y sirve para volver a probar aislamiento sin rearmar nada.
- `BOOTSTRAP_SECRET` se quitó de `.env` tras usarlo: el bootstrap vuelve a fallar cerrado.
  Para crear otra empresa hay que volver a definirlo y reiniciar el API.

---

## Resultados de la segunda tanda

**2.1 — XSS almacenado. HALLAZGO, ya corregido (commit `d904e538`).**
`GET /products/labels/preview` interpolaba `p.sku` y `p.barcode` sin escapar mientras
escapaba `p.name` en la misma línea. Se sirve como `text/html`. Probado creando un
producto con SKU `ZZ<script>…</script>` y barcode `<img src=x onerror=…>`: salían
literales. Tras el arreglo salen como entidades.
El vector realista no es un administrador malicioso sino `POST /import/excel`, que crea
productos desde un archivo que redactó otro — por eso 2.2 (Codex) sube de prioridad.
Las otras dos plantillas (`print.html` de traslados, reporte de cierre) ya escapaban con
su helper `esc()`; solo faltaba el símbolo de moneda, también corregido.

**2.3 — Travesía de rutas. Sin hallazgos.**
La protección dispara en dos capas: el enrutador no hace coincidir rutas multi-segmento
(404) y el patrón `^[a-zA-Z0-9._-]+$` rechaza las formas codificadas (400 en `$`,
espacio, `%3C%3E`, `%2e%2e%2f`, `%5C`, byte nulo).
*Observación aparte:* `GET /uploads/logos/:file` responde sin credencial. Probablemente
deliberado (los logos salen en tickets), pero conviene que sea decisión escrita.

**1.3 — Principal obsoleto. Sin hallazgos, comportamiento conservador.**
Al denegar un permiso: el token ya emitido pasa a **401 en todo** (no solo en el permiso
quitado) porque sube `permissionsRev`; un login nuevo devuelve la lista ya recortada y el
endpoint denegado da 403. Revocar invalida todas las sesiones vigentes de ese usuario.
*Nota de método:* la primera pasada dio un resultado raro —el permiso parecía no quitarse—
y resultó ser un payload mal formado de mi parte: el handler espera
`{ allow?: string[], deny?: string[] }`, no `{ "permiso": true }`. Se verificó antes de
reportar nada.

---

## Tercera tanda — estructural

**3.1 Inventario de secretos — HECHO, sin hallazgos.**
`.env` está en `.gitignore` y no versionado; solo `.env.example` con marcadores.
Al navegador llegan `VITE_API_BASE` y `VITE_APP_BUILD`: una URL y una cadena de
compilación, ninguna secreta. Sin secretos escritos a mano en el código.

**4.1 Pruebas negativas en CI — HECHO.**
`apps/api/test/authorizationSurface.test.ts` más `authorizationManifest.json` con las
107 rutas y su guardia (5 públicas, 43 autenticadas, 34 admin, 25 por permiso).
Cinco aserciones, todas de negación: no aparecen rutas sin declarar, el manifiesto no
guarda rutas muertas, ninguna guardia se relaja, nada bajo `/api` queda público, y las
superficies sensibles exigen admin.
**Se comprobó que la prueba puede fallar**: al agregar `api.get("/ruta-colada", (c) => …)`
falla nombrando la ruta; al revertir, pasa. Una prueba que no puede fallar no protege nada.
El extractor acepta cualquier forma de handler a propósito: una ruta que no vea es una
ruta que el manifiesto no protege.

**F-4 — Los favoritos de venta táctil son de toda la empresa y los cambia cualquiera.**
Lo encontró la prueba nueva en su primera corrida. `POST /api/settings/touch-favorites`
solo exige autenticación y escribe en `organizationSettings`, así que un cajero cambia
los favoritos de toda la empresa. La estrella en la UI no tiene guardia.
No se cambió la conducta: es decisión de producto (por usuario, o con permiso). Queda
como excepción explícita en la prueba, con su motivo escrito.
