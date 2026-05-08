// API: route-shapes — geometría de rutas generada con Valhalla
//
// Schema: tabla route_shapes (definida en scripts/migrate_v3.sql)
//   - geojson JSONB: el trazado completo como FeatureCollection o LineString
//   - distancia_km: longitud total
//   - generado_con: 'valhalla' | 'manual' | 'osm'
//   - valhalla_waypoints: JSONB con los puntos de corrección extras (opt)
//
// Endpoints:
//   GET    /api/route-shapes?route_id=N    -> trazado actual de la ruta (más reciente)
//   POST   /api/route-shapes               -> upsert: reemplaza trazado existente
//   DELETE /api/route-shapes?route_id=N    -> elimina el trazado

const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    if (req.method === 'GET')    return handleGet(sql, req, res);
    if (req.method === 'POST')   return handlePost(sql, req, res);
    if (req.method === 'DELETE') return handleDelete(sql, req, res);
    return res.status(405).json({ error: 'Método no permitido' });
};

async function handleGet(sql, req, res) {
    const { route_id, region } = req.query;

    // Listado por región: trae el shape vigente de cada ruta de esa región.
    // Usa DISTINCT ON para quedarse con la fila más reciente por route_id.
    if (region && !route_id) {
        const rows = await sql`
            SELECT DISTINCT ON (rs.route_id)
                rs.id, rs.route_id, rs.geojson, rs.distancia_km, rs.generado_con,
                rs.valhalla_waypoints, rs.creada_en
            FROM route_shapes rs
            JOIN routes r ON r.id = rs.route_id
            WHERE r.region_id = ${region}
            ORDER BY rs.route_id, rs.creada_en DESC
        `;
        return res.json({ shapes: rows, total: rows.length });
    }

    if (!route_id) return res.status(400).json({ error: 'Falta route_id o region' });

    const rows = await sql`
        SELECT id, route_id, geojson, distancia_km, generado_con,
               valhalla_waypoints, creada_en
        FROM route_shapes
        WHERE route_id = ${route_id}
        ORDER BY creada_en DESC
        LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: 'Sin trazado' });
    return res.json(rows[0]);
}

async function handlePost(sql, req, res) {
    const {
        route_id,
        geojson,
        distancia_km,
        valhalla_waypoints = null,
        generado_con = 'valhalla',
    } = req.body || {};

    if (!route_id) return res.status(400).json({ error: 'Falta route_id' });
    if (!geojson)  return res.status(400).json({ error: 'Falta geojson' });

    try {
        // Upsert simple: borra los shapes previos de esta ruta y crea uno nuevo.
        await sql`DELETE FROM route_shapes WHERE route_id = ${route_id}`;
        const [row] = await sql`
            INSERT INTO route_shapes
                (route_id, geojson, distancia_km, generado_con, valhalla_waypoints)
            VALUES
                (${route_id}, ${JSON.stringify(geojson)}, ${distancia_km || null},
                 ${generado_con}, ${valhalla_waypoints ? JSON.stringify(valhalla_waypoints) : null})
            RETURNING id
        `;
        return res.json({ ok: true, id: row.id });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

async function handleDelete(sql, req, res) {
    const { route_id } = req.query;
    if (!route_id) return res.status(400).json({ error: 'Falta route_id' });
    try {
        await sql`DELETE FROM route_shapes WHERE route_id = ${route_id}`;
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
