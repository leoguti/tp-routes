// API: export terminal_routes as CSV
const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

    const sql = neon(process.env.DATABASE_URL);
    const { region = 'boyaca', status } = req.query;

    let query = `SELECT origen, destino, operador, telefono, resolucion, tarifa, notas, status, created_at
                 FROM terminal_routes WHERE region = $1`;
    const params = [region];
    if (status) { query += ` AND status = $2`; params.push(status); }
    query += ' ORDER BY destino, operador';

    try {
        const rows = await sql(query, params);

        const header = 'origen,destino,operador,telefono,resolucion,tarifa,notas,status,fecha_ingreso';
        const lines = rows.map(r => [
            csvEscape(r.origen),
            csvEscape(r.destino),
            csvEscape(r.operador),
            csvEscape(r.telefono || ''),
            csvEscape(r.resolucion || ''),
            r.tarifa || '',
            csvEscape(r.notas || ''),
            r.status,
            r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : ''
        ].join(','));

        const csv = [header, ...lines].join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="rutas-terminal-${region}-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel UTF-8
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

function csvEscape(val) {
    if (!val) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}
