// Fechas y horas en hora de Chile (America/Santiago), compartido por todos
// los módulos.
//
// Antes "hoy" se calculaba con new Date().toISOString().slice(0,10), que da
// la fecha en hora UTC: desde las 20:00-21:00 de Chile ya es el día siguiente
// en UTC, así que una venta o compra ingresada de noche quedaba con la fecha
// de mañana (y el último día del mes, en el mes siguiente). Otras partes
// usaban la hora del computador, que depende de cómo esté configurado cada
// equipo. Estas funciones siempre usan la zona horaria de Chile, con su
// horario de verano/invierno.
var ZONA_CHILE = 'America/Santiago';

// { y, m, d, h, mi, s } de un instante (por defecto, ahora) en hora de Chile.
function partesChile(fecha) {
  var partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA_CHILE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(fecha || new Date());
  var r = {};
  partes.forEach(function (p) { r[p.type] = p.value; });
  return { y: +r.year, m: +r.month, d: +r.day, h: +r.hour % 24, mi: +r.minute, s: +r.second };
}

function dosDigitos(n) { return (n < 10 ? '0' : '') + n; }

// "YYYY-MM-DD" de hoy (o de un instante dado) en Chile.
function hoyChile(fecha) {
  var p = partesChile(fecha);
  return p.y + '-' + dosDigitos(p.m) + '-' + dosDigitos(p.d);
}

// "YYYY-MM" del mes actual en Chile.
function mesChile(fecha) { return hoyChile(fecha).slice(0, 7); }

// Un Date cuyos getFullYear()/getMonth()/getDate()/getHours() devuelven la
// fecha y hora de Chile, para el código que usa esos métodos. Sirve para
// leer "qué día/mes es", no para guardar instantes (para eso, new Date()).
function ahoraChile(fecha) {
  var p = partesChile(fecha);
  return new Date(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
}

// Mes (0-11) de un texto "YYYY-MM-DD" sin pasar por new Date(texto), que lo
// interpreta como medianoche UTC (en Chile, todavía el día anterior).
function mesDeFecha(texto) { return parseInt(String(texto).slice(5, 7), 10) - 1; }

// Formatea un instante como fecha en hora de Chile.
function fechaChileTexto(fecha, opciones, locale) {
  return (fecha || new Date()).toLocaleDateString(locale || 'es-CL',
    Object.assign({}, opciones || {}, { timeZone: ZONA_CHILE }));
}
