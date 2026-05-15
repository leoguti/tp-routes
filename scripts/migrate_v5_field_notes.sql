-- Migración v5.0 — Bandeja de captura de campo (pasantes en terminal)
--
-- ADITIVA Y SEGURA: solo CREATE ... IF NOT EXISTS. No hace DROP ni ALTER
-- de ninguna tabla existente. Si se quiere revertir el experimento:
--   DROP TABLE IF EXISTS field_notes;
--
-- Propósito: los pasantes capturan datos en el terminal (tarifas, horarios,
-- confirmaciones, rutas no listadas). NO se escriben directo a las tablas
-- oficiales (route_fares / route_trips / routes). Entran aquí con estado
-- 'pendiente' y solo tras revisión humana se promueven al esquema real.

CREATE TABLE IF NOT EXISTS field_notes (
    id             SERIAL PRIMARY KEY,
    region_id      VARCHAR(50) NOT NULL DEFAULT 'boyaca',

    -- Empresa visitada
    operator_id    INT,                  -- FK lógica a operators (puede ser NULL si "no listada")
    operator_text  TEXT,                 -- nombre tal como lo vio/escribió el pasante

    -- Ruta a la que se refiere (opcional: a veces es un hallazgo nuevo)
    route_id       INT,
    route_text     TEXT,                 -- "Tunja → Sogamoso (directa)" textual

    -- Qué dato es y qué respondió
    campo          VARCHAR(30),          -- tarifa | horario | confirmacion | nueva_ruta | otro
    valor          TEXT,                 -- lo que el pasante anotó
    nota_libre     TEXT,                 -- comentario adicional

    -- Autoría y trazabilidad
    pasante        TEXT,                 -- nombre del pasante (autoría del dato)
    client_uuid    TEXT UNIQUE,          -- idempotencia: reintentar sync no duplica
    capturado_en   TIMESTAMPTZ,          -- hora real en el celular (puede ser offline)

    -- Bandeja de revisión
    estado         VARCHAR(20) DEFAULT 'pendiente',  -- pendiente | aprobado | descartado
    revisado_por   TEXT,
    revisado_en    TIMESTAMPTZ,

    creada_en      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_notes_operator ON field_notes (operator_id);
CREATE INDEX IF NOT EXISTS idx_field_notes_estado   ON field_notes (estado);
CREATE INDEX IF NOT EXISTS idx_field_notes_region   ON field_notes (region_id);
