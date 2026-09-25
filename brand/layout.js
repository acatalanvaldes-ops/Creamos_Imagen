(function () {
  function arrangeHeader() {
    var header = document.querySelector('.topbar,.header');
    if (!header) return;
    var links = Array.from(document.querySelectorAll('a[href="index.html"]'));
    var back = links.find(function (a) { return /men[uú]|volver/i.test(a.textContent || ''); });
    if (header.dataset.brandLayout === 'ready') return;
    if (!back) { back=document.createElement('a'); back.href='index.html'; }

    var keepSelects = Array.from(header.querySelectorAll('.brand select,.topbar-brand select,.header-left h1 select'));
    var lockup = document.createElement('div');
    lockup.className = 'brand-lockup';
    back.className = 'brand-menu';
    back.removeAttribute('style');
    back.removeAttribute('onmouseover');
    back.removeAttribute('onmouseout');
    back.textContent = '← Volver al menú';
    lockup.appendChild(back);
    var logo = document.createElement('img');
    logo.src = 'brand/logo-horizontal-white.svg';
    logo.alt = 'Creamos Imagen';
    lockup.appendChild(logo);

    var old = header.querySelector('.brand-lockup');
    if (old) old.remove();
    header.insertBefore(lockup, header.firstChild);
    keepSelects.forEach(function (select) { header.appendChild(select); });
    header.querySelectorAll('.brand,.topbar-brand,.access-brand-logo,.brand-tag,.brand-name').forEach(function (el) { el.remove(); });
    if (header.classList.contains('header')) {
      header.querySelectorAll('.header-left>h1,.header-left>p').forEach(function (el) { el.remove(); });
    }
    header.dataset.brandLayout = 'ready';
  }

  function start() {
    arrangeHeader();
    new MutationObserver(function () { arrangeHeader(); }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
