// Pobla field_users con la lista cerrada de autorizados (upsert por correo).
//
// Uso:  node scripts/seed_field_users.js [ruta-al-json]
//
// IMPORTANTE: este script NO contiene datos personales. Lee un JSON privado
// que vive FUERA del repo (por defecto en
//   ~/gestion/clientes/terminal-tunja/field_users.private.json
// ), o el que pases como argumento / en FIELD_USERS_FILE.
//
// Idempotente: se puede correr varias veces. Edita el JSON y vuelve a correr
// para actualizar nombres/roles o desactivar a alguien ("activo": false).
// La desactivación es soft-delete: nunca borra filas.

const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { neon } = require('@neondatabase/serverless');

const ROLES = ['terminal', 'estudiante', 'trufi'];

(async () => {
    if (!process.env.DATABASE_URL) {
        console.error('Falta DATABASE_URL (revisa .env.local)');
        process.exit(1);
    }

    const file = process.argv[2]
        || process.env.FIELD_USERS_FILE
        || path.join(os.homedir(), 'gestion', 'clientes', 'terminal-tunja', 'field_users.private.json');

    if (!fs.existsSync(file)) {
        console.error(`No encuentro el JSON privado:\n  ${file}`);
        console.error('Pásalo como argumento o define FIELD_USERS_FILE.');
        process.exit(1);
    }

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const usuarios = Array.isArray(raw) ? raw : raw.usuarios;
    if (!Array.isArray(usuarios) || !usuarios.length) {
        console.error('El JSON no contiene una lista de usuarios.');
        process.exit(1);
    }

    const sql = neon(process.env.DATABASE_URL);
    let ok = 0;

    for (const u of usuarios) {
        const correo = String(u.correo || '').trim().toLowerCase();
        const nombre = (u.nombre || '').trim() || null;
        const rol = (u.rol || 'terminal').trim();
        const activo = u.activo !== false;  // por defecto true

        if (!correo) { console.warn('  · saltado (sin correo)'); continue; }
        if (!ROLES.includes(rol)) { console.warn(`  · saltado (rol inválido "${rol}"): ${correo}`); continue; }

        await sql`
            INSERT INTO field_users (correo, nombre, rol, activo)
            VALUES (${correo}, ${nombre}, ${rol}, ${activo})
            ON CONFLICT (correo) DO UPDATE
            SET nombre = EXCLUDED.nombre, rol = EXCLUDED.rol, activo = EXCLUDED.activo
        `;
        ok++;
        process.stdout.write(`  ✓ ${correo}  (${rol}${activo ? '' : ', inactivo'})\n`);
    }

    const resumen = await sql`
        SELECT rol, count(*)::int AS n FROM field_users WHERE activo GROUP BY rol ORDER BY rol
    `;
    console.log(`\n✓ ${ok} usuario(s) procesado(s).`);
    console.log('Activos por rol:', resumen.map((r) => `${r.rol}=${r.n}`).join('  ') || '(ninguno)');
})().catch((e) => {
    console.error('Error en el seed:', e.message);
    process.exit(1);
});
