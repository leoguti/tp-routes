// API: /api/auth — login de la app de campo (/campo/).
//
//   POST /api/auth { action:'google',      credential:'<id_token de Google>' }
//   POST /api/auth { action:'otp_request', correo:'...' }
//   POST /api/auth { action:'otp_verify',  correo:'...', codigo:'123456' }
//   GET  /api/auth?action=me     (con header Authorization: Bearer <sesion>)
//
// Login principal: "Iniciar sesión con Google" (el ID token se verifica contra
// Google). Respaldo: código de un solo uso (OTP) por correo (Resend). El acceso
// lo gatea la lista cerrada field_users (correo autorizado y activo). La sesión
// es nuestra (mini-JWT HMAC, 7 días deslizante — ver lib/session.js).

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { crearSesion, leerSesion } = require('../lib/session');

const OTP_TTL_MIN = 10;       // los códigos caducan en 10 minutos
const OTP_MAX_INTENTOS = 5;   // intentos de verificación por código

module.exports = async function handler(req, res) {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return res.status(500).json({ error: 'Falta SESSION_SECRET' });

    const sql = neon(process.env.DATABASE_URL);
    const body = req.body || {};
    const action = body.action || req.query.action;

    try {
        if (action === 'me') return res.json(await accionMe(req, secret));

        if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
        if (action === 'google')      return res.json(await accionGoogle(sql, secret, body));
        if (action === 'otp_request') return res.json(await accionOtpRequest(sql, body));
        if (action === 'otp_verify')  return res.json(await accionOtpVerify(sql, secret, body));

        return res.status(400).json({ error: 'Acción desconocida' });
    } catch (e) {
        if (esTablaPendiente(e)) {
            return res.status(503).json({ error: 'auth_no_configurado' });
        }
        return res.status(500).json({ error: e.message });
    }
};

// ---- Acciones -------------------------------------------------------------

// Login con Google: verifica el token y emite sesión si el correo está autorizado.
async function accionGoogle(sql, secret, body) {
    if (!body.credential) return { ok: false, error: 'falta_credential' };

    const info = await verificarTokenGoogle(body.credential);
    if (!info.ok) return { ok: false, error: info.error };

    const u = await buscarUsuarioActivo(sql, info.email);
    if (!u) return { ok: false, error: 'no_autorizado' };

    await sql`UPDATE field_users SET ultimo_acceso = NOW() WHERE id = ${u.id}`;
    return { ok: true, sesion: crearSesion(u, secret), usuario: publico(u) };
}

// Respaldo: pide un código. Respuesta uniforme (no revela si el correo existe).
async function accionOtpRequest(sql, body) {
    const u = await buscarUsuarioActivo(sql, body.correo);
    if (u) {
        const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const hash = hashCodigo(codigo, u.correo);
        const expira = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();
        await sql`INSERT INTO field_otps (correo, code_hash, expira_en) VALUES (${u.correo}, ${hash}, ${expira})`;
        await enviarOtpPorCorreo(u.correo, codigo);
    }
    // Mismo mensaje pase lo que pase: evita enumeración de correos.
    return { ok: true, ttl_min: OTP_TTL_MIN };
}

// Respaldo: verifica el código y emite sesión.
async function accionOtpVerify(sql, secret, body) {
    const u = await buscarUsuarioActivo(sql, body.correo);
    if (!u) return { ok: false, error: 'no_autorizado' };

    const codigo = String(body.codigo || '').trim();
    if (!/^\d{6}$/.test(codigo)) return { ok: false, error: 'codigo_invalido' };

    const [otp] = await sql`
        SELECT id, code_hash, intentos
        FROM field_otps
        WHERE correo = ${u.correo} AND usado = FALSE AND expira_en > NOW()
        ORDER BY creado_en DESC
        LIMIT 1
    `;
    if (!otp) return { ok: false, error: 'sin_codigo_vigente' };
    if (otp.intentos >= OTP_MAX_INTENTOS) return { ok: false, error: 'demasiados_intentos' };

    const hash = hashCodigo(codigo, u.correo);
    const coincide = hash.length === otp.code_hash.length &&
        crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(otp.code_hash));
    if (!coincide) {
        await sql`UPDATE field_otps SET intentos = intentos + 1 WHERE id = ${otp.id}`;
        return { ok: false, error: 'codigo_incorrecto' };
    }

    await sql`UPDATE field_otps SET usado = TRUE WHERE id = ${otp.id}`;
    await sql`UPDATE field_users SET ultimo_acceso = NOW() WHERE id = ${u.id}`;
    return { ok: true, sesion: crearSesion(u, secret), usuario: publico(u) };
}

// ¿Quién soy? Valida la sesión y, si toca, la renueva (sesión deslizante).
async function accionMe(req, secret) {
    const { sesion, tokenRenovado } = leerSesion(req, secret);
    if (!sesion) return { ok: true, autenticado: false };
    return {
        ok: true,
        autenticado: true,
        usuario: { nombre: sesion.nombre, correo: sesion.correo, rol: sesion.rol },
        ...(tokenRenovado ? { sesion: tokenRenovado } : {}),
    };
}

// ---- Helpers --------------------------------------------------------------

async function buscarUsuarioActivo(sql, correo) {
    const c = String(correo || '').trim().toLowerCase();
    if (!c) return null;
    const [u] = await sql`SELECT id, correo, nombre, rol, activo FROM field_users WHERE correo = ${c}`;
    return u && u.activo ? u : null;
}

const publico = (u) => ({ nombre: u.nombre, correo: u.correo, rol: u.rol });

// Hash del código con pimienta (SESSION_SECRET) + correo: nunca se guarda en claro.
function hashCodigo(codigo, correo) {
    return crypto.createHmac('sha256', process.env.SESSION_SECRET)
        .update(correo + ':' + codigo)
        .digest('hex');
}

// Verifica el ID token de Google contra el endpoint oficial (sin librerías).
async function verificarTokenGoogle(idToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return { ok: false, error: 'falta_google_client_id' };

    let data;
    try {
        const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken));
        data = await r.json();
        if (!r.ok) return { ok: false, error: 'token_invalido' };
    } catch {
        return { ok: false, error: 'no_se_pudo_verificar' };
    }

    if (data.aud !== clientId) return { ok: false, error: 'aud_incorrecto' };
    if (data.email_verified !== true && data.email_verified !== 'true') return { ok: false, error: 'correo_no_verificado' };
    if (!data.email) return { ok: false, error: 'sin_correo' };
    if (data.exp && Date.now() / 1000 > Number(data.exp)) return { ok: false, error: 'token_expirado' };

    return { ok: true, email: data.email };
}

// Envía el código por correo con Resend (API REST, vía fetch).
async function enviarOtpPorCorreo(correo, codigo) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('Falta RESEND_API_KEY');
    const from = process.env.RESEND_FROM || 'Busboy Campo <onboarding@resend.dev>';

    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to: [correo],
            subject: `Tu código de acceso: ${codigo}`,
            text: `Tu código para entrar a Busboy Campo es: ${codigo}\n\n`
                + `Vence en ${OTP_TTL_MIN} minutos. Si no lo pediste, ignora este correo.`,
        }),
    });
    if (!r.ok) {
        const detalle = await r.text().catch(() => '');
        throw new Error('resend_fallo: ' + r.status + ' ' + detalle.slice(0, 200));
    }
}

const esTablaPendiente = (e) =>
    /relation .*field_(users|otps).* does not exist|42P01/i.test(e.message || '');
