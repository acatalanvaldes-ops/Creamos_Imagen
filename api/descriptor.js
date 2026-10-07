// Genera con IA (Claude) el descriptor de un cargo a partir de las funciones
// que escribe quien administra RRHH.
//
// Seguridad:
//  - Solo responde a sesiones válidas con acceso a Recursos Humanos: el token
//    de la sesión (cabecera X-Portal-Token) se verifica con Apps Script
//    (accion=yo) antes de llamar a la IA.
//  - La clave de la IA vive solo aquí, en la variable de entorno
//    ANTHROPIC_API_KEY de Vercel; nunca llega al navegador.
//  - A la IA solo se envía la información del cargo (nombre, área, jefatura,
//    cargos a cargo y funciones). Nunca datos de trabajadores.
const AnthropicSDK = require("@anthropic-ai/sdk");
const Anthropic = AnthropicSDK.default || AnthropicSDK;

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxP5-vB59e80qpXdx4AcCyS28C4H58thdh0XXtLcDWZD8Q_47fDbBvLn1ahqx7RoJor/exec";
const MODELO = "claude-opus-5-5";

const EMPRESA = "Creamos Imagen Ltda., empresa chilena ubicada en Recoleta (Santiago), " +
  "dedicada a la sublimación, estampado y confección textil personalizada (camisetas, conjuntos, " +
  "banderas, lienzos, mantas, banners, pañuelos), con venta en sala/local y venta a empresas.";

const SISTEMA = [
  "Eres especialista en Recursos Humanos en Chile y redactas descriptores de cargo para pymes.",
  "Contexto de la empresa: " + EMPRESA,
  "Recibirás el nombre del cargo, su área, a quién reporta, qué cargos le reportan y las funciones",
  "escritas con palabras simples por la dueña de la empresa. Con eso redacta un descriptor de cargo",
  "profesional, en español de Chile, concreto y aplicable a una pyme de este rubro:",
  "- Respeta las funciones entregadas: ordénalas, redáctalas bien y complétalas solo con tareas",
  "  que se desprendan razonablemente de ellas. No inventes responsabilidades ajenas al cargo.",
  "- Los requisitos deben ser realistas para el cargo y el tamaño de la empresa (no exijas títulos",
  "  universitarios donde no hacen falta).",
  "- Los indicadores de desempeño deben ser medibles.",
  "- En riesgos del puesto considera los propios del rubro cuando apliquen (calor de planchas y",
  "  calandras, tintas y químicos, cortes, posturas, cargas, uso de computador) y la medida preventiva",
  "  de cada uno, en línea con la obligación de informar los riesgos laborales (Ley 16.744).",
  "- Escribe en tercera persona, sin nombres de personas y sin texto de relleno."
].join("\n");

// Esquema de la respuesta (structured outputs): la IA debe devolver exactamente esto.
const texto = { type: "string" };
const lista = { type: "array", items: { type: "string" } };
const objeto = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const ESQUEMA = objeto({
  objetivo: texto,
  funciones: { type: "array", items: objeto({ funcion: texto, detalle: texto }) },
  responsabilidades: lista,
  autoridad: lista,
  requisitos: objeto({ formacion: texto, experiencia: texto, conocimientos: lista, deseables: lista }),
  competencias: { type: "array", items: objeto({ nombre: texto, descripcion: texto }) },
  indicadores: lista,
  relaciones: objeto({ internas: lista, externas: lista }),
  condiciones: objeto({ jornada: texto, lugar: texto }),
  riesgos: { type: "array", items: objeto({ riesgo: texto, medida: texto }) }
});

function limpiar(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }

async function verificarSesion(token) {
  if (!token) return { ok: false, codigo: 401, detalle: "NO_AUTORIZADO" };
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("accion", "yo");
  url.searchParams.set("token", token);
  const r = await fetch(url, { redirect: "follow" });
  const j = await r.json();
  if (!j || j.estado !== "éxito") return { ok: false, codigo: 401, detalle: (j && j.detalle) || "NO_AUTORIZADO" };
  const tieneRrhh = j.isAdmin || (Array.isArray(j.modules) && j.modules.indexOf("rrhh") !== -1);
  return tieneRrhh ? { ok: true } : { ok: false, codigo: 403, detalle: "SIN_PERMISO" };
}

function armarPedido(c) {
  const lineas = [
    "Cargo: " + c.nombre,
    "Área: " + (c.area || "No indicada"),
    "Reporta a: " + (c.reportaA || "Gerencia / dueña de la empresa"),
    "Cargos que le reportan: " + (c.subordinados.length ? c.subordinados.join(", ") : "Ninguno"),
    "Jornada: " + (c.jornada || "No indicada"),
    "",
    "Funciones indicadas por la empresa:",
    c.funciones
  ];
  if (c.notas) lineas.push("", "Observaciones adicionales:", c.notas);
  return lineas.join("\n");
}

module.exports = async function descriptorCargo(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ estado: "error", detalle: "MÉTODO_NO_PERMITIDO" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ estado: "error", detalle: "IA_NO_CONFIGURADA" });
  }

  try {
    const token = typeof req.headers["x-portal-token"] === "string" ? req.headers["x-portal-token"].slice(0, 2000) : "";
    const sesion = await verificarSesion(token);
    if (!sesion.ok) return res.status(sesion.codigo).json({ estado: "error", detalle: sesion.detalle });

    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const cargo = {
      nombre: limpiar(b.nombre, 120),
      area: limpiar(b.area, 120),
      reportaA: limpiar(b.reportaA, 120),
      jornada: limpiar(b.jornada, 120),
      subordinados: (Array.isArray(b.subordinados) ? b.subordinados : []).slice(0, 30).map((s) => limpiar(s, 120)).filter(Boolean),
      funciones: String(b.funciones || "").trim().slice(0, 6000),
      notas: String(b.notas || "").trim().slice(0, 2000)
    };
    if (!cargo.nombre || cargo.funciones.length < 10) {
      return res.status(400).json({ estado: "error", detalle: "FALTAN_DATOS" });
    }

    const client = new Anthropic();
    // fallbacks "default": si los filtros de seguridad rechazaran el pedido por
    // error, la API lo reintenta automáticamente con el modelo recomendado.
    const respuesta = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: ESQUEMA } },
      system: SISTEMA,
      messages: [{ role: "user", content: armarPedido(cargo) }]
    });

    if (respuesta.stop_reason === "refusal") {
      return res.status(422).json({ estado: "error", detalle: "IA_RECHAZO" });
    }
    if (respuesta.stop_reason === "max_tokens") {
      return res.status(502).json({ estado: "error", detalle: "IA_INCOMPLETA" });
    }
    const bloque = respuesta.content.find((x) => x.type === "text");
    if (!bloque) return res.status(502).json({ estado: "error", detalle: "IA_SIN_RESPUESTA" });
    const descriptor = JSON.parse(bloque.text);
    return res.status(200).json({ estado: "éxito", descriptor, modelo: respuesta.model });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ estado: "error", detalle: "IA_OCUPADA" });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Clave de la IA inválida:", error.message);
      return res.status(503).json({ estado: "error", detalle: "IA_NO_CONFIGURADA" });
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Error de la API de IA:", error.status, error.message);
      return res.status(502).json({ estado: "error", detalle: "IA_ERROR" });
    }
    console.error("Error generando descriptor:", error);
    return res.status(500).json({ estado: "error", detalle: "ERROR_INTERNO" });
  }
};
