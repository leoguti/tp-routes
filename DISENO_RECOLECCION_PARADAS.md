# Notas de diseño — Módulo de recolección de PARADAS georreferenciadas

> Documento de **análisis** (no de implementación). Define el modelo de captura
> empresa→corredor→conductor→paradas, las opciones de georreferenciación con
> recomendación, la validación de coordenadas, el MVP y las fases.
> Complementa `DISENO_CAMPO_Y_PARADAS.md` (la pregunta de modelado paradas/tarifas
> sigue ABIERTA allí) y reusa el patrón ya en producción de `/campo/`.
>
> **Restricción de este trabajo:** SOLO análisis. No se modifica código, no se
> corren migraciones, no se toca la BD. Las tablas/columnas que se mencionan son
> *propuestas* para una fase posterior, no DDL a ejecutar ahora.

---

## 0. TL;DR

- Hoy existe un módulo de captura de **tarifas/horarios** (`/campo/` PWA offline,
  login Google/OTP contra `field_users`, bandeja `field_notes`). Funciona en
  producción. Este nuevo módulo es **separado**: otro dato (GPS de paradas), otro
  actor (conductores), otra UX. Pero **reusa** login, roles, cola offline,
  idempotencia y el patrón "captura → bandeja → revisión → tablas oficiales".
- El esquema **ya tiene casi todo**: `operators` (empresas), `routes` (trayectos
  ida/vuelta agrupados por `route_parent_id`), `route_waypoints` (vía), `places`
  (catálogo humano con lat/lon), `stops` (cache OSM), `route_stops` (orden).
  Lo que falta para este módulo es **una bandeja para paradas crudas** y un par
  de campos (tipo de parada, informante=conductor). No requiere rediseño.
- **La parte ya resuelta sin saberlo:** `paradas.html` **ya** tiene un mapa
  Leaflet con "clic en el mapa para fijar la coordenada" + geocoder Photon. El
  patrón de **mapa con pin** ya está construido y probado en este mismo repo.
- **Recomendación sobre Street View (clave):** **NO embeber Street View** en la
  app para el MVP. La fricción/costo no compensan. El camino de **menor fricción
  para un conductor no técnico** es **mapa con pin arrastrable** (Leaflet, lo que
  ya existe), con un **botón "Abrir en Google Maps/Street View"** que lleva al
  conductor a Google (donde sí reconoce la calle), y un **campo para pegar la
  coordenada** que copia de Google. Mapa-con-pin como camino principal; Street
  View externo + pegar-coordenada como atajo opcional para los que lo prefieran.

---

## 1. Modelo de datos: corredor, empresa, parada, conductor

### 1.1 Qué es cada cosa HOY en el esquema

| Concepto | Tabla / columna actual | Definición precisa |
|---|---|---|
| **Empresa** | `operators` | El operador/agencia. `id`, `nombre`, `nombre_corto`, `telefono`. Cada ruta pertenece a una empresa (`routes.operator_id`). |
| **Corredor / trayecto** | `routes` (la fila *ida*, con `route_parent_id IS NULL`) | Una ruta conceptual = empresa + `origen_text` + `destino_text` + vía. Se materializa en **dos filas**: ida (`route_parent_id NULL`) y vuelta (apunta a la ida). Tiene `ref` (código interno), `osm_relation_id`. |
| **Vía (ciudades intermedias)** | `route_waypoints` | Lista ordenada (`orden`) de localidades que define el recorrido. Cada una con `nombre_text` y, si está geolocalizada, `place_id` (FK a `places`). |
| **Parada conceptual (humana)** | `places` | Catálogo editable a mano: una entidad por ciudad/sitio donde paran rutas, con `lat`/`lon`, `municipio`, `notas`. Es lo que la app de paradas ya pinta en el mapa. |
| **Parada OSM (cache)** | `stops` | Importadas de OpenStreetMap (`osm_id`, `lat`, `lon`, `stop_type`). Catálogo automático, paralelo a `places`. |
| **Orden de paradas en el corredor** | `route_stops` | Secuencia física de paradas de una ruta (`route_id`, `stop_id`, `orden`, `es_origen`, `es_destino`). Hoy casi vacía (shapes ~2%). |

### 1.2 Definición operativa de "corredor" para este módulo

> **Un "corredor" = una ruta conceptual de una empresa**, es decir, la fila
> `routes` con `route_parent_id IS NULL` (la *ida*), identificada por
> `operator_id` + `origen_text` + `destino_text` + su vía (`route_waypoints`).
> La *vuelta* es la misma realidad física en sentido inverso.

Esto es importante para la captura: cuando hablamos con **"un conductor de la
empresa X sobre el corredor Y"**, el corredor Y se selecciona escogiendo
primero la **empresa** (`operators`) y luego una de **sus rutas** (`routes`
ida). Las paradas que el conductor describe **cuelgan de ese corredor**.

**Decisión de modelado a no apresurar (heredada de `DISENO_CAMPO_Y_PARADAS.md`
§1):** una misma parada física puede pertenecer a **varios corredores** (p. ej.
un paradero en la salida de Tunja lo usan muchas rutas). Por eso conviene
capturar la parada como **entidad reutilizable** (`places`) y vincularla al
corredor mediante una tabla de orden (`route_stops`/`route_waypoints`), **no**
duplicar la coordenada por corredor. En la **bandeja** (captura cruda) sí se
registra "parada P, dicha por el conductor del corredor Y", y en la **promoción**
se decide si es un `place` nuevo o ya existente (dedupe por cercanía/nombre).

### 1.3 ¿Cómo registrar al conductor (el informante)?

Hay dos opciones; se recomienda la **A** para el MVP.

**Opción A (recomendada) — informante por captura, como ya se hace en `field_notes`.**
El módulo de tarifas ya guarda `informante` (texto libre: quién dio el dato en
ventanilla) además de `user_id` (el funcionario autenticado que captura). Se
replica idéntico:
- `user_id` = el funcionario del Terminal autenticado (Google/OTP, `field_users`)
  que está operando la app y sentado con el conductor.
- `informante_*` = el conductor que aporta el conocimiento. **Sin datos
  personales sensibles**: basta `informante_rol` ('conductor') + un alias o las
  iniciales/placa de la empresa si Paola lo pide para seguimiento. **No** correo
  ni cédula (regla dura del proyecto: nada personal al repo; y a la BD solo lo
  mínimo). Bajo esfuerzo, cero tablas nuevas de personas.

**Opción B (más adelante, si hace falta seguimiento) — tabla `drivers`/`field_informants`.**
Solo si Paola/el Terminal quieren estadística "qué aportó cada conductor" o
volver a contactarlo. Sería una tabla mínima (`id`, `operator_id`, `alias`,
`activo`) referenciada desde la bandeja. **No para el MVP**: añade fricción de
alta de personas y obliga a manejar más datos personales. Mantener en stand-by,
igual que la tabla de contactos de taquillas.

### 1.4 Bandeja propuesta para paradas crudas (NO crear ahora)

Coherente con `field_notes` (aislada, aditiva, idempotente, con bandeja de
revisión). Esquema **propuesto** `field_stops` (solo análisis):

| Columna | Tipo | Para qué |
|---|---|---|
| `id`, `region_id` | — | Igual que `field_notes`. |
| `operator_id`, `operator_text` | INT / TEXT | Empresa elegida. |
| `route_id`, `route_text` | INT / TEXT | Corredor elegido (la ida). |
| `nombre` | TEXT | Nombre del paradero según el conductor. |
| `lat`, `lon` | DOUBLE | Coordenada capturada. |
| `orden` | INT | Posición en el corredor (1,2,3…). |
| `tipo` | VARCHAR | terminal · parada_formal · parada_informal · punto_urbano (ver §1.5). |
| `metodo_geo` | VARCHAR | mapa_pin · pegado_gmaps · gps_celular · streetview (de dónde salió la coord — útil para auditar calidad). |
| `nota_libre` | TEXT | "frente a la iglesia", "donde recoge en Paipa", etc. |
| `user_id` | INT FK `field_users` | Funcionario que captura. |
| `informante_rol`, `informante_alias` | TEXT | Conductor (sin datos sensibles). |
| `client_uuid` UNIQUE | TEXT | **Idempotencia** (reenviar no duplica), igual que `field_notes`. |
| `capturado_en` | TIMESTAMPTZ | Hora real en el celular (puede ser offline). |
| `estado` | VARCHAR | pendiente · aprobado · descartado (bandeja de revisión). |
| `revisado_por`, `revisado_en`, `creada_en` | — | Trazabilidad. |

Promoción (revisión humana + Claude Code, igual que tarifas): de `field_stops`
→ `places` (parada con lat/lon, dedupe por cercanía) y → `route_stops`
(orden dentro del corredor) y/o vincular a `route_waypoints.place_id`.
**La captura nunca escribe directo a `places`/`route_stops`.**

### 1.5 Tipo de parada (categoría)

Reusa la tipología ya planteada en `DISENO_CAMPO_Y_PARADAS.md` §1/§7.3:
`terminal` · `parada_formal` · `parada_informal` · `punto_urbano`. En este
módulo es **solo un selector opcional** en la captura (guardado en
`field_stops.tipo`); la decisión profunda de modelado tarifa↔zona **sigue
ABIERTA y no se resuelve aquí**. Capturar el tipo desde ya no cuesta y alimenta
esa discusión con datos reales.

---

## 2. Flujo de captura propuesto

Reusa el esqueleto de `/campo/` (vistas tipo wizard, una decisión a la vez):

```
[Login]  Google / OTP contra field_users   ── ya existe, se reusa tal cual
   │
   ▼
1. EMPRESA      elegir operador (lista de operators, igual que /campo/)
   │
   ▼
2. CORREDOR     elegir una ruta (routes ida) de esa empresa
   │            mostrada como "origen → destino (vía …)"
   │
   ▼
3. CONDUCTOR    identificar al informante: rol 'conductor' + alias/placa opcional
   │            (sin datos personales sensibles)
   │
   ▼
4. PARADAS      para CADA parada del corredor, capturar:
   │              • nombre (texto)
   │              • coordenada lat/lon  ← aquí entra la georreferenciación (§3)
   │              • orden (autoincrementa: 1, 2, 3…)
   │              • tipo (opcional: terminal/formal/informal/urbano)
   │              • nota libre (referencia visual)
   │            cada parada se ENCOLA (offline-first, client_uuid)
   ▼
[Enviar]  POST → bandeja field_stops (estado 'pendiente')
   │
   ▼
[Revisión] Claude Code + Leonardo → places + route_stops (dedupe, promoción)
   │
   ▼
(futuro) reporte oficial → validación por tercero  ── igual que tarifas (§3.b del otro doc)
```

Propiedades a heredar de `/campo/` (ya implementadas allí, **reusar, no
reinventar**):
- **Offline-first:** la cola vive en `localStorage`; se envía sola con el evento
  `online`. El service worker cachea el app shell.
- **Idempotencia:** `client_uuid = crypto.randomUUID()` por parada; el endpoint
  hace `ON CONFLICT (client_uuid) DO NOTHING`.
- **Degradación con gracia:** si la tabla bandeja no existe aún (migración
  pendiente, igual que pasó con `field_notes`), el endpoint responde
  `{ok:false, reason:'tabla_pendiente'}` con HTTP 200 y el cliente **no borra la
  cola** → no se pierde nada.
- **Login/roles:** mismo `field_users` (terminal/estudiante/trufi). El POST exige
  sesión válida (`leerSesion`), igual que `/api/campo`.
- **Bandeja antes de oficial:** nada toca `places`/`route_stops` directo.

---

## 3. Georreferenciación — opciones, pros/cons, complejidad, costo, UX móvil

El usuario final es **un conductor no técnico** sentado con un funcionario, en el
Terminal, recordando el recorrido **de memoria** (no está físicamente en la
parada). Eso descarta apoyarse en el GPS del celular como vía principal.

### 3.a Street View embebido (Google Maps JavaScript API / Street View Embed API)

**Cómo sería:** cargar el SDK de Google Maps JS y montar un panorama
(`google.maps.StreetViewPanorama`) dentro de la app; el conductor "camina" la
vía y al detenerse se lee `panorama.getPosition()` para obtener lat/lon.

| Aspecto | Valoración |
|---|---|
| Factibilidad | Técnicamente posible. **Pero hoy no hay nada de Google en el repo** (todo es Leaflet + OSM + Photon). Habría que introducir un SDK propietario y una API key. |
| API key + costo | Requiere **proyecto Google Cloud + facturación + clave restringida**. Maps JS / Street View se cobran por carga de mapa (modelo de pago por uso, con un crédito mensual). Para uso bajo (decenas/día) probablemente caería dentro del crédito, **pero introduce gestión de clave, cuotas y riesgo de factura sorpresa**. La Embed API (iframe) es gratuita pero **no devuelve coordenadas** programáticamente → no sirve para capturar la coord. |
| Complejidad | **Alta** para el beneficio: control de pano, mover el punto, leer posición, sincronizar con un pin, manejar la key, CSP. Choca con el stack actual (HTML + vanilla JS, sin build). |
| UX móvil | Street View en pantalla pequeña, arrastrando para mirar alrededor, **mientras** se intenta fijar un punto, es **incómodo** para alguien no técnico. Consume datos. |
| Veredicto | **No vale la pena para el MVP.** Mucho costo de integración y operación para un visor que el conductor ya tiene mejor en la app nativa de Google Maps. |

### 3.b Salir a Google Maps/Street View y **pegar la coordenada** (lo que sugirió el muchacho)

**Cómo se obtiene EXACTAMENTE una coordenada en Google Maps:**

- **En Google Maps web (PC):** **clic derecho** sobre el punto del mapa → el menú
  muestra las coordenadas arriba (`5.535300, -73.367800`); **clic sobre ese
  número las copia** al portapapeles. También aparecen en la **URL**: el patrón
  `.../@5.535300,-73.367800,17z` (el par después de `@` es el centro del mapa) y,
  cuando se hace clic en un punto exacto, en el segmento `!3dLAT!4dLON` de la URL.
- **En la app móvil de Google Maps:** **mantener pulsado** (long-press) sobre el
  punto suelta un "pin rojo" (dropped pin); en la ficha inferior aparecen las
  coordenadas; **tocarlas las copia**. Se pueden compartir y pegar.
- **En Street View:** mientras se navega, la **URL** contiene la posición del
  panorama; o se sale a vista mapa, se hace clic derecho / long-press en la calle
  y se copia la coordenada como arriba. (El conductor reconoce la calle en Street
  View, ubica el punto, vuelve al mapa y copia la coord de ahí.)

**Cómo la pegaría en nuestra app:** un único campo de texto **"Pegar coordenada
de Google"** que acepte formatos comunes (`5.5353, -73.3678`, con o sin espacios,
o una URL de Google Maps de la que extraemos el par `@lat,lon` o `!3d!4d`). Al
pegar, la app **parsea, valida el rango (§4) y rellena `lat`/`lon`** + cae un pin
en el mapa para confirmación visual.

| Aspecto | Valoración |
|---|---|
| Factibilidad | **Alta y barata.** Cero SDK, cero key, cero costo. Solo un parser de texto/URL + validación. |
| Complejidad | **Baja.** Un input + regex + validación + pintar el pin. |
| UX móvil | El conductor usa **la app de Google que ya conoce** (mejor Street View que cualquier embed). Fricción: **alternar entre dos apps** y copiar/pegar — manejable, pero más pasos que un pin directo. |
| Riesgos | Pegues mal formateados, **lat/lon invertidos**, copiar la coord del *centro del mapa* en vez del punto. Se mitigan con validación (§4) y mostrando el pin para que el conductor confirme "sí, ahí es". |
| Veredicto | **Buen atajo secundario.** Útil para quien prefiera Street View y para precisar puntos difíciles. No como único camino (obliga a salir de la app y volver). |

### 3.c Mapa con pin arrastrable (Leaflet) — **ya existe en el repo**

**Cómo sería:** un mapa Leaflet centrado en el corredor; el conductor toca/arrastra
un pin sobre la parada y la app lee `latlng`. **Esto ya está construido y probado
en `paradas.html`:** `map.on('click', e => fillCoords(e.latlng.lat, e.latlng.lng))`,
icono de marcador, geocoder Photon para buscar por nombre, bounds de Boyacá en
`js/regions.js`. Reusar ese mismo código en el módulo de captura es trivial.

| Aspecto | Valoración |
|---|---|
| Factibilidad | **Máxima: ya hecho aquí.** Leaflet + tiles OSM, sin key ni costo. |
| Complejidad | **Mínima** (reuso directo de `paradas.html`). |
| UX móvil | **La más simple en un solo flujo:** todo dentro de la app, un toque pone el pin, arrastrar lo ajusta. No hay que salir ni copiar/pegar. |
| Contra | El mapa base OSM **no tiene Street View** → para alguien que solo reconoce la calle "viéndola", el mapa plano puede costar más que Street View. Se mitiga con: buscador por nombre (Photon, ya existe), centrar el mapa en el corredor, y el **botón "ver en Google/Street View"** (§3.b) como ayuda. |
| Veredicto | **Camino principal recomendado.** Menor fricción, cero costo, ya implementado. |

### 3.d GPS del propio celular (geolocalización del navegador)

`navigator.geolocation.getCurrentPosition()` da la coord donde **está el celular**.

| Aspecto | Valoración |
|---|---|
| Útil cuando | El funcionario está **físicamente en la parada**. |
| Aquí | **No aplica como vía principal:** la captura es en el Terminal, con el conductor de memoria. La coord del celular sería siempre la del Terminal. |
| Veredicto | Dejar un botón **"usar mi ubicación"** disponible (gratis, una línea) para el caso de salir a campo más adelante (sección 1.b del otro doc: "el pasante marca el punto en campo con GPS"), pero **no es el flujo de este escenario**. |

### 3.e Recomendación de menor fricción

> **Camino principal: mapa con pin arrastrable (Leaflet, reuso de `paradas.html`).**
> **Atajos secundarios en la misma pantalla:**
> 1. **Buscar por nombre** (geocoder Photon, ya existe) para centrar el mapa.
> 2. **Botón "Abrir en Google Maps / Street View"** que abre Google centrado en el
>    corredor (deep link `https://www.google.com/maps/@LAT,LON,17z` o búsqueda),
>    el conductor reconoce la calle, **copia la coordenada y la pega** en el campo
>    "Pegar coordenada" (§3.b) → la app la valida y pone el pin.
> 3. (Opcional, campo) **"usar mi ubicación"** con GPS del navegador.
>
> Así el conductor que es visual usa Street View en la app que ya domina y solo
> nos pega el resultado; y el que se maneja con el mapa lo hace todo dentro de la
> app, sin costo ni claves de Google. **Street View embebido queda descartado**
> por costo/complejidad frente al beneficio.

---

## 4. Validación de coordenadas

Aplicar en cliente (al pegar/fijar) y repetir en el servidor (defensa en
profundidad). Reusar los bounds que **ya** están en `js/regions.js`.

- **Rango Boyacá (de `js/regions.js`):** `lat ∈ [4.4, 7.2]`, `lon ∈ [-74.8, -72.0]`.
  Una coord fuera de ese rectángulo se marca como **sospechosa** (advertir, no
  necesariamente bloquear: algún corredor puede salir un poco; pero un punto en
  otro país o con signo cambiado se rechaza).
- **Rango Colombia (cota dura):** `lat ∈ [-4.3, 13.5]`, `lon ∈ [-79.1, -66.8]`.
  Fuera de esto = error seguro → **rechazar**.
- **lat/lon invertidos:** error clásico al pegar. En Boyacá, `lat` es positiva
  (~5) y `lon` negativa (~-73). Si llegan invertidos (lat ≈ -73, lon ≈ 5),
  detectarlo y **ofrecer "¿quisiste decir … ?"** con el orden corregido.
- **Formato mal pegado:** aceptar `lat, lon` con coma o espacio; aceptar coma
  decimal (`5,5353` → `5.5353`) con cuidado de no confundir el separador;
  extraer de URLs de Google (`@lat,lon` o `!3dLAT!4dLON`). Si no se puede
  parsear a dos números → mensaje claro, no guardar basura.
- **Coord = (0,0) o nula:** rechazar (Null Island).
- **Precisión:** mostrar siempre **6 decimales** (como `paradas.html`,
  `toFixed(6)`); recortar exceso de decimales del pegado.
- **Confirmación visual obligatoria:** tras fijar/pegar, **siempre cae un pin en
  el mapa** y el conductor confirma "sí, ahí es". Es la mejor defensa contra
  "copié el centro del mapa" o "pegué el punto equivocado".
- **Duplicados/cercanía:** en revisión (no en captura), si una parada nueva cae
  a < ~30–50 m de un `place` existente, proponer **fusionar** en vez de crear
  (dedupe en la promoción, no molestar al conductor en campo).

---

## 5. MVP recomendado y plan de fases

### 5.1 MVP (lo más simple que funcione, máximo reuso)

**Objetivo:** capturar paradas georreferenciadas de un corredor, con un conductor,
a una bandeja, sin tocar nada oficial. Reusando login, cola offline y el mapa que
ya existen.

1. **Nueva sección/PWA hermana de `/campo/`** (p. ej. `/paradas-campo/`), misma
   base: login Google/OTP (`field_users`), service worker, cola offline,
   idempotencia por `client_uuid`. **No** rehacer auth ni el patrón de cola.
2. **Wizard de 4 pasos** (§2): empresa → corredor → conductor → paradas.
   Empresas y corredores salen de `/api/operators` y `/api/routes` (ya existen,
   solo lectura).
3. **Georreferenciación = mapa con pin** reusando el código de `paradas.html`
   (Leaflet, clic/arrastre, geocoder Photon), **+** campo "Pegar coordenada de
   Google" (parser + validación §4), **+** botón "Abrir en Google Maps/Street
   View". **Sin Street View embebido, sin API key de Google.**
4. **Validación de coords §4** en cliente, con pin de confirmación.
5. **POST a una bandeja `field_stops`** (propuesta §1.4), con degradación con
   gracia si la tabla aún no existe (igual que `field_notes`). **La creación de
   la tabla la autoriza/corre Leonardo**, no la IA (bloqueador conocido del
   proyecto). Mientras tanto la app no pierde datos.
6. **Promoción manual** (Claude Code + Leonardo): `field_stops` → `places` +
   `route_stops`, con dedupe por cercanía/nombre. Mismo ritual diario que tarifas.

Lo que el MVP **NO** hace (a propósito): no embebe Street View, no crea tabla de
conductores, no resuelve la tipología tarifa↔zona, no genera el reporte oficial,
no autopromueve a tablas oficiales.

### 5.2 Fases

- **Fase 1 — MVP** (lo de §5.1): mapa-pin + pegar-coord + bandeja `field_stops`.
- **Fase 2 — Calidad de captura:** geocoder centrado en el corredor, "siguiente
  parada" encadenada con `orden` automático, foto opcional de la parada
  (reusando el patrón R2 previsto para fotos de horarios en `/campo/` v2).
- **Fase 3 — Promoción asistida:** UI/tooling de revisión con dedupe por
  cercanía y vinculación a `route_stops`/`route_waypoints.place_id`; conexión con
  la generación de **shapes** (Valhalla, ya hay `route_shapes`/`route-shapes.js`)
  ahora que habría paradas reales.
- **Fase 4 (condicionada a decisión de modelado):** tipología de parada formal
  y modelo tarifa por **etapas/zonas** (la pregunta ABIERTA de
  `DISENO_CAMPO_Y_PARADAS.md` §1/§7.3). El campo `tipo` capturado desde la Fase 1
  alimenta esta discusión con datos reales **sin** comprometer la decisión.
- **Stand-by:** tabla dedicada de conductores (`drivers`), solo si el Terminal
  pide seguimiento por persona; reporte oficial → validación por tercero.

### 5.3 Relación con lo ya hecho y con la pregunta pendiente

- **Con tarifas/horarios (`/campo/`):** este módulo es el **gemelo geográfico**.
  Comparte login, roles, cola offline, idempotencia, bandeja→revisión→oficial.
  Lo nuevo es el dato (lat/lon), el actor (conductor) y la UX (mapa). Conviene
  ofrecerlos como **dos secciones de la misma app** (mismo login), no dos apps
  inconexas.
- **Con la pregunta de modelado (paradas/tarifas, §1/§7.3 del otro doc):** este
  módulo **no la resuelve ni la fuerza**. Aporta lo que falta para abordarla bien:
  **paradas reales geolocalizadas y tipificadas**. Hoy esa discusión está
  bloqueada en parte por **no tener paradas trazadas** (shapes ~2%, geo ~59%);
  recolectarlas con los conductores es justo el insumo que destraba decidir
  tarifa por etapas/zonas y la categorización formal/informal/terminal/urbano.
  Igual que con tarifas: **capturar a bandeja ya; decidir el modelo definitivo
  con calma, después.**

---

*Documento de análisis. No ejecuta cambios. Para implementar, abrir tarea aparte
con autorización explícita de Leonardo para cualquier migración o escritura a BD.*
