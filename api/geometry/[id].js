const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const osmId = parseInt(req.query.id);
    if (!osmId) return res.status(400).json({ error: 'Missing id' });

    try {
        // Check cache
        const [row] = await sql('SELECT geometry FROM relations WHERE osm_id = $1', [osmId]);
        if (row?.geometry) {
            return res.json(row.geometry);
        }

        // Fetch from Overpass
        const query = `[out:json][timeout:60];relation(${osmId});(._;>;);out geom;`;
        const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });

        const text = await overpassRes.text();
        if (text.startsWith('<')) {
            return res.status(503).json({ error: 'Overpass busy, retry in a few seconds' });
        }

        const data = JSON.parse(text);
        const relation = data.elements.find(e => e.type === 'relation');
        if (!relation) return res.status(404).json({ error: 'Relation not found in Overpass' });

        // Build GeoJSON
        const ways = data.elements.filter(e => e.type === 'way' && e.geometry);
        const nodes = data.elements.filter(e => e.type === 'node');

        const features = [];

        // Way geometries (route line segments)
        const wayMembers = (relation.members || []).filter(m => m.type === 'way');
        for (const wm of wayMembers) {
            const way = ways.find(w => w.id === wm.ref);
            if (way?.geometry) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: way.geometry.map(p => [p.lon, p.lat])
                    },
                    properties: { type: 'way', id: way.id }
                });
            }
        }

        // Stop nodes
        const stopMembers = (relation.members || []).filter(m =>
            m.type === 'node' && (m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only' || m.role === 'platform')
        );
        for (const sm of stopMembers) {
            const node = nodes.find(n => n.id === sm.ref);
            if (node) {
                features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
                    properties: {
                        type: 'stop',
                        id: node.id,
                        name: node.tags?.name || null,
                        role: sm.role
                    }
                });
            }
        }

        const geojson = { type: 'FeatureCollection', features };

        // Cache in DB
        await sql('UPDATE relations SET geometry = $1 WHERE osm_id = $2', [JSON.stringify(geojson), osmId]);

        res.json(geojson);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
