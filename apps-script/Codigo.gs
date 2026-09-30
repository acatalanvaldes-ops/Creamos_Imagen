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
const MODULOS = ["rendicion", "clientes", "costos", "cotizaciones", "dashboard", "calendario", "proveedores", "ventasci", "ventas", "rrhh", "marketing", "inventario", "finanzas"];

const CACHE_TTL_S = 21600; // 6 horas (máximo permitido por CacheService)
const CACHE_PREFIX = "v1:";
const CACHE_NULL = "__NULL__"; // marca "la llave no existe", para no buscarla de nuevo
const CACHE_MAX_CHARS = 90000; // CacheService admite hasta 100 KB por valor

// Dueños de cada llave: "escribe" puede leer y guardar; "lee" solo leer.
// Las llaves en bloques ("<llave>_sh1", "_sh2"...) siguen la regla de su llave.
// Una llave que no calce con ninguna regla es solo para administradores.
const REGLAS = [
  { llave: /^clientes_ci_v1$/,       escribe: ["clientes"],     lee: ["calendario", "cotizaciones"] },
  { llave: /^costos_ci_v1$/,         escribe: ["costos"],       lee: ["cotizaciones", "dashboard", "finanzas"] },
  { llave: /^(cotizaciones|tarifario)_ci_v1$/, escribe: ["cotizaciones"], lee: ["calendario"] },
  { llave: /^(compras|proveedores|ordenes_compra)_ci_v1$/, escribe: ["proveedores"], lee: ["dashboard", "inventario", "finanzas"] },
  { llave: /^creamos_imagen_v1$/,    escribe: ["ventasci"],     lee: ["dashboard", "finanzas"] },
  { llave: /^sublipro_v2$/,          escribe: ["ventas"],       lee: ["dashboard", "finanzas"] },
  { llave: /^rendicion\d{4}_v\d+$/,  escribe: ["rendicion"],    lee: ["dashboard", "finanzas"] },
  { llave: /^cierres_caja_v1$/,      escribe: ["rendicion"],    lee: ["dashboard"] },
  { llave: /^prods\d{4}$/,           escribe: ["calendario"],   lee: ["clientes", "dashboard", "cotizaciones", "finanzas"] },
  { llave: /^rrhh_[a-z_]+_v\d+$/,    escribe: ["rrhh"],         lee: [] },
  { llave: /^marketing_ci_v1$/,      escribe: ["marketing"],    lee: [] },
  { llave: /^inventario_ci_v1$/,     escribe: ["inventario"],   lee: ["ventas", "ventasci", "calendario", "proveedores", "dashboard", "finanzas"] },
  { llave: /^finanzas_ci_v1$/,       escribe: ["finanzas"],     lee: [] }
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

// VALORES GRANDES EN VARIAS CELDAS
// Una celda de Google Sheets admite hasta 50.000 caracteres. Si un valor es
// más largo, se reparte en la misma fila: columna B con el comienzo y C, D…
// con la continuación, cada una marcada con CONTINUA al inicio (así nunca se
// interpreta como fórmula o número, y se sabe dónde termina). Las páginas no
// notan la diferencia: siempre reciben el texto completo.
const CELDA_MAX = 45000;
const CONTINUA = "~";

function leerFila(sheet, fila) {
  const cols = Math.max(1, sheet.getLastColumn() - 1);
  const celdas = sheet.getRange(fila, 2, 1, cols).getValues()[0];
  const primera = celdas[0];
  if (primera === "" || primera === undefined || primera === null) return null;
  let i = 1;
  if (!(typeof celdas[1] === "string" && celdas[1].charAt(0) === CONTINUA)) return primera;
  let texto = String(primera);
  while (i < celdas.length && typeof celdas[i] === "string" && celdas[i].charAt(0) === CONTINUA) texto += celdas[i++].slice(1);
  return texto;
}

function escribirFila(sheet, fila, key, value) {
  const texto = value === null || value === undefined ? "" : String(value);
  const partes = [texto.slice(0, CELDA_MAX)];
  for (let i = CELDA_MAX; i < texto.length; i += CELDA_MAX) partes.push(CONTINUA + texto.slice(i, i + CELDA_MAX));
  if (fila === -1) {
    fila = sheet.getLastRow() + 1;
    sheet.getRange(fila, 1).setValue(key);
  }
  // Se limpian las continuaciones que sobren de un valor anterior más largo.
  const cols = Math.max(1, sheet.getLastColumn() - 1);
  const previas = sheet.getRange(fila, 2, 1, cols).getValues()[0];
  let usadas = 1;
  while (usadas < previas.length && typeof previas[usadas] === "string" && previas[usadas].charAt(0) === CONTINUA) usadas++;
  const ancho = Math.max(partes.length, usadas);
  while (partes.length < ancho) partes.push("");
  if (sheet.getMaxColumns() < ancho + 1) sheet.insertColumnsAfter(sheet.getMaxColumns(), ancho + 1 - sheet.getMaxColumns());
  if (ancho === 1) sheet.getRange(fila, 2).setValue(value);
  else sheet.getRange(fila, 2, 1, ancho).setValues([partes]);
}

// Valor crudo (texto) de una llave, o null.
function leerValor(key) {
  const enCache = CacheService.getScriptCache().get(CACHE_PREFIX + key);
  if (enCache !== null) return enCache === CACHE_NULL ? null : enCache;
  const sheet = hoja();
  const fila = buscarFila(sheet, key);
  const value = fila > -1 ? leerFila(sheet, fila) : null;
  const valor = (value === "" || value === undefined) ? null : value;
  guardarEnCache(key, valor);
  return valor;
}

// VERSIONES (evita que un guardado pise cambios de otra persona)
// Cada llave tiene una versión que cambia en cada guardado. Las páginas la
// reciben al leer y la devuelven al guardar (sesion.js lo hace solo); si no
// coincide, alguien guardó entremedio y el guardado se rechaza (CONFLICTO).
function versionDe(key) {
  return PropertiesService.getScriptProperties().getProperty("ver:" + key) || "0";
}
function nuevaVersion(key) {
  const v = String(Date.now());
  PropertiesService.getScriptProperties().setProperty("ver:" + key, v);
  return v;
}

// Guarda una llave y devuelve su nueva versión. Quien llama debe tener tomado el lock.
function escribirValor(key, value) {
  const sheet = hoja();
  escribirFila(sheet, buscarFila(sheet, key), key, value);
  SpreadsheetApp.flush();
  guardarEnCache(key, value);
  return nuevaVersion(key);
}

// BITÁCORA: quién guardó qué y cuándo (hoja "Bitácora").
// Registra el tamaño y la cantidad de registros antes y después, para
// detectar borrados masivos. Se consulta desde Accesos (accion=bitacora).
const SHEET_BITACORA = "Bitácora";
function hojaBitacora() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(SHEET_BITACORA);
  if (!sh) {
    sh = ss.insertSheet(SHEET_BITACORA);
    sh.appendRow(["Fecha", "Usuario", "Acción", "Llave / detalle", "Caracteres antes", "Caracteres después", "Registros antes", "Registros después"]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function contarRegistros(texto) {
  if (texto === null || texto === undefined || texto === "") return "";
  try {
    const v = JSON.parse(texto);
    if (Array.isArray(v)) return v.length;
    if (v && Array.isArray(v.producciones)) return v.producciones.length;
    if (v && typeof v === "object" && typeof v.shardCount !== "number") return Object.keys(v).length;
  } catch (e) {}
  return "";
}
function registrarBitacora(email, accion, detalle, antes, despues) {
  try {
    hojaBitacora().appendRow([new Date(), email || "", accion, detalle || "",
      antes === undefined ? "" : String(antes || "").length, despues === undefined ? "" : String(despues || "").length,
      antes === undefined ? "" : contarRegistros(antes), despues === undefined ? "" : contarRegistros(despues)]);
  } catch (e) { console.error("No se pudo escribir la bitácora", e); }
}

function accionBitacora(p) {
  const u = usuarioDe(p.token);
  if (!u || !u.isAdmin || u.legado) return error("SIN_PERMISO");
  const sh = hojaBitacora();
  const ultima = sh.getLastRow();
  if (ultima < 2) return respuesta({ estado: "éxito", filas: [] });
  const n = Math.min(400, ultima - 1);
  const filas = sh.getRange(ultima - n + 1, 1, n, 8).getValues().reverse().map(function (r) {
    return { fecha: Utilities.formatDate(new Date(r[0]), "America/Santiago", "yyyy-MM-dd HH:mm:ss"), usuario: r[1], accion: r[2], detalle: r[3], antes: r[4], despues: r[5], regAntes: r[6], regDespues: r[7] };
  });
  return respuesta({ estado: "éxito", filas: filas });
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

// Mismos permisos que el resto del portal: administradores o módulo RRHH.
function usuarioPuedeVerMarcacionesRRHH(email) {
  const pm = permisosDe(email);
  return pm.isAdmin || pm.modules.indexOf("rrhh") !== -1;
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
  try { soltarFilasSalaDeCaja(); } catch (err) { console.error("soltarFilasSalaDeCaja", err); }
  try {
    const p = (e && e.parameter) || {};
    if (p.accion) return accionGet(p);
    const usuario = usuarioDe(p.token);
    if (!usuario) return error(motivoRechazo(p.token));
    if (!puede(usuario, p.key, false)) return error("SIN_PERMISO");
    return respuesta({ estado: "éxito", valor: leerValor(p.key), version: versionDe(p.key) });
  } catch (err) {
    return error(err.toString());
  }
}

function doPost(e) {
  try { soltarFilasSalaDeCaja(); } catch (err) { console.error("soltarFilasSalaDeCaja", err); }
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
    // Si la página manda la versión que leyó y ya no es la actual, otra
    // persona guardó entremedio: se rechaza en vez de pisar sus cambios.
    // Las páginas antiguas (sin versión) se siguen aceptando.
    let valor = payload.value, fusion = false;
    const desactualizada = payload.version !== undefined && payload.version !== null && String(payload.version) !== versionDe(payload.key);
    const combinar = COMBINAR_AUTOMATICOS[payload.key];
    if (combinar) {
      // Caja e Inventario: lo automático (ventas, pagos de producciones,
      // movimientos de stock) siempre se toma de lo guardado, nunca de la
      // página. Si la página quedó atrás solo por cambios automáticos, se
      // mezcla en vez de rechazar.
      if (desactualizada && !soloCambiosAutomaticos(payload.key, payload.version)) return respuesta({ estado: "error", detalle: "CONFLICTO", version: versionDe(payload.key) });
      valor = combinar(payload.value);
      if (valor === null) return error("Datos inválidos para " + payload.key + ".");
      fusion = desactualizada;
    } else if (desactualizada) {
      return respuesta({ estado: "error", detalle: "CONFLICTO", version: versionDe(payload.key) });
    }
    const antes = leerValor(payload.key);
    const version = escribirValor(payload.key, valor);
    if (combinar) PropertiesService.getScriptProperties().setProperty("vermanual:" + payload.key, version);
    registrarBitacora(usuario.email, fusion ? "guardar (mezcla)" : "guardar", payload.key, antes, valor);
    // Ventas → Caja: desactivado (ORIGEN_VENTAS vacío); se conserva por si se reactiva.
    if (ORIGEN_VENTAS[llaveBase(payload.key)]) {
      try { espejarVentas(llaveBase(payload.key), usuario.email); } catch (e) { registrarBitacora(usuario.email, "error espejo ventas", String(e)); }
    }
    // Compras, ventas, producciones y el propio catálogo → movimientos de stock.
    const fuente = fuenteInventario(payload.key);
    if (fuente) {
      try { fuente.forEach(function (f) { sincronizarInventario(f, usuario.email); }); } catch (e) { registrarBitacora(usuario.email, "error inventario", String(e)); }
    }
    return respuesta({ estado: "éxito", version: version, fusion: fusion || undefined });
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
  if (p.accion === "marketingConciertos") return accionMarketingConciertos(p);
  if (p.accion === "tiktokEstado") return accionTiktokEstado(p);
  if (p.accion === "tiktokUrl") return accionTiktokUrl(p);
  if (p.accion === "tiktokDatos") return accionTiktokDatos(p);
  if (p.accion === "bitacora") return accionBitacora(p);
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
  if (b.accion === "tiktokConectar") return accionTiktokConectar(b);
  if (b.accion === "tiktokDesconectar") return accionTiktokDesconectar(b);
  if (b.accion === "pagoProduccion" || b.accion === "anularPagoProduccion") return accionPagoProduccion(b);
  if (b.accion === "cajaGuardar") return accionCajaGuardar(b);
  if (b.action === "listarMarcaciones" || b.action === "registrarMarcacion") return manejarMarcaciones(b);
  if (b.accion === "solicitarVac") return accionSolicitarVac(b);
  if (b.accion === "firmarVac") return accionFirmarVac(b);
  if (b.accion === "anularFirmaVac") return accionAnularFirmaVac(b);
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
  registrarBitacora(g.email, "inicio de sesión", "Google");
  return respuesta({
    estado: "éxito",
      sesion: { token: crearToken(g.email), email: g.email, name: g.name || g.email, picture: g.picture, isAdmin: pf.isAdmin, modules: pf.modules, esTrabajador: pf.esTrabajador, ts: Date.now() }
  });
}

// ------------------------------------------------------------------
// Pagos de producciones → Caja (cuentas por cobrar)
// ------------------------------------------------------------------
// Registrar un pago de un cliente desde Producciones hace dos cosas en un
// solo paso, con el lock tomado: suma el pago a la producción (abono y saldo)
// y agrega la fila correspondiente en la Caja del día. Anularlo revierte
// ambas. Así un pago no se escribe dos veces ni queda en un solo lado.
// Producciones: llave prods<AÑO> ({producciones:[...], shardCount}); aquí se
// reescribe completa en un solo bloque (el servidor ya reparte valores grandes
// en varias celdas). Caja: llave rendicion2026_v2 ({"AAAA-MM-DD": [filas]}).
const KEY_CAJA = "rendicion2026_v2";
const MEDIOS_PAGO = { "Efectivo": "ef", "Transferencia": "tr", "Webpay crédito": "wpCredito", "Webpay débito": "wpDebito" };

// ------------------------------------------------------------------
// Ventas → Caja (espejo automático)
// ------------------------------------------------------------------
// Cada vez que Otros (creamos_imagen_v1) guarda, sus ventas con fecha desde
// ESPEJO_VENTAS_DESDE se reflejan en la
// Caja del día como filas automáticas (ventaRef): se crean, actualizan o
// borran junto con la venta. Las ventas anteriores a esa fecha ya estaban
// anotadas a mano en Caja y no se tocan. En Caja, estas filas (y las de pagos
// de producciones, pagoRef) se muestran bloqueadas: se corrigen en su módulo.
// Ninguna venta pasa sola a Caja (decisión de la empresa): Sala de venta
// registra ventas netas para comisiones y Otros se anota a mano en Caja.
// Solo los pagos de producciones siguen llegando solos (pagoRef).
const ESPEJO_VENTAS_DESDE = "2026-09-27";
const ORIGEN_VENTAS = {};

// Una sola vez por origen: las filas que las ventas alcanzaron a copiar en
// Caja pasan a ser filas manuales (editables en Caja) en vez de borrarse,
// para no perder el registro de esos días.
function soltarFilasSalaDeCaja() {
  soltarFilasVentasDeCaja("sala", "caja_sin_sala_v1", "Sala de venta");
  soltarFilasVentasDeCaja("otros", "caja_sin_otros_v1", "Otros");
  cerrarMezclaCajaAntigua();
}
// Una sola vez: las conversiones anteriores no quedaron marcadas como cambio
// manual, y una pestaña de Caja abierta desde antes podía "mezclarse" y
// descartar las filas convertidas. Se marca la versión actual como manual:
// cualquier pestaña abierta antes de este momento recibe CONFLICTO y recarga.
function cerrarMezclaCajaAntigua() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("caja_mezcla_cerrada_v1")) return;
  props.setProperty("vermanual:" + KEY_CAJA, versionDe(KEY_CAJA));
  props.setProperty("caja_mezcla_cerrada_v1", "1");
}
function soltarFilasVentasDeCaja(origen, marca, nombreOrigen) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(marca)) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (props.getProperty(marca)) return;
    const antes = leerValor(KEY_CAJA);
    let caja;
    try { caja = JSON.parse(antes || "{}") || {}; } catch (e) { return; }
    let n = 0;
    Object.keys(caja).forEach(function (f) {
      if (!Array.isArray(caja[f])) return;
      caja[f] = caja[f].map(function (r) {
        if (!(r && r.ventaRef && r.ventaRef.origen === origen)) return r;
        n++;
        const m = Object.assign({}, r);
        delete m.ventaRef;
        m.obs = "";
        return m;
      });
    });
    if (n) {
      const texto = JSON.stringify(caja);
      // Convertir filas en manuales es un cambio manual: una pestaña abierta
      // antes no debe "mezclarse" (perdería estas filas), sino recargar.
      props.setProperty("vermanual:" + KEY_CAJA, escribirValor(KEY_CAJA, texto));
      registrarBitacora("sistema", "caja sin " + nombreOrigen, n + " fila(s) copiadas desde " + nombreOrigen + " pasan a manuales", antes, texto);
    }
    props.setProperty(marca, "1");
  } finally { lock.releaseLock(); }
}
const COM_WEBPAY_PCT = 2; // recargo Webpay que paga el cliente (igual que en los módulos de ventas)
const TIPO_CAJA = { "Camisetas": "Camiseta", "Camisetas estampadas": "Camiseta", "Polerones": "Impresión Polerones", "Lienzo": "Lienzo", "Mantas": "Mantas",
  "Pañuelos": "Pañuelos", "Banderas": "Banderas", "Banner": "Banner", "Bandanas": "Bandanas", "Conjuntos": "Conjuntos", "Estampados": "Estampados",
  "Impresión": "Impresión", "Sublimación": "Sublimación" };

function esFilaAutomatica(r) { return !!(r && (r.ventaRef || r.pagoRef)); }

// Caja por días: la página manda SOLO los días que cambió, cada uno con la
// foto (base) de sus filas manuales tal como las leyó. Si el día no cambió
// en la nube desde entonces, se reemplazan sus filas manuales; si cambió
// (otro equipo lo editó), no se pisa: se devuelve la versión de la nube para
// que la página junte ambas y vuelva a guardar. Los demás días no se tocan,
// así que dos equipos pueden trabajar en días distintos sin conflicto.
function accionCajaGuardar(b) {
  const u = usuarioDe(b.token);
  if (!u) return error(motivoRechazo(b.token));
  if (!puede(u, KEY_CAJA, true)) return error("SIN_PERMISO");
  const dias = b.dias || {};
  const fechas = Object.keys(dias).filter(function (f) { return /^\d{4}-\d{2}-\d{2}$/.test(f); });
  if (!fechas.length) return respuesta({ estado: "éxito", aplicados: [], conflictos: {} });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const antes = leerValor(KEY_CAJA);
    let caja = {};
    try { caja = JSON.parse(antes || "{}") || {}; } catch (e) { return error("No se pudo leer Caja."); }
    const aplicados = [], conflictos = {}, detalle = [];
    fechas.forEach(function (f) {
      const d = dias[f] || {};
      const actual = Array.isArray(caja[f]) ? caja[f] : [];
      const manualesActuales = actual.filter(function (r) { return !esFilaAutomatica(r); });
      const automaticas = actual.filter(esFilaAutomatica);
      if (d.base !== undefined && d.base !== null && String(d.base) !== JSON.stringify(manualesActuales)) {
        conflictos[f] = actual;
        return;
      }
      const nuevas = (Array.isArray(d.filas) ? d.filas : []).filter(function (r) { return r && typeof r === "object" && !esFilaAutomatica(r); });
      caja[f] = nuevas.concat(automaticas);
      aplicados.push(f);
      if (nuevas.length !== manualesActuales.length) detalle.push(f + ": " + manualesActuales.length + "→" + nuevas.length);
    });
    let version = versionDe(KEY_CAJA);
    if (aplicados.length) {
      const texto = JSON.stringify(caja);
      version = escribirValor(KEY_CAJA, texto);
      PropertiesService.getScriptProperties().setProperty("vermanual:" + KEY_CAJA, version);
      registrarBitacora(u.email, "caja por días", "Días: " + aplicados.join(", ") + (detalle.length ? " · filas " + detalle.join(", ") : ""), antes, texto);
    }
    return respuesta({ estado: "éxito", aplicados: aplicados, conflictos: conflictos, version: version });
  } finally { lock.releaseLock(); }
}

function leerVentas(key) {
  const principal = leerJSON(key);
  if (!principal) return [];
  if (Array.isArray(principal)) return principal;
  let ventas = (principal.ventas || []).slice();
  for (let i = 1; i < (principal.shardCount || 1); i++) {
    const b = leerJSON(key + "_sh" + i);
    if (b && Array.isArray(b.ventas)) ventas = ventas.concat(b.ventas);
  }
  return ventas;
}

function filaDeVenta(v, o) {
  const base = Math.round(Number(v.montoBase) || 0);
  const esWp = v.formaPago === "Webpay";
  const monto = esWp ? base + Math.round(base * COM_WEBPAY_PCT / 100) : base;
  const fila = { cliente: v.cliente || "", tipo: TIPO_CAJA[v.producto] || "Otros", origen: o.origen, pago: v.formaPago || "Efectivo",
    ef: "", tr: "", wpCredito: "", wpDebito: "", obs: "Venta " + o.nombre + (v.producto ? " · " + v.producto : ""), ventaRef: { origen: o.id, id: v.id } };
  if (esWp) fila[v.tipoWebpay === "Débito" ? "wpDebito" : "wpCredito"] = monto;
  else if (v.formaPago === "Transferencia") fila.tr = monto;
  else fila.ef = monto;
  return fila;
}

function espejarVentas(key, email) {
  const o = ORIGEN_VENTAS[key];
  const deseadas = {};
  leerVentas(key).forEach(function (v) {
    if (!v || !v.fecha || v.fecha < ESPEJO_VENTAS_DESDE || !(Number(v.montoBase) > 0)) return;
    (deseadas[v.fecha] = deseadas[v.fecha] || []).push(filaDeVenta(v, o));
  });
  const antes = leerValor(KEY_CAJA);
  let caja = {};
  try { caja = JSON.parse(antes || "{}") || {}; } catch (e) { return; }
  const fechas = {};
  Object.keys(caja).forEach(function (f) { fechas[f] = true; });
  Object.keys(deseadas).forEach(function (f) { fechas[f] = true; });
  let cambios = 0;
  Object.keys(fechas).forEach(function (f) {
    const actuales = caja[f] || [];
    const propias = actuales.filter(function (r) { return r && r.ventaRef && r.ventaRef.origen === o.id; });
    const nuevas = deseadas[f] || [];
    if (JSON.stringify(propias) === JSON.stringify(nuevas)) return;
    caja[f] = actuales.filter(function (r) { return !(r && r.ventaRef && r.ventaRef.origen === o.id); }).concat(nuevas);
    cambios++;
  });
  if (!cambios) return;
  const texto = JSON.stringify(caja);
  escribirValor(KEY_CAJA, texto);
  registrarBitacora(email, "ventas → caja", o.nombre + " (" + cambios + " día(s) actualizados)", antes, texto);
}

// ¿Después de la versión que leyó la página solo hubo escrituras automáticas
// (espejo de ventas o pagos de producciones)? Entonces se puede mezclar.
function soloCambiosAutomaticos(key, versionPagina) {
  const ultimaManual = PropertiesService.getScriptProperties().getProperty("vermanual:" + key);
  return !!ultimaManual && Number(versionPagina) >= Number(ultimaManual);
}

// Caja a guardar: filas manuales de la página + filas automáticas actuales.
function combinarCaja(valorPagina) {
  let pagina, actual;
  try { pagina = JSON.parse(valorPagina) || {}; actual = JSON.parse(leerValor(KEY_CAJA) || "{}") || {}; } catch (e) { return null; }
  if (typeof pagina !== "object" || Array.isArray(pagina)) return null;
  const fechas = {};
  Object.keys(pagina).forEach(function (f) { fechas[f] = true; });
  Object.keys(actual).forEach(function (f) { fechas[f] = true; });
  const out = {};
  Object.keys(fechas).forEach(function (f) {
    // Un día que la página no trae se deja como está en el servidor.
    const fuente = Object.prototype.hasOwnProperty.call(pagina, f) ? pagina[f] : actual[f];
    const manuales = (Array.isArray(fuente) ? fuente : []).filter(function (r) { return !esFilaAutomatica(r); });
    const automaticas = (Array.isArray(actual[f]) ? actual[f] : []).filter(esFilaAutomatica);
    out[f] = manuales.concat(automaticas);
  });
  return JSON.stringify(out);
}

// ------------------------------------------------------------------
// Inventario: catálogo único y movimientos de stock
// ------------------------------------------------------------------
// Llave inventario_ci_v1 = { articulos: [...], movimientos: [...] }.
// Stock de un artículo = suma de las cantidades de sus movimientos.
// Los movimientos automáticos (auto:true, ref.fuente) los arma el servidor
// desde otras llaves y nunca se toman de la página de Inventario:
//   compras        → entrada de cada producto comprado que calce con un
//                    artículo (por nombre o alias), desde INV_DESDE;
//   venta-sala/otros → salida del artículo elegido en la venta, desde INV_DESDE;
//   prod:AAAA      → salida de los insumos usados y entrada del merch obtenido
//                    que se anotan al entregar una producción.
const KEY_INV = "inventario_ci_v1";
const INV_DESDE = "2026-09-27";
const COMBINAR_AUTOMATICOS = {};
COMBINAR_AUTOMATICOS[KEY_CAJA] = combinarCaja;
COMBINAR_AUTOMATICOS[KEY_INV] = combinarInventario;

function normNombre(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }

// Qué fuentes de movimientos hay que recalcular al guardar una llave.
function fuenteInventario(key) {
  const base = llaveBase(key);
  if (base === "compras_ci_v1") return ["compras"];
  if (base === "sublipro_v2") return ["venta-sala"];
  if (base === "creamos_imagen_v1") return ["venta-otros"];
  const m = /^prods(\d{4})$/.exec(base);
  if (m) return ["prod:" + m[1]];
  if (key === KEY_INV) { // un artículo o alias nuevo puede vincular compras, ventas y producciones ya guardadas
    const anio = Number(hoyChileGS().slice(0, 4));
    return ["compras", "venta-sala", "venta-otros", "prod:" + anio, "prod:" + (anio - 1)];
  }
  return null;
}

function leerInventario() {
  const v = leerJSON(KEY_INV);
  return v && typeof v === "object" && !Array.isArray(v) ? v : { articulos: [], movimientos: [] };
}

function movimientosDeseados(fuente, inv) {
  const porNombre = {};
  (inv.articulos || []).forEach(function (a) {
    if (a.activo === false) return;
    [a.nombre].concat(a.alias || []).forEach(function (n) { if (n) porNombre[normNombre(n)] = a; });
  });
  const out = [];
  if (fuente === "compras") {
    const compras = leerJSON("compras_ci_v1");
    (Array.isArray(compras) ? compras : []).forEach(function (c) {
      if (!c || !c.fecha || c.fecha < INV_DESDE) return;
      (c.items || []).forEach(function (it, i) {
        const a = porNombre[normNombre(it.producto)];
        if (!a || !(Number(it.cantidad) > 0)) return;
        out.push({ id: "c" + c.id + "-" + i, fecha: c.fecha, articuloId: a.id, cantidad: Number(it.cantidad), tipo: "compra",
          costoUnit: Number(it.montoNeto) || 0, obs: "Compra" + (c.numeroDoc ? " doc. " + c.numeroDoc : ""), auto: true, ref: { fuente: fuente, compraId: c.id, idx: i } });
      });
    });
  } else if (fuente === "venta-sala" || fuente === "venta-otros") {
    const key = fuente === "venta-sala" ? "sublipro_v2" : "creamos_imagen_v1";
    leerVentas(key).forEach(function (v) {
      const q = Number(v.cantidadArticulo) || 0;
      if (!v || !v.articuloId || q <= 0 || !v.fecha || v.fecha < INV_DESDE) return;
      out.push({ id: "v" + fuente + v.id, fecha: v.fecha, articuloId: v.articuloId, cantidad: -q, tipo: "venta",
        obs: "Venta " + (fuente === "venta-sala" ? "Sala de venta" : "Otros") + (v.cliente ? " · " + v.cliente : ""), auto: true, ref: { fuente: fuente, ventaId: v.id } });
    });
  } else if (fuente.indexOf("prod:") === 0) {
    const anio = fuente.slice(5);
    leerProducciones(anio).forEach(function (p) {
      const fecha = p.fechaEntregaReal || p.fechaEntrega || p.date || "";
      (p.consumos || []).forEach(function (x, i) {
        if (!x.articuloId || !(Number(x.cantidad) > 0)) return;
        out.push({ id: "p" + anio + "-" + p.id + "-c" + i, fecha: fecha, articuloId: x.articuloId, cantidad: -Number(x.cantidad), tipo: "produccion",
          costoUnit: Number(x.costoUnit) || 0, obs: "Insumo OP " + (p.orden || "") + " " + (p.name || ""), auto: true, ref: { fuente: fuente, prodId: p.id } });
      });
      // El merch obtenido toma como costo los insumos de la producción repartidos por unidad.
      const unidadesObtenidas = (p.obtenidos || []).reduce(function (s, x) { return s + (Number(x.cantidad) || 0); }, 0);
      const costoObtenido = unidadesObtenidas > 0 ? Math.round((Number(p.costoInsumos) || 0) / unidadesObtenidas) : 0;
      (p.obtenidos || []).forEach(function (x, i) {
        if (!x.articuloId || !(Number(x.cantidad) > 0)) return;
        out.push({ id: "p" + anio + "-" + p.id + "-o" + i, fecha: fecha, articuloId: x.articuloId, cantidad: Number(x.cantidad), tipo: "produccion", costoUnit: costoObtenido,
          obs: "Producido en OP " + (p.orden || "") + " " + (p.name || ""), auto: true, ref: { fuente: fuente, prodId: p.id } });
      });
    });
  }
  return out;
}

function sincronizarInventario(fuente, email) {
  const antes = leerValor(KEY_INV);
  const inv = leerInventario();
  if (!(inv.articulos || []).length) return; // sin catálogo no hay nada que mover
  const deseados = movimientosDeseados(fuente, inv);
  const actuales = (inv.movimientos || []).filter(function (m) { return m.auto && m.ref && m.ref.fuente === fuente; });
  if (JSON.stringify(actuales) === JSON.stringify(deseados)) return;
  inv.movimientos = (inv.movimientos || []).filter(function (m) { return !(m.auto && m.ref && m.ref.fuente === fuente); }).concat(deseados);
  const texto = JSON.stringify(inv);
  escribirValor(KEY_INV, texto);
  registrarBitacora(email, "inventario automático", fuente + " (" + deseados.length + " movimientos)", antes, texto);
}

// Inventario a guardar: catálogo y movimientos manuales de la página +
// movimientos automáticos actuales del servidor.
function combinarInventario(valorPagina) {
  let pagina;
  try { pagina = JSON.parse(valorPagina); } catch (e) { return null; }
  if (!pagina || typeof pagina !== "object" || Array.isArray(pagina)) return null;
  const actual = leerInventario();
  const out = Object.assign({}, pagina);
  out.articulos = Array.isArray(pagina.articulos) ? pagina.articulos : [];
  out.movimientos = (Array.isArray(pagina.movimientos) ? pagina.movimientos : []).filter(function (m) { return !m.auto; })
    .concat((actual.movimientos || []).filter(function (m) { return m.auto; }));
  return JSON.stringify(out);
}

function leerProducciones(anio) {
  const key = "prods" + anio;
  const principal = leerJSON(key);
  if (!principal) return [];
  if (Array.isArray(principal)) return principal;
  let lista = (principal.producciones || []).slice();
  for (let i = 1; i < (principal.shardCount || 1); i++) {
    const b = leerJSON(key + "_sh" + i);
    if (!b || !Array.isArray(b.producciones)) throw new Error("Falta el bloque " + i + " de " + key);
    lista = lista.concat(b.producciones);
  }
  return lista;
}

function accionPagoProduccion(b) {
  const u = usuarioDe(b.token);
  if (!u || u.legado) return error(u ? "SIN_PERMISO" : motivoRechazo(b.token));
  const anular = b.accion === "anularPagoProduccion";
  // Registrar pagos: Producciones. Anular: también Caja (borra la fila importada).
  const puede = u.isAdmin || u.modules.indexOf("calendario") !== -1 || (anular && u.modules.indexOf("rendicion") !== -1);
  if (!puede) return error("SIN_PERMISO");
  const anio = String(b.anio || "");
  if (!/^\d{4}$/.test(anio)) return error("Año inválido.");
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const keyProd = "prods" + anio;
    const prods = leerProducciones(anio);
    const p = prods.find(function (x) { return String(x.id) === String(b.prodId); });
    let caja = leerJSON(KEY_CAJA);
    if (!caja || typeof caja !== "object" || Array.isArray(caja)) caja = {};
    // Fila de Caja cuyo pago ya no está en la producción (producción o pago
    // borrados): solo se quita la fila de Caja.
    if (anular && (!p || !(p.pagos || []).some(function (x) { return x.id === b.pagoId; }))) {
      const antes = leerValor(KEY_CAJA);
      let quitadas = 0;
      Object.keys(caja).forEach(function (f) {
        if (!Array.isArray(caja[f])) return;
        const n = caja[f].length;
        caja[f] = caja[f].filter(function (r) { return !(r.pagoRef && r.pagoRef.pagoId === b.pagoId); });
        quitadas += n - caja[f].length;
      });
      if (!quitadas) return error("Ese pago ya no existe. Recarga la página.");
      const texto = JSON.stringify(caja);
      const vCaja = escribirValor(KEY_CAJA, texto);
      registrarBitacora(u.email, "anular pago", "Fila de Caja de un pago de producción que ya no existe (" + b.pagoId + ")", antes, texto);
      return respuesta({ estado: "éxito", produccion: p || null, versiones: { caja: vCaja } });
    }
    if (!p) return error("La producción ya no existe. Recarga la página.");
    p.pagos = Array.isArray(p.pagos) ? p.pagos : [];
    let pago;

    if (anular) {
      pago = p.pagos.find(function (x) { return x.id === b.pagoId; });
      if (!pago) return error("Ese pago ya no existe. Recarga la página.");
      p.pagos = p.pagos.filter(function (x) { return x.id !== b.pagoId; });
      p.abono = Math.max(0, (Number(p.abono) || 0) - pago.monto);
      if (caja[pago.fecha]) caja[pago.fecha] = caja[pago.fecha].filter(function (r) { return !(r.pagoRef && r.pagoRef.pagoId === pago.id); });
    } else {
      const monto = Math.round(Number(b.monto) || 0);
      const fecha = String(b.fecha || "");
      if (monto <= 0) return error("El monto debe ser mayor a cero.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return error("Fecha inválida.");
      if (!MEDIOS_PAGO[b.medio]) return error("Medio de pago inválido.");
      pago = { id: Utilities.getUuid(), fecha: fecha, monto: monto, medio: b.medio, obs: String(b.obs || "").slice(0, 150), registradoPor: u.email, registrado: hoyChileGS() };
      p.pagos.push(pago);
      p.abono = (Number(p.abono) || 0) + monto;
      const fila = { cliente: p.name || "", tipo: p.tipo === "Sublimación" ? "Sublimación" : "Otros", origen: "Empresa",
        pago: b.medio.indexOf("Webpay") === 0 ? "Webpay" : b.medio, ef: "", tr: "", wpCredito: "", wpDebito: "",
        obs: ("Pago OP " + (p.orden || "") + (pago.obs ? " · " + pago.obs : "")).trim(),
        pagoRef: { anio: anio, prodId: p.id, pagoId: pago.id } };
      fila[MEDIOS_PAGO[b.medio]] = monto;
      (caja[fecha] = caja[fecha] || []).push(fila);
    }
    p.saldo = Math.max(0, (Number(p.monto) || 0) - (Number(p.abono) || 0));

    const antesCaja = leerValor(KEY_CAJA);
    const textoCaja = JSON.stringify(caja);
    const vProd = escribirValor(keyProd, JSON.stringify({ producciones: prods, shardCount: 1 }));
    const vCaja = escribirValor(KEY_CAJA, textoCaja);
    registrarBitacora(u.email, anular ? "anular pago" : "pago producción",
      "OP " + (p.orden || "") + " " + (p.name || "") + " · $" + pago.monto + " " + pago.medio + " (" + pago.fecha + ")", antesCaja, textoCaja);
    return respuesta({ estado: "éxito", produccion: p, versiones: { prods: vProd, caja: vCaja } });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------
// Marketing: conciertos en Chile desde Ticketmaster (Discovery API)
// ------------------------------------------------------------------
// Busca eventos en Chile de cada grupo que sigue el módulo Marketing
// (llave marketing_ci_v1) y, además, eventos "k-pop" en general para
// descubrir grupos que aún no se siguen. La clave va en la propiedad del
// script TM_API_KEY (nunca en las páginas). El resultado se guarda 12 horas
// en caché para no gastar el límite de la API (5.000 consultas al día).
const TM_CACHE = "tm:conciertos:v1";

function tmEventos(key, keyword) {
  const url = "https://app.ticketmaster.com/discovery/v2/events.json?countryCode=CL&size=50&sort=date,asc&apikey=" +
    encodeURIComponent(key) + "&keyword=" + encodeURIComponent(keyword);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const codigo = res.getResponseCode();
  if (codigo === 401) throw new Error("Ticketmaster rechazó la clave TM_API_KEY.");
  if (codigo !== 200) throw new Error("Ticketmaster respondió " + codigo + " al buscar " + keyword);
  const datos = JSON.parse(res.getContentText());
  return ((datos._embedded && datos._embedded.events) || []).map(function (e) {
    const lugar = (e._embedded && e._embedded.venues && e._embedded.venues[0]) || {};
    const inicio = (e.dates && e.dates.start) || {};
    return {
      id: e.id, nombre: e.name, url: e.url || "",
      fecha: inicio.localDate || "", hora: (inicio.localTime || "").slice(0, 5),
      recinto: lugar.name || "", ciudad: (lugar.city && lugar.city.name) || "",
      estado: (e.dates && e.dates.status && e.dates.status.code) || "",
      artistas: ((e._embedded && e._embedded.attractions) || []).map(function (a) { return a.name; })
    };
  });
}

// ------------------------------------------------------------------
// TikTok: estadísticas de la cuenta (Login Kit + Display API v2)
// ------------------------------------------------------------------
// Claves en propiedades del script (nunca en las páginas):
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET  → app de developers.tiktok.com
//   TIKTOK_TOKEN  → { access, refresh, expira, refreshExpira, openId, por, en }
// La cuenta de la empresa autoriza una vez (permisos user.info.basic,
// user.info.stats y video.list); el acceso se renueva solo con el refresh.
// Cada consulta guarda en marketing_tiktok_v1 la foto del día (seguidores,
// likes, videos) para ver el crecimiento, y la lista de videos con sus cifras.
const TT_REDIRECT = "https://creamosimagen.vercel.app/marketing.html";
const TT_SCOPES = "user.info.basic,user.info.stats,video.list";
const TT_KEY_DATOS = "marketing_tiktok_v1";
const TT_CACHE = "tiktok_datos_v1";

function usuarioMarketing(token) {
  const u = usuarioDe(token);
  if (!u || u.legado) return { err: u ? "SIN_PERMISO" : motivoRechazo(token) };
  if (!u.isAdmin && (u.modules || []).indexOf("marketing") === -1) return { err: "SIN_PERMISO" };
  return { u: u };
}
function ttClaves() {
  const pr = PropertiesService.getScriptProperties();
  return { key: String(pr.getProperty("TIKTOK_CLIENT_KEY") || "").trim(), secret: String(pr.getProperty("TIKTOK_CLIENT_SECRET") || "").trim() };
}
function ttToken() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("TIKTOK_TOKEN") || "null"); } catch (e) { return null; } }
function ttGuardarToken(j, previo, email) {
  const ahora = Date.now();
  const tk = {
    access: j.access_token, refresh: j.refresh_token || (previo && previo.refresh),
    expira: ahora + (Number(j.expires_in) || 86400) * 1000 - 60000,
    refreshExpira: j.refresh_expires_in ? ahora + Number(j.refresh_expires_in) * 1000 : (previo && previo.refreshExpira) || null,
    openId: j.open_id || (previo && previo.openId) || "", por: (previo && previo.por) || email || "", en: (previo && previo.en) || hoyChileGS()
  };
  PropertiesService.getScriptProperties().setProperty("TIKTOK_TOKEN", JSON.stringify(tk));
  return tk;
}
function ttPedirToken(params) {
  const c = ttClaves();
  const cuerpo = Object.keys(params).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); }).join("&");
  const r = UrlFetchApp.fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "post", contentType: "application/x-www-form-urlencoded", muteHttpExceptions: true,
    payload: "client_key=" + encodeURIComponent(c.key) + "&client_secret=" + encodeURIComponent(c.secret) + "&" + cuerpo
  });
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (!j.access_token) throw new Error("TikTok rechazó la autorización: " + (j.error_description || j.error || ("HTTP " + r.getResponseCode())));
  return j;
}
// Token vigente (lo renueva si venció).
function ttAcceso() {
  let tk = ttToken();
  if (!tk || !tk.access) throw new Error("NO_CONECTADO");
  if (Date.now() < tk.expira) return tk.access;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    tk = ttToken();
    if (Date.now() < tk.expira) return tk.access;
    return ttGuardarToken(ttPedirToken({ grant_type: "refresh_token", refresh_token: tk.refresh }), tk).access;
  } finally { lock.releaseLock(); }
}
function ttApi(url, metodo, cuerpo) {
  const opts = { method: metodo || "get", muteHttpExceptions: true, headers: { Authorization: "Bearer " + ttAcceso() } };
  if (cuerpo) { opts.contentType = "application/json"; opts.payload = JSON.stringify(cuerpo); }
  const r = UrlFetchApp.fetch(url, opts);
  let j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  const err = j.error || {};
  if (r.getResponseCode() >= 400 || (err.code && err.code !== "ok")) throw new Error("TikTok: " + (err.message || err.code || ("HTTP " + r.getResponseCode())));
  return j.data || {};
}

function accionTiktokEstado(p) {
  const a = usuarioMarketing(p.token); if (a.err) return error(a.err);
  const c = ttClaves(), tk = ttToken();
  let cuenta = null;
  try { const d = leerJSON(TT_KEY_DATOS); cuenta = d && d.cuenta ? { nombre: d.cuenta.display_name, avatar: d.cuenta.avatar_url } : null; } catch (e) {}
  return respuesta({ estado: "éxito", configurado: !!(c.key && c.secret), conectado: !!(tk && tk.access), por: tk ? tk.por : "", desde: tk ? tk.en : "", cuenta: cuenta, redirect: TT_REDIRECT });
}
function accionTiktokUrl(p) {
  const a = usuarioMarketing(p.token); if (a.err) return error(a.err);
  const c = ttClaves();
  if (!c.key) return error("Falta configurar TIKTOK_CLIENT_KEY en las propiedades del script.");
  const state = Utilities.getUuid().replace(/-/g, "");
  CacheService.getScriptCache().put("tt_state:" + state, a.u.email, 600);
  const url = "https://www.tiktok.com/v2/auth/authorize/?client_key=" + encodeURIComponent(c.key) + "&scope=" + encodeURIComponent(TT_SCOPES) +
    "&response_type=code&redirect_uri=" + encodeURIComponent(TT_REDIRECT) + "&state=" + state;
  return respuesta({ estado: "éxito", url: url });
}
function accionTiktokConectar(b) {
  const a = usuarioMarketing(b.token); if (a.err) return error(a.err);
  const cache = CacheService.getScriptCache();
  const dueño = cache.get("tt_state:" + String(b.state || ""));
  if (!dueño || dueño !== a.u.email) return error("La autorización de TikTok venció o no corresponde a tu sesión. Vuelve a presionar Conectar.");
  cache.remove("tt_state:" + b.state);
  try {
    const j = ttPedirToken({ code: String(b.code || ""), grant_type: "authorization_code", redirect_uri: TT_REDIRECT });
    ttGuardarToken(j, null, a.u.email);
  } catch (e) { return error(e.message); }
  cache.remove(TT_CACHE);
  registrarBitacora(a.u.email, "tiktok conectado", "Cuenta de TikTok autorizada para estadísticas");
  return respuesta({ estado: "éxito" });
}
function accionTiktokDesconectar(b) {
  const a = usuarioMarketing(b.token); if (a.err) return error(a.err);
  PropertiesService.getScriptProperties().deleteProperty("TIKTOK_TOKEN");
  CacheService.getScriptCache().remove(TT_CACHE);
  registrarBitacora(a.u.email, "tiktok desconectado", "");
  return respuesta({ estado: "éxito" });
}
// Cuenta + todos los videos (hasta 500) con sus cifras; guarda la foto del día.
function accionTiktokDatos(p) {
  const a = usuarioMarketing(p.token); if (a.err) return error(a.err);
  const cache = CacheService.getScriptCache();
  if (p.forzar !== "1") { const c = cache.get(TT_CACHE); if (c) return respuesta(JSON.parse(c)); }
  let cuenta, videos = [];
  try {
    cuenta = (ttApi("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count").user) || {};
    const campos = "id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count";
    let cursor = null;
    for (let i = 0; i < 25; i++) {
      const d = ttApi("https://open.tiktokapis.com/v2/video/list/?fields=" + campos, "post", cursor ? { max_count: 20, cursor: cursor } : { max_count: 20 });
      videos = videos.concat(d.videos || []);
      if (!d.has_more || !d.cursor) break;
      cursor = d.cursor;
    }
  } catch (e) {
    if (e.message === "NO_CONECTADO") return error("NO_CONECTADO");
    return error(e.message);
  }
  const hoy = hoyChileGS();
  let guardado = {};
  try { guardado = leerJSON(TT_KEY_DATOS) || {}; } catch (e) {}
  const historial = guardado.historial || {};
  historial[hoy] = {
    seguidores: Number(cuenta.follower_count) || 0, likes: Number(cuenta.likes_count) || 0, videos: Number(cuenta.video_count) || videos.length,
    vistas: videos.reduce(function (s, v) { return s + (Number(v.view_count) || 0); }, 0)
  };
  const lista = videos.map(function (v) {
    return { id: String(v.id), fecha: Number(v.create_time) || 0, texto: String(v.video_description || v.title || "").slice(0, 400), portada: v.cover_image_url || "", url: v.share_url || "",
      duracion: Number(v.duration) || 0, vistas: Number(v.view_count) || 0, likes: Number(v.like_count) || 0, comentarios: Number(v.comment_count) || 0, compartidos: Number(v.share_count) || 0 };
  });
  const datos = { cuenta: { display_name: cuenta.display_name || "", avatar_url: cuenta.avatar_url || "", follower_count: Number(cuenta.follower_count) || 0,
      following_count: Number(cuenta.following_count) || 0, likes_count: Number(cuenta.likes_count) || 0, video_count: Number(cuenta.video_count) || 0 },
    historial: historial, videos: lista, actualizado: new Date().toISOString() };
  escribirValor(TT_KEY_DATOS, JSON.stringify(datos));
  const salida = Object.assign({ estado: "éxito" }, datos);
  try { cache.put(TT_CACHE, JSON.stringify(salida), 3600); } catch (e) {}
  return respuesta(salida);
}

function accionMarketingConciertos(p) {
  const u = usuarioDe(p.token);
  if (!u) return error(motivoRechazo(p.token));
  if (!u.isAdmin && (u.modules || []).indexOf("marketing") === -1) return error("SIN_PERMISO");
  const key = String(PropertiesService.getScriptProperties().getProperty("TM_API_KEY") || "").trim();
  if (!key) return error("Falta configurar TM_API_KEY en las propiedades del script.");
  const cache = CacheService.getScriptCache();
  if (p.forzar !== "1") { const c = cache.get(TM_CACHE); if (c) return respuesta(JSON.parse(c)); }

  let grupos = [];
  try { const mk = leerRRHH("marketing_ci_v1"); grupos = ((mk && mk.grupos) || []).filter(function (g) { return g.activo !== false; }).map(function (g) { return g.nombre; }); } catch (e) {}
  const busquedas = grupos.map(function (n) { return { grupo: n, kw: n }; }).concat([{ grupo: "", kw: "k-pop" }, { grupo: "", kw: "kpop" }]);
  const porId = {}, errores = [];
  busquedas.forEach(function (b, i) {
    if (i) Utilities.sleep(250); // la API admite ~5 consultas por segundo
    let lista;
    try { lista = tmEventos(key, b.kw); } catch (e) { errores.push(e.message); return; }
    const g = b.grupo.toLowerCase();
    lista.forEach(function (ev) {
      // Coincidencia fuerte: el grupo figura como artista del evento.
      // Débil: solo aparece en el nombre (puede ser un tributo o una fiesta temática).
      const porArtista = g && ev.artistas.some(function (a) { return a.toLowerCase() === g; });
      const porNombre = g && ev.nombre.toLowerCase().indexOf(g) !== -1;
      const previo = porId[ev.id];
      if (previo && previo.grupo && previo.coincidencia === "artista") return;
      if (porArtista || porNombre) { ev.grupo = b.grupo; ev.coincidencia = porArtista ? "artista" : "nombre"; }
      else if (previo) return;
      else { ev.grupo = ""; ev.coincidencia = ""; }
      porId[ev.id] = ev;
    });
  });
  if (errores.length === busquedas.length) return error(errores[0]);
  const eventos = Object.keys(porId).map(function (k) { return porId[k]; })
    .sort(function (a, b) { return (a.fecha + a.hora).localeCompare(b.fecha + b.hora); });
  const out = { estado: "éxito", eventos: eventos, grupos: grupos.length, consultado: new Date().toISOString(), errores: errores };
  const texto = JSON.stringify(out);
  if (texto.length < CACHE_MAX_CHARS) cache.put(TM_CACHE, texto, 43200);
  return respuesta(out);
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
  registrarBitacora(m.email, "inicio de sesión", "Microsoft");
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
  try {
    const todas = leerJSON(KEY_FIRMAS_VAC) || {};
    out.firmasVac = {};
    (secciones.vac || []).forEach(function (v) { if (todas[String(v.id)]) out.firmasVac[String(v.id)] = todas[String(v.id)]; });
  } catch (e) { out.firmasVac = {}; }
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

// ------------------------------------------------------------------
// Certificado (comprobante) de feriado: firmas electrónicas simples
// ------------------------------------------------------------------
// Llave rrhh_firmas_vac_v1 = { "<id vacación>": { datos, empleador, trabajador, codigo } }
//   datos:      foto de lo aprobado (trabajador, fechas, días) al firmar el empleador;
//   empleador:  { nombre, email, en } quien aprobó en RRHH (admin o módulo RRHH);
//   trabajador: { nombre, email, en } el propio trabajador desde Mi Portal;
//   codigo:     verificación (SHA-256) cuando están las dos firmas.
// Se guarda aparte de rrhh_vacaciones_v1 para que un guardado de RRHH no borre firmas.
const KEY_FIRMAS_VAC = "rrhh_firmas_vac_v1";
function ahoraChileISO() { return Utilities.formatDate(new Date(), "America/Santiago", "yyyy-MM-dd'T'HH:mm:ss"); }
function codigoFirmaVac(id, reg) {
  const base = [id, reg.datos.trabajadorId, reg.datos.fechaInicio, reg.datos.fechaFin, reg.datos.dias, reg.empleador.email, reg.empleador.en, reg.trabajador.email, reg.trabajador.en].join("|");
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, base, Utilities.Charset.UTF_8)
    .map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("").slice(0, 16).toUpperCase();
}
function accionFirmarVac(b) {
  const id = String(b.vacId || "");
  if (!id) return error("Falta la vacación a firmar.");
  const rol = b.rol === "empleador" ? "empleador" : "trabajador";
  let firmante, trabajadorId;
  if (rol === "empleador") {
    const u = usuarioDe(b.token);
    if (!u || u.legado) return error(u ? "SIN_PERMISO" : motivoRechazo(b.token));
    if (!u.isAdmin && (u.modules || []).indexOf("rrhh") === -1) return error("SIN_PERMISO");
    const d = b.datos || {};
    if (!FECHA_RE.test(String(d.fechaInicio || "")) || !FECHA_RE.test(String(d.fechaFin || "")) || !d.trabajadorId) return error("Datos de la vacación inválidos.");
    firmante = { nombre: String(b.nombre || "").trim().slice(0, 80) || u.email, email: u.email, en: ahoraChileISO() };
    trabajadorId = String(d.trabajadorId);
  } else {
    const r = resolverPortal(b.token, null);
    if (r.err) return error(r.err);
    if (!r.propio) return error("SIN_PERMISO");
    const vac = leerRRHH(RRHH.vac).find(function (v) { return String(v.id) === id; });
    if (!vac || !mismoId(vac.trabajadorId, r.t.id)) return error("Esa vacación no es tuya o ya no existe.");
    if (vac.estado !== "Aprobada") return error("Solo se firman vacaciones aprobadas.");
    firmante = { nombre: nombre(r.t), email: r.email, en: ahoraChileISO() };
    trabajadorId = String(r.t.id);
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const antes = leerValor(KEY_FIRMAS_VAC);
    let todas = {};
    try { todas = JSON.parse(antes || "{}") || {}; } catch (e) {}
    const reg = todas[id] || {};
    if (rol === "empleador") {
      if (reg.empleador) return respuesta({ estado: "éxito", firma: reg });
      const d = b.datos;
      reg.datos = { trabajadorId: trabajadorId, fechaInicio: d.fechaInicio, fechaFin: d.fechaFin, dias: Number(d.dias) || 0 };
      reg.empleador = firmante;
    } else {
      if (!reg.empleador) return error("El certificado aún no está firmado por el empleador. Avisa a Recursos Humanos.");
      if (reg.trabajador) return respuesta({ estado: "éxito", firma: reg });
      const vac = leerRRHH(RRHH.vac).find(function (v) { return String(v.id) === id; });
      if (vac.fechaInicio !== reg.datos.fechaInicio || vac.fechaFin !== reg.datos.fechaFin || String(reg.datos.trabajadorId) !== trabajadorId)
        return error("Las fechas de estas vacaciones cambiaron después de aprobarse. Pide a Recursos Humanos que vuelva a firmar el certificado.");
      reg.trabajador = firmante;
      reg.codigo = codigoFirmaVac(id, reg);
    }
    todas[id] = reg;
    const texto = JSON.stringify(todas);
    escribirValor(KEY_FIRMAS_VAC, texto);
    registrarBitacora(firmante.email, "firma certificado vacaciones", rol + " · vacación " + id + " (" + reg.datos.fechaInicio + " al " + reg.datos.fechaFin + ")", antes, texto);
    return respuesta({ estado: "éxito", firma: reg });
  } finally { lock.releaseLock(); }
}

// Anular firmas de un certificado (RRHH o administradores), por ejemplo si se
// firmó por error: "trabajador" quita solo la del trabajador (vuelve a quedar
// pendiente de su firma); "todas" quita ambas (vuelve a quedar sin firmar).
function accionAnularFirmaVac(b) {
  const u = usuarioDe(b.token);
  if (!u || u.legado) return error(u ? "SIN_PERMISO" : motivoRechazo(b.token));
  if (!u.isAdmin && (u.modules || []).indexOf("rrhh") === -1) return error("SIN_PERMISO");
  const id = String(b.vacId || ""), que = b.que === "todas" ? "todas" : "trabajador";
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const antes = leerValor(KEY_FIRMAS_VAC);
    let todas = {};
    try { todas = JSON.parse(antes || "{}") || {}; } catch (e) {}
    const reg = todas[id];
    if (!reg) return error("Ese certificado no tiene firmas.");
    if (que === "todas") delete todas[id];
    else { delete reg.trabajador; delete reg.codigo; todas[id] = reg; }
    const texto = JSON.stringify(todas);
    escribirValor(KEY_FIRMAS_VAC, texto);
    registrarBitacora(u.email, "anular firma certificado vacaciones", (que === "todas" ? "ambas firmas" : "firma del trabajador") + " · vacación " + id + (b.motivo ? " · " + String(b.motivo).slice(0, 150) : ""), antes, texto);
    return respuesta({ estado: "éxito", firma: todas[id] || null });
  } finally { lock.releaseLock(); }
}

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
