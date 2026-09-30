'use strict';

const AdmZip = require('adm-zip');
const getCargaInicialJobModel = require('../../models/cargaInicialJob');
const getCargaCfdiStagingModel = require('../../models/cargaCfdiStaging');
const getEmpresaModel = require('../../models/empresa');
const getEmpleadoModel = require('../../models/empleado');
const getDepartamentoModel = require('../../models/departamento');
const getPuestoModel = require('../../models/puesto');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const getNominaHistoricoReciboModel = require('../../models/nominaHistoricoRecibo');
const getNominaAcumuladoModel = require('../../models/nominaAcumulado');
const { parseNomina12Xml } = require('../cfdi/nomina12Parser');
const { normalizeCurp } = require('../../libs/curpDerive');
const {
  buildPeriodosFromStaging,
  lookupPeriodoForPayload,
  resolveTipoPeriodoPorSat
} = require('./cfdiPeriodoInferService');

const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAX_XML_FILES = 5000;
const MAX_ERRORES_UI = 100;
const MAX_MUESTRA = 12;

const DEFAULT_IMPORT_OPTIONS = {
  importEmpresa: true,
  importEmpleados: true,
  importOrganizacion: true,
  importConceptos: true,
  importHistorico: true,
  importAcumulados: true,
  importPeriodos: true,
  excluirExtraordinarias: false,
  actualizarDatosLaborales: true,
  modoEscritura: 'upsert' // upsert | crear_solo | solo_vacios
};

function asBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === '1' || v === 'on' || v === 'true';
}

/** Opciones de bloques desde form body o defaults. */
function parseImportOptions(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const fromForm = src.opcionesForm === '1' || src.opcionesForm === 1 || src.opcionesForm === true;
  const flag = (key, def) => (fromForm ? asBool(src[key], false) : asBool(src[key], def));

  const opts = {
    importEmpresa: flag('importEmpresa', DEFAULT_IMPORT_OPTIONS.importEmpresa),
    importEmpleados: flag('importEmpleados', DEFAULT_IMPORT_OPTIONS.importEmpleados),
    importOrganizacion: flag('importOrganizacion', DEFAULT_IMPORT_OPTIONS.importOrganizacion),
    importConceptos: flag('importConceptos', DEFAULT_IMPORT_OPTIONS.importConceptos),
    importHistorico: flag('importHistorico', DEFAULT_IMPORT_OPTIONS.importHistorico),
    importAcumulados: flag('importAcumulados', DEFAULT_IMPORT_OPTIONS.importAcumulados),
    importPeriodos: flag('importPeriodos', DEFAULT_IMPORT_OPTIONS.importPeriodos),
    excluirExtraordinarias: flag(
      'excluirExtraordinarias',
      DEFAULT_IMPORT_OPTIONS.excluirExtraordinarias
    ),
    actualizarDatosLaborales: flag(
      'actualizarDatosLaborales',
      DEFAULT_IMPORT_OPTIONS.actualizarDatosLaborales
    ),
    modoEscritura: ['upsert', 'crear_solo', 'solo_vacios'].includes(String(src.modoEscritura || ''))
      ? String(src.modoEscritura)
      : DEFAULT_IMPORT_OPTIONS.modoEscritura
  };
  if (!opts.importHistorico) {
    opts.importAcumulados = false;
    opts.importPeriodos = false;
  }
  if (opts.importPeriodos) {
    opts.importHistorico = true;
    opts.importEmpleados = true;
  }
  return opts;
}

function opcionesLabels(opts) {
  const o = parseImportOptions(opts);
  const bloques = [];
  if (o.importEmpresa) bloques.push('Empresa');
  if (o.importEmpleados) bloques.push('Empleados');
  if (o.importOrganizacion) bloques.push('Deptos/puestos');
  if (o.importConceptos) bloques.push('Conceptos');
  if (o.importHistorico) bloques.push('Histórico');
  if (o.importAcumulados) bloques.push('Acumulados');
  if (o.importPeriodos) bloques.push('Períodos');
  const modo =
    o.modoEscritura === 'crear_solo'
      ? 'solo crear'
      : o.modoEscritura === 'solo_vacios'
        ? 'solo vacíos'
        : 'upsert';
  return { bloques, modo, excluirExtra: o.excluirExtraordinarias, laborales: o.actualizarDatosLaborales };
}

function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function empKeyFromPayload(emp) {
  const curp = normalizeCurp(emp.curp);
  const nss = String(emp.nss || '').replace(/\D/g, '');
  const rfc = String(emp.rfc || '').trim().toUpperCase();
  if (curp.length === 18) return `CURP:${curp}`;
  if (nss.length >= 10) return `NSS:${nss}`;
  if (rfc.length >= 12) return `RFC:${rfc}`;
  if (emp.numEmpleado) return `NUM:${String(emp.numEmpleado).trim()}`;
  return null;
}

function extractXmlEntries(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const xmls = [];
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName || '';
    if (!/\.xml$/i.test(name)) continue;
    if (/__MACOSX|\.DS_Store/i.test(name)) continue;
    xmls.push({ name, text: e.getData().toString('utf8') });
  }
  return xmls;
}

async function crearYValidarDesdeZip({
  tenantId,
  empresaId,
  zipBuffer,
  archivoNombre = 'cfdi.zip',
  anio = new Date().getFullYear(),
  userId = '',
  userLabel = '',
  opciones: opcionesIn = {}
}) {
  const opciones = parseImportOptions(opcionesIn);
  if (!Buffer.isBuffer(zipBuffer) || !zipBuffer.length) {
    throw new Error('ZIP vacío');
  }
  if (zipBuffer.length > MAX_ZIP_BYTES) {
    throw new Error(`ZIP demasiado grande (máx ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB)`);
  }

  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findById(empresaId).lean();
  if (!empresa) throw new Error('Empresa no encontrada');

  let xmls;
  try {
    xmls = extractXmlEntries(zipBuffer);
  } catch (err) {
    throw new Error(`No se pudo leer el ZIP: ${err.message}`);
  }
  if (!xmls.length) throw new Error('El ZIP no contiene archivos .xml');
  if (xmls.length > MAX_XML_FILES) {
    throw new Error(`Demasiados XML (${xmls.length}). Máximo ${MAX_XML_FILES}.`);
  }

  const Job = await getCargaInicialJobModel();
  const Staging = await getCargaCfdiStagingModel();

  const job = await Job.create({
    tenantId,
    empresaId,
    tipo: 'cfdi_nomina_zip',
    estatus: 'borrador',
    modo: 'dry_run',
    archivoNombre: archivoNombre || 'cfdi.zip',
    totalFilas: xmls.length,
    userId,
    userLabel,
    notas: `Parseando ${xmls.length} XML del año ${anio}…`
  });

  const byUuid = new Map();
  const errores = [];
  const omitidos = [];
  const okDocs = [];
  const bitacoraGlobal = [];

  let fila = 0;
  for (const { name, text } of xmls) {
    fila += 1;
    const parsed = parseNomina12Xml(text, { anioFiltro: anio });
    if (!parsed.ok) {
      if (parsed.error === 'fuera_de_anio') {
        omitidos.push({ fila, archivo: name, motivo: `año ${parsed.anio} ≠ ${anio}`, uuid: parsed.uuid || '' });
        continue;
      }
      errores.push({
        fila,
        campo: 'xml',
        mensaje: parsed.error || 'error_parse',
        valor: name
      });
      continue;
    }

    const d = parsed.data;
    if (opciones.excluirExtraordinarias && String(d.tipoNomina).toUpperCase() === 'E') {
      omitidos.push({ fila, archivo: name, motivo: 'extraordinaria_excluida', uuid: d.uuid });
      continue;
    }
    if (byUuid.has(d.uuid)) {
      omitidos.push({ fila, archivo: name, motivo: 'uuid_duplicado_en_zip', uuid: d.uuid });
      continue;
    }
    byUuid.set(d.uuid, true);

    const rfcEmpresa = String(empresa.rfc || '').toUpperCase();
    if (rfcEmpresa && d.emisor.rfc && rfcEmpresa !== d.emisor.rfc) {
      d.bitacora.push({
        tipo: 'rfc_emisor_distinto',
        detalle: `${d.emisor.rfc} vs empresa ${rfcEmpresa}`
      });
    }

    okDocs.push({
      tenantId,
      jobId: job._id,
      uuid: d.uuid,
      anio: d.anio,
      payload: d,
      bitacora: d.bitacora || [],
      estatus: 'ok'
    });
  }

  if (okDocs.length) {
    // Insert en lotes
    const chunk = 200;
    for (let i = 0; i < okDocs.length; i += chunk) {
      await Staging.insertMany(okDocs.slice(i, i + chunk), { ordered: false }).catch(() => {});
    }
  }

  // Preview de catálogos / empleados
  const Empleado = await getEmpleadoModel();
  const existentes = await Empleado.find({ tenantId })
    .select('_id numEmpleado curp nss rfc')
    .lean();
  const byCurp = new Map();
  const byNss = new Map();
  const byRfc = new Map();
  const byNum = new Map();
  for (const e of existentes) {
    if (e.curp) byCurp.set(normalizeCurp(e.curp), e);
    if (e.nss) byNss.set(String(e.nss).replace(/\D/g, ''), e);
    if (e.rfc) byRfc.set(String(e.rfc).toUpperCase(), e);
    if (e.numEmpleado) byNum.set(String(e.numEmpleado), e);
  }

  function findEmp(emp) {
    const curp = normalizeCurp(emp.curp);
    const nss = String(emp.nss || '').replace(/\D/g, '');
    const rfc = String(emp.rfc || '').toUpperCase();
    return (
      (curp && byCurp.get(curp)) ||
      (nss && byNss.get(nss)) ||
      (rfc && byRfc.get(rfc)) ||
      (emp.numEmpleado && byNum.get(String(emp.numEmpleado))) ||
      null
    );
  }

  const empKeys = new Map();
  const deptos = new Set();
  const puestos = new Set();
  const conceptos = new Map();
  let totalNeto = 0;
  let noCuadra = 0;
  let crearEmp = 0;
  let actualizarEmp = 0;

  for (const doc of okDocs) {
    const d = doc.payload;
    totalNeto += d.totales.totalXml || 0;
    if (!d.totales.cuadra) noCuadra += 1;
    if (d.empleado.departamento) deptos.add(normName(d.empleado.departamento));
    if (d.empleado.puesto) puestos.add(normName(d.empleado.puesto));
    for (const c of d.conceptos || []) {
      const k = `${c.tipo}|${c.conceptoCodigo}`;
      if (!conceptos.has(k)) conceptos.set(k, c);
    }
    const key = empKeyFromPayload(d.empleado);
    if (!key) {
      bitacoraGlobal.push({ tipo: 'empleado_sin_llave', uuid: d.uuid });
      continue;
    }
    if (!empKeys.has(key)) {
      const found = findEmp(d.empleado);
      empKeys.set(key, { emp: d.empleado, existe: !!found, accion: found ? 'actualizar' : 'crear' });
      if (found) actualizarEmp += 1;
      else crearEmp += 1;
    }
  }

  const filasOk = okDocs.length;
  const filasError = errores.length;
  const estatus = filasOk === 0 ? 'error' : filasError > 0 ? 'validado' : 'validado';

  job.estatus = estatus;
  job.filasOk = filasOk;
  job.filasError = filasError;
  job.errores = errores.slice(0, MAX_ERRORES_UI);
  job.muestraOk = okDocs.slice(0, MAX_MUESTRA).map((d) => ({
    uuid: d.uuid,
    numEmpleado: d.payload.empleado.numEmpleado,
    nombre: d.payload.empleado.nombre,
    neto: d.payload.totales.totalXml,
    fechaPago: d.payload.fechaPago,
    cuadra: d.payload.totales.cuadra
  }));
  job.resumen = {
    anio,
    opciones,
    opcionesResumen: opcionesLabels(opciones),
    xmlEnZip: xmls.length,
    recibosOk: filasOk,
    omitidos: omitidos.length,
    omitidosMuestra: omitidos.slice(0, 20),
    empleadosUnicos: empKeys.size,
    empleadosCrear: crearEmp,
    empleadosActualizar: actualizarEmp,
    departamentos: [...deptos].sort(),
    puestos: [...puestos].sort(),
    conceptosDetectados: conceptos.size,
    conceptosMuestra: [...conceptos.values()].slice(0, 30),
    totalNeto: Math.round(totalNeto * 100) / 100,
    recibosNoCuadran: noCuadra,
    rfcEmpresa: empresa.rfc || '',
    rfcEmisorMuestra: okDocs[0]?.payload?.emisor?.rfc || '',
    bitacora: bitacoraGlobal.slice(0, 40),
    conciliacion: {
      porRecibo: 'percepciones - deducciones + otrosPagos ≈ Total XML',
      recibosOk: filasOk,
      recibosOmitidos: omitidos.length,
      recibosError: filasError
    },
    planAplicacion: {
      empresa: opciones.importEmpresa,
      empleados: opciones.importEmpleados
        ? `${crearEmp} crear / ${actualizarEmp} actualizar (${opciones.modoEscritura})`
        : 'omitido',
      organizacion: opciones.importOrganizacion
        ? `${deptos.size} deptos / ${puestos.size} puestos`
        : 'omitido',
      conceptos: opciones.importConceptos ? `${conceptos.size} conceptos` : 'omitido',
      historico: opciones.importHistorico ? `${filasOk} recibos` : 'omitido',
      acumulados: opciones.importAcumulados ? 'desde recibos del lote' : 'omitido'
    }
  };
  const lab = opcionesLabels(opciones);
  job.notas =
    filasOk > 0
      ? `Dry-run OK: ${filasOk} recibos · bloques: ${lab.bloques.join(', ') || 'ninguno'} · modo ${lab.modo}.`
      : 'Ningún XML válido para el año / filtros indicados.';
  await job.save();

  return job;
}

async function findOrCreateDepto(Departamento, tenantId, empresaId, nombre) {
  const n = normName(nombre);
  if (!n) return null;
  let doc = await Departamento.findOne({ tenantId, nombre: new RegExp(`^${escapeRe(n)}$`, 'i') });
  if (doc) return doc;
  try {
    doc = await Departamento.create({
      tenantId,
      empresaId,
      nombre: n,
      descripcion: 'Importado desde CFDI',
      activo: true
    });
  } catch (_) {
    doc = await Departamento.findOne({ tenantId, nombre: n });
  }
  return doc;
}

async function findOrCreatePuesto(Puesto, tenantId, empresaId, nombre) {
  const n = normName(nombre);
  if (!n) return null;
  let doc = await Puesto.findOne({ tenantId, nombre: new RegExp(`^${escapeRe(n)}$`, 'i') });
  if (doc) return doc;
  try {
    doc = await Puesto.create({
      tenantId,
      empresaId,
      nombre: n,
      descripcion: 'Importado desde CFDI',
      activo: true
    });
  } catch (_) {
    doc = await Puesto.findOne({ tenantId, nombre: n });
  }
  return doc;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function upsertConcepto(Concepto, tenantId, empresaId, c) {
  const codigo = String(c.conceptoCodigo || '').toUpperCase();
  if (!codigo) return null;
  const tipo = c.tipo === 'deduccion' ? 'deduccion' : c.tipo === 'otro_pago' ? 'otro_pago' : 'percepcion';
  await Concepto.updateOne(
    { tenantId, codigo },
    {
      $set: {
        nombre: c.nombre || codigo,
        tipo,
        claveSAT: c.claveSat || '',
        'sat.clave': c.claveSat || '',
        activo: true,
        aplicaEn: 'nomina'
      },
      $setOnInsert: {
        tenantId,
        empresaId,
        codigo,
        naturaleza: c.gravado > 0 && c.exento > 0 ? 'mixto' : c.exento > 0 ? 'exento' : 'gravado',
        ordenCalculo: 100,
        ordenImpresion: 100,
        codigoExterno: c.claveInterna || ''
      }
    },
    { upsert: true }
  );
  return codigo;
}

async function resolveEmpleadoId(
  Empleado,
  tenantId,
  empresaId,
  emp,
  deptoId,
  puestoId,
  {
    modoEscritura = 'upsert',
    actualizarDatosLaborales = true,
    permitirCrear = true,
    tipoPeriodoId = null
  } = {}
) {
  const curp = normalizeCurp(emp.curp);
  const nss = String(emp.nss || '').replace(/\D/g, '');
  const rfc = String(emp.rfc || '').toUpperCase();
  const num = String(emp.numEmpleado || '').trim();

  let existing =
    (curp && (await Empleado.findOne({ tenantId, empresaId, curp }).lean())) ||
    (nss && (await Empleado.findOne({ tenantId, empresaId, nss }).lean())) ||
    (rfc && (await Empleado.findOne({ tenantId, empresaId, rfc }).lean())) ||
    (num && (await Empleado.findOne({ tenantId, empresaId, numEmpleado: num }).lean())) ||
    (curp && (await Empleado.findOne({ tenantId, curp }).lean())) ||
    (nss && (await Empleado.findOne({ tenantId, nss }).lean())) ||
    null;

  const payloadFull = {
    firstName: emp.firstName || 'SIN',
    lastName: emp.lastName || 'NOMBRE',
    rfc: rfc || undefined,
    curp: curp || undefined,
    nss: nss || undefined,
    tipoContrato: emp.tipoContrato || undefined,
    estatus: 'activo',
    activo: true,
    'domicilio.codigoPostal': emp.codigoPostal || undefined,
    'domicilio.entidad': emp.entidadFederativa || undefined,
    entidadNacimiento: emp.entidadNacimiento || undefined,
    sexo: emp.sexo || undefined,
    fechaNacimiento: emp.fechaNacimiento || undefined,
    fechaIngreso: emp.fechaIngreso || undefined
  };

  if (actualizarDatosLaborales) {
    payloadFull.salarioDiario = emp.sdi || emp.sbc || undefined;
    payloadFull.sdi = emp.sdi || undefined;
    payloadFull.departamentoId = deptoId || undefined;
    payloadFull.puestoId = puestoId || undefined;
  }

  if (tipoPeriodoId) {
    payloadFull.tipoPeriodoId = tipoPeriodoId;
  }

  Object.keys(payloadFull).forEach((k) => payloadFull[k] === undefined && delete payloadFull[k]);

  if (existing) {
    if (modoEscritura === 'crear_solo') {
      if (tipoPeriodoId && !existing.tipoPeriodoId) {
        await Empleado.updateOne({ _id: existing._id }, { $set: { tipoPeriodoId } });
      }
      return existing._id;
    }
    if (modoEscritura === 'solo_vacios') {
      const setOnlyEmpty = {};
      for (const [k, v] of Object.entries(payloadFull)) {
        if (v == null || v === '') continue;
        const cur = k.includes('.')
          ? k.split('.').reduce((acc, p) => (acc == null ? acc : acc[p]), existing)
          : existing[k];
        if (cur == null || cur === '') setOnlyEmpty[k] = v;
      }
      if (Object.keys(setOnlyEmpty).length) {
        await Empleado.updateOne({ _id: existing._id }, { $set: setOnlyEmpty });
      }
      return existing._id;
    }
    // upsert
    await Empleado.updateOne({ _id: existing._id }, { $set: payloadFull });
    return existing._id;
  }

  if (!permitirCrear) return null;

  const numEmpleado = num || `CFDI${(nss || curp || rfc || Date.now()).toString().slice(-8)}`;
  const created = await Empleado.create({
    tenantId,
    empresaId,
    numEmpleado,
    ...payloadFull,
    firstName: payloadFull.firstName,
    lastName: payloadFull.lastName,
    departamentoId: deptoId || undefined,
    puestoId: puestoId || undefined,
    salarioDiario: emp.sdi || emp.sbc || undefined,
    sdi: emp.sdi || undefined,
    tipoPeriodoId: tipoPeriodoId || undefined
  });
  return created._id;
}

async function aplicarJobCfdi(
  tenantId,
  jobId,
  {
    userId = '',
    userLabel = '',
    opcionesOverride = null,
    allowTipos = ['cfdi_nomina_zip'],
    allowEstatus = ['validado', 'parcial', 'aplicando', 'ok'],
    onProgress = null
  } = {}
) {
  const Job = await getCargaInicialJobModel();
  const Staging = await getCargaCfdiStagingModel();
  const tipos = Array.isArray(allowTipos) && allowTipos.length ? allowTipos : ['cfdi_nomina_zip'];
  const job = await Job.findOne({ _id: jobId, tenantId, tipo: { $in: tipos } });
  if (!job) throw new Error('Job CFDI no encontrado');
  const estatusOk = Array.isArray(allowEstatus) ? allowEstatus : ['validado', 'parcial'];
  if (!estatusOk.includes(job.estatus)) {
    throw new Error(`El job no está listo para aplicar (estatus: ${job.estatus})`);
  }

  const opciones = parseImportOptions(opcionesOverride || job.resumen?.opciones || {});
  job.estatus = 'aplicando';
  job.modo = 'aplicar';
  if (!job.resumen) job.resumen = {};
  job.resumen.opciones = opciones;
  job.resumen.opcionesResumen = opcionesLabels(opciones);
  await job.save();

  const Empresa = await getEmpresaModel();
  const Empleado = await getEmpleadoModel();
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const Concepto = await getConceptoNominaModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Acumulado = await getNominaAcumuladoModel();

  const empresa = await Empresa.findById(job.empresaId);
  const totalDocs = await Staging.countDocuments({ jobId: job._id, estatus: 'ok' });

  let aplicadas = 0;
  let procesados = 0;
  const erroresApply = [];
  const deptoCache = new Map();
  const puestoCache = new Map();
  const empCache = new Map();
  const conceptoDone = new Set();
  const acumuladoMap = new Map();
  let lastProgressAt = 0;

  async function reportProgress(force = false) {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastProgressAt < 2000) return;
    lastProgressAt = now;
    try {
      await onProgress({
        total: totalDocs,
        procesados,
        exitos: aplicadas,
        errores: erroresApply.length,
        omitidos: 0,
        mensaje: `${procesados} / ${totalDocs} · OK ${aplicadas}`
      });
    } catch (_) {
      /* no bloquear apply por fallo de UI */
    }
  }

  // Semilla empresa desde el primer staging (sin cargar todo)
  if (opciones.importEmpresa && empresa) {
    const first = await Staging.findOne({ jobId: job._id, estatus: 'ok' })
      .select('payload.emisor')
      .lean();
    const em = first?.payload?.emisor;
    if (em) {
      const setEmp = {};
      if (!empresa.rfc && em.rfc) setEmp.rfc = em.rfc;
      if ((!empresa.razonSocial || empresa.razonSocial === empresa.nombreComercial) && em.nombre) {
        setEmp.razonSocial = em.nombre;
      }
      if (!empresa.registroPatronal && em.registroPatronal) {
        setEmp.registroPatronal = em.registroPatronal;
      }
      if (!empresa.codigoPostal && em.lugarExpedicion) setEmp.codigoPostal = em.lugarExpedicion;
      if (Object.keys(setEmp).length) {
        await Empresa.updateOne({ _id: empresa._id }, { $set: setEmp });
      }
    }
  }

  try {
    await Historico.collection.dropIndex('tenantId_1_periodoId_1_empleadoId_1');
  } catch (_) {
    /* ok */
  }

  const needEmp =
    opciones.importEmpleados || opciones.importHistorico || opciones.importAcumulados;

  let periodMap = new Map();
  let tipoCache = new Map();
  let periodoStats = null;

  if (opciones.importPeriodos) {
    if (typeof onProgress === 'function') {
      await onProgress({
        total: totalDocs,
        procesados: 0,
        exitos: 0,
        errores: 0,
        mensaje: 'Inferiendo tipos y períodos desde CFDI…'
      });
    }
    const built = await buildPeriodosFromStaging({
      tenantId,
      empresaId: job.empresaId,
      jobId: job._id,
      Staging,
      excluirExtraordinarias: opciones.excluirExtraordinarias,
      subsidiariaId: job.resumen?.subsidiariaId || null,
      onProgress: async (p) => {
        if (typeof onProgress !== 'function') return;
        await onProgress({
          total: totalDocs,
          procesados: 0,
          exitos: 0,
          errores: 0,
          mensaje: p.mensaje || 'Preparando períodos…'
        });
      }
    });
    periodMap = built.periodMap;
    tipoCache = built.tipoCache;
    periodoStats = built.stats;
  }

  const cursor = Staging.find({ jobId: job._id, estatus: 'ok' })
    .lean()
    .cursor({ batchSize: 80 });

  await reportProgress(true);

  for await (const doc of cursor) {
    const d = doc.payload;
    procesados += 1;
    try {
      if (opciones.excluirExtraordinarias && String(d.tipoNomina).toUpperCase() === 'E') {
        await reportProgress();
        continue;
      }

      let depto = null;
      let puesto = null;
      const deptoName = normName(d.empleado.departamento);
      const puestoName = normName(d.empleado.puesto);

      if (opciones.importOrganizacion) {
        if (deptoName && !deptoCache.has(deptoName)) {
          deptoCache.set(
            deptoName,
            await findOrCreateDepto(Departamento, tenantId, job.empresaId, deptoName)
          );
        }
        if (puestoName && !puestoCache.has(puestoName)) {
          puestoCache.set(
            puestoName,
            await findOrCreatePuesto(Puesto, tenantId, job.empresaId, puestoName)
          );
        }
        depto = deptoName ? deptoCache.get(deptoName) : null;
        puesto = puestoName ? puestoCache.get(puestoName) : null;
      }

      if (opciones.importConceptos) {
        for (const c of d.conceptos || []) {
          const ck = `${c.tipo}|${String(c.conceptoCodigo || '').toUpperCase()}`;
          if (!c.conceptoCodigo || conceptoDone.has(ck)) continue;
          await upsertConcepto(Concepto, tenantId, job.empresaId, c);
          conceptoDone.add(ck);
        }
      }

      const periodoInfo = opciones.importPeriodos
        ? lookupPeriodoForPayload(periodMap, tipoCache, d)
        : null;

      let tipoPeriodoId = periodoInfo?.tipoPeriodoId || null;
      if (!tipoPeriodoId && opciones.importPeriodos && d.empleado?.periodicidadPago) {
        const t = await resolveTipoPeriodoPorSat(
          tenantId,
          job.empresaId,
          d.empleado.periodicidadPago,
          tipoCache
        );
        tipoPeriodoId = t?._id || null;
      }

      let empleadoId = null;
      if (needEmp) {
        const key = empKeyFromPayload(d.empleado) || d.uuid;
        if (!empCache.has(key)) {
          const empId = await resolveEmpleadoId(
            Empleado,
            tenantId,
            job.empresaId,
            d.empleado,
            depto?._id || null,
            puesto?._id || null,
            {
              modoEscritura: opciones.modoEscritura,
              actualizarDatosLaborales: opciones.actualizarDatosLaborales,
              permitirCrear: opciones.importEmpleados,
              tipoPeriodoId
            }
          );
          empCache.set(key, empId);
        } else if (tipoPeriodoId) {
          // Asegura clasificación aunque el empleado ya estaba en cache
          await Empleado.updateOne(
            { _id: empCache.get(key), $or: [{ tipoPeriodoId: null }, { tipoPeriodoId: { $exists: false } }] },
            { $set: { tipoPeriodoId } }
          ).catch(() => {});
        }
        empleadoId = empCache.get(key);
        if (!empleadoId && (opciones.importHistorico || opciones.importAcumulados)) {
          throw new Error('Empleado no encontrado y creación desactivada');
        }
      }

      if (!opciones.importHistorico && !opciones.importAcumulados) {
        if (opciones.importEmpleados || opciones.importOrganizacion || opciones.importConceptos) {
          aplicadas += 1;
        }
        await reportProgress();
        continue;
      }

      if (!empleadoId) {
        await reportProgress();
        continue;
      }

      const fechaPago = d.fechaPago ? new Date(d.fechaPago) : new Date();
      const anio = d.anio || fechaPago.getUTCFullYear();
      const mes = fechaPago.getUTCMonth() + 1;
      const fechaInicio = d.fechaInicio ? new Date(d.fechaInicio) : fechaPago;
      const fechaFin = d.fechaFin ? new Date(d.fechaFin) : fechaPago;

      const conceptosHist = (d.conceptos || []).map((c) => ({
        conceptoCodigo: c.conceptoCodigo,
        importe: c.importe,
        gravado: c.gravado,
        exento: c.exento,
        claveSAT: c.claveSat,
        tipo: c.tipo,
        formulaUsada: '',
        versionFormula: 1
      }));

      if (opciones.importHistorico) {
        await Historico.updateOne(
          { tenantId, claveImportacion: d.uuid },
          {
            $set: {
              empresaId: job.empresaId,
              empleadoId,
              anio,
              mes,
              origen: 'importacion',
              claveImportacion: d.uuid,
              periodoId: periodoInfo?.periodoNominaId || null,
              periodo: {
                tipoPeriodo: periodoInfo?.tipoMotor || d.empleado.periodicidadPago || '',
                tipoNomina: d.tipoNomina === 'E' ? 'extraordinaria' : 'ordinaria',
                numeroPeriodo: periodoInfo?.numeroPeriodo ?? null,
                fechaInicio,
                fechaFin,
                diasPeriodo: d.diasPagados || 0
              },
              empleado: {
                numEmpleado: d.empleado.numEmpleado || '',
                nombre: d.empleado.nombre || '',
                tipoEmpleado: '',
                tipoContrato: d.empleado.tipoContrato || '',
                departamentoId: depto?._id || null,
                departamentoNombre: deptoName || '',
                centroCostoId: null,
                centroCostoCodigo: '',
                centroCostoNombre: deptoName || ''
              },
              diasPagados: d.diasPagados || null,
              totalPercepciones: d.totales.percepciones,
              totalDeducciones: d.totales.deducciones,
              netoPagar: d.totales.totalXml,
              conceptos: conceptosHist,
              insumosFuente: 'importacion_cfdi',
              fechaCierre: fechaPago,
              fechaCalculo: d.fechaTimbrado || fechaPago,
              'timbrado.estatus': 'timbrado',
              'timbrado.uuid': d.uuid,
              'timbrado.serie': d.serie || '',
              'timbrado.folio': d.folio || '',
              'timbrado.fechaTimbrado': d.fechaTimbrado || null,
              'timbrado.modo': 'real'
            },
            $setOnInsert: {
              tenantId,
              reciboOrigenId: null
            }
          },
          { upsert: true }
        );
      }

      if (opciones.importAcumulados) {
        for (const c of conceptosHist) {
          const ak = `${String(empleadoId)}|${anio}|${c.conceptoCodigo}`;
          if (!acumuladoMap.has(ak)) {
            acumuladoMap.set(ak, {
              empleadoId,
              anio,
              conceptoCodigo: c.conceptoCodigo,
              importeAnual: 0,
              gravadoAnual: 0,
              exentoAnual: 0,
              porMes: {}
            });
          }
          const acc = acumuladoMap.get(ak);
          acc.importeAnual += c.importe || 0;
          acc.gravadoAnual += c.gravado || 0;
          acc.exentoAnual += c.exento || 0;
          const mk = String(mes);
          if (!acc.porMes[mk]) acc.porMes[mk] = { importe: 0, gravado: 0, exento: 0 };
          acc.porMes[mk].importe += c.importe || 0;
          acc.porMes[mk].gravado += c.gravado || 0;
          acc.porMes[mk].exento += c.exento || 0;
        }
      }

      aplicadas += 1;
    } catch (err) {
      erroresApply.push({
        fila: aplicadas + erroresApply.length + 1,
        campo: 'uuid',
        mensaje: err.message || 'Error al aplicar',
        valor: d?.uuid || ''
      });
    }

    if (procesados % 25 === 0) {
      await reportProgress();
      // ceder el event loop para no congelar el proceso HTTP
      await new Promise((r) => setImmediate(r));
    }
  }

  await reportProgress(true);

  if (opciones.importAcumulados) {
    for (const acc of acumuladoMap.values()) {
      try {
        const setFields = {
          empresaId: job.empresaId,
          importeAnual: Math.round(acc.importeAnual * 100) / 100,
          gravadoAnual: Math.round(acc.gravadoAnual * 100) / 100,
          exentoAnual: Math.round(acc.exentoAnual * 100) / 100
        };
        for (const [m, b] of Object.entries(acc.porMes)) {
          setFields[`porMes.${m}`] = {
            importe: Math.round(b.importe * 100) / 100,
            gravado: Math.round(b.gravado * 100) / 100,
            exento: Math.round(b.exento * 100) / 100
          };
        }
        await Acumulado.updateOne(
          {
            tenantId,
            empleadoId: acc.empleadoId,
            anio: acc.anio,
            conceptoCodigo: acc.conceptoCodigo
          },
          {
            $set: setFields,
            $setOnInsert: {
              tenantId,
              empleadoId: acc.empleadoId,
              anio: acc.anio,
              conceptoCodigo: acc.conceptoCodigo
            }
          },
          { upsert: true }
        );
      } catch (err) {
        erroresApply.push({
          fila: 0,
          campo: 'acumulado',
          mensaje: err.message,
          valor: acc.conceptoCodigo
        });
      }
    }
  }

  const lab = opcionesLabels(opciones);
  job.filasAplicadas = aplicadas;
  job.errores = [...(job.errores || []), ...erroresApply].slice(0, MAX_ERRORES_UI);
  job.filasError = (job.filasError || 0) + erroresApply.length;
  job.aplicadoAt = new Date();
  job.userId = userId || job.userId;
  job.userLabel = userLabel || job.userLabel;
  job.estatus = erroresApply.length === 0 ? 'ok' : aplicadas > 0 ? 'parcial' : 'error';
  job.notas = `Aplicado (${lab.bloques.join(', ') || 'sin bloques'}): ${aplicadas} recibos · ${empCache.size} empleados · ${acumuladoMap.size} acumulados${
    periodoStats ? ` · ${periodoStats.ventanas} períodos` : ''
  }.`;
  job.resumen = {
    ...(job.resumen || {}),
    opciones,
    opcionesResumen: lab,
    aplicadas,
    empleadosAfectados: empCache.size,
    acumuladosEscritos: acumuladoMap.size,
    erroresApply: erroresApply.length,
    periodos: periodoStats || null
  };
  await job.save();
  return job;
}

module.exports = {
  crearYValidarDesdeZip,
  aplicarJobCfdi,
  extractXmlEntries,
  parseImportOptions,
  opcionesLabels,
  DEFAULT_IMPORT_OPTIONS
};
