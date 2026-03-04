// TP Routes - Main Application

// State
const state = {
    points: [],          // {lat, lon, type: 'stop'|'waypoint', name, marker, id}
    routeLayer: null,    // Leaflet polyline
    wayIds: [],          // From Valhalla
    mode: 'stop',        // 'stop' or 'waypoint'
    nextId: 1,
    dragSrcIdx: null     // For drag & drop reordering
};

// Map setup
const map = L.map('map', { zoomControl: true }).setView([5.5353, -73.3678], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
}).addTo(map);

// Stop icon factory
function createStopIcon(number) {
    return L.divIcon({
        className: '',
        html: `<div class="stop-marker">${number}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
}

const waypointIcon = L.divIcon({
    className: '',
    html: '<div class="waypoint-marker"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7]
});

// Haversine distance in km
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * Find the best insertion index for a new point.
 * Inserts between the two consecutive points where adding it
 * increases total distance the least (i.e., it's "on the way").
 */
function findBestInsertionIndex(lat, lon) {
    if (state.points.length < 2) return state.points.length;

    let bestIdx = state.points.length;
    let bestCost = Infinity;

    for (let i = 0; i < state.points.length - 1; i++) {
        const a = state.points[i];
        const b = state.points[i + 1];
        // Cost = (dist A→new + dist new→B) - dist A→B
        // Lower cost = new point fits better between A and B
        const directDist = haversine(a.lat, a.lon, b.lat, b.lon);
        const detourDist = haversine(a.lat, a.lon, lat, lon) + haversine(lat, lon, b.lat, b.lon);
        const cost = detourDist - directDist;
        if (cost < bestCost) {
            bestCost = cost;
            bestIdx = i + 1;
        }
    }
    return bestIdx;
}

// Mode switching
function setMode(mode) {
    state.mode = mode;
    const indicator = document.getElementById('mode-indicator');
    if (mode === 'stop') {
        indicator.textContent = 'Modo: Parada';
        indicator.className = 'mode-indicator stop-mode';
    } else {
        indicator.textContent = 'Modo: Waypoint';
        indicator.className = 'mode-indicator waypoint-mode';
    }
    updateInstructions();
}

function updateInstructions() {
    const el = document.getElementById('instructions');
    const count = state.points.filter(p => p.type === 'stop').length;
    if (count === 0) {
        el.textContent = 'Clic en el mapa: agregar parada de INICIO';
    } else if (count === 1) {
        el.textContent = 'Clic en el mapa: agregar parada de DESTINO';
    } else if (state.mode === 'stop') {
        el.textContent = 'Clic = agregar parada intermedia (se inserta en orden) | W = modo waypoint';
    } else {
        el.textContent = 'Clic = agregar waypoint | S = modo parada';
    }
}

// Add point to map and list
function addPoint(lat, lon, type, name) {
    const id = state.nextId++;
    const stopCount = state.points.filter(p => p.type === 'stop').length;
    const defaultName = '';

    const marker = L.marker([lat, lon], {
        icon: type === 'stop' ? createStopIcon(stopCount + 1) : waypointIcon,
        draggable: true
    }).addTo(map);

    const point = {
        id, lat, lon, type,
        name: name || defaultName,
        marker
    };

    // Drag handler on map
    marker.on('dragend', function (e) {
        const pos = e.target.getLatLng();
        point.lat = pos.lat;
        point.lon = pos.lng;
        clearRoute();
    });

    // Click to select/edit
    if (type === 'stop') {
        marker.bindPopup(() => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = point.name;
            input.style.cssText = 'width:180px;padding:4px;border:1px solid #ccc;border-radius:3px;';
            input.addEventListener('change', () => {
                point.name = input.value;
                updateStopList();
            });
            const div = document.createElement('div');
            div.appendChild(input);
            return div;
        });
    }

    // Smart insertion: first two go at end, after that insert in best position
    if (state.points.length < 2) {
        state.points.push(point);
    } else {
        const idx = findBestInsertionIndex(lat, lon);
        state.points.splice(idx, 0, point);
    }

    renumberStops();
    updateStopList();
    updateButtons();
    updateInstructions();
    clearRoute();

    return point;
}

// Move point up/down in list
function movePoint(id, direction) {
    const idx = state.points.findIndex(p => p.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= state.points.length) return;

    // Swap
    [state.points[idx], state.points[newIdx]] = [state.points[newIdx], state.points[idx]];

    renumberStops();
    updateStopList();
    clearRoute();
}

// Remove point
function removePoint(id) {
    const idx = state.points.findIndex(p => p.id === id);
    if (idx === -1) return;

    const point = state.points[idx];
    map.removeLayer(point.marker);
    state.points.splice(idx, 1);

    renumberStops();
    updateStopList();
    updateButtons();
    clearRoute();
}

// Renumber stop icons only (don't rename)
function renumberStops() {
    let stopNum = 1;
    for (const p of state.points) {
        if (p.type === 'stop') {
            p.marker.setIcon(createStopIcon(stopNum));
            stopNum++;
        }
    }
}

// Update sidebar stop list
function updateStopList() {
    const list = document.getElementById('stop-list');
    list.innerHTML = '';

    state.points.forEach((point, index) => {
        const li = document.createElement('li');
        li.draggable = true;
        li.dataset.index = index;

        // Drag & drop handlers
        li.addEventListener('dragstart', (e) => {
            state.dragSrcIdx = index;
            li.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
        });
        li.addEventListener('dragend', () => {
            li.style.opacity = '1';
        });
        li.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            li.style.borderTop = '2px solid #4a90d9';
        });
        li.addEventListener('dragleave', () => {
            li.style.borderTop = '';
        });
        li.addEventListener('drop', (e) => {
            e.preventDefault();
            li.style.borderTop = '';
            const fromIdx = state.dragSrcIdx;
            const toIdx = index;
            if (fromIdx === toIdx) return;

            const [moved] = state.points.splice(fromIdx, 1);
            state.points.splice(toIdx, 0, moved);

            renumberStops();
            updateStopList();
            clearRoute();
        });

        // Number badge
        const num = document.createElement('span');
        if (point.type === 'stop') {
            const stopIdx = state.points.filter(p => p.type === 'stop').indexOf(point) + 1;
            num.className = 'stop-number';
            num.textContent = stopIdx;
        } else {
            num.className = 'stop-number waypoint';
            num.textContent = 'W';
        }

        // Name input
        const nameInput = document.createElement('input');
        nameInput.className = 'stop-name';
        nameInput.value = point.name;
        const stopIdx = state.points.filter(p => p.type === 'stop').indexOf(point) + 1;
        const totalStops = state.points.filter(p => p.type === 'stop').length;
        if (point.type === 'stop') {
            if (stopIdx === 1) nameInput.placeholder = 'Nombre del ORIGEN';
            else if (stopIdx === totalStops) nameInput.placeholder = 'Nombre del DESTINO';
            else nameInput.placeholder = 'Nombre de parada intermedia';
        } else {
            nameInput.placeholder = 'Waypoint (punto de paso)';
        }
        nameInput.addEventListener('change', () => {
            point.name = nameInput.value;
        });

        // Up/down buttons
        const upBtn = document.createElement('button');
        upBtn.className = 'stop-btn';
        upBtn.innerHTML = '&#9650;';
        upBtn.title = 'Subir';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', () => movePoint(point.id, -1));

        const downBtn = document.createElement('button');
        downBtn.className = 'stop-btn';
        downBtn.innerHTML = '&#9660;';
        downBtn.title = 'Bajar';
        downBtn.disabled = index === state.points.length - 1;
        downBtn.addEventListener('click', () => movePoint(point.id, 1));

        // Locate button
        const locateBtn = document.createElement('button');
        locateBtn.className = 'stop-btn';
        locateBtn.innerHTML = '&#9678;';
        locateBtn.title = 'Centrar en mapa';
        locateBtn.addEventListener('click', () => {
            map.setView([point.lat, point.lon], 16);
            point.marker.openPopup();
        });

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'stop-btn delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Eliminar punto';
        deleteBtn.addEventListener('click', () => removePoint(point.id));

        li.appendChild(num);
        li.appendChild(nameInput);
        li.appendChild(upBtn);
        li.appendChild(downBtn);
        li.appendChild(locateBtn);
        li.appendChild(deleteBtn);
        list.appendChild(li);
    });
}

// Update button states
function updateButtons() {
    const stops = state.points.filter(p => p.type === 'stop');
    document.getElementById('btn-calculate').disabled = stops.length < 2;
    document.getElementById('btn-download').disabled = state.wayIds.length === 0;
    document.getElementById('btn-clear').disabled = state.points.length === 0;

    const stopCount = stops.length;
    const wpCount = state.points.filter(p => p.type === 'waypoint').length;
    let text = `${stopCount} parada${stopCount !== 1 ? 's' : ''}`;
    if (wpCount > 0) text += `, ${wpCount} waypoint${wpCount !== 1 ? 's' : ''}`;
    document.getElementById('point-count').textContent = text;
}

// Set status message
function setStatus(msg, type) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = type || '';
}

// Clear route from map
function clearRoute() {
    if (state.routeLayer) {
        map.removeLayer(state.routeLayer);
        state.routeLayer = null;
    }
    state.wayIds = [];
    updateButtons();
}

// Calculate route via Valhalla
async function calculateRoute() {
    if (state.points.length < 2) return;

    setStatus('Calculando ruta con Valhalla...', 'loading');
    document.getElementById('btn-calculate').disabled = true;

    const points = state.points.map(p => ({
        lat: p.lat,
        lon: p.lon,
        type: p.type
    }));

    const result = await getRouteFromValhalla(points);

    if (result.error) {
        setStatus(`Error: ${result.error}`, 'error');
        document.getElementById('btn-calculate').disabled = false;
        return;
    }

    // Draw route on map
    if (state.routeLayer) map.removeLayer(state.routeLayer);

    const latLngs = result.shape.map(c => [c[0], c[1]]);
    state.routeLayer = L.polyline(latLngs, {
        color: '#e74c3c',
        weight: 5,
        opacity: 0.8
    }).addTo(map);

    state.wayIds = result.wayIds;

    // Fit map to route
    if (latLngs.length > 0) {
        map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
    }

    const totalKm = (result.distance || result.wayIds.reduce((sum, w) => sum + w.length, 0)).toFixed(1);
    let statusMsg = `Ruta calculada: ${totalKm} km, ${result.wayIds.length} vías OSM`;
    if (result.warning) {
        statusMsg += ` (${result.warning})`;
        setStatus(statusMsg, 'loading');
    } else {
        setStatus(statusMsg, 'success');
    }
    updateButtons();
}

// Download .osm file
function downloadOsm() {
    const routeInfo = {
        ref: document.getElementById('route-ref').value,
        name: document.getElementById('route-name').value,
        from: document.getElementById('route-from').value,
        to: document.getElementById('route-to').value,
        operator: document.getElementById('route-operator').value,
        network: document.getElementById('route-network').value
    };

    // Auto-generate name if empty
    if (!routeInfo.name && routeInfo.from && routeInfo.to) {
        routeInfo.name = `Bus ${routeInfo.ref || ''}: ${routeInfo.from} => ${routeInfo.to}`.trim();
    }

    const stops = state.points
        .filter(p => p.type === 'stop')
        .map(p => ({ lat: p.lat, lon: p.lon, name: p.name }));

    const osmContent = generateOsmFile(routeInfo, stops, state.wayIds);
    const filename = `ruta_${routeInfo.ref || 'nueva'}_${routeInfo.from || 'A'}_${routeInfo.to || 'B'}.osm`
        .replace(/\s+/g, '_').toLowerCase();

    downloadFile(osmContent, filename);
    setStatus(`Archivo descargado: ${filename}`, 'success');
}

// Clear all
function clearAll() {
    for (const point of state.points) {
        map.removeLayer(point.marker);
    }
    state.points = [];
    state.nextId = 1;
    clearRoute();
    updateStopList();
    updateButtons();
    setStatus('Todo limpio. Comienza agregando paradas.', '');
    updateInstructions();
}

// Map click handler
map.on('click', function (e) {
    addPoint(e.latlng.lat, e.latlng.lng, state.mode);
});

// Keyboard shortcuts
document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'w' || e.key === 'W') {
        setMode('waypoint');
    } else if (e.key === 's' || e.key === 'S') {
        setMode('stop');
    } else if (e.key === 'Enter') {
        calculateRoute();
    } else if (e.key === 'Escape') {
        clearRoute();
    }
});

// Button handlers
document.getElementById('btn-calculate').addEventListener('click', calculateRoute);
document.getElementById('btn-download').addEventListener('click', downloadOsm);
document.getElementById('btn-clear').addEventListener('click', clearAll);
document.getElementById('btn-mode-stop').addEventListener('click', () => setMode('stop'));
document.getElementById('btn-mode-waypoint').addEventListener('click', () => setMode('waypoint'));

// Init
updateButtons();
updateInstructions();
setStatus('Primero pon la parada de INICIO, luego la de DESTINO. Después agrega intermedias.', '');
