(function () {
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.nav-toggle');
  var year = document.getElementById('y');
  if (year) year.textContent = String(new Date().getFullYear());

  if (toggle && header) {
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    header.querySelectorAll('.nav a, .header-cta a').forEach(function (a) {
      a.addEventListener('click', function () {
        header.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  document.querySelectorAll('.download-card').forEach(function (card) {
    card.addEventListener('click', function (ev) {
      // Si el binario aún no está publicado, avisa sin romper la UX.
      var href = card.getAttribute('href') || '';
      if (!href || href === '#') {
        ev.preventDefault();
        alert('El instalador estará disponible pronto. Contáctanos para acceso anticipado.');
      }
    });
  });
})();
