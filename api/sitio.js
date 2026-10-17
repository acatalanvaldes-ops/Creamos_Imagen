// Contenido público de la página de inicio (index.html).
// Lee de Apps Script solo la llave sitio_web_v1 (accion=sitioPublico) y la
// guarda en la caché de Vercel: los visitantes no consultan la planilla en
// cada visita. Un cambio hecho en el portal (Sitio web) se ve en ~1 minuto.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxP5-vB59e80qpXdx4AcCyS28C4H58thdh0XXtLcDWZD8Q_47fDbBvLn1ahqx7RoJor/exec";

module.exports = async function sitio(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ estado: "error", detalle: "MÉTODO_NO_PERMITIDO" });
  }
  try {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set("accion", "sitioPublico");
    const r = await fetch(url, { redirect: "follow" });
    const j = await r.json();
    if (j.estado !== "éxito") throw new Error(j.detalle || "respuesta inválida");
    let contenido = null;
    try { contenido = j.valor ? JSON.parse(j.valor) : null; } catch (e) { contenido = null; }
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=86400");
    return res.status(200).json({ estado: "éxito", contenido });
  } catch (error) {
    console.error("sitio:", error);
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ estado: "error", detalle: "No se pudo leer el contenido del sitio." });
  }
};
