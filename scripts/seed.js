/**
 * seed.js — Carga un JSON de rutas (formato FORMATO_JSON.md) a la base.
 *
 *   node scripts/seed.js data/rutas_boyaca.json           # upsert
 *   node scripts/seed.js data/rutas_boyaca.json --reset   # TRUNCATE primero
 *
 * Contrato de la entrada:
 *   {
 *     "region": "boyaca",
 *     "operadores": [ { nombre, nombre_corto?, telefono?, email?, url? }, ... ],
 *     "rutas":      [ { origen, destino, via[], operador, resoluciones[], ref?, notas? }, ... ]
 *   }
 *
 * Para cada entrada de `rutas` genera 2 filas en `routes` (ida + vuelta con
 * vía espejo), unidas por route_parent_id. Las resoluciones apuntan a la fila
 * de ida (la vuelta las consulta a través del padre).
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const file = process.argv[2];
const reset = process.argv.includes('--reset');

if (!file) {
    console.error('Uso: node scripts/seed.js <archivo.json> [--reset]');
    process.exit(1);
}

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
    console.error(`No existe: ${abs}`);
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(abs, 'utf8'));

// ---------- Validación ----------
function fail(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

if (!data.region) fail('Falta "region" en la raíz');
if (!Array.isArray(data.operadores)) fail('"operadores" debe ser array');
if (!Array.isArray(data.rutas))      fail('"rutas" debe ser array');

function norm(t) {
    return String(t ?? '')
        .trim()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

// Dedup operadores por norm(nombre)
const opNormSet = new Set();
for (const o of data.operadores) {
    if (!o.nombre?.trim()) fail('Operador sin nombre');
    const n = norm(o.nombre);
    if (opNormSet.has(n)) fail(`Operador duplicado: ${o.nombre}`);
    opNormSet.add(n);
}

// Validar rutas + dedup por clave única dentro del archivo
const routeKeys = new Set();
for (const [i, r] of data.rutas.entries()) {
    const ctx = `rutas[${i}]`;
    if (!r.origen?.trim())   fail(`${ctx}: falta "origen"`);
    if (!r.destino?.trim())  fail(`${ctx}: falta "destino"`);
    if (!Array.isArray(r.via))  fail(`${ctx}: "via" debe ser array (vacío = directo)`);
    if (!r.operador?.trim()) fail(`${ctx}: falta "operador"`);
    if (!Array.isArray(r.resoluciones)) fail(`${ctx}: "resoluciones" debe ser array`);

    if (norm(r.origen) === norm(r.destino))
        fail(`${ctx}: origen y destino son la misma ciudad (${r.origen})`);

    // Sanitización tolerante: si la vía contiene el origen o destino,
    // lo quitamos en vez de abortar (datos fuente con errores de captura).
    const oN = norm(r.origen), dN = norm(r.destino);
    const before = r.via.length;
    r.via = r.via.filter(v => {
        const n = norm(v);
        return n !== oN && n !== dN;
    });
    if (before !== r.via.length) {
        console.warn(`  aviso ${ctx}: la vía contenía origen/destino y se sanitizó. ${r.origen} → ${r.destino} vía [${r.via.join(', ')}] (${r.operador})`);
    }

    const viaNorms = r.via.map(norm);

    if (!opNormSet.has(norm(r.operador)))
        fail(`${ctx}: operador "${r.operador}" no está en la sección "operadores"`);

    const key = [norm(r.origen), norm(r.destino), viaNorms.join('|'), norm(r.operador)].join('::');
    if (routeKeys.has(key)) fail(`${ctx}: ruta duplicada (${r.origen} → ${r.destino} vía [${r.via}] ${r.operador})`);
    routeKeys.add(key);
}

console.log(`JSON válido: ${data.operadores.length} operadores, ${data.rutas.length} rutas conceptuales.`);

// ---------- Carga ----------
async function main() {
    if (!process.env.DATABASE_URL) fail('Falta DATABASE_URL en .env.local');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    try {
        await client.query('BEGIN');

        if (reset) {
            console.log('--reset: borrando rutas, waypoints, resoluciones y operadores...');
            await client.query(`
                TRUNCATE route_tasks, route_trips, route_fares, route_shapes,
                         route_stops, route_waypoints, route_resolutions,
                         routes, operators
                RESTART IDENTITY CASCADE
            `);
        }

        // --- Operadores: upsert por (region_id, norm_text(nombre)) ---
        const opIdByNorm = new Map();
        for (const o of data.operadores) {
            const res = await client.query(
                `INSERT INTO operators (region_id, nombre, nombre_corto, telefono, email, url)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (region_id, norm_text(nombre)) DO UPDATE SET
                     nombre_corto  = COALESCE(EXCLUDED.nombre_corto,  operators.nombre_corto),
                     telefono      = COALESCE(EXCLUDED.telefono,      operators.telefono),
                     email         = COALESCE(EXCLUDED.email,         operators.email),
                     url           = COALESCE(EXCLUDED.url,           operators.url),
                     actualizada_en = NOW()
                 RETURNING id, nombre`,
                [data.region, o.nombre, o.nombre_corto || null, o.telefono || null, o.email || null, o.url || null]
            );
            opIdByNorm.set(norm(o.nombre), res.rows[0].id);
        }
        console.log(`Operadores: ${opIdByNorm.size} cargados.`);

        // --- Rutas + waypoints + resoluciones ---
        let creadas = 0, actualizadas = 0, totalRes = 0;

        for (const r of data.rutas) {
            const operatorId = opIdByNorm.get(norm(r.operador));
            const viaIda = r.via;
            const viaVuelta = [...r.via].reverse();

            // Buscar ida existente por clave (region, operator, norm(origen), norm(destino), direction='ida')
            // + verificación de que los waypoints coincidan normalizados.
            const idaId = await upsertRoute(client, {
                region_id: data.region,
                operator_id: operatorId,
                origen_text: r.origen,
                destino_text: r.destino,
                direction: 'ida',
                route_parent_id: null,
                ref: r.ref || null,
                notas: r.notas || null,
                via: viaIda,
            });

            // Vuelta apuntando a la ida
            const vueltaId = await upsertRoute(client, {
                region_id: data.region,
                operator_id: operatorId,
                origen_text: r.destino,
                destino_text: r.origen,
                direction: 'vuelta',
                route_parent_id: idaId.id,
                ref: r.ref || null,
                notas: r.notas || null,
                via: viaVuelta,
            });

            if (idaId.inserted) creadas++; else actualizadas++;
            if (vueltaId.inserted) creadas++; else actualizadas++;

            // Resoluciones: apuntan a la ida. Se reemplazan completamente en cada carga.
            await client.query(`DELETE FROM route_resolutions WHERE route_id = $1`, [idaId.id]);
            for (let idx = 0; idx < r.resoluciones.length; idx++) {
                const res = r.resoluciones[idx];
                await client.query(
                    `INSERT INTO route_resolutions
                        (route_id, orden, numero, fecha, texto_original, pdf_url, pdf_key, notas)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        idaId.id, idx + 1,
                        res.numero || '(sin número)',
                        res.fecha || null,
                        res.texto_original || null,
                        res.pdf_url || null,
                        res.pdf_key || null,
                        res.notas || null,
                    ]
                );
                totalRes++;
            }
        }

        await client.query('COMMIT');
        console.log(`\nRutas: ${creadas} creadas, ${actualizadas} actualizadas.`);
        console.log(`Resoluciones: ${totalRes} registradas.`);

        // Verificación rápida
        const check = await client.query(`
            SELECT
                (SELECT COUNT(*) FROM operators         WHERE region_id=$1) AS operators,
                (SELECT COUNT(*) FROM routes            WHERE region_id=$1) AS routes,
                (SELECT COUNT(*) FROM route_waypoints)  AS waypoints,
                (SELECT COUNT(*) FROM route_resolutions) AS resoluciones
        `, [data.region]);
        console.log('\nEstado final:', check.rows[0]);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Fallo:', e.message);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

async function upsertRoute(client, r) {
    // Intentar encontrar una fila que coincida en (region, operator, norm(origen), norm(destino), direction)
    // y además cuyos waypoints normalizados coincidan.
    const cand = await client.query(`
        SELECT r.id,
               COALESCE(array_agg(
                   norm_text(w.nombre_text) ORDER BY w.orden
               ) FILTER (WHERE w.id IS NOT NULL), ARRAY[]::text[]) AS via_norm
        FROM routes r
        LEFT JOIN route_waypoints w ON w.route_id = r.id
        WHERE r.region_id   = $1
          AND r.operator_id = $2
          AND norm_text(r.origen_text)  = norm_text($3)
          AND norm_text(r.destino_text) = norm_text($4)
          AND r.direction   = $5
        GROUP BY r.id
    `, [r.region_id, r.operator_id, r.origen_text, r.destino_text, r.direction]);

    const viaNorm = r.via.map(v => norm(v));
    const match = cand.rows.find(row =>
        row.via_norm.length === viaNorm.length &&
        row.via_norm.every((v, i) => v === viaNorm[i])
    );

    if (match) {
        await client.query(
            `UPDATE routes SET
                ref = COALESCE($1, ref),
                notas = COALESCE($2, notas),
                route_parent_id = $3,
                actualizada_en = NOW()
             WHERE id = $4`,
            [r.ref, r.notas, r.route_parent_id, match.id]
        );
        // Reemplazar waypoints
        await client.query(`DELETE FROM route_waypoints WHERE route_id = $1`, [match.id]);
        for (let i = 0; i < r.via.length; i++) {
            await client.query(
                `INSERT INTO route_waypoints (route_id, orden, nombre_text) VALUES ($1, $2, $3)`,
                [match.id, i + 1, r.via[i]]
            );
        }
        return { id: match.id, inserted: false };
    }

    const ins = await client.query(
        `INSERT INTO routes (region_id, operator_id, origen_text, destino_text,
                             direction, route_parent_id, ref, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [r.region_id, r.operator_id, r.origen_text, r.destino_text,
         r.direction, r.route_parent_id, r.ref, r.notas]
    );
    const routeId = ins.rows[0].id;

    for (let i = 0; i < r.via.length; i++) {
        await client.query(
            `INSERT INTO route_waypoints (route_id, orden, nombre_text) VALUES ($1, $2, $3)`,
            [routeId, i + 1, r.via[i]]
        );
    }
    return { id: routeId, inserted: true };
}

main();
