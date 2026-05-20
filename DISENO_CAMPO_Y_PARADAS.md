# Notas de diseño — Captura de campo + modelo de paradas/tarifas

> Documento vivo para retomar. No es decisión cerrada: recoge estado,
> decisiones tomadas y, sobre todo, **una pregunta de modelado fundamental
> que NO hay que apresurar**. Complementa `ARQUITECTURA.md` y `PROXIMOS_PASOS.md`.

---

## 1. La pregunta fundamental abierta: ¿cómo modelar paradas y su relación con la tarifa?

**Planteamiento de Leonardo (mayo 2026):**

- Hay paraderos que **cambian la tarifa** y otros que **no**.
- Ejemplo: un bus que entra a Bogotá y para en Portal del Norte; **no cobra
  más** por seguir hasta el Terminal del Salitre. Al entrar a áreas urbanas
  o ciertas zonas, no se cobra adicional.
- Existen **paradas informales**, **paradas formales** y **terminales**.
  No es lo mismo una parada en una calle de Tunja que una en el terminal,
  pero **todas hay que mapearlas**.
- Probablemente se necesita una **categorización de paradas**. Es
  fundamental para el proyecto. **Pensarlo con calma, no resolver a la carrera.**

**Marco conceptual para retomar informados (no es la decisión, es el punto de partida):**

Esto es un problema clásico de transporte y se descompone en **dos cosas
ortogonales**:

1. **Tipología de la parada** (qué *es* el punto físico):
   `terminal` · `parada_formal` · `parada_informal` · `punto_urbano`.
   Atributos candidatos: oficial/no, con infraestructura/no, precisión de
   lat/lon. Hoy el esquema tiene `stops` (cache OSM) y `places` (catálogo
   humano) + `route_stops` (orden); faltaría un `tipo`/categoría.

2. **Modelo tarifario por etapas/zonas, no por par de paradas** (qué *cuesta*):
   en sistemas reales la tarifa se define por **etapas tarifarias** o
   **zonas**, no por cada parada. Dentro de una zona (p. ej. el casco urbano
   de Bogotá) el viaje no suma costo una vez pagado el intermunicipal.
   GTFS lo resuelve con `fare_rules`/zonas (o GTFS-Fares v2 con *areas*).
   El `route_fares` actual (par origen-destino + precio) **no** expresa
   "gratis dentro de zona urbana". Probablemente haga falta el concepto de
   **etapa/zona tarifaria** o marcar paradas como "no genera tarifa adicional".

**Conexión con el hallazgo de Cooflotax (sección 4):** los ~40
"veredas/paraderos" de su hoja de tarifas son muy probablemente *puntos
tarifarios de rutas alimentadoras* o *paraderos dentro de una ruta con
precio por tramo*, NO 40 rutas distintas. La duda de modelado de Cooflotax
y esta pregunta de paradas **son el mismo problema de fondo**.

**Estado:** ABIERTO. Decisión de modelado de alto impacto. Retomar con calma
en una sesión dedicada antes de cargar masivamente tarifas/paraderos.

### 1.b Reto relacionado: definir los puntos de parada en un mapa, desde la app

Nota de Leonardo: este tipo de rutas (informales, tipo Cooflotax) es
**justo lo que en Trufi se quiere mapear**. El reto grande es **encontrar y
fijar en el mapa los puntos de parada**. Queda PENDIENTE pensar cómo lograr
que esos puntos se **definan sobre un mapa dentro de la app** (¿el pasante
marca el punto en campo con GPS? ¿se ubican después en revisión sobre un
mapa? ¿se reusa el editor de waypoints/`places` que ya existe?). Es un
desafío de UX + datos, ligado directamente a la sección 1. No resolver ahora.

**Idea de Leonardo (solo anotada, no implementar aún):** los **conductores
del terminal** pueden definir/ubicar los puntos de parada usando **Google
Street View** — recorren virtualmente la vía y determinan ahí los paraderos
y posibles paradas. Esto aprovecha su conocimiento del recorrido real sin
tener que ir físicamente. Pendiente de diseñar cómo se integra (¿un visor
Street View embebido junto al mapa donde fijan el punto?).

**Decisión de Leonardo (hacer luego, hoy solo anotar):** la app tendrá una
**sección SEPARADA** —distinta del módulo de tarifas/horarios— dedicada a la
**recolección de paradas**: capturar la **ubicación GPS** de cada paradero,
hecho **con los conductores**. Es un flujo aparte (otro tipo de dato, otro
actor, otra UX). Conecta con la idea de Street View de arriba. No se
construye ahora.

## 1.c Reunión en el Terminal de Tunja — 2026-05-19

Asistentes: **gerente del terminal** + **equipo de recolección de datos**
(las personas que van a las ventanillas de las empresas).

Lo que se mostró: la PWA `/campo/` funcionando en celular, tal cual está hoy.

Decisiones de la reunión:

1. **El equipo del terminal adopta la app.** Ya no es un experimento de
   clase: se va a usar de verdad para llenar tarifas/horarios faltantes.
2. **Reunión de presentación formal: 2026-05-21.** Hay que tener listo para
   esa fecha lo mínimo viable.
3. **Hay que agregar autenticación por correo** de cada miembro del equipo
   (no solo nombre libre tipo "pasante"): cada captura queda atribuida a un
   correo conocido. **Uno de los correos ya está definido** (pendiente:
   listar el resto y diseñar el flujo de login — magic link, código, etc.).
4. **Captura de paradas vía Google Street View confirmada**: los
   conductores recorren la vía en Street View y la app **genera/registra la
   posición GPS** del paradero marcado. Esto **deja de ser idea anotada
   (sección 1.b) y pasa a algo acordado** con el equipo del terminal.

## 2. Producto de captura de campo — estado

Prototipo para que los **pasantes** (≠ los estudiantes de la clase de
*by coding*) capturen datos en el Terminal de Tunja.

- **`/demo-offline/`** — demo educativa de PWA offline. Temporal en producción.
- **`/campo/`** — prototipo v1 desplegado: PWA offline, 4 pantallas
  (identidad → empresa → qué falta → enviar), "qué falta" derivado en vivo
  de las 252 rutas reales vía `/api/campo`. Clave básica `busboy`. Temporal.
- **`/api/campo`** — endpoint nuevo. GET (empresas + pendientes / qué falta);
  POST (capturas → tabla `field_notes`). Solo lectura sobre tablas oficiales.
- **`field_notes`** (migración v5, `scripts/migrate_v5_field_notes.*`) —
  tabla-bandeja aislada y aditiva. **AÚN NO CREADA**: requiere autorización
  explícita de Leonardo (`!node scripts/migrate_v5_field_notes.js`). La app
  degrada con gracia sin ella y **no pierde datos**.

Ambos despliegues (`/demo-offline/`, `/campo/`) son **temporales** y están
para quitar de producción luego.

---

## 3. Decisiones de arquitectura tomadas

- **Captura nunca va directo a tablas oficiales:** pasa por bandeja
  (`field_notes`) con revisión humana antes de promover.
- **Las fotos SÍ entran** (reversión): no hay tableros limpios, pero sí
  pegatinas coloridas en ventanas con horarios valiosos. Fotografiarlas es
  socialmente neutro (a diferencia de grabar al despachador). Foto = canal
  principal de **horarios**; tarifa mejor confirmada de viva voz.
- **Procesamiento = Claude Code + Leonardo a diario, NO un pipeline
  automático.** Volumen = decenas/día. Flujo:
  `campo (offline) → field_notes / R2 (crudo) → Claude Code estructura +
  Leonardo revisa → tablas limpias con procedencia + evidencia`.
  Esto reemplaza Whisper/OCR/cron/UI de revisión mientras el volumen sea bajo.
- **Esquema:** horarios (`route_trips`) y tarifas (`route_fares`) ya existen
  estructuralmente; horarios quedan por sentido por construcción (cuelgan de
  la fila ida o vuelta). Contactos: caben en `operators.telefono`; tabla
  dedicada `agency_contacts` solo si la idea de WhatsApp sale de stand-by.
- **WhatsApp de agradecimiento + enlace corto post-visita:** en STAND-BY,
  no urgente, anotado para no perderlo.
- **Capturar el informante:** además del pasante (quien captura), se guarda
  **quién brindó la información** (despachador/funcionario en ventanilla).
  Implementado en `/campo/` y en `field_notes.informante`.

### 3.b Flujo de validación oficial (nota, no implementar aún)

Leonardo: el flujo previsto es **encuestas (captura en campo) → se genera un
reporte → se envía oficialmente para ser validado** (por la autoridad /
empresa / terminal). Es decir, la "bandeja de revisión" no termina en la
aprobación interna: produce un **reporte oficial** que va a un tercero para
validación formal antes de darse por bueno. Pendiente de diseñar (formato
del reporte, a quién se envía, cómo se registra la validación de vuelta).

---

## 4. Ensayo Cooflotax (ritual diario, hecho con datos reales)

Fuente: `TARIFAS_ACTUALES_TERMINAL_TUNJA.xlsx` hoja COOFLOTAX.
Entregable: **`scripts/ensayo_cooflotax_tarifas.json`** (cada tarifa anotada
con tipo, confianza, route_id si calza, y duda concreta).

Resultado: 50 tarifas extraídas, 0 errores de parseo. Al cruzar con el esquema:

- **2 de alta confianza** (calzan con ruta oficial, cargables ya):
  Tunja→Duitama $12.000 (route_id 11), Tunja→Siachoque $9.000 (route_id 111).
- **5 municipios sin ruta oficial Cooflotax** (¿faltan rutas?): Soracá,
  Iguaque, Viracachá, Ciénega, Paipa.
- **40 veredas/paraderos** → ver sección 1 (el problema de fondo).
- **3 anomalías:** "La Cruz" a $6.500 y $12.000; "Soacha, Barrial, Zarzas"
  (varios destinos en una celda).

**Recomendación:** no cargar en bloque. Cargar solo las 2 limpias como
prueba del circuito (con visto bueno de Leonardo). El resto depende de
resolver la sección 1.

---

## 5. Próximos pasos al retomar

1. **Sesión dedicada a la sección 1** (paradas + tarifa por etapas/zonas).
   Es el cuello de botella conceptual; nada masivo de tarifas antes de esto.
2. Decidir: ¿cargar las 2 tarifas limpias de Cooflotax como prueba?
3. ¿Crear `field_notes` (autorización de Leonardo) para cerrar el circuito
   campo → Claude Code?
4. v2 de `/campo/`: captura de foto (compresión + cola offline en IndexedDB
   + subida a R2 reusando el patrón del otro proyecto).
5. Limpiar de producción los experimentos temporales cuando corresponda.
6. **Plan de uso (piloto): ✅ acordado en reunión 2026-05-19** (sección 1.c).
   La PWA `/campo/` se entrega al equipo de recolección del terminal y
   empieza a usarse formalmente desde 2026-05-21. Procesamiento diario con
   Claude Code + Leonardo (sección 3).
7. **Módulo separado de recolección de paradas — confirmado en reunión:**
   Street View → GPS, con conductores (sección 1.b). Ya no es solo idea, es
   acuerdo. Sigue siendo trabajo *posterior* al MVP de login.
8. **Antes de 2026-05-21 (MVP para reunión de presentación):**
   - Diseñar el login por correo del equipo (magic link o código).
   - Recoger la lista de correos del equipo (1 ya conocido, faltan el resto).
   - Sustituir el `pasante` libre por el correo autenticado en `field_notes`.

> Memoria persistente del proyecto (contexto, decisiones, estilo de trabajo):
> `~/.claude/projects/-home-leonardo-tp-routes/memory/`.
