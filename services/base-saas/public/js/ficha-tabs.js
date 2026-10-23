(function () {
  if (window.__fichaTabsBound) return;
  window.__fichaTabsBound = true;

  var invalidLock = false;

  function storageKey(root) {
    return 'ficha-tab:' + (root.getAttribute('data-ficha-key') || location.pathname);
  }

  function findByAttr(root, attr, name) {
    var nodes = root.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute(attr) === name) return nodes[i];
    }
    return null;
  }

  function syncEditLinks(name) {
    var links = document.querySelectorAll('a[data-ficha-edit]');
    for (var i = 0; i < links.length; i++) {
      var base = (links[i].getAttribute('href') || '').split('#')[0];
      links[i].setAttribute('href', base + '#' + name);
    }
  }

  function activate(root, name, opts) {
    if (!root || !name) return false;
    opts = opts || {};
    var tabs = root.querySelectorAll('[data-ficha-tab]');
    var panels = root.querySelectorAll('[data-ficha-panel]');
    var found = false;
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-ficha-tab') === name;
      if (on) found = true;
      tabs[i].classList.toggle('is-active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
      tabs[i].tabIndex = on ? 0 : -1;
    }
    if (!found) return false;
    for (var j = 0; j < panels.length; j++) {
      var show = panels[j].getAttribute('data-ficha-panel') === name;
      panels[j].classList.toggle('is-active', show);
    }
    if (opts.updateHash && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search + '#' + name);
    }
    if (opts.remember !== false) {
      try { sessionStorage.setItem(storageKey(root), name); } catch (e) { /* privado */ }
    }
    syncEditLinks(name);
    return true;
  }

  function clearInvalidIfFixed(panel) {
    if (!panel || panel.querySelector(':invalid')) return;
    var root = panel.closest('[data-ficha-tabs]');
    if (!root) return;
    var tab = findByAttr(root, 'data-ficha-tab', panel.getAttribute('data-ficha-panel'));
    if (tab) tab.classList.remove('has-invalid');
  }

  document.addEventListener('click', function (e) {
    var tab = e.target.closest ? e.target.closest('[data-ficha-tab]') : null;
    if (!tab) return;
    var root = tab.closest('[data-ficha-tabs]');
    if (!root) return;
    e.preventDefault();
    activate(root, tab.getAttribute('data-ficha-tab'), { updateHash: true });
  });

  document.addEventListener('keydown', function (e) {
    var tab = e.target.closest ? e.target.closest('[data-ficha-tab]') : null;
    if (!tab) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    var root = tab.closest('[data-ficha-tabs]');
    if (!root) return;
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-ficha-tab]'));
    var i = tabs.indexOf(tab);
    if (i < 0) return;
    if (e.key === 'ArrowRight') i = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') i = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') i = 0;
    else i = tabs.length - 1;
    e.preventDefault();
    activate(root, tabs[i].getAttribute('data-ficha-tab'), { updateHash: true });
    tabs[i].focus();
  });

  document.addEventListener('invalid', function (e) {
    var panel = e.target.closest ? e.target.closest('[data-ficha-panel]') : null;
    if (!panel || panel.classList.contains('is-active')) return;
    if (invalidLock) return;
    var root = panel.closest('[data-ficha-tabs]');
    if (!root) return;
    invalidLock = true;
    var name = panel.getAttribute('data-ficha-panel');
    activate(root, name, { updateHash: true });
    var tab = findByAttr(root, 'data-ficha-tab', name);
    if (tab) tab.classList.add('has-invalid');
    var field = e.target;
    setTimeout(function () {
      invalidLock = false;
      if (typeof field.reportValidity === 'function') field.reportValidity();
    }, 0);
  }, true);

  document.addEventListener('input', function (e) {
    var panel = e.target.closest ? e.target.closest('[data-ficha-panel]') : null;
    clearInvalidIfFixed(panel);
  });

  document.addEventListener('change', function (e) {
    var panel = e.target.closest ? e.target.closest('[data-ficha-panel]') : null;
    clearInvalidIfFixed(panel);
  });

  function boot(root) {
    var name = '';
    var hash = (location.hash || '').replace(/^#/, '');
    if (hash && findByAttr(root, 'data-ficha-panel', hash)) name = hash;
    if (!name) {
      try { name = sessionStorage.getItem(storageKey(root)) || ''; } catch (e) { name = ''; }
    }
    if (!name || !findByAttr(root, 'data-ficha-tab', name)) {
      var first = root.querySelector('[data-ficha-tab]');
      name = first ? first.getAttribute('data-ficha-tab') : '';
    }
    if (name) activate(root, name, { remember: false, updateHash: false });
  }

  function bootAll() {
    var roots = document.querySelectorAll('[data-ficha-tabs]');
    for (var i = 0; i < roots.length; i++) boot(roots[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootAll);
  else bootAll();
})();
