/**
 * Validate PTv2 compliance for all route relations.
 * Updates ptv2_valid and ptv2_errors columns in the database.
 *
 * Usage: node scripts/validate-ptv2.js --region boyaca
 *
 * PTv2 checks:
 * Tag checks:
 *   - Has ref, name, from, to, operator, network tags
 *   - Has public_transport:version = 2
 *   - Has route tag
 * Structure checks:
 *   - Has at least 1 stop member (role=stop)
 *   - Has at least 1 way member
 *   - Has a parent route_master
 *   - Members ordered: stops first, then ways (PTv2 convention)
 * Geometry checks (inspired by JOSM PT_Assistant):
 *   - Way continuity: consecutive ways share endpoint nodes
 *   - Gap count and locations
 *   - Duplicate ways in relation
 *   - Duplicate stops in relation
 */
require('dotenv').config();
const { Client } = require('pg');
const path = require('path');

const REGIONS = require(path.join(__dirname, '..', 'regions.json'));

// Coordinate comparison tolerance (~1cm)
const COORD_EPSILON = 0.0000001;

function coordsEqual(a, b) {
    return Math.abs(a[0] - b[0]) < COORD_EPSILON && Math.abs(a[1] - b[1]) < COORD_EPSILON;
}

function validateRelation(relation, members, geometry) {
    const errors = [];
    const tags = typeof relation.tags === 'string' ? JSON.parse(relation.tags) : (relation.tags || {});

    // === TAG CHECKS ===
    if (!relation.ref) errors.push('sin ref');
    if (!relation.name) errors.push('sin name');
    if (!relation.from) errors.push('sin from');
    if (!relation.to) errors.push('sin to');
    if (!relation.operator) errors.push('sin operator');
    if (!relation.network) errors.push('sin network');

    if (tags['public_transport:version'] !== '2') errors.push('sin public_transport:version=2');
    if (!tags['route']) errors.push('sin route tag');

    // === STRUCTURE CHECKS ===
    if (relation.stop_count === 0) {
        errors.push('sin paradas (stop members)');
    }
    if (relation.way_count === 0) {
        errors.push('sin vias (way members)');
    }
    if (!relation.route_master_id) {
        errors.push('sin route_master');
    }

    // Member ordering: stops should come before ways in PTv2
    if (members.length > 0) {
        let lastStopSeq = -1;
        let firstWaySeq = Infinity;

        for (const m of members) {
            if (m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only') {
                lastStopSeq = Math.max(lastStopSeq, m.sequence);
            }
            if (m.member_type === 'way' && m.role === '') {
                firstWaySeq = Math.min(firstWaySeq, m.sequence);
            }
        }

        if (lastStopSeq > firstWaySeq && lastStopSeq !== -1 && firstWaySeq !== Infinity) {
            errors.push('orden incorrecto: paradas mezcladas con vias');
        }
    }

    // === DUPLICATE CHECKS ===
    // Duplicate ways
    const wayMembers = members.filter(m => m.member_type === 'way' && m.role === '');
    const wayIds = wayMembers.map(m => m.member_osm_id);
    const wayIdSet = new Set();
    const duplicateWays = new Set();
    for (const id of wayIds) {
        if (wayIdSet.has(id)) duplicateWays.add(id);
        wayIdSet.add(id);
    }
    if (duplicateWays.size > 0) {
        errors.push(`${duplicateWays.size} via(s) duplicada(s): ${[...duplicateWays].join(', ')}`);
    }

    // Duplicate stops
    const stopMembers = members.filter(m =>
        m.role === 'stop' || m.role === 'stop_entry_only' || m.role === 'stop_exit_only'
    );
    const stopIds = stopMembers.map(m => m.member_osm_id);
    const stopIdSet = new Set();
    const duplicateStops = new Set();
    for (const id of stopIds) {
        if (stopIdSet.has(id)) duplicateStops.add(id);
        stopIdSet.add(id);
    }
    if (duplicateStops.size > 0) {
        errors.push(`${duplicateStops.size} parada(s) duplicada(s)`);
    }

    // === GEOMETRY / CONTINUITY CHECKS ===
    if (geometry) {
        const geojson = typeof geometry === 'string' ? JSON.parse(geometry) : geometry;
        const wayFeatures = (geojson.features || []).filter(f =>
            f.geometry.type === 'LineString' && f.properties.type === 'way'
        );

        if (wayFeatures.length >= 2) {
            const gaps = [];

            for (let i = 0; i < wayFeatures.length - 1; i++) {
                const propsA = wayFeatures[i].properties;
                const propsB = wayFeatures[i + 1].properties;

                let connected = false;

                // Prefer node ID comparison (exact, no false positives)
                if (propsA.firstNode && propsA.lastNode && propsB.firstNode && propsB.lastNode) {
                    connected =
                        propsA.lastNode === propsB.firstNode ||
                        propsA.lastNode === propsB.lastNode ||
                        propsA.firstNode === propsB.firstNode ||
                        propsA.firstNode === propsB.lastNode;
                } else {
                    // Fallback to coordinate comparison
                    const coordsA = wayFeatures[i].geometry.coordinates;
                    const coordsB = wayFeatures[i + 1].geometry.coordinates;
                    connected =
                        coordsEqual(coordsA[coordsA.length - 1], coordsB[0]) ||
                        coordsEqual(coordsA[coordsA.length - 1], coordsB[coordsB.length - 1]) ||
                        coordsEqual(coordsA[0], coordsB[0]) ||
                        coordsEqual(coordsA[0], coordsB[coordsB.length - 1]);
                }

                if (!connected) {
                    gaps.push({
                        index: i,
                        wayA: propsA.id,
                        wayB: propsB.id
                    });
                }
            }

            if (gaps.length > 0) {
                errors.push(`${gaps.length} brecha(s) de continuidad`);
                const detail = gaps.slice(0, 3).map(g =>
                    `gap entre way/${g.wayA} y way/${g.wayB}`
                );
                for (const d of detail) {
                    errors.push(d);
                }
                if (gaps.length > 3) {
                    errors.push(`... y ${gaps.length - 3} brechas mas`);
                }
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

async function main() {
    const regionArg = process.argv.find(a => a.startsWith('--region='))?.split('=')[1]
        || process.argv[process.argv.indexOf('--region') + 1]
        || 'boyaca';

    const region = REGIONS[regionArg];
    if (!region) { console.error('Region desconocida:', regionArg); process.exit(1); }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    // Get all route relations (including cached geometry)
    const { rows: relations } = await client.query(
        "SELECT *, geometry FROM relations WHERE region = $1 AND osm_type = 'route' ORDER BY ref",
        [regionArg]
    );

    console.log(`Validando ${relations.length} rutas en ${region.name}...\n`);

    const summary = { valid: 0, invalid: 0, errorCounts: {}, gapRoutes: 0 };

    for (const rel of relations) {
        // Get members for this relation
        const { rows: members } = await client.query(
            'SELECT * FROM relation_members WHERE relation_osm_id = $1 ORDER BY sequence',
            [rel.osm_id]
        );

        const result = validateRelation(rel, members, rel.geometry);

        // Update DB
        await client.query(
            'UPDATE relations SET ptv2_valid = $1, ptv2_errors = $2 WHERE osm_id = $3',
            [result.valid, result.errors, rel.osm_id]
        );

        if (result.valid) {
            summary.valid++;
        } else {
            summary.invalid++;
            let hasGap = false;
            for (const err of result.errors) {
                summary.errorCounts[err] = (summary.errorCounts[err] || 0) + 1;
                if (err.includes('brecha')) hasGap = true;
            }
            if (hasGap) summary.gapRoutes++;
        }
    }

    // Print summary
    console.log('=== Resultado de validacion PTv2 ===');
    console.log(`  Validas:   ${summary.valid}/${relations.length}`);
    console.log(`  Invalidas: ${summary.invalid}/${relations.length}`);
    console.log(`  Con brechas de continuidad: ${summary.gapRoutes}`);
    console.log(`\n--- Errores mas comunes ---`);

    const sorted = Object.entries(summary.errorCounts).sort((a, b) => b[1] - a[1]);
    for (const [err, count] of sorted) {
        const pct = ((count / relations.length) * 100).toFixed(0);
        const bar = '#'.repeat(Math.round(count / relations.length * 30));
        console.log(`  ${String(count).padStart(3)} (${pct.padStart(3)}%) ${bar} ${err}`);
    }

    await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
