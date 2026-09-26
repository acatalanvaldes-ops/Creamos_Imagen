// Sesión compartida por todas las páginas.
//
// Al iniciar sesión en el menú (index.html), el servidor verifica la cuenta
// de Google y entrega una sesión firmada ("token") que vence en 24 horas.
// Cada página la envía en sus peticiones (CLOUD_TOKEN = tokenSesion()), y el
// servidor decide con ella qué datos puede leer o guardar esa persona.
//
// Este archivo además:
//  - manda al menú a iniciar sesión si no hay sesión con token (por ejemplo,
//    una sesión abierta antes de este cambio);
//  - vigila las respuestas del servidor: si dice que la sesión venció o no
//    es válida, avisa una vez y vuelve al menú, en vez de dejar la página
//    fallando en silencio (varias páginas no revisan el resultado al guardar);
//  - lleva la versión de cada llave para que un guardado no pise cambios de
//    otra persona (ver VERSIONES más abajo).
(function () {
  var SESSION_KEY = 'cimagen_session';
  var SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  var API_PREFIX = '/api/portal';

  function leer() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; } }
  function borrar() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  var sess = leer();
  var valida = !!(sess && sess.email && sess.token && sess.ts && (Date.now() - sess.ts < SESSION_TTL_MS));

  window.tokenSesion = function () { return valida ? sess.token : ''; };

  var esMenu = /(^|\/)(index\.html)?$/i.test(location.pathname);
  if (!valida && !esMenu) {
    borrar();
    location.replace('index.html');
    return;
  }

  var avisado = false;
  function sesionVencida() {
    if (avisado) return;
    avisado = true;
    borrar();
    alert('Tu sesión expiró o ya no es válida. Vuelve a iniciar sesión.');
    location.href = 'index.html';
  }

  // VERSIONES: evita que un guardado pise los cambios de otra persona.
  // Al leer una llave, el servidor manda su versión; aquí se recuerda y se
  // agrega sola al guardar esa llave. Si alguien guardó entremedio, el
  // servidor responde CONFLICTO y se avisa (una vez por llave) que hay que
  // recargar. Los guardados de una misma llave salen de a uno, con la versión
  // que dejó el anterior, para que la página no choque consigo misma.
  var versiones = {};
  var colas = {};
  var avisadoConflicto = {};
  function conflicto(key) {
    if (avisadoConflicto[key]) return;
    avisadoConflicto[key] = true;
    alert('No se guardó tu último cambio: otra persona (o esta misma página abierta en otra pestaña) modificó estos datos después de que abriste la página.\n\nRecarga la página (F5) para ver la versión actual y vuelve a hacer tu cambio.');
  }
  function esApi(url) { return String(url).indexOf(API_PREFIX) === 0 || String(url).indexOf(location.origin + API_PREFIX) === 0; }
  function llaveDeGet(url) {
    try { var u = new URL(String(url), location.href); return u.searchParams.get('accion') ? null : u.searchParams.get('key'); } catch (e) { return null; }
  }

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal !== 'function') return;
  function revisar(url, res, key) {
    if (!esApi(url) || !res || typeof res.clone !== 'function') return Promise.resolve();
    return res.clone().json().then(function (j) {
      if (!j) return;
      if (j.estado === 'error' && (j.detalle === 'SESION_EXPIRADA' || j.detalle === 'NO_AUTORIZADO')) sesionVencida();
      if (key && j.version !== undefined && j.estado !== 'error') versiones[key] = String(j.version);
      if (key && j.detalle === 'CONFLICTO') conflicto(key);
    }).catch(function () {});
  }
  window.fetch = function (url, opts) {
    var metodo = ((opts && opts.method) || 'GET').toUpperCase();
    if (esApi(url) && metodo === 'POST' && opts && typeof opts.body === 'string') {
      var cuerpo = null;
      try { cuerpo = JSON.parse(opts.body); } catch (e) {}
      if (cuerpo && cuerpo.key && !cuerpo.accion && !cuerpo.action) {
        var key = cuerpo.key, self = this;
        var previo = colas[key] || Promise.resolve();
        var envio = previo.catch(function () {}).then(function () {
          if (cuerpo.version === undefined && versiones[key] !== undefined) cuerpo.version = versiones[key];
          var o = Object.assign({}, opts, { body: JSON.stringify(cuerpo) });
          return fetchOriginal.call(self, url, o).then(function (res) {
            // La versión nueva se registra antes de liberar la cola.
            return res.clone().json().then(function (j) {
              if (j && j.estado !== 'error' && j.version !== undefined) versiones[key] = String(j.version);
              if (j && j.detalle === 'CONFLICTO') conflicto(key);
              if (j && j.estado === 'error' && (j.detalle === 'SESION_EXPIRADA' || j.detalle === 'NO_AUTORIZADO')) sesionVencida();
            }).catch(function () {}).then(function () { return res; });
          });
        });
        colas[key] = envio;
        return envio;
      }
    }
    var keyGet = metodo === 'GET' && esApi(url) ? llaveDeGet(url) : null;
    return fetchOriginal.apply(this, arguments).then(function (res) {
      // Con llave se espera a registrar la versión antes de entregar la respuesta.
      if (keyGet) return revisar(url, res, keyGet).then(function () { return res; });
      revisar(url, res, null);
      return res;
    });
  };
})();
