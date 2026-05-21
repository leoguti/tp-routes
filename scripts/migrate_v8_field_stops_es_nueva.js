// Corre la migración v8 (columna es_nueva en field_stops) contra Neon.
//
// Uso:  node scripts/migrate_v8_field_stops_es_nueva.js
//
// Es idempotente (ADD COLUMN IF NOT EXISTS). Requiere field_stops (migración v7).

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { neon } = require('@neondatabase/serverless');

(async () => {
    if (!process.env.DATABASE_URL) {
        console.error('Falta DATABASE_URL (revisa .env.local)');
        process.exit(1);
    }
    const sql = neon(process.env.DATABASE_URL);
    const file = path.join(__dirname, 'migrate_v8_field_stops_es_nueva.sql');
    const raw = fs.readFileSync(file, 'utf8');

    const statements = raw
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

    for (const stmt of statements) {
        process.stdout.write(`→ ${stmt.replace(/\s+/g, ' ').slice(0, 70)}…\n`);
        await sql(stmt);
    }

    const [check] = await sql(
        `SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'field_stops' AND column_name = 'es_nueva'`
    );
    console.log(check.n === '1' || check.n === 1
        ? '✓ Columna field_stops.es_nueva lista.'
        : '✗ No se encontró la columna es_nueva.');
})().catch((e) => {
    console.error('Error en migración:', e.message);
    process.exit(1);
});
