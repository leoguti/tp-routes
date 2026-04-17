// API: promote-routes — promueve terminal_routes pendientes → operators + routes
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Método no permitido' });

    const sql = neon(process.env.DATABASE_URL);
    const { region = 'boyaca', ids } = req.body; // ids opcional: array de IDs a promover

    try {
        // Traer rutas a promover
        let terminal_routes;
        if (ids?.length) {
            terminal_routes = await sql`
                SELECT * FROM terminal_routes
                WHERE id = ANY(${ids}::int[]) AND region = ${region}
            `;
        } else {
            terminal_routes = await sql`
                SELECT * FROM terminal_routes
                WHERE status = 'pendiente' AND region = ${region}
                ORDER BY destino, operador
            `;
        }

        if (!terminal_routes.length)
            return res.json({ promoted: 0, skipped: 0, errors: [], message: 'No hay rutas pendientes' });

        let promoted = 0;
        let skipped  = 0;
        const errors = [];

        for (const tr of terminal_routes) {
            try {
                // 1. Buscar o crear operador
                let opRow = await sql`
                    SELECT id FROM operators
                    WHERE region_id = ${region}
                      AND LOWER(nombre) = LOWER(${tr.operador.trim()})
                `;

                let operatorId;
                if (opRow.length) {
                    operatorId = opRow[0].id;
                    // Actualizar teléfono si viene del terminal y el operador no lo tiene
                    if (tr.telefono) {
                        await sql`
                            UPDATE operators SET telefono = COALESCE(NULLIF(telefono,''), ${tr.telefono})
                            WHERE id = ${operatorId}
                        `;
                    }
                } else {
                    const created = await sql`
                        INSERT INTO operators (region_id, nombre, telefono)
                        VALUES (${region}, ${tr.operador.trim()}, ${tr.telefono || null})
                        RETURNING id
                    `;
                    operatorId = created[0].id;
                }

                // 2. Verificar si la ruta ya existe (clave: operator+origen+destino+via)
                const viaNorm = (tr.via?.trim()) || '';
                const exists = await sql`
                    SELECT id FROM routes
                    WHERE region_id  = ${region}
                      AND operator_id = ${operatorId}
                      AND LOWER(origen)  = LOWER(${tr.origen.trim()})
                      AND LOWER(destino) = LOWER(${tr.destino.trim()})
                      AND LOWER(COALESCE(via, '')) = LOWER(${viaNorm})
                `;

                if (exists.length) {
                    skipped++;
                    // Marcar como mapeada de todas formas
                    await sql`
                        UPDATE terminal_routes SET status = 'mapeada', updated_at = NOW()
                        WHERE id = ${tr.id}
                    `;
                    continue;
                }

                // 3. Crear ruta
                const newRoute = await sql`
                    INSERT INTO routes (region_id, operator_id, origen, destino, via,
                                       resolucion, terminal_route_id, estado)
                    VALUES (${region}, ${operatorId}, ${tr.origen.trim()}, ${tr.destino.trim()}, ${viaNorm || null},
                            ${tr.resolucion || null}, ${tr.id}, 'borrador')
                    RETURNING id
                `;
                const routeId = newRoute[0].id;

                // 4. Generar tareas y calcular progreso
                const TAREAS = ['localizar_paradas','ingresar_tarifas','asignar_paradas','trazar_ruta','ingresar_horarios'];
                for (const tipo of TAREAS) {
                    await sql`
                        INSERT INTO route_tasks (route_id, tipo)
                        VALUES (${routeId}, ${tipo})
                        ON CONFLICT (route_id, tipo) DO NOTHING
                    `;
                }

                // 5. Marcar terminal_route como mapeada
                await sql`
                    UPDATE terminal_routes SET status = 'mapeada', updated_at = NOW()
                    WHERE id = ${tr.id}
                `;

                promoted++;
            } catch (err) {
                errors.push(`${tr.origen} → ${tr.destino} (${tr.operador}): ${err.message}`);
            }
        }

        return res.json({
            promoted,
            skipped,
            errors,
            total: terminal_routes.length,
            message: `${promoted} rutas promovidas, ${skipped} ya existían`
        });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
