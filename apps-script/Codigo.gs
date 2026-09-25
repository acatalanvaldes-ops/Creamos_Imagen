// Backend de Creamos Imagen: guarda cada módulo como un par llave/valor en la
// hoja SHEET_NAME (columna A = llave, columna B = valor JSON).
//
// Por qué esta versión es más rápida que la anterior:
//  - Antes, cada lectura hacía getDataRange().getValues(), o sea traía la hoja
//    COMPLETA (todas las llaves con todos sus valores de hasta 40.000
//    caracteres) solo para devolver una celda. Ahora se lee solo la columna A
//    para ubicar la fila, y después se lee una sola celda.
//  - Las lecturas se sirven desde CacheService cuando se puede, sin abrir la
//    hoja. Cada guardado actualiza el caché con el valor nuevo, así que nunca
//    se devuelve un dato viejo después de guardar desde la app.
//  - Los guardados usan LockService: dos guardados simultáneos de una llave
//    nueva ya no pueden crear filas duplicadas.
//
// Si se edita la hoja A MANO, el caché puede mostrar el valor anterior hasta
// por CACHE_TTL_S segundos: en ese caso, ejecutar limpiarCache() desde el
// editor de Apps Script.

const SHEET_ID = "1H1I_00xY-HdqVCrDNei35FIl2EOx7tAWA3iOP3hJ8IE";
const SHEET_NAME = "Hoja 1"; // Debe ser el nombre de la pestaña donde están los datos
const APP_TOKEN = "b5bd161b4ef581c6114b7bb4"; // El mismo CLOUD_TOKEN que usan las páginas
const GOOGLE_CLIENT_ID = "207433225749-76s4184pif80ge7gfr0nt39qa80b82ij.apps.googleusercontent.com";
const SHEET_MARCACIONES = "Marcaciones Portal";
const CACHE_TTL_S = 21600; // 6 horas (máximo permitido por CacheService)
const CACHE_PREFIX = "v1:";
const CACHE_NULL = "__NULL__"; // marca "la llave no existe", para no buscarla de nuevo
const CACHE_MAX_CHARS = 90000; // CacheService admite hasta 100 KB por valor

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function hoja() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

// Devuelve el número de fila (1-based) de la llave, o -1 si no existe.
// Lee solo la columna A, no los valores.
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
    if (e.parameter.scope === "trabajador") {
      const email = e.parameter.email;
      if (!email) {
        return respuesta({ estado: "error", detalle: "Correo de trabajador requerido" });
      }
      return respuesta({ estado: "éxito", valor: JSON.stringify(datosTrabajadorPorCorreo(key, email)) });
    }

    return respuesta({ estado: "éxito", valor: leerClave(key) });
  } catch (error) {
    return respuesta({ estado: "error", detalle: error.toString() });
  }
}

function doPost(e) {
  let payload;
  let lock = null;
  let lockAdquirido = false;
  try {
    payload = JSON.parse(e.postData.contents);
    if (payload.action === "listarMarcaciones" || payload.action === "registrarMarcacion") return manejarMarcaciones(payload);
    if (payload.token !== APP_TOKEN) {
      return respuesta({ estado: "error", detalle: "No autorizado" });
    }
    lock = LockService.getScriptLock();
    const key = payload.key;
    const value = payload.value;

    lock.waitLock(20000);
    lockAdquirido = true;
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
  } catch (error) {
    return respuesta({ estado: "error", detalle: error.toString() });
  } finally {
    if (lock && lockAdquirido) lock.releaseLock();
  }
}

function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.JSON);
}

// Ejecutar a mano desde el editor si se modificó la hoja directamente.
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
