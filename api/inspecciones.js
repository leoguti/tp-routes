// API: inspecciones — registro de la revisión de rutas hecha por estudiantes
// (juego "Viaje de Inspección" en revisar-ruta.html)
//
// Endpoints:
//   GET  /api/inspecciones?resumen=1   -> { route_ids: [ids con >=1 inspección] }
//   GET  /api/inspecciones?estados=1   -> { veredictos: [{route_id, sentido, inspector, veredicto}] }
//   GET  /api/inspecciones?route_id=9  -> inspecciones de esa ruta
//   GET  /api/inspecciones             -> últimas 200
//   POST /api/inspecciones             -> registra un evento
//        { route_id, inspector, sentido, tipo, parada, veredicto, comentario, lat, lon, lat_ok, lon_ok }
//        tipo: 'parada' | 'problema' | 'veredicto' | 'fin'
//        veredicto: parada -> ok|corrida|equivocada|sobra|otro
//                   problema -> otro_camino|vuelta_rara|falta_parada|contravia|otro
//                   veredicto -> arreglada|problemas
//        lat_ok/lon_ok: pin del "punto correcto" señalado por el estudiante (opcional)

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
    await sql`ALTER TABLE route_inspections ADD COLUMN IF NOT EXISTS lat_ok DOUBLE PRECISION`;
    await sql`ALTER TABLE route_inspections ADD COLUMN IF NOT EXISTS lon_ok DOUBLE PRECISION`;
}

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);

    if (req.method === 'GET') {
        const { resumen, estados, route_id } = req.query;
        if (resumen) {
            const rows = await sql`SELECT DISTINCT route_id FROM route_inspections`;
            return res.json({ route_ids: rows.map(r => r.route_id) });
        }
        if (estados) {
            const rows = await sql`
                SELECT route_id, sentido, inspector, veredicto
                FROM route_inspections WHERE tipo = 'veredicto'`;
            return res.json({ veredictos: rows });
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
        const { route_id, inspector, sentido, tipo, parada, veredicto, comentario, lat, lon, lat_ok, lon_ok } = req.body || {};
        if (!route_id) return res.status(400).json({ error: 'Falta route_id' });
        try {
            const [row] = await sql`
                INSERT INTO route_inspections
                    (route_id, inspector, sentido, tipo, parada, veredicto, comentario, lat, lon, lat_ok, lon_ok)
                VALUES (${route_id}, ${inspector || null}, ${sentido || null}, ${tipo || null},
                        ${parada || null}, ${veredicto || null}, ${comentario || null},
                        ${lat ?? null}, ${lon ?? null}, ${lat_ok ?? null}, ${lon_ok ?? null})
                RETURNING id`;
            return res.json({ ok: true, id: row.id });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Método no permitido' });
};
