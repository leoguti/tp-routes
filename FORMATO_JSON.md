# Formato del JSON de rutas

> Esquema de datos que consume `scripts/seed.js` para cargar rutas a la base.
> Diseñado para ser generado por IA a partir de fuentes como Excel del terminal,
> resoluciones, o listados manuales.

---

## Estructura general

Un archivo JSON con tres claves en la raíz:

```json
{
  "region": "boyaca",
  "operadores": [ ... ],
  "rutas":      [ ... ]
}
```

| Campo        | Tipo     | Obligatorio | Descripción |
|--------------|----------|-------------|-------------|
| `region`     | string   | sí          | Código de región (`boyaca`, `cochabamba`, etc.). Debe existir en la tabla `regions`. |
| `operadores` | array    | sí          | Catálogo de empresas operadoras referenciadas en `rutas`. |
| `rutas`      | array    | sí          | Lista de rutas. Cada entrada define una ruta conceptual (se expande a ida + vuelta). |

---

## Sección `operadores`

Cada elemento es un objeto con datos de una empresa de transporte.

```json
{
  "nombre": "Libertadores",
  "nombre_corto": "LIB",
  "telefono": "+57 601 428 4000",
  "email": "info@libertadores.com.co",
  "url": "https://libertadores.com.co"
}
```

| Campo          | Tipo   | Obligatorio | Notas |
|----------------|--------|-------------|-------|
| `nombre`       | string | sí          | Nombre completo de la empresa. Clave de identificación. |
| `nombre_corto` | string | no          | Alias o sigla. |
| `telefono`     | string | no          | Formato libre. |
| `email`        | string | no          | |
| `url`          | string | no          | Sitio web. |

**Regla de unicidad:** un operador es único por `(region, norm(nombre))`, donde `norm` es la función de normalización descrita abajo. Dos entradas con mismo nombre normalizado son el mismo operador — el loader aborta si detecta duplicados.

**Integridad referencial:** cada ruta en `rutas` debe usar un `operador` que aparezca en esta sección. El loader falla si referencia un operador no listado.

---

## Sección `rutas`

Cada elemento describe una **ruta conceptual** (una pareja ida + vuelta). El loader expande cada entrada a **dos filas** en la tabla `routes`: una con `direction='ida'`, otra con `direction='vuelta'`, unidas por `route_parent_id`.

```json
{
  "origen": "Bogotá",
  "destino": "Sogamoso",
  "via": ["Tunja", "Duitama"],
  "operador": "Libertadores",
  "ref": "LIB-01",
  "resolucion": "1234-2020",
  "notas": "Horario extendido fin de semana"
}
```

| Campo          | Tipo                   | Obligatorio | Notas |
|----------------|------------------------|-------------|-------|
| `origen`       | string                 | sí          | Ciudad de origen (texto). Se guardará en `routes.origen_text`. |
| `destino`      | string                 | sí          | Ciudad de destino (texto). Se guardará en `routes.destino_text`. |
| `via`          | array de strings       | sí          | Ciudades intermedias en orden. Array vacío `[]` = ruta directa. |
| `operador`     | string                 | sí          | Debe coincidir con un `nombre` de la sección `operadores`. |
| `resoluciones` | array de objetos       | sí          | Resoluciones que aprueban la ruta. Puede tener 1 o varias (casos reales de múltiples resoluciones históricas por misma ruta y empresa). Puede ir vacío `[]` si aún no se tiene la resolución, pero debe estar presente. Ver estructura abajo. |
| `ref`          | string                 | no          | Código interno del operador para esta ruta. |
| `notas`        | string                 | no          | Texto libre. |

### Estructura de una resolución

Cada elemento de `resoluciones` es un objeto:

```json
{
  "numero": "2634",
  "fecha": "1993-05-31",
  "texto_original": "RESOLUCIÓN NO. 2634 DEL 31 DE MAYO DE 1993",
  "pdf_url": null
}
```

| Campo            | Tipo         | Obligatorio | Notas |
|------------------|--------------|-------------|-------|
| `numero`         | string       | sí          | Número limpio de la resolución (`"2634"`). Sin prefijos ni basura. |
| `fecha`          | string (ISO) | no          | Fecha de expedición, formato `YYYY-MM-DD`. |
| `texto_original` | string       | no          | Texto tal cual aparece en la fuente (Excel, PDF). Útil para trazabilidad y revisión manual. |
| `pdf_url`        | string (URL) | no          | URL pública al PDF en el object storage. Se rellena cuando se sube el PDF; inicialmente `null`. Ver sección de almacenamiento más abajo. |

**Resoluciones compartidas entre ida y vuelta:** una resolución aprueba la ruta completa (ambas direcciones). A nivel BD, las resoluciones se almacenan una vez, apuntando a la fila de ida (`route_parent_id IS NULL`). La vuelta consulta las resoluciones de su padre.

### Expansión a ida + vuelta

Una entrada con `origen=A`, `destino=B`, `via=[X, Y]` produce:

| direction | origen_text | destino_text | waypoints (en orden) |
|-----------|-------------|--------------|---------------------|
| `ida`     | A           | B            | [X, Y]              |
| `vuelta`  | B           | A            | [Y, X] (invertida)  |

Ambas filas comparten: `operator_id`, `ref`, `resolucion`, `notas`, `region_id`. Se vinculan con `route_parent_id` apuntando a la fila de ida.

### Clave única

Una ruta es única por la tupla:

```
(region, operator_id, norm(origen), norm(destino), norm(via[]), direction)
```

El loader ignora duplicados dentro del mismo JSON (aborta con error) y hace upsert contra la BD por esta misma clave.

---

## Normalización (`norm`)

Para comparar nombres de ciudades, operadores y vías, se aplica:

1. `trim` (eliminar espacios sobrantes al inicio/final).
2. Minúsculas.
3. Quitar tildes y diéresis (`á → a`, `ü → u`, etc.).
4. Colapsar espacios interiores múltiples a uno solo.

```
norm("  Bogotá D.C. ") === "bogota d.c."
norm("LIBERTADORES")   === "libertadores"
norm("Duitama")        === "duitama"
```

El texto **original** se guarda en BD tal como viene en el JSON (ej. `"Bogotá"`, no `"bogota"`). La normalización solo se usa para comparar al detectar duplicados y hacer upsert.

---

## Comportamiento del loader (`seed.js`)

```
node scripts/seed.js data.json [--reset]
```

- **Por defecto (upsert):** para cada operador y cada ruta, hace upsert por su clave única. Rutas existentes actualizan solo los campos del JSON (`ref`, `resolucion`, `notas`). Datos enriquecidos (paradas, trazados, tarifas) se preservan.
- **Con `--reset`:** `TRUNCATE operators, routes, route_waypoints RESTART IDENTITY CASCADE` antes de insertar. Destructivo.

### Validaciones que hace el loader

1. El campo `region` existe en la tabla `regions`.
2. Cada `rutas[].operador` aparece en `operadores[]`.
3. No hay operadores duplicados por `norm(nombre)` dentro del JSON.
4. No hay rutas duplicadas por la clave única dentro del JSON.
5. Campos obligatorios presentes y no vacíos.

Si alguna validación falla, el loader aborta sin insertar nada (transacción).

---

## Ejemplo completo

```json
{
  "region": "boyaca",
  "operadores": [
    {
      "nombre": "Libertadores",
      "telefono": "+57 601 428 4000",
      "url": "https://libertadores.com.co"
    },
    {
      "nombre": "Autoboy",
      "telefono": "+57 608 742 1111"
    },
    {
      "nombre": "Cootransoriente"
    }
  ],
  "rutas": [
    {
      "origen": "Bogotá",
      "destino": "Sogamoso",
      "via": [],
      "operador": "Libertadores",
      "ref": "LIB-01",
      "resoluciones": [
        { "numero": "1234", "fecha": "2020-03-15", "texto_original": "RES 1234 DE 2020", "pdf_url": null }
      ]
    },
    {
      "origen": "Tunja",
      "destino": "Duitama",
      "via": [],
      "operador": "Autoboy",
      "resoluciones": [
        { "numero": "2634", "fecha": "1993-05-31", "texto_original": "RESOLUCIÓN NO. 2634 DEL 31 DE MAYO DE 1993", "pdf_url": null },
        { "numero": "1368", "fecha": "1993-03-16", "texto_original": "RESOLUCIÓN NO. 1368 DEL 16 DE MARZO DE 1993", "pdf_url": null }
      ]
    },
    {
      "origen": "Tunja",
      "destino": "Paipa",
      "via": [],
      "operador": "Cootransoriente",
      "resoluciones": [],
      "notas": "Resolución pendiente de ingresar"
    }
  ]
}
```

Este archivo genera:

- **3 operadores** (Libertadores, Autoboy, Cootransoriente).
- **6 rutas** en total (3 entradas × 2 direcciones cada una).
- **4 resoluciones** asociadas (1 a Libertadores Bogotá↔Sogamoso, 2 a Autoboy Tunja↔Duitama, 0 a Cootransoriente Tunja↔Paipa).

---

## Almacenamiento de PDFs de resoluciones — Cloudflare R2

Los PDFs de las resoluciones se guardan en **Cloudflare R2** (object storage compatible con S3, sin fees de egress).

**Convención de `key` en el bucket:**

```
resoluciones/{region}/{operador_slug}/{numero_resolucion}.pdf
```

Ejemplo:
```
resoluciones/boyaca/autoboy/2634-1993.pdf
```

Donde:
- `operador_slug` = `norm(operador)` con espacios reemplazados por `-`.
- `numero_resolucion` = `{numero}-{YYYY}` si hay fecha, si no solo `{numero}`.

**Campos relacionados en BD:**
- `route_resolutions.pdf_url` — URL pública del objeto en R2.
- `route_resolutions.pdf_key` — key del objeto en el bucket (permite renombrar/eliminar).

**Flujo de subida:**
1. Usuario sube PDF desde la UI.
2. Endpoint del backend genera el key según la convención.
3. Se sube a R2 con SDK S3.
4. Se actualiza `pdf_url` y `pdf_key` en `route_resolutions`.

**En el JSON de carga (seed):** `pdf_url` suele ser `null` al cargar masivo. Los PDFs se suben después, uno a uno, desde la UI. Si en el futuro se quiere cargar PDFs masivamente, el JSON puede incluir una `pdf_url` ya existente (para re-usar archivos ya subidos).

---

## Casos edge y aclaraciones

- **Ruta directa:** `"via": []`. No es lo mismo que omitir el campo (el loader lo exige siempre, aunque sea vacío).
- **Misma ciudad como origen y destino** → error de validación (no es una ruta válida).
- **`via` contiene el origen o el destino** → error de validación (la vía describe paradas *intermedias*).
- **Vía asimétrica** (ruta de vuelta por camino distinto): no se soporta en v1. Si llega a aparecer, se discute y se agrega campo opcional `via_vuelta`.
- **Stops/terminales reales:** el JSON **no** enlaza con la tabla `stops`. Los campos `routes.origen_stop_id`, `routes.destino_stop_id` y `route_waypoints.stop_id` quedan `NULL` al cargar. Se enlazan después, en otra fase, contra una parada con `lat`/`lon`.
- **Ida y vuelta son inseparables:** editar/eliminar una dirección afecta a la otra. El JSON solo describe el par completo.
- **Tarifas, horarios, trazado:** no entran en este JSON. Van por vías separadas (UI o cargas posteriores).

---

*Documento v1 — abril 2026*
