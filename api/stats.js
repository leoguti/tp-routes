const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const region = req.query.region || 'boyaca';

    try {
        const [counts] = await sql(`
            SELECT
                count(*) FILTER (WHERE osm_type = 'route') as routes,
                count(*) FILTER (WHERE osm_type = 'route_master') as route_masters,
                count(*) FILTER (WHERE stop_count = 0 AND osm_type = 'route') as routes_no_stops,
                count(*) FILTER (WHERE operator IS NULL AND osm_type = 'route') as routes_no_operator,
                count(*) FILTER (WHERE network IS NULL AND osm_type = 'route') as routes_no_network,
                count(*) FILTER (WHERE ref IS NULL AND osm_type = 'route') as routes_no_ref,
                count(*) FILTER (WHERE ptv2_valid = true AND osm_type = 'route') as routes_valid,
                count(*) as total
            FROM relations WHERE region = $1
        `, [region]);

        const [stopCount] = await sql('SELECT count(*) as n FROM stops WHERE region = $1', [region]);

        const operators = await sql(`
            SELECT operator, count(*) as n
            FROM relations WHERE region = $1 AND osm_type = 'route'
            GROUP BY operator ORDER BY n DESC
        `, [region]);

        const networks = await sql(`
            SELECT network, count(*) as n
            FROM relations WHERE region = $1 AND osm_type = 'route'
            GROUP BY network ORDER BY n DESC
        `, [region]);

        const lastSync = await sql(`
            SELECT synced_at, relations_found, stops_found, duration_ms
            FROM sync_log WHERE region = $1 AND status = 'success'
            ORDER BY synced_at DESC LIMIT 1
        `, [region]);

        res.json({
            region,
            counts,
            stops: parseInt(stopCount.n),
            operators,
            networks,
            lastSync: lastSync[0] || null
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
