/**
 * Setup database schema for transport-routes project
 * Usage: node scripts/setup-db.js
 */
require('dotenv').config();
const { Client } = require('pg');

const SCHEMA = `
-- Enable PostGIS-like extensions if available (Neon supports these)
-- For now we store coords as DOUBLE PRECISION (lat/lon)

-- OSM PT relations (route and route_master)
CREATE TABLE IF NOT EXISTS relations (
    id SERIAL PRIMARY KEY,
    osm_id BIGINT UNIQUE NOT NULL,          -- OSM relation ID
    osm_type VARCHAR(20) NOT NULL,          -- 'route' or 'route_master'
    route_type VARCHAR(20) DEFAULT 'bus',   -- bus, trolleybus, tram, etc.
    ref VARCHAR(50),                        -- Route reference (e.g., "T01")
    name VARCHAR(255),
    "from" VARCHAR(255),
    "to" VARCHAR(255),
    operator VARCHAR(255),
    network VARCHAR(255),
    colour VARCHAR(20),
    region VARCHAR(50) NOT NULL,            -- 'boyaca', 'cochabamba', etc.
    ptv2_valid BOOLEAN DEFAULT FALSE,       -- Passes PTv2 validation?
    ptv2_errors TEXT[],                     -- Validation error messages
    route_master_id BIGINT,                 -- Parent route_master OSM ID (for routes)
    member_count INTEGER DEFAULT 0,         -- Total members in relation
    stop_count INTEGER DEFAULT 0,           -- Number of stop members
    way_count INTEGER DEFAULT 0,            -- Number of way members
    distance_km DOUBLE PRECISION,           -- Route length in km
    last_synced_at TIMESTAMPTZ,             -- When we last fetched from Overpass
    osm_timestamp TIMESTAMPTZ,             -- Last edit timestamp in OSM
    tags JSONB DEFAULT '{}',               -- All OSM tags as JSON
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stops (public_transport=stop_position or highway=bus_stop)
CREATE TABLE IF NOT EXISTS stops (
    id SERIAL PRIMARY KEY,
    osm_id BIGINT UNIQUE NOT NULL,          -- OSM node ID
    name VARCHAR(255),
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    region VARCHAR(50) NOT NULL,
    stop_type VARCHAR(30),                  -- 'stop_position', 'platform', 'bus_stop'
    tags JSONB DEFAULT '{}',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relation members (stops and ways belonging to a relation)
CREATE TABLE IF NOT EXISTS relation_members (
    id SERIAL PRIMARY KEY,
    relation_osm_id BIGINT NOT NULL,        -- FK to relations.osm_id
    member_type VARCHAR(10) NOT NULL,       -- 'node', 'way'
    member_osm_id BIGINT NOT NULL,
    role VARCHAR(50),                       -- 'stop', 'platform', '' (way), etc.
    sequence INTEGER NOT NULL,              -- Order in the relation
    UNIQUE(relation_osm_id, member_osm_id, role)
);

-- Sync log: track when each region/zone was last synced with Overpass
CREATE TABLE IF NOT EXISTS sync_log (
    id SERIAL PRIMARY KEY,
    region VARCHAR(50) NOT NULL,
    query_type VARCHAR(50) NOT NULL,        -- 'relations', 'stops', 'full'
    bbox TEXT,                              -- Bounding box used
    relations_found INTEGER DEFAULT 0,
    stops_found INTEGER DEFAULT 0,
    duration_ms INTEGER,
    status VARCHAR(20) DEFAULT 'success',   -- 'success', 'error'
    error_message TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_relations_region ON relations(region);
CREATE INDEX IF NOT EXISTS idx_relations_osm_type ON relations(osm_type);
CREATE INDEX IF NOT EXISTS idx_relations_route_master ON relations(route_master_id);
CREATE INDEX IF NOT EXISTS idx_stops_region ON stops(region);
CREATE INDEX IF NOT EXISTS idx_stops_coords ON stops(lat, lon);
CREATE INDEX IF NOT EXISTS idx_relation_members_relation ON relation_members(relation_osm_id);
CREATE INDEX IF NOT EXISTS idx_relation_members_member ON relation_members(member_osm_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_region ON sync_log(region);
`;

async function setup() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });

    try {
        await client.connect();
        console.log('Conectado a Neon PostgreSQL');

        await client.query(SCHEMA);
        console.log('Esquema creado exitosamente');

        // Verify tables
        const res = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        console.log('\nTablas creadas:');
        res.rows.forEach(r => console.log('  -', r.table_name));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await client.end();
    }
}

setup();
