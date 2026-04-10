// API: operators
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const { region = 'boyaca' } = req.query;

    if (req.method === 'GET') {
        const rows = await sql`SELECT * FROM operators WHERE region_id = ${region} ORDER BY nombre`;
        return res.json({ total: rows.length, operators: rows });
    }

    if (req.method === 'POST') {
        const { nombre, nombre_corto, telefono, email, url } = req.body;
        if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre es obligatorio' });
        const existing = await sql`SELECT id FROM operators WHERE region_id = ${region} AND nombre = ${nombre.trim()}`;
        if (existing.length) return res.json({ ok: true, id: existing[0].id, existed: true });
        const row = await sql`
            INSERT INTO operators (region_id, nombre, nombre_corto, telefono, email, url)
            VALUES (${region}, ${nombre.trim()}, ${nombre_corto || null}, ${telefono || null}, ${email || null}, ${url || null})
            RETURNING id
        `;
        return res.json({ ok: true, id: row[0].id });
    }

    if (req.method === 'PUT') {
        const { id } = req.query;
        const { nombre, nombre_corto, telefono, email, url } = req.body;
        await sql`UPDATE operators SET nombre=${nombre}, nombre_corto=${nombre_corto||null}, telefono=${telefono||null}, email=${email||null}, url=${url||null} WHERE id=${id}`;
        return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
        const { id } = req.query;
        await sql`DELETE FROM operators WHERE id=${id}`;
        return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Método no permitido' });
};
