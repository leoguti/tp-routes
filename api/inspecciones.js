// API: inspecciones — registro de la revisión de rutas hecha por estudiantes
// (juego "Viaje de Inspección" en revisar-ruta.html)
//
// Endpoints:
//   GET  /api/inspecciones?resumen=1        -> { route_ids: [ids con >=1 inspección] }
//   GET  /api/inspecciones?route_id=9       -> inspecciones de esa ruta
//   GET  /api/inspecciones                  -> últimas 200
//   POST /api/inspecciones                  -> registra un evento de inspección
//        { route_id, inspector, sentido, tipo, parada, veredicto, comentario, lat, lon }
//        tipo: 'parada' | 'problema' | 'fin'

const { neon } = require('@neondatabase/serverless');

async function ensureTable(sql) {
    await sql`
        CREATE TABLE IF NOT EXISTS route_inspections (
            id          SERIAL PRIMARY KEY,
            route_id    INTEGER NOT NULL,
            inspector   TEXT,
            sentido     TEXT,
            tipo        TEXT,
            parada      TEXT,
            veredicto   TEXT,
            comentario  TEXT,
            lat         DOUBLE PRECISION,
            lon         DOUBLE PRECISION,
            creada_en   TIMESTAMPTZ DEFAULT NOW()
        )
    `;
}

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);

    if (req.method === 'GET') {
        const { resumen, route_id } = req.query;
        if (resumen) {
            const rows = await sql`SELECT DISTINCT route_id FROM route_inspections`;
            return res.json({ route_ids: rows.map(r => r.route_id) });
        }
        if (route_id) {
            const rows = await sql`
                SELECT * FROM route_inspections WHERE route_id = ${route_id}
                ORDER BY creada_en`;
            return res.json({ inspecciones: rows });
        }
        const rows = await sql`
            SELECT * FROM route_inspections ORDER BY creada_en DESC LIMIT 200`;
        return res.json({ inspecciones: rows });
    }

    if (req.method === 'POST') {
        const { route_id, inspector, sentido, tipo, parada, veredicto, comentario, lat, lon } = req.body || {};
        if (!route_id) return res.status(400).json({ error: 'Falta route_id' });
        try {
            const [row] = await sql`
                INSERT INTO route_inspections
                    (route_id, inspector, sentido, tipo, parada, veredicto, comentario, lat, lon)
                VALUES (${route_id}, ${inspector || null}, ${sentido || null}, ${tipo || null},
                        ${parada || null}, ${veredicto || null}, ${comentario || null},
                        ${lat ?? null}, ${lon ?? null})
                RETURNING id`;
            return res.json({ ok: true, id: row.id });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
};
