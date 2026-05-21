// ============================================================
//  Captura de campo — lógica de la app (prototipo v1)
//
//  Principios:
//   - Funciona offline: la cola de capturas vive en el celular
//     (localStorage) y se envía sola cuando hay señal.
//   - No pierde datos: si el servidor no recibe, la cola se queda.
//   - "Bandeja": lo enviado entra a field_notes con estado
//     'pendiente'; nunca toca los datos oficiales directamente.
// ============================================================

// Client ID público de Google (OAuth). Es público, no es secreto.
const GOOGLE_CLIENT_ID = '717687409072-enpabm0qbnfuqval48elvgm1on1vsmqp.apps.googleusercontent.com';

// ---- Estado guardado en el celular --------------------------
const store = {
  get sesion() { return localStorage.getItem('campo_sesion') || ''; },
  set sesion(v) { v ? localStorage.setItem('campo_sesion', v) : localStorage.removeItem('campo_sesion'); },
  get usuario() { return JSON.parse(localStorage.getItem('campo_usuario') || 'null'); },
  set usuario(v) { v ? localStorage.setItem('campo_usuario', JSON.stringify(v)) : localStorage.removeItem('campo_usuario'); },
  get cola() { return JSON.parse(localStorage.getItem('campo_cola') || '[]'); },
  set cola(v) { localStorage.setItem('campo_cola', JSON.stringify(v)); },
  snap(key, val) {                         // foto de la última respuesta del servidor
    if (val === undefined) return JSON.parse(localStorage.getItem('snap_' + key) || 'null');
    localStorage.setItem('snap_' + key, JSON.stringify(val));
  },
  // Quién brinda la información, recordado por empresa (sobrevive offline).
  inform(empId, v) {
    const m = JSON.parse(localStorage.getItem('campo_informantes') || '{}');
    if (v === undefined) return m[empId] || '';
    m[empId] = v;
    localStorage.setItem('campo_informantes', JSON.stringify(m));
  },
};

let empresaActual = null;

// ---- Utilidades ---------------------------------------------
const $ = (id) => document.getElementById(id);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
                    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

function verVista(id) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
  $(id).classList.add('activa');
}

// fetch con red primero y, si falla, la última foto guardada (offline).
async function apiGet(path, snapKey) {
  try {
    const r = await fetch(path, { headers: authHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    store.snap(snapKey, data);
    return data;
  } catch (e) {
    const cached = store.snap(snapKey);
    if (cached) return cached;
    throw e;
  }
}

// ---- Semáforo de conexión -----------------------------------
function pintarEstado() {
  const el = $('estado');
  if (navigator.onLine) { el.textContent = '🟢 En línea'; el.className = 'online'; }
  else { el.textContent = '🔴 Sin conexión'; el.className = 'offline'; }
}
window.addEventListener('online',  () => { pintarEstado(); enviar(); });
window.addEventListener('offline', pintarEstado);

// ---- 1. Identidad: login con Google + respaldo por código (OTP) ----------
const err = (msg) => { $('errIdent').textContent = msg || ''; };

// Header de autorización para las llamadas a la API.
function authHeaders(extra) {
  const h = extra || {};
  if (store.sesion) h.Authorization = 'Bearer ' + store.sesion;
  return h;
}

// Carga el botón oficial de Google cuando su librería esté lista.
function iniciarGoogle() {
  let intentos = 50;
  const t = setInterval(() => {
    if (window.google && google.accounts && google.accounts.id) {
      clearInterval(t);
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
      google.accounts.id.renderButton($('googleBtn'), {
        type: 'standard', theme: 'filled_blue', size: 'large',
        shape: 'pill', text: 'signin_with', locale: 'es',
      });
    } else if (--intentos <= 0) {
      clearInterval(t);
      $('googleAviso').textContent = 'No se pudo cargar Google. Usa el código por correo.';
    }
  }, 100);
}

function onGoogleCredential(resp) {
  loginCon({ action: 'google', credential: resp.credential });
}

// Respaldo OTP: desplegar el formulario del código.
$('btnMostrarOtp').onclick = () => {
  $('otpBox').hidden = false;
  $('btnMostrarOtp').hidden = true;
  $('otpCorreo').focus();
};

$('btnPedirCodigo').onclick = async () => {
  const correo = $('otpCorreo').value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(correo)) { err('Escribe un correo válido'); return; }
  err('');
  $('btnPedirCodigo').disabled = true;
  $('btnPedirCodigo').textContent = 'Enviando…';
  try {
    const r = await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'otp_request', correo }),
    });
    const data = await r.json();
    if (data.ok) { $('otpPaso2').hidden = false; $('otpCodigo').focus(); }
    else err('No se pudo enviar el código. Intenta de nuevo.');
  } catch {
    err('Sin conexión. El login necesita señal una vez.');
  } finally {
    $('btnPedirCodigo').disabled = false;
    $('btnPedirCodigo').textContent = 'Enviarme el código';
  }
};

$('btnVerificarCodigo').onclick = () => {
  const correo = $('otpCorreo').value.trim().toLowerCase();
  const codigo = $('otpCodigo').value.trim();
  if (!/^\d{6}$/.test(codigo)) { err('El código son 6 dígitos'); return; }
  loginCon({ action: 'otp_verify', correo, codigo });
};

// Manda las credenciales al backend y, si todo va bien, entra.
async function loginCon(payload) {
  err('');
  try {
    const r = await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (data.ok && data.sesion) {
      store.sesion = data.sesion;
      store.usuario = data.usuario || null;
      entrar();
    } else {
      err(mensajeError(data.error));
    }
  } catch {
    err('Sin conexión. El login necesita señal una vez.');
  }
}

function mensajeError(code) {
  return ({
    no_autorizado: 'Tu correo no está en la lista de autorizados. Avísale a Paola.',
    codigo_incorrecto: 'Código incorrecto. Revísalo e intenta de nuevo.',
    sin_codigo_vigente: 'El código venció o no se pidió. Pide uno nuevo.',
    demasiados_intentos: 'Demasiados intentos. Pide un código nuevo.',
    codigo_invalido: 'El código son 6 dígitos.',
    auth_no_configurado: 'El acceso aún no está activado en el servidor.',
  })[code] || 'No se pudo entrar. Intenta de nuevo.';
}

// Ya autenticado: muestra "Salir" y va a elegir empresa.
function entrar() {
  $('btnSalir').hidden = false;
  irAEmpresas();
}

// Cierra sesión.
$('btnSalir').onclick = () => {
  store.sesion = ''; store.usuario = null;
  $('btnSalir').hidden = true;
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  verVista('vista-identidad');
};

function sesionVencida() {
  store.sesion = ''; store.usuario = null;
  $('btnSalir').hidden = true;
  verVista('vista-identidad');
  err('Tu sesión venció. Vuelve a entrar — tus capturas siguen guardadas en el celular.');
}

// Al abrir: si hay sesión guardada, validarla (y renovarla); si no, mostrar login.
async function arrancarSesion() {
  if (!store.sesion) return;
  try {
    const r = await fetch('/api/auth?action=me', { headers: authHeaders() });
    const data = await r.json();
    if (data.autenticado) {
      if (data.sesion) store.sesion = data.sesion;   // renovación deslizante
      if (data.usuario) store.usuario = data.usuario;
      entrar();
    } else {
      store.sesion = ''; store.usuario = null;        // expiró: mostrar login
    }
  } catch {
    if (store.usuario) entrar();                       // sin señal: confiar en la sesión guardada
  }
}

// ---- 2. Empresas --------------------------------------------
async function irAEmpresas() {
  $('titulo').textContent = 'Elegir empresa';
  verVista('vista-empresas');
  const u = store.usuario;
  $('saludo').textContent = u && u.nombre ? ('Hola, ' + u.nombre) : '';
  const cont = $('listaEmpresas');
  try {
    const { empresas } = await apiGet('/api/campo', 'empresas');
    cont.innerHTML = '';
    empresas.forEach((e) => {
      const b = document.createElement('button');
      b.className = 'empresa';
      b.innerHTML = `<span class="n">${e.nombre}</span>
        <span class="badge ${e.pendientes === 0 ? 'cero' : ''}">${e.pendientes} pend.</span>`;
      b.onclick = () => irAPendientes(e);
      cont.appendChild(b);
    });
  } catch {
    cont.innerHTML = '<p class="aviso">Sin conexión y sin datos guardados todavía. ' +
                     'Abre esta pantalla una vez con señal.</p>';
  }
}

// ---- 3. Qué falta de la empresa -----------------------------
async function irAPendientes(empresa) {
  empresaActual = empresa;
  $('titulo').textContent = empresa.corto || empresa.nombre;
  $('nombreEmpresa').textContent = empresa.nombre;
  verVista('vista-pendientes');
  const inpInf = $('informante');
  inpInf.value = store.inform(empresa.id);
  inpInf.oninput = () => store.inform(empresa.id, inpInf.value.trim());
  const cont = $('listaPendientes');
  cont.innerHTML = 'Cargando…';
  try {
    const data = await apiGet('/api/campo?op=' + empresa.id, 'pend_' + empresa.id);
    if (!data.pendientes || !data.pendientes.length) {
      cont.innerHTML = '<p class="ok">✓ No hay nada pendiente registrado para esta empresa.</p>';
    } else {
      cont.innerHTML = '';
      data.pendientes.forEach((p) => cont.appendChild(tarjeta(p)));
    }
  } catch {
    cont.innerHTML = '<p class="aviso">No se pudo cargar. Revisa con señal una vez.</p>';
  }
  pintarBotonEnviar();
}

// Una tarjeta = una pregunta a la vez.
function tarjeta(p) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <p class="ruta">${p.route_text || ''}</p>
    <p class="preg">${p.pregunta}</p>
    <input type="text" placeholder="Lo que respondió el despachador">
    <button class="primary">Guardar</button>`;
  const input = div.querySelector('input');
  div.querySelector('button').onclick = () => {
    const valor = input.value.trim();
    if (!valor) return;
    encolar({
      operator_id: empresaActual.id,
      operator_text: empresaActual.nombre,
      route_id: p.route_id || null,
      route_text: p.route_text || null,
      campo: p.campo,
      valor,
    });
    div.classList.add('hecha');
    div.innerHTML = `<p class="ruta">${p.route_text || ''}</p>
                     <p class="preg">${p.pregunta}</p>
                     <p class="ok">✓ Guardado: ${valor}</p>`;
  };
  return div;
}

// ---- "No listada": hallazgo libre ---------------------------
$('btnNoListada').onclick = () => {
  const txt = prompt('Describe la ruta o el dato que NO estaba en la lista:');
  if (!txt || !txt.trim()) return;
  encolar({
    operator_id: empresaActual ? empresaActual.id : null,
    operator_text: empresaActual ? empresaActual.nombre : null,
    route_id: null, route_text: null,
    campo: 'nueva_ruta', valor: txt.trim(),
  });
  $('avisoEnvio').textContent = 'Hallazgo agregado a la cola.';
  pintarBotonEnviar();
};

$('btnVolver').onclick = irAEmpresas;

// ---- Cola + envío (sincronización) --------------------------
function encolar(parcial) {
  const cola = store.cola;
  cola.push({
    ...parcial,
    pasante: (store.usuario && store.usuario.nombre) || null,
    informante: (($('informante') && $('informante').value.trim()) || null),
    client_uuid: uuid(),                       // idempotencia: reenviar no duplica
    capturado_en: new Date().toISOString(),
  });
  store.cola = cola;
  pintarBotonEnviar();
  if (navigator.onLine) enviar();
}

function pintarBotonEnviar() {
  $('btnEnviar').textContent = `Enviar capturas (${store.cola.length})`;
}

let enviando = false;
async function enviar() {
  const cola = store.cola;
  if (enviando || !cola.length || !navigator.onLine) return;
  enviando = true;
  try {
    const r = await fetch('/api/campo', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ items: cola }),
    });
    if (r.status === 401) { sesionVencida(); return; }
    const data = await r.json();
    if (data.sesion) store.sesion = data.sesion;   // renovación deslizante
    if (data.ok) {
      store.cola = [];                          // enviado (servidor es idempotente)
      $('avisoEnvio').textContent = `✓ ${data.guardados} enviado(s) a la bandeja de revisión.`;
    } else if (data.reason === 'tabla_pendiente') {
      $('avisoEnvio').textContent =
        'Guardado en el celular. El servidor aún no tiene la bandeja activada — ' +
        'nada se pierde, se enviará cuando se active.';
    } else {
      $('avisoEnvio').textContent = 'No se pudo enviar; sigue guardado en el celular.';
    }
  } catch {
    $('avisoEnvio').textContent = 'Sin señal: queda guardado y se enviará solo al volver.';
  } finally {
    enviando = false;
    pintarBotonEnviar();
  }
}
$('btnEnviar').onclick = enviar;

// ---- Arranque -----------------------------------------------
pintarEstado();
pintarBotonEnviar();
iniciarGoogle();      // prepara el botón de Google
arrancarSesion();     // si hay sesión guardada y válida, entra directo

// El ayudante offline (mismo principio que la demo que ya vimos).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
