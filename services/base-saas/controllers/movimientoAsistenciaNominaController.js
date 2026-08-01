'use strict';

const getEmpleadoModel = require('../models/empleado');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { trimString, parseDate, parsePositiveNumber } = require('../libs/formHelpers');
const {
  listMovimientos,
  registrarMovimiento
} = require('../services/movimientoAsistenciaNominaService');

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Empleado = await getEmpleadoModel();
  const [movimientos, empleados] = await Promise.all([
    empresa ? listMovimientos(req.session.tenantId, 300) : [],
    empresa ? Empleado.find({ tenantId: req.session.tenantId }).sort({ lastName: 1 }).lean() : []
  ]);

  const empMap = new Map(empleados.map((e) => [String(e._id), e]));

  res.render('Prenomina/movimientos-asistencia', {
    movimientos,
    empleados,
    empMap,
    empresa,
    error: error || null,
    session: req.session
  });
}

async function create(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error) {
      req.flash('error', error);
      return res.redirect('/prenomina/movimientos');
    }

    const empleadoId = trimString(req.body.empleadoId) || null;
    let claTrab = trimString(req.body.claTrab);
    if (empleadoId && !claTrab) {
      const Empleado = await getEmpleadoModel();
      const emp = await Empleado.findOne({ _id: empleadoId, tenantId: req.session.tenantId }).lean();
      claTrab = emp?.codigoExterno || emp?.numEmpleado || '';
    }

    await registrarMovimiento(req.session.tenantId, empresa._id, {
      empleadoId,
      conceptoClave: trimString(req.body.conceptoClave),
      tipoMovimiento: trimString(req.body.tipoMovimiento),
      monto: parsePositiveNumber(req.body.monto) ?? 0,
      fechaMovimiento: parseDate(req.body.fechaMovimiento) || new Date(),
      referencia: trimString(req.body.referencia),
      claTrab,
      claPerded: trimString(req.body.conceptoClave),
      origenMovimiento: 'manual'
    });

    req.flash('success', 'Movimiento registrado');
  } catch (err) {
    req.flash('error', err.message || 'Error al registrar movimiento');
  }
  res.redirect('/prenomina/movimientos');
}

module.exports = { list, create };
