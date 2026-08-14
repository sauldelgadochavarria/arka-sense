'use strict';

const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { userCanEditNomina, userCanViewNomina } = require('../libs/roleAccess');
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
const {
  listFormulaFunctions,
  crearFormulaFunction,
  toggleFormulaFunction,
  ensureFormulaFunctionsSeeded,
  getFormulaFunctionById,
  actualizarFormulaFunction,
  publicarFormulaFunction,
  validarFormulaFunctionPayload,
  probarFormulaFunctionPayload,
  registrarUltimaPrueba
} = require('../services/nomina/formulaFunctionsService');
const { loadFormulaHelperCatalogForSaas } = require('../services/nomina/formulaHelperCatalog');

function featureFlagsFromReq(req) {
  return req.tenant?.featureFlags || req.session?.featureFlags || {};
}

function requireNominaFeature(req, res) {
  if (tenantHasFeature(featureFlagsFromReq(req), 'nomina')) return null;
  req.flash('error', 'El módulo de Nómina no está habilitado para este tenant.');
  res.redirect('/dashboard');
  return false;
}

function requireNominaView(req, res) {
  if (requireNominaFeature(req, res) === false) return false;
  if (userCanViewNomina(req.session)) return null;
  req.flash('error', 'Tu rol no tiene permiso para consultar nómina.');
  res.redirect('/dashboard');
  return false;
}

function requireNominaWrite(req, res) {
  if (requireNominaFeature(req, res) === false) return false;
  if (userCanEditNomina(req.session)) return null;
  req.flash(
    'error',
    'Tu rol solo puede consultar nómina. Editar catálogos fiscales requiere el rol «Nómina operativa».'
  );
  res.redirect('/nomina/catalogos');
  return false;
}

function catalogoLabel(value) {
  return CATALOGOS_SAT.find((c) => c.value === value)?.label || value;
}

function tipoMapeoLabel(value) {
  return TIPOS_MAPEO_LEGADO.find((t) => t.value === value)?.label || value;
}

async function index(req, res) {
  if (requireNominaView(req, res) === false) return;

  const [sat, mapeos, parametros, tablas, funciones] = await Promise.all([
    listCatalogoSatTodos(),
    listMapeosLegado('legado'),
    listParametrosFiscales(),
    listTablasFiscales(),
    listFormulaFunctions({ includeInactive: false })
  ]);

  res.render('Nomina/catalogos/index', {
    satActivos: sat.filter((s) => s.activo).length,
    mapeosActivos: mapeos.filter((m) => m.activo).length,
    parametrosCount: parametros.length,
    tablasActivas: tablas.filter((t) => t.activo).length,
    funcionesActivas: funciones.length,
    session: req.session
  });
}

async function catalogoSat(req, res) {
  if (requireNominaView(req, res) === false) return;

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
  if (requireNominaWrite(req, res) === false) return;
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
  if (requireNominaWrite(req, res) === false) return;
  try {
    await toggleCatalogoSat(req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect('/nomina/catalogos/sat');
}

async function mapeoLegado(req, res) {
  if (requireNominaView(req, res) === false) return;

  const mapeos = await listMapeosLegado('legado');

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
  if (requireNominaWrite(req, res) === false) return;
  try {
    await crearMapeoLegado({
      fuente: 'legado',
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
  if (requireNominaWrite(req, res) === false) return;
  try {
    await toggleMapeoLegado(req.params.id);
    req.flash('success', 'Estado actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect('/nomina/catalogos/mapeo-legado');
}

async function parametros(req, res) {
  if (requireNominaView(req, res) === false) return;

  const parametrosList = await listParametrosFiscales();

  res.render('Nomina/catalogos/parametros', {
    parametros: parametrosList,
    clavesPermitidas: PARAMETROS_FISCALES_PERMITIDOS,
    session: req.session
  });
}

async function createParametro(req, res) {
  if (requireNominaWrite(req, res) === false) return;
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
  if (requireNominaView(req, res) === false) return;

  const tablas = await listTablasFiscales();

  res.render('Nomina/catalogos/tablas-fiscales', {
    tablas,
    codigosTabla: CODIGOS_TABLA_FISCAL,
    periodicidades: PERIODICIDADES_TABLA,
    session: req.session
  });
}

async function showTablaFiscal(req, res) {
  if (requireNominaView(req, res) === false) return;

  const data = await getTablaFiscalConRangos(req.params.id);
  if (!data) return res.status(404).send('Tabla no encontrada');

  const { BASES_CALCULO_IMSS, UNIDADES_LIMITE_CEAV } = require('../config/imssCuotas');

  res.render('Nomina/catalogos/tabla-fiscal-show', {
    tabla: data.tabla,
    rangos: data.rangos,
    tipo: data.tipo,
    basesCalculo: BASES_CALCULO_IMSS,
    unidadesLimite: UNIDADES_LIMITE_CEAV,
    session: req.session
  });
}

async function createTablaFiscal(req, res) {
  if (requireNominaWrite(req, res) === false) return;
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
  if (requireNominaWrite(req, res) === false) return;
  try {
    await toggleTablaFiscal(req.params.id);
    req.flash('success', 'Estado de tabla actualizado');
  } catch (err) {
    req.flash('error', err.message || 'Error al actualizar');
  }
  res.redirect(`/nomina/catalogos/tablas-fiscales/${req.params.id}`);
}

async function createRangoFiscal(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  try {
    await crearRangoFiscal(req.params.id, {
      clave: req.body.clave,
      nombre: req.body.nombre,
      tasaObrero: req.body.tasaObrero,
      tasaPatronal: req.body.tasaPatronal,
      baseCalculo: req.body.baseCalculo,
      limiteInferior: req.body.limiteInferior,
      limiteSuperior: req.body.limiteSuperior,
      limiteInfUnidad: req.body.limiteInfUnidad,
      limiteSupUnidad: req.body.limiteSupUnidad,
      cuotaFija: req.body.cuotaFija,
      porcentajeExcedente: req.body.porcentajeExcedente
    });
    req.flash('success', 'Fila agregada');
  } catch (err) {
    req.flash('error', err.message || 'Error al agregar rango');
  }
  res.redirect(`/nomina/catalogos/tablas-fiscales/${req.params.id}`);
}

async function deleteRangoFiscal(req, res) {
  if (requireNominaWrite(req, res) === false) return;
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
  if (requireNominaWrite(req, res) === false) return;
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

async function formulaFunctions(req, res) {
  if (requireNominaView(req, res) === false) return;
  await ensureFormulaFunctionsSeeded();
  const funciones = await listFormulaFunctions({ includeInactive: true });
  res.render('Nomina/catalogos/formula-functions', {
    funciones,
    session: req.session
  });
}

async function showFormulaFunction(req, res) {
  if (requireNominaView(req, res) === false) return;
  const fn = await getFormulaFunctionById(req.params.id);
  if (!fn) {
    req.flash('error', 'Función no encontrada');
    return res.redirect('/nomina/catalogos/formula-functions');
  }
  const helper = await loadFormulaHelperCatalogForSaas().catch(() => null);
  res.render('Nomina/catalogos/formula-function-edit', {
    fn,
    helper,
    session: req.session
  });
}

async function createFormulaFunctionAction(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  try {
    const created = await crearFormulaFunction({
      name: req.body.name,
      tipo: 'expresion',
      args: req.body.args,
      cuerpo: req.body.cuerpo,
      signature: req.body.signature,
      descripcion: req.body.descripcion,
      ejemplo: req.body.ejemplo,
      publicar: req.body.publicar
    });
    req.flash(
      'success',
      created.estado === 'publicado'
        ? 'Función creada y publicada.'
        : 'Función creada en borrador. Ábrela para validar / probar / publicar.'
    );
    return res.redirect(`/nomina/catalogos/formula-functions/${created._id}`);
  } catch (err) {
    req.flash('error', err.message || 'No se pudo crear la función');
    return res.redirect('/nomina/catalogos/formula-functions');
  }
}

async function saveFormulaFunctionAction(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  const id = req.params.id;
  try {
    const existing = await getFormulaFunctionById(id);
    if (existing && existing.tipo === 'javascript') {
      req.flash('error', 'Los scripts JavaScript solo se editan en la consola de plataforma.');
      return res.redirect('/nomina/catalogos/formula-functions');
    }
    if (req.body.accion === 'publicar') {
      await actualizarFormulaFunction(id, {
        tipo: 'expresion',
        args: req.body.args,
        cuerpo: req.body.cuerpo,
        signature: req.body.signature,
        descripcion: req.body.descripcion,
        ejemplo: req.body.ejemplo
      });
      await publicarFormulaFunction(id);
      req.flash('success', 'Función publicada. Ya está en el scope de cálculo.');
    } else {
      await actualizarFormulaFunction(id, {
        tipo: 'expresion',
        args: req.body.args,
        cuerpo: req.body.cuerpo,
        signature: req.body.signature,
        descripcion: req.body.descripcion,
        ejemplo: req.body.ejemplo
      });
      req.flash('success', 'Borrador guardado');
    }
  } catch (err) {
    req.flash('error', err.message || 'No se pudo guardar');
  }
  res.redirect(`/nomina/catalogos/formula-functions/${id}`);
}

async function publishFormulaFunctionAction(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  try {
    await publicarFormulaFunction(req.params.id);
    req.flash('success', 'Función publicada');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo publicar');
  }
  res.redirect(`/nomina/catalogos/formula-functions/${req.params.id}`);
}

async function validateFormulaFunctionApi(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  try {
    const body = { ...(req.body || {}), tipo: 'expresion' };
    const result = validarFormulaFunctionPayload(body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Inválido' });
  }
}

async function testFormulaFunctionApi(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  try {
    const body = { ...(req.body || {}), tipo: 'expresion' };
    const result = probarFormulaFunctionPayload(body);
    if (req.body?.id) {
      await registrarUltimaPrueba(req.body.id, {
        ok: true,
        resultado: result.resultado,
        mensaje: 'OK'
      }).catch(() => {});
    }
    res.json(result);
  } catch (err) {
    if (req.body?.id) {
      await registrarUltimaPrueba(req.body.id, {
        ok: false,
        resultado: null,
        mensaje: err.message || 'Error'
      }).catch(() => {});
    }
    res.status(400).json({ error: err.message || 'Error al probar' });
  }
}

async function toggleFormulaFunctionAction(req, res) {
  if (requireNominaWrite(req, res) === false) return;
  try {
    await toggleFormulaFunction(req.params.id);
    req.flash('success', 'Estado de la función actualizado');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo cambiar el estado');
  }
  res.redirect('/nomina/catalogos/formula-functions');
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
  copiarTablaFiscal,
  formulaFunctions,
  showFormulaFunction,
  createFormulaFunctionAction,
  saveFormulaFunctionAction,
  publishFormulaFunctionAction,
  validateFormulaFunctionApi,
  testFormulaFunctionApi,
  toggleFormulaFunctionAction
};
