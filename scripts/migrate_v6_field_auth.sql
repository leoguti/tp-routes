-- Migración v6.0 — Autenticación de la app de campo (login real)
--
-- ADITIVA Y SEGURA: solo CREATE ... IF NOT EXISTS y ALTER ... ADD COLUMN
-- IF NOT EXISTS. No hace DROP de nada. Idempotente (se puede correr varias veces).
--
-- DEPENDENCIA: requiere que la tabla field_notes ya exista (migración v5).
-- Si field_notes aún no está en la BD, corré primero migrate_v5_field_notes.js.
--
-- Reemplaza la "clave básica + nombre libre" por:
--   - Login principal: "Iniciar sesión con Google" (correo verificado por Google).
--   - Respaldo: código de un solo uso (OTP) enviado al correo.
--   - Lista cerrada de autorizados en field_users (gatea el acceso tras
--     verificar la identidad). La sesión es nuestra (JWT), 7 días deslizante.
--
-- Revertir el experimento (si hiciera falta):
--   ALTER TABLE field_notes DROP COLUMN IF EXISTS user_id;
--   DROP TABLE IF EXISTS field_otps;
--   DROP TABLE IF EXISTS field_users;

-- 1) Lista cerrada de usuarios autorizados ---------------------------------
--    Los datos personales (los 14 correos) NO van en este archivo: se cargan
--    aparte con un script local que lee la lista privada fuera del repo.
CREATE TABLE IF NOT EXISTS field_users (
    id             SERIAL PRIMARY KEY,
    correo         TEXT UNIQUE NOT NULL,                      -- siempre en minúsculas
    nombre         TEXT,
    rol            VARCHAR(20) NOT NULL DEFAULT 'terminal',   -- terminal | estudiante | trufi
    activo         BOOLEAN NOT NULL DEFAULT TRUE,             -- soft delete: marcar inactivo, nunca borrar
    creado_en      TIMESTAMPTZ DEFAULT NOW(),
    ultimo_acceso  TIMESTAMPTZ,                               -- se actualiza en cada login (seguimiento por persona)
    CONSTRAINT chk_field_users_rol CHECK (rol IN ('terminal', 'estudiante', 'trufi'))
);

-- 2) Códigos de un solo uso (OTP) del login de respaldo --------------------
--    Nunca se guarda el código en claro, solo su hash. Caducan rápido.
CREATE TABLE IF NOT EXISTS field_otps (
    id          SERIAL PRIMARY KEY,
    correo      TEXT NOT NULL,                  -- a quién se envió (minúsculas)
    code_hash   TEXT NOT NULL,                  -- hash del código, jamás el código en claro
    expira_en   TIMESTAMPTZ NOT NULL,           -- típicamente now() + 10 minutos
    intentos    INT NOT NULL DEFAULT 0,         -- limita reintentos de verificación
    usado       BOOLEAN NOT NULL DEFAULT FALSE, -- un código vale una sola vez
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_otps_correo ON field_otps (correo);

-- 3) Vincular cada captura con el usuario real -----------------------------
--    Se conserva la columna pasante (texto libre) por compatibilidad durante
--    la transición; lo nuevo va por user_id.
ALTER TABLE field_notes ADD COLUMN IF NOT EXISTS user_id INT REFERENCES field_users (id);
CREATE INDEX IF NOT EXISTS idx_field_notes_user ON field_notes (user_id);
