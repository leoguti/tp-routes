// API: places — catálogo humano de lugares (paradas conceptuales con lat/lon)
//
// Consume el esquema definido en scripts/migrate_v4_places.sql.
// Independiente de `stops` (cache OSM): aquí los lugares los crea el usuario.
//
// Endpoints:
//   GET    /api/places?region=boyaca           -> listado completo (orden alfabético)
//   GET    /api/places?region=boyaca&q=paip    -> autocomplete (match por nombre normalizado)
//   GET    /api/places?id=123                  -> detalle
//   POST   /api/places                         -> crea (nombre + lat + lon obligatorios)
//   PUT    /api/places?id=123                  -> actualiza
//   DELETE /api/places?id=123                  -> elimina (SET NULL en referencias)

const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === 'GET')    return handleGet(sql, req, res);
    if (req.method === 'POST')   return handlePost(sql, req, res);
    if (req.method === 'PUT')    return handlePut(sql, req, res);
    if (req.method === 'DELETE') return handleDelete(sql, req, res);
    return res.status(405).json({ error: 'Método no permitido' });
};

async function handleGet(sql, req, res) {
    const { region = 'boyaca', id, q, limit = 20 } = req.query;

    if (id) {
        const rows = await sql`
            SELECT id, region_id, nombre, lat, lon, municipio, notas, creada_en, actualizada_en
            FROM places WHERE id = ${id}
        `;
        if (!rows.length) return res.status(404).json({ error: 'Lugar no encontrado' });
        return res.json(rows[0]);
    }

    if (q && q.trim()) {
        // Autocomplete: match por prefijo en nombre normalizado.
        const term = q.trim();
        const rows = await sql`
            SELECT id, nombre, lat, lon, municipio
            FROM places
            WHERE region_id = ${region}
              AND norm_text(nombre) LIKE norm_text(${term}) || '%'
            ORDER BY nombre
            LIMIT ${Math.min(+limit || 20, 50)}
        `;
        return res.json({ places: rows });
    }

    const rows = await sql`
        SELECT id, nombre, lat, lon, municipio, notas, creada_en
        FROM places
        WHERE region_id = ${region}
        ORDER BY nombre
    `;
    return res.json({ places: rows, total: rows.length });
}

async function handlePost(sql, req, res) {
    const {
        region_id = 'boyaca',
        nombre,
        lat,
        lon,
        municipio,
        notas,
    } = req.body || {};

    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre es obligatorio' });
    if (typeof lat !== 'number' || typeof lon !== 'number')
        return res.status(400).json({ error: 'lat y lon son obligatorios y deben ser números' });

    try {
        const [row] = await sql`
            INSERT INTO places (region_id, nombre, lat, lon, municipio, notas)
            VALUES (${region_id}, ${nombre.trim()}, ${lat}, ${lon},
                    ${municipio?.trim() || null}, ${notas?.trim() || null})
            RETURNING id, nombre, lat, lon, municipio
        `;
        // Auto-vincular: rutas/waypoints que estaban como sólo texto y coinciden
        // por nombre normalizado pasan a apuntar a este nuevo place.
        const linked = await autoLinkPlace(sql, row.id, row.nombre, region_id);
        return res.json({ ok: true, place: row, linked });
    } catch (e) {
        // Conflicto único = ya existe ese nombre normalizado en la región.
        if (/duplicate key|unique/i.test(e.message)) {
            const [existing] = await sql`
                SELECT id, nombre, lat, lon, municipio
                FROM places
                WHERE region_id = ${region_id}
                  AND norm_text(nombre) = norm_text(${nombre.trim()})
            `;
            return res.status(409).json({
                error: 'Ya existe un lugar con ese nombre en la región',
                existing,
            });
        }
        return res.status(500).json({ error: e.message });
    }
}

// Vincula todas las rutas/waypoints que tenían `nombre_text` igual al nombre
// del place y aún no tenían place_id. Devuelve cuántas filas se enlazaron.
async function autoLinkPlace(sql, placeId, nombre, regionId) {
    const wp = await sql`
        UPDATE route_waypoints w
        SET place_id = ${placeId}
        FROM routes r
        WHERE w.route_id = r.id
          AND w.place_id IS NULL
          AND r.region_id = ${regionId}
          AND norm_text(w.nombre_text) = norm_text(${nombre})
    `;
    const og = await sql`
        UPDATE routes
        SET origen_place_id = ${placeId}
        WHERE origen_place_id IS NULL
          AND region_id = ${regionId}
          AND norm_text(origen_text) = norm_text(${nombre})
    `;
    const ds = await sql`
        UPDATE routes
        SET destino_place_id = ${placeId}
        WHERE destino_place_id IS NULL
          AND region_id = ${regionId}
          AND norm_text(destino_text) = norm_text(${nombre})
    `;
    return {
        waypoints: wp.count ?? wp.rowCount ?? 0,
        origenes:  og.count ?? og.rowCount ?? 0,
        destinos:  ds.count ?? ds.rowCount ?? 0,
    };
}

async function handlePut(sql, req, res) {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });
    const { nombre, lat, lon, municipio, notas } = req.body || {};

    if (!nombre?.trim()) return res.status(400).json({ error: 'nombre es obligatorio' });
    if (typeof lat !== 'number' || typeof lon !== 'number')
        return res.status(400).json({ error: 'lat y lon son obligatorios y deben ser números' });

    try {
        const [row] = await sql`
            UPDATE places SET
                nombre = ${nombre.trim()},
                lat = ${lat}, lon = ${lon},
                municipio = ${municipio?.trim() || null},
                notas = ${notas?.trim() || null},
                actualizada_en = NOW()
            WHERE id = ${id}
            RETURNING id, nombre, lat, lon, municipio
        `;
        if (!row) return res.status(404).json({ error: 'Lugar no encontrado' });
        return res.json({ ok: true, place: row });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

async function handleDelete(sql, req, res) {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Falta id' });
    try {
        const r = await sql`DELETE FROM places WHERE id = ${id}`;
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
