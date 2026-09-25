(function () {
  function movePlaceholder(input) {
    if (!input || !input.hasAttribute('placeholder')) return;
    var hint = input.getAttribute('placeholder');
    if (!hint || !hint.trim()) return;
    input.removeAttribute('placeholder');
    var wrap = input.closest('.fld,.form-group,.field,.fg') || input.parentElement;
    if (!wrap || wrap.querySelector('.brand-field-example')) return;
    var example = document.createElement('small');
    example.className = 'brand-field-example';
    example.textContent = 'Ejemplo: ' + hint.trim();
    wrap.appendChild(example);
  }
  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[placeholder],textarea[placeholder]')) movePlaceholder(root);
    root.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(movePlaceholder);
  }
  function start() {
    scan(document);
    new MutationObserver(function (changes) {
      changes.forEach(function (change) {
        change.addedNodes.forEach(function (node) { if (node.nodeType === 1) scan(node); });
        if (change.type === 'attributes') scan(change.target);
      });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['placeholder'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
