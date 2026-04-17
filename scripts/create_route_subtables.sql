-- Crea las tablas que cuelgan de routes: paradas, trazados, tarifas, horarios.
-- Según la arquitectura v2.0 (ARQUITECTURA.md entidades 5-8).
-- El endpoint GET /api/routes?id=X y recalcProgress hacen SELECT sobre estas
-- tablas; si no existen, crashea al editar una ruta.

-- 5. route_stops — orden de paradas por ruta
CREATE TABLE IF NOT EXISTS route_stops (
    id SERIAL PRIMARY KEY,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_id INTEGER,                          -- FK a stops (opcional hasta que se definan)
    orden INTEGER NOT NULL,
    tiempo_desde_inicio_min INTEGER,
    distancia_desde_inicio_km DOUBLE PRECISION,
    es_origen BOOLEAN DEFAULT FALSE,
    es_destino BOOLEAN DEFAULT FALSE,
    creada_en TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (route_id, orden)
);
CREATE INDEX IF NOT EXISTS idx_route_stops_route ON route_stops(route_id);

-- 6. route_shapes — geometría del trazado
CREATE TABLE IF NOT EXISTS route_shapes (
    id SERIAL PRIMARY KEY,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    geojson JSONB NOT NULL,
    distancia_km DOUBLE PRECISION,
    generado_con VARCHAR(20),                 -- valhalla | manual | osm
    valhalla_waypoints JSONB,
    creada_en TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_shapes_route ON route_shapes(route_id);

-- 7. route_fares — tarifas por tramo
CREATE TABLE IF NOT EXISTS route_fares (
    id SERIAL PRIMARY KEY,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_origen_id INTEGER,
    stop_destino_id INTEGER,
    tarifa_cop INTEGER,
    moneda VARCHAR(3) DEFAULT 'COP',
    vigente_desde DATE,
    vigente_hasta DATE,
    fuente VARCHAR(20),                       -- funcionario | estimado
    creado_por INTEGER,
    creada_en TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_fares_route ON route_fares(route_id);

-- 8. route_trips — horarios de salida
CREATE TABLE IF NOT EXISTS route_trips (
    id SERIAL PRIMARY KEY,
    route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    hora_salida TIME,
    dias TEXT[],                              -- ['lunes','martes',...]
    temporada VARCHAR(20) DEFAULT 'todo_año', -- todo_año | escolar | festivo
    creado_por INTEGER,
    creada_en TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_route_trips_route ON route_trips(route_id);

-- route_tasks necesita UNIQUE (route_id, tipo) para el ON CONFLICT de los INSERTs
CREATE UNIQUE INDEX IF NOT EXISTS idx_route_tasks_route_tipo
    ON route_tasks (route_id, tipo);
