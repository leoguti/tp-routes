# Diseño UX — Listado y captura de paradas en móvil (`/campo-paradas/`)

> Documento de **análisis y diseño**. NO toca código ni BD. Mobile-first, para
> usuarios **no técnicos** (conductores y funcionarios del Terminal). Responde
> punto por punto a las 5 peticiones del coordinador.
>
> **Insumos leídos:** `campo-paradas/index.html` + `campo-paradas/app.js`
> (estados ✅/⚪/🟡, `renderParadasOficiales`, captura, edición), `rutas.html`
> (diagrama tipo metro `.rd-*` y su CSS), `paradas.html` (patrón
> "Pendientes primero" + contadores), `DISENO_RECOLECCION_PARADAS.md`,
> `DISENO_VALIDACION_RUTA_CONDUCTORES.md` y la nota de memoria
> *UI para usuarios no técnicos* (etiquetas explícitas, colores por nivel,
> diagrama de metro, validar por Street View > mapa plano).

---

## 0. TL;DR — qué cambiar primero

El flujo actual **funciona** (login → empresa → corredor → lista de paradas →
captura → bandeja) y **no se debe romper**. El problema es de **legibilidad**:
la lista es una pila de botones grises con emoji donde "qué falta" no salta a la
vista y "lo hecho" se cambia por accidente. Recomendación priorizada:

| # | Cambio | Esfuerzo | Impacto | Petición que resuelve |
|---|---|---|---|---|
| **1** | **Encabezado de progreso** ("Faltan 2 de 5 paradas") + **sección PENDIENTES arriba**, resaltada | Bajo | Alto | #2 resaltar grises, #5 claridad |
| **2** | **Tres estados con etiqueta de texto + forma**, no solo color/emoji; verdes "tranquilas" | Bajo | Alto | #1 proteger verdes, #2, #5 |
| **3** | **Edición protegida**: tocar una verde abre **detalle de solo-lectura** con Street View; "Editar ubicación" pide confirmación | Bajo | Alto | #1 paso extra |
| **4** | **Diagrama de metro VERTICAL** como vista alterna (toggle Lista/Línea) reusando `.rd-*` de `/rutas` | Medio | Medio | #3 línea de metro |
| **5** | **Reordenar solo paradas nuevas** con "insertar antes/después de…" (no drag) | Medio | Bajo-Medio | #4 reordenar |

> **Empezar por 1, 2 y 3** (todo bajo esfuerzo, máximo impacto en claridad).
> 4 y 5 después: el metro vertical es "nice to have" y el reordenar solo aplica a
> paradas nuevas, que son minoría.

---

## 1. Estado actual (lo que hoy ve el usuario)

En `renderParadasOficiales()` cada parada es un `<button class="corredor">` con
texto `"{emoji}  {nombre}"`:

- `p.geo` → **✅** verde = ya geolocalizada (oficial, tiene coordenada).
- `capturadaLocal(nombre)` → **🟡** = capturada en esta sesión (en la cola/bandeja, sin promover aún).
- resto → **⚪** gris = falta ubicar.

Todos los botones se ven **iguales** (mismo fondo blanco, mismo tamaño); el único
diferenciador es el emoji al inicio. Las paradas vienen **ordenadas**
origen→intermedias→destino. Tocar cualquiera —incluida una verde— abre la captura
y, si es verde, **precarga la coordenada** lista para sobrescribir (riesgo de
cambio accidental que señala el coordinador). El "➕ esta parada no está en la
lista" agrega paradas nuevas que se encolan con `orden` autoincremental.

**Diagnóstico:** el emoji es un detalle pequeño en pantalla chica; el color solo
no es accesible (daltonismo, sol directo en el celular del conductor); no hay
jerarquía (lo urgente y lo terminado pesan igual); no hay progreso global; y la
verde no está protegida.

---

## 2. Jerarquía visual del estado (Petición #1 y #2)

### 2.1 Definición de los tres estados (texto + color + forma, no solo emoji)

Principio (memoria + accesibilidad): **nunca depender solo de color o emoji.**
Cada estado lleva **etiqueta de texto**, **forma de viñeta distinta** y color.

| Estado | Etiqueta | Viñeta (forma) | Color | Peso visual | Acción al tocar |
|---|---|---|---|---|---|
| **Falta** (gris) | `FALTA` | ◯ círculo **hueco grueso** | naranja fuerte `#e67e22` borde + fondo `#fff7ef` | **Máximo** (resaltada, arriba) | Abre captura directa |
| **Por revisar** (🟡) | `POR REVISAR` | ◐ medio lleno | ámbar `#b8860b` | Medio | Abre captura (reabrir la propia) |
| **Hecha** (✅ verde) | `UBICADA` | ● círculo **lleno** | verde `#196f3d`, fondo blanco **atenuado** | **Mínimo** (tranquila) | Abre **detalle de solo-lectura** (§4) |

- **Faltan = naranja, no gris.** El gris "desaparece"; el problema del coordinador
  es justo que lo que falta no se ve. Naranja fuerte + borde + chip `FALTA` lo hace
  saltar. (El gris se reserva para texto secundario, no para el estado urgente.)
- **Hechas = verde discreto.** Texto verde sobre fondo blanco, sin borde grueso, con
  un candado pequeño 🔒 que insinúa "protegida". Se ven "calmadas".
- **Etiqueta de texto** (`FALTA` / `POR REVISAR` / `UBICADA`) para que funcione sin
  color y se entienda de un vistazo.

### 2.2 Encabezado de progreso del corredor

Reusar el contador de `/rutas` (`geoCount/n geolocalizadas`) y el de `paradas.html`
("Pendientes" como número grande). Encima de la lista, una barra simple:

```
┌────────────────────────────────────────┐
│  Bogotá → Sogamoso (vía Tunja)          │
│  Faltan 2 de 5 paradas                  │
│  ███████████░░░░░░  3 ubicadas          │
└────────────────────────────────────────┘
```

Microcopy claro orientado a la tarea: **"Faltan 2 de 5"** (no "60% completado").
Cuando llega a 0 faltantes: **"✓ Todas ubicadas. Revisa y envía."**

### 2.3 Agrupar: PENDIENTES arriba, en su propia sección

La petición #2 (resaltar lo que falta) + #5 (claridad) se resuelven **agrupando**
sin perder el orden de la ruta dentro de cada grupo:

```
┌── PENDIENTES (2) ──────────── lo que falta ──┐
│  ◯  FALTA      Paipa, terminal               │
│  ◯  FALTA      Tibasosa, parque              │
└──────────────────────────────────────────────┘

┌── YA UBICADAS (3) ── toca para ver/proteger ──┐
│  ●  UBICADA 🔒  Bogotá (origen)               │
│  ●  UBICADA 🔒  Tunja                          │
│  ●  UBICADA 🔒  Sogamoso (destino)            │
└──────────────────────────────────────────────┘
```

- Dentro de cada grupo **se respeta el orden de la ruta** (origen→destino), para no
  perder la secuencia que ya traen de `route_waypoints`.
- "POR REVISAR" (🟡) puede ir en su propio bloque corto entre ambos, o quedarse en
  Pendientes con su etiqueta — lo capturado-en-sesión todavía "no está oficial".
- La sección **YA UBICADAS arranca colapsada o atenuada**: el funcionario debe
  enfocarse en lo que falta; lo hecho está "guardado y tranquilo".

### 2.4 Mockup ASCII — lista mejorada (vista por defecto, móvil ~360 px)

```
╔══════════════════════════════════════════╗
║ ← Bogotá → Sogamoso (vía Tunja)          ║
║   Faltan 2 de 5 · ███████░░░ 3 ubicadas  ║
╠══════════════════════════════════════════╣
║  PENDIENTES (2)                           ║
║  ┌──────────────────────────────────────┐║
║  │ ◯  ⬤ FALTA   Paipa, terminal      › │║   ← naranja, grande
║  └──────────────────────────────────────┘║
║  ┌──────────────────────────────────────┐║
║  │ ◯  ⬤ FALTA   Tibasosa, parque     › │║
║  └──────────────────────────────────────┘║
║                                            ║
║  + Esta parada no está en la lista        ║
║                                            ║
║  YA UBICADAS (3)            ▾ ver todas    ║
║  ● UBICADA 🔒 Bogotá (origen)             ║   ← verde tenue
║  ● UBICADA 🔒 Tunja                       ║
║  ● UBICADA 🔒 Sogamoso (destino)          ║
╠══════════════════════════════════════════╣
║  [ Enviar paradas (2) ]   (sticky abajo)  ║
╚══════════════════════════════════════════╝
```

> El `›` a la derecha y el alto de fila ≥ 56 px hacen el toque cómodo con el pulgar.
> El botón "no está en la lista" queda **entre** Pendientes y Ya ubicadas, donde el
> ojo lo busca al terminar lo conocido.

---

## 3. Diagrama tipo "línea de metro" en móvil (Petición #3)

### 3.1 El problema del metro horizontal en pantalla chica

El diagrama de `/rutas` es **horizontal** (`.rd { display:flex }`,
`overflow-x:auto`) con etiquetas `white-space:nowrap`. En desktop funciona; en un
celular de 360 px con 5–8 paradas obliga a **scroll lateral** (anti-patrón móvil:
se pierde el inicio/fin, los pulgares scrollean en el eje "equivocado", las
etiquetas se truncan). **El metro horizontal NO se recomienda tal cual en móvil.**

### 3.2 Recomendación: **metro VERTICAL** (de arriba abajo = origen→destino)

Una línea vertical aprovecha el scroll natural del móvil y mapea bien la metáfora
"el bus avanza hacia abajo por la lista". Reusa el **lenguaje gráfico** de `/rutas`
(círculo lleno = hecho, hueco = falta, unidos por línea) pero rotado 90°.

```
   Bogotá → Sogamoso (vía Tunja)
   Faltan 2 de 5

   ●  Bogotá (origen)        UBICADA 🔒
   │
   ●  Tunja                  UBICADA 🔒
   │
   ◯  Paipa, terminal        FALTA    ›   ← naranja, parpadeo sutil
   ┊
   ◯  Tibasosa, parque       FALTA    ›
   ┊
   ●  Sogamoso (destino)     UBICADA 🔒
```

- **Relleno = hecha; hueco = falta** (idéntico a `.rd-stop.geo` / `.rd-stop.pending`
  de `/rutas`: relleno verde `#27ae60`, hueco borde `#b6bbc8`). Aquí el hueco se
  pinta **naranja** para que "lo que falta" salte (coherente con §2).
- **Línea sólida** entre tramos ya ubicados; **línea punteada** (`┊`) en los tramos
  con un extremo pendiente → señal visual de "este tramo está incompleto".
- **Terminales más grandes** (origen/destino), igual que `.rd-stop.term` en `/rutas`.
- La etiqueta de cada parada va **a la derecha del punto** (horizontal, legible, sin
  truncar) — esto resuelve el `text-overflow:ellipsis` del diseño horizontal.
- Tocar un punto pendiente → captura; tocar uno hecho → detalle protegido (§4).

### 3.3 Pros / Cons: línea de metro vertical vs lista

| | Metro vertical | Lista (§2) |
|---|---|---|
| **Comunica la secuencia** del corredor | ✅ Excelente (se ve el recorrido) | ⚠️ Implícito (orden de filas) |
| **Resalta lo que falta** | ✅ Bueno (hueco naranja en la línea) | ✅✅ Mejor (sección Pendientes separada) |
| **Toque cómodo con pulgar** | ⚠️ Puntos pequeños; fila clicable lo arregla | ✅ Filas grandes |
| **Espacio en pantalla chica** | ⚠️ Más alto (línea + nodos) | ✅ Compacto |
| **Familiar para no técnicos** | ✅ Metáfora de metro reconocible | ✅ Lista de tareas reconocible |
| **Reordenar/insertar nuevas** | ⚠️ Difícil de mostrar el "insertar entre" | ✅ Natural |
| **Esfuerzo de build** | Medio (CSS nuevo vertical) | Bajo (ya hay botones) |

### 3.4 Veredicto sobre la línea de metro

> **Sí funciona en móvil, pero VERTICAL, no horizontal.** Recomendación:
> ofrecer **dos vistas con un toggle** arriba — **"📋 Lista"** (por defecto, mejor
> para *hacer la tarea*) y **"🚇 Línea"** (para *ver el recorrido* y entender dónde
> encaja cada parada). La **lista es el caballo de batalla**; el metro vertical es
> la vista "panorámica" que da contexto y luce el mismo lenguaje de `/rutas`
> (coherencia entre apps que pide la memoria). **No** poner el metro horizontal en
> móvil. Si hay que elegir una sola por simplicidad: **empezar con la lista
> mejorada** y añadir el metro vertical después.

---

## 4. Flujo de edición protegida de una parada verde (Petición #1)

**Problema hoy:** tocar una verde abre la captura con la coordenada precargada y
editable → un toque de más la cambia.

**Diseño propuesto — "ver antes de editar":** tocar una verde **NO** abre el
formulario; abre un **detalle de solo-lectura** que confirma "esto ya está bien" y
exige un paso extra para editar.

```
╔══════════════════════════════════════════╗
║ ← Volver a las paradas                    ║
║                                            ║
║  ●  Tunja                  UBICADA         ║
║  Coordenada: 5.535300, -73.367800         ║
║  Tipo: Terminal · Nota: frente al parque  ║
║                                            ║
║  [ 👁️ Ver en Street View ]                ║   ← validación visual (lo que reconoce)
║  [ 🗺️ Ver en el mapa ]                    ║
║                                            ║
║  ── Esta parada ya está ubicada ──         ║
║  [ ✏️ Editar ubicación ]   (secundario)   ║   ← gris, no primario
╚══════════════════════════════════════════╝
```

- **Botón "Editar ubicación" en estilo secundario** (no el azul primario), abajo,
  tras una separación visual. No es la acción esperada; es la excepción.
- Al tocar "Editar ubicación" → **confirmación corta**:
  *"¿Cambiar la ubicación de Tunja? Ya estaba ubicada."* → [Sí, editar] / [Cancelar].
  Solo entonces se abre el formulario con la coordenada cargada.
- **Sin fricción innecesaria:** un funcionario que solo quiere *confirmar* la parada
  (caso común) la ve en Street View y vuelve, **sin riesgo de tocar nada editable**.
  El que de verdad necesita corregir, da dos toques. Es el "paso adicional" pedido.
- **Apóyate en Street View para validar** (memoria + `DISENO_VALIDACION...` §2):
  el conductor reconoce la calle en la foto mejor que en el mapa plano. El detalle
  abre Street View **en la coordenada exacta** reusando `parAbrirGmaps`
  (`map_action=pano&viewpoint=lat,lon`) — el conductor confirma "sí, es ahí" con un
  vistazo, sin leer un mapa.

> **Resumen del "paso extra":** verde → detalle de solo-lectura → (si hace falta)
> "Editar ubicación" → confirmación → formulario. Las ⚪ y 🟡 siguen abriendo la
> captura directo (un toque), porque ahí **sí** queremos que edite.

---

## 5. Reordenar paradas en móvil (Petición #4)

### 5.1 ¿Hace falta? Qué significa "reordenar" aquí

- Las **paradas oficiales ya vienen ordenadas** (origen→intermedias→destino, de
  `route_waypoints.orden`). **No** hay que dejar reordenarlas en campo: cambiar el
  orden oficial es decisión de revisión, no de captura, y abre la puerta a romper la
  secuencia por accidente.
- El reordenar **solo tiene sentido para paradas NUEVAS** ("no está en la lista"):
  hoy se encolan al final con `orden` autoincremental (`ordenPar++`), aunque
  físicamente vayan **en medio** del recorrido (p. ej. un paradero entre Tunja y
  Paipa). El funcionario necesita decir **dónde encaja** esa parada nueva.

> **Aclaración bandeja vs modelo oficial:** reordenar en la app **solo afecta el
> `orden` que viaja en la captura** (`field_stops`, la bandeja). **No** reescribe
> `route_waypoints` ni el orden oficial. La promoción (Claude Code + Leonardo)
> decide la posición final. Es decir: en campo se sugiere "esta nueva va entre X e
> Y"; oficial se confirma en revisión. Esto mantiene la regla "captura nunca toca lo
> oficial".

### 5.2 Opciones móviles evaluadas

| Opción | Pulgar | No técnico | Veredicto |
|---|---|---|---|
| **Arrastrar (drag & drop)** | ❌ Incómodo: dedo tapa el ítem, scroll vs drag se pelean, fácil soltar mal | ❌ Confunde | **Descartar** en móvil |
| **Flechas ↑/↓ por fila** | ⚠️ OK, pero mover una nueva 4 posiciones = 4 toques | ✅ Entendible | Aceptable como respaldo |
| **"Insertar antes / después de…"** | ✅ Un toque elige el vecino | ✅ Lenguaje natural ("va después de Tunja") | **RECOMENDADA** |

### 5.3 Recomendación: elegir el lugar **al crear la parada nueva**

El mejor momento para ordenar una parada nueva es **cuando se crea**, no después.
En el formulario de "parada nueva", añadir un selector:

```
  Nombre de la parada nueva
  [ Paradero El Cruce            ]

  ¿Dónde va en el recorrido?
  ( ) Al inicio
  (•) Después de:  [ Tunja          ▾ ]   ← lista de paradas ya conocidas
  ( ) Al final
```

- "Después de: Tunja" calcula el `orden` = entre Tunja y la siguiente, sin que el
  usuario maneje números. Lenguaje humano, un toque.
- Si luego quiere mover una nueva ya creada: en su fila de la bandeja, un menú
  "⋯ → Mover" con la **misma** pregunta "¿después de cuál?". (Aquí encaja el "menú
  hamburguesa/⋯" que mencionó el coordinador — mejor un **⋯ por fila** que un
  hamburguesa global, porque la acción es **por parada**.)
- **Drag descartado.** Las flechas ↑/↓ quedan como respaldo opcional, no principal.

> En la **vista de metro vertical**, una parada nueva sin posición se puede mostrar
> "flotando" al final con un aviso *"⚠ falta decir dónde va"* y un toque "ubicar en
> la secuencia" → misma pregunta. Esto hace visible que aún no encaja.

---

## 6. Claridad general para usuarios no técnicos (Petición #5)

Reglas heredadas de la memoria y de `/rutas` (etiquetas explícitas, colores por
nivel, microcopy orientado a la tarea):

### 6.1 Títulos y microcopy

- **Título de la pantalla = la tarea**, no el concepto: arriba siempre el corredor
  elegido en grande ("Bogotá → Sogamoso, vía Tunja") + "Faltan N de M".
- **Reemplazar la leyenda de emojis** actual
  (`⚪ falta ubicar · ✅ ya tiene ubicación · 🟡 capturada`) por **chips con texto**
  ya integrados en cada fila (§2.1). La leyenda suelta se lee una vez y se olvida;
  la etiqueta en la fila se entiende siempre.
- Verbos claros en botones: "Guardar ubicación" (ya está), "Ver en Street View",
  "Editar ubicación" (no "editar" a secas).
- Mensajes de estado en humano: "✓ Guardado en el celular, se envía solo al volver
  la señal" (ya existe ese tono — mantenerlo).

### 6.2 Qué hacer primero (guía implícita)

1. El **encabezado de progreso** dice cuánto falta.
2. La sección **PENDIENTES arriba** dice **qué** falta (y es lo primero que se toca).
3. Lo **hecho** queda abajo/atenuado: "ya está, tranquilo".
4. Al llegar a 0 pendientes: estado de éxito + empujón a **"Enviar paradas (N)"**
   (botón sticky inferior, ya existe).

### 6.3 Validar por imagen, no por mapa (clave para conductores)

- **Street View / foto > mapa plano** para confirmar (memoria +
  `DISENO_VALIDACION_RUTA_CONDUCTORES.md` §2). En captura y en el detalle
  protegido, el botón **"Ver en Street View"** (reuso de `parAbrirGmaps`,
  `map_action=pano&viewpoint=lat,lon`) debe ser **tan visible como el mapa**: el
  conductor ubica/confirma viendo la calle "como cuando maneja".
- El mapa Leaflet con pin sigue como camino principal de *fijar* la coordenada
  (ya existe, sin costo), pero la **confirmación** se ofrece también por foto.
- (Futuro, no MVP) **foto opcional de la parada** desde el celular como evidencia,
  alineado con la Fase 2 de `DISENO_RECOLECCION_PARADAS.md`.

---

## 7. Estados visuales — resumen de referencia (accesible, sin solo-color)

| Token | Falta | Por revisar | Ubicada (protegida) |
|---|---|---|---|
| Viñeta | ◯ hueco grueso | ◐ medio | ● lleno |
| Etiqueta | `FALTA` | `POR REVISAR` | `UBICADA` 🔒 |
| Color borde/fondo | naranja `#e67e22` / `#fff7ef` | ámbar `#b8860b` | verde `#196f3d` / blanco tenue |
| Tamaño/peso | grande, resaltada | medio | discreto, atenuado (`opacity` ~.7) |
| Posición | sección PENDIENTES (arriba) | entre medio | sección YA UBICADAS (abajo) |
| Toque | captura directa | reabrir captura | **detalle solo-lectura → editar protegido** |

> Cada estado se distingue por **forma + texto + color + posición** — funciona para
> daltónicos, con sol en pantalla, y de un vistazo. (Hoy se distingue solo por
> emoji de color, que es lo que "no se entiende".)

---

## 8. Qué NO cambiar (no romper el flujo)

- El flujo **empresa → corredor → paradas** se mantiene igual.
- **Login Google/OTP, cola offline (`localStorage`), idempotencia (`client_uuid`),
  bandeja `field_stops`, envío sticky** — intactos. Esto es solo **capa de
  presentación** del listado y de la edición.
- El **modelo de datos no cambia**: el orden sugerido viaja en `orden` de la
  captura (bandeja), nunca reescribe `route_waypoints` ni lo oficial.
- Las marcas locales (`campo_par_capt` para 🟡) y el parser/validador de
  coordenadas (`parsearCoord`/`validarCoord`) se reusan tal cual.
- **Sin Street View embebido** (regla del proyecto): solo enlaces externos.

---

## 9. Respuestas directas a las 5 peticiones del coordinador

1. **Verdes con paso extra para editar (proteger):** ✅ §4. Tocar verde → detalle de
   solo-lectura → "Editar ubicación" (secundario) → confirmación → recién ahí el
   formulario. Imposible cambiarla por accidente.
2. **Grises (faltan) muy resaltadas:** ✅ §2. Sección **PENDIENTES arriba**, color
   **naranja fuerte** (no gris), chip `FALTA`, viñeta hueca grande, contador
   "Faltan 2 de 5". Saltan a la vista.
3. **Línea de metro en móvil:** ✅ §3. **Sí, pero vertical** (el horizontal de
   `/rutas` no sirve en pantalla chica). Como **vista alterna** (toggle Lista/Línea),
   reusando el lenguaje gráfico de `/rutas`. La lista mejorada queda como vista
   principal.
4. **Reordenar:** ✅ §5. Solo para **paradas nuevas**; **NO** drag. "Insertar
   después de…" al crearla (lenguaje humano), con `⋯ → Mover` por fila como respaldo.
   Solo afecta la bandeja, no lo oficial.
5. **Claridad no técnica:** ✅ §6 y §7. Etiquetas de texto + forma + color (no solo
   emoji), título = tarea, progreso visible, validar por **Street View** (lo que el
   conductor reconoce), microcopy en humano.

---

*Documento de diseño. No ejecuta cambios. Implementación: tarea aparte con
autorización explícita de Leonardo. Mantiene mobile-first, reuso total de
login/cola/bandeja y el lenguaje visual de `/rutas`.*
