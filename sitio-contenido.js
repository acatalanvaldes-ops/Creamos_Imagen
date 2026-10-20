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
    // Cada producto: "valor" = sus características (una por línea en el editor,
    // "Nombre: detalle"); se muestran en el visor al hacer clic en la foto.
    productos: [
      { id: "p1", visible: true,
        valor: ["Tela ciré nacional: tela full deportiva, fabricada en Chile.", "Respirable: deja salir el calor y la camiseta se mantiene seca.", "Sin olor a humedad: la tela no retiene la humedad ni el mal olor.", "Nombre y número incluidos: cada jugador con su nombre y número."],
        fotos: Array.from({ length: 7 }, (_, i) => "assets/sitio/camiseta-deportiva-" + (i + 1) + ".jpg"),
        nombre: "Camisetas deportivas", categoria: "Deportivo", foto: "", precio: "", color: "#F1AF13", texto: "Camisetas 100% sublimadas para fútbol, básquetbol y ligas. Nombre y número incluidos." },
      { id: "p2", visible: true,
        valor: ["Tela ciré nacional: tela full deportiva, fabricada en Chile.", "Respirable: deja salir el calor y el conjunto se mantiene seco.", "Sin olor a humedad: la tela no retiene la humedad ni el mal olor.", "Desde 12 unidades: diseño personalizado."],
        fotos: Array.from({ length: 5 }, (_, i) => "assets/sitio/conjunto-" + (i + 1) + ".jpg"),
        nombre: "Conjuntos deportivos", categoria: "Deportivo", foto: "", precio: "", color: "#BCD0CA", texto: "Camiseta y short a juego con el diseño y los colores de tu equipo." },
      { id: "p3", visible: true, nombre: "Camisetas de arquero", categoria: "Deportivo", foto: "", precio: "", color: "#DA8C68", texto: "Manga larga, diseño diferenciado del resto del equipo." },
      { id: "p4", visible: true,
        valor: ["Medida 45 × 45 cm: formato cuadrado para el cuello, el cabello o como accesorio corporativo.", "Satín de poliéster: tela liviana, suave y brillante, que mantiene los colores intensos.", "Costuras reforzadas: dobladillo resistente que no se deshilacha con el uso ni con los lavados.", "Sublimación full color: impresión en alta definición dentro de la fibra, sin perder suavidad.", "Desde 25 unidades: diseños personalizados."],
        nombre: "Pañuelos 45×45 cm", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/panuelo-1.jpg", "assets/sitio/panuelo-2.jpg", "assets/sitio/panuelo-3.jpg", "assets/sitio/panuelo-4.jpg", "assets/sitio/panuelo-5.jpg", "assets/sitio/panuelo-6.jpg"], color: "#C9B6E4", texto: "Pañuelos sublimados con diseños de tus grupos favoritos." },
      { id: "p5", visible: true,
        valor: ["Medida 65 × 65 cm: formato cuadrado grande para el cuello, el cabello o para lucir en conciertos.", "Satín de poliéster: tela liviana, suave y brillante, que mantiene los colores intensos.", "Costuras reforzadas: dobladillo resistente que no se deshilacha con el uso ni con los lavados.", "Sublimación full color: impresión en alta definición dentro de la fibra, sin perder suavidad.", "Desde 25 unidades: diseños personalizados."],
        nombre: "Pañoletas 65×65 cm", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/panoleta-1.jpg", "assets/sitio/panoleta-2.jpg", "assets/sitio/panoleta-3.jpg", "assets/sitio/panoleta-4.jpg"], color: "#F2C4CE", texto: "Formato grande para conciertos y colección." },
      { id: "p8", visible: true,
        valor: ["Tela ciré nacional: tela full deportiva, fabricada en Chile.", "Transpirable: deja salir el calor y la camiseta se mantiene seca.", "Sin malos olores: la tela no retiene la humedad ni el mal olor.", "Desde 12 unidades: diseño personalizado."],
        nombre: "Camisetas K-pop", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/camiseta-kpop-1.jpg", "assets/sitio/camiseta-kpop-2.jpg", "assets/sitio/camiseta-kpop-3.jpg"], color: "#E6E2D9", texto: "Camisetas sublimadas con diseños de tus grupos favoritos." },
      { id: "p9", visible: true,
        valor: ["Tela polar: suave, liviana y abrigadora.", "Dos medidas: 100 × 130 cm y 135 × 180 cm.", "Sublimación full color: impresión en alta definición, con colores intensos y duraderos.", "Bordes reforzados: terminación resistente que no se deshilacha con el uso ni con los lavados.", "Desde 1 unidad: diseño personalizado a tu gusto."],
        nombre: "Mantas personalizadas", categoria: "Personalizado", foto: "", precio: "",
        fotos: Array.from({ length: 12 }, (_, i) => "assets/sitio/manta-" + (i + 1) + ".jpg"), color: "#F7D57A", texto: "Mantas sublimadas con diseños de tus grupos favoritos." },
      { id: "p10", visible: true,
        valor: ["Gran formato a tu medida: 1,50 m de ancho y el largo que necesites, desde 3 m.", "Tela bistretch: elástica en ambos sentidos, ideal para tensar y colgar.", "Totalmente personalizado: tu escudo, colores, frases y diseño a medida."],
        nombre: "Lienzos", categoria: "Personalizado", foto: "", precio: "",
        fotos: ["assets/sitio/lienzo-1.jpg", "assets/sitio/lienzo-2.jpg", "assets/sitio/lienzo-3.jpg", "assets/sitio/lienzo-4.jpg"], color: "#DA8C68", texto: "Lienzos de gran formato para clubes, hinchadas, eventos y celebraciones." },
      { id: "p11", visible: true,
        valor: ["Medida 26 × 100 cm: formato alargado para alentar en estadios y conciertos.", "Tela franela fantasía: suave y liviana.", "Desde 25 unidades: diseño personalizado."],
        nombre: "Banner", categoria: "Personalizado", foto: "", precio: "",
        fotos: Array.from({ length: 6 }, (_, i) => "assets/sitio/banner-" + (i + 1) + ".jpg"), color: "#C9B6E4", texto: "Banners para alentar a tu equipo o a tu artista favorito." }
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
      direccion: "República de Corea 319, Recoleta, Santiago",
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
