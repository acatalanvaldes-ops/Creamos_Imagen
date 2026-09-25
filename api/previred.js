const PREVIRED_URL = "https://www.previred.com/indicadores-previsionales/";

function texto(html) {
  return html
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<\/(?:td|th)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&oacute;/gi, "ó").replace(/&iacute;/gi, "í")
    .replace(/&uacute;/gi, "ú").replace(/&eacute;/gi, "é")
    .replace(/&aacute;/gi, "á").replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&").replace(/&#8211;|&ndash;/gi, "–")
    .replace(/\s+/g, " ").trim();
}

function celdas(html) {
  return [...html.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(m => texto(m[1]));
}

function porcentaje(valor) {
  const m = String(valor || "").match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? Number(m[1].replace(",", ".")) : null;
}

function analizar(html) {
  const tasasAfp = {};
  const afpNombres = { capital: "CAPITAL", cuprum: "CUPRUM", habitat: "HABITAT", planvital: "PLANVITAL", provida: "PROVIDA", modelo: "MODELO", uno: "UNO" };
  const afc = {};
  const seguroSocial = {};
  let sis = null;

  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = celdas(match[1]);
    if (cells.length < 2) continue;
    const nombre = (cells[0] || "").toLocaleLowerCase("es").replace(/\s+/g, " ").trim();
    if (afpNombres[nombre] && cells.length >= 4) {
      const trabajador = porcentaje(cells[1]);
      const empleador = porcentaje(cells[2]);
      const total = porcentaje(cells[3]);
      if (trabajador != null && empleador != null && total != null) {
        tasasAfp[afpNombres[nombre]] = { trabajador, empleador, total };
      }
    }
    if (/plazo indefinido/i.test(nombre) && /11\s*años/i.test(nombre)) {
      afc.indefinido11Mas = { empleador: porcentaje(cells[1]), trabajador: porcentaje(cells[2]) || 0 };
    } else if (/plazo indefinido/i.test(nombre)) {
      afc.indefinido = { empleador: porcentaje(cells[1]), trabajador: porcentaje(cells[2]) };
    } else if (/plazo fijo/i.test(nombre)) {
      afc.plazoFijo = { empleador: porcentaje(cells[1]), trabajador: porcentaje(cells[2]) || 0 };
    } else if (/casa particular/i.test(nombre)) {
      afc.casaParticular = { empleador: porcentaje(cells[1]), trabajador: porcentaje(cells[2]) || 0 };
    }
    if (/rentabilidad protegida|expectativa de vida/i.test(nombre)) seguroSocial[nombre] = porcentaje(cells[1]);
    if (/seguro de invalidez y sobrevivencia|^tasa sis$/i.test(nombre)) sis = porcentaje(cells[cells.length - 1]);
  }

  const pageText = texto(html);
  const periodo = pageText.match(/Para cotizaciones a pagar en ([a-záéíóú]+\s+\d{4})\s*\(remuneraciones\s+([a-záéíóú]+\s+\d{4})\)/i);
  if (Object.keys(tasasAfp).length !== 7 || !afc.indefinido || !afc.plazoFijo || !sis || !periodo) {
    throw new Error("No se pudieron validar todos los indicadores previsionales publicados por Previred.");
  }
  return {
    fuente: PREVIRED_URL,
    periodoCotizacion: periodo[1],
    periodoRemuneracion: periodo[2],
    tasasAfp,
    afc,
    seguroSocial,
    sis,
    salud: 7,
    consultadoEn: new Date().toISOString()
  };
}

module.exports = async function indicadoresPrevired(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ estado: "error", detalle: "MÉTODO_NO_PERMITIDO" });
  }
  try {
    const upstream = await fetch(PREVIRED_URL, { headers: { "User-Agent": "CreamosImagen-Portal/1.0" } });
    if (!upstream.ok) throw new Error("Previred respondió HTTP " + upstream.status);
    const indicadores = analizar(await upstream.text());
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    return res.status(200).json(indicadores);
  } catch (error) {
    console.error("No se pudieron obtener los indicadores de Previred:", error);
    return res.status(502).json({ estado: "error", detalle: "No fue posible consultar y validar los indicadores publicados por Previred." });
  }
};
