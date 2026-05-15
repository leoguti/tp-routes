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

const CLAVE = 'busboy';

// ---- Estado guardado en el celular --------------------------
const store = {
  get pasante() { return localStorage.getItem('campo_pasante') || ''; },
  set pasante(v) { localStorage.setItem('campo_pasante', v); },
  get cola() { return JSON.parse(localStorage.getItem('campo_cola') || '[]'); },
  set cola(v) { localStorage.setItem('campo_cola', JSON.stringify(v)); },
  snap(key, val) {                         // foto de la última respuesta del servidor
    if (val === undefined) return JSON.parse(localStorage.getItem('snap_' + key) || 'null');
    localStorage.setItem('snap_' + key, JSON.stringify(val));
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
    const r = await fetch(path);
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

// ---- 1. Identidad -------------------------------------------
$('btnEntrar').onclick = () => {
  const clave = $('clave').value.trim().toLowerCase();
  const nombre = $('pasante').value.trim();
  if (clave !== CLAVE) { $('errIdent').textContent = 'Clave incorrecta'; return; }
  if (!nombre) { $('errIdent').textContent = 'Escribe tu nombre'; return; }
  store.pasante = nombre;
  sessionStorage.setItem('campo_ok', '1');
  irAEmpresas();
};

// ---- 2. Empresas --------------------------------------------
async function irAEmpresas() {
  $('titulo').textContent = 'Elegir empresa';
  verVista('vista-empresas');
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
    pasante: store.pasante,
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cola }),
    });
    const data = await r.json();
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
if (store.pasante && sessionStorage.getItem('campo_ok') === '1') {
  irAEmpresas();
} else if (store.pasante) {
  $('pasante').value = store.pasante;           // recuerda el nombre, pide clave de sesión
}

// El ayudante offline (mismo principio que la demo que ya vimos).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
