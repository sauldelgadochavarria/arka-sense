'use strict';

const getDiaInhabilModel = require('../models/diaInhabil');
const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { trimString, parseDate, toDateInputValue } = require('../libs/formHelpers');
const { startOfDay } = require('../libs/timeHelpers');

async function listDiasInhabiles(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const anio = Number(req.query.anio) || new Date().getFullYear();
  const DiaInhabil = await getDiaInhabilModel();
  const desde = new Date(anio, 0, 1);
  const hasta = new Date(anio, 11, 31, 23, 59, 59);
  const subId = sessionSubsidiariaId(req);

  const rows = empresa
    ? await DiaInhabil.find({
        tenantId: req.session.tenantId,
        fecha: { $gte: desde, $lte: hasta },
        $or: [
          { empresaId: empresa._id },
          { empresaId: null },
          ...(subId ? [{ subsidiariaId: subId }] : [])
        ]
      })
        .sort({ fecha: 1 })
        .lean()
    : [];

  res.render('Incidencias/dias-inhabiles', {
    rows,
    anio,
    empresa,
    error: error || null,
    toDateInputValue,
    session: req.session
  });
}

async function createDiaInhabil(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error || !empresa) {
      req.flash('error', error || 'Empresa requerida');
      return res.redirect('/incidencias/dias-inhabiles');
    }
    const fecha = parseDate(req.body.fecha);
    if (!fecha) {
      req.flash('error', 'Fecha requerida');
      return res.redirect('/incidencias/dias-inhabiles');
    }
    const DiaInhabil = await getDiaInhabilModel();
    const soloSub =
      req.body.soloSubsidiaria === 'on' ||
      req.body.soloSubsidiaria === 'true' ||
      req.body.soloSubsidiaria === true;
    const subId = sessionSubsidiariaId(req);
    await DiaInhabil.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: soloSub && subId ? subId : null,
      fecha: startOfDay(fecha),
      nombre: trimString(req.body.nombre) || 'Día inhábil',
      tipo: soloSub ? 'subsidiaria' : 'empresa',
      activo: true
    });
    req.flash('success', 'Día inhábil registrado');
    res.redirect(`/incidencias/dias-inhabiles?anio=${fecha.getFullYear()}`);
  } catch (err) {
    console.error('[dias-inhabiles]', err);
    req.flash('error', 'No se pudo guardar');
    res.redirect('/incidencias/dias-inhabiles');
  }
}

async function deleteDiaInhabil(req, res) {
  try {
    const DiaInhabil = await getDiaInhabilModel();
    await DiaInhabil.deleteOne({ _id: req.params.id, tenantId: req.session.tenantId });
    req.flash('success', 'Día inhábil eliminado');
  } catch (err) {
    req.flash('error', 'No se pudo eliminar');
  }
  res.redirect('/incidencias/dias-inhabiles');
}

module.exports = { listDiasInhabiles, createDiaInhabil, deleteDiaInhabil };
