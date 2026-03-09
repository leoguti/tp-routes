// Valhalla API integration
// VALHALLA_URL is defined in regions.js (loaded before this file)

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
 * Encode coordinates to Valhalla polyline (precision 6)
 */
function encodePolyline(coords) {
    let encoded = '';
    let prevLat = 0;
    let prevLon = 0;
    for (const [lat, lon] of coords) {
        const latInt = Math.round(lat * 1e6);
        const lonInt = Math.round(lon * 1e6);
        encoded += encodeValue(latInt - prevLat);
        encoded += encodeValue(lonInt - prevLon);
        prevLat = latInt;
        prevLon = lonInt;
    }
    return encoded;
}

function encodeValue(value) {
    value = value < 0 ? ~(value << 1) : (value << 1);
    let encoded = '';
    while (value >= 0x20) {
        encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
        value >>= 5;
    }
    encoded += String.fromCharCode(value + 63);
    return encoded;
}

/**
 * Two-step approach: /route for geometry, /trace_attributes for way IDs
 * Step 1: Get route geometry (dense polyline) via /route
 * Step 2: Feed that geometry to /trace_attributes to get way IDs
 */
async function getRouteFromValhalla(points) {
    const locations = points.map(p => ({ lat: p.lat, lon: p.lon }));

    try {
        // Step 1: Get route geometry
        const routeResponse = await fetch(`${VALHALLA_URL}/route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                locations: locations,
                costing: 'auto',
                directions_options: { units: 'kilometers' }
            })
        });

        const routeData = await routeResponse.json();
        if (routeData.error) {
            return { error: routeData.error };
        }

        // Combine all legs into one polyline
        let routeCoords = [];
        for (const leg of routeData.trip.legs) {
            routeCoords = routeCoords.concat(decodePolyline(leg.shape));
        }
        const summary = routeData.trip.summary;

        // Step 2: Use the dense route geometry to get way IDs via trace_attributes
        // Sample points from the route (every Nth point to keep it manageable)
        const step = Math.max(1, Math.floor(routeCoords.length / 100));
        const sampledCoords = [];
        for (let i = 0; i < routeCoords.length; i += step) {
            sampledCoords.push(routeCoords[i]);
        }
        // Always include last point
        const last = routeCoords[routeCoords.length - 1];
        if (sampledCoords[sampledCoords.length - 1] !== last) {
            sampledCoords.push(last);
        }

        const sampledShape = sampledCoords.map(c => ({ lat: c[0], lon: c[1] }));

        const traceResponse = await fetch(`${VALHALLA_URL}/trace_attributes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shape: sampledShape,
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

        const traceData = await traceResponse.json();

        if (traceData.error) {
            // If trace_attributes fails, return route geometry without way IDs
            console.warn('trace_attributes failed, using route geometry only:', traceData.error);
            return {
                edges: [],
                shape: routeCoords,
                wayIds: [],
                distance: summary.length,
                time: summary.time,
                error: null,
                warning: 'Ruta calculada pero sin way IDs. ' + traceData.error
            };
        }

        const result = processValhallaResponse(traceData);
        // Use route shape for display (smoother) but trace_attributes for way IDs
        result.shape = routeCoords;
        result.distance = summary.length;
        result.time = summary.time;
        return result;

    } catch (err) {
        return { error: `Error de conexión con Valhalla: ${err.message}` };
    }
}

/**
 * Process Valhalla trace_attributes response
 */
function processValhallaResponse(data) {
    const edges = data.edges || [];

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
        shape: [],
        wayIds: wayIds,
        error: null
    };
}
