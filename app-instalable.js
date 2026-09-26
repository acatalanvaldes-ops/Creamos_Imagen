// Mi Portal como app instalable (PWA).
//
// - Registra sw.js (solo muestra offline.html si no hay internet; no cachea datos).
// - Android / Chrome / Edge: guarda el aviso de instalación del navegador y
//   muestra el botón #btn-instalar; al tocarlo abre el diálogo "Instalar".
// - iPhone / iPad (Safari): no existe ese aviso, así que el botón explica
//   los pasos de "Compartir > Agregar a pantalla de inicio".
// - Dentro de la app ya instalada el botón no aparece.
(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function (e) { console.warn("No se pudo registrar el service worker", e); });
    });
  }

  var instalada = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  var esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var aviso = null;

  function boton() { return document.getElementById("btn-instalar"); }
  function mostrar() { var b = boton(); if (b && !instalada) b.style.display = ""; }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    aviso = e;
    mostrar();
  });
  window.addEventListener("appinstalled", function () {
    aviso = null;
    var b = boton(); if (b) b.style.display = "none";
  });

  function pasosIOS() {
    if (document.getElementById("ayuda-instalar")) return;
    var fondo = document.createElement("div");
    fondo.id = "ayuda-instalar";
    fondo.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px";
    fondo.innerHTML =
      '<div style="background:#fff;color:#1C1917;border-radius:16px;max-width:380px;width:100%;padding:22px 20px;font-size:14px;line-height:1.55">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><img src="/brand/app-icon-180.png" alt="" style="width:44px;height:44px;border-radius:10px"><b style="font-size:16px">Instalar Mi Portal</b></div>' +
        '<ol style="padding-left:20px;margin:0 0 16px">' +
          '<li>Abre esta página en <b>Safari</b>.</li>' +
          '<li>Toca el botón <b>Compartir</b> <span style="display:inline-block;border:1.5px solid #1C1917;border-radius:4px;padding:0 5px;font-size:12px">⬆</span> en la barra de abajo.</li>' +
          '<li>Elige <b>Agregar a pantalla de inicio</b> y luego <b>Agregar</b>.</li>' +
        '</ol>' +
        '<div style="font-size:12px;color:#78716C;margin-bottom:16px">La app se abre desde el ícono como cualquier otra. La primera vez tendrás que iniciar sesión dentro de ella.</div>' +
        '<button type="button" style="width:100%;background:#141414;color:#fff;border:0;border-radius:10px;padding:12px;font-weight:700;font-size:14px">Entendido</button>' +
      '</div>';
    fondo.addEventListener("click", function (e) { if (e.target === fondo || e.target.tagName === "BUTTON") fondo.remove(); });
    document.body.appendChild(fondo);
  }

  window.instalarApp = function () {
    if (aviso) {
      aviso.prompt();
      aviso.userChoice.finally(function () { aviso = null; var b = boton(); if (b) b.style.display = "none"; });
    } else if (esIOS) {
      pasosIOS();
    }
  };

  // En iPhone el botón se muestra siempre fuera de la app (no hay aviso del navegador).
  document.addEventListener("DOMContentLoaded", function () { if (esIOS) mostrar(); });
})();
