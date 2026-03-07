/**
 * Validate PTv2 compliance for all route relations.
 * Updates ptv2_valid and ptv2_errors columns in the database.
 *
 * Usage: node scripts/validate-ptv2.js --region boyaca
 *
 * PTv2 checks:
 * - Has ref tag
 * - Has name tag
 * - Has from/to tags
 * - Has operator tag
 * - Has network tag
 * - Has public_transport:version = 2
 * - Has at least 1 stop member (role=stop)
 * - Has at least 1 way member
 * - Has a parent route_master
 * - Members are ordered: stops first, then ways (PTv2 convention)
 */
require('dotenv').config();
const { Client } = require('pg');
const path = require('path');

const REGIONS = require(path.join(__dirname, '..', 'regions.json'));

function validateRelation(relation, members) {
    const errors = [];
    const tags = typeof relation.tags === 'string' ? JSON.parse(relation.tags) : (relation.tags || {});

    // Required tags
    if (!relation.ref) errors.push('sin ref');
    if (!relation.name) errors.push('sin name');
    if (!relation.from) errors.push('sin from');
    if (!relation.to) errors.push('sin to');
    if (!relation.operator) errors.push('sin operator');
    if (!relation.network) errors.push('sin network');

    // PTv2 tag
    if (tags['public_transport:version'] !== '2') errors.push('sin public_transport:version=2');

    // Route type tag
    if (!tags['route']) errors.push('sin route tag');

    // Stops
    if (relation.stop_count === 0) {
        errors.push('sin paradas (stop members)');
    }

    // Ways
    if (relation.way_count === 0) {
        errors.push('sin vias (way members)');
    }

    // Route master
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

    // Get all route relations
    const { rows: relations } = await client.query(
        "SELECT * FROM relations WHERE region = $1 AND osm_type = 'route' ORDER BY ref",
        [regionArg]
    );

    console.log(`Validando ${relations.length} rutas en ${region.name}...\n`);

    const summary = { valid: 0, invalid: 0, errorCounts: {} };

    for (const rel of relations) {
        // Get members for this relation
        const { rows: members } = await client.query(
            'SELECT * FROM relation_members WHERE relation_osm_id = $1 ORDER BY sequence',
            [rel.osm_id]
        );

        const result = validateRelation(rel, members);

        // Update DB
        await client.query(
            'UPDATE relations SET ptv2_valid = $1, ptv2_errors = $2 WHERE osm_id = $3',
            [result.valid, result.errors, rel.osm_id]
        );

        if (result.valid) {
            summary.valid++;
        } else {
            summary.invalid++;
            for (const err of result.errors) {
                summary.errorCounts[err] = (summary.errorCounts[err] || 0) + 1;
            }
        }
    }

    // Print summary
    console.log('=== Resultado de validacion PTv2 ===');
    console.log(`  Validas:   ${summary.valid}/${relations.length}`);
    console.log(`  Invalidas: ${summary.invalid}/${relations.length}`);
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
