-- Reset datos de muestra — Terminal Tunja
-- CUIDADO: borra todas las rutas, operadores y datos asociados
-- Ejecutar en la consola de Neon

TRUNCATE TABLE route_trips    CASCADE;
TRUNCATE TABLE route_fares    CASCADE;
TRUNCATE TABLE route_shapes   CASCADE;
TRUNCATE TABLE route_stops    CASCADE;
TRUNCATE TABLE route_tasks    CASCADE;
TRUNCATE TABLE routes         CASCADE;
TRUNCATE TABLE operators      CASCADE;
TRUNCATE TABLE terminal_routes CASCADE;
