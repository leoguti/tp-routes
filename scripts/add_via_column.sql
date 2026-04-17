-- Migration: agregar columna `via` a terminal_routes y routes
-- Parte del cambio de arquitectura: la clave única de una ruta pasa a ser
-- (operator, origen, destino, via). Dos rutas con mismo origen/destino pero
-- diferente via son rutas distintas (paran en pueblos intermedios distintos).

ALTER TABLE terminal_routes
    ADD COLUMN IF NOT EXISTS via TEXT;

ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS via TEXT;

-- Índices para acelerar la dedup en los endpoints de import y promote
CREATE INDEX IF NOT EXISTS idx_terminal_routes_key
    ON terminal_routes (region, origen, destino, operador, COALESCE(via, ''));

CREATE INDEX IF NOT EXISTS idx_routes_key
    ON routes (region_id, operator_id, origen, destino, COALESCE(via, ''));
