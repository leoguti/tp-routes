const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const osmId = parseInt(req.query.id);

    if (!osmId) {
        return res.status(400).json({ error: 'Missing relation id' });
    }

    try {
        const [relation] = await sql(
            'SELECT * FROM relations WHERE osm_id = $1', [osmId]
        );

        if (!relation) {
            return res.status(404).json({ error: 'Relation not found' });
        }

        const members = await sql(`
            SELECT member_type, member_osm_id, role, sequence
            FROM relation_members
            WHERE relation_osm_id = $1
            ORDER BY sequence
        `, [osmId]);

        // If route_master, get child routes
        let childRoutes = [];
        if (relation.osm_type === 'route_master') {
            childRoutes = await sql(`
                SELECT osm_id, ref, name, "from", "to", stop_count, way_count
                FROM relations WHERE route_master_id = $1
                ORDER BY ref
            `, [osmId]);
        }

        // Get stop details for this relation's stop members
        const stopIds = members
            .filter(m => m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only')
            .map(m => m.member_osm_id);

        let stops = [];
        if (stopIds.length > 0) {
            stops = await sql(
                'SELECT osm_id, name, lat, lon, stop_type FROM stops WHERE osm_id = ANY($1)',
                [stopIds]
            );
        }

        res.json({ relation, members, childRoutes, stops });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
