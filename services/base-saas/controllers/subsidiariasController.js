const getSubsidiariaModel = require('../models/subsidiaria');
const {
  requireEmpresaForTenant,
  findOneByEmpresa,
  findOneDocByEmpresa
} = require('../libs/tenantScope');
const { trimString, parsePositiveNumber, parseOptionalLegadoCode } = require('../libs/formHelpers');
const { SUBSIDIARY_MODULE_KEYS } = require('../config/subsidiaryModules');
const { tenantLicensesModule } = require('../libs/tenantFeatureFlags');

function parseModuloFlag(body, key) {
  const nested = body.modulos && typeof body.modulos === 'object' ? body.modulos[key] : undefined;
  const raw = nested !== undefined ? nested : body[`modulo_${key}`];
  return raw === 'on' || raw === 'true' || raw === true || raw === '1';
}

function tenantFlagsFromReq(req) {
  return req.session?.tenantFeatureFlags || req.tenant?.featureFlags || {};
}

function modulosFromBody(body) {
  const fromForm =
    body.modulosForm === '1' ||
    body.modulosForm === 'true' ||
    (body.modulos && typeof body.modulos === 'object') ||
    SUBSIDIARY_MODULE_KEYS.some((m) => body[`modulo_${m.key}`] !== undefined);
  const modulos = {};
  for (const m of SUBSIDIARY_MODULE_KEYS) {
    // Alta rápida sin checkboxes → hereda ON; el formulario de edición manda el checkbox.
    modulos[m.key] = fromForm ? parseModuloFlag(body, m.key) : true;
  }
  return modulos;
}

/**
 * Si el tenant no licencia el módulo, no se puede encender desde la sub.
 * Se conserva la preferencia previa (o hereda ON) para que, al reactivar la
 * licencia, la subsidiaria vuelva a su estado anterior. Mientras el tenant
 * esté apagado, el cálculo efectivo y la pantalla lo muestran desactivado.
 */
function preserveModulosWithoutLicense(modulos, tenantFlags, previous) {
  const out = { ...modulos };
  const prev = previous && typeof previous === 'object' ? previous : null;
  for (const m of SUBSIDIARY_MODULE_KEYS) {
    if (tenantLicensesModule(tenantFlags, m)) continue;
    out[m.key] = prev && Object.prototype.hasOwnProperty.call(prev, m.key) ? prev[m.key] === true : true;
  }
  return out;
}

function modulosUi(subsidiaria, tenantFlags) {
  const mods = subsidiaria?.modulos || {};
  return SUBSIDIARY_MODULE_KEYS.map((m) => {
    const tenantOn = tenantLicensesModule(tenantFlags, m);
    const subOn = mods[m.key] !== false;
    return {
      key: m.key,
      label: m.label,
      hint: m.description,
      tenantOn,
      checked: tenantOn && subOn
    };
  });
}

function buildSubsidiariaPayload(body) {
  const lat = body.lat === '' || body.lat === undefined ? undefined : Number(body.lat);
  const lng = body.lng === '' || body.lng === undefined ? undefined : Number(body.lng);

  const exigirRegistroDispositivo =
    body.exigirRegistroDispositivo === 'on' ||
    body.exigirRegistroDispositivo === 'true' ||
    body.exigirRegistroDispositivo === true ||
    body.exigirRegistroDispositivo === '1';

  return {
    nombre: trimString(body.nombre),
    codigo: trimString(body.codigo).toUpperCase(),
    codigoLegado: parseOptionalLegadoCode(body.codigoLegado),
    direccion: trimString(body.direccion),
    ciudad: trimString(body.ciudad),
    estado: trimString(body.estado),
    codigoPostal: trimString(body.codigoPostal),
    lat: Number.isNaN(lat) ? undefined : lat,
    lng: Number.isNaN(lng) ? undefined : lng,
    geocercaRadioMetros: parsePositiveNumber(body.geocercaRadioMetros),
    zonaHoraria: (() => {
      const z = trimString(body.zonaHoraria) || 'America/Mexico_City';
      try {
        Intl.DateTimeFormat(undefined, { timeZone: z });
        return z;
      } catch {
        return 'America/Mexico_City';
      }
    })(),
    seguridadMovil: {
      exigirRegistroDispositivo
    },
    modulos: modulosFromBody(body)
  };
}

async function listSubsidiarias(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Subsidiaria = await getSubsidiariaModel();
  const tenantFlags = tenantFlagsFromReq(req);
  const subsidiarias = empresa
    ? await Subsidiaria.find({ empresaId: empresa._id }).sort({ nombre: 1 }).lean()
    : [];
  for (const s of subsidiarias) s.modulosUi = modulosUi(s, tenantFlags);
  res.render('Configurations/subsidiarias', { subsidiarias, empresa, error: error || null, session: req.session });
}

async function createSubsidiaria(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/config-subsidiarias');
    }

    const Subsidiaria = await getSubsidiariaModel();
    const payload = buildSubsidiariaPayload(req.body);
    payload.modulos = preserveModulosWithoutLicense(payload.modulos, tenantFlagsFromReq(req), null);
    await Subsidiaria.create({
      empresaId: empresa._id,
      ...payload,
      activo: true
    });
    req.flash('success', 'Subsidiaria creada');
    res.redirect('/config-subsidiarias');
  } catch (err) {
    console.error('[subsidiarias]', err);
    req.flash('error', err.code === 11000 ? 'El código de subsidiaria ya existe' : 'Error al crear subsidiaria');
    res.redirect('/config-subsidiarias');
  }
}

async function editSubsidiaria(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const Subsidiaria = await getSubsidiariaModel();
  const subsidiaria = empresa
    ? await findOneByEmpresa(Subsidiaria, empresa._id, req.params.id)
    : null;
  if (!subsidiaria) return res.status(404).send('Subsidiaria no encontrada');

  const tenantFlags = tenantFlagsFromReq(req);
  res.render('Configurations/subsidiaria-edit', {
    subsidiaria,
    empresa,
    modulosUi: modulosUi(subsidiaria, tenantFlags),
    error: error || null,
    session: req.session
  });
}

async function updateSubsidiaria(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req);
    if (error) {
      req.flash('error', error);
      return res.redirect('/config-subsidiarias');
    }

    const Subsidiaria = await getSubsidiariaModel();
    const subsidiaria = await findOneDocByEmpresa(Subsidiaria, empresa._id, req.params.id);
    if (!subsidiaria) return res.status(404).send('Subsidiaria no encontrada');

    const payload = buildSubsidiariaPayload(req.body);
    payload.modulos = preserveModulosWithoutLicense(
      payload.modulos,
      tenantFlagsFromReq(req),
      subsidiaria.modulos
    );
    subsidiaria.nombre = payload.nombre;
    subsidiaria.codigo = payload.codigo;
    subsidiaria.codigoLegado = payload.codigoLegado;
    subsidiaria.direccion = payload.direccion;
    subsidiaria.ciudad = payload.ciudad;
    subsidiaria.estado = payload.estado;
    subsidiaria.codigoPostal = payload.codigoPostal;
    subsidiaria.lat = payload.lat;
    subsidiaria.lng = payload.lng;
    subsidiaria.geocercaRadioMetros = payload.geocercaRadioMetros;
    subsidiaria.zonaHoraria = payload.zonaHoraria;
    subsidiaria.seguridadMovil = payload.seguridadMovil;
    subsidiaria.modulos = payload.modulos;
    subsidiaria.markModified('seguridadMovil');
    subsidiaria.markModified('modulos');
    await subsidiaria.save();

    req.flash('success', 'Subsidiaria actualizada');
    res.redirect('/config-subsidiarias');
  } catch (err) {
    console.error('[subsidiarias]', err);
    req.flash('error', err.code === 11000 ? 'El código de subsidiaria ya existe' : 'Error al actualizar');
    res.redirect(`/config-subsidiarias/${req.params.id}/edit`);
  }
}

async function toggleSubsidiaria(req, res) {
  const { empresa } = await requireEmpresaForTenant(req);
  if (!empresa) return res.status(400).send('Empresa no encontrada');

  const Subsidiaria = await getSubsidiariaModel();
  const subsidiaria = await findOneDocByEmpresa(Subsidiaria, empresa._id, req.params.id);
  if (!subsidiaria) return res.status(404).send('Subsidiaria no encontrada');

  subsidiaria.activo = !subsidiaria.activo;
  await subsidiaria.save();
  req.flash('success', subsidiaria.activo ? 'Subsidiaria activada' : 'Subsidiaria desactivada');
  res.redirect('/config-subsidiarias');
}

module.exports = {
  listSubsidiarias,
  createSubsidiaria,
  editSubsidiaria,
  updateSubsidiaria,
  toggleSubsidiaria
};
