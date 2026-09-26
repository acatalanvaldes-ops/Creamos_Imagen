// Permisos con goce de sueldo que establece el Código del Trabajo (Chile),
// revisado con la edición de la Dirección del Trabajo actualizada al
// 1 de septiembre de 2026. Lo usan Mi Portal (para pedirlos) y RRHH (para
// aprobarlos). Si cambia la ley, se actualiza aquí y en PERMISOS_CAUSALES
// de apps-script/Codigo.gs (el servidor solo acepta estas claves).
//
// unidad: "corridos" (días de calendario), "habiles" (lunes a viernes sin
// feriados) o "medio" (medio día en una sola fecha).
// continuo: el permiso se toma seguido, así que "Hasta" se calcula solo.
// retroactivo: se puede pedir con fecha de inicio pasada (hasta 30 días),
// porque el hecho ocurre sin aviso (fallecimiento, nacimiento, accidente).
var PERMISOS_LEGALES = [
  { clave: "nacimiento", nombre: "Nacimiento o adopción de un hijo o hija", dias: 5, unidad: "habiles", continuo: false, retroactivo: true,
    norma: "Art. 195 inc. 2°",
    nota: "5 días: seguidos desde el parto o repartidos dentro del primer mes. En adopción, desde la resolución del tribunal. Presenta el certificado de nacimiento o la resolución." },
  { clave: "matrimonio", nombre: "Matrimonio o acuerdo de unión civil", dias: 5, unidad: "habiles", continuo: true, retroactivo: false,
    norma: "Art. 207 bis",
    nota: "5 días hábiles seguidos, el día de la ceremonia o justo antes o después. Avisa con 30 días de anticipación y presenta el certificado dentro de los 30 días siguientes." },
  { clave: "muerte_hijo", nombre: "Fallecimiento de un hijo o hija", dias: 10, unidad: "corridos", continuo: true, retroactivo: true,
    norma: "Art. 66",
    nota: "10 días corridos desde el día del fallecimiento. Da fuero laboral por un mes. Presenta el certificado de defunción." },
  { clave: "muerte_conyuge", nombre: "Fallecimiento del cónyuge o conviviente civil", dias: 7, unidad: "corridos", continuo: true, retroactivo: true,
    norma: "Art. 66",
    nota: "7 días corridos desde el día del fallecimiento. Da fuero laboral por un mes. Presenta el certificado de defunción." },
  { clave: "muerte_gestacion", nombre: "Muerte de un hijo o hija en gestación", dias: 7, unidad: "habiles", continuo: true, retroactivo: true,
    norma: "Art. 66",
    nota: "7 días hábiles desde que se acredita con el certificado de defunción fetal." },
  { clave: "muerte_familiar", nombre: "Fallecimiento del padre, la madre o un hermano/a", dias: 4, unidad: "habiles", continuo: true, retroactivo: true,
    norma: "Art. 66",
    nota: "4 días hábiles desde el día del fallecimiento. Presenta el certificado de defunción." },
  { clave: "hijo_grave", nombre: "Hijo o hija (1 a 17 años) con accidente o enfermedad grave", dias: 10, unidad: "habiles", continuo: false, retroactivo: true,
    norma: "Art. 199 bis",
    nota: "Hasta 10 jornadas al año, completas o parciales, cuando el niño/a necesita tu cuidado por un accidente grave o una enfermedad grave con riesgo de muerte. Requiere certificado del médico tratante." },
  { clave: "examenes", nombre: "Exámenes preventivos (mamografía, próstata, papanicolau u otros)", dias: 0.5, unidad: "medio", continuo: true, retroactivo: false,
    norma: "Art. 66 bis",
    nota: "Medio día una vez al año, más el tiempo de traslado. Avisa con una semana de anticipación y presenta después el comprobante del examen." },
  { clave: "vacuna", nombre: "Vacunación en una campaña pública", dias: 0.5, unidad: "medio", continuo: true, retroactivo: false,
    norma: "Art. 66 ter",
    nota: "Medio día si estás dentro de la población objetivo de la campaña. Avisa con al menos 2 días de anticipación y presenta el comprobante." }
];

var TIPOS_SOLICITUD = {
  vacaciones: "Vacaciones",
  permiso_con_goce: "Permiso con goce de sueldo",
  permiso_sin_goce: "Permiso sin goce de sueldo"
};

function permisoLegal(clave) {
  for (var i = 0; i < PERMISOS_LEGALES.length; i++) if (PERMISOS_LEGALES[i].clave === clave) return PERMISOS_LEGALES[i];
  return null;
}

// Tipo de una solicitud o registro; lo que no trae tipo es de antes: vacaciones.
function tipoSolicitud(s) { return (s && s.tipo) || "vacaciones"; }

// Días que ocupa un permiso entre ini y fin. contarHabiles(ini, fin) es la
// función de días hábiles de cada página (usa sus feriados).
function diasPermiso(causal, ini, fin, contarHabiles) {
  var p = permisoLegal(causal);
  if (p && p.unidad === "medio") return 0.5;
  if (p && p.unidad === "corridos") return Math.round((Date.parse(fin) - Date.parse(ini)) / 86400000) + 1;
  return contarHabiles(ini, fin);
}

// Texto corto para tablas: "Permiso con goce · Matrimonio o acuerdo de unión civil".
function etiquetaSolicitud(s) {
  var t = tipoSolicitud(s);
  if (t === "permiso_con_goce") { var p = permisoLegal(s.causal); return "Permiso con goce" + (p ? " · " + p.nombre : ""); }
  if (t === "permiso_sin_goce") return "Permiso sin goce";
  return "Vacaciones";
}
