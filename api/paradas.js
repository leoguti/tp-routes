// API: /api/paradas — captura de PARADAS georreferenciadas (módulo dentro de /campo/).
//
//   GET  /api/paradas?op=ID&region=boyaca   -> corredores (rutas ida) de la empresa
//   POST /api/paradas   { items:[ ... ] }    -> guarda paradas en field_stops (bandeja)
//
// Lecturas (GET): solo lectura sobre routes/operators. Escrituras (POST): exigen
// sesión válida y van SOLO a field_stops (aislada); nunca tocan places/route_stops.

const { neon } = require('@neondatabase/serverless');
const { leerSesion } = require('../lib/session');

// Cota dura Colombia (defensa en profundidad; el cliente valida el rango Boyacá).
const COL = { latMin: -4.3, latMax: 13.5, lonMin: -79.1, lonMax: -66.8 };
const coordValida = (lat, lon) =>
    Number.isFinite(lat) && Number.isFinite(lon) &&
    !(lat === 0 && lon === 0) &&
    lat >= COL.latMin && lat <= COL.latMax &&
    lon >= COL.lonMin && lon <= COL.lonMax;

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const region = req.query.region || 'boyaca';

    try {
        if (req.method === 'GET') {
            if (req.query.route) return res.json(await paradasDeCorredor(sql, req.query.route));
            if (!req.query.op) return res.status(400).json({ error: 'Falta op (empresa)' });
            return res.json(await corredoresDeEmpresa(sql, region, req.query.op));
        }
        if (req.method === 'POST') {
            const secret = process.env.SESSION_SECRET;
            const { sesion, tokenRenovado } = secret ? leerSesion(req, secret) : { sesion: null };
            if (!sesion) return res.status(401).json({ ok: false, error: 'sesion_requerida' });

            const resultado = await guardarParadas(sql, region, req.body, sesion.uid);
            if (tokenRenovado) resultado.sesion = tokenRenovado;  // renovación deslizante
            return res.json(resultado);
        }
        return res.status(405).json({ error: 'Método no permitido' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};

// Corredores = rutas "ida" (route_parent_id IS NULL) de la empresa.
async function corredoresDeEmpresa(sql, region, op) {
    const [emp] = await sql`SELECT id, nombre FROM operators WHERE id = ${op}`;
    if (!emp) return { error: 'Empresa no encontrada' };

    const rows = await sql`
        SELECT r.id, r.origen_text, r.destino_text
        FROM routes r
        WHERE r.operator_id = ${op}
          AND r.region_id = ${region}
          AND r.route_parent_id IS NULL
        ORDER BY r.origen_text, r.destino_text
    `;
    return {
        empresa: { id: emp.id, nombre: emp.nombre },
        corredores: rows.map((r) => ({
            id: r.id,
            route_text: `${r.origen_text || '?'} → ${r.destino_text || '?'}`,
        })),
    };
}

// Paradas OFICIALES de un corredor = origen + waypoints + destino.
// geo=true si tienen place_id (geolocalizadas, "verde"); geo=false = "gris" (faltan).
async function paradasDeCorredor(sql, routeId) {
    const [r] = await sql`
        SELECT r.id, r.origen_text, r.destino_text, r.origen_place_id, r.destino_place_id,
               po.lat AS o_lat, po.lon AS o_lon, pd.lat AS d_lat, pd.lon AS d_lon
        FROM routes r
        LEFT JOIN places po ON po.id = r.origen_place_id
        LEFT JOIN places pd ON pd.id = r.destino_place_id
        WHERE r.id = ${routeId}
    `;
    if (!r) return { error: 'Corredor no encontrado' };

    const wps = await sql`
        SELECT w.orden, w.nombre_text, w.place_id, p.lat, p.lon
        FROM route_waypoints w
        LEFT JOIN places p ON p.id = w.place_id
        WHERE w.route_id = ${routeId} ORDER BY w.orden
    `;

    const paradas = [
        { rol: 'origen', orden: 0, nombre: r.origen_text, place_id: r.origen_place_id || null,
          lat: r.o_lat, lon: r.o_lon, geo: !!r.origen_place_id },
        ...wps.map((w) => ({
            rol: 'via', orden: w.orden, nombre: w.nombre_text, place_id: w.place_id || null,
            lat: w.lat, lon: w.lon, geo: !!w.place_id,
        })),
        { rol: 'destino', orden: 9999, nombre: r.destino_text, place_id: r.destino_place_id || null,
          lat: r.d_lat, lon: r.d_lon, geo: !!r.destino_place_id },
    ];
    return { route_id: Number(routeId), paradas };
}

// Guarda el lote de paradas. Idempotente por client_uuid; valida coordenadas.
async function guardarParadas(sql, region, body, userId) {
    const items = (body && body.items) || [];
    if (!Array.isArray(items) || !items.length) return { ok: false, error: 'Sin items' };

    let guardados = 0;
    let invalidos = 0;
    try {
        for (const it of items) {
            const lat = Number(it.lat);
            const lon = Number(it.lon);
            if (!coordValida(lat, lon)) { invalidos++; continue; }   // defensa: no guardar coords basura

            const r = await sql`
                INSERT INTO field_stops
                    (region_id, operator_id, operator_text, route_id, route_text,
                     nombre, lat, lon, orden, tipo, metodo_geo, nota_libre, es_nueva,
                     user_id, informante_rol, informante_alias, client_uuid, capturado_en)
                VALUES
                    (${region}, ${it.operator_id || null}, ${it.operator_text || null},
                     ${it.route_id || null}, ${it.route_text || null},
                     ${it.nombre || null}, ${lat}, ${lon}, ${it.orden || null},
                     ${it.tipo || null}, ${it.metodo_geo || null}, ${it.nota_libre || null},
                     ${it.es_nueva ? true : false},
                     ${userId || null}, ${it.informante_rol || null}, ${it.informante_alias || null},
                     ${it.client_uuid || null}, ${it.capturado_en || null})
                ON CONFLICT (client_uuid) DO NOTHING
                RETURNING id
            `;
            guardados += r.length;
        }
        return { ok: true, guardados, invalidos };
    } catch (e) {
        // 42P01 = field_stops aún no existe: el cliente NO borra su cola (no se pierde nada).
        if (/relation .*field_stops.* does not exist|42P01/i.test(e.message)) {
            return { ok: false, reason: 'tabla_pendiente' };
        }
        throw e;
    }
}
