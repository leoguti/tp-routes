/**
 * Pre-cache all route geometries from Overpass into the database.
 * Usage: node scripts/cache-geometries.js --region boyaca
 *
 * Fetches geometry for each relation that doesn't have cached geometry yet.
 * Respects Overpass rate limits with delays between requests.
 */
require('dotenv').config();
const { Client } = require('pg');
const https = require('https');
const path = require('path');

const REGIONS = require(path.join(__dirname, '..', 'regions.json'));
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DELAY_MS = 1500; // delay between Overpass requests

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function overpassPost(query) {
    return new Promise((resolve, reject) => {
        const body = `data=${encodeURIComponent(query)}`;
        const req = https.request(OVERPASS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                if (text.startsWith('<')) {
                    reject(new Error('Overpass returned HTML (busy/error)'));
                    return;
                }
                try { resolve(JSON.parse(text)); }
                catch { reject(new Error('Invalid JSON from Overpass')); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function buildGeoJSON(data) {
    const relation = data.elements.find(e => e.type === 'relation');
    if (!relation) return null;

    const ways = data.elements.filter(e => e.type === 'way' && e.geometry);
    const nodes = data.elements.filter(e => e.type === 'node');
    const features = [];

    // Ways
    const wayMembers = (relation.members || []).filter(m => m.type === 'way');
    for (const wm of wayMembers) {
        const way = ways.find(w => w.id === wm.ref);
        if (way?.geometry) {
            features.push({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: way.geometry.map(p => [p.lon, p.lat]) },
                properties: { type: 'way', id: way.id }
            });
        }
    }

    // Stops
    const stopMembers = (relation.members || []).filter(m =>
        m.type === 'node' && (m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only' || m.role === 'platform')
    );
    for (const sm of stopMembers) {
        const node = nodes.find(n => n.id === sm.ref);
        if (node) {
            features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
                properties: { type: 'stop', id: node.id, name: node.tags?.name || null, role: sm.role }
            });
        }
    }

    return { type: 'FeatureCollection', features };
}

async function main() {
    const regionArg = process.argv.find(a => a.startsWith('--region='))?.split('=')[1]
        || process.argv[process.argv.indexOf('--region') + 1]
        || 'boyaca';

    const region = REGIONS[regionArg];
    if (!region) { console.error('Region desconocida:', regionArg); process.exit(1); }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Get relations without cached geometry
    const { rows } = await client.query(
        "SELECT osm_id, ref, name FROM relations WHERE region = $1 AND geometry IS NULL AND osm_type = 'route' ORDER BY ref",
        [regionArg]
    );

    console.log(`${rows.length} rutas sin geometria cacheada en ${region.name}`);

    let cached = 0, errors = 0;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        process.stdout.write(`  [${i+1}/${rows.length}] ${r.ref || r.osm_id} ${r.name || ''} ... `);

        try {
            const query = `[out:json][timeout:60];relation(${r.osm_id});(._;>;);out geom;`;
            const data = await overpassPost(query);
            const geojson = buildGeoJSON(data);

            if (geojson && geojson.features.length > 0) {
                await client.query('UPDATE relations SET geometry = $1 WHERE osm_id = $2',
                    [JSON.stringify(geojson), r.osm_id]);
                console.log(`OK (${geojson.features.length} features)`);
                cached++;
            } else {
                console.log('sin geometria');
            }
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
            errors++;
            // Extra wait on error (likely rate limited)
            await sleep(5000);
        }

        if (i < rows.length - 1) await sleep(DELAY_MS);
    }

    // Summary
    const { rows: [{ count }] } = await client.query(
        "SELECT count(*) FROM relations WHERE region = $1 AND geometry IS NOT NULL",
        [regionArg]
    );

    console.log(`\n=== Resultado ===`);
    console.log(`  Cacheadas ahora: ${cached}`);
    console.log(`  Errores: ${errors}`);
    console.log(`  Total con geometria: ${count}/${rows.length + parseInt(count) - cached}`);

    await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
