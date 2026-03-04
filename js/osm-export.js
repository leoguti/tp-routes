// OSM PTv2 Export

/**
 * Generate a PTv2 .osm file from route data
 * @param {Object} routeInfo - { name, ref, from, to, operator, network }
 * @param {Array} stops - [{ lat, lon, name }, ...]
 * @param {Array} wayIds - [{ wayId, names, length }, ...]
 * @returns {string} XML content of the .osm file
 */
function generateOsmFile(routeInfo, stops, wayIds) {
    const now = new Date().toISOString().split('T')[0];
    let nodeId = -1;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<osm version="0.6" generator="TP Routes">\n';

    // Changeset
    xml += '  <changeset>\n';
    xml += `    <tag k="comment" v="Add bus route ${routeInfo.ref || ''} (${routeInfo.from || ''} - ${routeInfo.to || ''}) PTv2 #tp-routes"/>\n`;
    xml += `    <tag k="source" v="TP Routes - Mapeo de transporte público"/>\n`;
    xml += `    <tag k="hashtags" v="#tp-routes"/>\n`;
    xml += '  </changeset>\n\n';

    // Stop nodes
    const stopNodeIds = [];
    for (const stop of stops) {
        const id = nodeId--;
        stopNodeIds.push(id);
        xml += `  <node id="${id}" lat="${stop.lat.toFixed(7)}" lon="${stop.lon.toFixed(7)}" version="0">\n`;
        xml += `    <tag k="public_transport" v="stop_position"/>\n`;
        xml += `    <tag k="bus" v="yes"/>\n`;
        if (stop.name) {
            xml += `    <tag k="name" v="${escapeXml(stop.name)}"/>\n`;
        }
        xml += '  </node>\n';
    }
    xml += '\n';

    // Route relation
    xml += '  <relation id="-1" version="0" action="modify">\n';
    xml += '    <tag k="type" v="route"/>\n';
    xml += '    <tag k="route" v="bus"/>\n';
    xml += '    <tag k="public_transport:version" v="2"/>\n';
    if (routeInfo.ref) xml += `    <tag k="ref" v="${escapeXml(routeInfo.ref)}"/>\n`;
    if (routeInfo.name) xml += `    <tag k="name" v="${escapeXml(routeInfo.name)}"/>\n`;
    if (routeInfo.from) xml += `    <tag k="from" v="${escapeXml(routeInfo.from)}"/>\n`;
    if (routeInfo.to) xml += `    <tag k="to" v="${escapeXml(routeInfo.to)}"/>\n`;
    if (routeInfo.operator) xml += `    <tag k="operator" v="${escapeXml(routeInfo.operator)}"/>\n`;
    if (routeInfo.network) xml += `    <tag k="network" v="${escapeXml(routeInfo.network)}"/>\n`;
    xml += `    <tag k="check_date" v="${now}"/>\n`;

    // Stop members first (PTv2 order)
    for (let i = 0; i < stopNodeIds.length; i++) {
        xml += `    <member type="node" ref="${stopNodeIds[i]}" role="stop"/>\n`;
    }

    // Way members (empty role per PTv2)
    for (const way of wayIds) {
        xml += `    <member type="way" ref="${way.wayId}" role=""/>\n`;
    }

    xml += '  </relation>\n';
    xml += '</osm>\n';

    return xml;
}

/**
 * Generate a route_master relation wrapping multiple route variants
 * @param {Object} masterInfo - { name, ref, operator, network }
 * @param {Array} routeRelationIds - IDs of child route relations
 * @returns {string} XML for the route_master relation
 */
function generateRouteMaster(masterInfo, routeRelationIds) {
    let xml = '  <relation id="-100" version="0" action="modify">\n';
    xml += '    <tag k="type" v="route_master"/>\n';
    xml += '    <tag k="route_master" v="bus"/>\n';
    xml += '    <tag k="public_transport:version" v="2"/>\n';
    if (masterInfo.ref) xml += `    <tag k="ref" v="${escapeXml(masterInfo.ref)}"/>\n`;
    if (masterInfo.name) xml += `    <tag k="name" v="${escapeXml(masterInfo.name)}"/>\n`;
    if (masterInfo.operator) xml += `    <tag k="operator" v="${escapeXml(masterInfo.operator)}"/>\n`;
    if (masterInfo.network) xml += `    <tag k="network" v="${escapeXml(masterInfo.network)}"/>\n`;

    for (const rid of routeRelationIds) {
        xml += `    <member type="relation" ref="${rid}" role=""/>\n`;
    }

    xml += '  </relation>\n';
    return xml;
}

/**
 * Trigger download of a text file
 */
function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Escape special XML characters
 */
function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
