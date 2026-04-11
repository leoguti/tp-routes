// API: reset — limpia datos de rutas, operadores y terminal_routes
// Requiere header o param secret para evitar ejecución accidental
const { neon } = require('@neondatabase/serverless');

const RESET_SECRET = process.env.RESET_SECRET || 'tp-reset-2024';

module.exports = async function handler(req, res) {
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Método no permitido' });

    const { secret, region } = req.body;

    if (!secret || secret !== RESET_SECRET)
        return res.status(401).json({ error: 'Secret incorrecto' });

    const sql = neon(process.env.DATABASE_URL);

    try {
        let counts = {};

        if (region) {
            // Borrar solo una región
            const routes = await sql`SELECT id FROM routes WHERE region_id = ${region}`;
            const routeIds = routes.map(r => r.id);

            if (routeIds.length) {
                await sql`DELETE FROM route_trips  WHERE route_id = ANY(${routeIds}::int[])`;
                await sql`DELETE FROM route_fares  WHERE route_id = ANY(${routeIds}::int[])`;
                await sql`DELETE FROM route_shapes WHERE route_id = ANY(${routeIds}::int[])`;
                await sql`DELETE FROM route_stops  WHERE route_id = ANY(${routeIds}::int[])`;
                await sql`DELETE FROM route_tasks  WHERE route_id = ANY(${routeIds}::int[])`;
            }

            const r = await sql`DELETE FROM routes        WHERE region_id = ${region} RETURNING id`;
            const o = await sql`DELETE FROM operators     WHERE region_id = ${region} RETURNING id`;
            const t = await sql`DELETE FROM terminal_routes WHERE region   = ${region} RETURNING id`;

            counts = { routes: r.length, operators: o.length, terminal_routes: t.length };
        } else {
            // Borrar todo
            await sql`TRUNCATE route_trips, route_fares, route_shapes, route_stops, route_tasks CASCADE`;
            const r = await sql`DELETE FROM routes         RETURNING id`;
            const o = await sql`DELETE FROM operators      RETURNING id`;
            const t = await sql`DELETE FROM terminal_routes RETURNING id`;

            counts = { routes: r.length, operators: o.length, terminal_routes: t.length };
        }

        return res.json({ ok: true, deleted: counts });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
