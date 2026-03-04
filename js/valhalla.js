// Valhalla API integration
const VALHALLA_URL = 'https://valhalla.busboy.app';

/**
 * Decode a Valhalla encoded polyline (precision 6)
 */
function decodePolyline(encoded) {
    const inv = 1.0 / 1e6;
    const decoded = [];
    let previous = [0, 0];
    let i = 0;
    while (i < encoded.length) {
        for (let axis = 0; axis < 2; axis++) {
            let shift = 0;
            let result = 0;
            let byte;
            do {
                byte = encoded.charCodeAt(i++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            if (result & 1) result = ~result;
            result >>= 1;
            previous[axis] += result;
        }
        decoded.push([previous[0] * inv, previous[1] * inv]);
    }
    return decoded;
}

/**
 * Call Valhalla trace_attributes to get route with way IDs
 * @param {Array} points - [{lat, lon, type: 'stop'|'waypoint'}, ...]
 * @returns {Object} { edges, shape, wayIds, error }
 */
async function getRouteFromValhalla(points) {
    const shape = points.map(p => ({ lat: p.lat, lon: p.lon }));

    try {
        const response = await fetch(`${VALHALLA_URL}/trace_attributes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shape: shape,
                costing: 'bus',
                shape_match: 'map_snap',
                filters: {
                    attributes: [
                        'edge.way_id',
                        'edge.names',
                        'edge.length',
                        'edge.begin_shape_index',
                        'edge.end_shape_index',
                        'shape'
                    ],
                    action: 'include'
                }
            })
        });

        const data = await response.json();

        if (data.error) {
            // Retry with 'auto' costing if 'bus' fails
            const retryResponse = await fetch(`${VALHALLA_URL}/trace_attributes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shape: shape,
                    costing: 'auto',
                    shape_match: 'map_snap',
                    filters: {
                        attributes: [
                            'edge.way_id',
                            'edge.names',
                            'edge.length',
                            'edge.begin_shape_index',
                            'edge.end_shape_index',
                            'shape'
                        ],
                        action: 'include'
                    }
                })
            });
            const retryData = await retryResponse.json();
            if (retryData.error) {
                return { error: retryData.error };
            }
            return processValhallaResponse(retryData);
        }

        return processValhallaResponse(data);
    } catch (err) {
        return { error: `Error de conexión con Valhalla: ${err.message}` };
    }
}

/**
 * Process Valhalla trace_attributes response
 */
function processValhallaResponse(data) {
    const edges = data.edges || [];
    const shapeEncoded = data.shape || '';

    // Decode polyline for map display
    const shapeCoords = shapeEncoded ? decodePolyline(shapeEncoded) : [];

    // Deduplicate consecutive way IDs
    const wayIds = [];
    let prevWayId = null;
    for (const edge of edges) {
        const wid = edge.way_id;
        if (wid && wid !== prevWayId) {
            wayIds.push({
                wayId: wid,
                names: edge.names || [],
                length: edge.length || 0
            });
            prevWayId = wid;
        }
    }

    return {
        edges: edges,
        shape: shapeCoords,
        wayIds: wayIds,
        error: null
    };
}

/**
 * Get a simple route (for preview, without way IDs)
 */
async function getRoutePreview(points) {
    const locations = points.map(p => ({ lat: p.lat, lon: p.lon }));

    try {
        const response = await fetch(`${VALHALLA_URL}/route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                locations: locations,
                costing: 'auto',
                directions_options: { units: 'kilometers' }
            })
        });

        const data = await response.json();
        if (data.error) return { error: data.error };

        const leg = data.trip.legs[0];
        const shape = decodePolyline(leg.shape);
        const summary = data.trip.summary;

        return {
            shape: shape,
            distance: summary.length,
            time: summary.time,
            error: null
        };
    } catch (err) {
        return { error: `Error de conexión: ${err.message}` };
    }
}
