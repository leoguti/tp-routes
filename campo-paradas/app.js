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
  get colaPar() { return JSON.parse(localStorage.getItem('campo_cola_par') || '[]'); },   // cola de paradas
  set colaPar(v) { localStorage.setItem('campo_cola_par', JSON.stringify(v)); },
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
window.addEventListener('online',  () => { pintarEstado(); enviar(); enviarParadas(); });
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
  mostrarTab('paradas');                 // app aparte de paradas: arranca en esa pestaña
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

// ============================================================
//  MÓDULO PARADAS — localización con un conductor (pestaña "Paradas")
// ============================================================
let corredorActual = null;
let ordenPar = 0;
let metodoGeoActual = 'pegado_gmaps';
let parMap = null, parPin = null, leafletProm = null;
let paradaActual = null, esNuevaActual = false, paradasOficiales = [];

// Cambiar de pestaña dentro de la empresa.
$('tabTarifas').onclick = () => mostrarTab('tarifas');
$('tabParadas').onclick = () => mostrarTab('paradas');
function mostrarTab(cual) {
  const par = cual === 'paradas';
  $('tabTarifas').classList.toggle('activa', !par);
  $('tabParadas').classList.toggle('activa', par);
  $('panelTarifas').hidden = par;
  $('panelParadas').hidden = !par;
  if (par) iniciarParadas();
}

// Carga los corredores de la empresa actual (una vez por empresa).
async function iniciarParadas() {
  if (!empresaActual) return;
  pintarBotonEnviarPar();
  renderListaPar();
  const cont = $('parCorredores');
  if (cont.dataset.emp === String(empresaActual.id)) return;   // ya cargado para esta empresa
  cont.dataset.emp = String(empresaActual.id);
  corredorActual = null;
  $('parCaptura').hidden = true;
  $('parParadas').hidden = true;
  $('parDetalle').hidden = true;
  cont.innerHTML = 'Cargando corredores…';
  try {
    const data = await apiGet('/api/paradas?op=' + empresaActual.id, 'corr_' + empresaActual.id);
    if (!data.corredores || !data.corredores.length) {
      cont.innerHTML = '<p class="aviso">Esta empresa no tiene corredores listados.</p>';
      return;
    }
    cont.innerHTML = '';
    data.corredores.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'corredor';
      b.textContent = c.route_text;
      b.onclick = () => elegirCorredor(c, b);
      cont.appendChild(b);
    });
  } catch {
    cont.innerHTML = '<p class="aviso">No se pudieron cargar los corredores. Ábrelo con señal una vez.</p>';
  }
}

async function elegirCorredor(c, btn) {
  corredorActual = c;
  document.querySelectorAll('#parCorredores .corredor').forEach((x) => x.classList.remove('sel'));
  btn.classList.add('sel');
  $('parCorredorSel').textContent = '📍 ' + c.route_text;
  $('parCaptura').hidden = true;
  $('parParadas').hidden = false;
  ordenPar = store.colaPar.filter((p) => p.route_id === c.id).length;
  renderListaPar();
  await cargarParadasOficiales(c.id);
}

const normP = (s) => String(s ?? '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Marca local (persistente) de "ya capturé esta parada", para mostrarla 🟡
// aunque la cola ya se haya enviado (verde ✅ solo llega tras la promoción).
function marcarCapturada(routeId, nombre) {
  const k = routeId + '::' + normP(nombre);
  const s = JSON.parse(localStorage.getItem('campo_par_capt') || '[]');
  if (!s.includes(k)) { s.push(k); localStorage.setItem('campo_par_capt', JSON.stringify(s)); }
}
function capturadaLocal(nombre) {
  if (!corredorActual) return false;
  const s = JSON.parse(localStorage.getItem('campo_par_capt') || '[]');
  return s.includes(corredorActual.id + '::' + normP(nombre));
}

// Trae las paradas OFICIALES del corredor (verde/gris) y las pinta.
async function cargarParadasOficiales(routeId) {
  const cont = $('parListaOficiales');
  cont.innerHTML = 'Cargando paradas…';
  try {
    const data = await apiGet('/api/paradas?route=' + routeId, 'parof_' + routeId);
    paradasOficiales = data.paradas || [];
    renderParadasOficiales();
  } catch {
    cont.innerHTML = '<p class="aviso">No se pudieron cargar las paradas. Ábrelo con señal una vez.</p>';
  }
}

function estadoParada(p) {
  if (p.geo) return 'ok';                              // ya geolocalizada (oficial)
  if (capturadaLocal(p.nombre)) return 'revisar';     // capturada en sesión, por revisar
  return 'falta';                                      // gris: falta ubicar
}

function actualizarProgreso(ubicadas, total, faltan) {
  if (!total) { $('parProgreso').textContent = ''; $('parBarra').style.width = '0'; return; }
  $('parProgreso').textContent = faltan === 0
    ? '✓ Todas ubicadas. Revisa y envía.'
    : `Faltan ${faltan} de ${total} paradas`;
  $('parBarra').style.width = Math.round((ubicadas / total) * 100) + '%';
}

function filaParada(p) {
  const e = estadoParada(p);
  const term = (p.rol === 'origen' || p.rol === 'destino');
  const b = document.createElement('button');
  b.className = 'mstop mstop-' + e + (term ? ' mterm' : '');
  const nom = document.createElement('span');
  nom.className = 'mname';
  nom.textContent = p.nombre + (p.rol === 'origen' ? '  (origen)' : p.rol === 'destino' ? '  (destino)' : '');
  const chip = document.createElement('span');
  chip.className = 'par-chip';
  chip.textContent = e === 'falta' ? 'FALTA' : e === 'revisar' ? 'POR REVISAR' : 'UBICADA 🔒';
  const go = document.createElement('span');
  go.className = 'par-go';
  go.textContent = '›';
  b.append(nom, chip, go);
  b.onclick = () => elegirParada(p);
  return b;
}

// Lista en ORDEN (origen → intermedias → destino) como línea de metro vertical.
// El estado se ve por color/forma en su posición; NO se reordena: el orden es la información.
function renderParadasOficiales() {
  const cont = $('parListaOficiales');
  cont.innerHTML = '';
  if (!paradasOficiales.length) {
    cont.innerHTML = '<p class="aviso">Este corredor no tiene paradas listadas. Usa "no está en la lista".</p>';
    actualizarProgreso(0, 0, 0);
    return;
  }
  const faltan = paradasOficiales.filter((p) => estadoParada(p) === 'falta').length;
  const ubicadas = paradasOficiales.filter((p) => estadoParada(p) === 'ok').length;
  actualizarProgreso(ubicadas, paradasOficiales.length, faltan);

  const metro = document.createElement('div');
  metro.className = 'metro';
  paradasOficiales.forEach((p) => metro.appendChild(filaParada(p)));   // EN ORDEN
  cont.appendChild(metro);
}

// Tocar una parada: si ya está ubicada (verde) → detalle protegido; si no → captura directa.
function elegirParada(p) {
  if (p.geo) { verDetalleParada(p); return; }
  abrirCapturaParada(p);
}

// Abre el formulario de captura para una parada OFICIAL (nombre fijo, no editable).
function abrirCapturaParada(p) {
  paradaActual = p;
  esNuevaActual = false;
  $('parNombreWrap').hidden = true;
  const e = estadoParada(p);
  $('parParadaSel').textContent = (e === 'ok' ? '✅ ' : e === 'revisar' ? '🟡 ' : '⚪ ') + p.nombre;
  $('parParadas').hidden = true;
  $('parDetalle').hidden = true;
  $('parCaptura').hidden = false;
  limpiarFormParada();
  if (p.geo && p.lat != null && p.lon != null) {        // editar una ya ubicada: precarga
    $('parCoord').value = (+p.lat).toFixed(6) + ', ' + (+p.lon).toFixed(6);
    $('parCoord').oninput();
  }
}

// Detalle de solo-lectura de una parada ya ubicada (paso extra antes de editar).
function verDetalleParada(p) {
  paradaActual = p;
  $('parDetNombre').textContent = '● ' + p.nombre;
  $('parDetCoord').textContent = (p.lat != null && p.lon != null)
    ? 'Coordenada: ' + (+p.lat).toFixed(6) + ', ' + (+p.lon).toFixed(6)
    : 'Sin coordenada';
  $('parParadas').hidden = true;
  $('parCaptura').hidden = true;
  $('parDetalle').hidden = false;
}

$('parDetVolver').onclick = () => {
  $('parDetalle').hidden = true;
  $('parParadas').hidden = false;
  renderParadasOficiales();
};
$('parDetStreetView').onclick = () => {
  if (paradaActual && paradaActual.lat != null) {
    window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${paradaActual.lat},${paradaActual.lon}`, '_blank');
  }
};
$('parDetMapa').onclick = () => {
  if (paradaActual && paradaActual.lat != null) {
    window.open(`https://www.google.com/maps/search/?api=1&query=${paradaActual.lat},${paradaActual.lon}`, '_blank');
  }
};
$('parDetEditar').onclick = () => {
  if (!paradaActual) return;
  if (confirm(`¿Cambiar la ubicación de ${paradaActual.nombre}? Ya estaba ubicada.`)) {
    abrirCapturaParada(paradaActual);
  }
};

// Capturar una parada que NO está en la lista oficial (marca es_nueva).
$('parNoListada').onclick = () => {
  paradaActual = null;
  esNuevaActual = true;
  $('parNombreWrap').hidden = false;
  $('parParadaSel').textContent = '➕ Parada nueva (no estaba en la lista)';
  $('parParadas').hidden = true;
  $('parDetalle').hidden = true;
  $('parCaptura').hidden = false;
  limpiarFormParada();
};

$('parVolverParadas').onclick = () => {
  $('parCaptura').hidden = true;
  $('parParadas').hidden = false;
  renderParadasOficiales();
};

// ---- Coordenada: parseo + validación ------------------------
const BOY = { latMin: 4.4, latMax: 7.2, lonMin: -74.8, lonMax: -72.0 };       // Boyacá (advertir si sale)
const COL = { latMin: -4.3, latMax: 13.5, lonMin: -79.1, lonMax: -66.8 };     // Colombia (cota dura)

// Grados-minutos-segundos: 5°32'07.1"N 73°22'04.1"O  → decimal (O = Oeste).
function parsearDMS(txt) {
  const re = /(\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′]\s*)?(?:(\d+(?:\.\d+)?)\s*["″]?\s*)?([NSEWOnsewo])/g;
  const partes = [...txt.matchAll(re)];
  if (partes.length < 2) return null;
  let lat = null, lon = null;
  for (const p of partes) {
    let dec = parseFloat(p[1]) + (parseFloat(p[2] || 0)) / 60 + (parseFloat(p[3] || 0)) / 3600;
    const hem = p[4].toUpperCase();
    if (hem === 'S' || hem === 'W' || hem === 'O') dec = -dec;   // O = Oeste = longitud negativa
    if (hem === 'N' || hem === 'S') lat = dec; else lon = dec;
  }
  return (lat !== null && lon !== null) ? { lat, lon } : null;
}

function parsearCoord(txt) {
  if (!txt) return null;
  if (/[°º]/.test(txt)) { const d = parsearDMS(txt); if (d) return d; }   // DMS si trae grados
  let m = txt.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);          // URL Google: !3dLAT!4dLON
  if (m) return { lat: +m[1], lon: +m[2] };
  m = txt.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);                   // URL Google: @lat,lon
  if (m) return { lat: +m[1], lon: +m[2] };
  m = txt.replace(/\s+/g, ' ').match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);  // "lat, lon"
  if (m) return { lat: +m[1], lon: +m[2] };
  return null;
}

function validarCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, msg: 'No pude leer la coordenada.' };
  if (lat === 0 && lon === 0) return { ok: false, msg: 'Coordenada vacía (0,0).' };
  const enCol = (la, lo) => la >= COL.latMin && la <= COL.latMax && lo >= COL.lonMin && lo <= COL.lonMax;
  if (!enCol(lat, lon)) {
    if (enCol(lon, lat)) return { ok: false, msg: `¿Invertiste lat/lon? Prueba: ${lon.toFixed(6)}, ${lat.toFixed(6)}` };
    return { ok: false, msg: 'La coordenada está fuera de Colombia. Revísala.' };
  }
  const fueraBoy = lat < BOY.latMin || lat > BOY.latMax || lon < BOY.lonMin || lon > BOY.lonMax;
  return { ok: true, warn: fueraBoy ? 'Ojo: parece fuera de Boyacá, confírmalo.' : '' };
}

function coordActual() {
  const p = parsearCoord($('parCoord').value.trim());
  if (!p) return null;
  return { ...p, ...validarCoord(p.lat, p.lon) };
}

$('parCoord').oninput = () => {
  const el = $('parCoordEstado');
  if (!$('parCoord').value.trim()) { el.textContent = ''; return; }
  const c = coordActual();
  if (!c)     { el.textContent = 'No pude leer la coordenada.'; el.style.color = '#c62828'; return; }
  metodoGeoActual = 'pegado_gmaps';
  if (!c.ok)  { el.textContent = '⚠ ' + c.msg; el.style.color = '#c62828'; return; }
  el.textContent = '✓ ' + c.lat.toFixed(6) + ', ' + c.lon.toFixed(6) + (c.warn ? ' — ' + c.warn : '');
  el.style.color = c.warn ? '#e67e22' : '#2e7d32';
  if (parMap) { fijarPin(c.lat, c.lon); parMap.setView([c.lat, c.lon], 15); }
};

$('parAbrirGmaps').onclick = () => {
  const c = coordActual();
  if (c && c.ok) {
    // Street View EN la coordenada exacta: el conductor VE el punto y confirma "sí, es ahí".
    window.open(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${c.lat},${c.lon}`, '_blank');
    return;
  }
  // Sin coordenada todavía: abrir Google Maps buscando el destino (para llegar a la zona).
  const destino = corredorActual ? corredorActual.route_text.split('→').pop().trim() : '';
  window.open('https://www.google.com/maps/search/' + encodeURIComponent((destino || '') + ' Boyacá Colombia'), '_blank');
};

// ---- Mapa Leaflet (carga diferida): tocar el mapa fija la coordenada ----
function cargarLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletProm) return leafletProm;
  leafletProm = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = resolve;
    js.onerror = () => reject(new Error('no_leaflet'));
    document.head.appendChild(js);
  });
  return leafletProm;
}

// Refleja en el campo + estado una coord venida del mapa (pin).
function coordDesdeMapa(lat, lon) {
  metodoGeoActual = 'mapa_pin';
  $('parCoord').value = lat.toFixed(6) + ', ' + lon.toFixed(6);
  const el = $('parCoordEstado');
  const v = validarCoord(lat, lon);
  if (!v.ok) { el.textContent = '⚠ ' + v.msg; el.style.color = '#c62828'; return; }
  el.textContent = '✓ ' + lat.toFixed(6) + ', ' + lon.toFixed(6) + (v.warn ? ' — ' + v.warn : '');
  el.style.color = v.warn ? '#e67e22' : '#2e7d32';
}

function fijarPin(lat, lon) {
  if (!parMap) return;
  if (!parPin) {
    parPin = L.marker([lat, lon], { draggable: true }).addTo(parMap);
    parPin.on('dragend', () => { const ll = parPin.getLatLng(); coordDesdeMapa(ll.lat, ll.lng); });
  } else {
    parPin.setLatLng([lat, lon]);
  }
}

$('parMostrarMapa').onclick = async () => {
  $('parMapWrap').hidden = false;
  try {
    await cargarLeaflet();
  } catch {
    $('parCoordEstado').textContent = 'No se pudo cargar el mapa (necesita señal). Usa "pegar coordenada".';
    $('parCoordEstado').style.color = '#c62828';
    return;
  }
  if (!parMap) {
    parMap = L.map('parMap').setView([5.5353, -73.3678], 9);   // Boyacá
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(parMap);
    parMap.on('click', (e) => { fijarPin(e.latlng.lat, e.latlng.lng); coordDesdeMapa(e.latlng.lat, e.latlng.lng); });
  }
  setTimeout(() => parMap.invalidateSize(), 120);   // el contenedor estaba oculto al crear
  const c = coordActual();
  if (c && c.ok) { parMap.setView([c.lat, c.lon], 15); fijarPin(c.lat, c.lon); }
};

// ---- Agregar / enviar paradas -------------------------------
$('parAgregar').onclick = () => {
  const nombre = esNuevaActual ? $('parNombre').value.trim() : (paradaActual ? paradaActual.nombre : '');
  const c = coordActual();
  if (!nombre)        { $('parAvisoEnvio').textContent = 'Escribe el nombre de la parada nueva.'; return; }
  if (!c || !c.ok)    { $('parAvisoEnvio').textContent = 'Pega o corrige la coordenada primero.'; return; }
  ordenPar++;
  encolarParada({
    operator_id: empresaActual.id,
    operator_text: empresaActual.nombre,
    route_id: corredorActual ? corredorActual.id : null,
    route_text: corredorActual ? corredorActual.route_text : null,
    nombre,
    lat: c.lat, lon: c.lon,
    orden: (paradaActual && paradaActual.orden != null) ? paradaActual.orden : ordenPar,
    tipo: $('parTipo').value || null,
    metodo_geo: metodoGeoActual,
    nota_libre: $('parNota').value.trim() || null,
    es_nueva: esNuevaActual,
    informante_rol: 'conductor',
    informante_alias: $('parConductor').value.trim() || null,
  });
  if (corredorActual) marcarCapturada(corredorActual.id, nombre);
  // Volver a la lista de paradas, marcando la recién capturada (🟡).
  $('parCaptura').hidden = true;
  $('parParadas').hidden = false;
  renderParadasOficiales();
};

function encolarParada(parcial) {
  const cola = store.colaPar;
  cola.push({ ...parcial, client_uuid: uuid(), capturado_en: new Date().toISOString() });
  store.colaPar = cola;
  pintarBotonEnviarPar();
  renderListaPar();
  if (navigator.onLine) enviarParadas();
}

function renderListaPar() {
  const cont = $('parLista');
  if (!cont) return;
  cont.innerHTML = store.colaPar.map((p) =>
    `<div class="card"><p class="ruta">${p.route_text || ''}</p>
     <p class="ok">✓ ${p.nombre} — ${(+p.lat).toFixed(5)}, ${(+p.lon).toFixed(5)}</p></div>`).join('');
}

function pintarBotonEnviarPar() {
  $('parEnviar').textContent = `Enviar paradas (${store.colaPar.length})`;
}

function limpiarFormParada() {
  $('parNombre').value = '';
  $('parCoord').value = '';
  $('parNota').value = '';
  $('parTipo').value = '';
  $('parCoordEstado').textContent = '';
  metodoGeoActual = 'pegado_gmaps';
  if (parPin && parMap) { parMap.removeLayer(parPin); parPin = null; }   // pin fresco para la próxima parada
}

let enviandoPar = false;
async function enviarParadas() {
  const cola = store.colaPar;
  if (enviandoPar || !cola.length || !navigator.onLine) return;
  enviandoPar = true;
  try {
    const r = await fetch('/api/paradas', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ items: cola }),
    });
    if (r.status === 401) { sesionVencida(); return; }
    const data = await r.json();
    if (data.sesion) store.sesion = data.sesion;             // renovación deslizante
    if (data.ok) {
      store.colaPar = [];
      $('parAvisoEnvio').textContent = `✓ ${data.guardados} parada(s) enviada(s) a la bandeja.`;
      renderListaPar();
    } else if (data.reason === 'tabla_pendiente') {
      $('parAvisoEnvio').textContent =
        'Guardado en el celular. La bandeja de paradas aún no está activa — nada se pierde.';
    } else {
      $('parAvisoEnvio').textContent = 'No se pudo enviar; sigue guardado en el celular.';
    }
  } catch {
    $('parAvisoEnvio').textContent = 'Sin señal: queda guardado y se enviará solo al volver.';
  } finally {
    enviandoPar = false;
    pintarBotonEnviarPar();
  }
}
$('parEnviar').onclick = enviarParadas;

// ---- Arranque -----------------------------------------------
pintarEstado();
pintarBotonEnviar();
pintarBotonEnviarPar();
iniciarGoogle();      // prepara el botón de Google
arrancarSesion();     // si hay sesión guardada y válida, entra directo

// El ayudante offline (mismo principio que la demo que ya vimos).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
