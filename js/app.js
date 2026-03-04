// TP Routes - Main Application

// State
const state = {
    points: [],          // {lat, lon, type: 'stop'|'waypoint', name, marker, id}
    routeLayer: null,    // Leaflet polyline
    wayIds: [],          // From Valhalla
    mode: 'stop',        // 'stop' or 'waypoint'
    nextId: 1
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
        el.textContent = 'Haz clic en el mapa para agregar la primera parada';
    } else if (state.mode === 'stop') {
        el.textContent = 'Clic = agregar parada | Presiona W para cambiar a modo waypoint';
    } else {
        el.textContent = 'Clic = agregar waypoint (punto de paso) | Presiona S para cambiar a modo parada';
    }
}

// Add point to map and list
function addPoint(lat, lon, type, name) {
    const id = state.nextId++;
    const stopCount = state.points.filter(p => p.type === 'stop').length;
    const defaultName = type === 'stop' ? `Parada ${stopCount + 1}` : '';

    const marker = L.marker([lat, lon], {
        icon: type === 'stop' ? createStopIcon(stopCount + 1) : waypointIcon,
        draggable: true
    }).addTo(map);

    const point = {
        id, lat, lon, type,
        name: name || defaultName,
        marker
    };

    // Drag handler
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

    state.points.push(point);
    updateStopList();
    updateButtons();
    updateInstructions();
    clearRoute();

    return point;
}

// Remove point
function removePoint(id) {
    const idx = state.points.findIndex(p => p.id === id);
    if (idx === -1) return;

    const point = state.points[idx];
    map.removeLayer(point.marker);
    state.points.splice(idx, 1);

    // Renumber stops
    let stopNum = 1;
    for (const p of state.points) {
        if (p.type === 'stop') {
            p.marker.setIcon(createStopIcon(stopNum));
            if (p.name.match(/^Parada \d+$/)) {
                p.name = `Parada ${stopNum}`;
            }
            stopNum++;
        }
    }

    updateStopList();
    updateButtons();
    clearRoute();
}

// Update sidebar stop list
function updateStopList() {
    const list = document.getElementById('stop-list');
    list.innerHTML = '';

    for (const point of state.points) {
        const li = document.createElement('li');

        const num = document.createElement('span');
        if (point.type === 'stop') {
            const stopIdx = state.points.filter(p => p.type === 'stop').indexOf(point) + 1;
            num.className = 'stop-number';
            num.textContent = stopIdx;
        } else {
            num.className = 'stop-number waypoint';
            num.textContent = 'W';
        }

        const nameInput = document.createElement('input');
        nameInput.className = 'stop-name';
        nameInput.value = point.name;
        nameInput.placeholder = point.type === 'stop' ? 'Nombre de la parada' : 'Waypoint';
        nameInput.addEventListener('change', () => {
            point.name = nameInput.value;
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'stop-delete';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Eliminar';
        deleteBtn.addEventListener('click', () => removePoint(point.id));

        const locateBtn = document.createElement('button');
        locateBtn.className = 'stop-delete';
        locateBtn.innerHTML = '&#8982;';
        locateBtn.title = 'Centrar en mapa';
        locateBtn.addEventListener('click', () => {
            map.setView([point.lat, point.lon], 16);
            point.marker.openPopup();
        });

        li.appendChild(num);
        li.appendChild(nameInput);
        li.appendChild(locateBtn);
        li.appendChild(deleteBtn);
        list.appendChild(li);
    }
}

// Update button states
function updateButtons() {
    const stops = state.points.filter(p => p.type === 'stop');
    document.getElementById('btn-calculate').disabled = stops.length < 2;
    document.getElementById('btn-download').disabled = state.wayIds.length === 0;
    document.getElementById('btn-clear').disabled = state.points.length === 0;

    // Update counter
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

    const totalKm = result.wayIds.reduce((sum, w) => sum + w.length, 0).toFixed(1);
    setStatus(`Ruta calculada: ${result.wayIds.length} vías, ${totalKm} km`, 'success');
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
setStatus('Haz clic en el mapa para agregar paradas. Presiona W para modo waypoint.', '');
