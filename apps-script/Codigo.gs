// Backend de Creamos Imagen: guarda cada módulo como un par llave/valor en la
// hoja SHEET_NAME (columna A = llave, columna B = valor JSON).
//
// SEGURIDAD (sesiones y permisos por módulo)
//  - El menú (index.html) envía el "credential" que entrega Google Sign-In a
//    accion=login. Aquí se verifica con Google (tokeninfo) que el token sea
//    válido, de esta aplicación (aud = GOOGLE_CLIENT_ID) y con correo
//    verificado, y se responde una sesión firmada (HMAC) que vence en 24 h.
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
const APP_TOKEN = "b5bd161b4ef581c6114b7bb4"; // El mismo CLOUD_TOKEN que usan las páginas
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

function leerClave(key) {
  const enCache = CacheService.getScriptCache().get(CACHE_PREFIX + key);
  if (enCache !== null) return enCache === CACHE_NULL ? null : enCache;

  const sheet = hoja();
  const fila = buscarFila(sheet, key);
  const value = fila > -1 ? sheet.getRange(fila, 2).getValue() : null;
  const valor = (value === "" || value === undefined) ? null : value;
  guardarEnCache(key, valor);
  return valor;
}

function leerListaCompleta(key) {
  const primero = leerClave(key);
  if (primero === null || primero === undefined) return [];

  let bloque;
  try { bloque = JSON.parse(primero); } catch (error) { return []; }
  if (Array.isArray(bloque)) return bloque;
  if (!bloque || typeof bloque.shardCount !== "number") return [];

  let texto = bloque.parte || "";
  for (let i = 1; i < bloque.shardCount; i++) {
    const parte = leerClave(key + "_sh" + i);
    if (parte === null || parte === undefined) throw new Error("Falta la partición " + i + " de " + key);
    const bloqueParte = JSON.parse(parte);
    if (!bloqueParte || typeof bloqueParte.parte !== "string") throw new Error("Formato inválido en la partición " + i + " de " + key);
    texto += bloqueParte.parte;
  }
  return texto ? JSON.parse(texto) : [];
}

function normalizarCorreo(email) {
  return String(email || "").trim().toLowerCase();
}

function datosTrabajadorPorCorreo(key, email) {
  const correo = normalizarCorreo(email);
  if (!correo) return [];

  const trabajadores = leerListaCompleta("rrhh_trabajadores_v1");
  const trabajador = trabajadores.find(function (t) {
    return normalizarCorreo(t.email) === correo;
  });
  if (!trabajador) return [];
  if (key === "rrhh_trabajadores_v1") return [trabajador];

  const id = String(trabajador.id);
  const lista = leerListaCompleta(key);
  return lista.filter(function (registro) {
    if (!registro) return false;
    const regId = registro.trabajadorId !== undefined ? registro.trabajadorId : registro.idTrabajador;
    return regId !== undefined && regId !== null && String(regId) === id;
  });
}

function validarCredencialGoogle(idToken) {
  if (!idToken || typeof idToken !== "string") throw new Error("Vuelve a iniciar sesión con Google.");
  const respuestaGoogle = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), { muteHttpExceptions:true });
  if (respuestaGoogle.getResponseCode() !== 200) throw new Error("La sesión de Google venció. Vuelve a iniciar sesión.");
  const claims = JSON.parse(respuestaGoogle.getContentText());
  if (claims.aud !== GOOGLE_CLIENT_ID || String(claims.email_verified) !== "true" || !claims.email || Number(claims.exp) * 1000 <= Date.now()) {
    throw new Error("La sesión de Google no es válida. Vuelve a iniciar sesión.");
  }
  return { email:normalizarCorreo(claims.email), nombre:claims.name || "" };
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
  let acl = leerClave("accesos_ci_v1");
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
  if (payload.token !== APP_TOKEN) throw new Error("No autorizado.");
  const identidad = validarCredencialGoogle(payload.googleCredential);
  if (payload.action === "listarMarcaciones" && payload.verTodos === true) {
    if (!usuarioPuedeVerMarcacionesRRHH(identidad.email)) throw new Error("No tienes permiso para ver las marcaciones del equipo.");
    return respuesta({ estado:"éxito", marcaciones:listarFilasMarcaciones(hojaMarcaciones(), null) });
  }
  const trabajadores = leerListaCompleta("rrhh_trabajadores_v1");
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
    if (!e.parameter || e.parameter.token !== APP_TOKEN) {
      return respuesta({ estado: "error", detalle: "No autorizado" });
    }
    const key = e.parameter.key;

    const enCache = CacheService.getScriptCache().get(CACHE_PREFIX + key);
    if (enCache !== null) {
      return respuesta({ estado: "éxito", valor: enCache === CACHE_NULL ? null : enCache });
    }

    const sheet = hoja();
    const fila = buscarFila(sheet, key);
    const value = fila > -1 ? sheet.getRange(fila, 2).getValue() : null;
    const valor = (value === "" || value === undefined) ? null : value;
    guardarEnCache(key, valor);
    return respuesta({ estado: "éxito", valor: valor });
  } catch (error) {
    return respuesta({ estado: "error", detalle: error.toString() });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.token !== APP_TOKEN) {
      return respuesta({ estado: "error", detalle: "No autorizado" });
    }
    const key = payload.key;
    const value = payload.value;

    lock.waitLock(20000);
    const sheet = hoja();
    const fila = buscarFila(sheet, key);
    if (fila > -1) {
      sheet.getRange(fila, 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
    SpreadsheetApp.flush();
    guardarEnCache(key, value);

    return respuesta({ estado: "éxito" });
  } catch (err) {
    return error(err.toString());
  } finally {
    if (lock && lockAdquirido) lock.releaseLock();
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
// Mi Portal
// ------------------------------------------------------------------
const KEY_SOL_VAC = "rrhh_solicitudes_vac_v1";
const RRHH = { trab: "rrhh_trabajadores_v1", liq: "rrhh_liquidaciones_v1", vac: "rrhh_vacaciones_v1", asis: "rrhh_asistencia_v1", lic: "rrhh_licencias_v1", doc: "rrhh_documentos_v1" };
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
  ["liq", "vac", "asis", "lic"].forEach(function (k) {
    try { secciones[k] = mios(leerRRHH(RRHH[k])); } catch (e) { secciones[k] = []; fallas.push(k); }
  });
  let sol = [];
  try { const s = leerJSON(KEY_SOL_VAC); sol = mios(Array.isArray(s) ? s : []); } catch (e) { fallas.push("sol"); }
  const out = {
    estado: "éxito", trabajador: r.t, propio: r.propio, supervisa: r.supervisa,
    liq: secciones.liq, vac: secciones.vac, asis: secciones.asis, lic: secciones.lic, sol: sol, fallas: fallas
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
  if (ini < hoyChileGS()) return error("FECHA_PASADA");
  const dias = Math.max(0, Math.min(366, Math.round(Number(b.dias) || 0)));
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const actual = leerJSON(KEY_SOL_VAC);
    const lista = Array.isArray(actual) ? actual : [];
    const cruza = function (x) { return mismoId(x.trabajadorId, r.t.id) && ini <= x.fechaFin && fin >= x.fechaInicio; };
    const vac = leerRRHH(RRHH.vac).filter(function (v) { return v.estado === "Aprobada" || v.estado === "Pendiente"; });
    if (lista.some(cruza) || vac.some(cruza)) return error("CRUCE_FECHAS");
    const nueva = { id: Date.now(), trabajadorId: String(r.t.id), fechaInicio: ini, fechaFin: fin, dias: dias, motivo: String(b.motivo || "").slice(0, 200), fechaSolicitud: hoyChileGS(), email: r.email };
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
