'use strict';

/**
 * Proceso de timbrado CFDI de nómina.
 * v1: arma lote, valida, simula o intenta PAC real (payload mínimo / stub).
 */

const getTimbradoLoteModel = require('../models/timbradoLote');
const getPacConfigModel = require('../models/pacConfig');
const getPeriodoNominaModel = require('../models/periodoNomina');
const { resolveSubsidiariaIdFromPeriodo } = require('../libs/periodosNominaScope');
const getReciboNominaModel = require('../models/reciboNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getEmpleadoModel = require('../models/empleado');
const getReciboPdfPlantillaModel = require('../models/reciboPdfPlantilla');
const getConceptCatalogModel = require('../models/conceptCatalog');
const { authenticateSw, timbrarCfdiSw, cancelarCfdiPac, uuidSimulado } = require('./pacClientService');
const { guardarCfdiArchivo } = require('./cfdiArchivoService');
const { buildCfdiNominaPayload, toCfdiXml } = require('./cfdi/nomina12Builder');
const { urlTimbradoParaFormato } = require('./cfdi/nomina12Helpers');
const {
  buildSeparacionIndemnizacionData
} = require('./cfdi/separacionIndemnizacionBuilder');
const {
  renderPlantillaHtml,
  buildReciboPdfContext,
  resolverPlantillaPdf,
  enrichEmpleadoPdf,
  mergeEmpleadoPdf
} = require('./reciboPdfService');
const getFiniquitoCalculoModel = require('../models/finiquitoCalculo');
const { CONCEPTOS_FINIQUITO } = require('../config/finiquitoCatalog');
const { pacAmbienteEsPrueba, MOTIVOS_CANCELACION_NOMINA, CODIGOS_CANCELACION_SAT } = require('../config/timbradoCatalog');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function xmlSimuladoDesdePayload(cfdiPayload, uuid) {
  return toCfdiXml(cfdiPayload.ctx, { incluirTfdSimulado: true, uuidSimulado: uuid });
}

/**
 * Resuelve snapshot SeparacionIndemnizacion: recibo → histórico → finiquito_calculos → conceptos.
 */
async function resolverSeparacionIndemnizacion(tenantId, src) {
  if (src?.cfdiSeparacionIndemnizacion && Number(src.cfdiSeparacionIndemnizacion.TotalPagado) > 0) {
    return buildSeparacionIndemnizacionData({ override: src.cfdiSeparacionIndemnizacion });
  }
  try {
    const Finiquito = await getFiniquitoCalculoModel();
    const q = { tenantId };
    if (src.reciboId) q.reciboId = src.reciboId;
    else if (src.empleadoId && src.periodoSnap) {
      /* buscar por empleado + período vía finiquito.periodoId no siempre disponible aquí */
    }
    let fin = null;
    if (src.reciboId) {
      fin = await Finiquito.findOne({ tenantId, reciboId: src.reciboId }).lean();
    }
    if (!fin && src.empleadoId) {
      fin = await Finiquito.findOne({
        tenantId,
        empleadoId: src.empleadoId,
        estatus: { $nin: ['cancelado'] }
      })
        .sort({ updatedAt: -1 })
        .lean();
    }
    if (fin?.totales?.cfdiSeparacionIndemnizacion) {
      return buildSeparacionIndemnizacionData({ override: fin.totales.cfdiSeparacionIndemnizacion });
    }
    if (fin) {
      return buildSeparacionIndemnizacionData({
        conceptos: fin.conceptos || [],
        antiguedad: fin.antiguedad || {},
        salarioDiario: fin.parametros?.salarioDiario || src.empleadoSnap?.salarioDiario || 0,
        fiscalSeparacion: fin.totales?.fiscalSeparacion || {}
      });
    }
  } catch {
    /* sin finiquito */
  }
  return buildSeparacionIndemnizacionData({
    conceptos: src.conceptos || [],
    antiguedad: {},
    salarioDiario: src.empleadoSnap?.salarioDiario || src.insumosResumen?.sueldoDiario || 0,
    fiscalSeparacion: {}
  });
}

function catalogMapsFromRows(catalogRows) {
  const catalogoNombres = {};
  const catalogoMeta = {};
  for (const c of catalogRows || []) {
    const code = String(c.codigo).toUpperCase();
    catalogoNombres[code] = c.nombre || catalogoNombres[code];
    const prev = catalogoMeta[code] || {};
    catalogoMeta[code] = {
      nombre: c.nombre || prev.nombre,
      descripcion: c.descripcion || c.sat?.descripcion || prev.descripcion || c.nombre || prev.nombre || '',
      satDescripcion: (c.sat && c.sat.descripcion) || prev.satDescripcion || '',
      tipo: c.tipo || c.sat?.tipo || prev.tipo || '',
      satTipo: c.sat?.tipo || prev.satTipo || '',
      naturaleza: c.naturaleza || c.fiscal?.naturaleza || prev.naturaleza || '',
      claveSAT: (c.sat && c.sat.clave) || c.claveSAT || prev.claveSAT || '',
      informativo: Boolean(
        c.metadata?.informativo ||
          prev.informativo ||
          c.naturaleza === 'informativo' ||
          c.fiscal?.naturaleza === 'informativo'
      ),
      metadata: c.metadata || prev.metadata || {}
    };
  }
  // Conceptos de finiquito viven en config (no siempre en concept_catalog).
  for (const c of CONCEPTOS_FINIQUITO || []) {
    const code = String(c.codigo).toUpperCase();
    if (!catalogoMeta[code]) {
      catalogoNombres[code] = c.nombre;
      catalogoMeta[code] = {
        nombre: c.nombre,
        tipo: c.tipo || '',
        satTipo: '',
        naturaleza: c.tipo === 'deduccion' ? 'deduccion' : 'percepcion',
        claveSAT: c.claveSAT || ''
      };
    } else if (!catalogoMeta[code].nombre && c.nombre) {
      catalogoMeta[code].nombre = c.nombre;
      catalogoNombres[code] = c.nombre;
    }
    if (!catalogoMeta[code].claveSAT && c.claveSAT) {
      catalogoMeta[code].claveSAT = c.claveSAT;
    }
  }
  return { catalogoNombres, catalogoMeta };
}

/**
 * Nombre y clave SAT de la subsidiaria pisan al catálogo.
 * Así el séptimo día (alias) no se timbra con la clave 019 de otro concepto.
 */
async function overlayAliasSubsidiaria(catalogoNombres, catalogoMeta, { tenantId, empresaId, subsidiariaId }) {
  if (!tenantId || !empresaId || !subsidiariaId) return;
  const getSubsidiaryConceptConfigModel = require('../models/subsidiaryConceptConfig');
  const SubCfg = await getSubsidiaryConceptConfigModel();
  const rows = await SubCfg.find({
    tenantId,
    empresaId,
    subsidiariaId,
    activo: true,
    deshabilitado: { $ne: true }
  })
    .select('conceptoCodigo aliasNombre claveSat tipo')
    .lean();
  for (const row of rows) {
    const code = String(row.conceptoCodigo || '').trim().toUpperCase();
    if (!code) continue;
    const prev = catalogoMeta[code] || { nombre: '', tipo: '', claveSAT: '' };
    const nombre = String(row.aliasNombre || '').trim();
    if (nombre) {
      catalogoNombres[code] = nombre;
      prev.nombre = nombre;
      prev.descripcion = nombre;
    }
    const satDigits = String(row.claveSat || '').replace(/\D/g, '');
    if (satDigits) {
      prev.claveSAT = satDigits.padStart(3, '0').slice(-3);
      prev.claveSatForzada = true;
    }
    if (row.tipo) prev.tipo = prev.tipo || row.tipo;
    catalogoMeta[code] = prev;
  }
}

async function resolverCatalogoTimbrado({ tenantId, empresaId, subsidiariaId }) {
  const Catalog = await getConceptCatalogModel();
  const catalogRows = await Catalog.find({})
    .select('codigo nombre tipo naturaleza claveSAT sat fiscal metadata descripcion')
    .lean();
  let nominaConceptos = [];
  try {
    const getConceptoNominaModel = require('../models/conceptoNomina');
    const ConceptoNomina = await getConceptoNominaModel();
    nominaConceptos = await ConceptoNomina.find({ tenantId })
      .select('codigo nombre tipo naturaleza claveSAT sat fiscal metadata descripcion')
      .lean();
  } catch (_) {
    /* ignore */
  }
  const maps = catalogMapsFromRows([...catalogRows, ...nominaConceptos]);
  await overlayAliasSubsidiaria(maps.catalogoNombres, maps.catalogoMeta, {
    tenantId,
    empresaId,
    subsidiariaId
  });
  return maps;
}

/**
 * Registro patronal de pruebas (PAC ambiente=0).
 * Si el PAC no tiene el campo (docs antiguos), usa el default del catálogo.
 */
function registroPatronalPruebaDePac(pac) {
  const { PAC_SW_DEFAULTS } = require('../config/timbradoCatalog');
  const raw = String(pac?.registroPatronalTest || PAC_SW_DEFAULTS.registroPatronalTest || 'Y671234510R')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 11);
  return raw || 'Y671234510R';
}

/**
 * En ambiente de prueba (PAC ambiente=0) usa RFC/razón social / registro patronal de prueba.
 * Nombres CSD SAT son literales (p.ej. IIA040805DZ4 → "INDISTRIA…" con typo oficial).
 */
function empresaParaCfdi(empresa, pac) {
  const base = { ...(empresa || {}) };
  if (!pacAmbienteEsPrueba(pac?.ambiente)) return base;

  const { PAC_SW_DEFAULTS } = require('../config/timbradoCatalog');
  const def = PAC_SW_DEFAULTS || {};
  const rfcTest = String(pac.rfcSatTest || def.rfcSatTest || '')
    .trim()
    .toUpperCase();
  let nombreTest = String(pac.nombreSatTest || def.nombreSatTest || '').trim();
  const cpTest = String(pac.codigoPostalSatTest || def.codigoPostalSatTest || '')
    .replace(/\D/g, '')
    .slice(0, 5);
  const rpTest = registroPatronalPruebaDePac(pac);

  // Corrección CFDI40139: typo oficial SAT "INDISTRIA" (no "INDUSTRIA").
  if (rfcTest === 'IIA040805DZ4') {
    if (!nombreTest || /INDUSTRIA ILUMINADORA/i.test(nombreTest)) {
      nombreTest = 'INDISTRIA ILUMINADORA DE ALMACENES';
    }
  }

  if (rfcTest) {
    base.rfc = rfcTest;
    if (nombreTest) base.razonSocial = nombreTest;
  }
  if (rpTest) {
    base.registroPatronal = rpTest;
  }
  const cp = cpTest || (rfcTest === 'IIA040805DZ4' ? '62661' : '') || '26015';
  base.codigoPostal = cp;
  base.cp = cp;
  return base;
}

/**
 * Sustituye identidad fiscal del trabajador por el receptor de pruebas del PAC.
 * Conserva NumEmpleado y el resto del cálculo (percepciones/deducciones/SDI).
 * En ambiente de prueba también fuerza el registro patronal de prueba del PAC.
 */
function empleadoParaCfdi(empleado, pac) {
  const base = { ...(empleado || {}) };

  if (pacAmbienteEsPrueba(pac?.ambiente)) {
    base.registroPatronal = registroPatronalPruebaDePac(pac);
  }

  if (!pac?.usarReceptorPrueba) return base;

  const { RECEPTOR_PRUEBA_DEFAULTS, RECEPTORES_PRUEBA_SAT } = require('../config/timbradoCatalog');
  const def = RECEPTOR_PRUEBA_DEFAULTS || {};
  const catalog = RECEPTORES_PRUEBA_SAT || {};

  let rfc = String(pac.rfcReceptorTest || def.rfc || '')
    .trim()
    .toUpperCase();
  // NOM8: receptor de nómina debe ser persona física (RFC longitud 13).
  if (rfc.length !== 13) {
    console.warn(
      `[timbrado] receptor prueba RFC="${rfc}" len=${rfc.length} no es PF (13). Usando ${def.rfc}`
    );
    rfc = String(def.rfc || 'XOJI740919U48').toUpperCase();
  }

  const known = catalog[rfc] || (rfc === String(def.rfc || '').toUpperCase() ? def : null);
  const nombre = String(
    (known && known.nombre) || pac.nombreReceptorTest || def.nombre || ''
  ).trim();
  const regimen = String(
    (known && known.regimenFiscal) || pac.regimenReceptorTest || def.regimenFiscal || '605'
  )
    .trim()
    .replace(/\D/g, '')
    .padStart(3, '0')
    .slice(-3);
  const cp = String(
    (known && known.codigoPostal) || pac.cpReceptorTest || def.codigoPostal || '76028'
  )
    .replace(/\D/g, '')
    .slice(0, 5)
    .padStart(5, '0');
  const nss = String(pac.nssReceptorTest || def.nss || '12345678901')
    .replace(/\D/g, '')
    .slice(0, 11)
    .padStart(11, '0');
  const curp = String(
    (known && known.curp) || pac.curpReceptorTest || def.curp || 'XEXX010101HNEXXXA4'
  )
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 18);
  const tipoContrato = String(pac.tipoContratoReceptorTest || def.tipoContrato || '01')
    .replace(/\D/g, '')
    .padStart(2, '0')
    .slice(-2);
  const tipoRegimen = String(pac.tipoRegimenReceptorTest || def.tipoRegimen || '02')
    .replace(/\D/g, '')
    .padStart(2, '0')
    .slice(-2);

  if (!known) {
    console.warn(
      `[timbrado] receptor prueba RFC=${rfc} CP=${cp}: si no coincide con Constancia SAT → CFDI40147/40145. ` +
        `Sandbox recomendado: ${def.rfc} / ${def.nombre} / CP ${def.codigoPostal}`
    );
  }

  if (rfc) base.rfc = rfc;
  if (nombre) {
    base.nombre = nombre;
    base.nombreSat = nombre;
    base.firstName = nombre;
    base.lastName = '';
  }
  if (regimen) base.regimenFiscal = regimen;
  if (cp) {
    base.codigoPostal = cp;
    if (!base.domicilio || typeof base.domicilio !== 'object') {
      base.domicilio = { ...(base.domicilio || {}), codigoPostal: cp };
    } else {
      base.domicilio = { ...base.domicilio, codigoPostal: cp };
    }
  }
  if (nss) {
    base.nss = nss;
    base.imss = nss;
  }
  if (curp) base.curp = curp;
  if (tipoContrato) base.tipoContrato = tipoContrato;
  if (tipoRegimen) base.tipoRegimen = tipoRegimen;
  // numEmpleado, sdi, depto, puesto y montos del recibo se conservan
  return base;
}

async function loadRecibosParaTimbrar(tenantId, periodo) {
  const Empleado = await getEmpleadoModel();
  const cerrado = periodo.estatus === 'cerrado';
  if (cerrado) {
    const Historico = await getNominaHistoricoReciboModel();
    const rows = await Historico.find({
      tenantId,
      periodoId: periodo._id,
      origen: { $in: ['cierre', 'importacion'] }
    }).lean();
    const empIds = [...new Set(rows.map((h) => String(h.empleadoId)).filter(Boolean))];
    const empleados = empIds.length ? await Empleado.find({ _id: { $in: empIds } }).lean() : [];
    const empById = new Map(empleados.map((e) => [String(e._id), e]));
    return Promise.all(
      rows.map(async (h) => {
        const live = empById.get(String(h.empleadoId)) || {};
        const snap = await enrichEmpleadoPdf(mergeEmpleadoPdf(h.empleado || {}, live));
        return {
          fuente: 'historico',
          historicoId: h._id,
          reciboId: h.reciboOrigenId || null,
          empleadoId: h.empleadoId,
          numEmpleado: snap.numEmpleado || h.empleado?.numEmpleado || '',
          nombre: snap.nombre || h.empleado?.nombre || '',
          netoPagar: money(h.netoPagar),
          totalPercepciones: money(h.totalPercepciones),
          totalDeducciones: money(h.totalDeducciones),
          diasLaborados: h.diasLaborados,
          diasPagados: h.diasPagados,
          conceptos: h.conceptos || [],
          basesFiscales: h.basesFiscales || {},
          isrMotor: h.isrMotor || null,
          cfdiSeparacionIndemnizacion: h.cfdiSeparacionIndemnizacion || null,
          timbrado: h.timbrado || {},
          empleadoSnap: snap,
          periodoSnap: h.periodo || {},
          departamentoId: h.empleado?.departamentoId || live.departamentoId || null,
          departamentoNombre:
            h.empleado?.departamentoNombre ||
            snap.departamentoNombre ||
            ''
        };
      })
    );
  }

  const Recibo = await getReciboNominaModel();
  const getConceptoAplicadoModel = require('../models/conceptoAplicado');
  const Aplicado = await getConceptoAplicadoModel();
  const recibos = await Recibo.find({ tenantId, periodoId: periodo._id }).lean();
  if (!recibos.length) return [];
  const ids = recibos.map((r) => r._id);
  const empIds = [...new Set(recibos.map((r) => String(r.empleadoId)))];
  const [aplicados, empleados] = await Promise.all([
    Aplicado.find({ tenantId, reciboId: { $in: ids } }).lean(),
    Empleado.find({ _id: { $in: empIds } }).lean()
  ]);
  const empById = new Map(empleados.map((e) => [String(e._id), e]));
  const byRecibo = new Map();
  for (const a of aplicados) {
    const k = String(a.reciboId);
    if (!byRecibo.has(k)) byRecibo.set(k, []);
    byRecibo.get(k).push(a);
  }
  return Promise.all(
    recibos.map(async (r) => {
      const emp = await enrichEmpleadoPdf(empById.get(String(r.empleadoId)) || {});
      return {
        fuente: 'temporal',
        historicoId: null,
        reciboId: r._id,
        empleadoId: r.empleadoId,
        numEmpleado: emp.numEmpleado || '',
        nombre: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
        netoPagar: money(r.netoPagar),
        totalPercepciones: money(r.totalPercepciones),
        totalDeducciones: money(r.totalDeducciones),
        diasLaborados: r.diasLaborados,
        diasPagados: r.diasPagados,
        conceptos: byRecibo.get(String(r._id)) || [],
        basesFiscales: r.basesFiscales || {},
        isrMotor: r.isrMotor || null,
        cfdiSeparacionIndemnizacion: r.cfdiSeparacionIndemnizacion || null,
        insumosResumen: r.insumosResumen || {},
        timbrado: r.timbrado || {},
        empleadoSnap: emp,
        periodoSnap: {
          tipoPeriodo: periodo.tipoPeriodo,
          tipoNomina: periodo.tipoNomina,
          numeroPeriodo: periodo.numeroPeriodo,
          fechaInicio: periodo.fechaInicio,
          fechaFin: periodo.fechaFin
        }
      };
    })
  );
}

/**
 * Decide si un recibo entra al lote o se omite según timbrado previo y modo del lote.
 * - Timbrado real previo → omitir siempre.
 * - Timbrado simulado + lote real → reprocesar (pasar a PAC).
 * - Timbrado simulado + lote simulación → omitir (evitar duplicar UUID sim).
 */
function cfdiSigueVigente(timbrado) {
  return timbrado?.estatus === 'timbrado' && String(timbrado.uuid || '').trim();
}

/** Conserva el UUID cancelado cuando el recibo se vuelve a timbrar. */
function archivarTimbrePrevio(prev, stamp) {
  const historial = Array.isArray(prev?.historial) ? prev.historial.map((h) => ({ ...h })) : [];
  if (prev?.uuid && prev.estatus && prev.estatus !== 'pendiente') {
    const ya = historial.some((h) => String(h.uuid || '').toLowerCase() === String(prev.uuid).toLowerCase() && h.estatus === prev.estatus);
    if (!ya) {
      historial.push({
        uuid: prev.uuid,
        estatus: prev.estatus,
        motivoCancelacion: prev.motivoCancelacion || '',
        codigoCancelacion: prev.codigoCancelacion || '',
        fechaCancelacion: prev.fechaCancelacion || null,
        fechaTimbrado: prev.fechaTimbrado || null,
        acuseCancelacion: prev.acuseCancelacion || '',
        loteId: prev.loteId || null,
        modo: prev.modo || ''
      });
    }
  }
  return { ...stamp, historial };
}

/**
 * Períodos en los que cada recibo tiene un CFDI vigente.
 * Si alguno se canceló, el período vuelve a poder timbrarse; el vigente no se reenvía.
 */
async function periodoIdsTimbradosPorCompleto(tenantId, empresaId) {
  if (!tenantId || !empresaId) return [];
  const Historico = await getNominaHistoricoReciboModel();
  const Recibo = await getReciboNominaModel();
  const [hists, recibos] = await Promise.all([
    Historico.find({ tenantId, empresaId, periodoId: { $ne: null } })
      .select('periodoId timbrado.estatus timbrado.uuid')
      .lean(),
    Recibo.find({ tenantId, empresaId, periodoId: { $ne: null } })
      .select('periodoId timbrado.estatus timbrado.uuid')
      .lean()
  ]);
  const conHistorico = new Set(hists.map((h) => String(h.periodoId)));
  const buckets = new Map();
  const add = (periodoId, timbrado) => {
    const id = String(periodoId || '');
    if (!id) return;
    if (!buckets.has(id)) buckets.set(id, { total: 0, vigentes: 0, raw: periodoId });
    const b = buckets.get(id);
    b.total += 1;
    if (cfdiSigueVigente(timbrado)) b.vigentes += 1;
  };
  for (const h of hists) add(h.periodoId, h.timbrado);
  for (const r of recibos) {
    if (conHistorico.has(String(r.periodoId))) continue;
    add(r.periodoId, r.timbrado);
  }
  return [...buckets.values()].filter((b) => b.total > 0 && b.vigentes === b.total).map((b) => b.raw);
}

function resolverEstatusInicialItem(reciboTimbrado, loteModo) {
  const t = reciboTimbrado || {};
  if (t.estatus !== 'timbrado') {
    return { estatus: 'pendiente', errorMensaje: '', uuid: '', serie: '', folio: '' };
  }
  if (t.modo === 'real') {
    return {
      estatus: 'omitido',
      errorMensaje: `Ya timbrado ante PAC (UUID ${t.uuid || '—'})`,
      uuid: t.uuid || '',
      serie: t.serie || '',
      folio: t.folio || ''
    };
  }
  if (loteModo === 'real') {
    return { estatus: 'pendiente', errorMensaje: '', uuid: '', serie: '', folio: '' };
  }
  return {
    estatus: 'omitido',
    errorMensaje: `Timbrado simulado previo (UUID ${t.uuid || '—'})`,
    uuid: t.uuid || '',
    serie: t.serie || '',
    folio: t.folio || ''
  };
}

/**
 * Crea lote de timbrado (borrador) y opcionalmente lo procesa.
 */
async function crearYProcesarLote({
  tenantId,
  empresaId,
  empresa,
  periodoId,
  pacConfigId,
  plantillaPdfId = null,
  forzarReal = false,
  userId = '',
  userLabel = '',
  procesar = true,
  sustituciones = null
}) {
  const Periodo = await getPeriodoNominaModel();
  const Pac = await getPacConfigModel();
  const Lote = await getTimbradoLoteModel();

  const periodo = await Periodo.findOne({ _id: periodoId, tenantId, empresaId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  const estatusPeriodo = String(periodo.estatus || '').toLowerCase();
  if (estatusPeriodo !== 'calculado' && estatusPeriodo !== 'cerrado') {
    throw new Error('Solo se timbran períodos calculados o cerrados.');
  }

  const pac = await Pac.findOne({ _id: pacConfigId, tenantId, empresaId, activo: true }).lean();
  if (!pac) throw new Error('Configuración PAC no encontrada o inactiva');

  let recibos = await loadRecibosParaTimbrar(tenantId, periodo);
  if (!recibos.length) throw new Error('No hay recibos para timbrar en el período');

  const listaSustitucion = Array.isArray(sustituciones) ? sustituciones : [];
  if (listaSustitucion.length) {
    const porEmpleado = new Map(
      listaSustitucion.map((s) => [String(s.empleadoId), String(s.uuid || '').trim().toUpperCase()])
    );
    recibos = recibos
      .filter((r) => porEmpleado.has(String(r.empleadoId)))
      .map((r) => ({ ...r, uuidSustituido: porEmpleado.get(String(r.empleadoId)) }));
    if (recibos.length !== porEmpleado.size) {
      throw new Error(
        'No está el recibo de algún empleado seleccionado. El CFDI nuevo sale del cálculo actual del período.'
      );
    }
    const sinUuid = recibos.find((r) => !UUID_RE.test(r.uuidSustituido || ''));
    if (sinUuid) throw new Error('La sustitución necesita el UUID vigente del CFDI original.');
  }

  const subsidiariaId = await resolveSubsidiariaIdFromPeriodo(periodo, { tenantId, empresaId });

  const modo = forzarReal || pac.modoReal ? 'real' : 'simulacion';
  const hayPendiente = recibos.some(
    (r) => r.uuidSustituido || resolverEstatusInicialItem(r.timbrado, modo).estatus === 'pendiente'
  );
  if (!hayPendiente) {
    throw new Error(
      'No hay CFDI pendientes. Con motivo 02 cancela el vigente y vuelve a timbrar. Con motivo 01 emite primero el CFDI nuevo desde el lote (relación 04) y después cancela el original.'
    );
  }
  const items = recibos.map((r) => {
    const ini = r.uuidSustituido
      ? { estatus: 'pendiente', errorMensaje: '', uuid: '', serie: '', folio: '' }
      : resolverEstatusInicialItem(r.timbrado, modo);
    return {
      reciboId: r.reciboId,
      historicoId: r.historicoId,
      empleadoId: r.empleadoId,
      numEmpleado: r.numEmpleado,
      nombre: r.nombre,
      netoPagar: r.netoPagar,
      departamentoId: r.departamentoId || null,
      departamentoNombre: r.departamentoNombre || '',
      estatus: ini.estatus,
      uuid: ini.uuid,
      serie: ini.serie,
      folio: ini.folio,
      errorMensaje: ini.errorMensaje,
      intentos: 0,
      modo: '',
      uuidSustituye: r.uuidSustituido || ''
    };
  });

  const lote = await Lote.create({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null,
    periodoId: periodo._id,
    pacConfigId: pac._id,
    plantillaPdfId: plantillaPdfId || null,
    estatus: 'borrador',
    modo,
    formato: pac.formato || 'JSON',
    generarLayout: pac.generarLayout !== false,
    serie: pac.serieDefault || '',
    totales: {
      recibos: items.length,
      timbrados: 0,
      errores: 0,
      omitidos: items.filter((i) => i.estatus === 'omitido').length,
      neto: money(items.reduce((s, i) => s + (i.netoPagar || 0), 0))
    },
    items,
    creadoPorUserId: userId,
    creadoPorLabel: userLabel
  });

  if (!procesar) return { lote: lote.toObject(), recibos };

  return procesarLote({
    tenantId,
    empresaId,
    empresa,
    loteId: lote._id,
    recibosByKey: indexRecibos(recibos),
    periodo,
    pac
  });
}

function indexRecibos(recibos) {
  const map = new Map();
  for (const r of recibos) {
    const key = r.historicoId ? `h:${r.historicoId}` : `r:${r.reciboId}`;
    map.set(key, r);
  }
  return map;
}

async function procesarLote({ tenantId, empresaId, empresa, loteId, recibosByKey, periodo, pac }) {
  const Lote = await getTimbradoLoteModel();
  const Pac = await getPacConfigModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Recibo = await getReciboNominaModel();
  const Plantilla = await getReciboPdfPlantillaModel();

  let lote = await Lote.findOne({ _id: loteId, tenantId });
  if (!lote) throw new Error('Lote no encontrado');
  if (!pac) {
    pac = await Pac.findOne({ _id: lote.pacConfigId, tenantId }).lean();
  }
  if (!periodo) {
    const Periodo = await getPeriodoNominaModel();
    periodo = await Periodo.findOne({ _id: lote.periodoId, tenantId }).lean();
  }
  if (!recibosByKey) {
    const list = await loadRecibosParaTimbrar(tenantId, periodo);
    recibosByKey = indexRecibos(list);
  }

  lote.estatus = 'en_proceso';
  lote.iniciadoAt = new Date();
  await lote.save();

  let token = null;
  if (lote.modo === 'real') {
    if (!String(pac.usuario || '').trim()) {
      throw new Error('PAC modo real: captura el usuario (correo SW) en Config PAC');
    }
    if (!String(pac.password || '').trim()) {
      throw new Error(
        'PAC modo real: falta contraseña. Edita el PAC y vuelve a escribirla (no dejes ******** si nunca se guardó).'
      );
    }
    try {
      const auth = await authenticateSw({
        urlAuth: pac.urlAuth,
        usuario: pac.usuario,
        password: pac.password,
        timeoutMs: (pac.timeout || 30) * 1000
      });
      token = auth.token;
    } catch (err) {
      lote.estatus = 'error';
      lote.errorMensaje = err.message || String(err);
      lote.finalizadoAt = new Date();
      await lote.save();
      throw err;
    }
  }

  const { catalogoNombres, catalogoMeta } = await resolverCatalogoTimbrado({
    tenantId,
    empresaId,
    subsidiariaId: periodo?.subsidiariaId
  });


  let timbrados = 0;
  let errores = 0;
  let omitidos = 0;
  let folioSeq = 1;

  for (let i = 0; i < lote.items.length; i += 1) {
    const item = lote.items[i];
    if (item.estatus === 'omitido') {
      omitidos += 1;
      continue;
    }
    const key = item.historicoId ? `h:${item.historicoId}` : `r:${item.reciboId}`;
    const src = recibosByKey.get(key);
    item.estatus = 'en_proceso';
    item.intentos = (item.intentos || 0) + 1;
    item.modo = lote.modo;

    try {
      let uuid = '';
      let serie = lote.serie || pac.serieDefault || 'A';
      let folio = String(folioSeq);

      let xmlRaw = '';
      let cfdiPayload = null;
      const sepData = src ? await resolverSeparacionIndemnizacion(tenantId, src) : { aplica: false };
      const empresaCfdi = empresaParaCfdi(empresa, pac);
      const empleadoCfdi = empleadoParaCfdi(src?.empleadoSnap || {}, pac);

      cfdiPayload = buildCfdiNominaPayload({
        empresa: empresaCfdi,
        empleado: empleadoCfdi,
        periodo: { ...periodo, ...(src?.periodoSnap || {}) },
        recibo: src || { netoPagar: item.netoPagar, nombre: item.nombre, numEmpleado: item.numEmpleado },
        conceptos: src?.conceptos || [],
        catalogoMeta,
        separacionIndemnizacion: sepData?.aplica ? sepData : null,
        serie,
        folio,
        fechaEmision: new Date(),
        uuidsRelacionados: item.uuidSustituye ? [item.uuidSustituye] : []
      });

      if (lote.modo === 'real') {
        const formatoStamp = String(lote.formato || pac.formato || 'JSON').toUpperCase();
        const urlStamp =
          pac.urlTimbradoXml && formatoStamp === 'XML'
            ? pac.urlTimbradoXml
            : urlTimbradoParaFormato(pac.urlTimbrado, formatoStamp);

        // Diagnóstico: payload completo antes de enviar al PAC (logs del contenedor).
        console.log(
          `[timbrado] emp=${item.numEmpleado} formato=${formatoStamp} url=${urlStamp}`
        );
        console.log(
          `[timbrado] Fecha CFDI=${cfdiPayload?.json?.Fecha || cfdiPayload?.ctx?.comprobante?.Fecha || ''} ` +
            `emisor.Rfc="${cfdiPayload?.json?.Emisor?.Rfc || ''}" ` +
            `receptor.Rfc="${cfdiPayload?.json?.Receptor?.Rfc || ''}"`
        );
        if (formatoStamp === 'XML') {
          console.log('[timbrado] XML a enviar:\n', cfdiPayload.xml);
        } else {
          console.log('[timbrado] JSON a enviar:\n', JSON.stringify(cfdiPayload.json, null, 2));
        }

        const stamp = await timbrarCfdiSw({
          formato: formatoStamp,
          urlTimbrado: urlStamp,
          urlTimbradoXml: pac.urlTimbradoXml || '',
          token,
          jsonPayload: cfdiPayload.json,
          xmlPayload: cfdiPayload.xml,
          timeoutMs: (pac.timeout || 30) * 1000
        });
        uuid = stamp.uuid;
        // Preferir XML timbrado del PAC (data.cfdi). No usar el XML local sin TFD si el PAC sí devolvió cfdi.
        xmlRaw = stamp.xml || '';
        if (!xmlRaw) {
          console.warn(
            `[timbrado] PAC uuid=${uuid} sin data.cfdi; se usará XML local (sin garantizar TFD embebido)`
          );
          xmlRaw = cfdiPayload.xml;
        }
        console.log(
          `[timbrado] OK uuid=${uuid} xmlLen=${String(xmlRaw || '').length} fecha=${stamp.fechaTimbrado || ''}`
        );
        if (stamp.fechaTimbrado) {
          const ft = new Date(stamp.fechaTimbrado);
          if (!Number.isNaN(ft.getTime())) item.fechaTimbrado = ft;
        }
      } else {
        uuid = uuidSimulado();
        xmlRaw = xmlSimuladoDesdePayload(cfdiPayload, uuid);
      }

      item.uuid = uuid;
      item.serie = serie;
      item.folio = folio;
      if (!item.fechaTimbrado) item.fechaTimbrado = new Date();
      item.estatus = 'timbrado';
      item.errorMensaje = '';
      const shortUuid = uuid.slice(0, 8);
      item.xmlNombre = `cfdi_${item.numEmpleado || i}_${shortUuid}.xml`;
      item.pdfNombre = `recibo_${item.numEmpleado || i}_${shortUuid}.html`;

      const plantilla =
        (lote.plantillaPdfId &&
          (await Plantilla.findOne({ _id: lote.plantillaPdfId, tenantId }).lean())) ||
        (await resolverPlantillaPdf(Plantilla, {
          tenantId,
          empresaId,
          tipoPeriodoId: null,
          rfcEmisor: empresa?.rfc || ''
        }));

      let pdfHtml = '';
      if (plantilla && src) {
        const ctx = buildReciboPdfContext({
          empresa: empresaCfdi,
          empleado: {
            ...empleadoCfdi,
            numEmpleado: item.numEmpleado || empleadoCfdi.numEmpleado,
            nombre: empleadoCfdi.nombre || item.nombre
          },
          periodo: { ...periodo, ...(src.periodoSnap || {}) },
          recibo: src,
          conceptos: src.conceptos,
          cfdi: {
            uuid,
            serie,
            folio,
            fecha: item.fechaTimbrado,
            fechaCertificacion: item.fechaTimbrado,
            separacionIndemnizacion: sepData?.aplica ? sepData : null
          },
          catalogoNombres,
          catalogoMeta
        });
        pdfHtml = renderPlantillaHtml(plantilla.plantillaHtml, ctx);
      }

      if (!xmlRaw && cfdiPayload) {
        xmlRaw = xmlSimuladoDesdePayload(cfdiPayload, uuid);
      }

      const metaComun = {
        tenantId,
        empresaId,
        periodoId: periodo._id,
        loteId: lote._id,
        historicoId: item.historicoId || null,
        reciboId: item.reciboId || null,
        empleadoId: item.empleadoId,
        uuid
      };

      const xmlDoc = await guardarCfdiArchivo({
        ...metaComun,
        tipo: 'xml',
        contentType: 'application/xml; charset=utf-8',
        nombreArchivo: item.xmlNombre,
        data: xmlRaw
      });

      let pdfDoc = null;
      if (pdfHtml) {
        pdfDoc = await guardarCfdiArchivo({
          ...metaComun,
          tipo: 'pdf',
          contentType: 'text/html; charset=utf-8',
          nombreArchivo: item.pdfNombre,
          data: pdfHtml
        });
      }

      item.archivoXmlId = xmlDoc._id;
      item.archivoPdfId = pdfDoc?._id || null;

      const stamp = {
        estatus: 'timbrado',
        loteId: lote._id,
        pacConfigId: pac._id,
        uuid,
        serie,
        folio,
        fechaTimbrado: item.fechaTimbrado,
        xmlNombre: item.xmlNombre,
        pdfNombre: item.pdfNombre,
        archivoXmlId: item.archivoXmlId,
        archivoPdfId: item.archivoPdfId,
        errorMensaje: '',
        intentos: item.intentos,
        modo: lote.modo,
        uuidSustituye: item.uuidSustituye || ''
      };
      if (item.historicoId) {
        const prev = await Historico.findOne({ _id: item.historicoId, tenantId }).select('timbrado').lean();
        await Historico.updateOne(
          { _id: item.historicoId, tenantId },
          { $set: { timbrado: archivarTimbrePrevio(prev?.timbrado, stamp) } }
        );
      } else if (item.reciboId) {
        const prev = await Recibo.findOne({ _id: item.reciboId, tenantId }).select('timbrado').lean();
        await Recibo.updateOne(
          { _id: item.reciboId, tenantId },
          { $set: { timbrado: archivarTimbrePrevio(prev?.timbrado, stamp) } }
        );
      }

      timbrados += 1;
      folioSeq += 1;
    } catch (err) {
      item.estatus = 'error';
      item.errorMensaje = err.message || String(err);
      errores += 1;
    }
  }

  lote.totales.timbrados = timbrados;
  lote.totales.errores = errores;
  lote.totales.omitidos = omitidos;
  lote.finalizadoAt = new Date();
  if (errores && timbrados) lote.estatus = 'completado_parcial';
  else if (errores && !timbrados) lote.estatus = 'error';
  else lote.estatus = 'completado';

  lote.markModified('items');
  await lote.save();

  await Pac.updateOne(
    { _id: pac._id },
    {
      $inc: { totalTimbrados: timbrados },
      $set: { ultimaFechaUso: new Date() }
    }
  );

  return { lote: lote.toObject() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function motivoCancelacionNomina(motivo) {
  const code = String(motivo || '02').trim();
  const row = MOTIVOS_CANCELACION_NOMINA.find((m) => m.value === code);
  if (!row) {
    throw new Error('Motivo de cancelación no válido para nómina. Usa 01, 02 o 03.');
  }
  return row;
}

/**
 * Cancela CFDI de nómina del lote. Nómina = cancelación directa (sin aceptación).
 * Simulación solo marca el lote. Modo real llama al PAC (SW por UUID, u otro por JSON).
 */
async function cancelarRecibosLote({
  tenantId,
  empresaId,
  loteId,
  itemIds = [],
  motivo = '02',
  folioSustitucion = '',
  userLabel = ''
}) {
  const motivoRow = motivoCancelacionNomina(motivo);
  const folio = String(folioSustitucion || '').trim().toUpperCase();
  if (motivoRow.requiereFolio && !UUID_RE.test(folio)) {
    const lotePre = await (await getTimbradoLoteModel()).findOne({ _id: loteId, tenantId, empresaId }).select('items.uuidSustituto').lean();
    const elegidos = new Set((itemIds || []).map(String));
    const sinSustituto = (lotePre?.items || []).filter(
      (it) => elegidos.has(String(it._id)) && !UUID_RE.test(String(it.uuidSustituto || '').trim())
    );
    if (!lotePre || sinSustituto.length) {
      throw new Error('El motivo 01 exige el UUID del CFDI nuevo de cada recibo.');
    }
  }

  const Lote = await getTimbradoLoteModel();
  const Pac = await getPacConfigModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Recibo = await getReciboNominaModel();
  const getEmpresaModel = require('../models/empresa');
  const Empresa = await getEmpresaModel();

  const lote = await Lote.findOne({ _id: loteId, tenantId, empresaId });
  if (!lote) throw new Error('Lote no encontrado');
  const selected = new Set((itemIds || []).map(String).filter(Boolean));
  if (!selected.size) throw new Error('Selecciona al menos un CFDI');

  const targets = (lote.items || []).filter((it) => selected.has(String(it._id)));
  if (!targets.length) throw new Error('Ningún recibo de la selección está en el lote');

  const pac = await Pac.findOne({ _id: lote.pacConfigId, tenantId }).lean();
  if (!pac) throw new Error('PAC del lote no encontrado');
  const empresa = await Empresa.findOne({ _id: empresaId, tenantId }).lean();
  const rfcEmisor = String(empresaParaCfdi(empresa, pac).rfc || '').trim().toUpperCase();
  const modoReal = lote.modo === 'real';
  let token = '';
  async function tokenReal() {
    if (token) return token;
    if (!rfcEmisor) throw new Error('Falta el RFC emisor para cancelar');
    const auth = await authenticateSw({
      urlAuth: pac.urlAuth,
      usuario: pac.usuario,
      password: pac.password,
      timeoutMs: (pac.timeout || 30) * 1000
    });
    token = auth.token;
    return token;
  }

  let cancelados = 0;
  let errores = 0;
  const notas = [];

  for (const item of targets) {
    if (item.estatus === 'cancelado') {
      notas.push(`${item.numEmpleado || item.nombre}: ya estaba cancelado`);
      continue;
    }
    if (item.estatus !== 'timbrado' || !String(item.uuid || '').trim()) {
      errores += 1;
      item.errorMensaje = 'Solo se cancelan CFDI timbrados con UUID';
      notas.push(`${item.numEmpleado || item.nombre}: sin UUID timbrado`);
      continue;
    }
    if (String(item.modo || lote.modo) === 'simulacion' || !modoReal) {
      item.estatus = 'cancelado';
      item.motivoCancelacion = motivoRow.value;
      item.codigoCancelacion = 'SIM';
      item.fechaCancelacion = new Date();
      item.canceladoPorLabel = userLabel;
      item.errorMensaje = 'Cancelado en simulación. No se envió al SAT.';
      cancelados += 1;
      await reflejarCancelacionEnRecibo(Historico, Recibo, tenantId, item);
      continue;
    }

    try {
      const res = await cancelarCfdiPac({
        pac,
        token: await tokenReal(),
        rfcEmisor,
        uuid: item.uuid,
        motivo: motivoRow.value,
        folioSustitucion: motivoRow.requiereFolio
          ? (UUID_RE.test(String(item.uuidSustituto || '').trim())
            ? String(item.uuidSustituto).trim().toUpperCase()
            : folio)
          : '',
        timeoutMs: (pac.timeout || 30) * 1000
      });
      const texto = res.mensaje || CODIGOS_CANCELACION_SAT[res.codigo] || `Código SAT ${res.codigo}`;
      if (!res.cancelado) {
        errores += 1;
        item.errorMensaje = texto;
        notas.push(`${item.numEmpleado || item.nombre}: ${texto}`);
        continue;
      }
      item.estatus = 'cancelado';
      item.motivoCancelacion = motivoRow.value;
      item.codigoCancelacion = res.codigo;
      item.acuseCancelacion = res.acuse || '';
      item.fechaCancelacion = new Date();
      item.canceladoPorLabel = userLabel;
      item.errorMensaje = '';
      cancelados += 1;
      notas.push(`${item.numEmpleado || item.nombre}: ${texto}`);
      await reflejarCancelacionEnRecibo(Historico, Recibo, tenantId, item);
    } catch (err) {
      errores += 1;
      item.errorMensaje = err.message || String(err);
      notas.push(`${item.numEmpleado || item.nombre}: ${item.errorMensaje}`);
    }
  }

  const vivos = (lote.items || []).filter((it) => it.estatus === 'timbrado' && String(it.uuid || '').trim());
  lote.totales.cancelados = (lote.items || []).filter((it) => it.estatus === 'cancelado').length;
  if (!vivos.length && lote.totales.cancelados > 0) lote.estatus = 'cancelado';
  lote.markModified('items');
  lote.markModified('totales');
  await lote.save();

  return { cancelados, errores, notas, estatus: lote.estatus };
}

async function reflejarCancelacionEnRecibo(Historico, Recibo, tenantId, item) {
  const stamp = {
    'timbrado.estatus': 'cancelado',
    'timbrado.motivoCancelacion': item.motivoCancelacion || '',
    'timbrado.codigoCancelacion': item.codigoCancelacion || '',
    'timbrado.acuseCancelacion': item.acuseCancelacion || '',
    'timbrado.fechaCancelacion': item.fechaCancelacion || new Date(),
    'timbrado.canceladoPorLabel': item.canceladoPorLabel || '',
    'timbrado.errorMensaje': item.errorMensaje || ''
  };
  const uuidItem = String(item.uuid || '').trim().toUpperCase();
  const aplicar = async (Model, id) => {
    if (!id) return;
    const doc = await Model.findOne({ _id: id, tenantId }).select('timbrado').lean();
    const actual = String(doc?.timbrado?.uuid || '').trim().toUpperCase();
    // El CFDI nuevo ya ocupó el timbrado vigente. La cancelación del original
    // solo se anota en el historial, para no marcar cancelado al sustituto.
    if (actual && uuidItem && actual !== uuidItem) {
      const historial = Array.isArray(doc.timbrado.historial)
        ? doc.timbrado.historial.map((h) => ({ ...h }))
        : [];
      let found = false;
      for (const h of historial) {
        if (String(h.uuid || '').trim().toUpperCase() !== uuidItem) continue;
        h.estatus = 'cancelado';
        h.motivoCancelacion = item.motivoCancelacion || '';
        h.codigoCancelacion = item.codigoCancelacion || '';
        h.fechaCancelacion = item.fechaCancelacion || new Date();
        h.acuseCancelacion = item.acuseCancelacion || '';
        found = true;
      }
      if (!found) {
        historial.push({
          uuid: item.uuid,
          estatus: 'cancelado',
          motivoCancelacion: item.motivoCancelacion || '',
          codigoCancelacion: item.codigoCancelacion || '',
          fechaCancelacion: item.fechaCancelacion || new Date(),
          acuseCancelacion: item.acuseCancelacion || '',
          modo: item.modo || ''
        });
      }
      await Model.updateOne({ _id: id, tenantId }, { $set: { 'timbrado.historial': historial } });
      return;
    }
    await Model.updateOne({ _id: id, tenantId }, { $set: stamp });
  };
  await aplicar(Historico, item.historicoId);
  await aplicar(Recibo, item.reciboId);
  if (!uuidItem) return;
  const Lote = await getTimbradoLoteModel();
  await Lote.updateMany(
    { tenantId, 'items.uuidSustituto': uuidItem },
    { $set: { 'items.$[it].uuidSustituto': '' } },
    { arrayFilters: [{ 'it.uuidSustituto': uuidItem }] }
  );
}

/**
 * Paso 1 del motivo 01: emite el CFDI nuevo con CfdiRelacionados tipo 04
 * apuntando al UUID que sigue vigente. No cancela el original.
 */
async function emitirSustitucionLote({
  tenantId,
  empresaId,
  empresa,
  loteId,
  itemIds = [],
  userId = '',
  userLabel = ''
}) {
  const Lote = await getTimbradoLoteModel();
  const lote = await Lote.findOne({ _id: loteId, tenantId, empresaId });
  if (!lote) throw new Error('Lote no encontrado');
  const selected = new Set((itemIds || []).map(String).filter(Boolean));
  const elegibles = (lote.items || []).filter(
    (it) => selected.has(String(it._id)) && it.estatus === 'timbrado' && String(it.uuid || '').trim()
  );
  if (!elegibles.length) {
    throw new Error('Selecciona CFDI timbrados y vigentes. El nuevo se emite antes de cancelar el original.');
  }
  const yaSustituido = elegibles.find((it) => String(it.uuidSustituto || '').trim());
  if (yaSustituido) {
    throw new Error(
      `${yaSustituido.numEmpleado || yaSustituido.nombre} ya tiene CFDI nuevo ${yaSustituido.uuidSustituto}. Cancela este original con motivo 01 y ese UUID.`
    );
  }
  const result = await crearYProcesarLote({
    tenantId,
    empresaId,
    empresa,
    periodoId: lote.periodoId,
    pacConfigId: lote.pacConfigId,
    plantillaPdfId: lote.plantillaPdfId,
    forzarReal: lote.modo === 'real',
    userId,
    userLabel,
    procesar: true,
    sustituciones: elegibles.map((it) => ({
      empleadoId: String(it.empleadoId),
      uuid: String(it.uuid).trim().toUpperCase()
    }))
  });
  const nuevo = result.lote;
  for (const it of nuevo.items || []) {
    if (it.estatus !== 'timbrado' || !it.uuid || !it.uuidSustituye) continue;
    const origen = elegibles.find(
      (e) => String(e.uuid || '').trim().toUpperCase() === String(it.uuidSustituye).trim().toUpperCase()
    );
    if (!origen) continue;
    origen.uuidSustituto = String(it.uuid).trim().toUpperCase();
  }
  lote.markModified('items');
  await lote.save();
  return result;
}

function uuidNorma(value) {
  return String(value || '').trim().toUpperCase();
}

/**
 * El lote nuevo apunta al original que todavía hay que cancelar con motivo 01.
 * El lote original lista los CFDI que ya tienen sustituto.
 */
async function contextoCancelacionMotivo01(tenantId, lote) {
  const items = lote?.items || [];
  const pendientesAqui = items
    .filter((it) => it.estatus === 'timbrado' && uuidNorma(it.uuid) && uuidNorma(it.uuidSustituto))
    .map((it) => ({
      numEmpleado: it.numEmpleado || '',
      nombre: it.nombre || '',
      uuidOriginal: it.uuid,
      uuidNuevo: uuidNorma(it.uuidSustituto)
    }));

  const nuevos = items.filter((it) => it.estatus === 'timbrado' && uuidNorma(it.uuidSustituye));
  const origenes = [];
  if (nuevos.length && lote.periodoId) {
    const Lote = await getTimbradoLoteModel();
    const otros = await Lote.find({
      tenantId,
      periodoId: lote.periodoId,
      _id: { $ne: lote._id }
    })
      .select('serie createdAt items.uuid items.estatus items.numEmpleado items.nombre')
      .lean();
    const porOriginal = new Map(nuevos.map((it) => [uuidNorma(it.uuidSustituye), it]));
    for (const otro of otros) {
      const filas = [];
      for (const it of otro.items || []) {
        const nuevo = porOriginal.get(uuidNorma(it.uuid));
        if (!nuevo || it.estatus !== 'timbrado') continue;
        filas.push({
          numEmpleado: it.numEmpleado || nuevo.numEmpleado || '',
          nombre: it.nombre || nuevo.nombre || '',
          uuidOriginal: it.uuid,
          uuidNuevo: nuevo.uuid
        });
      }
      if (!filas.length) continue;
      origenes.push({
        _id: otro._id,
        serie: otro.serie || '',
        createdAt: otro.createdAt || null,
        filas
      });
    }
  }
  return { origenes, pendientesAqui };
}

module.exports = {
  loadRecibosParaTimbrar,
  crearYProcesarLote,
  procesarLote,
  resolverCatalogoTimbrado,
  cancelarRecibosLote,
  emitirSustitucionLote,
  contextoCancelacionMotivo01,
  periodoIdsTimbradosPorCompleto
};
