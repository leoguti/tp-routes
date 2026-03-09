// TP Routes - Edit Existing Route (v2)

// State
const state = {
    points: [],
    routeLayer: null,     // Valhalla calculated route (red)
    originalLayer: null,  // Original OSM route (blue)
    originalGeojson: null,
    wayIds: [],
    mode: 'waypoint',
    nextId: 1,
    dragSrcIdx: null,
    relationOsmId: null
};

// Parse URL params
const params = new URLSearchParams(window.location.search);
const relationId = params.get('relation');
const activeRegionKey = params.get('region') || getCurrentRegion();
const activeRegion = REGIONS[activeRegionKey];

// Back link
document.getElementById('btn-back').href = `explorer.html?region=${activeRegionKey}`;

// Region bounds
const regionBounds = L.latLngBounds(
    L.latLng(activeRegion.bounds[0][0], activeRegion.bounds[0][1]),
    L.latLng(activeRegion.bounds[1][0], activeRegion.bounds[1][1])
);

// Map setup
const map = L.map('map', {
    zoomControl: true,
    maxBounds: regionBounds.pad(0.1),
    maxBoundsViscosity: 1.0,
    minZoom: 8
}).setView(activeRegion.center, activeRegion.zoom);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
}).addTo(map);

// Populate region selector
const regionSelect = document.getElementById('region-select');
for (const [key, region] of Object.entries(REGIONS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = region.name;
    opt.selected = key === activeRegionKey;
    regionSelect.appendChild(opt);
}
regionSelect.addEventListener('change', (e) => {
    const p = new URLSearchParams(window.location.search);
    p.set('region', e.target.value);
    window.location.search = p.toString();
});

// Icons (reuse from v0.1)
function createStopIcon(number, role) {
    let color = '#e74c3c';
    if (role === 'start') color = '#27ae60';
    if (role === 'end') color = '#8e44ad';
    return L.divIcon({
        className: '',
        html: `<div class="stop-marker" style="background:${color}">${number}</div>`,
        iconSize: [28, 28], iconAnchor: [14, 14]
    });
}

function createWaypointIcon(number) {
    return L.divIcon({
        className: '',
        html: `<div class="waypoint-marker">W${number}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11]
    });
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function findBestInsertionIndex(lat, lon) {
    if (state.points.length < 2) return state.points.length;
    let bestIdx = state.points.length, bestCost = Infinity;
    for (let i = 0; i < state.points.length - 1; i++) {
        const a = state.points[i], b = state.points[i+1];
        const cost = haversine(a.lat, a.lon, lat, lon) + haversine(lat, lon, b.lat, b.lon) - haversine(a.lat, a.lon, b.lat, b.lon);
        if (cost < bestCost) { bestCost = cost; bestIdx = i + 1; }
    }
    return bestIdx;
}

// Mode
function setMode(mode) {
    state.mode = mode;
    const indicator = document.getElementById('mode-indicator');
    indicator.textContent = mode === 'stop' ? 'Modo: Parada' : 'Modo: Waypoint';
    indicator.className = mode === 'stop' ? 'mode-indicator stop-mode' : 'mode-indicator waypoint-mode';
    updateInstructions();
}

function updateInstructions() {
    const el = document.getElementById('instructions');
    if (state.mode === 'stop') {
        el.textContent = 'Clic = agregar parada | W = modo waypoint';
    } else {
        el.textContent = 'Clic = agregar waypoint | S = modo parada | Arrastra puntos para ajustar';
    }
}

// Add point
function addPoint(lat, lon, type, name) {
    const id = state.nextId++;
    const stopCount = state.points.filter(p => p.type === 'stop').length;
    const wpCount = state.points.filter(p => p.type === 'waypoint').length;

    const marker = L.marker([lat, lon], {
        icon: type === 'stop' ? createStopIcon(stopCount + 1) : createWaypointIcon(wpCount + 1),
        draggable: true
    }).addTo(map);

    const point = { id, lat, lon, type, name: name || '', marker };

    marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        point.lat = pos.lat;
        point.lon = pos.lng;
        autoRecalculate();
    });

    if (type === 'stop') {
        marker.bindPopup(() => {
            const input = document.createElement('input');
            input.type = 'text'; input.value = point.name;
            input.style.cssText = 'width:180px;padding:4px;border:1px solid #ccc;border-radius:3px;';
            input.addEventListener('change', () => { point.name = input.value; updateStopList(); });
            const div = document.createElement('div');
            div.appendChild(input);
            return div;
        });
    }

    if (state.points.length < 2) {
        state.points.push(point);
    } else {
        state.points.splice(findBestInsertionIndex(lat, lon), 0, point);
    }

    renumberStops();
    updateStopList();
    updateButtons();
    updateInstructions();
    autoRecalculate();
    return point;
}

function movePoint(id, direction) {
    const idx = state.points.findIndex(p => p.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= state.points.length) return;
    [state.points[idx], state.points[newIdx]] = [state.points[newIdx], state.points[idx]];
    renumberStops(); updateStopList(); autoRecalculate();
}

function removePoint(id) {
    const idx = state.points.findIndex(p => p.id === id);
    if (idx === -1) return;
    map.removeLayer(state.points[idx].marker);
    state.points.splice(idx, 1);
    renumberStops(); updateStopList(); updateButtons(); autoRecalculate();
}

function renumberStops() {
    const stops = state.points.filter(p => p.type === 'stop');
    let stopNum = 1, wpNum = 1;
    for (const p of state.points) {
        if (p.type === 'stop') {
            let role = 'intermediate';
            if (stopNum === 1) role = 'start';
            else if (stopNum === stops.length) role = 'end';
            p.marker.setIcon(createStopIcon(stopNum, role));
            stopNum++;
        } else {
            p.marker.setIcon(createWaypointIcon(wpNum));
            wpNum++;
        }
    }
}

function updateStopList() {
    const list = document.getElementById('stop-list');
    list.innerHTML = '';
    state.points.forEach((point, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;

        li.addEventListener('dragstart', (e) => { state.dragSrcIdx = index; li.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; });
        li.addEventListener('dragend', () => { li.style.opacity = '1'; });
        li.addEventListener('dragover', (e) => { e.preventDefault(); li.style.borderTop = '2px solid #4a90d9'; });
        li.addEventListener('dragleave', () => { li.style.borderTop = ''; });
        li.addEventListener('drop', (e) => {
            e.preventDefault(); li.style.borderTop = '';
            const fromIdx = state.dragSrcIdx, toIdx = index;
            if (fromIdx === toIdx) return;
            const [moved] = state.points.splice(fromIdx, 1);
            state.points.splice(toIdx, 0, moved);
            renumberStops(); updateStopList(); autoRecalculate();
        });

        const num = document.createElement('span');
        if (point.type === 'stop') {
            const stops = state.points.filter(p => p.type === 'stop');
            const si = stops.indexOf(point) + 1;
            num.className = 'stop-number';
            if (si === 1) num.style.background = '#27ae60';
            else if (si === stops.length) num.style.background = '#8e44ad';
            num.textContent = si;
        } else {
            num.className = 'stop-number waypoint';
            num.textContent = 'W' + (state.points.filter(p => p.type === 'waypoint').indexOf(point) + 1);
        }

        const nameInput = document.createElement('input');
        nameInput.className = 'stop-name';
        nameInput.value = point.name;
        nameInput.placeholder = point.type === 'stop' ? 'Nombre de parada' : 'Waypoint';
        nameInput.addEventListener('change', () => { point.name = nameInput.value; });

        const locateBtn = document.createElement('button');
        locateBtn.className = 'stop-btn'; locateBtn.innerHTML = '&#9678;'; locateBtn.title = 'Centrar';
        locateBtn.addEventListener('click', () => { map.setView([point.lat, point.lon], 16); });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'stop-btn delete-btn'; deleteBtn.innerHTML = '&times;'; deleteBtn.title = 'Eliminar';
        deleteBtn.addEventListener('click', () => removePoint(point.id));

        li.appendChild(num);
        li.appendChild(nameInput);
        li.appendChild(locateBtn);
        li.appendChild(deleteBtn);
        list.appendChild(li);
    });
}

function updateButtons() {
    const stops = state.points.filter(p => p.type === 'stop');
    document.getElementById('btn-calculate').disabled = state.points.length < 2;
    document.getElementById('btn-download').disabled = state.wayIds.length === 0;
    const sc = stops.length, wc = state.points.filter(p => p.type === 'waypoint').length;
    let text = `${sc} parada${sc !== 1 ? 's' : ''}`;
    if (wc > 0) text += `, ${wc} wp`;
    document.getElementById('point-count').textContent = text;
}

function setStatus(msg, type) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = type || '';
}

function clearRoute() {
    if (state.routeLayer) { map.removeLayer(state.routeLayer); state.routeLayer = null; }
    state.wayIds = [];
    updateButtons();
}

let recalcTimer = null;
function autoRecalculate() {
    if (window._suppressRecalc) return;
    clearRoute();
    if (state.points.length >= 2) {
        clearTimeout(recalcTimer);
        recalcTimer = setTimeout(() => calculateRoute(false), 400);
    }
}

// Add point without triggering auto-recalculate
function addPointSilent(lat, lon, type, name) {
    const id = state.nextId++;
    const stopCount = state.points.filter(p => p.type === 'stop').length;
    const wpCount = state.points.filter(p => p.type === 'waypoint').length;

    const marker = L.marker([lat, lon], {
        icon: type === 'stop' ? createStopIcon(stopCount + 1) : createWaypointIcon(wpCount + 1),
        draggable: true
    }).addTo(map);

    const point = { id, lat, lon, type, name: name || '', marker };

    marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        point.lat = pos.lat;
        point.lon = pos.lng;
        autoRecalculate();
    });

    state.points.push(point);
    return point;
}

async function calculateRoute(fitMap = false) {
    if (state.points.length < 2) return;
    setStatus(`Calculando ruta con Valhalla (${state.points.length} puntos)...`, 'loading');
    document.getElementById('btn-calculate').disabled = true;

    const points = state.points.map(p => ({ lat: p.lat, lon: p.lon, type: p.type }));

    console.log(`[Editor v2] Calling Valhalla with ${points.length} points, URL: ${VALHALLA_URL}`);
    const result = await getRouteFromValhalla(points);
    console.log('[Editor v2] Valhalla result:', result);

    if (result.error) {
        setStatus(`Error Valhalla: ${result.error}`, 'error');
        document.getElementById('btn-calculate').disabled = false;
        return;
    }

    if (state.routeLayer) map.removeLayer(state.routeLayer);
    const latLngs = result.shape.map(c => [c[0], c[1]]);
    state.routeLayer = L.polyline(latLngs, { color: '#e74c3c', weight: 5, opacity: 0.8 }).addTo(map);
    state.wayIds = result.wayIds;

    if (fitMap && latLngs.length > 0) {
        map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
    }

    const totalKm = (result.distance || 0).toFixed(1);
    setStatus(`Ruta calculada: ${totalKm} km, ${result.wayIds.length} vias`, 'success');
    updateButtons();
    updateMatchInfo();
}

// Compare original vs calculated route
function updateMatchInfo() {
    const el = document.getElementById('match-info');
    if (!state.originalGeojson || state.wayIds.length === 0) {
        el.style.display = 'none';
        return;
    }

    const originalWayIds = new Set(
        state.originalGeojson.features
            .filter(f => f.properties.type === 'way')
            .map(f => f.properties.id)
    );
    const calculatedWayIds = new Set(state.wayIds.map(w => w.wayId));

    const shared = [...originalWayIds].filter(id => calculatedWayIds.has(id)).length;
    const total = new Set([...originalWayIds, ...calculatedWayIds]).size;
    const pct = total > 0 ? Math.round(shared / total * 100) : 0;

    el.style.display = 'block';
    el.className = 'match-info ' + (pct >= 80 ? 'match-good' : pct >= 50 ? 'match-warn' : 'match-bad');
    el.innerHTML = `
        <strong>${pct}% coincidencia</strong><br>
        ${shared} vias compartidas de ${total} totales<br>
        Original: ${originalWayIds.size} vias | Calculada: ${calculatedWayIds.size} vias
    `;
}

// Download .osm
function downloadOsm() {
    const ref = document.getElementById('route-ref').value.trim();
    const from = document.getElementById('route-from').value.trim();
    const to = document.getElementById('route-to').value.trim();
    const operator = document.getElementById('route-operator').value.trim();
    const network = document.getElementById('route-network').value.trim();
    const osmId = document.getElementById('relation-osm-id').value;

    const missing = [];
    if (!ref) missing.push('Referencia');
    if (!operator) missing.push('Operador');
    if (!from) missing.push('Desde');
    if (!to) missing.push('Hasta');
    if (missing.length > 0) {
        setStatus(`Faltan: ${missing.join(', ')}`, 'error');
        return;
    }

    const routeInfo = { ref, name: `${ref} - ${from} - ${to}`, from, to, operator, network };
    const stops = state.points.filter(p => p.type === 'stop').map(p => ({ lat: p.lat, lon: p.lon, name: p.name }));

    // Use existing OSM ID for the relation (modify, not create)
    const osmContent = generateOsmFileForExisting(routeInfo, stops, state.wayIds, osmId);
    const filename = `ruta_${ref}_${from}_${to}.osm`.replace(/\s+/g, '_').toLowerCase();
    downloadFile(osmContent, filename);
    setStatus(`Descargado: ${filename}`, 'success');
}

// Generate .osm that modifies existing relation
function generateOsmFileForExisting(routeInfo, stops, wayIds, existingOsmId) {
    const now = new Date().toISOString().split('T')[0];
    let nodeId = -1;
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<osm version="0.6" generator="TP Routes Editor v2">\n';
    xml += '  <changeset>\n';
    xml += `    <tag k="comment" v="Update bus route ${routeInfo.ref || ''} (${routeInfo.from || ''} - ${routeInfo.to || ''}) PTv2 #tp-routes"/>\n`;
    xml += `    <tag k="source" v="TP Routes - Editor v2"/>\n`;
    xml += `    <tag k="hashtags" v="#tp-routes"/>\n`;
    xml += '  </changeset>\n\n';

    // Stop nodes (new)
    const stopNodeIds = [];
    for (const stop of stops) {
        const id = nodeId--;
        stopNodeIds.push(id);
        xml += `  <node id="${id}" lat="${stop.lat.toFixed(7)}" lon="${stop.lon.toFixed(7)}" version="0">\n`;
        xml += `    <tag k="public_transport" v="stop_position"/>\n`;
        xml += `    <tag k="bus" v="yes"/>\n`;
        if (stop.name) xml += `    <tag k="name" v="${escapeXml(stop.name)}"/>\n`;
        xml += '  </node>\n';
    }
    xml += '\n';

    // Relation (modify existing)
    const relId = existingOsmId || '-1';
    xml += `  <relation id="${relId}" action="modify">\n`;
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

    for (let i = 0; i < stopNodeIds.length; i++) {
        xml += `    <member type="node" ref="${stopNodeIds[i]}" role="stop"/>\n`;
    }
    for (const way of wayIds) {
        xml += `    <member type="way" ref="${way.wayId}" role=""/>\n`;
    }

    xml += '  </relation>\n';
    xml += '</osm>\n';
    return xml;
}

// Clear all points and reload waypoints from original
function resetWaypoints() {
    for (const p of state.points) map.removeLayer(p.marker);
    state.points = [];
    state.nextId = 1;
    clearRoute();
    if (state.originalGeojson) {
        loadSmartWaypoints(state.originalGeojson);
    }
    updateStopList();
    updateButtons();
}

// Load smart waypoints from geojson (without triggering recalculation for each one)
function loadSmartWaypoints(geojson) {
    const angle = parseInt(document.getElementById('wp-density').value) || 30;
    const waypoints = extractSmartWaypoints(geojson, {
        angleThreshold: angle,
        maxDistance: 2000,
        minDistance: 100
    });

    // Valhalla has a limit of ~20 locations per request; cap waypoints
    const MAX_WAYPOINTS = 20;
    let finalWaypoints = waypoints;
    if (waypoints.length > MAX_WAYPOINTS) {
        // Downsample: keep first, last, and evenly spaced intermediate
        finalWaypoints = [waypoints[0]];
        const step = (waypoints.length - 1) / (MAX_WAYPOINTS - 1);
        for (let i = 1; i < MAX_WAYPOINTS - 1; i++) {
            finalWaypoints.push(waypoints[Math.round(i * step)]);
        }
        finalWaypoints.push(waypoints[waypoints.length - 1]);
    }

    document.getElementById('wp-count-label').textContent = `${finalWaypoints.length} waypoints`;
    document.getElementById('wp-angle-label').textContent = angle;

    // Suppress auto-recalculate while bulk-adding
    const savedAutoRecalc = autoRecalculate;
    window._suppressRecalc = true;

    for (const wp of finalWaypoints) {
        addPointSilent(wp.lat, wp.lon, 'waypoint');
    }

    window._suppressRecalc = false;
    renumberStops();
    updateStopList();
    updateButtons();

    // Single recalculate after all waypoints are added
    if (state.points.length >= 2) {
        calculateRoute(false);
    }
}

// --- Load existing relation ---
async function loadRelation(osmId) {
    try {
        // Fetch relation detail
        const detailRes = await fetch(`/api/relation/${osmId}?region=${activeRegionKey}`);
        if (!detailRes.ok) throw new Error('No se pudo cargar la relacion');
        const detail = await detailRes.json();

        // Fill form fields
        state.relationOsmId = osmId;
        document.getElementById('relation-osm-id').value = osmId;
        document.getElementById('route-ref').value = detail.ref || '';
        document.getElementById('route-from').value = detail.from || '';
        document.getElementById('route-to').value = detail.to || '';
        document.getElementById('route-operator').value = detail.operator || '';
        document.getElementById('route-network').value = detail.network || activeRegion.defaultNetwork;
        document.getElementById('panel-title').textContent =
            `Editando: ${detail.ref || ''} ${detail.name || 'Relacion ' + osmId}`;

        // Fetch geometry
        const geoRes = await fetch(`/api/geometry/${osmId}`);
        if (!geoRes.ok) throw new Error('No se pudo cargar la geometria');
        const geojson = await geoRes.json();
        state.originalGeojson = geojson;

        // Draw original route in blue (non-interactive)
        state.originalLayer = L.geoJSON(geojson, {
            style: () => ({ color: '#3388ff', weight: 6, opacity: 0.5 }),
            pointToLayer: (feature, latlng) => {
                return L.circleMarker(latlng, {
                    radius: 5, color: '#3388ff', fillColor: '#3388ff',
                    fillOpacity: 0.5, weight: 1, interactive: false
                });
            },
            interactive: false
        }).addTo(map);

        // Fit map to original route
        const bounds = state.originalLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });

        // Extract and add smart waypoints
        loadSmartWaypoints(geojson);

        // Remove loading overlay
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.remove();

        setStatus('Ruta cargada. Ajusta los waypoints y recalcula.', 'success');
        updateRouteNamePreview();

    } catch (err) {
        console.error(err);
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.textContent = `Error: ${err.message}`;
        setStatus(`Error: ${err.message}`, 'error');
    }
}

// Map click
map.on('click', (e) => addPoint(e.latlng.lat, e.latlng.lng, state.mode));

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'w' || e.key === 'W') setMode('waypoint');
    else if (e.key === 's' || e.key === 'S') setMode('stop');
    else if (e.key === 'Enter') calculateRoute(false);
    else if (e.key === 'Escape') clearRoute();
});

// Button handlers
document.getElementById('btn-calculate').addEventListener('click', () => calculateRoute(false));
document.getElementById('btn-download').addEventListener('click', downloadOsm);
document.getElementById('btn-reset-waypoints').addEventListener('click', resetWaypoints);
document.getElementById('btn-mode-stop').addEventListener('click', () => setMode('stop'));
document.getElementById('btn-mode-waypoint').addEventListener('click', () => setMode('waypoint'));

// Waypoint density slider
document.getElementById('wp-density').addEventListener('input', (e) => {
    document.getElementById('wp-angle-label').textContent = e.target.value;
});
document.getElementById('wp-density').addEventListener('change', () => {
    resetWaypoints();
});

// Route name preview
function updateRouteNamePreview() {
    const ref = document.getElementById('route-ref').value.trim();
    const from = document.getElementById('route-from').value.trim();
    const to = document.getElementById('route-to').value.trim();
    const preview = document.getElementById('route-name-preview');
    preview.textContent = (ref || from || to) ? `Nombre: ${ref||'?'} - ${from||'?'} - ${to||'?'}` : '';
}
document.getElementById('route-ref').addEventListener('input', updateRouteNamePreview);
document.getElementById('route-from').addEventListener('input', updateRouteNamePreview);
document.getElementById('route-to').addEventListener('input', updateRouteNamePreview);

// Init
updateButtons();
updateInstructions();
setMode('waypoint');

if (relationId) {
    loadRelation(relationId);
} else {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.textContent = 'No se especifico relacion. Usa ?relation=OSM_ID';
    setStatus('Falta parametro ?relation=ID en la URL', 'error');
}
