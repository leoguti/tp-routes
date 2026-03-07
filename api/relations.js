const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const region = req.query.region || 'boyaca';
    const operator = req.query.operator || null;
    const network = req.query.network || null;

    try {
        let query = `
            SELECT osm_id, osm_type, route_type, ref, name, "from", "to",
                   operator, network, colour, stop_count, way_count, member_count,
                   route_master_id, ptv2_valid, ptv2_errors,
                   distance_km, osm_timestamp, tags
            FROM relations
            WHERE region = $1
        `;
        const params = [region];
        let idx = 2;

        if (operator) {
            query += ` AND operator = $${idx}`;
            params.push(operator);
            idx++;
        }
        if (network) {
            query += ` AND network = $${idx}`;
            params.push(network);
            idx++;
        }

        query += ' ORDER BY ref, name';

        const rows = await sql(query, params);
        res.json({ region, count: rows.length, relations: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
