// API: routes — esquema v3.0 (listado maestro jerárquico)
//
// Consume el esquema definido en scripts/migrate_v3.sql + scripts/migrate_v4_places.sql:
//   - routes con origen_text/destino_text, direction y origen_place_id/destino_place_id.
//   - route_waypoints como lista ordenada de ciudades intermedias, cada una con
//     nombre_text + place_id opcional (link al catálogo `places`).
//   - route_resolutions (apuntan a la ida; la vuelta las lee a través de route_parent_id).
//
// Endpoints:
//   GET /api/routes?region=boyaca                 -> listado plano + stats
//   GET /api/routes?region=boyaca&grouped=1       -> estructura jerárquica ya agrupada
//   GET /api/routes?id=123                        -> detalle + waypoints + resoluciones
//   POST /api/routes                              -> crea ruta (ida + vuelta automático)
//   PUT  /api/routes?id=123                       -> actualiza (afecta ida + vuelta)
//   DELETE /api/routes?id=123                     -> elimina ambas direcciones

const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === 'GET')    return handleGet(sql, req, res);
    if (req.method === 'POST')   return handlePost(sql, req, res);
    if (req.method === 'PUT')    return handlePut(sql, req, res);
    if (req.method === 'DELETE') return handleDelete(sql, req, res);
    return res.status(405).json({ error: 'Método no permitido' });
};

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
async function handleGet(sql, req, res) {
    const { region = 'boyaca', id, grouped } = req.query;

    if (id) {
        // Detalle de una ruta (incluye waypoints, resoluciones y la otra dirección)
        const rows = await sql`
            SELECT r.*, o.nombre AS operator_nombre
            FROM routes r
            LEFT JOIN operators o ON o.id = r.operator_id
            WHERE r.id = ${id}
        `;
        if (!rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });
        const route = rows[0];

        const waypoints = await sql`
            SELECT w.id, w.orden, w.nombre_text, w.stop_id, w.place_id,
                   p.nombre AS place_nombre, p.lat AS place_lat, p.lon AS place_lon,
                   p.municipio AS place_municipio
            FROM route_waypoints w
            LEFT JOIN places p ON p.id = w.place_id
            WHERE w.route_id = ${id} ORDER BY w.orden
        `;

        // Resoluciones viven en la ida (route_parent_id = NULL). La vuelta las
        // busca a través de su padre.
        const idaId = route.route_parent_id ?? route.id;
        const resoluciones = await sql`
            SELECT id, orden, numero, fecha, texto_original, pdf_url, pdf_key, notas
            FROM route_resolutions WHERE route_id = ${idaId} ORDER BY orden
        `;

        const pair = await sql`
            SELECT id, direction, origen_text, destino_text
            FROM routes
            WHERE id = ${route.route_parent_id ?? 0}
               OR route_parent_id = ${route.id}
               OR id = ${route.id}
            ORDER BY direction
        `;

        return res.json({ ...route, waypoints, resoluciones, pair });
    }

    // Lista: trae todas las rutas de la región con sus waypoints + resoluciones agregados
    const rows = await sql`
        SELECT
            r.id, r.region_id, r.operator_id,
            r.origen_text, r.destino_text,
            r.origen_stop_id, r.destino_stop_id,
            r.origen_place_id, r.destino_place_id,
            po.nombre AS origen_place_nombre, po.lat AS origen_place_lat, po.lon AS origen_place_lon,
            pd.nombre AS destino_place_nombre, pd.lat AS destino_place_lat, pd.lon AS destino_place_lon,
            r.direction, r.route_parent_id,
            r.ref, r.notas, r.progreso_pct,
            r.osm_relation_id, r.creada_en, r.actualizada_en,
            o.nombre AS operator_nombre,
            COALESCE((
                SELECT json_agg(json_build_object(
                    'orden', w.orden,
                    'nombre_text', w.nombre_text,
                    'stop_id', w.stop_id,
                    'place_id', w.place_id,
                    'place_nombre', p.nombre,
                    'place_lat', p.lat,
                    'place_lon', p.lon
                ) ORDER BY w.orden)
                FROM route_waypoints w
                LEFT JOIN places p ON p.id = w.place_id
                WHERE w.route_id = r.id
            ), '[]'::json) AS waypoints,
            COALESCE((
                SELECT json_agg(json_build_object(
                    'id', rr.id, 'numero', rr.numero, 'fecha', rr.fecha,
                    'texto_original', rr.texto_original, 'pdf_url', rr.pdf_url
                ) ORDER BY rr.orden)
                FROM route_resolutions rr
                WHERE rr.route_id = COALESCE(r.route_parent_id, r.id)
            ), '[]'::json) AS resoluciones,
            EXISTS (SELECT 1 FROM route_shapes rs WHERE rs.route_id = r.id) AS has_shape
        FROM routes r
        LEFT JOIN operators o  ON o.id  = r.operator_id
        LEFT JOIN places    po ON po.id = r.origen_place_id
        LEFT JOIN places    pd ON pd.id = r.destino_place_id
        WHERE r.region_id = ${region}
        ORDER BY r.origen_text, r.destino_text, o.nombre, r.direction
    `;

    // Derivar estado desde progreso_pct + osm_relation_id
    for (const r of rows) {
        if (r.progreso_pct >= 100 && r.osm_relation_id) r.estado = 'publicada';
        else if (r.progreso_pct >= 81) r.estado = 'aprobada';
        else if (r.progreso_pct >= 21) r.estado = 'en_progreso';
        else r.estado = 'borrador';
    }

    const stats = {
        total: rows.length,
        borrador:    rows.filter(r => r.estado === 'borrador').length,
        en_progreso: rows.filter(r => r.estado === 'en_progreso').length,
        aprobada:    rows.filter(r => r.estado === 'aprobada').length,
        publicada:   rows.filter(r => r.estado === 'publicada').length,
        promedio_progreso: rows.length
            ? Math.round(rows.reduce((s, r) => s + (r.progreso_pct || 0), 0) / rows.length)
            : 0,
    };

    if (grouped) {
        return res.json({ ...stats, groups: groupRoutes(rows) });
    }
    return res.json({ ...stats, routes: rows });
}

// Agrupa: { par-no-dirigido → vía → operador → [ida, vuelta] }
function groupRoutes(rows) {
    const norm = s => String(s ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    // Helper: extrae el place del lado A o B de una fila concreta.
    // origen_place_* puede ser de A (si la ruta parte de A) o de B (si parte de B).
    function placeOfSide(r, sideName) {
        if (norm(r.origen_text) === norm(sideName) && r.origen_place_id) {
            return { id: r.origen_place_id, nombre: r.origen_place_nombre, lat: r.origen_place_lat, lon: r.origen_place_lon };
        }
        if (norm(r.destino_text) === norm(sideName) && r.destino_place_id) {
            return { id: r.destino_place_id, nombre: r.destino_place_nombre, lat: r.destino_place_lat, lon: r.destino_place_lon };
        }
        return null;
    }

    // 1) Agrupar por par no-dirigido: orden alfabético de (origen, destino)
    //    para que Tunja→Sogamoso y Sogamoso→Tunja compartan grupo.
    const byPair = new Map();
    for (const r of rows) {
        const [a, b] = [r.origen_text, r.destino_text].sort((x, y) => norm(x).localeCompare(norm(y)));
        const pairKey = `${norm(a)}::${norm(b)}`;
        if (!byPair.has(pairKey)) byPair.set(pairKey, {
            cityA: a, cityB: b,
            cityA_place: null, cityB_place: null,
            vias: new Map(),
        });

        const pair = byPair.get(pairKey);
        // Asignar place del lado si todavía no se ha encontrado en otra fila
        if (!pair.cityA_place) pair.cityA_place = placeOfSide(r, a);
        if (!pair.cityB_place) pair.cityB_place = placeOfSide(r, b);

        // Normalizar la vía "canónica" para este par: ordenar según la ida
        // (route_parent_id IS NULL). Para la vuelta, invertimos para que caiga
        // en el mismo grupo que la ida.
        // Canónico = orden cityA → cityB. Si la fila parte de cityB (sea ida o
        // vuelta), invertimos los waypoints para mantener coherencia en el diagrama.
        const partFromA = norm(r.origen_text) === norm(a);
        const canonicalWaypoints = partFromA ? r.waypoints : [...r.waypoints].reverse();
        const viaKey = canonicalWaypoints.map(w => norm(w.nombre_text)).join('>');
        const viaLabel = canonicalWaypoints.length
            ? 'vía ' + canonicalWaypoints.map(w => w.nombre_text).join(' → ')
            : 'Directo';

        if (!pair.vias.has(viaKey)) pair.vias.set(viaKey, {
            via_label: viaLabel,
            via: canonicalWaypoints,         // array de {nombre_text, place_id, place_nombre, place_lat, place_lon}
            operadores: new Map(),
        });
        const viaGroup = pair.vias.get(viaKey);

        const opKey = r.operator_id;
        if (!viaGroup.operadores.has(opKey)) {
            viaGroup.operadores.set(opKey, {
                operator_id: r.operator_id,
                operator_nombre: r.operator_nombre,
                ida: null, vuelta: null,
                resoluciones: r.resoluciones,
                ref: r.ref, notas: r.notas,
            });
        }
        viaGroup.operadores.get(opKey)[r.direction] = r;
    }

    // Serializar Maps a arrays para JSON
    const groups = [];
    for (const { cityA, cityB, cityA_place, cityB_place, vias } of byPair.values()) {
        const viasOut = [];
        for (const { via_label, via, operadores } of vias.values()) {
            const opsOut = [...operadores.values()];
            viasOut.push({
                via_label, via,
                operadores: opsOut,
                rutas: opsOut.length * 2,
            });
        }
        // Orden: Directo primero, luego alfabético
        viasOut.sort((a, b) =>
            a.via_label === 'Directo' ? -1 : b.via_label === 'Directo' ? 1
            : a.via_label.localeCompare(b.via_label));

        groups.push({
            pair_label: `${cityA} ↔ ${cityB}`,
            cityA, cityB,
            cityA_place, cityB_place,
            vias: viasOut,
            total_rutas: viasOut.reduce((s, v) => s + v.rutas, 0),
            total_operadores: new Set(
                viasOut.flatMap(v => v.operadores.map(o => o.operator_id))
            ).size,
        });
    }
    groups.sort((a, b) => a.pair_label.localeCompare(b.pair_label));
    return groups;
}

// Normaliza un item de `via`. Acepta:
//   - string                          → {nombre, place_id: null}
//   - { nombre, place_id }            → tal cual
function viaItem(v) {
    if (typeof v === 'string') return { nombre: v.trim(), place_id: null };
    if (v && typeof v === 'object') {
        return {
            nombre: String(v.nombre ?? '').trim(),
            place_id: v.place_id ? +v.place_id : null,
        };
    }
    return { nombre: '', place_id: null };
}

// ---------------------------------------------------------------------------
// POST — crea ruta conceptual (ida + vuelta automática)
// ---------------------------------------------------------------------------
async function handlePost(sql, req, res) {
    const {
        region_id = 'boyaca',
        operator_id,
        origen, destino,
        origen_place_id  = null,
        destino_place_id = null,
        via = [],
        ref, notas,
        resoluciones = [],
    } = req.body || {};

    if (!operator_id || !origen?.trim() || !destino?.trim())
        return res.status(400).json({ error: 'operator_id, origen y destino son obligatorios' });
    if (!Array.isArray(via)) return res.status(400).json({ error: 'via debe ser array' });

    const viaNorm = via.map(viaItem).filter(v => v.nombre);

    try {
        const [ida] = await sql`
            INSERT INTO routes (
                region_id, operator_id,
                origen_text, destino_text,
                origen_place_id, destino_place_id,
                direction, ref, notas
            )
            VALUES (
                ${region_id}, ${operator_id},
                ${origen.trim()}, ${destino.trim()},
                ${origen_place_id || null}, ${destino_place_id || null},
                'ida', ${ref || null}, ${notas || null}
            )
            RETURNING id
        `;
        const [vuelta] = await sql`
            INSERT INTO routes (
                region_id, operator_id,
                origen_text, destino_text,
                origen_place_id, destino_place_id,
                direction, route_parent_id, ref, notas
            )
            VALUES (
                ${region_id}, ${operator_id},
                ${destino.trim()}, ${origen.trim()},
                ${destino_place_id || null}, ${origen_place_id || null},
                'vuelta', ${ida.id}, ${ref || null}, ${notas || null}
            )
            RETURNING id
        `;

        for (let i = 0; i < viaNorm.length; i++) {
            const f = viaNorm[i];
            const r = viaNorm[viaNorm.length - 1 - i];
            await sql`
                INSERT INTO route_waypoints (route_id, orden, nombre_text, place_id)
                VALUES (${ida.id}, ${i + 1}, ${f.nombre}, ${f.place_id})
            `;
            await sql`
                INSERT INTO route_waypoints (route_id, orden, nombre_text, place_id)
                VALUES (${vuelta.id}, ${i + 1}, ${r.nombre}, ${r.place_id})
            `;
        }
        for (let i = 0; i < resoluciones.length; i++) {
            const r = resoluciones[i];
            await sql`
                INSERT INTO route_resolutions (route_id, orden, numero, fecha, texto_original, pdf_url, pdf_key, notas)
                VALUES (${ida.id}, ${i + 1}, ${r.numero}, ${r.fecha || null}, ${r.texto_original || null}, ${r.pdf_url || null}, ${r.pdf_key || null}, ${r.notas || null})
            `;
        }

        return res.json({ ok: true, id_ida: ida.id, id_vuelta: vuelta.id });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ---------------------------------------------------------------------------
// PUT — actualiza la ruta conceptual. El id puede ser el de ida o vuelta;
// el cambio se propaga al par completo.
// ---------------------------------------------------------------------------
async function handlePut(sql, req, res) {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });
    const {
        operator_id, origen, destino,
        origen_place_id  = null,
        destino_place_id = null,
        via = [], ref, notas, resoluciones,
    } = req.body || {};

    if (!operator_id || !origen?.trim() || !destino?.trim())
        return res.status(400).json({ error: 'operator_id, origen y destino son obligatorios' });

    const viaNorm = via.map(viaItem).filter(v => v.nombre);

    try {
        const [row] = await sql`SELECT id, route_parent_id FROM routes WHERE id = ${id}`;
        if (!row) return res.status(404).json({ error: 'Ruta no encontrada' });
        const idaId = row.route_parent_id ?? row.id;
        const [vuelta] = await sql`SELECT id FROM routes WHERE route_parent_id = ${idaId}`;

        await sql`
            UPDATE routes SET
                operator_id = ${operator_id},
                origen_text = ${origen.trim()}, destino_text = ${destino.trim()},
                origen_place_id  = ${origen_place_id  || null},
                destino_place_id = ${destino_place_id || null},
                ref = ${ref || null}, notas = ${notas || null},
                actualizada_en = NOW()
            WHERE id = ${idaId}
        `;
        if (vuelta) {
            await sql`
                UPDATE routes SET
                    operator_id = ${operator_id},
                    origen_text = ${destino.trim()}, destino_text = ${origen.trim()},
                    origen_place_id  = ${destino_place_id || null},
                    destino_place_id = ${origen_place_id  || null},
                    ref = ${ref || null}, notas = ${notas || null},
                    actualizada_en = NOW()
                WHERE id = ${vuelta.id}
            `;
        }

        // Reemplazar waypoints en ambas direcciones
        await sql`DELETE FROM route_waypoints WHERE route_id = ${idaId}`;
        if (vuelta) await sql`DELETE FROM route_waypoints WHERE route_id = ${vuelta.id}`;
        for (let i = 0; i < viaNorm.length; i++) {
            const f = viaNorm[i];
            const r = viaNorm[viaNorm.length - 1 - i];
            await sql`
                INSERT INTO route_waypoints (route_id, orden, nombre_text, place_id)
                VALUES (${idaId}, ${i + 1}, ${f.nombre}, ${f.place_id})
            `;
            if (vuelta) await sql`
                INSERT INTO route_waypoints (route_id, orden, nombre_text, place_id)
                VALUES (${vuelta.id}, ${i + 1}, ${r.nombre}, ${r.place_id})
            `;
        }

        // Reemplazar resoluciones si el cliente las envía. Si el campo no viene
        // (undefined), no se tocan — permite actualizar sólo datos básicos.
        if (Array.isArray(resoluciones)) {
            await sql`DELETE FROM route_resolutions WHERE route_id = ${idaId}`;
            for (let i = 0; i < resoluciones.length; i++) {
                const r = resoluciones[i];
                if (!r.numero) continue;
                await sql`
                    INSERT INTO route_resolutions
                        (route_id, orden, numero, fecha, texto_original, pdf_url, pdf_key, notas)
                    VALUES (${idaId}, ${i + 1}, ${r.numero}, ${r.fecha || null},
                            ${r.texto_original || null}, ${r.pdf_url || null},
                            ${r.pdf_key || null}, ${r.notas || null})
                `;
            }
        }

        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

// ---------------------------------------------------------------------------
// DELETE — elimina ruta conceptual (ida + vuelta + waypoints + resoluciones).
// ---------------------------------------------------------------------------
async function handleDelete(sql, req, res) {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });
    try {
        const [row] = await sql`SELECT id, route_parent_id FROM routes WHERE id = ${id}`;
        if (!row) return res.status(404).json({ error: 'Ruta no encontrada' });
        const idaId = row.route_parent_id ?? row.id;
        // CASCADE en FKs se encarga de waypoints, resoluciones, vuelta.
        await sql`DELETE FROM routes WHERE id = ${idaId}`;
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
