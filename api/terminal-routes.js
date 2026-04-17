// API: terminal_routes — CRUD + import + export
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);

    // GET /api/terminal-routes — lista con JOIN a routes (estado real) y operators
    if (req.method === 'GET') {
        const { region = 'boyaca', estado, operador, search } = req.query;
        let query = `
            SELECT tr.id, tr.origen, tr.destino, tr.operador, tr.via,
                   tr.telefono, tr.resolucion, tr.tarifa, tr.notas, tr.region,
                   tr.created_at, tr.updated_at,
                   r.id AS route_id, r.estado AS route_estado, r.progreso_pct,
                   r.osm_relation_id
            FROM terminal_routes tr
            LEFT JOIN routes r ON r.terminal_route_id = tr.id
            WHERE tr.region = $1
        `;
        const params = [region];
        let idx = 2;

        if (estado) { query += ` AND r.estado = $${idx++}`; params.push(estado); }
        if (operador) { query += ` AND tr.operador ILIKE $${idx++}`; params.push(`%${operador}%`); }
        if (search) {
            query += ` AND (tr.origen ILIKE $${idx} OR tr.destino ILIKE $${idx} OR tr.operador ILIKE $${idx})`;
            params.push(`%${search}%`); idx++;
        }
        query += ' ORDER BY tr.destino, tr.operador';

        try {
            const rows = await sql(query, params);
            const total = rows.length;
            const borradores = rows.filter(r => (r.route_estado || 'borrador') === 'borrador').length;
            const en_progreso = rows.filter(r => r.route_estado === 'en_progreso').length;
            const publicadas = rows.filter(r => r.route_estado === 'publicada').length;
            res.json({ total, borradores, en_progreso, publicadas, routes: rows });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
        return;
    }

    // POST /api/terminal-routes — create single or bulk import
    if (req.method === 'POST') {
        const { routes, region = 'boyaca' } = req.body;

        if (!routes || !Array.isArray(routes)) {
            return res.status(400).json({ error: 'Se esperaba un array de rutas' });
        }

        const errors = [];
        const valid = [];

        for (let i = 0; i < routes.length; i++) {
            const r = routes[i];
            const row = i + 2; // Excel row (header is row 1)
            if (!r.origen?.trim()) { errors.push(`Fila ${row}: falta origen`); continue; }
            if (!r.destino?.trim()) { errors.push(`Fila ${row}: falta destino`); continue; }
            if (!r.operador?.trim()) { errors.push(`Fila ${row}: falta operador`); continue; }
            valid.push(r);
        }

        if (errors.length > 0 && valid.length === 0) {
            return res.status(400).json({ error: 'Archivo con errores', details: errors });
        }

        // Import directo: para cada fila -> crea/encuentra operator, verifica dedup
        // por clave única (op, origen, destino, via) en routes, inserta en routes
        // y loguea en terminal_routes.
        try {
            let inserted = 0;
            let skipped = 0;
            const TAREAS = ['localizar_paradas','ingresar_tarifas','asignar_paradas','trazar_ruta','ingresar_horarios'];

            for (const r of valid) {
                const origen = r.origen.trim();
                const destino = r.destino.trim();
                const operadorNombre = r.operador.trim();
                const viaNorm = (r.via?.trim()) || '';

                // 1. Operador: buscar por nombre case-insensitive, crear si no existe
                let opRow = await sql`
                    SELECT id FROM operators
                    WHERE region_id = ${region} AND LOWER(nombre) = LOWER(${operadorNombre})
                `;
                let operatorId;
                if (opRow.length) {
                    operatorId = opRow[0].id;
                    if (r.telefono?.trim()) {
                        await sql`
                            UPDATE operators SET telefono = COALESCE(NULLIF(telefono,''), ${r.telefono.trim()})
                            WHERE id = ${operatorId}
                        `;
                    }
                } else {
                    const created = await sql`
                        INSERT INTO operators (region_id, nombre, telefono)
                        VALUES (${region}, ${operadorNombre}, ${r.telefono?.trim() || null})
                        RETURNING id
                    `;
                    operatorId = created[0].id;
                }

                // 2. Dedup por clave única en routes
                const exists = await sql`
                    SELECT id FROM routes
                    WHERE region_id = ${region}
                      AND operator_id = ${operatorId}
                      AND LOWER(origen) = LOWER(${origen})
                      AND LOWER(destino) = LOWER(${destino})
                      AND LOWER(COALESCE(via, '')) = LOWER(${viaNorm})
                `;
                if (exists.length > 0) { skipped++; continue; }

                // 3. Log en terminal_routes
                const trRow = await sql`
                    INSERT INTO terminal_routes
                      (origen, destino, operador, via, telefono, resolucion, tarifa, notas, region)
                    VALUES (
                      ${origen}, ${destino}, ${operadorNombre}, ${viaNorm || null},
                      ${r.telefono?.trim() || null}, ${r.resolucion?.trim() || null},
                      ${r.tarifa ? parseInt(r.tarifa) : null}, ${r.notas?.trim() || null},
                      ${region}
                    )
                    RETURNING id
                `;
                const terminalRouteId = trRow[0].id;

                // 4. Insertar en routes (borrador)
                const newRoute = await sql`
                    INSERT INTO routes (region_id, operator_id, origen, destino, via,
                                        resolucion, terminal_route_id, estado)
                    VALUES (${region}, ${operatorId}, ${origen}, ${destino}, ${viaNorm || null},
                            ${r.resolucion?.trim() || null}, ${terminalRouteId}, 'borrador')
                    RETURNING id
                `;
                const routeId = newRoute[0].id;

                // 5. Generar tareas automáticas
                for (const tipo of TAREAS) {
                    await sql`
                        INSERT INTO route_tasks (route_id, tipo)
                        VALUES (${routeId}, ${tipo})
                        ON CONFLICT (route_id, tipo) DO NOTHING
                    `;
                }

                inserted++;
            }
            res.json({ inserted, skipped, errors, total: valid.length + errors.length });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
        return;
    }

    // PUT /api/terminal-routes?id=X — update
    if (req.method === 'PUT') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Falta id' });

        const { origen, destino, operador, via, telefono, resolucion, tarifa, notas, status, osm_relation_id } = req.body;
        try {
            await sql`
                UPDATE terminal_routes SET
                    origen = ${origen},
                    destino = ${destino},
                    operador = ${operador},
                    via = ${via || null},
                    telefono = ${telefono || null},
                    resolucion = ${resolucion || null},
                    tarifa = ${tarifa ? parseInt(tarifa) : null},
                    notas = ${notas || null},
                    status = ${status},
                    osm_relation_id = ${osm_relation_id || null},
                    updated_at = NOW()
                WHERE id = ${id}
            `;
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
        return;
    }

    // DELETE /api/terminal-routes?id=X
    if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        try {
            await sql`DELETE FROM terminal_routes WHERE id = ${id}`;
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
        return;
    }

    res.status(405).json({ error: 'Método no permitido' });
};
