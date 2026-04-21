-- Migración v3.0 — Listado maestro de rutas
-- Esquema definitivo según FORMATO_JSON.md y ARQUITECTURA.md (sección Rutas y operadores).
--
-- Cambios principales sobre v2.x:
--   - `routes`: se cambian `origen`/`destino` (texto con `via` textual en columna aparte)
--     por `origen_text`/`destino_text` + columnas de link nullable (`origen_stop_id`,
--     `destino_stop_id`) que se rellenan en fase posterior.
--   - La vía pasa de columna única en `routes` a tabla dedicada `route_waypoints`
--     (array de ciudades intermedias en orden).
--   - Las resoluciones pasan de columna única a tabla `route_resolutions` (una ruta
--     puede tener múltiples resoluciones históricas y cada una puede tener su PDF).
--   - Se elimina la tabla `terminal_routes` y todo el sistema de importación:
--     los datos entran por `scripts/seed.js` desde un JSON ya procesado.
--
-- Atención: esta migración es DESTRUCTIVA. Hace DROP de todo lo anterior porque
-- se acordó arrancar la BD limpia y recargar los datos desde el nuevo JSON.
--
-- Uso:
--   psql $DATABASE_URL -f scripts/migrate_v3.sql
-- O desde Neon SQL Editor: pegar todo el contenido.

BEGIN;

-- =============================================================================
-- 1. Funciones auxiliares
-- =============================================================================

-- Normalización reusable: trim + lowercase + sin tildes + colapsa espacios.
-- Usa translate() en lugar de la extensión unaccent para evitar dependencia
-- de extensiones no disponibles por defecto en algunos schemas de Neon.
CREATE OR REPLACE FUNCTION norm_text(t text) RETURNS text AS $$
    SELECT lower(
        regexp_replace(
            trim(
                translate(
                    coalesce(t, ''),
                    'áéíóúÁÉÍÓÚàèìòùÀÈÌÒÙäëïöüÄËÏÖÜâêîôûÂÊÎÔÛñÑçÇ',
                    'aeiouAEIOUaeiouAEIOUaeiouAEIOUaeiouAEIOUnNcC'
                )
            ),
            '\s+', ' ', 'g'
        )
    )
$$ LANGUAGE sql IMMUTABLE;


-- =============================================================================
-- 2. DROP de tablas que cambian o desaparecen
-- =============================================================================

-- Dependientes de routes
DROP TABLE IF EXISTS route_tasks        CASCADE;
DROP TABLE IF EXISTS route_trips        CASCADE;
DROP TABLE IF EXISTS route_fares        CASCADE;
DROP TABLE IF EXISTS route_shapes       CASCADE;
DROP TABLE IF EXISTS route_stops        CASCADE;
DROP TABLE IF EXISTS route_waypoints    CASCADE;
DROP TABLE IF EXISTS route_resolutions  CASCADE;

-- Tabla central
DROP TABLE IF EXISTS routes             CASCADE;

-- Catálogo de operadores (se recrea)
DROP TABLE IF EXISTS operators          CASCADE;

-- Sistema de importación: fuera
DROP TABLE IF EXISTS terminal_routes    CASCADE;


-- =============================================================================
-- 3. Tablas nuevas / recreadas
-- =============================================================================

-- --- Operadores ------------------------------------------------------------
CREATE TABLE operators (
    id              SERIAL PRIMARY KEY,
    region_id       VARCHAR(50) NOT NULL,
    nombre          TEXT        NOT NULL,
    nombre_corto    TEXT,
    telefono        TEXT,
    email           TEXT,
    url             TEXT,
    gtfs_agency_id  TEXT,
    creada_en       TIMESTAMPTZ DEFAULT NOW(),
    actualizada_en  TIMESTAMPTZ DEFAULT NOW()
);

-- Clave única por nombre normalizado (case/acento insensitive)
CREATE UNIQUE INDEX idx_operators_region_nombre_norm
    ON operators (region_id, norm_text(nombre));


-- --- Routes ----------------------------------------------------------------
CREATE TABLE routes (
    id                SERIAL PRIMARY KEY,
    region_id         VARCHAR(50) NOT NULL,
    operator_id       INT         NOT NULL REFERENCES operators(id) ON DELETE CASCADE,

    -- Texto libre: la ruta se crea con texto y se linkea a stops reales después
    origen_text       TEXT NOT NULL,
    destino_text      TEXT NOT NULL,
    origen_stop_id    INT REFERENCES stops(id),    -- NULL hasta que se linkee
    destino_stop_id   INT REFERENCES stops(id),    -- NULL hasta que se linkee

    -- Dirección (ida/vuelta) — cada ruta conceptual genera dos filas
    direction         VARCHAR(10) NOT NULL CHECK (direction IN ('ida', 'vuelta')),
    route_parent_id   INT REFERENCES routes(id) ON DELETE CASCADE,
    -- la ida tiene route_parent_id = NULL; la vuelta apunta a la ida.

    -- Metadata
    ref               TEXT,        -- código interno del operador
    notas             TEXT,

    -- Enriquecimiento posterior
    progreso_pct      INT  DEFAULT 0,
    responsable_id    INT,
    osm_relation_id   BIGINT,
    osm_merged        BOOLEAN DEFAULT FALSE,

    creado_por        INT,
    creada_en         TIMESTAMPTZ DEFAULT NOW(),
    actualizada_en    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_routes_region    ON routes (region_id);
CREATE INDEX idx_routes_operator  ON routes (operator_id);
CREATE INDEX idx_routes_parent    ON routes (route_parent_id);
CREATE INDEX idx_routes_lookup
    ON routes (
        region_id,
        operator_id,
        norm_text(origen_text),
        norm_text(destino_text),
        direction
    );

-- Nota: la unicidad completa (con `via`) se valida a nivel aplicación en seed.js,
-- porque la vía vive en route_waypoints (tabla aparte). El índice anterior cubre
-- la mayoría de lookups; para garantía estricta, el loader verifica en transacción.


-- --- Route waypoints (vía) -------------------------------------------------
-- Ciudades intermedias que definen el recorrido. Texto libre + link opcional.
CREATE TABLE route_waypoints (
    id            SERIAL PRIMARY KEY,
    route_id      INT  NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    orden         INT  NOT NULL,
    nombre_text   TEXT NOT NULL,
    stop_id       INT REFERENCES stops(id),    -- NULL hasta linkear con parada real
    creada_en     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (route_id, orden)
);
CREATE INDEX idx_route_waypoints_route ON route_waypoints (route_id);


-- --- Route resolutions (resoluciones que aprueban la ruta) -----------------
-- Una ruta puede tener 0, 1 o más resoluciones. Cada una con su PDF opcional.
-- Las resoluciones son a nivel de ruta conceptual: ida y vuelta las comparten.
-- Se apunta siempre a la fila ida (route_parent_id IS NULL).
CREATE TABLE route_resolutions (
    id               SERIAL PRIMARY KEY,
    route_id         INT  NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    orden            INT  NOT NULL,
    numero           TEXT NOT NULL,        -- "2634"
    fecha            DATE,                 -- "1993-05-31"
    texto_original   TEXT,                 -- texto sin normalizar, útil para revisión
    pdf_url          TEXT,                 -- URL pública en R2
    pdf_key          TEXT,                 -- key del objeto en el bucket R2
    notas            TEXT,
    creada_en        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (route_id, orden)
);
CREATE INDEX idx_route_resolutions_route ON route_resolutions (route_id);


-- --- Route stops (paradas físicas del recorrido, en orden) -----------------
-- Distinta de route_waypoints: aquí van todas las paradas geolocalizadas
-- (terminales + paraderos intermedios con lat/lon). Se llena en fase siguiente.
CREATE TABLE route_stops (
    id                         SERIAL PRIMARY KEY,
    route_id                   INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_id                    INT REFERENCES stops(id),
    orden                      INT NOT NULL,
    tiempo_desde_inicio_min    INT,
    distancia_desde_inicio_km  DOUBLE PRECISION,
    es_origen                  BOOLEAN DEFAULT FALSE,
    es_destino                 BOOLEAN DEFAULT FALSE,
    creada_en                  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (route_id, orden)
);
CREATE INDEX idx_route_stops_route ON route_stops (route_id);


-- --- Route shapes (trazado geométrico) -------------------------------------
CREATE TABLE route_shapes (
    id                   SERIAL PRIMARY KEY,
    route_id             INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    geojson              JSONB NOT NULL,
    distancia_km         DOUBLE PRECISION,
    generado_con         VARCHAR(20),     -- valhalla | manual | osm
    valhalla_waypoints   JSONB,
    creada_en            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_route_shapes_route ON route_shapes (route_id);


-- --- Route fares (tarifas por tramo) ---------------------------------------
CREATE TABLE route_fares (
    id              SERIAL PRIMARY KEY,
    route_id        INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_origen_id  INT,
    stop_destino_id INT,
    tarifa_cop      INT,
    moneda          VARCHAR(3) DEFAULT 'COP',
    vigente_desde   DATE,
    vigente_hasta   DATE,
    fuente          VARCHAR(20),           -- funcionario | estimado
    creado_por      INT,
    creada_en       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_route_fares_route ON route_fares (route_id);


-- --- Route trips (horarios de salida) --------------------------------------
CREATE TABLE route_trips (
    id           SERIAL PRIMARY KEY,
    route_id     INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    hora_salida  TIME,
    dias         TEXT[],                   -- ['lunes','martes',...]
    temporada    VARCHAR(20) DEFAULT 'todo_año',
    creado_por   INT,
    creada_en    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_route_trips_route ON route_trips (route_id);


-- --- Route tasks (tareas automáticas por ruta) -----------------------------
CREATE TABLE route_tasks (
    id             SERIAL PRIMARY KEY,
    route_id       INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    tipo           VARCHAR(30) NOT NULL,   -- localizar_paradas|ingresar_tarifas|...
    estado         VARCHAR(20) DEFAULT 'pendiente',
    asignado_a     INT,
    creada_en      TIMESTAMPTZ DEFAULT NOW(),
    completada_en  TIMESTAMPTZ,
    UNIQUE (route_id, tipo)
);
CREATE INDEX idx_route_tasks_route ON route_tasks (route_id);


COMMIT;

-- =============================================================================
-- Verificación post-migración (ejecutar manualmente):
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' ORDER BY table_name;
--
-- Debería listar: operators, relation_members, relations, route_fares,
-- route_resolutions, route_shapes, route_stops, route_tasks, route_trips,
-- route_waypoints, routes, stops, sync_log.
-- =============================================================================
