const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxP5-vB59e80qpXdx4AcCyS28C4H58thdh0XXtLcDWZD8Q_47fDbBvLn1ahqx7RoJor/exec";

module.exports = async function portalProxy(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ estado: "error", detalle: "MÉTODO_NO_PERMITIDO" });
  }

  try {
    const requestUrl = new URL(req.url, "https://portal.local");
    const targetUrl = new URL(APPS_SCRIPT_URL);
    targetUrl.search = requestUrl.search;

    const options = { method: req.method, redirect: "follow" };
    if (req.method === "POST") {
      options.headers = { "Content-Type": req.headers["content-type"] || "text/plain;charset=UTF-8" };
      if (req.body !== undefined) {
        options.body = typeof req.body === "string" || Buffer.isBuffer(req.body)
          ? req.body
          : JSON.stringify(req.body);
      }
    }

    const upstream = await fetch(targetUrl, options);
    const contentType = upstream.headers.get("content-type") || "application/json; charset=utf-8";
    const body = await upstream.text();
    res.setHeader("Content-Type", contentType);
    return res.status(upstream.status).send(body);
  } catch (error) {
    console.error("Error comunicando con Apps Script:", error);
    return res.status(502).json({ estado: "error", detalle: "No se pudo conectar con el servicio del portal." });
  }
};
