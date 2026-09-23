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
const CACHE_TTL_S = 21600; // 6 horas (máximo permitido por CacheService)
const CACHE_PREFIX = "v1:";
const CACHE_NULL = "__NULL__"; // marca "la llave no existe", para no buscarla de nuevo
const CACHE_MAX_CHARS = 90000; // CacheService admite hasta 100 KB por valor

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function hoja() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
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
  } catch (error) {
    return respuesta({ estado: "error", detalle: error.toString() });
  } finally {
    lock.releaseLock();
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
