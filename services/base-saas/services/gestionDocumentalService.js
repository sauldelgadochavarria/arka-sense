'use strict';

const crypto = require('crypto');
const path = require('path');
const getGestionDocumentalConfigModel = require('../models/gestionDocumentalConfig');
const getDocumentoArchivoModel = require('../models/documentoArchivo');
const {
  TIPOS_DOCUMENTO,
  MESES,
  tipoByCodigo,
  mesByNum,
  slugPath,
  PROCESOS_CUMPLIMIENTO,
  TIPOS_EXPEDIENTE_OBLIGATORIOS,
  mesAnteriorDe,
  bimestreInfonavitCerrado,
  fechaDiaMesSiguiente,
  formatFechaCorta,
  formatRangoPeriodo,
  semaforo
} = require('../config/gestionDocumentalCatalog');
const { createStorageAdapter, empresaRootSlug, joinKey } = require('./documentStorageService');

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function extFromName(name) {
  const e = path.extname(String(name || '')).replace(/^\./, '').toLowerCase();
  return e.slice(0, 12);
}

function periodoLabelFrom(periodo) {
  if (!periodo) return 'Periodo';
  const tipo = String(periodo.tipoPeriodo || 'nomina');
  const num = periodo.numeroPeriodo != null ? String(periodo.numeroPeriodo).padStart(2, '0') : '';
  return slugPath(`Nomina_${tipo}_${num || 'X'}`);
}

/**
 * Construye la key relativa:
 * {empresa}/YYYY/MM_Mes/... o {empresa}/Trabajadores/{num}_{nombre}/...
 */
function buildStorageKey({
  empresaSlug,
  tipo,
  anio,
  mes,
  periodoLabel,
  numEmpleado,
  empleadoNombre,
  fileName,
  subcarpetas = null
}) {
  const safeFile = slugPath(fileName || 'archivo');
  const carpeta = tipo.carpeta || tipo.codigo;
  const extra = (subcarpetas || []).map((p) => slugPath(p)).filter(Boolean);

  if (tipo.ambito === 'empleado') {
    const empFolder = slugPath(`${numEmpleado || '000'} ${empleadoNombre || 'Empleado'}`);
    return joinKey(empresaSlug, 'Trabajadores', empFolder, carpeta, safeFile);
  }

  const mesInfo = mesByNum(mes);
  const mesFolder = mesInfo ? `${mesInfo.codigo}_${mesInfo.nombre}` : String(mes || '00');
  const yearFolder = String(anio || new Date().getFullYear());

  if (tipo.ambito === 'periodo') {
    return joinKey(empresaSlug, yearFolder, mesFolder, periodoLabel || 'Periodo', carpeta, ...extra, safeFile);
  }

  // mes
  return joinKey(empresaSlug, yearFolder, mesFolder, carpeta, ...extra, safeFile);
}

async function getOrCreateConfig(tenantId, empresaId, empresa) {
  const Config = await getGestionDocumentalConfigModel();
  let doc = await Config.findOne({ tenantId, empresaId });
  if (!doc) {
    doc = await Config.create({
      tenantId,
      empresaId,
      proveedor: 'local',
      empresaSlug: empresaRootSlug({}, empresa || {}),
      local: { rootPath: process.env.GESTION_DOCUMENTAL_ROOT || '/data/documentos', crearSubcarpetas: true },
      versionado: true,
      diasAvisoVencimiento: 30
    });
  }
  return doc;
}

async function saveConfig(tenantId, empresaId, payload) {
  const Config = await getGestionDocumentalConfigModel();
  await Config.updateOne(
    { tenantId, empresaId },
    { $set: payload },
    { upsert: true }
  );
  return Config.findOne({ tenantId, empresaId }).lean();
}

function maskConfig(doc) {
  if (!doc) return null;
  const out = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (out.s3?.secretAccessKey) {
    out.s3 = { ...out.s3, secretAccessKey: out.s3.secretAccessKey ? '********' : '' };
  }
  return out;
}

/**
 * Sube / registra un documento.
 */
async function subirDocumento({
  tenantId,
  empresa,
  config: configIn,
  tipoCodigo,
  anio = null,
  mes = null,
  periodoId = null,
  periodo = null,
  empleadoId = null,
  empleado = null,
  buffer,
  nombreOriginal,
  contentType = 'application/octet-stream',
  vigenteDesde = null,
  vigenteHasta = null,
  notas = '',
  origen = 'upload',
  subsidiariaId = null,
  userId = '',
  userLabel = '',
  entidad = '',
  registroPatronal = '',
  subcarpetas = null,
  conservarAnteriores = false
}) {
  const tipo = tipoByCodigo(tipoCodigo);
  if (!tipo) throw new Error(`Tipo documental desconocido: ${tipoCodigo}`);
  const contenido = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!contenido.length) throw new Error('Archivo vacío');

  const empresaId = empresa._id;
  const config = configIn || (await getOrCreateConfig(tenantId, empresaId, empresa));
  const storage = createStorageAdapter(config);
  const empresaSlug = empresaRootSlug(config, empresa);

  let a = anio;
  let m = mes;
  let pLabel = periodo ? periodoLabelFrom(periodo) : '';
  if (periodo) {
    a = a || (periodo.fechaInicio ? new Date(periodo.fechaInicio).getFullYear() : periodo.anio);
    m = m || (periodo.fechaInicio ? new Date(periodo.fechaInicio).getMonth() + 1 : null);
  }
  if (tipo.ambito === 'periodo' && (!a || !m)) {
    throw new Error('Año y mes (o período) requeridos para documentos de período');
  }
  if (tipo.ambito === 'mes' && (!a || !m)) {
    throw new Error('Año y mes requeridos');
  }
  if (tipo.ambito === 'empleado' && !empleado && !empleadoId) {
    throw new Error('Empleado requerido');
  }

  const numEmp = empleado?.numEmpleado || '';
  const nombreEmp =
    empleado?.nombre ||
    `${empleado?.firstName || ''} ${empleado?.lastName || ''}`.trim();

  const ext = extFromName(nombreOriginal) || 'bin';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = `${tipo.codigo}_${stamp}.${ext}`;
  const storageKey = buildStorageKey({
    empresaSlug,
    tipo,
    anio: a,
    mes: m,
    periodoLabel: pLabel,
    numEmpleado: numEmp,
    empleadoNombre: nombreEmp,
    fileName: baseName,
    subcarpetas
  });

  await storage.put({ key: storageKey, buffer: contenido, contentType });

  const Documento = await getDocumentoArchivoModel();
  const hash = sha256Hex(contenido);

  const prevFilter = {
    tenantId,
    empresaId,
    tipoCodigo: tipo.codigo,
    activo: true
  };
  if (tipo.ambito === 'periodo') {
    if (periodoId) prevFilter.periodoId = periodoId;
    else {
      prevFilter.anio = a;
      prevFilter.mes = m;
      prevFilter.periodoLabel = pLabel;
    }
  } else if (tipo.ambito === 'mes') {
    prevFilter.anio = a;
    prevFilter.mes = m;
  } else {
    prevFilter.empleadoId = empleadoId || empleado?._id;
  }
  if (subsidiariaId) prevFilter.subsidiariaId = subsidiariaId;

  const prev = conservarAnteriores ? null : await Documento.findOne(prevFilter).sort({ version: -1 });
  let version = 1;
  let reemplazaId = null;
  if (prev) {
    if (config.versionado) {
      prev.activo = false;
      await prev.save();
      version = (prev.version || 1) + 1;
      reemplazaId = prev._id;
    } else {
      try {
        await storage.delete({ key: prev.storageKey });
      } catch {
        /* ignore */
      }
      await Documento.deleteOne({ _id: prev._id });
    }
  }

  const doc = await Documento.create({
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || empleado?.subsidiariaId || periodo?.subsidiariaId || null,
    tipoCodigo: tipo.codigo,
    ambito: tipo.ambito,
    anio: tipo.ambito === 'empleado' ? null : a,
    mes: tipo.ambito === 'empleado' ? null : m,
    periodoId: tipo.ambito === 'periodo' ? periodoId || periodo?._id || null : null,
    periodoLabel: tipo.ambito === 'periodo' ? pLabel : '',
    entidad: String(entidad || '').toUpperCase(),
    registroPatronal: String(registroPatronal || '').toUpperCase(),
    empleadoId: tipo.ambito === 'empleado' ? empleadoId || empleado?._id || null : null,
    numEmpleado: tipo.ambito === 'empleado' ? numEmp : '',
    empleadoNombre: tipo.ambito === 'empleado' ? nombreEmp : '',
    storageKey,
    nombreOriginal: nombreOriginal || baseName,
    contentType,
    extension: ext,
    tamanio: contenido.length,
    sha256: hash,
    proveedor: storage.proveedor,
    vigenteDesde,
    vigenteHasta,
    notas,
    origen,
    reemplazaId,
    version,
    activo: true,
    uploadedByUserId: userId,
    uploadedByLabel: userLabel
  });

  return doc.toObject();
}

async function subirComprobanteIsn({
  tenantId,
  empresa,
  anio,
  mes,
  entidad,
  registroPatronal = '',
  buffer,
  nombreOriginal,
  contentType,
  notas = '',
  userId = '',
  userLabel = ''
}) {
  const ent = String(entidad || '').trim().toUpperCase();
  const rp = String(registroPatronal || '').trim().toUpperCase();
  return subirDocumento({
    tenantId,
    empresa,
    tipoCodigo: 'ISN_COMPROBANTE',
    anio,
    mes,
    buffer,
    nombreOriginal,
    contentType,
    notas,
    origen: 'upload',
    subsidiariaId: null,
    userId,
    userLabel,
    entidad: ent,
    registroPatronal: rp,
    subcarpetas: [rp || 'SIN_REGISTRO', ent || 'SIN_ENTIDAD'],
    conservarAnteriores: true
  });
}

async function listarDocumentos(tenantId, empresaId, filtros = {}) {
  const Documento = await getDocumentoArchivoModel();
  const q = { tenantId, empresaId, activo: filtros.incluirInactivos ? undefined : true };
  if (!filtros.incluirInactivos) q.activo = true;
  if (filtros.tipoCodigo) q.tipoCodigo = String(filtros.tipoCodigo).toUpperCase();
  if (filtros.ambito) q.ambito = filtros.ambito;
  if (filtros.anio) q.anio = Number(filtros.anio);
  if (filtros.mes) q.mes = Number(filtros.mes);
  if (filtros.periodoId) q.periodoId = filtros.periodoId;
  if (filtros.empleadoId) q.empleadoId = filtros.empleadoId;
  if (filtros.grupo) {
    const codes = TIPOS_DOCUMENTO.filter((t) => t.grupo === filtros.grupo).map((t) => t.codigo);
    q.tipoCodigo = { $in: codes };
  }
  const docs = await Documento.find(q).sort({ anio: -1, mes: -1, tipoCodigo: 1, createdAt: -1 }).lean();
  if (!filtros.subsidiariaId) return docs;
  const alcance = await alcanceSubsidiaria(tenantId, empresaId, filtros.subsidiariaId);
  return docs.filter((d) => visibleEnSubsidiaria(d, alcance));
}

async function alcanceSubsidiaria(tenantId, empresaId, subsidiariaId) {
  if (!subsidiariaId) return null;
  const getEmpleadoModel = require('../models/empleado');
  const { listPeriodosNominaScoped } = require('../libs/periodosNominaScope');
  const Empleado = await getEmpleadoModel();
  const [empIds, periodos] = await Promise.all([
    Empleado.find({ tenantId, empresaId, subsidiariaId }).distinct('_id'),
    listPeriodosNominaScoped({
      tenantId,
      empresaId,
      subsidiariaId,
      limit: 800,
      annotateDisplay: false,
      collapseDuplicates: false
    })
  ]);
  return {
    id: String(subsidiariaId),
    empleados: new Set(empIds.map(String)),
    periodos: new Set(periodos.map((p) => String(p._id)))
  };
}

function visibleEnSubsidiaria(doc, alcance) {
  if (!alcance) return true;
  if (doc.subsidiariaId) return String(doc.subsidiariaId) === alcance.id;
  if (doc.empleadoId) return alcance.empleados.has(String(doc.empleadoId));
  if (doc.periodoId) return alcance.periodos.has(String(doc.periodoId));
  return true;
}

async function obtenerContenido(tenantId, empresaId, documentoId, empresa, subsidiariaId = null) {
  const Documento = await getDocumentoArchivoModel();
  const doc = await Documento.findOne({ _id: documentoId, tenantId, empresaId }).lean();
  if (!doc) throw new Error('Documento no encontrado');
  if (subsidiariaId) {
    const alcance = await alcanceSubsidiaria(tenantId, empresaId, subsidiariaId);
    if (!visibleEnSubsidiaria(doc, alcance)) throw new Error('Documento no encontrado');
  }
  const config = await getOrCreateConfig(tenantId, empresaId, empresa);
  const storage = createStorageAdapter(config);
  const buffer = await storage.get({ key: doc.storageKey });
  return { doc, buffer };
}

async function eliminarDocumento(tenantId, empresaId, documentoId, { hard = false, empresa, subsidiariaId = null } = {}) {
  const Documento = await getDocumentoArchivoModel();
  const doc = await Documento.findOne({ _id: documentoId, tenantId, empresaId });
  if (!doc) throw new Error('Documento no encontrado');
  if (subsidiariaId) {
    const alcance = await alcanceSubsidiaria(tenantId, empresaId, subsidiariaId);
    if (!visibleEnSubsidiaria(doc.toObject(), alcance)) throw new Error('Documento no encontrado');
  }
  if (hard) {
    const config = await getOrCreateConfig(tenantId, empresaId, empresa);
    const storage = createStorageAdapter(config);
    try {
      await storage.delete({ key: doc.storageKey });
    } catch {
      /* ignore */
    }
    await Documento.deleteOne({ _id: doc._id });
  } else {
    doc.activo = false;
    await doc.save();
  }
  return true;
}

/**
 * Reporte de cobertura: qué tipos obligatorios faltan por mes / empleado.
 */
async function reporteCobertura({
  tenantId,
  empresaId,
  anio,
  mes = null,
  empleados = [],
  subsidiariaId = null
}) {
  const docs = await listarDocumentos(tenantId, empresaId, {
    anio,
    mes: mes || undefined,
    subsidiariaId
  });

  const faltantesMes = [];
  const tiposMes = TIPOS_DOCUMENTO.filter((t) => t.ambito === 'mes' && t.obligatorio);
  if (mes) {
    for (const t of tiposMes) {
      const ok = docs.some(
        (d) => d.tipoCodigo === t.codigo && d.anio === Number(anio) && d.mes === Number(mes)
      );
      if (!ok) faltantesMes.push(t);
    }
  }

  const faltantesEmpleado = [];
  const tiposEmp = TIPOS_DOCUMENTO.filter((t) => t.ambito === 'empleado' && t.obligatorio);
  for (const emp of empleados) {
    const id = String(emp._id);
    const miss = tiposEmp.filter(
      (t) => !docs.some((d) => String(d.empleadoId) === id && d.tipoCodigo === t.codigo)
    );
    if (miss.length) {
      faltantesEmpleado.push({
        empleadoId: emp._id,
        numEmpleado: emp.numEmpleado,
        nombre: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.nombre || '',
        faltantes: miss.map((t) => t.codigo)
      });
    }
  }

  const config = await getOrCreateConfig(tenantId, empresaId);
  const dias = config.diasAvisoVencimiento || 30;
  const limite = new Date();
  limite.setDate(limite.getDate() + dias);
  const porVencer = docs.filter(
    (d) => d.vigenteHasta && new Date(d.vigenteHasta) <= limite && new Date(d.vigenteHasta) >= new Date()
  );
  const vencidos = docs.filter((d) => d.vigenteHasta && new Date(d.vigenteHasta) < new Date());

  return {
    anio,
    mes,
    totalDocumentos: docs.length,
    faltantesMes: faltantesMes.map((t) => ({ codigo: t.codigo, nombre: t.nombre })),
    faltantesEmpleado,
    porVencer: porVencer.map((d) => ({
      _id: d._id,
      tipoCodigo: d.tipoCodigo,
      numEmpleado: d.numEmpleado,
      vigenteHasta: d.vigenteHasta
    })),
    vencidos: vencidos.map((d) => ({
      _id: d._id,
      tipoCodigo: d.tipoCodigo,
      numEmpleado: d.numEmpleado,
      vigenteHasta: d.vigenteHasta
    })),
    porGrupo: GRUPOS_COUNT(docs)
  };
}

function GRUPOS_COUNT(docs) {
  const map = {};
  for (const t of TIPOS_DOCUMENTO) map[t.grupo] = map[t.grupo] || 0;
  for (const d of docs) {
    const t = tipoByCodigo(d.tipoCodigo);
    if (t) map[t.grupo] = (map[t.grupo] || 0) + 1;
  }
  return map;
}

/**
 * Reindexa desde storage: crea metadatos faltantes para archivos ya presentes.
 * Parsea keys conocidas; archivos no reconocidos se omiten (conteo en skipped).
 */
async function reindexarDesdeStorage({ tenantId, empresa, config: configIn }) {
  const empresaId = empresa._id;
  const config = configIn || (await getOrCreateConfig(tenantId, empresaId, empresa));
  const storage = createStorageAdapter(config);
  const empresaSlug = empresaRootSlug(config, empresa);
  const listed = await storage.list({ prefix: empresaSlug });
  const Documento = await getDocumentoArchivoModel();
  const existing = await Documento.find({ tenantId, empresaId }).select('storageKey').lean();
  const known = new Set(existing.map((d) => d.storageKey));

  let creados = 0;
  let skipped = 0;
  let yaIndexados = 0;

  for (const item of listed) {
    if (known.has(item.key)) {
      yaIndexados += 1;
      continue;
    }
    const parsed = parseStorageKey(item.key, empresaSlug);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    await Documento.create({
      tenantId,
      empresaId,
      tipoCodigo: parsed.tipoCodigo,
      ambito: parsed.ambito,
      anio: parsed.anio,
      mes: parsed.mes,
      periodoLabel: parsed.periodoLabel || '',
      numEmpleado: parsed.numEmpleado || '',
      empleadoNombre: parsed.empleadoNombre || '',
      storageKey: item.key,
      nombreOriginal: path.basename(item.key),
      contentType: 'application/octet-stream',
      extension: extFromName(item.key),
      tamanio: item.tamanio || 0,
      sha256: '',
      proveedor: storage.proveedor,
      origen: 'reindex',
      version: 1,
      activo: true
    });
    creados += 1;
  }

  return { totalStorage: listed.length, creados, yaIndexados, skipped };
}

function parseStorageKey(key, empresaSlug) {
  const parts = String(key).split('/').filter(Boolean);
  if (!parts.length || parts[0] !== empresaSlug) return null;

  // Trabajadores/{num_nombre}/{carpeta}/{file}
  if (parts[1] === 'Trabajadores' && parts.length >= 4) {
    const emp = parts[2];
    const carpeta = parts[3];
    const tipo = TIPOS_DOCUMENTO.find((t) => t.ambito === 'empleado' && t.carpeta === carpeta);
    if (!tipo) return null;
    const m = emp.match(/^(\d+)[_ ]?(.*)$/);
    return {
      ambito: 'empleado',
      tipoCodigo: tipo.codigo,
      anio: null,
      mes: null,
      numEmpleado: m ? m[1] : '',
      empleadoNombre: m ? (m[2] || '').replace(/_/g, ' ') : emp.replace(/_/g, ' ')
    };
  }

  // YYYY/MM_Mes/...
  if (parts.length < 4) return null;
  const anio = Number(parts[1]);
  if (!Number.isFinite(anio)) return null;
  const mesPart = parts[2];
  const mesNum = Number(String(mesPart).slice(0, 2));
  if (!Number.isFinite(mesNum) || mesNum < 1 || mesNum > 12) return null;

  // período: .../Nomina_.../Carpeta/file  OR mes: .../SUA/... or Impuestos/...
  const rest = parts.slice(3);
  if (rest[0] && /^Nomina_/i.test(rest[0]) && rest.length >= 3) {
    const carpeta = rest[1];
    const tipo = TIPOS_DOCUMENTO.find((t) => t.ambito === 'periodo' && t.carpeta === carpeta);
    if (!tipo) return null;
    return {
      ambito: 'periodo',
      tipoCodigo: tipo.codigo,
      anio,
      mes: mesNum,
      periodoLabel: rest[0]
    };
  }

  // carpeta puede ser "SUA/Archivo_SUA" → parts SUA, Archivo_SUA, file
  const carpetaCand = rest.slice(0, -1).join('/');
  const tipoMes = TIPOS_DOCUMENTO.find((t) => t.ambito === 'mes' && t.carpeta === carpetaCand);
  if (tipoMes) {
    return { ambito: 'mes', tipoCodigo: tipoMes.codigo, anio, mes: mesNum };
  }
  return null;
}

async function arbolResumen(tenantId, empresaId, anio, subsidiariaId = null) {
  const docs = await listarDocumentos(tenantId, empresaId, { anio, subsidiariaId });
  const tree = {};
  for (const d of docs) {
    if (d.ambito === 'empleado') {
      tree.Trabajadores = tree.Trabajadores || {};
      const k = `${d.numEmpleado} ${d.empleadoNombre}`.trim() || String(d.empleadoId);
      tree.Trabajadores[k] = tree.Trabajadores[k] || {};
      tree.Trabajadores[k][d.tipoCodigo] = (tree.Trabajadores[k][d.tipoCodigo] || 0) + 1;
      continue;
    }
    const mesInfo = mesByNum(d.mes);
    const mesKey = mesInfo ? mesInfo.nombre : String(d.mes);
    tree[mesKey] = tree[mesKey] || {};
    if (d.ambito === 'periodo') {
      const pk = d.periodoLabel || 'Periodo';
      tree[mesKey][pk] = tree[mesKey][pk] || {};
      tree[mesKey][pk][d.tipoCodigo] = (tree[mesKey][pk][d.tipoCodigo] || 0) + 1;
    } else {
      const t = tipoByCodigo(d.tipoCodigo);
      const g = t?.grupo || 'otros';
      tree[mesKey][g] = tree[mesKey][g] || {};
      tree[mesKey][g][d.tipoCodigo] = (tree[mesKey][g][d.tipoCodigo] || 0) + 1;
    }
  }
  return tree;
}

function hasAnyTipo(docs, tipos, extra = {}) {
  const set = new Set((tipos || []).map((t) => String(t).toUpperCase()));
  return docs.some((d) => {
    if (!set.has(String(d.tipoCodigo || '').toUpperCase())) return false;
    if (extra.anio && d.anio !== extra.anio) return false;
    if (extra.mes && d.mes !== extra.mes) return false;
    return true;
  });
}

function estadoNominaPeriodo(periodo, now) {
  const est = String(periodo.estatus || '');
  const fin = periodo.fechaFin ? new Date(periodo.fechaFin) : null;
  if (est === 'cerrado') return { codigo: 'ok', label: 'Cerrada' };
  if (est === 'calculado') return { codigo: 'pendiente', label: 'Calculada' };
  if (est === 'calculando') return { codigo: 'pendiente', label: 'Calculando' };
  const vencido = fin && startOfDayLocal(now) > startOfDayLocal(fin);
  if (vencido) return { codigo: 'atrasado', label: 'Sin cerrar' };
  return { codigo: 'pendiente', label: 'En curso' };
}

function startOfDayLocal(d) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

/**
 * Nómina que ya empezó y sigue vigente: la que contiene hoy, o una ya terminada
 * y sin cerrar del mes actual o del anterior. Las que aún no inician no entran.
 */
function periodoEnVentanaProceso(periodo, now) {
  const hoy = startOfDayLocal(now);
  const ini = startOfDayLocal(periodo.fechaInicio);
  const fin = startOfDayLocal(periodo.fechaFin);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) return false;
  if (ini > hoy) return false;
  if (fin >= hoy) return true;
  if (String(periodo.estatus || '') === 'cerrado') return false;
  const prev = mesAnteriorDe(now);
  const finAnio = fin.getFullYear();
  const finMes = fin.getMonth() + 1;
  const curAnio = hoy.getFullYear();
  const curMes = hoy.getMonth() + 1;
  return (finAnio === curAnio && finMes === curMes) || (finAnio === prev.anio && finMes === prev.mes);
}

function contarEstados(filas) {
  return {
    ok: filas.filter((f) => f.estado === 'ok').length,
    pendiente: filas.filter((f) => f.estado === 'pendiente').length,
    atrasado: filas.filter((f) => f.estado === 'atrasado').length
  };
}

function entidadesIsnDePlaza(det, subsidiariaId) {
  const todas = ((det && det.porEntidad) || []).filter((e) => e && e.entidad);
  if (!subsidiariaId) return todas;
  const sid = String(subsidiariaId);
  const propias = new Set();
  for (const row of (det && det.detalle) || []) {
    if (!row || !row.entidad || !row.subsidiariaId) continue;
    if (String(row.subsidiariaId) === sid) propias.add(String(row.entidad).toUpperCase());
  }
  return todas.filter((e) => propias.has(String(e.entidad).toUpperCase()));
}

function documentoDePlaza(doc, subsidiariaId, entidades) {
  if (!subsidiariaId) return true;
  if (doc.subsidiariaId && String(doc.subsidiariaId) === String(subsidiariaId)) return true;
  if (doc.empleadoId || doc.periodoId) return true;
  const ent = String(doc.entidad || '').toUpperCase();
  return Boolean(ent && entidades && entidades.has(ent));
}

async function determinacionIsnVigente(tenantId, empresaId, anio, mes) {
  const { models } = require('../models/isn');
  const { DeterminacionIsn } = await models();
  return DeterminacionIsn.findOne({
    tenantId,
    empresaId,
    anio,
    mes,
    estatus: { $in: ['borrador', 'cerrado'] }
  }).sort({ version: -1 }).lean();
}

async function filaAcuseIsn({ tenantId, empresaId, anio, mes, periodo, limite, now, docs, subsidiariaId = null, det = null }) {
  const proc = PROCESOS_CUMPLIMIENTO.find((p) => p.codigo === 'ISN');
  const entidades = entidadesIsnDePlaza(det, subsidiariaId);
  if (subsidiariaId && !entidades.length) return null;
  const comps = (docs || []).filter((d) => d.tipoCodigo === 'ISN_COMPROBANTE' || d.tipoCodigo === 'IMP_ISN');
  const legacy = !subsidiariaId && comps.some((d) => d.tipoCodigo === 'IMP_ISN' && !d.entidad);
  const requeridas = entidades.map((e) => String(e.entidad).toUpperCase()).filter(Boolean);
  const conArchivo = new Set(
    comps.map((d) => String(d.entidad || '').toUpperCase()).filter(Boolean)
  );
  for (const dec of (det && det.declaraciones) || []) {
    if (dec.documentoId && dec.entidad) conArchivo.add(String(dec.entidad).toUpperCase());
  }
  const cubiertas = requeridas.filter((ent) => conArchivo.has(ent));
  const cumplido = requeridas.length ? legacy || cubiertas.length === requeridas.length : comps.length > 0;
  const parcial = !cumplido && (cubiertas.length > 0 || comps.length > 0);
  const st = semaforo({
    cumplido,
    parcial,
    fechaLimite: limite,
    now,
    labelOk: 'Cargado',
    labelParcial: 'Incompleto',
    labelPendiente: 'Sin archivo',
    labelAtrasado: 'Sin archivo'
  });
  return {
    proceso: 'Comprobante ISN',
    procesoCodigo: proc.codigo,
    periodo,
    fechaLimite: formatFechaCorta(limite),
    fechaLimiteRaw: limite,
    estado: st.codigo,
    estadoLabel: st.label,
    href: `/nomina/isn?anio=${anio}&mes=${mes}&fuente=historico&tab=repositorio`,
    detalle: requeridas.length ? `${cubiertas.length} de ${requeridas.length} estados` : ''
  };
}

function enlaceCarga(proc, anio, mes) {
  const q = new URLSearchParams();
  q.set('proceso', proc.codigo);
  const tipo = (proc.tiposOk && proc.tiposOk[0]) || '';
  if (tipo) q.set('tipo', tipo);
  if (anio) q.set('anio', String(anio));
  if (mes) q.set('mes', String(mes));
  return `/nomina/gestion-documental/subir?${q.toString()}`;
}

function filaDocumento(proc, { anio, mes, periodo, limite, now, docs, anioCarga, mesCarga }) {
  const ok = hasAnyTipo(docs, proc.tiposOk, { anio, mes });
  const parcial = hasAnyTipo(docs, proc.tiposParcial, { anio, mes });
  const st = semaforo({
    cumplido: ok,
    parcial,
    fechaLimite: limite,
    now,
    labelOk: 'Cargado',
    labelParcial: 'Incompleto',
    labelPendiente: 'Sin archivo',
    labelAtrasado: 'Sin archivo'
  });
  const anioLink = anioCarga != null ? anioCarga : anio;
  const mesLink = mesCarga != null ? mesCarga : mes;
  return {
    proceso: proc.codigo === 'ISN' ? 'Acuse ISN' : proc.nombre,
    procesoCodigo: proc.codigo,
    periodo,
    fechaLimite: formatFechaCorta(limite),
    fechaLimiteRaw: limite,
    estado: st.codigo,
    estadoLabel: st.label,
    href: enlaceCarga(proc, anioLink, mesLink),
    detalle: ''
  };
}

async function filasCumplimientoIsn({ tenantId, empresaId, anio, mes, periodo, now, docsMes, subsidiariaId = null, det = null }) {
  const proc = PROCESOS_CUMPLIMIENTO.find((p) => p.codigo === 'ISN');
  const limite = fechaDiaMesSiguiente(anio, mes, proc.diaLimiteMesSiguiente || 17);
  const { labelEntidad } = require('./isnCalculoService');
  const { ENTIDADES_FEDERATIVAS } = require('../config/empleadoCatalogos');
  const entidades = entidadesIsnDePlaza(det, subsidiariaId);
  if (subsidiariaId && !entidades.length) return [];
  const base = {
    procesoCodigo: 'ISN',
    periodo,
    fechaLimite: formatFechaCorta(limite),
    fechaLimiteRaw: limite
  };
  if (!entidades.length) {
    const ok = hasAnyTipo(docsMes, proc.tiposOk, { anio, mes });
    const st = semaforo({
      cumplido: ok,
      parcial: false,
      fechaLimite: limite,
      now,
      labelOk: 'Pagado',
      labelParcial: 'Pendiente',
      labelPendiente: 'Pendiente',
      labelAtrasado: 'Sin presentar'
    });
    return [{
      ...base,
      proceso: proc.nombre,
      estado: st.codigo,
      estadoLabel: st.label,
      href: proc.href,
      detalle: ''
    }];
  }
  return entidades.map((e) => {
    const pagos = (det.declaraciones || []).filter((d) => d.entidad === e.entidad);
    const st = semaforo({
      cumplido: pagos.length > 0,
      parcial: false,
      fechaLimite: limite,
      now,
      labelOk: 'Pagado',
      labelParcial: 'Pendiente',
      labelPendiente: 'Pendiente',
      labelAtrasado: 'Sin presentar'
    });
    const nombre = labelEntidad(e.entidad, ENTIDADES_FEDERATIVAS);
    return {
      ...base,
      proceso: `ISN ${nombre}`,
      estado: st.codigo,
      estadoLabel: st.label,
      href: `/nomina/isn?anio=${anio}&mes=${mes}&fuente=historico&entidad=${e.entidad}`,
      detalle: pagos.length ? (pagos[pagos.length - 1].folio || 'Pago registrado') : 'Sin pago'
    };
  });
}

/**
 * Tablero empresarial: cumplimiento de procesos + expedientes de trabajadores.
 */
async function tableroCumplimiento({ tenantId, empresaId, subsidiariaId = null, now = new Date() }) {
  const { listPeriodosNominaScoped } = require('../libs/periodosNominaScope');
  const getEmpleadoModel = require('../models/empleado');
  const Empleado = await getEmpleadoModel();

  const prev = mesAnteriorDe(now);
  const bim = bimestreInfonavitCerrado(now);
  const empQ = { tenantId, empresaId, activo: true, estatus: { $ne: 'baja' } };
  if (subsidiariaId) empQ.subsidiariaId = subsidiariaId;
  const docScope = { subsidiariaId: subsidiariaId || undefined };
  const [periodos, empleados, docsMes, docsBim, docsEmp] = await Promise.all([
    listPeriodosNominaScoped({
      tenantId,
      empresaId,
      subsidiariaId,
      limit: 80,
      collapseDuplicates: false,
      annotateDisplay: false
    }),
    Empleado.find(empQ).select('_id numEmpleado firstName lastName').lean(),
    listarDocumentos(tenantId, empresaId, { anio: prev.anio, mes: prev.mes, ...docScope }),
    listarDocumentos(tenantId, empresaId, { anio: bim.anio, ...docScope }),
    listarDocumentos(tenantId, empresaId, { ambito: 'empleado', ...docScope })
  ]);

  const detIsn = await determinacionIsnVigente(tenantId, empresaId, prev.anio, prev.mes);
  const entidadesPlaza = entidadesIsnDePlaza(detIsn, subsidiariaId);
  const setEnt = new Set(entidadesPlaza.map((e) => String(e.entidad).toUpperCase()));
  const docsMesPlaza = (docsMes || []).filter((d) => documentoDePlaza(d, subsidiariaId, setEnt));
  const docsBimFiltrados = (docsBim || []).filter(
    (d) =>
      d.anio === bim.anio &&
      (d.mes === bim.mesInicio || d.mes === bim.mesFin || !d.mes) &&
      documentoDePlaza(d, subsidiariaId, setEnt)
  );

  const filas = [];
  const filasDocumentos = [];
  const procNomina = PROCESOS_CUMPLIMIENTO.find((x) => x.codigo === 'NOMINA');
  const periodosProceso = (periodos || [])
    .filter((p) => periodoEnVentanaProceso(p, now))
    .sort((a, b) => new Date(a.fechaInicio) - new Date(b.fechaInicio));

  for (const p of periodosProceso) {
    const st = estadoNominaPeriodo(p, now);
    filas.push({
      proceso: procNomina.nombre,
      procesoCodigo: procNomina.codigo,
      periodo: formatRangoPeriodo(p.fechaInicio, p.fechaFin),
      fechaLimite: formatFechaCorta(p.fechaFin),
      fechaLimiteRaw: p.fechaFin,
      estado: st.codigo,
      estadoLabel: st.label,
      href: `/nomina/periodos/${p._id}`,
      detalle: p.tipoPeriodo ? `${p.tipoPeriodo} #${p.numeroPeriodo || ''}` : ''
    });
  }

  const filasIsn = await filasCumplimientoIsn({
    tenantId,
    empresaId,
    anio: prev.anio,
    mes: prev.mes,
    periodo: prev.nombre,
    now,
    docsMes: docsMesPlaza,
    subsidiariaId,
    det: detIsn
  });
  filas.push(...filasIsn);

  const mesRows = PROCESOS_CUMPLIMIENTO.filter((p) => p.origen === 'mes');
  for (const proc of mesRows) {
    const limite = fechaDiaMesSiguiente(prev.anio, prev.mes, proc.diaLimiteMesSiguiente || 17);
    if (proc.codigo === 'ISN') {
      const acuse = await filaAcuseIsn({
        tenantId,
        empresaId,
        anio: prev.anio,
        mes: prev.mes,
        periodo: prev.nombre,
        limite,
        now,
        docs: docsMesPlaza,
        subsidiariaId,
        det: detIsn
      });
      if (acuse) filasDocumentos.push(acuse);
      continue;
    }
    filasDocumentos.push(filaDocumento(proc, {
      anio: prev.anio,
      mes: prev.mes,
      periodo: prev.nombre,
      limite,
      now,
      docs: docsMesPlaza
    }));
  }

  const inf = PROCESOS_CUMPLIMIENTO.find((p) => p.codigo === 'INFONAVIT');
  filasDocumentos.push(filaDocumento(inf, {
    anio: null,
    mes: null,
    anioCarga: bim.anio,
    mesCarga: bim.mesFin,
    periodo: bim.label,
    limite: bim.fechaLimite,
    now,
    docs: docsBimFiltrados
  }));

  const tiposReq = TIPOS_EXPEDIENTE_OBLIGATORIOS;
  let completos = 0;
  const incompletos = [];
  const vencidos = [];
  const hoy = startOfDayLocal(now);
  for (const emp of empleados) {
    const id = String(emp._id);
    const docs = (docsEmp || []).filter((d) => String(d.empleadoId) === id);
    const faltan = tiposReq.filter((t) => !docs.some((d) => d.tipoCodigo === t));
    const venc = docs.filter((d) => d.vigenteHasta && startOfDayLocal(d.vigenteHasta) < hoy);
    const nombre = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
    if (venc.length) {
      vencidos.push({
        empleadoId: emp._id,
        numEmpleado: emp.numEmpleado,
        nombre,
        tipos: venc.map((d) => d.tipoCodigo)
      });
    }
    if (faltan.length) {
      incompletos.push({
        empleadoId: emp._id,
        numEmpleado: emp.numEmpleado,
        nombre,
        faltantes: faltan
      });
    } else {
      completos += 1;
    }
  }

  return {
    generadoAt: now,
    mesFiscal: prev,
    filas,
    filasProcesos: filas,
    filasDocumentos,
    resumen: contarEstados(filas),
    resumenDocumentos: contarEstados(filasDocumentos),
    expedientes: {
      total: empleados.length,
      completos,
      incompletos: incompletos.length,
      vencidos: vencidos.length,
      listaIncompletos: incompletos.slice(0, 25),
      listaVencidos: vencidos.slice(0, 15),
      tiposObligatorios: tiposReq
    }
  };
}

module.exports = {
  getOrCreateConfig,
  saveConfig,
  maskConfig,
  subirDocumento,
  subirComprobanteIsn,
  listarDocumentos,
  obtenerContenido,
  eliminarDocumento,
  reporteCobertura,
  reindexarDesdeStorage,
  arbolResumen,
  tableroCumplimiento,
  buildStorageKey,
  periodoLabelFrom,
  TIPOS_DOCUMENTO,
  MESES
};
