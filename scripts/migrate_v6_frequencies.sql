-- Migración v6 — Modelado de frecuencia + ventana cruda de operación
--
-- ADITIVA: solo agrega columna y crea tabla con IF NOT EXISTS.
-- Para revertir: DROP TABLE route_frequencies; ALTER TABLE routes DROP COLUMN horario_operacion_crudo;
--
-- Motivación: la captura de campo (mayo 2026) demostró que los horarios
-- llegan como VENTANAS ("6am-8:30pm") y no como turnos fijos. El esquema
-- previo (route_trips con hora_salida puntual) solo cubre turnos fijos.
-- GTFS modela ambos casos: trips para turnos fijos, frequencies para
-- ventana + headway (con exact_times=0 = "sale cuando se llena").
-- Esta migración agrega:
--   1) routes.horario_operacion_crudo  → texto crudo del campo
--      (para no perder info mientras refinamos la pregunta).
--   2) route_frequencies               → modelo GTFS-compatible
--      (start_time, end_time, headway, exact_times).

ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS horario_operacion_crudo TEXT;

CREATE TABLE IF NOT EXISTS route_frequencies (
    id             SERIAL PRIMARY KEY,
    route_id       INT NOT NULL REFERENCES routes(id),
    hora_primera   TIME NOT NULL,
    hora_ultima    TIME NOT NULL,
    headway_min    INT,                         -- NULL = aún no preguntado
    exact_times    BOOLEAN DEFAULT FALSE,       -- false = "aproximado / cuando se llena"
    dias           TEXT[] DEFAULT ARRAY['LMMJVSD'],
    fuente         VARCHAR(80),                 -- p.ej. 'campo-2026-05-27'
    creado_por     INT,
    creada_en      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_frequencies_route ON route_frequencies (route_id);
