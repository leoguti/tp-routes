// Corre la migración v6 (autenticación: field_users, field_otps, field_notes.user_id)
// contra Neon.
//
// Uso:  node scripts/migrate_v6_field_auth.js
//
// Es idempotente (CREATE/ALTER ... IF NOT EXISTS): se puede correr varias veces.
// REQUIERE que field_notes exista (corré antes migrate_v5_field_notes.js si falta).

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
    const file = path.join(__dirname, 'migrate_v6_field_auth.sql');
    const raw = fs.readFileSync(file, 'utf8');

    // Quita comentarios de línea y parte por ';'
    const statements = raw
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);

    for (const stmt of statements) {
        const label = stmt.replace(/\s+/g, ' ').slice(0, 70);
        process.stdout.write(`→ ${label}…\n`);
        await sql(stmt);
    }

    const [check] = await sql(
        `SELECT count(*) AS n FROM information_schema.tables WHERE table_name = 'field_users'`
    );
    console.log(check.n === '1' || check.n === 1
        ? '✓ Tablas de autenticación listas (field_users, field_otps, field_notes.user_id).'
        : '✗ No se encontró field_users.');
})().catch((e) => {
    console.error('Error en migración:', e.message);
    process.exit(1);
});
