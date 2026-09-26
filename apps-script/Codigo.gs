// Backend de Creamos Imagen: guarda cada módulo como un par llave/valor en la
// hoja SHEET_NAME (columna A = llave, columna B = valor JSON).
//
// SEGURIDAD (sesiones y permisos por módulo)
//  - El menú (index.html) envía el "credential" que entrega Google Sign-In a
//    accion=login. Aquí se verifica con Google (tokeninfo) que el token sea
//    válido, de esta aplicación (aud = GOOGLE_CLIENT_ID) y con correo
//    verificado, y se responde una sesión firmada (HMAC) que vence en 24 h.
//    Las cuentas de Microsoft (Hotmail/Outlook) entran por
//    accion=loginMicrosoft y reciben la misma sesión (ver "Login con Microsoft").
//  - Cada lectura/escritura trae esa sesión en "token". Con el correo de la
//    sesión se calculan los permisos en el servidor (accesos_ci_v1 + super
//    admin), y cada llave solo se entrega o guarda si el usuario tiene el
//    módulo dueño de esa llave (REGLAS). Nada depende de lo que diga el
//    navegador.
//  - Mi Portal (trabajador.html) no lee llaves de RRHH: usa accion=portal,
//    que devuelve solo los datos del trabajador cuyo email coincide con la
//    sesión, y accion=solicitarVac / cancelarVac para sus solicitudes.
//  - MODO TRANSICIÓN: mientras la propiedad MODO_ESTRICTO no sea "si", el
//    token antiguo (APP_TOKEN, publicado en el repositorio) sigue dando
//    acceso total, para que las páginas en caché no se rompan durante el
//    cambio. Un administrador lo activa desde Accesos (accion=config) o
//    ejecutando activarModoEstricto() en el editor.
//
// RENDIMIENTO (versión anterior, se mantiene)
//  - Se lee solo la columna A para ubicar la fila y luego una celda.
//  - Las lecturas se sirven desde CacheService; cada guardado actualiza el
//    caché. LockService evita filas duplicadas en guardados simultáneos.
//  - Si se edita la hoja A MANO, ejecutar limpiarCache() desde el editor.

const SHEET_ID = "1H1I_00xY-HdqVCrDNei35FIl2EOx7tAWA3iOP3hJ8IE";
const SHEET_NAME = "Hoja 1"; // Debe ser el nombre de la pestaña donde están los datos
const SHEET_MARCACIONES = "Marcaciones";
const APP_TOKEN = "b5bd161b4ef581c6114b7bb4"; // token antiguo: solo vale en modo transición
const GOOGLE_CLIENT_ID = "207433225749-76s4184pif80ge7gfr0nt39qa80b82ij.apps.googleusercontent.com";
const SUPER_ADMIN_EMAIL = "a.catalan.valdes@gmail.com";
const ACL_KEY = "accesos_ci_v1";
const SESION_TTL_MS = 24 * 60 * 60 * 1000; // igual que en las páginas
const MODULOS = ["rendicion", "clientes", "costos", "cotizaciones", "dashboard", "calendario", "proveedores", "ventasci", "ventas", "rrhh"];

const CACHE_TTL_S = 21600; // 6 horas (máximo permitido por CacheService)
const CACHE_PREFIX = "v1:";
const CACHE_NULL = "__NULL__"; // marca "la llave no existe", para no buscarla de nuevo
const CACHE_MAX_CHARS = 90000; // CacheService admite hasta 100 KB por valor

// Dueños de cada llave: "escribe" puede leer y guardar; "lee" solo leer.
// Las llaves en bloques ("<llave>_sh1", "_sh2"...) siguen la regla de su llave.
// Una llave que no calce con ninguna regla es solo para administradores.
const REGLAS = [
  { llave: /^clientes_ci_v1$/,       escribe: ["clientes"],     lee: ["calendario", "cotizaciones"] },
  { llave: /^costos_ci_v1$/,         escribe: ["costos"],       lee: ["cotizaciones", "dashboard"] },
  { llave: /^(cotizaciones|tarifario)_ci_v1$/, escribe: ["cotizaciones"], lee: [] },
  { llave: /^(compras|proveedores)_ci_v1$/,    escribe: ["proveedores"],  lee: ["dashboard"] },
  { llave: /^creamos_imagen_v1$/,    escribe: ["ventasci"],     lee: ["dashboard"] },
  { llave: /^sublipro_v2$/,          escribe: ["ventas"],       lee: ["dashboard"] },
  { llave: /^rendicion\d{4}_v\d+$/,  escribe: ["rendicion"],    lee: ["dashboard"] },
  { llave: /^prods\d{4}$/,           escribe: ["calendario"],   lee: ["clientes", "dashboard"] },
  { llave: /^rrhh_[a-z_]+_v\d+$/,    escribe: ["rrhh"],         lee: [] }
];

// ------------------------------------------------------------------
// Utilidades de hoja y caché
// ------------------------------------------------------------------
function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function error(detalle) { return respuesta({ estado: "error", detalle: detalle }); }

function hoja() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

// Devuelve el número de fila (1-based) de la llave, o -1 si no existe.
function buscarFila(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return -1;
  const llaves = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (let i = 0; i < llaves.length; i++) {
    if (llaves[i][0] === key) return i + 1;
  }
  return -1;
}

function guardarEnCache(key, value) {
  const cache = CacheService.getScriptCache();
  const texto = (value === null || value === undefined || value === "") ? CACHE_NULL : String(value);
  if (texto.length <= CACHE_MAX_CHARS) {
    cache.put(CACHE_PREFIX + key, texto, CACHE_TTL_S);
  } else {
    cache.remove(CACHE_PREFIX + key);
  }
}

// Valor crudo (texto) de una llave, o null.
function leerValor(key) {
  const enCache = CacheService.getScriptCache().get(CACHE_PREFIX + key);
  if (enCache !== null) return enCache === CACHE_NULL ? null : enCache;
  const sheet = hoja();
  const fila = buscarFila(sheet, key);
  const value = fila > -1 ? sheet.getRange(fila, 2).getValue() : null;
  const valor = (value === "" || value === undefined) ? null : value;
  guardarEnCache(key, valor);
  return valor;
}

// Guarda una llave. Quien llama debe tener tomado el lock.
function escribirValor(key, value) {
  const sheet = hoja();
  const fila = buscarFila(sheet, key);
  if (fila > -1) sheet.getRange(fila, 2).setValue(value);
  else sheet.appendRow([key, value]);
  SpreadsheetApp.flush();
  guardarEnCache(key, value);
}

function leerJSON(key) {
  const v = leerValor(key);
  if (v === null) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

// Llaves de RRHH: texto JSON partido en bloques {shardCount, parte}.
function leerRRHH(key) {
  const primero = leerJSON(key);
  if (!primero) return [];
  if (Array.isArray(primero)) return primero;
  if (typeof primero.shardCount !== "number") throw new Error("Formato no reconocido en " + key);
  let texto = primero.parte || "";
  for (let i = 1; i < primero.shardCount; i++) {
    const b = leerJSON(key + "_sh" + i);
    if (!b || typeof b.parte !== "string") throw new Error("Falta la partición " + i + " de " + key);
    texto += b.parte;
  }
  return texto ? JSON.parse(texto) : [];
}

// ------------------------------------------------------------------
// Sesiones firmadas
// ------------------------------------------------------------------
function secreto() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty("SESSION_SECRET");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("SESSION_SECRET", s);
  }
  return s;
}
function firmar(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, secreto())).replace(/=+$/, "");
}
function crearToken(email) {
  const datos = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: Date.now() + SESION_TTL_MS }), Utilities.Charset.UTF_8).replace(/=+$/, "");
  return datos + "." + firmar(datos);
}
// Devuelve el correo de la sesión, o null si el token no es válido o venció.
function leerToken(token) {
  if (!token || typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  if (firmar(partes[0]) !== partes[1]) return null;
  try {
    let b64 = partes[0]; while (b64.length % 4) b64 += "=";
    const datos = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8"));
    if (!datos.e || !datos.x || datos.x < Date.now()) return null;
    return String(datos.e).toLowerCase();
  } catch (e) { return null; }
}

function modoEstricto() {
  return PropertiesService.getScriptProperties().getProperty("MODO_ESTRICTO") === "si";
}

// ------------------------------------------------------------------
// Permisos
// ------------------------------------------------------------------
// Usuario con el token antiguo (solo en modo transición): acceso total.
const USUARIO_LEGADO = { email: "(token antiguo)", isAdmin: true, modules: MODULOS.slice(), esTrabajador: false, legado: true };

function permisosDe(email) {
  const e = String(email || "").trim().toLowerCase();
  const acl = leerJSON(ACL_KEY) || {};
  const entrada = acl[e] || null;
  const isAdmin = e === SUPER_ADMIN_EMAIL || !!(entrada && entrada.admin);
  const modules = isAdmin ? MODULOS.slice() : ((entrada && entrada.modules) || []).filter(function (m) { return MODULOS.indexOf(m) !== -1; });
  return { email: e, isAdmin: isAdmin, modules: modules };
}

function trabajadorDeCorreo(email, trabajadores) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  return (trabajadores || []).find(function (t) { return String(t.email || "").trim().toLowerCase() === e; }) || null;
}

function perfil(email) {
  const p = permisosDe(email);
  let t = null;
  try { t = trabajadorDeCorreo(email, leerRRHH("rrhh_trabajadores_v1")); } catch (e) {}
  p.esTrabajador = !!(t && t.estado !== "Inactivo");
  return p;
}

// Identifica al usuario de la petición: sesión firmada o (en transición) token antiguo.
function usuarioDe(token) {
  const email = leerToken(token);
  if (email) return permisosDe(email);
  if (token === APP_TOKEN && !modoEstricto()) return USUARIO_LEGADO;
  return null;
}

function llaveBase(key) { return String(key || "").replace(/_sh\d+$/, ""); }

function puede(usuario, key, escribir) {
  if (!usuario) return false;
  if (usuario.isAdmin) return true;
  const base = llaveBase(key);
  const regla = REGLAS.find(function (r) { return r.llave.test(base); });
  if (!regla) return false; // accesos_ci_v1 y llaves desconocidas: solo administradores
  const mods = usuario.modules || [];
  const tiene = function (lista) { return lista.some(function (m) { return mods.indexOf(m) !== -1; }); };
  return escribir ? tiene(regla.escribe) : (tiene(regla.escribe) || tiene(regla.lee));
}

function motivoRechazo(token) {
  if (!token) return "NO_AUTORIZADO";
  if (token === APP_TOKEN) return "NO_AUTORIZADO"; // token antiguo en modo estricto
  return String(token).indexOf(".") > -1 ? "SESION_EXPIRADA" : "NO_AUTORIZADO";
}

// ------------------------------------------------------------------
// Entradas HTTP
// ------------------------------------------------------------------
function normalizarCorreo(email) {
  return String(email || "").trim().toLowerCase();
}

function hojaMarcaciones() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_MARCACIONES);
  if (!sh) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      sh = ss.getSheetByName(SHEET_MARCACIONES);
      if (!sh) {
        sh = ss.insertSheet(SHEET_MARCACIONES);
        sh.appendRow(["ID", "Trabajador ID", "Correo", "Tipo", "Fecha y hora servidor", "Latitud", "Longitud", "Precisión (m)"]);
        sh.setFrozenRows(1);
      }
    } finally { lock.releaseLock(); }
  }
  return sh;
}

function usuarioPuedeVerMarcacionesRRHH(email) {
  if (email === "a.catalan.valdes@gmail.com") return true;
  let acl = leerJSON(ACL_KEY);
  try { if (typeof acl === "string") acl = JSON.parse(acl); } catch (e) { return false; }
  const acceso = acl && acl[email];
  return !!(acceso && (acceso.admin || (acceso.modules || []).indexOf("rrhh") !== -1));
}

function listarFilasMarcaciones(sh, trabajadorId) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const desde = Math.max(2, last - 1999);
  return sh.getRange(desde, 1, last - desde + 1, 8).getValues()
    .filter(r => !trabajadorId || String(r[1]) === String(trabajadorId))
    .map(r => ({
      id:String(r[0]), trabajadorId:String(r[1]), tipo:String(r[3]),
      fechaServidor:Utilities.formatDate(new Date(r[4]), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      latitud:Number(r[5]), longitud:Number(r[6]), precisionMetros:Number(r[7])
    }));
}

function manejarMarcaciones(payload) {
  const sessionEmail = leerToken(payload.token);
  if (!sessionEmail) throw new Error("Sesión no autorizada o vencida.");
  // La sesión firmada ya identifica a la persona (con Google o Microsoft).
  const identidad = { email: normalizarCorreo(sessionEmail) };
  if (payload.action === "listarMarcaciones" && payload.verTodos === true) {
    if (!usuarioPuedeVerMarcacionesRRHH(identidad.email)) throw new Error("No tienes permiso para ver las marcaciones del equipo.");
    return respuesta({ estado:"éxito", marcaciones:listarFilasMarcaciones(hojaMarcaciones(), null) });
  }
  const trabajadores = leerRRHH("rrhh_trabajadores_v1");
  const trabajador = trabajadores.find(t => normalizarCorreo(t.email) === identidad.email && t.estado !== "Inactivo");
  if (!trabajador || String(trabajador.id) !== String(payload.trabajadorId)) throw new Error("La cuenta no corresponde a un trabajador activo de esta ficha.");

  const sh = hojaMarcaciones();
  if (payload.action === "listarMarcaciones") {
    return respuesta({ estado:"éxito", marcaciones:listarFilasMarcaciones(sh, trabajador.id).slice(-500) });
  }
  if (payload.action !== "registrarMarcacion") throw new Error("Acción de marcación desconocida.");
  if (payload.tipo !== "ENTRADA" && payload.tipo !== "SALIDA") throw new Error("Tipo de marcación inválido.");
  const u = payload.ubicacion || {};
  const lat = Number(u.latitud), lon = Number(u.longitud), precision = Number(u.precisionMetros);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180 || !Number.isFinite(precision) || precision <= 0) throw new Error("No se recibió una ubicación válida.");

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const last = sh.getLastRow();
    const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    let ultima = null;
    if (last >= 2) {
      const rows = sh.getRange(2, 1, last - 1, 8).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][1]) !== String(trabajador.id)) continue;
        const fecha = Utilities.formatDate(new Date(rows[i][4]), Session.getScriptTimeZone(), "yyyy-MM-dd");
        if (fecha === hoy) { ultima = rows[i]; break; }
        if (fecha < hoy) break;
      }
    }
    if (payload.tipo === "ENTRADA" && ultima && String(ultima[3]) === "ENTRADA") throw new Error("Ya hay una entrada sin salida registrada hoy.");
    if (payload.tipo === "SALIDA" && (!ultima || String(ultima[3]) !== "ENTRADA")) throw new Error("Primero debe existir una entrada abierta para registrar la salida.");

    const ahora = new Date();
    const registro = [Utilities.getUuid(), String(trabajador.id), identidad.email, payload.tipo, ahora, lat, lon, precision];
    sh.appendRow(registro);
    SpreadsheetApp.flush();
    return respuesta({ estado:"éxito", marcacion:{ tipo:payload.tipo, fechaServidor:Utilities.formatDate(ahora, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss") } });
  } finally { lock.releaseLock(); }
}

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.accion) return accionGet(p);
    const usuario = usuarioDe(p.token);
    if (!usuario) return error(motivoRechazo(p.token));
    if (!puede(usuario, p.key, false)) return error("SIN_PERMISO");
    return respuesta({ estado: "éxito", valor: leerValor(p.key) });
  } catch (err) {
    return error(err.toString());
  }
}

function doPost(e) {
  let payload;
  try { payload = JSON.parse(e.postData.contents); } catch (err) { return error("Petición inválida"); }
  if (payload.accion || payload.action) {
    try { return accionPost(payload); } catch (err) { return error(err.toString()); }
  }
  const usuario = usuarioDe(payload.token);
  if (!usuario) return error(motivoRechazo(payload.token));
  if (!puede(usuario, payload.key, true)) return error("SIN_PERMISO");
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    escribirValor(payload.key, payload.value);
    return respuesta({ estado: "éxito" });
  } catch (err) {
    return error(err.toString());
  } finally {
    lock.releaseLock();
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.JSON);
}

function accionGet(p) {
  if (p.accion === "yo") {
    const email = leerToken(p.token);
    if (!email) return error(motivoRechazo(p.token));
    const pf = perfil(email);
    return respuesta({ estado: "éxito", isAdmin: pf.isAdmin, modules: pf.modules, esTrabajador: pf.esTrabajador, modoEstricto: modoEstricto() });
  }
  if (p.accion === "portal") return accionPortal(p.token, p.trabajadorId);
  if (p.accion === "portalDocs") return accionPortalDocs(p.token, p.trabajadorId);
  if (p.accion === "config") {
    const u = usuarioDe(p.token);
    if (!u || !u.isAdmin || u.legado) return error("SIN_PERMISO");
    return respuesta({ estado: "éxito", modoEstricto: modoEstricto() });
  }
  return error("Acción desconocida");
}

function accionPost(b) {
  if (b.accion === "login") return accionLogin(b.credential);
  if (b.accion === "loginMicrosoft") return accionLoginMicrosoft(b);
  if (b.action === "listarMarcaciones" || b.action === "registrarMarcacion") return manejarMarcaciones(b);
  if (b.accion === "solicitarVac") return accionSolicitarVac(b);
  if (b.accion === "cancelarVac") return accionCancelarVac(b);
  if (b.accion === "config") {
    const u = usuarioDe(b.token);
    if (!u || !u.isAdmin || u.legado) return error("SIN_PERMISO");
    PropertiesService.getScriptProperties().setProperty("MODO_ESTRICTO", b.modoEstricto ? "si" : "no");
    return respuesta({ estado: "éxito", modoEstricto: modoEstricto() });
  }
  return error("Acción desconocida");
}

// ------------------------------------------------------------------
// Login con Google
// ------------------------------------------------------------------
function verificarCredencialGoogle(credential) {
  if (!credential || typeof credential !== "string") return null;
  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(credential), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const info = JSON.parse(res.getContentText());
  const emisorOk = info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com";
  const verificado = info.email_verified === true || info.email_verified === "true";
  if (info.aud !== GOOGLE_CLIENT_ID || !emisorOk || !verificado || !info.email) return null;
  if (Number(info.exp) * 1000 < Date.now()) return null;
  return { email: String(info.email).toLowerCase(), name: info.name || "", picture: info.picture || "" };
}

function accionLogin(credential) {
  const g = verificarCredencialGoogle(credential);
  if (!g) return error("CREDENCIAL_INVALIDA");
  const pf = perfil(g.email);
  return respuesta({
    estado: "éxito",
      sesion: { token: crearToken(g.email), email: g.email, name: g.name || g.email, picture: g.picture, isAdmin: pf.isAdmin, modules: pf.modules, esTrabajador: pf.esTrabajador, ts: Date.now() }
  });
}

// ------------------------------------------------------------------
// Login con Microsoft (Hotmail, Outlook.com, Live, MSN)
// ------------------------------------------------------------------
// El menú manda a la persona a iniciar sesión en Microsoft y vuelve con un
// "code" de un solo uso. Aquí se canjea ese code directamente con Microsoft
// (con el secreto de la app, que el navegador nunca ve): el id_token que
// Microsoft entrega por esa conexión es auténtico y no hace falta verificar
// su firma. Se revisa que sea de esta app (aud) y de una cuenta personal de
// Microsoft (tid de "consumers"): las cuentas de empresas quedan fuera porque
// su correo lo escribe el administrador de esa empresa y no está verificado.
//
// Propiedades del script (Configuración del proyecto > Propiedades del script):
//   MS_CLIENT_ID      Id. de aplicación (cliente) del registro en Azure
//   MS_CLIENT_SECRET  Valor del secreto de cliente
const MS_TENANT_CONSUMERS = "9188040d-6c67-4c5b-b112-36a304b66dad";

// Devuelve { email, name } o { motivo } con la causa del rechazo (para
// mostrarla en el menú; nunca incluye el secreto ni el token).
function verificarCodigoMicrosoft(code, redirectUri) {
  if (!code || typeof code !== "string" || !redirectUri || typeof redirectUri !== "string") return { motivo: "faltan datos" };
  const props = PropertiesService.getScriptProperties();
  const clientId = String(props.getProperty("MS_CLIENT_ID") || "").trim();
  const secret = String(props.getProperty("MS_CLIENT_SECRET") || "").trim();
  if (!clientId || !secret) throw new Error("Falta configurar MS_CLIENT_ID y MS_CLIENT_SECRET en las propiedades del script.");
  const res = UrlFetchApp.fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "post",
    payload: { client_id: clientId, client_secret: secret, code: code, redirect_uri: redirectUri, grant_type: "authorization_code", scope: "openid email profile" },
    muteHttpExceptions: true
  });
  let datos = {};
  try { datos = JSON.parse(res.getContentText()); } catch (e) {}
  if (res.getResponseCode() !== 200) {
    // Microsoft explica el rechazo con un código AADSTS (secreto inválido, code usado, etc.).
    return { motivo: "Microsoft rechazó el canje (" + (datos.error || res.getResponseCode()) + "): " + String(datos.error_description || "").split(/\r?\n/)[0].slice(0, 200) };
  }
  const idToken = datos.id_token;
  if (!idToken) return { motivo: "Microsoft no entregó id_token" };
  let info;
  try {
    let b64 = idToken.split(".")[1]; while (b64.length % 4) b64 += "=";
    info = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString("UTF-8"));
  } catch (e) { return { motivo: "id_token ilegible" }; }
  const email = normalizarCorreo(info.email || info.preferred_username);
  if (info.aud !== clientId) return { motivo: "id_token de otra aplicación" };
  if (info.tid !== MS_TENANT_CONSUMERS) return { motivo: "no es una cuenta personal de Microsoft" };
  if (email.indexOf("@") < 1) return { motivo: "la cuenta no informó correo" };
  if (Number(info.exp) * 1000 < Date.now()) return { motivo: "id_token vencido" };
  return { email: email, name: info.name || "" };
}

function accionLoginMicrosoft(b) {
  const m = verificarCodigoMicrosoft(b.code, b.redirectUri);
  if (m.motivo) return error("Cuenta de Microsoft no verificada: " + m.motivo);
  const pf = perfil(m.email);
  return respuesta({
    estado: "éxito",
    sesion: { token: crearToken(m.email), email: m.email, name: m.name || m.email, picture: "", isAdmin: pf.isAdmin, modules: pf.modules, esTrabajador: pf.esTrabajador, ts: Date.now() }
  });
}

// Ejecutar una vez desde el editor de Apps Script para que el propietario
// autorice las llamadas de validación de Google y el acceso a la hoja.
function autorizarServicios() {
  SpreadsheetApp.openById(SHEET_ID).getSheets()[0].getName();
  UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=invalid", { muteHttpExceptions: true });
}

// ------------------------------------------------------------------
// Mi Portal
// ------------------------------------------------------------------
const KEY_SOL_VAC = "rrhh_solicitudes_vac_v1";
const RRHH = { trab: "rrhh_trabajadores_v1", liq: "rrhh_liquidaciones_v1", vac: "rrhh_vacaciones_v1", perm: "rrhh_permisos_v1", asis: "rrhh_asistencia_v1", lic: "rrhh_licencias_v1", doc: "rrhh_documentos_v1" };
// Solicitudes desde Mi Portal: vacaciones o permisos. Los permisos con goce
// deben traer una causal legal (mismas claves que permisos-legales.js); las
// marcadas como retroactivas admiten fecha de inicio hasta 30 días atrás
// (fallecimiento, nacimiento, accidente de un hijo: ocurren sin aviso).
const TIPOS_SOLICITUD = ["vacaciones", "permiso_con_goce", "permiso_sin_goce"];
const PERMISOS_CAUSALES = { nacimiento: true, matrimonio: false, muerte_hijo: true, muerte_conyuge: true, muerte_gestacion: true, muerte_familiar: true, hijo_grave: true, examenes: false, vacuna: false };
const mismoId = function (a, b) { return String(a) === String(b); };

// Resuelve qué trabajador se muestra. Un trabajador solo puede verse a sí
// mismo; un administrador o quien tenga RRHH puede ver a cualquiera
// (trabajadorId), en solo lectura desde el portal.
function resolverPortal(token, trabajadorId) {
  const email = leerToken(token);
  if (!email) return { err: motivoRechazo(token) };
  const pm = permisosDe(email);
  const supervisa = pm.isAdmin || pm.modules.indexOf("rrhh") !== -1;
  const trabs = leerRRHH(RRHH.trab);
  const propio = trabajadorDeCorreo(email, trabs);
  let t = null;
  if (trabajadorId && supervisa) t = trabs.find(function (x) { return mismoId(x.id, trabajadorId); }) || null;
  else if (propio && propio.estado !== "Inactivo") t = propio;
  if (!t && supervisa && !trabajadorId) {
    t = propio || trabs.slice().sort(function (a, b) { return nombre(a).localeCompare(nombre(b), "es"); })[0] || null;
  }
  if (!t) {
    if (propio && propio.estado === "Inactivo") return { err: "TRABAJADOR_INACTIVO" };
    return { err: supervisa ? "SIN_TRABAJADORES" : "CORREO_NO_REGISTRADO", email: email };
  }
  return { email: email, supervisa: supervisa, trabs: trabs, t: t, propio: !!(propio && mismoId(propio.id, t.id)) };
}
function nombre(t) { return ((t.nombres || "") + " " + (t.apellidos || "")).trim(); }

function accionPortal(token, trabajadorId) {
  const r = resolverPortal(token, trabajadorId);
  if (r.err) return respuesta({ estado: "error", detalle: r.err, email: r.email || "" });
  const id = r.t.id;
  const mios = function (lista) { return (lista || []).filter(function (x) { return mismoId(x.trabajadorId, id); }); };
  const secciones = {};
  const fallas = [];
  ["liq", "vac", "perm", "asis", "lic"].forEach(function (k) {
    try { secciones[k] = mios(leerRRHH(RRHH[k])); } catch (e) { secciones[k] = []; fallas.push(k); }
  });
  let sol = [];
  try { const s = leerJSON(KEY_SOL_VAC); sol = mios(Array.isArray(s) ? s : []); } catch (e) { fallas.push("sol"); }
  const out = {
    estado: "éxito", trabajador: r.t, propio: r.propio, supervisa: r.supervisa,
    liq: secciones.liq, vac: secciones.vac, perm: secciones.perm, asis: secciones.asis, lic: secciones.lic, sol: sol, fallas: fallas
  };
  if (r.supervisa) {
    out.trabajadores = r.trabs.map(function (t) { return { id: t.id, nombre: nombre(t), estado: t.estado || "", email: t.email || "" }; });
  }
  return respuesta(out);
}

function accionPortalDocs(token, trabajadorId) {
  const r = resolverPortal(token, trabajadorId);
  if (r.err) return error(r.err);
  const docs = leerRRHH(RRHH.doc).filter(function (d) { return mismoId(d.trabajadorId, r.t.id); });
  return respuesta({ estado: "éxito", doc: docs });
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
function hoyChileGS() { return Utilities.formatDate(new Date(), "America/Santiago", "yyyy-MM-dd"); }

function accionSolicitarVac(b) {
  const r = resolverPortal(b.token, null);
  if (r.err) return error(r.err);
  if (!r.propio) return error("SIN_PERMISO");
  const ini = String(b.fechaInicio || ""), fin = String(b.fechaFin || "");
  if (!FECHA_RE.test(ini) || !FECHA_RE.test(fin) || fin < ini) return error("FECHAS_INVALIDAS");
  const tipo = b.tipo || "vacaciones";
  if (TIPOS_SOLICITUD.indexOf(tipo) === -1) return error("TIPO_INVALIDO");
  const causal = tipo === "permiso_con_goce" ? String(b.causal || "") : "";
  if (tipo === "permiso_con_goce" && !PERMISOS_CAUSALES.hasOwnProperty(causal)) return error("CAUSAL_INVALIDA");
  const motivo = String(b.motivo || "").trim().slice(0, 200);
  if (tipo === "permiso_sin_goce" && !motivo) return error("FALTA_MOTIVO");
  const desde = PERMISOS_CAUSALES[causal] === true
    ? Utilities.formatDate(new Date(Date.now() - 30 * 86400000), "America/Santiago", "yyyy-MM-dd")
    : hoyChileGS();
  if (ini < desde) return error("FECHA_PASADA");
  // Medios días permitidos (exámenes, vacunación).
  const dias = Math.max(0, Math.min(366, Math.round((Number(b.dias) || 0) * 2) / 2));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const actual = leerJSON(KEY_SOL_VAC);
    const lista = Array.isArray(actual) ? actual : [];
    const cruza = function (x) { return mismoId(x.trabajadorId, r.t.id) && ini <= x.fechaFin && fin >= x.fechaInicio; };
    const vigente = function (v) { return v.estado === "Aprobada" || v.estado === "Pendiente"; };
    const perm = leerRRHH(RRHH.perm).filter(vigente);
    // Los permisos con goce son adicionales al feriado (Art. 66 y 207 bis):
    // pueden caer sobre vacaciones ya aprobadas, pero no sobre otra solicitud o permiso.
    const vac = tipo === "permiso_con_goce" ? [] : leerRRHH(RRHH.vac).filter(vigente);
    if (lista.some(cruza) || perm.some(cruza) || vac.some(cruza)) return error("CRUCE_FECHAS");
    const nueva = { id: Date.now(), trabajadorId: String(r.t.id), tipo: tipo, fechaInicio: ini, fechaFin: fin, dias: dias, motivo: motivo, fechaSolicitud: hoyChileGS(), email: r.email };
    if (causal) nueva.causal = causal;
    lista.push(nueva);
    escribirValor(KEY_SOL_VAC, JSON.stringify(lista));
    return respuesta({ estado: "éxito", solicitud: nueva });
  } finally {
    lock.releaseLock();
  }
}

function accionCancelarVac(b) {
  const r = resolverPortal(b.token, null);
  if (r.err) return error(r.err);
  if (!r.propio) return error("SIN_PERMISO");
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const actual = leerJSON(KEY_SOL_VAC);
    const lista = Array.isArray(actual) ? actual : [];
    const esta = lista.some(function (x) { return x.id === b.id && mismoId(x.trabajadorId, r.t.id); });
    if (!esta) return error("YA_RESUELTA");
    escribirValor(KEY_SOL_VAC, JSON.stringify(lista.filter(function (x) { return !(x.id === b.id && mismoId(x.trabajadorId, r.t.id)); })));
    return respuesta({ estado: "éxito" });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// Funciones para ejecutar a mano desde el editor de Apps Script
// ------------------------------------------------------------------

// Ejecutar UNA VEZ después de actualizar el código, para dar el permiso de
// conectarse con Google (verificación del inicio de sesión).
function autorizar() {
  UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=prueba", { muteHttpExceptions: true });
  secreto();
  Logger.log("Permisos concedidos. Modo estricto: " + (modoEstricto() ? "activado" : "desactivado (transición)"));
}

function activarModoEstricto() { PropertiesService.getScriptProperties().setProperty("MODO_ESTRICTO", "si"); }
function desactivarModoEstricto() { PropertiesService.getScriptProperties().setProperty("MODO_ESTRICTO", "no"); }

// Cierra TODAS las sesiones abiertas (cambia la llave con que se firman).
function cerrarTodasLasSesiones() { PropertiesService.getScriptProperties().deleteProperty("SESSION_SECRET"); secreto(); }

// Si se modificó la hoja directamente.
function limpiarCache() {
  const sheet = hoja();
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return;
  const llaves = sheet.getRange(1, 1, lastRow, 1).getValues()
    .map(function (r) { return CACHE_PREFIX + r[0]; })
    .filter(function (k) { return k !== CACHE_PREFIX; });
  for (let i = 0; i < llaves.length; i += 1000) {
    CacheService.getScriptCache().removeAll(llaves.slice(i, i + 1000));
  }
}
