// Contenido de la página pública de inicio (index.html).
// SITIO_BASE es el contenido por defecto; lo que se edita en el portal
// (Sitio web, solo administradores) se guarda en la llave sitio_web_v1 y se
// combina encima de esto. Lo usan index.html (para mostrar) y sitio.html
// (para editar).
(function (global) {
  const SITIO_BASE = {
    aviso: { activo: false, texto: "" },
    portada: {
      etiqueta: "Sublimación textil · Recoleta, Santiago",
      titulo: "Vestimos a tu equipo",
      destacado: "con identidad propia.",
      bajada: "Camisetas y conjuntos deportivos sublimados, línea K-pop y artículos personalizados. Tú traes la idea, nosotros la diseñamos y la producimos.",
      botonPrincipal: "Ver productos",
      botonSecundario: "Cotizar por WhatsApp"
    },
    datos: [
      { valor: "15", texto: "años sublimando" },
      { valor: "300", texto: "prendas por semana" },
      { valor: "100%", texto: "diseño a tu medida" },
      { valor: "15–20", texto: "días de producción" }
    ],
    catalogo: {
      etiqueta: "Catálogo",
      titulo: "Lo que hacemos",
      bajada: "Todo se fabrica a pedido. Elige un producto y te enviamos la cotización con precio, tallas y plazo."
    },
    productos: [
      { id: "p1", visible: true, nombre: "Camisetas deportivas", categoria: "Deportivo", foto: "", precio: "", color: "#F1AF13", texto: "Camisetas 100% sublimadas para fútbol, básquetbol y ligas. Nombre y número incluidos." },
      { id: "p2", visible: true, nombre: "Conjuntos deportivos", categoria: "Deportivo", foto: "", precio: "", color: "#BCD0CA", texto: "Camiseta y short a juego con el diseño y los colores de tu equipo." },
      { id: "p3", visible: true, nombre: "Camisetas de arquero", categoria: "Deportivo", foto: "", precio: "", color: "#DA8C68", texto: "Manga larga, diseño diferenciado del resto del equipo." },
      { id: "p4", visible: true, nombre: "Pañuelos 45×45 cm", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/panuelo-1.jpg", "assets/sitio/panuelo-2.jpg", "assets/sitio/panuelo-3.jpg", "assets/sitio/panuelo-4.jpg", "assets/sitio/panuelo-5.jpg", "assets/sitio/panuelo-6.jpg"], color: "#C9B6E4", texto: "Pañuelos sublimados con diseños de tus grupos favoritos." },
      { id: "p5", visible: true, nombre: "Pañoletas 70×70 cm", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/panoleta-1.jpg", "assets/sitio/panoleta-2.jpg", "assets/sitio/panoleta-3.jpg", "assets/sitio/panoleta-4.jpg"], color: "#F2C4CE", texto: "Formato grande para conciertos y colección." },
      { id: "p8", visible: true, nombre: "Camisetas K-pop", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/camiseta-kpop-1.jpg", "assets/sitio/camiseta-kpop-2.jpg", "assets/sitio/camiseta-kpop-3.jpg"], color: "#E6E2D9", texto: "Camisetas sublimadas con diseños de tus grupos favoritos." },
      { id: "p9", visible: true, nombre: "Mantas personalizadas", categoria: "Personalizado", foto: "", precio: "",
        fotos: Array.from({ length: 12 }, (_, i) => "assets/sitio/manta-" + (i + 1) + ".jpg"), color: "#F7D57A", texto: "Mantas sublimadas con diseños de tus grupos favoritos." }
    ],
    comprar: {
      etiqueta: "Cómo comprar",
      titulo: "De la idea a tu equipo en 4 pasos",
      pasos: [
        { titulo: "Cotiza", texto: "Escríbenos por WhatsApp o visítanos en tienda con tu idea, cantidad y tallas." },
        { titulo: "Diseñamos", texto: "Nuestro equipo arma el diseño y te lo enviamos para que lo apruebes." },
        { titulo: "Producimos", texto: "Sublimamos y confeccionamos tu pedido en 15 a 20 días." },
        { titulo: "Retiras", texto: "Te avisamos cuando esté listo para retirar en nuestra tienda." }
      ],
      pago: "Medios de pago: transferencia y Webpay."
    },
    contacto: {
      titulo: "Visítanos en Recoleta",
      direccion: "Río de Janeiro 319, Recoleta, Santiago",
      // Dirección que se busca en Google Maps (mapa y botón "Cómo llegar").
      mapa: "República de Corea 319, Recoleta, Santiago, Chile",
      horario: "Lunes a viernes de 10:00 a 18:30 hrs · Sábados de 10:00 a 17:00 hrs",
      whatsapp: "56945411092",
      mensajeWhatsapp: "Hola Creamos Imagen, quiero cotizar.",
      correo: "ventasmayorsublipro@gmail.com",
      instagram: "",
      tiktok: "",
      facebook: ""
    }
  };

  const copia = o => JSON.parse(JSON.stringify(o));
  // Combina lo guardado sobre la base: objetos campo a campo; listas completas.
  function combinar(base, guardado) {
    if (Array.isArray(base)) return Array.isArray(guardado) ? copia(guardado) : copia(base);
    if (base && typeof base === "object") {
      const out = {};
      Object.keys(base).forEach(k => { out[k] = combinar(base[k], guardado && typeof guardado === "object" ? guardado[k] : undefined); });
      return out;
    }
    return guardado === undefined || guardado === null ? base : guardado;
  }
  function contenidoSitio(guardado) { return combinar(SITIO_BASE, guardado || {}); }

  // Utilidades seguras para mostrar contenido editado.
  const esc = t => String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const colorSeguro = c => /^#[0-9a-fA-F]{3,8}$/.test(String(c || "")) ? c : "#E6E2D9";
  const urlSegura = u => { u = String(u || "").trim(); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; };
  // Fotos permitidas: subidas desde el editor (data:), enlaces https o
  // archivos del propio sitio en assets/sitio/.
  const fotoSegura = u => { u = String(u || "").trim(); return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) || /^https:\/\/[^\s"'<>]+$/i.test(u) || /^assets\/sitio\/[\w.-]+\.(jpe?g|png|webp)$/i.test(u) ? u : ""; };
  // Todas las fotos de un producto (lista "fotos" + la foto única antigua "foto").
  const fotosDe = p => [].concat(Array.isArray(p && p.fotos) ? p.fotos : [], p && p.foto ? [p.foto] : []).map(fotoSegura).filter(Boolean);
  const soloDigitos = s => String(s || "").replace(/\D/g, "");

  global.SITIO_BASE = SITIO_BASE;
  global.contenidoSitio = contenidoSitio;
  global.SitioUtil = { esc, colorSeguro, urlSegura, fotoSegura, fotosDe, soloDigitos, copia };
})(window);
