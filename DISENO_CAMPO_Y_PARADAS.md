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

---

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

> Memoria persistente del proyecto (contexto, decisiones, estilo de trabajo):
> `~/.claude/projects/-home-leonardo-tp-routes/memory/`.
