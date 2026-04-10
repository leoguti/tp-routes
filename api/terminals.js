// API: terminals — CRUD
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);

    if (req.method === 'GET') {
        const { region = 'boyaca', tipo, search } = req.query;
        let query = `SELECT * FROM terminals WHERE region = $1`;
        const params = [region]; let idx = 2;
        if (tipo) { query += ` AND tipo = $${idx++}`; params.push(tipo); }
        if (search) { query += ` AND (nombre ILIKE $${idx} OR municipio ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
        query += ' ORDER BY municipio, nombre';
        try {
            const rows = await sql(query, params);
            res.json({ total: rows.length, terminals: rows });
        } catch (err) { res.status(500).json({ error: err.message }); }
        return;
    }

    if (req.method === 'POST') {
        const { nombre, municipio, departamento = 'Boyacá', pais = 'CO', lat, lon, direccion, tipo = 'terminal', osm_node_id, region = 'boyaca', notas } = req.body;
        if (!nombre?.trim() || !municipio?.trim()) return res.status(400).json({ error: 'Nombre y municipio son obligatorios' });
        try {
            const row = await sql`
                INSERT INTO terminals (nombre, municipio, departamento, pais, lat, lon, direccion, tipo, osm_node_id, region, notas)
                VALUES (${nombre.trim()}, ${municipio.trim()}, ${departamento}, ${pais},
                        ${lat || null}, ${lon || null}, ${direccion || null}, ${tipo},
                        ${osm_node_id || null}, ${region}, ${notas || null})
                RETURNING id
            `;
            res.json({ ok: true, id: row[0].id });
        } catch (err) { res.status(500).json({ error: err.message }); }
        return;
    }

    if (req.method === 'PUT') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        const { nombre, municipio, departamento, lat, lon, direccion, tipo, osm_node_id, notas } = req.body;
        try {
            await sql`
                UPDATE terminals SET
                    nombre = ${nombre}, municipio = ${municipio},
                    departamento = ${departamento}, lat = ${lat || null}, lon = ${lon || null},
                    direccion = ${direccion || null}, tipo = ${tipo},
                    osm_node_id = ${osm_node_id || null}, notas = ${notas || null},
                    updated_at = NOW()
                WHERE id = ${id}
            `;
            res.json({ ok: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
        return;
    }

    if (req.method === 'DELETE') {
        const { id } = req.query;
        if (!id) return res.status(400).json({ error: 'Falta id' });
        try {
            await sql`DELETE FROM terminals WHERE id = ${id}`;
            res.json({ ok: true });
        } catch (err) { res.status(500).json({ error: err.message }); }
        return;
    }

    res.status(405).json({ error: 'Método no permitido' });
};
