'use strict';

const getCatalogoSatModel = require('../../models/catalogoSat');
const getCatalogoMapeoLegadoModel = require('../../models/catalogoMapeoLegado');
const getParametroGeneralModel = require('../../models/parametroGeneral');
const getTablaFiscalModel = require('../../models/tablaFiscal');
const getRangoFiscalModel = require('../../models/rangoFiscal');
const { SAT_POR_TIPO_LEGACY, HORA_EXTRA_LEGACY } = require('../../libs/importacionConceptosLegado');

/** Mapeos por defecto (si aún no hay seed en BD) */
function mapeosLegadoPorDefecto() {
  const entradas = [];

  for (const [tipoConcepto, mapa] of Object.entries(SAT_POR_TIPO_LEGACY)) {
    const catalogoSat =
      tipoConcepto === 'percepcion'
        ? 'c_TipoPercepcion'
        : tipoConcepto === 'deduccion'
          ? 'c_TipoDeduccion'
          : 'c_TipoOtroPago';
    const tipoMapeo =
      tipoConcepto === 'otro_pago' ? 'tipo_otro_pago_sat' : 'tipo_perded_sat';

    for (const [claveLegado, sat] of Object.entries(mapa)) {
      entradas.push({
        fuente: 'fortia',
        tipoMapeo,
        claveLegado: String(claveLegado),
        tipoConcepto,
        catalogoSat,
        claveSat: sat.clave,
        descripcion: sat.descripcion,
        tipoHoraExtra: '',
        activo: true
      });
    }
  }

  for (const [claveLegado, tipoHoraExtra] of Object.entries(HORA_EXTRA_LEGACY)) {
    entradas.push({
      fuente: 'fortia',
      tipoMapeo: 'tipo_hora_extra_sat',
      claveLegado: String(claveLegado),
      tipoConcepto: '',
      catalogoSat: 'c_TipoHorasExtra',
      claveSat: claveLegado === '1' ? '03' : claveLegado === '2' ? '01' : '02',
      descripcion: `Hora extra ${tipoHoraExtra}`,
      tipoHoraExtra,
      activo: true
    });
  }

  return entradas;
}

async function listCatalogoSat(filtroCatalogo = null) {
  const CatalogoSat = await getCatalogoSatModel();
  const query = { activo: true };
  if (filtroCatalogo) query.catalogo = filtroCatalogo;
  return CatalogoSat.find(query).sort({ catalogo: 1, clave: 1, vigenciaDesde: -1 }).lean();
}

async function listCatalogoSatTodos() {
  const CatalogoSat = await getCatalogoSatModel();
  return CatalogoSat.find().sort({ catalogo: 1, clave: 1, vigenciaDesde: -1 }).lean();
}

async function crearCatalogoSat(data) {
  const CatalogoSat = await getCatalogoSatModel();
  const vigenciaDesde = data.vigenciaDesde || new Date();
  vigenciaDesde.setHours(0, 0, 0, 0);

  const exists = await CatalogoSat.findOne({
    catalogo: data.catalogo,
    clave: data.clave,
    vigenciaDesde
  }).lean();
  if (exists) throw new Error('Ya existe esa clave SAT con la misma vigencia');

  return CatalogoSat.create({
    catalogo: data.catalogo,
    clave: String(data.clave).trim(),
    descripcion: String(data.descripcion || '').trim(),
    vigenciaDesde,
    vigenciaHasta: null,
    activo: true
  });
}

async function toggleCatalogoSat(id) {
  const CatalogoSat = await getCatalogoSatModel();
  const doc = await CatalogoSat.findById(id);
  if (!doc) throw new Error('Clave SAT no encontrada');
  doc.activo = !doc.activo;
  await doc.save();
}

async function listMapeosLegado(fuente = 'fortia') {
  const CatalogoMapeoLegado = await getCatalogoMapeoLegadoModel();
  return CatalogoMapeoLegado.find({ fuente }).sort({ tipoMapeo: 1, claveLegado: 1 }).lean();
}

async function crearMapeoLegado(data) {
  const CatalogoMapeoLegado = await getCatalogoMapeoLegadoModel();
  const payload = {
    fuente: data.fuente || 'fortia',
    tipoMapeo: data.tipoMapeo,
    claveLegado: String(data.claveLegado).trim(),
    tipoConcepto: data.tipoConcepto || '',
    catalogoSat: data.catalogoSat,
    claveSat: String(data.claveSat).trim(),
    descripcion: String(data.descripcion || '').trim(),
    tipoHoraExtra: String(data.tipoHoraExtra || '').trim(),
    activo: true
  };

  const exists = await CatalogoMapeoLegado.findOne({
    fuente: payload.fuente,
    tipoMapeo: payload.tipoMapeo,
    claveLegado: payload.claveLegado
  }).lean();
  if (exists) throw new Error('Ya existe un mapeo para esa clave legado');

  return CatalogoMapeoLegado.create(payload);
}

async function toggleMapeoLegado(id) {
  const CatalogoMapeoLegado = await getCatalogoMapeoLegadoModel();
  const doc = await CatalogoMapeoLegado.findById(id);
  if (!doc) throw new Error('Mapeo no encontrado');
  doc.activo = !doc.activo;
  await doc.save();
}

async function listParametrosFiscales() {
  const ParametroGeneral = await getParametroGeneralModel();
  return ParametroGeneral.find().sort({ clave: 1, vigenciaDesde: -1 }).lean();
}

async function crearParametroFiscal(data) {
  const clave = String(data.clave || '').trim().toUpperCase();
  const valor = Number(data.valor);
  if (!clave || !Number.isFinite(valor) || valor <= 0) {
    throw new Error('Clave y valor numérico positivo son requeridos');
  }

  const vigenciaDesde = data.vigenciaDesde || new Date();
  vigenciaDesde.setHours(0, 0, 0, 0);

  const ParametroGeneral = await getParametroGeneralModel();

  await ParametroGeneral.updateMany(
    { clave, vigenciaHasta: null },
    { $set: { vigenciaHasta: new Date(vigenciaDesde.getTime() - 1) } }
  );

  return ParametroGeneral.create({
    clave,
    valor,
    vigenciaDesde,
    vigenciaHasta: null,
    descripcion: String(data.descripcion || '').trim()
  });
}

/**
 * Estructura para importación legado: mapas por tipoMapeo + claveLegado.
 */
async function obtenerMapeosLegadoActivos(fuente = 'fortia') {
  const CatalogoMapeoLegado = await getCatalogoMapeoLegadoModel();
  let docs = await CatalogoMapeoLegado.find({ fuente, activo: true }).lean();

  if (!docs.length) {
    docs = mapeosLegadoPorDefecto();
  }

  const porTipoPerded = { percepcion: new Map(), deduccion: new Map(), otro_pago: new Map() };
  const porHoraExtra = new Map();
  const porOtroPago = new Map();

  for (const m of docs) {
    if (m.tipoMapeo === 'tipo_perded_sat' && m.tipoConcepto) {
      const bucket = porTipoPerded[m.tipoConcepto];
      if (bucket) {
        bucket.set(String(m.claveLegado), {
          clave: m.claveSat,
          descripcion: m.descripcion,
          catalogoSat: m.catalogoSat
        });
      }
    } else if (m.tipoMapeo === 'tipo_hora_extra_sat') {
      porHoraExtra.set(String(m.claveLegado), {
        clave: m.claveSat,
        descripcion: m.descripcion,
        tipoHoraExtra: m.tipoHoraExtra
      });
    } else if (m.tipoMapeo === 'tipo_otro_pago_sat') {
      porOtroPago.set(String(m.claveLegado), {
        clave: m.claveSat,
        descripcion: m.descripcion
      });
    }
  }

  return { porTipoPerded, porHoraExtra, porOtroPago };
}

async function seedMapeosLegadoFortia() {
  const CatalogoMapeoLegado = await getCatalogoMapeoLegadoModel();
  const entradas = mapeosLegadoPorDefecto();
  let creados = 0;

  for (const e of entradas) {
    const res = await CatalogoMapeoLegado.updateOne(
      { fuente: e.fuente, tipoMapeo: e.tipoMapeo, claveLegado: e.claveLegado },
      { $setOnInsert: e },
      { upsert: true }
    );
    if (res.upsertedCount) creados++;
  }

  return { creados, total: entradas.length };
}

async function listTablasFiscales() {
  const TablaFiscal = await getTablaFiscalModel();
  const RangoFiscal = await getRangoFiscalModel();
  const tablas = await TablaFiscal.find().sort({ codigo: 1, vigenciaDesde: -1 }).lean();

  const counts = await RangoFiscal.aggregate([
    { $group: { _id: '$tablaId', total: { $sum: 1 } } }
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.total]));

  return tablas.map((t) => ({
    ...t,
    rangosCount: countMap.get(String(t._id)) || 0
  }));
}

async function getTablaFiscalConRangos(tablaId) {
  const TablaFiscal = await getTablaFiscalModel();
  const RangoFiscal = await getRangoFiscalModel();
  const tabla = await TablaFiscal.findById(tablaId).lean();
  if (!tabla) return null;
  const rangos = await RangoFiscal.find({ tablaId: tabla._id }).sort({ limiteInferior: 1 }).lean();
  return { tabla, rangos };
}

async function crearTablaFiscal(data) {
  const TablaFiscal = await getTablaFiscalModel();
  const codigo = String(data.codigo || '').trim().toUpperCase();
  const vigenciaDesde = data.vigenciaDesde || new Date();
  vigenciaDesde.setHours(0, 0, 0, 0);

  await TablaFiscal.updateMany(
    { codigo, vigenciaHasta: null },
    { $set: { vigenciaHasta: new Date(vigenciaDesde.getTime() - 1) } }
  );

  const exists = await TablaFiscal.findOne({ codigo, vigenciaDesde }).lean();
  if (exists) throw new Error('Ya existe una tabla con ese código y vigencia');

  return TablaFiscal.create({
    codigo,
    nombre: String(data.nombre || '').trim(),
    vigenciaDesde,
    vigenciaHasta: null,
    periodicidad: data.periodicidad || 'mensual',
    activo: true
  });
}

async function toggleTablaFiscal(id) {
  const TablaFiscal = await getTablaFiscalModel();
  const doc = await TablaFiscal.findById(id);
  if (!doc) throw new Error('Tabla fiscal no encontrada');
  doc.activo = !doc.activo;
  await doc.save();
}

async function crearRangoFiscal(tablaId, data) {
  const TablaFiscal = await getTablaFiscalModel();
  const RangoFiscal = await getRangoFiscalModel();
  const tabla = await TablaFiscal.findById(tablaId).lean();
  if (!tabla) throw new Error('Tabla fiscal no encontrada');

  const limiteInferior = Number(data.limiteInferior);
  const limiteSuperior = Number(data.limiteSuperior);
  const cuotaFija = Number(data.cuotaFija) || 0;
  const porcentajeExcedente = Number(data.porcentajeExcedente) || 0;

  if (!Number.isFinite(limiteInferior) || !Number.isFinite(limiteSuperior)) {
    throw new Error('Límites inferior y superior son requeridos');
  }
  if (limiteSuperior < limiteInferior) {
    throw new Error('El límite superior debe ser mayor o igual al inferior');
  }

  return RangoFiscal.create({
    tablaId: tabla._id,
    limiteInferior,
    limiteSuperior,
    cuotaFija,
    porcentajeExcedente
  });
}

async function eliminarRangoFiscal(rangoId) {
  const RangoFiscal = await getRangoFiscalModel();
  const res = await RangoFiscal.deleteOne({ _id: rangoId });
  if (!res.deletedCount) throw new Error('Rango no encontrado');
}

async function copiarTablaNuevaVigencia(tablaId, vigenciaDesde) {
  const origen = await getTablaFiscalConRangos(tablaId);
  if (!origen) throw new Error('Tabla origen no encontrada');

  const nueva = await crearTablaFiscal({
    codigo: origen.tabla.codigo,
    nombre: origen.tabla.nombre,
    periodicidad: origen.tabla.periodicidad,
    vigenciaDesde
  });

  const RangoFiscal = await getRangoFiscalModel();
  if (origen.rangos.length) {
    await RangoFiscal.insertMany(
      origen.rangos.map((r) => ({
        tablaId: nueva._id,
        limiteInferior: r.limiteInferior,
        limiteSuperior: r.limiteSuperior,
        cuotaFija: r.cuotaFija,
        porcentajeExcedente: r.porcentajeExcedente
      }))
    );
  }

  return nueva;
}

module.exports = {
  mapeosLegadoPorDefecto,
  listCatalogoSat,
  listCatalogoSatTodos,
  crearCatalogoSat,
  toggleCatalogoSat,
  listMapeosLegado,
  crearMapeoLegado,
  toggleMapeoLegado,
  listParametrosFiscales,
  crearParametroFiscal,
  obtenerMapeosLegadoActivos,
  seedMapeosLegadoFortia,
  listTablasFiscales,
  getTablaFiscalConRangos,
  crearTablaFiscal,
  toggleTablaFiscal,
  crearRangoFiscal,
  eliminarRangoFiscal,
  copiarTablaNuevaVigencia
};
