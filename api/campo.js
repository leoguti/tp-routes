// API: /api/campo — capa de captura de campo para pasantes en el terminal.
//
//   GET  /api/campo?region=boyaca           -> empresas con conteo de pendientes
//   GET  /api/campo?op=ID&region=boyaca      -> lista priorizada de "qué falta" de esa empresa
//   POST /api/campo   { items:[ ... ] }      -> guarda capturas en field_notes (bandeja)
//
// Las lecturas (GET) solo consultan tablas existentes en modo lectura: no
// modifican nada. Las escrituras (POST) van a field_notes (tabla aislada,
// estado 'pendiente'); NUNCA tocan route_fares/route_trips/routes.

const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    const sql = neon(process.env.DATABASE_URL);
    const region = req.query.region || 'boyaca';

    try {
        if (req.method === 'GET' && req.query.op) {
            return res.json(await pendientesDeEmpresa(sql, region, req.query.op));
        }
        if (req.method === 'GET') {
            return res.json(await listaEmpresas(sql, region));
        }
        if (req.method === 'POST') {
            return res.json(await guardarCapturas(sql, region, req.body));
        }
        return res.status(405).json({ error: 'Método no permitido' });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};

// Empresas + cuántas rutas tienen sin tarifa, sin horario, sin frecuencia, o capturas a re-confirmar.
async function listaEmpresas(sql, region) {
    const rows = await sql`
        SELECT o.id,
               o.nombre,
               COALESCE(o.nombre_corto, o.nombre) AS corto,
               count(r.id) AS rutas,
               count(r.id) FILTER (
                   WHERE NOT EXISTS (SELECT 1 FROM route_fares f WHERE f.route_id = r.id)
                      OR (NOT EXISTS (SELECT 1 FROM route_frequencies fq WHERE fq.route_id = r.id)
                          AND NOT EXISTS (SELECT 1 FROM route_trips t WHERE t.route_id = r.id))
                      OR EXISTS (SELECT 1 FROM route_frequencies fq2 WHERE fq2.route_id = r.id AND fq2.headway_min IS NULL)
                      OR EXISTS (SELECT 1 FROM field_notes fn
                                  WHERE fn.route_id = r.id
                                    AND fn.estado IN ('repreguntar','confirmado_no_opera'))
               ) AS pendientes
        FROM operators o
        LEFT JOIN routes r
               ON r.operator_id = o.id
              AND r.region_id   = o.region_id
              AND r.route_parent_id IS NULL
        WHERE o.region_id = ${region}
        GROUP BY o.id, o.nombre, o.nombre_corto
        ORDER BY pendientes DESC, o.nombre
    `;
    return {
        empresas: rows.map((x) => ({
            id: x.id,
            nombre: x.nombre,
            corto: x.corto,
            rutas: Number(x.rutas),
            pendientes: Number(x.pendientes),
        })),
    };
}

// "Qué falta" de una empresa: una pregunta concreta a la vez.
// Tipos de pregunta:
//   tarifa     — no hay route_fares para la ruta.
//   horario    — no hay route_frequencies ni route_trips (modo + ventana).
//   frecuencia — hay frequency cargada pero sin headway_min (cada-cuánto).
//   confirmar_no_opera — un informante previo dijo "no opera"; pedimos segunda fuente.
//   aclarar    — captura previa quedó ambigua y se marcó 'repreguntar'.
async function pendientesDeEmpresa(sql, region, op) {
    const [emp] = await sql`SELECT id, nombre FROM operators WHERE id = ${op}`;
    if (!emp) return { error: 'Empresa no encontrada' };

    const rutas = await sql`
        SELECT r.id, r.origen_text, r.destino_text,
               NOT EXISTS (SELECT 1 FROM route_fares f WHERE f.route_id = r.id) AS falta_tarifa,
               NOT EXISTS (SELECT 1 FROM route_frequencies fq WHERE fq.route_id = r.id)
                 AND NOT EXISTS (SELECT 1 FROM route_trips t WHERE t.route_id = r.id) AS falta_horario,
               EXISTS (SELECT 1 FROM route_frequencies fq2
                        WHERE fq2.route_id = r.id AND fq2.headway_min IS NULL) AS falta_frecuencia
        FROM routes r
        WHERE r.operator_id = ${op}
          AND r.region_id   = ${region}
          AND r.route_parent_id IS NULL
        ORDER BY r.origen_text, r.destino_text
        LIMIT 80
    `;

    // Capturas previas que pidieron repreguntar / fueron marcadas no-opera.
    // (Una sola fuente "no opera" no basta: pedimos confirmación de un segundo.)
    const repreguntas = await sql`
        SELECT DISTINCT route_id, route_text, estado,
               (array_agg(valor)        FILTER (WHERE valor IS NOT NULL))[1] AS valor_previo,
               (array_agg(informante)   FILTER (WHERE informante IS NOT NULL))[1] AS quien_dijo
        FROM field_notes
        WHERE operator_id = ${op} AND region_id = ${region}
          AND estado IN ('repreguntar','confirmado_no_opera')
        GROUP BY route_id, route_text, estado
    `;

    // Las repreguntas (rutas con captura previa ambigua o un solo "no opera")
    // tienen PRIORIDAD: van primero y reemplazan las preguntas normales de esa ruta.
    const rutasConRepregunta = new Set(repreguntas.map((rq) => rq.route_id));
    const pendientes = [];
    for (const rq of repreguntas) {
        const valor = rq.valor_previo ? ` (anterior: "${rq.valor_previo}"${rq.quien_dijo ? ', según ' + rq.quien_dijo : ''})` : '';
        if (rq.estado === 'confirmado_no_opera') {
            pendientes.push({
                route_id: rq.route_id, route_text: rq.route_text, campo: 'confirmar_no_opera',
                pregunta: `Un taquillero anterior dijo que ${rq.route_text} NO sale${valor}. ¿Lo confirma? Responde "no opera" o el horario/tarifa si sí opera.`,
            });
        } else {
            pendientes.push({
                route_id: rq.route_id, route_text: rq.route_text, campo: 'aclarar',
                pregunta: `Captura previa de ${rq.route_text} no quedó clara${valor}. ¿Puedes precisar tarifa y horario?`,
            });
        }
    }
    for (const r of rutas) {
        if (rutasConRepregunta.has(r.id)) continue;  // ya cubierta arriba
        const ruta = `${r.origen_text} → ${r.destino_text}`;
        if (r.falta_tarifa) {
            pendientes.push({
                route_id: r.id, route_text: ruta, campo: 'tarifa',
                pregunta: `¿Cuánto vale hoy el pasaje ${ruta}?`,
            });
        }
        if (r.falta_horario) {
            pendientes.push({
                route_id: r.id, route_text: ruta, campo: 'horario',
                pregunta: `Para ${ruta}: ¿despachan a horas específicas (listar) o de forma continua (primera y última hora del día)?`,
            });
        } else if (r.falta_frecuencia) {
            pendientes.push({
                route_id: r.id, route_text: ruta, campo: 'frecuencia',
                pregunta: `En ${ruta}, ¿cada cuánto sale un bus en promedio? Una estimación está bien — si sale "cuando se llena", anótalo así.`,
            });
        }
    }

    // Visita corta y respetuosa: máximo 12 preguntas por empresa.
    return {
        empresa: { id: emp.id, nombre: emp.nombre },
        total: pendientes.length,
        pendientes: pendientes.slice(0, 12),
    };
}

// Guarda el lote de capturas. Idempotente por client_uuid (reintentar no duplica).
async function guardarCapturas(sql, region, body) {
    const items = (body && body.items) || [];
    if (!Array.isArray(items) || !items.length) {
        return { ok: false, error: 'Sin items' };
    }
    let guardados = 0;
    try {
        for (const it of items) {
            const r = await sql`
                INSERT INTO field_notes
                    (region_id, operator_id, operator_text, route_id, route_text,
                     campo, valor, nota_libre, pasante, informante, client_uuid, capturado_en)
                VALUES
                    (${region}, ${it.operator_id || null}, ${it.operator_text || null},
                     ${it.route_id || null}, ${it.route_text || null},
                     ${it.campo || 'otro'}, ${it.valor || null}, ${it.nota_libre || null},
                     ${it.pasante || null}, ${it.informante || null},
                     ${it.client_uuid || null}, ${it.capturado_en || null})
                ON CONFLICT (client_uuid) DO NOTHING
            `;
            guardados += r.count ?? r.rowCount ?? 0;
        }
        return { ok: true, guardados };
    } catch (e) {
        // 42P01 = la tabla field_notes aún no existe (migración pendiente).
        // Devolvemos 200 con un aviso: el cliente NO borra su cola local,
        // así no se pierde ningún dato capturado en campo.
        if (/relation .*field_notes.* does not exist|42P01/i.test(e.message)) {
            return { ok: false, reason: 'tabla_pendiente' };
        }
        throw e;
    }
}
