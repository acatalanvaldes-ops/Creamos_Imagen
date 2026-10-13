// Envío de correos desde la casilla de la persona que inició sesión.
//
// - Sesión con Google  → API de Gmail (permiso gmail.send).
// - Sesión con Microsoft (Outlook, Hotmail, Live) → Microsoft Graph (permiso Mail.Send).
//
// La primera vez, Google o Microsoft muestran una ventana para autorizar el
// envío de correos. Antes de enviar se verifica que la cuenta autorizada sea
// la MISMA de la sesión: si la persona elige otra cuenta, no se envía nada.
// El permiso (token) solo se guarda en memoria mientras la página está abierta.
//
// Uso: await CorreoSesion.enviar({ para: ['a@b.cl'], cc: [], asunto, texto,
//        adjuntos: [{ nombre: 'x.pdf', tipo: 'application/pdf', base64 }] })
// Lanza Error con un código en .message (ver MENSAJES) si algo falla.
(function () {
  var GOOGLE_CLIENT_ID = "207433225749-76s4184pif80ge7gfr0nt39qa80b82ij.apps.googleusercontent.com";
  var MS_CLIENT_ID = "f7d2b2f8-80ef-46bd-827b-1cb6c9a65f99";
  var GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
  var MS_RES_KEY = "cimagen_ms_correo_res";

  var MENSAJES = {
    CANCELADO: "Se canceló la autorización. El correo no se envió.",
    SIN_PERMISO: "No diste permiso para enviar correos desde tu casilla. Vuelve a intentarlo y marca la casilla de permiso de envío.",
    OTRA_CUENTA: "Autorizaste una cuenta distinta a la de tu sesión. Por seguridad el correo solo se envía desde la misma casilla con la que entraste al portal.",
    POPUP_BLOQUEADO: "El navegador bloqueó la ventana de autorización. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.",
    GOOGLE_NO_CARGO: "No se pudo cargar el servicio de Google. Revisa tu conexión y recarga la página.",
    GMAIL_NO_HABILITADO: "El envío con Gmail aún no está habilitado para el portal (falta activar la API de Gmail en la configuración de Google Cloud).",
    MS_NO_CONFIGURADO: "El envío con Outlook/Hotmail aún no está habilitado para el portal (falta configurar el permiso Mail.Send en el registro de la aplicación en Azure).",
    SIN_SESION: "No hay una sesión activa. Vuelve a iniciar sesión.",
    PROVEEDOR_DESCONOCIDO: "No se pudo saber si tu cuenta es de Google o de Microsoft. Cierra sesión y vuelve a entrar.",
    DEMASIADO_GRANDE: "El archivo adjunto es demasiado grande para enviarlo por correo.",
    ERROR_ENVIO: "El servicio de correo rechazó el envío. Revisa las direcciones e inténtalo de nuevo."
  };

  function sesion() { try { return JSON.parse(localStorage.getItem("cimagen_session")) || null; } catch (e) { return null; } }
  function falla(codigo, detalle) { var e = new Error(codigo); e.detalle = detalle || ""; return e; }

  // Proveedor de la sesión. Las sesiones nuevas lo guardan al iniciar sesión;
  // para las anteriores se deduce del dominio del correo.
  function proveedor(s) {
    if (s && (s.proveedor === "Google" || s.proveedor === "Microsoft")) return s.proveedor;
    var dom = String((s && s.email) || "").split("@")[1] || "";
    if (/^(gmail|googlemail)\.com$/i.test(dom)) return "Google";
    if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/i.test(dom)) return "Microsoft";
    return null;
  }

  // ---------- Utilidades ----------
  function b64Utf8(texto) { return btoa(unescape(encodeURIComponent(texto))); }
  function b64url(bytesOTexto) {
    var b = typeof bytesOTexto === "string" ? btoa(bytesOTexto) : btoa(String.fromCharCode.apply(null, new Uint8Array(bytesOTexto)));
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function cortar76(b64) { return b64.replace(/.{1,76}/g, "$&\r\n").trim(); }
  function encabezado(texto) { return /^[\x20-\x7e]*$/.test(texto) ? texto : "=?UTF-8?B?" + b64Utf8(texto) + "?="; }
  function aleatorio(n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), function (b) { return b.toString(16).padStart(2, "0"); }).join(""); }
  function payloadJwt(jwt) {
    try { var p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(decodeURIComponent(escape(atob(p)))); } catch (e) { return {}; }
  }

  // ---------- Google / Gmail ----------
  var tokenGoogle = null; // { token, vence }
  function esperarGoogle() {
    return new Promise(function (ok, mal) {
      var intentos = 0;
      (function revisar() {
        if (window.google && google.accounts && google.accounts.oauth2) return ok();
        if (++intentos > 50) return mal(falla("GOOGLE_NO_CARGO"));
        setTimeout(revisar, 200);
      })();
    });
  }
  async function permisoGoogle(email) {
    if (tokenGoogle && tokenGoogle.vence > Date.now() + 60000) return tokenGoogle.token;
    await esperarGoogle();
    var resp = await new Promise(function (ok, mal) {
      var cliente = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GMAIL_SCOPE + " email",
        login_hint: email,
        hint: email,
        callback: function (r) { r && r.error ? mal(falla(r.error === "access_denied" ? "SIN_PERMISO" : "CANCELADO", r.error)) : ok(r); },
        error_callback: function (e) { mal(falla(e && e.type === "popup_failed_to_open" ? "POPUP_BLOQUEADO" : "CANCELADO", e && e.type)); }
      });
      cliente.requestAccessToken({ prompt: "" });
    });
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, GMAIL_SCOPE)) throw falla("SIN_PERMISO");
    // Se confirma con Google a qué cuenta pertenece el permiso.
    var info = await (await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(resp.access_token))).json();
    if (String(info.email || "").toLowerCase() !== email) {
      try { google.accounts.oauth2.revoke(resp.access_token, function () {}); } catch (e) {}
      throw falla("OTRA_CUENTA", info.email);
    }
    tokenGoogle = { token: resp.access_token, vence: Date.now() + (Number(resp.expires_in) || 3000) * 1000 };
    return tokenGoogle.token;
  }
  function mimeGmail(m, desde) {
    var limite = "cimagen_" + aleatorio(12);
    var partes = [
      "From: " + desde,
      "To: " + m.para.join(", "),
      m.cc.length ? "Cc: " + m.cc.join(", ") : null,
      "Subject: " + encabezado(m.asunto),
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="' + limite + '"',
      "",
      "--" + limite,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      cortar76(b64Utf8(m.texto))
    ].filter(function (x) { return x !== null; });
    (m.adjuntos || []).forEach(function (a) {
      partes.push("--" + limite,
        'Content-Type: ' + a.tipo + '; name="' + encabezado(a.nombre) + '"',
        'Content-Disposition: attachment; filename="' + encabezado(a.nombre) + '"',
        "Content-Transfer-Encoding: base64", "", cortar76(a.base64));
    });
    partes.push("--" + limite + "--", "");
    return partes.join("\r\n");
  }
  async function enviarGmail(m, email) {
    var token = await permisoGoogle(email);
    var res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(mimeGmail(m, email)) })
    });
    if (res.ok) return;
    var j = null; try { j = await res.json(); } catch (e) {}
    var motivo = j && j.error ? (j.error.message || "") : "";
    if (res.status === 401) { tokenGoogle = null; throw falla("SIN_PERMISO", motivo); }
    if (res.status === 403 && /has not been used|disabled|accessNotConfigured/i.test(motivo + JSON.stringify(j || {}))) throw falla("GMAIL_NO_HABILITADO", motivo);
    if (res.status === 413) throw falla("DEMASIADO_GRANDE", motivo);
    throw falla("ERROR_ENVIO", motivo);
  }

  // ---------- Microsoft / Outlook ----------
  // Autorización con código + PKCE en una ventana emergente que vuelve a
  // correo-ms.html; esa página deja el resultado en localStorage (no se usa
  // window.opener porque la página de Microsoft puede cortar esa relación).
  var tokenMs = null; // { token, vence }
  function redirectMs() { return new URL("correo-ms.html", location.href).href; }
  async function permisoMicrosoft(email) {
    if (tokenMs && tokenMs.vence > Date.now() + 60000) return tokenMs.token;
    var verificador = aleatorio(48);
    var reto = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador)));
    var state = aleatorio(16);
    try { localStorage.removeItem(MS_RES_KEY); } catch (e) {}
    var q = new URLSearchParams({
      client_id: MS_CLIENT_ID, response_type: "code", redirect_uri: redirectMs(), response_mode: "query",
      scope: "openid email Mail.Send", state: state, code_challenge: reto, code_challenge_method: "S256", login_hint: email
    });
    var ventana = window.open("https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?" + q.toString(), "cimagen_ms_correo", "width=520,height=680");
    if (!ventana) throw falla("POPUP_BLOQUEADO");
    var resultado = await new Promise(function (ok, mal) {
      var t = setInterval(function () {
        var r = null; try { r = JSON.parse(localStorage.getItem(MS_RES_KEY) || "null"); } catch (e) {}
        if (r && r.state === state) { clearInterval(t); try { localStorage.removeItem(MS_RES_KEY); } catch (e) {} ok(r); return; }
        if (ventana.closed) { clearInterval(t); mal(falla("CANCELADO")); }
      }, 400);
    });
    if (resultado.error) throw falla(resultado.error === "access_denied" ? "SIN_PERMISO" : (/AADSTS50011|AADSTS700016|redirect/i.test(resultado.descripcion || "") ? "MS_NO_CONFIGURADO" : "CANCELADO"), resultado.descripcion);
    var res = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: MS_CLIENT_ID, grant_type: "authorization_code", code: resultado.code, redirect_uri: redirectMs(), code_verifier: verificador, scope: "openid email Mail.Send" }).toString()
    }).catch(function () { throw falla("MS_NO_CONFIGURADO"); });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok || !j.access_token) throw falla(/AADSTS9002326|AADSTS9002327|Single-Page/i.test(j.error_description || "") ? "MS_NO_CONFIGURADO" : "SIN_PERMISO", j.error_description);
    var id = payloadJwt(j.id_token || "");
    var cuenta = String(id.email || id.preferred_username || "").toLowerCase();
    if (cuenta !== email) throw falla("OTRA_CUENTA", cuenta);
    tokenMs = { token: j.access_token, vence: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
    return tokenMs.token;
  }
  async function enviarOutlook(m, email) {
    var token = await permisoMicrosoft(email);
    var dirs = function (l) { return l.map(function (d) { return { emailAddress: { address: d } }; }); };
    var res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: m.asunto, body: { contentType: "Text", content: m.texto },
          toRecipients: dirs(m.para), ccRecipients: dirs(m.cc),
          attachments: (m.adjuntos || []).map(function (a) { return { "@odata.type": "#microsoft.graph.fileAttachment", name: a.nombre, contentType: a.tipo, contentBytes: a.base64 }; })
        },
        saveToSentItems: true
      })
    });
    if (res.status === 202 || res.ok) return;
    var j = null; try { j = await res.json(); } catch (e) {}
    if (res.status === 401 || res.status === 403) { tokenMs = null; throw falla("SIN_PERMISO", j && j.error && j.error.message); }
    if (res.status === 413) throw falla("DEMASIADO_GRANDE");
    throw falla("ERROR_ENVIO", j && j.error && j.error.message);
  }

  // ---------- API pública ----------
  var RE_CORREO = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
  window.CorreoSesion = {
    MENSAJES: MENSAJES,
    proveedor: function () { return proveedor(sesion()); },
    correoSesion: function () { var s = sesion(); return s && s.email ? String(s.email).toLowerCase() : ""; },
    // Separa una lista escrita a mano ("a@b.cl, c@d.cl; e@f.cl"); devuelve { validos, invalidos }.
    separar: function (texto) {
      var l = String(texto || "").split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
      return { validos: l.filter(function (x) { return RE_CORREO.test(x); }), invalidos: l.filter(function (x) { return !RE_CORREO.test(x); }) };
    },
    // Pide (o reutiliza) el permiso de envío. Llamarla apenas se hace clic:
    // los navegadores bloquean la ventana de autorización si se abre después
    // de un trabajo largo (como generar el PDF).
    autorizar: async function () {
      var s = sesion();
      var email = s && s.email ? String(s.email).toLowerCase() : "";
      if (!email) throw falla("SIN_SESION");
      var p = proveedor(s);
      if (p === "Google") return permisoGoogle(email);
      if (p === "Microsoft") return permisoMicrosoft(email);
      throw falla("PROVEEDOR_DESCONOCIDO");
    },
    enviar: async function (m) {
      var s = sesion();
      var email = s && s.email ? String(s.email).toLowerCase() : "";
      if (!email) throw falla("SIN_SESION");
      var mensaje = { para: m.para || [], cc: m.cc || [], asunto: m.asunto || "", texto: m.texto || "", adjuntos: m.adjuntos || [] };
      var tam = mensaje.adjuntos.reduce(function (t, a) { return t + (a.base64 || "").length; }, 0);
      if (tam > 2.5 * 1024 * 1024) throw falla("DEMASIADO_GRANDE"); // margen bajo el límite de envío de Gmail y Graph
      var p = proveedor(s);
      if (p === "Google") { await enviarGmail(mensaje, email); return { proveedor: p, desde: email }; }
      if (p === "Microsoft") { await enviarOutlook(mensaje, email); return { proveedor: p, desde: email }; }
      throw falla("PROVEEDOR_DESCONOCIDO");
    }
  };
})();
