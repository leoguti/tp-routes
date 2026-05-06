-- migrate_v4_places.sql
--
-- Catálogo humano de lugares (places) y vínculo desde origen/destino/waypoints.
--
-- - `places` es el catálogo editable a mano: una entidad por ciudad o sitio
--   donde paran las rutas, con lat/lon. Es independiente de `stops` (cache OSM).
-- - `route_waypoints.place_id` engancha cada parada intermedia a un place.
--   Si es NULL, la parada vive sólo como texto (`nombre_text`) y queda
--   pendiente de geolocalizar.
-- - `routes.origen_place_id` / `destino_place_id` hacen lo mismo para las
--   terminales del corredor.
--
-- La columna `stop_id` (FK a stops/OSM) preexistente se conserva por si más
-- adelante se cruzan ambos catálogos. Para esta fase, todo lo humano va por
-- `place_id`.

CREATE TABLE IF NOT EXISTS places (
    id           SERIAL PRIMARY KEY,
    region_id    VARCHAR(50)  NOT NULL DEFAULT 'boyaca',
    nombre       TEXT         NOT NULL,
    lat          DOUBLE PRECISION NOT NULL,
    lon          DOUBLE PRECISION NOT NULL,
    municipio    TEXT,
    notas        TEXT,
    creada_en    TIMESTAMPTZ  DEFAULT NOW(),
    actualizada_en TIMESTAMPTZ DEFAULT NOW()
);

-- Unicidad por nombre normalizado dentro de la región.
-- "Paipa" y "paipa" colapsan al mismo registro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_places_region_norm
    ON places (region_id, norm_text(nombre));

CREATE INDEX IF NOT EXISTS idx_places_norm
    ON places (norm_text(nombre));


-- Vínculo en paradas intermedias
ALTER TABLE route_waypoints
    ADD COLUMN IF NOT EXISTS place_id INT REFERENCES places(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_route_waypoints_place
    ON route_waypoints (place_id);


-- Vínculo en terminales (origen / destino)
ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS origen_place_id  INT REFERENCES places(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS destino_place_id INT REFERENCES places(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_routes_origen_place
    ON routes (origen_place_id);
CREATE INDEX IF NOT EXISTS idx_routes_destino_place
    ON routes (destino_place_id);
