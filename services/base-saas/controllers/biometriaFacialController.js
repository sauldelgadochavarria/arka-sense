'use strict';

const getEmpleadoModel = require('../models/empleado');
const { findOneByTenant } = require('../libs/tenantScope');
const {
  enrollFromImage,
  clearEnrollment
} = require('../services/biometrics/biometricsService');
const { getStatus, ensureReady } = require('../services/biometrics/faceApiService');

async function showBiometria(req, res) {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) {
      req.flash('error', 'Empleado no encontrado');
      return res.redirect('/personal-empleados');
    }
    const bio = empleado.biometriaFacial || {};
    let engine = getStatus();
    try {
      await ensureReady();
      engine = getStatus();
    } catch (err) {
      engine = { ready: false, lastError: err.message };
    }

    res.render('Personal/empleado-biometria', {
      title: `Biometría · ${empleado.firstName} ${empleado.lastName}`,
      empleado,
      bio: {
        enrolled: Boolean(bio.enrolled && bio.embedding?.length),
        enrolledAt: bio.enrolledAt,
        modelVersion: bio.modelVersion,
        detectionScore: bio.detectionScore,
        distanceThreshold: bio.distanceThreshold
      },
      engine
    });
  } catch (err) {
    console.error('[biometriaFacial.show]', err);
    req.flash('error', err.message || 'Error al cargar biometría');
    res.redirect(`/personal-empleados/${req.params.id}`);
  }
}

async function enrollAction(req, res) {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) {
      return res.status(404).json({ ok: false, error: 'Empleado no encontrado' });
    }
    const file = req.file;
    if (!file?.buffer?.length) {
      return res.status(400).json({ ok: false, error: 'Envía una imagen (campo "rostro")' });
    }

    const result = await enrollFromImage({
      tenantId: String(empleado.tenantId),
      empleadoId: String(empleado._id),
      imageBuffer: file.buffer,
      enrolledBy: req.session?.user?.email || req.session?.user?.id || null
    });

    if (!result.success) {
      return res.status(422).json({ ok: false, error: result.message });
    }
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[biometriaFacial.enroll]', err);
    return res.status(500).json({ ok: false, error: err.message || 'Error al enrollar' });
  }
}

async function clearAction(req, res) {
  try {
    const Empleado = await getEmpleadoModel();
    const empleado = await findOneByTenant(Empleado, req.session.tenantId, req.params.id);
    if (!empleado) {
      req.flash('error', 'Empleado no encontrado');
      return res.redirect('/personal-empleados');
    }
    await clearEnrollment({
      tenantId: String(empleado.tenantId),
      empleadoId: String(empleado._id)
    });
    req.flash('success', 'Plantilla facial eliminada.');
    res.redirect(`/personal-empleados/${empleado._id}/biometria-facial`);
  } catch (err) {
    console.error('[biometriaFacial.clear]', err);
    req.flash('error', err.message || 'No se pudo eliminar');
    res.redirect(`/personal-empleados/${req.params.id}/biometria-facial`);
  }
}

module.exports = {
  showBiometria,
  enrollAction,
  clearAction
};
