// Explorer - Browse and inspect PT relations from OSM

const REGIONS = {
    boyaca: { name: 'Boyaca, Colombia', center: [5.82, -73.35], zoom: 10 },
    cochabamba: { name: 'Cochabamba, Bolivia', center: [-17.3935, -66.1570], zoom: 12 }
};

// Operator colors - assigned dynamically
const OPERATOR_COLORS = [
    '#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12',
    '#1abc9c', '#e67e22', '#0055ff', '#8e44ad', '#27ae60',
    '#d35400', '#2980b9', '#c0392b', '#16a085', '#f1c40f'
];
const operatorColorMap = {};
let colorIdx = 0;

function getOperatorColor(operator) {
    if (!operator) return '#888';
    if (!operatorColorMap[operator]) {
        operatorColorMap[operator] = OPERATOR_COLORS[colorIdx % OPERATOR_COLORS.length];
        colorIdx++;
    }
    return operatorColorMap[operator];
}

let currentRegion = new URLSearchParams(window.location.search).get('region') || 'boyaca';
let allRelations = [];
let selectedRelId = null;
let routeLayer = L.layerGroup();
let loadingGeometry = false;

// Map
const region = REGIONS[currentRegion] || REGIONS.boyaca;
const map = L.map('map').setView(region.center, region.zoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 19
}).addTo(map);
routeLayer.addTo(map);

// Region selector
const regionSelect = document.getElementById('region-select');
for (const [key, r] of Object.entries(REGIONS)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = r.name;
    opt.selected = key === currentRegion;
    regionSelect.appendChild(opt);
}
regionSelect.addEventListener('change', (e) => {
    const params = new URLSearchParams(window.location.search);
    params.set('region', e.target.value);
    window.location.search = params.toString();
});

// --- Stats ---
async function loadStats() {
    try {
        const res = await fetch(`/api/stats?region=${currentRegion}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        document.getElementById('stats-loading').style.display = 'none';
        document.getElementById('stats-content').style.display = 'block';

        const c = data.counts;
        document.getElementById('stat-routes').textContent = c.routes;
        document.getElementById('stat-masters').textContent = c.route_masters;
        document.getElementById('stat-stops').textContent = data.stops;
        document.getElementById('stat-no-stops').textContent = c.routes_no_stops;
        document.getElementById('stat-valid').textContent = c.routes_valid || '0';
        document.getElementById('stat-no-ref').textContent = c.routes_no_ref;
        document.getElementById('stat-gaps').textContent = c.routes_gaps || '0';
        document.getElementById('stat-dupes').textContent = c.routes_dupes || '0';

        const opSelect = document.getElementById('filter-operator');
        data.operators.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.operator || '';
            opt.textContent = `${o.operator || '(sin operador)'} (${o.n})`;
            opSelect.appendChild(opt);
        });

        const netSelect = document.getElementById('filter-network');
        data.networks.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n.network || '';
            opt.textContent = `${n.network || '(sin red)'} (${n.n})`;
            netSelect.appendChild(opt);
        });

        if (data.lastSync) {
            const d = new Date(data.lastSync.synced_at);
            document.getElementById('last-sync').textContent =
                `Sync: ${d.toLocaleDateString('es')} ${d.toLocaleTimeString('es')}`;
        }
    } catch (err) {
        document.getElementById('stats-loading').textContent = 'Error: ' + err.message;
    }
}

// --- Relations ---
async function loadRelations() {
    const operator = document.getElementById('filter-operator').value;
    const network = document.getElementById('filter-network').value;

    let url = `/api/relations?region=${currentRegion}`;
    if (operator) url += `&operator=${encodeURIComponent(operator)}`;
    if (network) url += `&network=${encodeURIComponent(network)}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        allRelations = data.relations;
        renderRelationsList();
    } catch (err) {
        document.getElementById('relations-list').innerHTML =
            `<div style="color:red;padding:8px;">Error: ${err.message}</div>`;
    }
}

function hasGaps(r) {
    return r.ptv2_errors && r.ptv2_errors.some(e => e.includes('brecha'));
}
function hasDuplicates(r) {
    return r.ptv2_errors && r.ptv2_errors.some(e => e.includes('duplicada'));
}

function renderRelationsList() {
    const search = document.getElementById('filter-search').value.toLowerCase();
    const list = document.getElementById('relations-list');

    const issue = document.getElementById('filter-issue').value;

    const filtered = allRelations.filter(r => {
        // Issue filter
        if (issue === 'gaps' && !hasGaps(r)) return false;
        if (issue === 'dupes' && !hasDuplicates(r)) return false;
        if (issue === 'no-stops' && r.stop_count > 0) return false;
        if (issue === 'valid' && !r.ptv2_valid) return false;

        // Text search
        if (!search) return true;
        return [r.ref, r.name, r.from, r.to, r.operator].some(
            v => v && v.toLowerCase().includes(search)
        );
    });

    document.getElementById('relations-count').textContent = filtered.length;

    list.innerHTML = filtered.map(r => {
        const color = getOperatorColor(r.operator);
        const isActive = r.osm_id == selectedRelId;

        return `
            <div class="rel-item ${isActive ? 'active' : ''}" data-id="${r.osm_id}">
                <div class="rel-header">
                    <span class="rel-color" style="background:${color}"></span>
                    <span class="rel-ref">${r.ref || '?'}</span>
                    <span class="rel-from-to">${r.from || '?'} - ${r.to || '?'}</span>
                </div>
                <div class="rel-meta">
                    ${r.operator ? `<span class="rel-tag op">${r.operator}</span>` : ''}
                    ${r.stop_count === 0 ? '<span class="rel-tag warn">sin paradas</span>' : `<span class="rel-tag ok">${r.stop_count} paradas</span>`}
                    <span class="rel-tag">${r.way_count} vias</span>
                    ${hasGaps(r) ? '<span class="rel-tag error">discontinua</span>' : ''}
                    ${hasDuplicates(r) ? '<span class="rel-tag warn">duplicados</span>' : ''}
                    ${r.ptv2_errors && r.ptv2_errors.length > 0 ? `<span class="rel-tag warn">${r.ptv2_errors.length} errores</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    // Click handlers
    list.querySelectorAll('.rel-item').forEach(item => {
        item.addEventListener('click', () => selectRelation(parseInt(item.dataset.id)));
    });
}

// --- Select relation: show on map + detail panel ---
async function selectRelation(osmId) {
    if (loadingGeometry) return;
    selectedRelId = osmId;
    renderRelationsList();

    const rel = allRelations.find(r => r.osm_id == osmId);
    if (!rel) return;

    // Show detail panel
    showDetailPanel(rel);

    // Load geometry on map
    await loadGeometry(osmId, rel);
}

function showDetailPanel(r) {
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('detail-content');
    panel.style.display = 'block';

    const osmId = r.osm_id;
    const osmUrl = `https://www.openstreetmap.org/relation/${osmId}`;
    const josmUrl = `http://localhost:8111/import?url=https://api.openstreetmap.org/api/0.6/relation/${osmId}/full`;
    const color = getOperatorColor(r.operator);

    document.getElementById('detail-title').innerHTML =
        `<span class="rel-color" style="background:${color}"></span> ${r.ref || '?'} — ${r.from || '?'} a ${r.to || '?'}`;

    const tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags || {});

    content.innerHTML = `
        <div class="detail-section">
            <h4>Ruta</h4>
            <div class="detail-row"><span class="label">Nombre</span><span class="value">${r.name || '-'}</span></div>
            <div class="detail-row"><span class="label">Ref</span><span class="value">${r.ref || '-'}</span></div>
            <div class="detail-row"><span class="label">Desde</span><span class="value">${r.from || '-'}</span></div>
            <div class="detail-row"><span class="label">Hasta</span><span class="value">${r.to || '-'}</span></div>
            <div class="detail-row"><span class="label">Operador</span><span class="value">${r.operator || '-'}</span></div>
            <div class="detail-row"><span class="label">Red</span><span class="value">${r.network || '-'}</span></div>
            <div class="detail-row"><span class="label">Tipo</span><span class="value">${r.route_type}</span></div>
        </div>

        <div class="detail-section">
            <h4>Estado PTv2</h4>
            <div class="detail-row"><span class="label">Paradas</span><span class="value ${r.stop_count === 0 ? 'text-warn' : ''}">${r.stop_count === 0 ? 'Ninguna' : r.stop_count}</span></div>
            <div class="detail-row"><span class="label">Vias</span><span class="value">${r.way_count}</span></div>
            <div class="detail-row"><span class="label">Miembros</span><span class="value">${r.member_count}</span></div>
            <div class="detail-row"><span class="label">route_master</span><span class="value ${!r.route_master_id ? 'text-warn' : ''}">${r.route_master_id || 'Ninguno'}</span></div>
        </div>

        ${r.ptv2_errors && r.ptv2_errors.length > 0 ? `
        <div class="detail-section">
            <h4>Errores PTv2 (${r.ptv2_errors.length})</h4>
            <div class="error-list">
                ${r.ptv2_errors.map(e => `<div class="error-item">${e}</div>`).join('')}
            </div>
        </div>
        ` : `
        <div class="detail-section">
            <h4>Estado PTv2</h4>
            <div style="color:#27ae60;font-size:0.85rem;font-weight:600;">Valida</div>
        </div>
        `}

        <div class="detail-section">
            <h4>Enlaces</h4>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <a href="${osmUrl}" target="_blank" class="action-btn">OSM</a>
                <a href="${josmUrl}" class="action-btn">JOSM</a>
                <a href="/edit.html?relation=${osmId}&region=${currentRegion}" class="action-btn" style="background:#e74c3c;color:white;">Editar Ruta</a>
            </div>
        </div>

        <div class="detail-section">
            <h4>Tags</h4>
            <div class="tag-list">
                ${Object.entries(tags).map(([k,v]) =>
                    `<div class="tag-row"><span class="tag-key">${k}</span><span class="tag-val">${v}</span></div>`
                ).join('')}
            </div>
        </div>
    `;
}

async function loadGeometry(osmId, rel) {
    loadingGeometry = true;
    routeLayer.clearLayers();

    // Show loading indicator on map
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'map-loading';
    loadingDiv.textContent = 'Cargando ruta...';
    document.getElementById('map').appendChild(loadingDiv);

    try {
        const res = await fetch(`/api/geometry/${osmId}`);
        const text = await res.text();
        if (!res.ok) {
            const err = JSON.parse(text);
            throw new Error(err.error || 'Error loading geometry');
        }
        const geojson = JSON.parse(text);
        const color = getOperatorColor(rel?.operator);

        const bounds = L.latLngBounds();

        // Draw features
        L.geoJSON(geojson, {
            style: (feature) => ({
                color: color,
                weight: 4,
                opacity: 0.85
            }),
            pointToLayer: (feature, latlng) => {
                bounds.extend(latlng);
                return L.circleMarker(latlng, {
                    radius: 7,
                    color: '#fff',
                    fillColor: color,
                    fillOpacity: 0.9,
                    weight: 2
                });
            },
            onEachFeature: (feature, layer) => {
                if (feature.geometry.type === 'LineString') {
                    const coords = feature.geometry.coordinates.map(c => [c[1], c[0]]);
                    coords.forEach(c => bounds.extend(c));
                }
                if (feature.geometry.type === 'Point' && feature.properties.name) {
                    layer.bindPopup(`<b>${feature.properties.name}</b><br>ID: ${feature.properties.id}`);
                }
            }
        }).addTo(routeLayer);

        // Detect and mark gaps with red markers
        const wayFeatures = geojson.features.filter(f =>
            f.geometry.type === 'LineString' && f.properties.type === 'way'
        );
        for (let i = 0; i < wayFeatures.length - 1; i++) {
            const pA = wayFeatures[i].properties;
            const pB = wayFeatures[i + 1].properties;
            const coordsA = wayFeatures[i].geometry.coordinates;
            const coordsB = wayFeatures[i + 1].geometry.coordinates;
            const aLast = coordsA[coordsA.length - 1];
            const bFirst = coordsB[0];

            let connected;
            if (pA.firstNode && pA.lastNode && pB.firstNode && pB.lastNode) {
                // Node ID comparison (exact)
                connected = pA.lastNode === pB.firstNode || pA.lastNode === pB.lastNode ||
                            pA.firstNode === pB.firstNode || pA.firstNode === pB.lastNode;
            } else {
                // Fallback to coordinate comparison
                const aFirst = coordsA[0];
                const bLast = coordsB[coordsB.length - 1];
                const eps = 0.0000001;
                const eq = (a, b) => Math.abs(a[0]-b[0]) < eps && Math.abs(a[1]-b[1]) < eps;
                connected = eq(aLast,bFirst) || eq(aLast,bLast) || eq(aFirst,bFirst) || eq(aFirst,bLast);
            }

            if (!connected) {
                // Mark the gap midpoint with a red icon
                const midLat = (aLast[1] + bFirst[1]) / 2;
                const midLon = (aLast[0] + bFirst[0]) / 2;
                const gapMarker = L.marker([midLat, midLon], {
                    icon: L.divIcon({
                        className: 'gap-marker',
                        html: '<div class="gap-icon">GAP</div>',
                        iconSize: [36, 18],
                        iconAnchor: [18, 9]
                    })
                }).bindPopup(`<b>Brecha de continuidad</b><br>Entre way/${wayFeatures[i].properties.id} y way/${wayFeatures[i+1].properties.id}`);
                gapMarker.addTo(routeLayer);
            }
        }

        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [60, 60] });
        }
    } catch (err) {
        console.error('Geometry error:', err);
        // Show error briefly
        const errDiv = document.createElement('div');
        errDiv.className = 'map-error';
        errDiv.textContent = err.message;
        document.getElementById('map').appendChild(errDiv);
        setTimeout(() => errDiv.remove(), 4000);
    } finally {
        loadingGeometry = false;
        const el = document.getElementById('map-loading');
        if (el) el.remove();
    }
}

// Close detail panel
document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-panel').style.display = 'none';
    selectedRelId = null;
    routeLayer.clearLayers();
    renderRelationsList();
});

// Keyboard: Escape closes detail
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('detail-close').click();
    }
});

// Filter handlers
document.getElementById('filter-operator').addEventListener('change', loadRelations);
document.getElementById('filter-network').addEventListener('change', loadRelations);
document.getElementById('filter-issue').addEventListener('change', renderRelationsList);
document.getElementById('filter-search').addEventListener('input', renderRelationsList);

// Init
loadStats();
loadRelations();
