// Region definitions
const REGIONS = {
    boyaca: {
        name: 'Boyacá, Colombia',
        center: [5.5353, -73.3678],
        zoom: 13,
        bounds: [[4.4, -74.8], [7.2, -72.0]],
        defaultNetwork: 'Transporte Intermunicipal Boyacá'
    },
    cochabamba: {
        name: 'Cochabamba, Bolivia',
        center: [-17.3935, -66.1570],
        zoom: 13,
        bounds: [[-17.709721, -66.440262], [-17.261759, -65.577835]],
        defaultNetwork: 'Transporte Público Cochabamba'
    }
};

/**
 * Get current region from URL or default to boyaca
 */
function getCurrentRegion() {
    const params = new URLSearchParams(window.location.search);
    const region = params.get('region');
    return REGIONS[region] ? region : 'boyaca';
}

/**
 * Switch to a different region
 */
function switchRegion(regionKey) {
    const params = new URLSearchParams(window.location.search);
    params.set('region', regionKey);
    window.location.search = params.toString();
}
