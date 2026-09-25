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
//    fallando en silencio (varias páginas no revisan el resultado al guardar).
(function () {
  var SESSION_KEY = 'cimagen_session';
  var SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  var API_PREFIX = 'https://script.google.com/';

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

  var fetchOriginal = window.fetch;
  if (typeof fetchOriginal !== 'function') return;
  window.fetch = function (url, opts) {
    return fetchOriginal.apply(this, arguments).then(function (res) {
      if (String(url).indexOf(API_PREFIX) === 0 && res && typeof res.clone === 'function') {
        res.clone().json().then(function (j) {
          if (j && j.estado === 'error' && (j.detalle === 'SESION_EXPIRADA' || j.detalle === 'NO_AUTORIZADO')) sesionVencida();
        }).catch(function () {});
      }
      return res;
    });
  };
})();
