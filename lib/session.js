// Sesiones firmadas para la app de campo — mini-JWT (HS256) hecho con `crypto`,
// sin librerías externas. Una sesión es:  base64url(payload) + "." + base64url(HMAC)
//
// Sesión DESLIZANTE de 7 días: el token vive 7 días; cuando le queda menos de
// ~6 (es decir, ya pasó ~1 día de uso), se renueva solo. Así, mientras se use,
// nunca caduca; si el celular queda inactivo o se pierde, el acceso muere en 7 días.

const crypto = require('crypto');

const DUR_MS = 7 * 24 * 60 * 60 * 1000;          // vida total del token
const RENOVAR_BAJO_MS = 6 * 24 * 60 * 60 * 1000; // renovar si quedan menos de esto

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const desB64url = (s) => Buffer.from(s, 'base64url');

function firmar(payloadObj, secret) {
    const payload = b64url(JSON.stringify(payloadObj));
    const mac = crypto.createHmac('sha256', secret).update(payload).digest();
    return payload + '.' + b64url(mac);
}

// Verifica firma y expiración. Devuelve el payload o null si no es válida.
function verificar(token, secret) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;

    const esperado = crypto.createHmac('sha256', secret).update(payload).digest();
    const recibido = desB64url(sig);
    if (recibido.length !== esperado.length || !crypto.timingSafeEqual(recibido, esperado)) {
        return null;
    }
    let obj;
    try { obj = JSON.parse(desB64url(payload).toString('utf8')); } catch { return null; }
    if (!obj || typeof obj.exp !== 'number' || Date.now() > obj.exp) return null;
    return obj;
}

// Crea una sesión nueva para un usuario de field_users.
function crearSesion(user, secret) {
    const now = Date.now();
    return firmar({
        uid: user.id,
        correo: user.correo,
        nombre: user.nombre,
        rol: user.rol,
        iat: now,
        exp: now + DUR_MS,
    }, secret);
}

// Lee la sesión del header Authorization: Bearer <token>.
// Devuelve { sesion, tokenRenovado }: si la sesión es válida pero ya pasó ~1 día,
// tokenRenovado trae una sesión fresca para que el cliente reemplace la suya.
function leerSesion(req, secret) {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    const sesion = verificar(m ? m[1].trim() : null, secret);
    if (!sesion) return { sesion: null, tokenRenovado: null };

    let tokenRenovado = null;
    if (sesion.exp - Date.now() < RENOVAR_BAJO_MS) {
        tokenRenovado = crearSesion(
            { id: sesion.uid, correo: sesion.correo, nombre: sesion.nombre, rol: sesion.rol },
            secret,
        );
    }
    return { sesion, tokenRenovado };
}

module.exports = { crearSesion, verificar, leerSesion };
