// Formulario "Contáctanos" del sitio público (index.html).
// Reenvía a Apps Script (accion=contactoSitio) solo los campos del
// formulario, más una huella anónima del visitante (resumen de su IP, no la
// IP) para limitar cuántos mensajes puede enviar por hora.
const crypto = require("crypto");
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxP5-vB59e80qpXdx4AcCyS28C4H58thdh0XXtLcDWZD8Q_47fDbBvLn1ahqx7RoJor/exec";

module.exports = async function contacto(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ estado: "error", detalle: "MÉTODO_NO_PERMITIDO" });
  }
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== "object") return res.status(400).json({ estado: "error", detalle: "Datos inválidos." });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || String(req.socket && req.socket.remoteAddress || "");
  const huella = crypto.createHash("sha256").update("creamos-contacto|" + ip).digest("hex").slice(0, 32);
  const cuerpo = {
    accion: "contactoSitio",
    nombre: String(b.nombre || "").slice(0, 200),
    rut: String(b.rut || "").slice(0, 20),
    correo: String(b.correo || "").slice(0, 200),
    mensaje: String(b.mensaje || "").slice(0, 2000),
    web: String(b.web || "").slice(0, 200),
    huella
  };
  try {
    const r = await fetch(APPS_SCRIPT_URL, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(cuerpo) });
    const j = await r.json();
    return res.status(200).json(j && j.estado === "éxito" ? { estado: "éxito" } : { estado: "error", detalle: (j && j.detalle) || "No se pudo enviar." });
  } catch (error) {
    console.error("contacto:", error);
    return res.status(502).json({ estado: "error", detalle: "No se pudo enviar. Inténtalo de nuevo o escríbenos por WhatsApp." });
  }
};
