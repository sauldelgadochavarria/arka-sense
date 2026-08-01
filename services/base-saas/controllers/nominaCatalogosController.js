'use strict';

const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { trimString, parseDate } = require('../libs/formHelpers');
const {
  CATALOGOS_SAT,
  TIPOS_MAPEO_LEGADO,
  PARAMETROS_FISCALES_PERMITIDOS,
  TIPOS_HORA_EXTRA_MOTOR,
  CODIGOS_TABLA_FISCAL,
  PERIODICIDADES_TABLA
} = require('../config/nominaCatalogos');
const {
  listCatalogoSatTodos,
  crearCatalogoSat,
  toggleCatalogoSat,
  listMapeosLegado,
  crearMapeoLegado,
  toggleMapeoLegado,
  listParametrosFiscales,
  crearParametroFiscal,
  listTablasFiscales,
  getTablaFiscalConRangos,
  crearTablaFiscal,
  toggleTablaFiscal,
  crearRangoFiscal,
  eliminarRangoFiscal,
  copiarTablaNuevaVigencia
} = require('../services/nomina/catalogosNominaService');

function featureFlagsFromReq(req) {
  return req.tenant?.featureFlags || req.session?.featureFlags || {};
}

function requireNominaFeature(req, res) {
  if (tenantHasFeature(featureFlagsFromReq(req), 'nomina')) return null;
  req.flash('error', 'El módulo de Nómina no está habilitado para este tenant.');
  res.redirect('/dashboard');
  return false;
}

function catalogoLabel(value) {
  return CATALOGOS_SAT.find((c) => c.value === value)?.label || value;
}

function tipoMapeoLabel(value) {
  return TIPOS_MAPEO_LEGADO.find((t) => t.value === value)?.label || value;
}

async function index(req, res) {
  if (requireNominaFeature(req, res) === false) return;

  const [sat, mapeos, parametros, tablas] = await Promise.all([
    listCatalogoSatTodos(),
    listMapeosLegado('fortia'),
    listParametrosFiscales(),
    listTablasFiscales()
  ]);

  res.render('Nomina/catalogos/index', {
    satActivos: sat.filter((s) => s.activo).length,
    mapeosActivos: mapeos.filter((m) => m.activo).length,
    parametrosCount: parametros.length,
    tablasActivas: tablas.filter((t) => t.activo).length,
    session: req.session
  });
}

async function catalogoSat(req, res) {
  if (requireNominaFeature(req, res) === false) return;

  const filtro = trimString(req.query.catalogo) || '';
  const entradas = await listCatalogoSatTodos();
  const filtradas = filtro ? entradas.filter((e) => e.catalogo === filtro) : entradas;

  res.render('Nomina/catalogos/sat', {
    entradas: filtradas,
    filtroCatalogo: filtro,
    catalogosSat: CATALOGOS_SAT,
    catalogoLabel,
    session: req.session
  });
}

async function createCatalogoSat(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    await crearCatalogoSat({
      catalogo: trimString(req.body.catalogo),
      clave: trimString(req.body.clave),
      descripcion: trimString(req.body.descripcion),
      vigenciaDesde: parseDate(req.body.vigenciaDesde) || new Date()
    });
    req.flash('success', 'Clave SAT registrada');
  } catch (err) {
    req.flash('error', err.message || 'Error al crear clave SAT');
  }
  res.redirect('/nomina/catalogos/sat');
}

async function toggleCatalogoSatAction(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    await toggleCatalogoSat(req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect('/nomina/catalogos/sat');
}

async function mapeoLegado(req, res) {
  if (requireNominaFeature(req, res) === false) return;

  const mapeos = await listMapeosLegado('fortia');

  res.render('Nomina/catalogos/mapeo-legado', {
    mapeos,
    tiposMapeo: TIPOS_MAPEO_LEGADO,
    catalogosSat: CATALOGOS_SAT,
    tiposHoraExtra: TIPOS_HORA_EXTRA_MOTOR,
    tipoMapeoLabel,
    catalogoLabel,
    session: req.session
  });
}

async function createMapeoLegado(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    await crearMapeoLegado({
      fuente: 'fortia',
      tipoMapeo: trimString(req.body.tipoMapeo),
      claveLegado: trimString(req.body.claveLegado),
      tipoConcepto: trimString(req.body.tipoConcepto),
      catalogoSat: trimString(req.body.catalogoSat),
      claveSat: trimString(req.body.claveSat),
      descripcion: trimString(req.body.descripcion),
      tipoHoraExtra: trimString(req.body.tipoHoraExtra)
    });
    req.flash('success', 'Mapeo legado creado');
  } catch (err) {
    req.flash('error', err.message || 'Error al crear mapeo');
  }
  res.redirect('/nomina/catalogos/mapeo-legado');
}

async function toggleMapeoLegadoAction(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    await toggleMapeoLegado(req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect('/nomina/catalogos/mapeo-legado');
}

async function parametros(req, res) {
  if (requireNominaFeature(req, res) === false) return;

  const parametrosList = await listParametrosFiscales();

  res.render('Nomina/catalogos/parametros', {
    parametros: parametrosList,
    clavesPermitidas: PARAMETROS_FISCALES_PERMITIDOS,
    session: req.session
  });
}

async function createParametro(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    const clave = trimString(req.body.clave).toUpperCase();
    const permitido = PARAMETROS_FISCALES_PERMITIDOS.find((p) => p.clave === clave);
    if (!permitido) throw new Error('Clave de parámetro no permitida');

    await crearParametroFiscal({
      clave,
      valor: Number(req.body.valor),
      descripcion: trimString(req.body.descripcion) || permitido.descripcion,
      vigenciaDesde: parseDate(req.body.vigenciaDesde) || new Date()
    });
    req.flash('success', `Parámetro ${clave} actualizado con nueva vigencia`);
  } catch (err) {
    req.flash('error', err.message || 'Error al guardar parámetro');
  }
  res.redirect('/nomina/catalogos/parametros');
}

async function tablasFiscales(req, res) {
  if (requireNominaFeature(req, res) === false) return;

  const tablas = await listTablasFiscales();

  res.render('Nomina/catalogos/tablas-fiscales', {
    tablas,
    codigosTabla: CODIGOS_TABLA_FISCAL,
    periodicidades: PERIODICIDADES_TABLA,
    session: req.session
  });
}

async function showTablaFiscal(req, res) {
  if (requireNominaFeature(req, res) === false) return;

  const data = await getTablaFiscalConRangos(req.params.id);
  if (!data) return res.status(404).send('Tabla no encontrada');

  res.render('Nomina/catalogos/tabla-fiscal-show', {
    tabla: data.tabla,
    rangos: data.rangos,
    session: req.session
  });
}

async function createTablaFiscal(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    const tabla = await crearTablaFiscal({
      codigo: trimString(req.body.codigo),
      nombre: trimString(req.body.nombre),
      periodicidad: trimString(req.body.periodicidad) || 'mensual',
      vigenciaDesde: parseDate(req.body.vigenciaDesde) || new Date()
    });
    req.flash('success', 'Tabla fiscal creada');
    res.redirect(`/nomina/catalogos/tablas-fiscales/${tabla._id}`);
  } catch (err) {
    req.flash('error', err.message || 'Error al crear tabla');
    res.redirect('/nomina/catalogos/tablas-fiscales');
  }
}

async function toggleTablaFiscalAction(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    await toggleTablaFiscal(req.params.id);
    req.flash('success', 'Estado de tabla actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect(`/nomina/catalogos/tablas-fiscales/${req.params.id}`);
}

async function createRangoFiscal(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    await crearRangoFiscal(req.params.id, {
      limiteInferior: req.body.limiteInferior,
      limiteSuperior: req.body.limiteSuperior,
      cuotaFija: req.body.cuotaFija,
      porcentajeExcedente: req.body.porcentajeExcedente
    });
    req.flash('success', 'Rango agregado');
  } catch (err) {
    req.flash('error', err.message || 'Error al agregar rango');
  }
  res.redirect(`/nomina/catalogos/tablas-fiscales/${req.params.id}`);
}

async function deleteRangoFiscal(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  const tablaId = req.params.id;
  try {
    await eliminarRangoFiscal(req.params.rangoId);
    req.flash('success', 'Rango eliminado');
  } catch (err) {
    req.flash('error', err.message || 'Error al eliminar');
  }
  res.redirect(`/nomina/catalogos/tablas-fiscales/${tablaId}`);
}

async function copiarTablaFiscal(req, res) {
  if (requireNominaFeature(req, res) === false) return;
  try {
    const nueva = await copiarTablaNuevaVigencia(
      req.params.id,
      parseDate(req.body.vigenciaDesde) || new Date()
    );
    req.flash('success', 'Nueva vigencia creada con rangos copiados');
    res.redirect(`/nomina/catalogos/tablas-fiscales/${nueva._id}`);
  } catch (err) {
    req.flash('error', err.message || 'Error al copiar tabla');
    res.redirect(`/nomina/catalogos/tablas-fiscales/${req.params.id}`);
  }
}

module.exports = {
  index,
  catalogoSat,
  createCatalogoSat,
  toggleCatalogoSatAction,
  mapeoLegado,
  createMapeoLegado,
  toggleMapeoLegadoAction,
  parametros,
  createParametro,
  tablasFiscales,
  showTablaFiscal,
  createTablaFiscal,
  toggleTablaFiscalAction,
  createRangoFiscal,
  deleteRangoFiscal,
  copiarTablaFiscal
};
