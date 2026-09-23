// Indicador "Cargando datos…" compartido por todos los módulos.
//
// Se incluye al inicio del <body>. Se muestra de inmediato (antes de que la
// página empiece a pedir datos a la nube) y tapa la pantalla hasta que el
// módulo llama a ocultarCargando(). Además de avisar que algo está pasando,
// evita que alguien edite datos antes de que termine la carga desde la nube:
// esos cambios podían quedar pisados por los datos que llegaban después.
//
// Con <script src="cargando.js" data-auto="no"> no se muestra solo; se usa
// mostrarCargando(texto) cuando haga falta.
(function () {
  var script = document.currentScript;
  var auto = !script || script.getAttribute('data-auto') !== 'no';

  var css =
    '#ci-cargando{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(20,18,15,.45);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);transition:opacity .2s}' +
    '#ci-cargando.oculto{opacity:0;pointer-events:none}' +
    '#ci-cargando .ci-caja{background:#fff;color:#1e1b16;border-radius:12px;padding:22px 28px;display:flex;align-items:center;gap:14px;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;font-weight:600;max-width:calc(100vw - 32px)}' +
    '#ci-cargando .ci-spin{width:26px;height:26px;flex:none;border-radius:50%;border:3px solid #ddd9d0;border-top-color:#2c5f2e;animation:ci-giro .8s linear infinite}' +
    '#ci-cargando .ci-sub{display:block;font-size:12px;font-weight:400;color:#8a8374;margin-top:3px}' +
    '@keyframes ci-giro{to{transform:rotate(360deg)}}';

  var overlay = null;
  var inicio = 0;
  var timerSub = null;

  function crear() {
    if (overlay) return overlay;
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    overlay = document.createElement('div');
    overlay.id = 'ci-cargando';
    overlay.innerHTML = '<div class="ci-caja"><div class="ci-spin"></div><div><span class="ci-txt"></span><span class="ci-sub"></span></div></div>';
    (document.body || document.documentElement).appendChild(overlay);
    return overlay;
  }

  window.mostrarCargando = function (texto) {
    crear();
    overlay.querySelector('.ci-txt').textContent = texto || 'Cargando datos…';
    overlay.querySelector('.ci-sub').textContent = '';
    overlay.classList.remove('oculto');
    overlay.style.display = 'flex';
    inicio = Date.now();
    clearInterval(timerSub);
    // Si la nube demora, se avisa que sigue trabajando para que no parezca colgado.
    timerSub = setInterval(function () {
      var seg = Math.round((Date.now() - inicio) / 1000);
      if (seg >= 8) overlay.querySelector('.ci-sub').textContent = 'La conexión está lenta, sigue cargando… (' + seg + ' s)';
    }, 1000);
  };

  window.ocultarCargando = function () {
    clearInterval(timerSub);
    if (!overlay) return;
    overlay.classList.add('oculto');
    setTimeout(function () { if (overlay.classList.contains('oculto')) overlay.style.display = 'none'; }, 200);
  };

  if (auto) window.mostrarCargando();
})();
