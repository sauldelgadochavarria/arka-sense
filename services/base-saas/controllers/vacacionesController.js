const getVacacionSaldoModel = require('../models/vacacionSaldo');
const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { recalcularSaldosTenant, calcularAniosServicio, diasVacacionesPorAntiguedad } = require('../services/vacacionesService');

async function listVacaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const anio = Number(req.query.anio) || new Date().getFullYear();

  const VacacionSaldo = await getVacacionSaldoModel();
  const Empleado = await getEmpleadoModel();

  let saldos = empresa
    ? await VacacionSaldo.find({ tenantId: req.session.tenantId, anio }).lean()
    : [];

  if (empresa && !saldos.length) {
    await recalcularSaldosTenant(req.session.tenantId, anio);
    saldos = await VacacionSaldo.find({ tenantId: req.session.tenantId, anio }).lean();
  }

  const empleados = empresa
    ? await Empleado.find({ tenantId: req.session.tenantId, estatus: 'activo' }).lean()
    : [];
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));

  const filas = saldos.map((s) => {
    const empleado = empMap.get(String(s.empleadoId));
    const anios = empleado ? calcularAniosServicio(empleado.fechaIngreso) : 0;
    return { saldo: s, empleado, anios };
  });

  res.render('Incidencias/vacaciones', {
    filas,
    anio,
    empresa,
    diasVacacionesPorAntiguedad,
    error: error || null,
    session: req.session
  });
}

async function recalcularVacaciones(req, res) {
  try {
    const anio = Number(req.body.anio) || new Date().getFullYear();
    await recalcularSaldosTenant(req.session.tenantId, anio);
    req.flash('success', `Saldos de vacaciones ${anio} recalculados`);
    res.redirect(`/incidencias/vacaciones?anio=${anio}`);
  } catch (err) {
    console.error('[vacaciones]', err);
    req.flash('error', 'Error al recalcular vacaciones');
    res.redirect('/incidencias/vacaciones');
  }
}

module.exports = { listVacaciones, recalcularVacaciones };
