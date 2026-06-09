// Carga de la primera jornada de captura de campo a tablas oficiales.
// Idempotente: si ya hay tarifas con la misma fuente, no duplica.
const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL);

const FUENTE = 'campo-2026-05-27';

const CARGA = [
  // {empresa, ruta, tarifa, ventana_cruda, hora_primera, hora_ultima}
  { empresa:'Cooflotax',    ruta:'Tunja → Duitama',                              tarifa:12000, ventana:'6:00 am - 8:30 pm',    hp:'06:00', hu:'20:30' },
  { empresa:'Cooflotax',    ruta:'Tunja → Nuevo Colon',                          tarifa: 9000, ventana:'7:20 am - 7:00 pm',    hp:'07:20', hu:'19:00' },
  { empresa:'Cooflotax',    ruta:'Tunja → Oicata',                               tarifa: 5500, ventana:'6:30 am - 7:00 pm',    hp:'06:30', hu:'19:00' },
  { empresa:'Cootrachica',  ruta:'Tunja → Duitama',                              tarifa:12000, ventana:'5:30am - 7:30pm',      hp:'05:30', hu:'19:30' },
  { empresa:'Cootrachica',  ruta:'Tunja → Sogamoso — Terminal de Buses Sogamoso', tarifa:14000, ventana:'5:50am - 8:00pm',      hp:'05:50', hu:'20:00' },
  { empresa:'Los Delfines', ruta:'Tunja → Monterrey',                            tarifa:73000, ventana:'6:00 am - 12:00 pm',   hp:'06:00', hu:'12:00' },
  { empresa:'Los Delfines', ruta:'Tunja → Nuevo Colon',                          tarifa: 9000, ventana:'7:30 am - 3:45 pm',    hp:'07:30', hu:'15:45' },
  { empresa:'Los Delfines', ruta:'Tunja → Ramiriqui',                            tarifa:11000, ventana:'6:00 am - 8:30 pm',    hp:'06:00', hu:'20:30' },
  { empresa:'Los Muiscas',  ruta:'Bogota — Terminal Salitre → Tunja',            tarifa:43000, ventana:'5:30am-7:30am / 2:30pm-4:30pm', hp:'05:30', hu:'16:30' },
  { empresa:'Los Muiscas',  ruta:'Tunja → Cienega',                              tarifa:11000, ventana:'6:30am - 6:30pm',      hp:'06:30', hu:'18:30' },
  { empresa:'Los Muiscas',  ruta:'Tunja → Combita',                              tarifa: 5500, ventana:'6:30am - 7:00pm',      hp:'06:30', hu:'19:00' },
  { empresa:'Los Muiscas',  ruta:'Tunja → Guateque',                             tarifa:38000, ventana:'5:30am - 6:00pm',      hp:'05:30', hu:'18:00' },
  { empresa:'Los Muiscas',  ruta:'Tunja → Moniquira',                            tarifa:21000, ventana:'5:30am - 3:30pm',      hp:'05:30', hu:'15:30' },
  { empresa:'Los Muiscas',  ruta:'Tunja → Motavita',                             tarifa: 3000, ventana:'6:00am - 4:30pm',      hp:'06:00', hu:'16:30' },
];

// field_notes a marcar como aplicado/repreguntar/confirmado_no_opera
const NO_OPERA = [
  // pares (empresa, ruta) que vinieron como "no sale"
  ['Cooflotax',   'Tunja → Combita'],
  ['Cooflotax',   'Tunja → Ramiriqui'],
  ['Cootrachica', 'Tunja → Combita'],
  ['Cootrachica', 'Tunja → Ramiriqui'],
  ['Cootrachica', 'Tunja → Sotaquira'],
  ['Cootrachica', 'Tunja → Tibaná'],
];
const REPREGUNTAR = [
  ['Cooflotax',   'Tunja → Motavita'],   // "Sale de la Glorieta"
  ['Los Delfines','Tunja → Combita'],    // "No" "No"
  ['Los Delfines','Tunja → Guayata'],    // "No" "No"
  ['Los Delfines','Tunja → Macanal'],    // tarifa fue comentario
];

(async () => {
  // 1) Resolver route_ids
  const cat = await sql`
    SELECT r.id, o.nombre AS op, r.origen_text||' → '||r.destino_text AS rt
    FROM routes r JOIN operators o ON o.id=r.operator_id
    WHERE o.nombre IN ('Los Muiscas','Los Delfines','Autoboy','Cootrachica','Cooflotax','Omega')
  `;
  const idx = new Map(cat.map(c => [c.op + '|' + c.rt, c.id]));

  let insertedFares = 0, insertedFreqs = 0, updatedRoutes = 0;

  for (const r of CARGA) {
    const route_id = idx.get(r.empresa + '|' + r.ruta);
    if (!route_id) { console.log('  ✗ no calza:', r.empresa, r.ruta); continue; }

    // route_fares (idempotente por fuente)
    const ex = await sql`SELECT id FROM route_fares WHERE route_id=${route_id} AND fuente=${FUENTE}`;
    if (ex.length === 0) {
      await sql`INSERT INTO route_fares(route_id, tarifa_cop, moneda, fuente, creada_en)
                VALUES (${route_id}, ${r.tarifa}, 'COP', ${FUENTE}, NOW())`;
      insertedFares++;
    }

    // routes.horario_operacion_crudo (sobrescribe — es info cruda)
    await sql`UPDATE routes SET horario_operacion_crudo=${r.ventana} WHERE id=${route_id}`;
    updatedRoutes++;

    // route_frequencies (idempotente por fuente+route)
    const ef = await sql`SELECT id FROM route_frequencies WHERE route_id=${route_id} AND fuente=${FUENTE}`;
    if (ef.length === 0) {
      await sql`INSERT INTO route_frequencies(route_id, hora_primera, hora_ultima, headway_min, exact_times, fuente, creada_en)
                VALUES (${route_id}, ${r.hp}, ${r.hu}, NULL, FALSE, ${FUENTE}, NOW())`;
      insertedFreqs++;
    }
  }

  // 2) Marcar field_notes
  // aplicado: las 14 rutas cargadas
  const pares_aplicado = CARGA.map(r => [r.empresa, r.ruta]);
  let aplicadoCount = 0;
  for (const [op, rt] of pares_aplicado) {
    const u = await sql`UPDATE field_notes SET estado='aplicado', revisado_por='Leonardo (Claude Code)', revisado_en=NOW()
                        WHERE operator_text=${op} AND route_text=${rt} AND estado='pendiente'`;
    aplicadoCount += (u.count || 0);
  }
  let noOperaCount = 0;
  for (const [op, rt] of NO_OPERA) {
    const u = await sql`UPDATE field_notes SET estado='confirmado_no_opera', revisado_por='Leonardo (Claude Code)', revisado_en=NOW()
                        WHERE operator_text=${op} AND route_text=${rt} AND estado='pendiente'`;
    noOperaCount += (u.count || 0);
  }
  let repreguntarCount = 0;
  for (const [op, rt] of REPREGUNTAR) {
    const u = await sql`UPDATE field_notes SET estado='repreguntar', revisado_por='Leonardo (Claude Code)', revisado_en=NOW()
                        WHERE operator_text=${op} AND route_text=${rt} AND estado='pendiente'`;
    repreguntarCount += (u.count || 0);
  }

  console.log('\n═══ RESUMEN DE CARGA ═══');
  console.log('  route_fares insertadas:        ', insertedFares);
  console.log('  route_frequencies insertadas:  ', insertedFreqs);
  console.log('  routes con ventana cruda:      ', updatedRoutes);
  console.log('  field_notes → aplicado:        ', aplicadoCount);
  console.log('  field_notes → confirmado_no_opera:', noOperaCount);
  console.log('  field_notes → repreguntar:     ', repreguntarCount);

  // 3) Verificación
  console.log('\n--- Estado final field_notes ---');
  const est = await sql`SELECT estado, COUNT(*)::int AS n FROM field_notes GROUP BY estado ORDER BY n DESC`;
  est.forEach(r => console.log(`  ${r.estado}: ${r.n}`));
})().catch(e => console.error('ERR:', e.message, e.stack));
