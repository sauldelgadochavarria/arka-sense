'use strict';

/**
 * Proceso de timbrado CFDI de nómina.
 * v1: arma lote, valida, simula o intenta PAC real (payload mínimo / stub).
 */

const getTimbradoLoteModel = require('../models/timbradoLote');
const getPacConfigModel = require('../models/pacConfig');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getReciboNominaModel = require('../models/reciboNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getEmpleadoModel = require('../models/empleado');
const getReciboPdfPlantillaModel = require('../models/reciboPdfPlantilla');
const getConceptCatalogModel = require('../models/conceptCatalog');
const { authenticateSw, timbrarCfdiSw, uuidSimulado } = require('./pacClientService');
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
const { pacAmbienteEsPrueba } = require('../config/timbradoCatalog');

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
    catalogoNombres[code] = c.nombre;
    catalogoMeta[code] = {
      nombre: c.nombre,
      tipo: c.tipo || c.sat?.tipo || '',
      satTipo: c.sat?.tipo || '',
      naturaleza: c.naturaleza || c.fiscal?.naturaleza || '',
      claveSAT: (c.sat && c.sat.clave) || c.claveSAT || ''
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
 * En ambiente de prueba (PAC ambiente=0) usa RFC/razón social de Config PAC.
 */
function empresaParaCfdi(empresa, pac) {
  const base = { ...(empresa || {}) };
  if (!pacAmbienteEsPrueba(pac?.ambiente)) return base;
  const rfcTest = String(pac.rfcSatTest || '').trim().toUpperCase();
  const nombreTest = String(pac.nombreSatTest || '').trim();
  if (rfcTest) {
    base.rfc = rfcTest;
    if (nombreTest) base.razonSocial = nombreTest;
  }
  if (!base.codigoPostal && !base.cp) {
    base.codigoPostal = '26015';
  }
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
      origen: 'cierre'
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
          numEmpleado: snap.numEmpleado || '',
          nombre: snap.nombre || '',
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
          periodoSnap: h.periodo || {}
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
  procesar = true
}) {
  const Periodo = await getPeriodoNominaModel();
  const Pac = await getPacConfigModel();
  const Lote = await getTimbradoLoteModel();

  const periodo = await Periodo.findOne({ _id: periodoId, tenantId, empresaId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'cerrado') {
    throw new Error('Solo se pueden timbrar períodos cerrados. Cierra el período e inténtalo de nuevo.');
  }

  const pac = await Pac.findOne({ _id: pacConfigId, tenantId, empresaId, activo: true }).lean();
  if (!pac) throw new Error('Configuración PAC no encontrada o inactiva');

  const recibos = await loadRecibosParaTimbrar(tenantId, periodo);
  if (!recibos.length) throw new Error('No hay recibos para timbrar en el período');

  const modo = forzarReal || pac.modoReal ? 'real' : 'simulacion';
  const items = recibos.map((r) => {
    const ini = resolverEstatusInicialItem(r.timbrado, modo);
    return {
      reciboId: r.reciboId,
      historicoId: r.historicoId,
      empleadoId: r.empleadoId,
      numEmpleado: r.numEmpleado,
      nombre: r.nombre,
      netoPagar: r.netoPagar,
      estatus: ini.estatus,
      uuid: ini.uuid,
      serie: ini.serie,
      folio: ini.folio,
      errorMensaje: ini.errorMensaje,
      intentos: 0,
      modo: ''
    };
  });

  const lote = await Lote.create({
    tenantId,
    empresaId,
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
  const Catalog = await getConceptCatalogModel();

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

  const catalogRows = await Catalog.find({}).select('codigo nombre tipo naturaleza claveSAT sat fiscal').lean();
  const { catalogoNombres, catalogoMeta } = catalogMapsFromRows(catalogRows);

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

      cfdiPayload = buildCfdiNominaPayload({
        empresa: empresaCfdi,
        empleado: src?.empleadoSnap || {},
        periodo: { ...periodo, ...(src?.periodoSnap || {}) },
        recibo: src || { netoPagar: item.netoPagar, nombre: item.nombre, numEmpleado: item.numEmpleado },
        conceptos: src?.conceptos || [],
        catalogoMeta,
        separacionIndemnizacion: sepData?.aplica ? sepData : null,
        serie,
        folio,
        fechaEmision: new Date()
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
          `[timbrado] emisor.Rfc="${cfdiPayload?.json?.Emisor?.Rfc || ''}" ` +
            `receptor.Rfc="${cfdiPayload?.json?.Receptor?.Rfc || ''}" ` +
            `empresa.rfc="${empresa?.rfc || ''}"`
        );
        if (formatoStamp === 'XML') {
          console.log('[timbrado] XML a enviar:\n', cfdiPayload.xml);
        } else {
          console.log('[timbrado] JSON a enviar:\n', JSON.stringify(cfdiPayload.json, null, 2));
        }

        const stamp = await timbrarCfdiSw({
          formato: formatoStamp,
          urlTimbrado: urlStamp,
          token,
          jsonPayload: cfdiPayload.json,
          xmlPayload: cfdiPayload.xml,
          timeoutMs: (pac.timeout || 30) * 1000
        });
        uuid = stamp.uuid;
        xmlRaw = stamp.xml || cfdiPayload.xml;
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
          empresa,
          empleado: {
            ...src.empleadoSnap,
            numEmpleado: item.numEmpleado,
            nombre: item.nombre
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
        modo: lote.modo
      };
      if (item.historicoId) {
        await Historico.updateOne({ _id: item.historicoId, tenantId }, { $set: { timbrado: stamp } });
      } else if (item.reciboId) {
        await Recibo.updateOne({ _id: item.reciboId, tenantId }, { $set: { timbrado: stamp } });
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

module.exports = {
  loadRecibosParaTimbrar,
  crearYProcesarLote,
  procesarLote
};
