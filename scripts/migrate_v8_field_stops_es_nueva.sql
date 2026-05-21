-- Migración v8.0 — flag es_nueva en field_stops
--
-- ADITIVA Y SEGURA: solo ALTER ... ADD COLUMN IF NOT EXISTS. Idempotente.
--
-- Distingue las paradas capturadas que NO estaban en la lista oficial del
-- corredor (es_nueva = true) de las geolocalizaciones de paradas oficiales
-- (es_nueva = false). En la revisión se decide si una nueva se promueve a
-- parada oficial del corredor.

ALTER TABLE field_stops ADD COLUMN IF NOT EXISTS es_nueva BOOLEAN NOT NULL DEFAULT FALSE;
