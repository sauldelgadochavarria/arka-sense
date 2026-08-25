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
const { authenticateSw, timbrarJsonSw, uuidSimulado } = require('./pacClientService');
const {
  renderPlantillaHtml,
  buildReciboPdfContext,
  resolverPlantillaPdf,
  enrichEmpleadoPdf,
  mergeEmpleadoPdf
} = require('./reciboPdfService');
const { buildXmlSimulado, guardarCfdiArchivo } = require('./cfdiArchivoService');
const {
  buildSeparacionIndemnizacionData,
  buildSeparacionIndemnizacionJson
} = require('./cfdi/separacionIndemnizacionBuilder');
const getFiniquitoCalculoModel = require('../models/finiquitoCalculo');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
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
  return { catalogoNombres, catalogoMeta };
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
  if (!['calculado', 'cerrado'].includes(periodo.estatus)) {
    throw new Error('El período debe estar calculado o cerrado para timbrar');
  }

  const pac = await Pac.findOne({ _id: pacConfigId, tenantId, empresaId, activo: true }).lean();
  if (!pac) throw new Error('Configuración PAC no encontrada o inactiva');

  const recibos = await loadRecibosParaTimbrar(tenantId, periodo);
  if (!recibos.length) throw new Error('No hay recibos para timbrar en el período');

  const modo = forzarReal || pac.modoReal ? 'real' : 'simulacion';
  const items = recibos.map((r) => ({
    reciboId: r.reciboId,
    historicoId: r.historicoId,
    empleadoId: r.empleadoId,
    numEmpleado: r.numEmpleado,
    nombre: r.nombre,
    netoPagar: r.netoPagar,
    estatus: r.timbrado?.estatus === 'timbrado' ? 'omitido' : 'pendiente',
    uuid: r.timbrado?.uuid || '',
    serie: r.timbrado?.serie || '',
    folio: r.timbrado?.folio || '',
    errorMensaje: '',
    intentos: 0,
    modo: ''
  }));

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
      const sepData = src ? await resolverSeparacionIndemnizacion(tenantId, src) : { aplica: false };
      const sepJson = buildSeparacionIndemnizacionJson(sepData);

      if (lote.modo === 'real') {
        // Payload CFDI nómina: incluye SeparacionIndemnizacion cuando aplica (022/023/025).
        // El resto del mapping SAT (Emisor/Receptor/Percepciones completas) sigue en evolución.
        const payload = {
          Version: '4.0',
          _nota:
            'Payload CFDI nómina parcial: SeparacionIndemnizacion listo; completar mapping SAT restante.',
          Receptor: { Nombre: item.nombre },
          Totales: { Neto: item.netoPagar },
          Nomina12: {
            TipoNomina: String(periodo.tipoNomina || '').toLowerCase().includes('finiquito')
              ? 'E'
              : 'O',
            ...(sepJson || {})
          }
        };
        const resp = await timbrarJsonSw({
          urlTimbrado: pac.urlTimbrado,
          token,
          payload,
          timeoutMs: (pac.timeout || 30) * 1000
        });
        uuid = resp.data?.uuid || resp.uuid || '';
        if (!uuid) throw new Error('PAC no devolvió UUID (revisar payload CFDI)');
        xmlRaw =
          resp.data?.cfdi ||
          resp.data?.xml ||
          resp.cfdi ||
          resp.xml ||
          '';
      } else {
        uuid = uuidSimulado();
      }

      item.uuid = uuid;
      item.serie = serie;
      item.folio = folio;
      item.fechaTimbrado = new Date();
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

      if (!xmlRaw) {
        const tipoNominaCfdi =
          String(periodo.tipoNomina || '').toLowerCase().includes('finiquito') ||
          String(periodo.tipoNomina || '').toLowerCase().includes('indemnizacion')
            ? 'E'
            : 'O';
        xmlRaw = buildXmlSimulado({
          uuid,
          serie,
          folio,
          fechaTimbrado: item.fechaTimbrado,
          rfcEmisor: empresa?.rfc || '',
          nombreEmisor: empresa?.razonSocial || empresa?.nombreComercial || '',
          rfcReceptor: src?.empleadoSnap?.rfc || '',
          nombreReceptor: item.nombre,
          total: item.netoPagar,
          tipoNomina: tipoNominaCfdi,
          fechaPago: periodo.fechaFin || item.fechaTimbrado,
          fechaInicialPago: periodo.fechaInicio || item.fechaTimbrado,
          fechaFinalPago: periodo.fechaFin || item.fechaTimbrado,
          numDiasPagados: periodo.diasPeriodo || src?.diasLaborados || 1,
          separacionIndemnizacion: sepData?.aplica ? sepData : null
        });
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
