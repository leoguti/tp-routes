/**
 * Update cached GeoJSON geometries with first/last node IDs per way.
 * Only fetches way metadata (not full geometry) for already-cached relations.
 * Usage: node scripts/update-node-ids.js --region boyaca
 */
require('dotenv').config();
const { Client } = require('pg');
const https = require('https');
const path = require('path');

const REGIONS = require(path.join(__dirname, '..', 'regions.json'));
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const DELAY_MS = 1500;

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

async function main() {
    const regionArg = process.argv.find(a => a.startsWith('--region='))?.split('=')[1]
        || process.argv[process.argv.indexOf('--region') + 1]
        || 'boyaca';

    const region = REGIONS[regionArg];
    if (!region) { console.error('Region desconocida:', regionArg); process.exit(1); }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Get relations with cached geometry that lack node IDs
    const { rows } = await client.query(
        `SELECT osm_id, ref, name, geometry
         FROM relations
         WHERE region = $1 AND geometry IS NOT NULL AND osm_type = 'route'
         ORDER BY ref`,
        [regionArg]
    );

    // Filter to those missing node IDs
    const needUpdate = rows.filter(r => {
        const geo = typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry;
        const ways = (geo.features || []).filter(f => f.properties.type === 'way');
        return ways.length > 0 && !ways[0].properties.firstNode;
    });

    console.log(`${needUpdate.length}/${rows.length} rutas necesitan node IDs en ${region.name}`);
    if (needUpdate.length === 0) {
        console.log('Nada que hacer.');
        await client.end();
        return;
    }

    // Collect all way IDs we need node info for
    const allWayIds = new Set();
    for (const r of needUpdate) {
        const geo = typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry;
        for (const f of geo.features) {
            if (f.properties.type === 'way') allWayIds.add(f.properties.id);
        }
    }

    console.log(`${allWayIds.size} ways unicos a consultar`);

    // Fetch node IDs in batches (Overpass supports way(id:id1,id2,...))
    const wayNodeMap = new Map(); // wayId -> {firstNode, lastNode}
    const wayIdArray = [...allWayIds];
    const BATCH_SIZE = 200;

    for (let i = 0; i < wayIdArray.length; i += BATCH_SIZE) {
        const batch = wayIdArray.slice(i, i + BATCH_SIZE);
        const ids = batch.join(',');
        process.stdout.write(`  Batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(wayIdArray.length/BATCH_SIZE)} (${batch.length} ways)... `);

        try {
            const query = `[out:json][timeout:60];way(id:${ids});out body;`;
            const data = await overpassPost(query);

            for (const el of data.elements) {
                if (el.type === 'way' && el.nodes && el.nodes.length >= 2) {
                    wayNodeMap.set(el.id, {
                        firstNode: el.nodes[0],
                        lastNode: el.nodes[el.nodes.length - 1]
                    });
                }
            }
            console.log(`OK (${data.elements.length} ways)`);
        } catch (err) {
            console.log(`ERROR: ${err.message}`);
            await sleep(5000);
        }

        if (i + BATCH_SIZE < wayIdArray.length) await sleep(DELAY_MS);
    }

    console.log(`\nNode IDs obtenidos para ${wayNodeMap.size}/${allWayIds.size} ways`);

    // Update cached GeoJSON with node IDs
    let updated = 0;
    for (const r of needUpdate) {
        const geo = typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry;
        let changed = false;

        for (const f of geo.features) {
            if (f.properties.type === 'way') {
                const nodeInfo = wayNodeMap.get(f.properties.id);
                if (nodeInfo) {
                    f.properties.firstNode = nodeInfo.firstNode;
                    f.properties.lastNode = nodeInfo.lastNode;
                    changed = true;
                }
            }
        }

        if (changed) {
            await client.query('UPDATE relations SET geometry = $1 WHERE osm_id = $2',
                [JSON.stringify(geo), r.osm_id]);
            updated++;
        }
    }

    console.log(`\n=== Resultado ===`);
    console.log(`  Actualizadas: ${updated}/${needUpdate.length}`);
    console.log(`  Ways con node IDs: ${wayNodeMap.size}/${allWayIds.size}`);

    await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
