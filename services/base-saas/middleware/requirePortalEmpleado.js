const { loadEmpleadoFromSession } = require('../libs/portalSession');
const { isSoloPortalUser } = require('../libs/roleAccess');

async function requirePortalEmpleado(req, res, next) {
  const empleado = await loadEmpleadoFromSession(req);
  if (!empleado) {
    if (isSoloPortalUser(req.session)) {
      return res.render('Portal/sin-vinculo', { session: req.session });
    }
    req.flash('error', 'Tu usuario no está vinculado a un empleado activo. Contacta a RRHH.');
    return res.redirect('/dashboard');
  }
  req.empleado = empleado;
  res.locals.empleado = empleado;
  next();
}

module.exports = { requirePortalEmpleado };
