const getVacacionSaldoModel = require('../models/vacacionSaldo');
const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant, scopeEmpleadosFromReq } = require('../libs/tenantScope');
const { recalcularSaldosTenant, calcularAniosServicio, diasVacacionesPorAntiguedad } = require('../services/vacacionesService');

async function empleadosDelAlcance(req, empresa) {
  if (!empresa) return [];
  const Empleado = await getEmpleadoModel();
  const empQ = scopeEmpleadosFromReq(req, empresa, { soloActivos: true });
  if (!empQ) return [];
  return Empleado.find(empQ).lean();
}

async function listVacaciones(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const anio = Number(req.query.anio) || new Date().getFullYear();

  const VacacionSaldo = await getVacacionSaldoModel();
  const empleados = await empleadosDelAlcance(req, empresa);
  const empIds = empleados.map((e) => e._id);

  let saldos = empIds.length
    ? await VacacionSaldo.find({
        tenantId: req.session.tenantId,
        anio,
        empleadoId: { $in: empIds }
      }).lean()
    : [];

  if (empresa && empIds.length && !saldos.length) {
    await recalcularSaldosTenant(req.session.tenantId, anio, empIds);
    saldos = await VacacionSaldo.find({
      tenantId: req.session.tenantId,
      anio,
      empleadoId: { $in: empIds }
    }).lean();
  }

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
    const { empresa } = await requireEmpresaForTenant(req);
    const anio = Number(req.body.anio) || new Date().getFullYear();
    const empleados = await empleadosDelAlcance(req, empresa);
    await recalcularSaldosTenant(
      req.session.tenantId,
      anio,
      empleados.map((e) => e._id)
    );
    req.flash('success', `Saldos de vacaciones ${anio} recalculados`);
    res.redirect(`/incidencias/vacaciones?anio=${anio}`);
  } catch (err) {
    console.error('[vacaciones]', err);
    req.flash('error', 'Error al recalcular vacaciones');
    res.redirect('/incidencias/vacaciones');
  }
}

module.exports = { listVacaciones, recalcularVacaciones };
