// API: terminal_routes — CRUD + import + export
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);

    // GET /api/terminal-routes — list with filters
    if (req.method === 'GET') {
        const { region = 'boyaca', status, operador, search } = req.query;
        let query = `SELECT * FROM terminal_routes WHERE region = $1`;
        const params = [region];
        let idx = 2;

        if (status) { query += ` AND status = $${idx++}`; params.push(status); }
        if (operador) { query += ` AND operador ILIKE $${idx++}`; params.push(`%${operador}%`); }
        if (search) {
            query += ` AND (origen ILIKE $${idx} OR destino ILIKE $${idx} OR operador ILIKE $${idx})`;
            params.push(`%${search}%`); idx++;
        }
        query += ' ORDER BY destino, operador';

        try {
            const rows = await sql(query, params);
            // Stats
            const total = rows.length;
            const pendientes = rows.filter(r => r.status === 'pendiente').length;
            const mapeadas = rows.filter(r => r.status === 'mapeada').length;
            const publicadas = rows.filter(r => r.status === 'publicada').length;
            res.json({ total, pendientes, mapeadas, publicadas, routes: rows });
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

        try {
            let inserted = 0;
            let skipped = 0;
            for (const r of valid) {
                // Check for duplicates
                const exists = await sql`
                    SELECT id FROM terminal_routes
                    WHERE origen = ${r.origen.trim()}
                      AND destino = ${r.destino.trim()}
                      AND operador = ${r.operador.trim()}
                      AND region = ${region}
                `;
                if (exists.length > 0) { skipped++; continue; }

                await sql`
                    INSERT INTO terminal_routes
                      (origen, destino, operador, telefono, resolucion, tarifa, notas, region)
                    VALUES (
                      ${r.origen.trim()},
                      ${r.destino.trim()},
                      ${r.operador.trim()},
                      ${r.telefono?.trim() || null},
                      ${r.resolucion?.trim() || null},
                      ${r.tarifa ? parseInt(r.tarifa) : null},
                      ${r.notas?.trim() || null},
                      ${region}
                    )
                `;
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

        const { origen, destino, operador, telefono, resolucion, tarifa, notas, status, osm_relation_id } = req.body;
        try {
            await sql`
                UPDATE terminal_routes SET
                    origen = ${origen},
                    destino = ${destino},
                    operador = ${operador},
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
