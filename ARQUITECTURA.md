# TP Routes — Arquitectura de la plataforma colaborativa

> Documento de diseño v2.0 — Abril 2026

---

## Visión

Plataforma colaborativa para generar datos GTFS de transporte público abierto. Cualquier persona puede contribuir sin necesitar conocimientos de OSM. El objetivo final es exportar un archivo GTFS válido por región.

---

## Principios

1. **La ruta es la unidad central** — todo (paradas, trazado, tarifas, horarios) pertenece a una ruta
2. **GTFS como destino** — cada campo existe porque GTFS lo necesita
3. **Progreso visible** — cada ruta tiene un % de completitud calculado automáticamente
4. **No bloquear la colaboración** — los no expertos en OSM pueden contribuir libremente
5. **Staging → Producción** — los datos del terminal pasan por revisión antes de ser rutas oficiales
6. **Multi-región** — Boyacá, Cochabamba, Kigali... cada una con su propio GTFS independiente

---

## Roles y responsabilidades

| Rol | Quién | Hace qué |
|-----|-------|---------|
| `contributor` | Estudiantes, funcionarios del terminal | Localizar coordenadas de paradas, ingresar tarifas, ingresar horarios |
| `editor` | Responsable de ruta — conoce OSM | Integrar todo, trazar con Valhalla, ordenar paradas, subir a OSM |
| `admin` | Coordinador del proyecto | Analizar calidad del GTFS generado, validar y publicar el feed |

> **Por ahora:** sin restricción de acceso. Los roles existen pero no bloquean. Se activan en fase posterior.

### Flujo de colaboración

```
Contributors
  ├── Localizan coordenadas de paradas
  └── Ingresan tarifas e ingresar horarios
            ↓
Editor (responsable de ruta)
  ├── Ordena paradas en la ruta
  ├── Genera trazado con Valhalla
  └── Sube a OSM cuando está completo
            ↓
Admin
  └── Analiza calidad del GTFS completo → publica el feed
```

---

## Entidades de datos

### 1. Región (`regions`)
Contexto geográfico independiente. Cada región genera su propio GTFS.

```
id, nombre, tipo (urbano|intermunicipal|mixto),
país, bounds (bbox), centro_lat, centro_lon,
valhalla_url, overpass_area,
gtfs_agency_timezone, gtfs_feed_lang,
activa, creada_en
```

### 2. Operador (`operators`) — normalizado
Empresa de transporte. Equivale a `agency.txt` en GTFS. Campo clave para evitar duplicados por diferencias de escritura.

```
id, region_id,
nombre, nombre_corto,
telefono, email, url,
gtfs_agency_id,
creada_en
```

### 3. Ruta (`routes`) — entidad central
Combinación única de origen + destino + operador + dirección.

```
id, region_id, operator_id,
origen, destino,
ref (código), red (network), color,
resolucion, tipo_servicio (regular|express|nocturno),
direction (ida|vuelta),
route_parent_id,        -- agrupa ida y vuelta como misma ruta GTFS
estado (borrador|en_progreso|aprobada|publicada),
progreso_pct,           -- calculado automáticamente
responsable_id,         -- editor que integra esta ruta
osm_relation_id,        -- link a OSM si ya existe
osm_merged,             -- true si se hizo merge con datos de OSM
terminal_route_id,      -- FK a terminal_routes (origen del import)
creado_por, creada_en, actualizada_en
```

### 4. Parada (`stops`) — compartida entre rutas
Punto físico compartido por múltiples rutas.

```
id, region_id,
nombre, municipio, departamento,
lat, lon, direccion,
tipo (terminal|parada|paradero),
osm_node_id,
estado (borrador|aprobada),
creado_por, aprobado_por, creada_en
```

### 5. Paradas de ruta (`route_stops`)
Orden de paradas dentro de una ruta. Una parada puede aparecer en múltiples rutas.

```
id, route_id, stop_id,
orden,
tiempo_desde_inicio_min,
distancia_desde_inicio_km,
es_origen (bool), es_destino (bool)
```

### 6. Trazado (`route_shapes`)
Geometría guardada en Postgres. Fuente de verdad — OSM es destino de publicación, no fuente.

```
id, route_id,
geojson (LineString),
distancia_km,
generado_con (valhalla|manual|osm),
valhalla_waypoints (jsonb),
creada_en
```

### 7. Tarifas (`route_fares`)
Precio por tramo origen→destino. Por ahora solo desde Tunja. Tramos intermedios se agregan después.

```
id, route_id,
stop_origen_id, stop_destino_id,
tarifa_cop, moneda,
vigente_desde, vigente_hasta,
fuente (funcionario|estimado),
creado_por, creada_en
```

### 8. Horarios (`route_trips`)
Salidas fijas para rutas intermunicipales. Un registro por horario de salida.

```
id, route_id,
hora_salida (HH:MM),
dias (lunes|martes|...|domingo — array),
temporada (todo_año|escolar|festivo),
creado_por, creada_en
```

> Para rutas urbanas con frecuencia constante: campo `frecuencia_min` en vez de trips individuales.

### 9. Tareas automáticas (`route_tasks`)
Generadas automáticamente según lo que falta en cada ruta. Se cierran solas cuando el dato existe. Máximo 5 por ruta.

```
id, route_id,
tipo (localizar_paradas|ingresar_tarifas|asignar_paradas|trazar_ruta|ingresar_horarios),
estado (pendiente|en_progreso|completada),  -- calculado, no manual
asignado_a (user_id),                        -- puede ser diferente al responsable
creada_en, completada_en
```

**Regla:** Las tareas `localizar_paradas` e `ingresar_tarifas` son para contributors. Las tareas `asignar_paradas`, `trazar_ruta` e `ingresar_horarios` son para el editor responsable de la ruta.

### 10. Importación staging (`terminal_routes`)
Datos crudos importados del terminal. Nunca van directo a `routes` — pasan por revisión. Se mantiene como registro histórico de importaciones.

```
-- tabla existente, no se modifica --
-- routes.terminal_route_id apunta aquí cuando una ruta fue promovida desde staging --
```

### 11. Usuarios (`users`)

```
id, nombre, email,
rol (contributor|editor|admin),
region_id,
activo, creado_en
```

### 12. Historial (`audit_log`)

```
id, tabla, registro_id,
usuario_id, accion (create|update|delete|approve|publish),
datos_anteriores (jsonb), datos_nuevos (jsonb),
creado_en
```

---

## Progreso de una ruta hacia GTFS (%)

Calculado automáticamente. 100% = lista para incluir en la exportación GTFS.

| Fase | Peso | Condición |
|------|------|-----------|
| Datos básicos | 20% | origen, destino, operator_id, ref completos |
| Paradas | 20% | ≥ 2 paradas con coordenadas asignadas y ordenadas |
| Trazado | 20% | shape generado con Valhalla o importado de OSM |
| Tarifas | 15% | ≥ 1 tarifa registrada |
| Horarios | 15% | ≥ 1 trip/horario registrado |
| Publicada en OSM | 10% | osm_relation_id presente |

---

## Páginas de la plataforma

| URL | Descripción |
|-----|-------------|
| `/` | Dashboard: progreso por región, tareas abiertas, actividad reciente |
| `/rutas` | Lista maestra: todas las rutas con progreso %, estado, responsable |
| `/rutas/:id` | Detalle de ruta: paradas, trazado, tarifas, horarios, tareas pendientes |
| `/editor` | Editor de trazado: mapa Leaflet + Valhalla |
| `/paradas` | Catálogo de paradas con mapa y estado de coordenadas |
| `/explorador` | Rutas ya en OSM vía Overpass — para comparar y hacer merge |
| `/importar` | Subir Excel/CSV del terminal (staging) |
| `/exportar` | Generar y descargar GTFS por región — solo rutas aprobadas |
| `/admin` | Gestión de usuarios, roles, regiones, calidad del GTFS |

---

## Herramientas externas

| Herramienta | Uso |
|-------------|-----|
| **Valhalla** `valhalla.busboy.app` | Generar trazado por calles reales |
| **Overpass API** | Consultar rutas/paradas ya en OSM — import y merge |
| **OSM API** | Destino de publicación — el editor sube manualmente con JOSM |
| **Neon Postgres** | Base de datos principal — fuente de verdad |
| **Vercel** | Deploy y serverless functions |

---

## Plan de construcción

### Fase 1 — Lista maestra y detalle de ruta ← AHORA
- Crear tablas: `operators`, `routes`, `route_tasks`
- Migrar `terminal_routes` → `routes` (como borrador)
- Página `/rutas`: lista maestra con progreso, filtros, responsable
- Página `/rutas/:id`: detalle completo con tareas automáticas
- API CRUD completa

### Fase 2 — Paradas
- Página `/paradas` con mapa
- Asignar y ordenar paradas en rutas
- Merge con paradas de OSM vía Overpass
- Tarea `localizar_paradas` y `asignar_paradas` funcionales

### Fase 3 — Trazado
- Editor de trazado integrado con Valhalla
- Guardar shape en Postgres
- Tarea `trazar_ruta` funcional

### Fase 4 — Tarifas y horarios
- Importar tarifas desde Excel del terminal
- Formulario de horarios fijos (route_trips)
- Tareas `ingresar_tarifas` e `ingresar_horarios` funcionales

### Fase 5 — Exportación GTFS
- Generar: `agency.txt`, `routes.txt`, `stops.txt`, `trips.txt`, `stop_times.txt`, `calendar.txt`, `shapes.txt`, `fare_attributes.txt`, `fare_rules.txt`
- Validar con herramienta GTFS
- Panel de calidad para el admin

---

*Plataforma desarrollada con Trufi Association / Terminal de Tunja — 2026*
