/**
 * Sync PT relations from Overpass API to Neon PostgreSQL
 * Uses administrative areas (not bbox) for precise regional queries.
 * Batch inserts for performance over high-latency connections.
 *
 * Usage: node scripts/sync-overpass.js --region boyaca
 */
require('dotenv').config();
const { Client } = require('pg');
const https = require('https');
const path = require('path');

const REGIONS = require(path.join(__dirname, '..', 'regions.json'));
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// --- Overpass queries using admin areas ---

function relationsQuery(region) {
    const area = region.overpassArea;
    const level = region.overpassAdminLevel;
    return `
[out:json][timeout:120];
area[name='${area}']['admin_level'='${level}']->.a;
(
  relation["type"="route"]["route"~"bus|trolleybus|minibus|share_taxi"](area.a);
  relation["type"="route_master"]["route_master"~"bus|trolleybus|minibus|share_taxi"](area.a);
);
out meta;
`;
}

function stopsQuery(region) {
    const area = region.overpassArea;
    const level = region.overpassAdminLevel;
    return `
[out:json][timeout:120];
area[name='${area}']['admin_level'='${level}']->.a;
(
  node["public_transport"="stop_position"](area.a);
  node["highway"="bus_stop"](area.a);
  node["public_transport"="platform"](area.a);
);
out meta;
`;
}

// --- HTTP helper ---

function httpPost(url, data) {
    return new Promise((resolve, reject) => {
        const body = `data=${encodeURIComponent(data)}`;
        const urlObj = new URL(url);
        const req = https.request(urlObj, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                try { resolve(JSON.parse(text)); }
                catch { reject(new Error(`Invalid JSON: ${text.substring(0, 300)}`)); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function tag(el, key) {
    return el.tags?.[key] || null;
}

// --- Batch insert helpers ---

async function batchInsertRelations(client, elements, regionKey) {
    if (elements.length === 0) return;

    // Build VALUES for batch insert
    const values = [];
    const params = [];
    let idx = 1;

    for (const el of elements) {
        const osmType = tag(el, 'type');
        const routeType = tag(el, 'route') || tag(el, 'route_master') || 'bus';
        const members = el.members || [];
        const stopCount = members.filter(m =>
            m.role === 'stop' || m.role === 'stop_exit_only' || m.role === 'stop_entry_only'
        ).length;
        const wayCount = members.filter(m => m.type === 'way').length;

        values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},$${idx+7},$${idx+8},$${idx+9},$${idx+10},$${idx+11},$${idx+12},$${idx+13},NOW(),$${idx+14},$${idx+15})`);
        params.push(
            el.id, osmType, routeType,
            tag(el, 'ref'), tag(el, 'name'), tag(el, 'from'), tag(el, 'to'),
            tag(el, 'operator'), tag(el, 'network'), tag(el, 'colour'),
            regionKey, members.length, stopCount, wayCount,
            el.timestamp || null, JSON.stringify(el.tags || {})
        );
        idx += 16;
    }

    await client.query(`
        INSERT INTO relations (
            osm_id, osm_type, route_type, ref, name, "from", "to",
            operator, network, colour, region,
            member_count, stop_count, way_count,
            last_synced_at, osm_timestamp, tags
        ) VALUES ${values.join(',')}
        ON CONFLICT (osm_id) DO UPDATE SET
            osm_type = EXCLUDED.osm_type, route_type = EXCLUDED.route_type,
            ref = EXCLUDED.ref, name = EXCLUDED.name,
            "from" = EXCLUDED."from", "to" = EXCLUDED."to",
            operator = EXCLUDED.operator, network = EXCLUDED.network,
            colour = EXCLUDED.colour,
            member_count = EXCLUDED.member_count, stop_count = EXCLUDED.stop_count,
            way_count = EXCLUDED.way_count, last_synced_at = NOW(),
            osm_timestamp = EXCLUDED.osm_timestamp, tags = EXCLUDED.tags,
            updated_at = NOW()
    `, params);
}

async function batchInsertMembers(client, elements) {
    // Delete existing members for these relations
    const relIds = elements.map(e => e.id);
    await client.query('DELETE FROM relation_members WHERE relation_osm_id = ANY($1)', [relIds]);

    // Collect all members
    const allMembers = [];
    for (const el of elements) {
        const members = el.members || [];
        for (let i = 0; i < members.length; i++) {
            allMembers.push([el.id, members[i].type, members[i].ref, members[i].role || '', i]);
        }
    }

    if (allMembers.length === 0) return 0;

    // Batch insert in chunks of 500 (PG param limit is ~65535, 5 params per row)
    const CHUNK = 500;
    for (let c = 0; c < allMembers.length; c += CHUNK) {
        const chunk = allMembers.slice(c, c + CHUNK);
        const values = [];
        const params = [];
        let idx = 1;
        for (const [relId, mType, mId, role, seq] of chunk) {
            values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4})`);
            params.push(relId, mType, mId, role, seq);
            idx += 5;
        }
        await client.query(`
            INSERT INTO relation_members (relation_osm_id, member_type, member_osm_id, role, sequence)
            VALUES ${values.join(',')}
            ON CONFLICT (relation_osm_id, sequence) DO UPDATE SET
                member_type = EXCLUDED.member_type, member_osm_id = EXCLUDED.member_osm_id, role = EXCLUDED.role
        `, params);
    }

    return allMembers.length;
}

async function batchInsertStops(client, elements, regionKey) {
    if (elements.length === 0) return;

    const CHUNK = 500;
    for (let c = 0; c < elements.length; c += CHUNK) {
        const chunk = elements.slice(c, c + CHUNK);
        const values = [];
        const params = [];
        let idx = 1;
        for (const el of chunk) {
            const stopType = tag(el, 'public_transport') || (tag(el, 'highway') === 'bus_stop' ? 'bus_stop' : null);
            values.push(`($${idx},$${idx+1},$${idx+2},$${idx+3},$${idx+4},$${idx+5},$${idx+6},NOW())`);
            params.push(el.id, tag(el, 'name'), el.lat, el.lon, regionKey, stopType, JSON.stringify(el.tags || {}));
            idx += 7;
        }
        await client.query(`
            INSERT INTO stops (osm_id, name, lat, lon, region, stop_type, tags, last_synced_at)
            VALUES ${values.join(',')}
            ON CONFLICT (osm_id) DO UPDATE SET
                name = EXCLUDED.name, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
                stop_type = EXCLUDED.stop_type, tags = EXCLUDED.tags, last_synced_at = NOW()
        `, params);
    }
}

// --- Main sync ---

async function syncRelations(client, region, regionKey) {
    const startTime = Date.now();
    console.log(`\nConsultando Overpass: relaciones PT en ${region.name}...`);

    const data = await httpPost(OVERPASS_URL, relationsQuery(region));
    const elements = data.elements || [];
    console.log(`  Encontradas: ${elements.length} relaciones`);

    // Batch insert relations (chunks of 50 to stay within param limits)
    const CHUNK = 50;
    for (let c = 0; c < elements.length; c += CHUNK) {
        const chunk = elements.slice(c, c + CHUNK);
        await batchInsertRelations(client, chunk, regionKey);
        process.stdout.write(`  Relaciones: ${Math.min(c + CHUNK, elements.length)}/${elements.length}\r`);
    }
    console.log();

    // Batch insert members
    const memberCount = await batchInsertMembers(client, elements);
    console.log(`  Miembros insertados: ${memberCount}`);

    // Link routes to route_masters
    const masters = elements.filter(e => tag(e, 'type') === 'route_master');
    for (const master of masters) {
        const childIds = (master.members || []).filter(m => m.type === 'relation').map(m => m.ref);
        if (childIds.length > 0) {
            await client.query(
                'UPDATE relations SET route_master_id = $1 WHERE osm_id = ANY($2) AND region = $3',
                [master.id, childIds, regionKey]
            );
        }
    }

    const duration = Date.now() - startTime;
    console.log(`  Completado en ${(duration / 1000).toFixed(1)}s`);
    return { count: elements.length, duration };
}

async function syncStops(client, region, regionKey) {
    const startTime = Date.now();
    console.log(`\nConsultando Overpass: paradas en ${region.name}...`);

    const data = await httpPost(OVERPASS_URL, stopsQuery(region));
    const elements = data.elements || [];
    console.log(`  Encontradas: ${elements.length} paradas`);

    await batchInsertStops(client, elements, regionKey);

    const duration = Date.now() - startTime;
    console.log(`  Completado en ${(duration / 1000).toFixed(1)}s`);
    return { count: elements.length, duration };
}

async function main() {
    const regionArg = process.argv.find(a => a.startsWith('--region='))?.split('=')[1]
        || process.argv[process.argv.indexOf('--region') + 1]
        || 'boyaca';

    const region = REGIONS[regionArg];
    if (!region) {
        console.error(`Region desconocida: ${regionArg}. Opciones: ${Object.keys(REGIONS).join(', ')}`);
        process.exit(1);
    }

    if (!region.overpassArea) {
        console.error(`Region ${regionArg} no tiene overpassArea definida en regions.json`);
        process.exit(1);
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL });

    try {
        await client.connect();
        console.log('Conectado a Neon PostgreSQL');
        console.log(`Region: ${region.name} (${regionArg})`);
        console.log(`Area Overpass: ${region.overpassArea} (admin_level=${region.overpassAdminLevel})`);

        const relResult = await syncRelations(client, region, regionArg);
        const stopResult = await syncStops(client, region, regionArg);

        // Log sync
        await client.query(`
            INSERT INTO sync_log (region, query_type, bbox, relations_found, stops_found, duration_ms, status)
            VALUES ($1, 'full', $2, $3, $4, $5, 'success')
        `, [regionArg, region.overpassArea, relResult.count, stopResult.count, relResult.duration + stopResult.duration]);

        // Summary
        console.log('\n=== Resumen ===');
        const counts = await client.query(`
            SELECT
                count(*) FILTER (WHERE osm_type = 'route_master') as masters,
                count(*) FILTER (WHERE osm_type = 'route') as routes,
                count(*) as total
            FROM relations WHERE region = $1
        `, [regionArg]);
        const stopCount = await client.query('SELECT count(*) FROM stops WHERE region = $1', [regionArg]);
        const memberCount = await client.query(`
            SELECT count(*) FROM relation_members rm
            JOIN relations r ON r.osm_id = rm.relation_osm_id
            WHERE r.region = $1
        `, [regionArg]);

        const c = counts.rows[0];
        console.log(`  route_master: ${c.masters}`);
        console.log(`  route:        ${c.routes}`);
        console.log(`  total rel:    ${c.total}`);
        console.log(`  paradas:      ${stopCount.rows[0].count}`);
        console.log(`  miembros:     ${memberCount.rows[0].count}`);

    } catch (err) {
        console.error('Error:', err.message);
        await client.query(
            `INSERT INTO sync_log (region, query_type, status, error_message) VALUES ($1, 'full', 'error', $2)`,
            [regionArg, err.message]
        ).catch(() => {});
    } finally {
        await client.end();
    }
}

main();
