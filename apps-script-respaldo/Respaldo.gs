// Respaldo diario de la planilla de datos de Creamos Imagen.
//
// Está en un proyecto de Apps Script aparte (no en el backend del portal)
// porque necesita permisos de Drive y de activadores: si se agregaran al
// backend, la web dejaría de funcionar hasta volver a autorizarla.
//
// PRIMERA VEZ: abrir este proyecto en script.google.com, elegir la función
// "instalar" y presionar Ejecutar; aceptar los permisos. Eso crea el
// activador diario (3:00 a 4:00 AM) y hace el primer respaldo.
//
// Cada respaldo es una copia completa de la planilla en la carpeta
// "Respaldos Creamos Imagen" de tu Drive. Se guardan los últimos 30 días.
// Para recuperar datos: abrir la copia del día necesario y copiar la celda
// de la llave (columna A) que se quiera restaurar.
//
// También recorta la hoja "Bitácora" a sus últimas 20.000 filas.

const SHEET_ID = "1H1I_00xY-HdqVCrDNei35FIl2EOx7tAWA3iOP3hJ8IE";
const CARPETA = "Respaldos Creamos Imagen";
const DIAS_A_GUARDAR = 30;
const BITACORA_MAX_FILAS = 20000;

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("respaldar").timeBased().everyDays(1).atHour(3).inTimezone("America/Santiago").create();
  respaldar();
  Logger.log("Listo: respaldo diario activado. Revisa la carpeta \"" + CARPETA + "\" en tu Drive.");
}

function carpeta() {
  const it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}

function respaldar() {
  const destino = carpeta();
  const fecha = Utilities.formatDate(new Date(), "America/Santiago", "yyyy-MM-dd HH'h'mm");
  DriveApp.getFileById(SHEET_ID).makeCopy("Respaldo Creamos Imagen " + fecha, destino);

  // Borra (a la papelera) los respaldos más antiguos que DIAS_A_GUARDAR.
  const limite = Date.now() - DIAS_A_GUARDAR * 24 * 3600 * 1000;
  const archivos = destino.getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    if (f.getName().indexOf("Respaldo Creamos Imagen ") === 0 && f.getDateCreated().getTime() < limite) f.setTrashed(true);
  }
  recortarBitacora();
}

function recortarBitacora() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Bitácora");
  if (!sh) return;
  const sobran = sh.getLastRow() - 1 - BITACORA_MAX_FILAS;
  if (sobran > 0) sh.deleteRows(2, sobran);
}
