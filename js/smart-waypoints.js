// Smart Waypoints Extraction
// Extracts key waypoints from a route geometry where significant turns occur.

/**
 * Calculate bearing between two [lon, lat] points in degrees
 */
function bearing(a, b) {
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Angle difference between two bearings (0-180)
 */
function angleDiff(b1, b2) {
    let diff = Math.abs(b1 - b2) % 360;
    if (diff > 180) diff = 360 - diff;
    return diff;
}

/**
 * Haversine distance between two [lon, lat] points in meters
 */
function distanceMeters(a, b) {
    const R = 6371000;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const h = sinLat * sinLat +
        Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinLon * sinLon;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Extract smart waypoints from a GeoJSON FeatureCollection of a route.
 *
 * Algorithm:
 * 1. Flatten all way LineStrings into a single coordinate array
 * 2. Always include first and last points
 * 3. Walk the coordinates, tracking cumulative bearing changes
 * 4. When cumulative angle change exceeds threshold, add a waypoint
 * 5. Also add waypoints at regular max distance intervals
 *
 * @param {Object} geojson - FeatureCollection with LineString way features
 * @param {Object} options - { angleThreshold: degrees, maxDistance: meters, minDistance: meters }
 * @returns {Array} [{lat, lon}, ...] waypoints
 */
function extractSmartWaypoints(geojson, options = {}) {
    const angleThreshold = options.angleThreshold || 30;  // degrees
    const maxDistance = options.maxDistance || 2000;        // meters - force waypoint every N meters
    const minDistance = options.minDistance || 100;         // meters - minimum between waypoints

    // Flatten all way coordinates into a single path
    const wayFeatures = (geojson.features || []).filter(f =>
        f.geometry.type === 'LineString' && f.properties.type === 'way'
    );

    if (wayFeatures.length === 0) return [];

    // Build continuous coordinate array, avoiding duplicate points at way junctions
    const coords = [];
    for (let w = 0; w < wayFeatures.length; w++) {
        const wayCoords = wayFeatures[w].geometry.coordinates;
        for (let i = 0; i < wayCoords.length; i++) {
            if (coords.length === 0) {
                coords.push(wayCoords[i]);
            } else {
                const last = coords[coords.length - 1];
                const dist = distanceMeters(last, wayCoords[i]);
                if (dist > 0.5) { // skip duplicate points (< 0.5m)
                    coords.push(wayCoords[i]);
                }
            }
        }
    }

    if (coords.length < 2) return [];

    const waypoints = [];

    // Always add first point
    waypoints.push({ lat: coords[0][1], lon: coords[0][0] });

    let lastWpIdx = 0;
    let cumulativeAngle = 0;
    let distFromLastWp = 0;

    for (let i = 1; i < coords.length - 1; i++) {
        const segDist = distanceMeters(coords[i - 1], coords[i]);
        distFromLastWp += segDist;

        // Calculate angle change at this point
        const b1 = bearing(coords[i - 1], coords[i]);
        const b2 = bearing(coords[i], coords[i + 1]);
        const angle = angleDiff(b1, b2);
        cumulativeAngle += angle;

        const shouldAdd =
            // Significant cumulative turn
            (cumulativeAngle >= angleThreshold && distFromLastWp >= minDistance) ||
            // Max distance reached (straight road needs waypoints too)
            (distFromLastWp >= maxDistance);

        if (shouldAdd) {
            waypoints.push({ lat: coords[i][1], lon: coords[i][0] });
            lastWpIdx = i;
            cumulativeAngle = 0;
            distFromLastWp = 0;
        }
    }

    // Always add last point
    const last = coords[coords.length - 1];
    waypoints.push({ lat: last[1], lon: last[0] });

    return waypoints;
}
