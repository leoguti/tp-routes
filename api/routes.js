// API: routes — lista maestra + CRUD
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);

    // GET — lista con filtros y progreso
    if (req.method === 'GET') {
        const { region = 'boyaca', estado, operator_id, search, id } = req.query;

        // Detalle de una ruta
        if (id) {
            const rows = await sql`
                SELECT r.*, o.nombre AS operator_nombre, o.telefono AS operator_telefono, o.url AS operator_url,
                       (SELECT json_agg(t ORDER BY t.tipo) FROM route_tasks t WHERE t.route_id = r.id) AS tasks,
                       (SELECT COUNT(*) FROM route_stops  WHERE route_id = r.id)::int AS stops_count,
                       (SELECT COUNT(*) FROM route_shapes WHERE route_id = r.id)::int AS shapes_count,
                       (SELECT COUNT(*) FROM route_fares  WHERE route_id = r.id)::int AS fares_count,
                       (SELECT COUNT(*) FROM route_trips  WHERE route_id = r.id)::int AS trips_count
                FROM routes r
                LEFT JOIN operators o ON o.id = r.operator_id
                WHERE r.id = ${id}
            `;
            if (!rows.length) return res.status(404).json({ error: 'Ruta no encontrada' });
            return res.json(rows[0]);
        }

        let query = `
            SELECT r.id, r.origen, r.destino, r.ref, r.direction, r.estado, r.progreso_pct,
                   r.osm_relation_id, r.terminal_route_id, r.creada_en, r.actualizada_en,
                   r.responsable_id, r.color, r.tipo_servicio, r.operator_id,
                   o.nombre AS operator_nombre,
                   (SELECT COUNT(*) FROM route_tasks t WHERE t.route_id = r.id AND t.estado != 'completada') AS tareas_pendientes
            FROM routes r
            LEFT JOIN operators o ON o.id = r.operator_id
            WHERE r.region_id = $1
        `;
        const params = [region]; let idx = 2;

        if (estado) { query += ` AND r.estado = $${idx++}`; params.push(estado); }
        if (operator_id) { query += ` AND r.operator_id = $${idx++}`; params.push(operator_id); }
        if (search) {
            query += ` AND (r.origen ILIKE $${idx} OR r.destino ILIKE $${idx} OR o.nombre ILIKE $${idx})`;
            params.push(`%${search}%`); idx++;
        }
        query += ' ORDER BY r.destino, o.nombre';

        const rows = await sql(query, params);

        // Stats
        const total = rows.length;
        const stats = {
            total,
            borrador: rows.filter(r => r.estado === 'borrador').length,
            en_progreso: rows.filter(r => r.estado === 'en_progreso').length,
            aprobada: rows.filter(r => r.estado === 'aprobada').length,
            publicada: rows.filter(r => r.estado === 'publicada').length,
            promedio_progreso: total ? Math.round(rows.reduce((s, r) => s + (r.progreso_pct || 0), 0) / total) : 0
        };

        return res.json({ ...stats, routes: rows });
    }

    // POST — crear ruta
    if (req.method === 'POST') {
        const { region_id = 'boyaca', operator_id, origen, destino, ref, red, color,
                resolucion, tipo_servicio = 'regular', direction = 'ida',
                responsable_id, terminal_route_id } = req.body;

        if (!operator_id || !origen?.trim() || !destino?.trim())
            return res.status(400).json({ error: 'operator_id, origen y destino son obligatorios' });

        const row = await sql`
            INSERT INTO routes (region_id, operator_id, origen, destino, ref, red, color,
                resolucion, tipo_servicio, direction, responsable_id, terminal_route_id)
            VALUES (${region_id}, ${operator_id}, ${origen.trim()}, ${destino.trim()},
                ${ref || null}, ${red || null}, ${color || null},
                ${resolucion || null}, ${tipo_servicio}, ${direction},
                ${responsable_id || null}, ${terminal_route_id || null})
            RETURNING id
        `;
        const routeId = row[0].id;

        // Generar tareas automáticas y calcular progreso inicial
        await generateTasks(sql, routeId);
        await recalcProgress(sql, routeId);

        return res.json({ ok: true, id: routeId });
    }

    // PUT — actualizar ruta
    if (req.method === 'PUT') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Falta id' });

        const { operator_id, origen, destino, ref, red, color, resolucion,
                tipo_servicio, direction, estado, responsable_id, osm_relation_id } = req.body;

        if (!operator_id || !origen?.trim() || !destino?.trim())
            return res.status(400).json({ error: 'operator_id, origen y destino son obligatorios' });

        await sql`
            UPDATE routes SET
                operator_id = ${operator_id}, origen = ${origen}, destino = ${destino},
                ref = ${ref || null}, red = ${red || null}, color = ${color || null},
                resolucion = ${resolucion || null}, tipo_servicio = ${tipo_servicio},
                direction = ${direction}, estado = ${estado},
                responsable_id = ${responsable_id || null},
                osm_relation_id = ${osm_relation_id || null},
                actualizada_en = NOW()
            WHERE id = ${id}
        `;

        // Recalcular progreso
        await recalcProgress(sql, id);

        return res.json({ ok: true });
    }

    // DELETE
    if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        try {
            await sql`DELETE FROM routes WHERE id = ${id}`;
            return res.json({ ok: true });
        } catch (err) {
            return res.status(409).json({ error: 'No se puede eliminar: la ruta tiene datos asociados' });
        }
    }

    res.status(405).json({ error: 'Método no permitido' });
};

async function generateTasks(sql, routeId) {
    const tipos = ['localizar_paradas', 'ingresar_tarifas', 'asignar_paradas', 'trazar_ruta', 'ingresar_horarios'];
    for (const tipo of tipos) {
        await sql`
            INSERT INTO route_tasks (route_id, tipo)
            VALUES (${routeId}, ${tipo})
            ON CONFLICT (route_id, tipo) DO NOTHING
        `;
    }
}

async function recalcProgress(sql, routeId) {
    const [route] = await sql`SELECT * FROM routes WHERE id = ${routeId}`;
    if (!route) return;

    let pct = 0;

    // 20% datos básicos
    if (route.operator_id && route.origen && route.destino && route.ref) pct += 20;

    // 20% paradas
    const [stopCount] = await sql`SELECT COUNT(*) FROM route_stops WHERE route_id = ${routeId}`;
    if (parseInt(stopCount.count) >= 2) pct += 20;

    // 20% trazado
    const [shapeCount] = await sql`SELECT COUNT(*) FROM route_shapes WHERE route_id = ${routeId}`;
    if (parseInt(shapeCount.count) > 0) pct += 20;

    // 15% tarifas
    const [fareCount] = await sql`SELECT COUNT(*) FROM route_fares WHERE route_id = ${routeId}`;
    if (parseInt(fareCount.count) > 0) pct += 15;

    // 15% horarios
    const [tripCount] = await sql`SELECT COUNT(*) FROM route_trips WHERE route_id = ${routeId}`;
    if (parseInt(tripCount.count) > 0) pct += 15;

    // 10% OSM
    if (route.osm_relation_id) pct += 10;

    await sql`UPDATE routes SET progreso_pct = ${pct}, actualizada_en = NOW() WHERE id = ${routeId}`;

    // Actualizar tareas automáticas
    await updateTasks(sql, routeId, { stopCount: parseInt(stopCount.count), shapeCount: parseInt(shapeCount.count), fareCount: parseInt(fareCount.count), tripCount: parseInt(tripCount.count) });
}

async function updateTasks(sql, routeId, counts) {
    if (counts.stopCount >= 2) {
        await sql`UPDATE route_tasks SET estado = 'completada', completada_en = NOW() WHERE route_id = ${routeId} AND tipo = 'localizar_paradas' AND estado != 'completada'`;
        await sql`UPDATE route_tasks SET estado = 'completada', completada_en = NOW() WHERE route_id = ${routeId} AND tipo = 'asignar_paradas' AND estado != 'completada'`;
    }
    if (counts.shapeCount > 0)
        await sql`UPDATE route_tasks SET estado = 'completada', completada_en = NOW() WHERE route_id = ${routeId} AND tipo = 'trazar_ruta' AND estado != 'completada'`;
    if (counts.fareCount > 0)
        await sql`UPDATE route_tasks SET estado = 'completada', completada_en = NOW() WHERE route_id = ${routeId} AND tipo = 'ingresar_tarifas' AND estado != 'completada'`;
    if (counts.tripCount > 0)
        await sql`UPDATE route_tasks SET estado = 'completada', completada_en = NOW() WHERE route_id = ${routeId} AND tipo = 'ingresar_horarios' AND estado != 'completada'`;
}
