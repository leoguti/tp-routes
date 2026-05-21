-- Migración v7.0 — Bandeja de captura de PARADAS georreferenciadas
--
-- ADITIVA Y SEGURA: solo CREATE ... IF NOT EXISTS. No hace DROP ni ALTER de
-- tablas existentes. Idempotente (se puede correr varias veces).
--
-- Propósito: módulo de paradas dentro de /campo/. Un funcionario, junto a un
-- conductor de una empresa, captura las paradas de un corredor con su coordenada
-- (mapa-pin o pegando la coord de Google). Entra a esta bandeja con estado
-- 'pendiente'; NUNCA escribe directo a places/route_stops. Se promueve tras
-- revisión humana (dedupe por cercanía).
--
-- Revertir el experimento (si hiciera falta):
--   DROP TABLE IF EXISTS field_stops;

CREATE TABLE IF NOT EXISTS field_stops (
    id               SERIAL PRIMARY KEY,
    region_id        VARCHAR(50) NOT NULL DEFAULT 'boyaca',

    -- Empresa y corredor (la ruta ida) a los que pertenece la parada
    operator_id      INT,                  -- FK lógica a operators
    operator_text    TEXT,                 -- nombre de la empresa tal como se vio
    route_id         INT,                  -- FK lógica a routes (corredor / ida)
    route_text       TEXT,                 -- "origen → destino" textual

    -- La parada en sí
    nombre           TEXT,                 -- nombre del paradero según el conductor
    lat              DOUBLE PRECISION,     -- coordenada capturada
    lon              DOUBLE PRECISION,
    orden            INT,                  -- posición en el corredor (1,2,3…)
    tipo             VARCHAR(20),          -- terminal | parada_formal | parada_informal | punto_urbano
    metodo_geo       VARCHAR(20),          -- mapa_pin | pegado_gmaps | gps_celular (auditar calidad)
    nota_libre       TEXT,                 -- referencia visual ("frente a la iglesia")

    -- Autoría y trazabilidad
    user_id          INT REFERENCES field_users (id),  -- funcionario autenticado que captura
    informante_rol   TEXT,                 -- normalmente 'conductor'
    informante_alias TEXT,                 -- alias/placa, SIN datos personales sensibles
    client_uuid      TEXT UNIQUE,          -- idempotencia: reintentar sync no duplica
    capturado_en     TIMESTAMPTZ,          -- hora real en el celular (puede ser offline)

    -- Bandeja de revisión
    estado           VARCHAR(20) DEFAULT 'pendiente',  -- pendiente | aprobado | descartado
    revisado_por     TEXT,
    revisado_en      TIMESTAMPTZ,

    creada_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_stops_operator ON field_stops (operator_id);
CREATE INDEX IF NOT EXISTS idx_field_stops_route    ON field_stops (route_id);
CREATE INDEX IF NOT EXISTS idx_field_stops_estado   ON field_stops (estado);
