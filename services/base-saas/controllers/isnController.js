'use strict';

const mongoose = require('mongoose');
const { requireEmpresaForTenant, sessionSubsidiariaId } = require('../libs/tenantScope');
const { trimString, trimUpper, parseOptionalObjectId, parseDate } = require('../libs/formHelpers');
const { ENTIDADES_FEDERATIVAS } = require('../config/empleadoCatalogos');
const { models } = require('../models/isn');
const getSubsidiariaModel = require('../models/subsidiaria');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const { listConceptosVisiblesParaSubsidiaria } = require('../services/nomina/conceptResolutionService');
const getMenuModel = require('../models/menu');
const { calcularIsnMes, labelEntidad } = require('../services/isnCalculoService');
const { subirComprobanteIsn, obtenerContenido } = require('../services/gestionDocumentalService');

const EXT_COMPROBANTE = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'xml']);

const ENTIDADES = ENTIDADES_FEDERATIVAS.filter((e) => e.value !== 'NE');

function flash(req, res, path, type, msg) {
  if (req.flash) req.flash(type, msg);
  return res.redirect(path);
}

function userLabel(req) {
  return req.session.user || req.session.email || req.session.username || '';
}

function periodoQuery(req) {
  const now = new Date();
  const anio = Number(req.body.anio || req.query.anio) || now.getFullYear();
  const mes = Number(req.body.mes || req.query.mes) || now.getMonth() + 1;
  return {
    anio: anio >= 2000 && anio <= 2100 ? anio : now.getFullYear(),
    mes: mes >= 1 && mes <= 12 ? mes : now.getMonth() + 1,
    fuente: req.body.fuente === 'timbrado' || req.query.fuente === 'timbrado' ? 'timbrado' : 'historico',
    tab: ['determinacion', 'patronales', 'cuentas', 'tasas', 'repositorio'].includes(String(req.query.tab || req.body.tab))
      ? String(req.query.tab || req.body.tab)
      : 'determinacion'
  };
}

async function ensureMenuIsn() {
  const Menu = await getMenuModel();
  const nomina = await Menu.findOne({
    menuPrincipal: 'Nómina',
    esCategoria: true,
    parentId: null,
    activo: { $ne: false }
  }).lean();
  if (!nomina) return;
  const cumpl = await Menu.findOne({
    menuPrincipal: 'Cumplimiento',
    parentId: nomina._id,
    esCategoria: true
  }).lean();
  if (!cumpl) return;
  const data = {
    menuPrincipal: 'ISN estatal',
    rutaApp: '/nomina/isn',
    parentId: cumpl._id,
    orden: 43,
    activo: true,
    esCategoria: false,
    requiredFeatureKeys: ['nomina'],
    roles: []
  };
  const existing = await Menu.findOne({ rutaApp: '/nomina/isn' }).lean();
  if (existing) await Menu.updateOne({ _id: existing._id }, { $set: data });
  else await Menu.create(data);
}

async function contexto(req) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const filtros = periodoQuery(req);
  if (!empresa) return { empresa: null, error, filtros, entidades: ENTIDADES };
  const { RegistroPatronal, RegistroIsn, ConfigIsn, DeterminacionIsn } = await models();
  const Subsidiaria = await getSubsidiariaModel();
  const [patronales, cuentas, tasas, determinacion, subsidiarias] = await Promise.all([
    RegistroPatronal.find({ tenantId: req.session.tenantId, empresaId: empresa._id }).sort({ numero: 1 }).lean(),
    RegistroIsn.find({ tenantId: req.session.tenantId, empresaId: empresa._id }).sort({ entidad: 1 }).lean(),
    ConfigIsn.find({ tenantId: req.session.tenantId, empresaId: empresa._id }).sort({ entidad: 1, fechaInicio: -1 }).lean(),
    DeterminacionIsn.findOne({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      anio: filtros.anio,
      mes: filtros.mes,
      estatus: { $in: ['borrador', 'cerrado'] }
    }).sort({ version: -1 }).lean(),
    Subsidiaria.find({ empresaId: empresa._id, activo: { $ne: false } }).select('nombre entidadFederativa').sort({ nombre: 1 }).lean()
  ]);
  let conceptos = [];
  const nombresConcepto = {};
  if (filtros.tab === 'tasas') {
    const subId = sessionSubsidiariaId(req);
    const visibles = await listConceptosVisiblesParaSubsidiaria(
      req.session.tenantId,
      empresa._id,
      subId,
      { ambito: 'nomina', soloActivos: true, ocultarDeshabilitados: true, backfillHistorico: false }
    );
    const map = new Map();
    for (const c of visibles) {
      if (c.activoUi === false) continue;
      if (c.tipo !== 'percepcion' && c.tipo !== 'otro_pago') continue;
      if (c.naturaleza === 'informativo' || c.naturaleza === 'fiscal') continue;
      map.set(String(c.codigo).toUpperCase(), { codigo: c.codigo, nombre: c.nombre });
    }
    if (subId) {
      const Historico = await getNominaHistoricoReciboModel();
      const usados = await Historico.aggregate([
        {
          $match: {
            tenantId: req.session.tenantId,
            empresaId: empresa._id,
            subsidiariaId: new mongoose.Types.ObjectId(subId)
          }
        },
        { $unwind: '$conceptos' },
        { $group: { _id: '$conceptos.conceptoCodigo', tipo: { $first: '$conceptos.tipo' } } }
      ]);
      const faltan = usados
        .map((u) => String(u._id || '').toUpperCase())
        .filter((codigo) => codigo && !map.has(codigo) && uTipoPercepcion(usados, codigo));
      if (faltan.length) {
        const Concepto = await getConceptoNominaModel();
        const extra = await Concepto.find({
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          codigo: { $in: faltan }
        }).select('codigo nombre tipo naturaleza').lean();
        for (const c of extra) {
          if (c.tipo === 'deduccion') continue;
          if (c.naturaleza === 'informativo' || c.naturaleza === 'fiscal') continue;
          map.set(String(c.codigo).toUpperCase(), { codigo: c.codigo, nombre: c.nombre });
        }
      }
    }
    const codigosRegla = new Set();
    for (const t of tasas) {
      for (const r of t.reglasConcepto || []) {
        const codigo = String(r.codigo || '').toUpperCase();
        if (codigo && !map.has(codigo)) codigosRegla.add(codigo);
      }
    }
    if (codigosRegla.size) {
      const Concepto = await getConceptoNominaModel();
      const extra = await Concepto.find({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        codigo: { $in: [...codigosRegla] }
      }).select('codigo nombre').lean();
      for (const c of extra) nombresConcepto[String(c.codigo).toUpperCase()] = c.nombre;
    }
    conceptos = [...map.values()].sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'es'));
    for (const c of conceptos) nombresConcepto[String(c.codigo).toUpperCase()] = c.nombre;
  }
  const repositorio = filtros.tab === 'repositorio'
    ? await armarRepositorio(req.session.tenantId, empresa._id)
    : [];
  return {
    empresa,
    error,
    filtros,
    entidades: ENTIDADES,
    patronales,
    cuentas,
    tasas,
    determinacion,
    subsidiarias,
    conceptos,
    nombresConcepto,
    repositorio
  };
}

async function armarRepositorio(tenantId, empresaId) {
  const { DeterminacionIsn } = await models();
  const empId = new mongoose.Types.ObjectId(String(empresaId));
  const [pares, dets] = await Promise.all([
    DeterminacionIsn.aggregate([
      { $match: { tenantId, empresaId: empId, estatus: { $in: ['borrador', 'cerrado'] } } },
      { $unwind: '$detalle' },
      {
        $group: {
          _id: {
            det: '$_id',
            rp: { $ifNull: ['$detalle.registroPatronal', ''] },
            ent: { $ifNull: ['$detalle.entidad', ''] }
          },
          anio: { $first: '$anio' },
          mes: { $first: '$mes' },
          trabajadores: { $sum: 1 },
          impuesto: { $sum: '$detalle.impuesto' }
        }
      }
    ]),
    DeterminacionIsn.find({
      tenantId,
      empresaId,
      estatus: { $in: ['borrador', 'cerrado'] }
    }).select('anio mes declaraciones').lean()
  ]);
  const grupos = new Map();
  function grupo(rp, ent) {
    const registroPatronal = String(rp || '').toUpperCase();
    const entidad = String(ent || '').toUpperCase();
    const key = `${registroPatronal}|${entidad}`;
    if (!grupos.has(key)) grupos.set(key, { registroPatronal, entidad, filas: [] });
    return grupos.get(key);
  }
  function filaDe(g, detId, anio, mes) {
    let fila = g.filas.find((f) => String(f.detId) === String(detId));
    if (!fila) {
      fila = { detId, anio, mes, trabajadores: 0, impuesto: 0, pagos: [] };
      g.filas.push(fila);
    }
    return fila;
  }
  for (const p of pares) {
    if (!p._id || !p._id.ent) continue;
    const g = grupo(p._id.rp, p._id.ent);
    const fila = filaDe(g, p._id.det, p.anio, p.mes);
    fila.trabajadores = p.trabajadores;
    fila.impuesto = p.impuesto;
  }
  for (const det of dets) {
    for (const dec of det.declaraciones || []) {
      if (!dec.entidad) continue;
      const g = grupo(dec.registroPatronal, dec.entidad);
      filaDe(g, det._id, det.anio, det.mes).pagos.push(dec);
    }
  }
  return [...grupos.values()]
    .map((g) => {
      g.filas.sort((a, b) => b.anio - a.anio || b.mes - a.mes);
      return g;
    })
    .sort((a, b) => String(a.registroPatronal).localeCompare(b.registroPatronal) || String(a.entidad).localeCompare(b.entidad));
}

function comprobanteDe(file) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  const ext = String(file.originalname || '').split('.').pop().toLowerCase();
  if (!EXT_COMPROBANTE.has(ext)) {
    throw new Error('El comprobante debe ser PDF, JPG, PNG o XML.');
  }
  return file;
}

function uTipoPercepcion(usados, codigo) {
  const row = usados.find((u) => String(u._id || '').toUpperCase() === codigo);
  const tipo = row && row.tipo;
  return !tipo || tipo === 'percepcion' || tipo === 'otro_pago';
}

async function index(req, res) {
  try {
    await ensureMenuIsn();
  } catch (err) {
    console.warn('[isn menu]', err.message);
  }
  const ctx = await contexto(req);
  res.render('Nomina/isn/index', {
    ...ctx,
    session: req.session,
    labelEntidad: (c) => labelEntidad(c, ENTIDADES),
    success: (req.flash && req.flash('success')[0]) || '',
    flashError: (req.flash && req.flash('error')[0]) || ''
  });
}

async function guardarPatronal(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) return flash(req, res, '/nomina/isn?tab=patronales', 'error', error || 'Sin empresa');
  const numero = trimUpper(req.body.numero).replace(/\s+/g, '');
  if (numero.length < 10) return flash(req, res, '/nomina/isn?tab=patronales', 'error', 'El registro patronal está incompleto.');
  const { RegistroPatronal } = await models();
  try {
    await RegistroPatronal.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      subsidiariaId: parseOptionalObjectId(req.body.subsidiariaId),
      numero,
      claseRiesgo: ['I', 'II', 'III', 'IV', 'V'].includes(trimUpper(req.body.claseRiesgo))
        ? trimUpper(req.body.claseRiesgo)
        : '',
      fraccion: trimString(req.body.fraccion),
      primaRiesgo: req.body.primaRiesgo === '' ? null : Number(req.body.primaRiesgo),
      fechaInicio: parseDate(req.body.fechaInicio),
      fechaFin: parseDate(req.body.fechaFin),
      esRpu: req.body.esRpu === '1',
      activo: true
    });
  } catch (err) {
    const msg = err.code === 11000 ? 'Ese registro patronal ya existe en la empresa.' : err.message;
    return flash(req, res, '/nomina/isn?tab=patronales', 'error', msg);
  }
  return flash(req, res, '/nomina/isn?tab=patronales', 'success', 'Registro patronal guardado.');
}

async function guardarCuenta(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) return flash(req, res, '/nomina/isn?tab=cuentas', 'error', error || 'Sin empresa');
  const entidad = trimUpper(req.body.entidad);
  if (!ENTIDADES.some((e) => e.value === entidad)) {
    return flash(req, res, '/nomina/isn?tab=cuentas', 'error', 'Selecciona la entidad del ISN.');
  }
  const { RegistroIsn } = await models();
  try {
    await RegistroIsn.create({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      entidad,
      cuentaEstatal: trimString(req.body.cuentaEstatal),
      fechaAlta: parseDate(req.body.fechaAlta),
      fechaBaja: parseDate(req.body.fechaBaja),
      activo: true
    });
  } catch (err) {
    const msg = err.code === 11000 ? 'Ya hay una cuenta de ISN para esa entidad.' : err.message;
    return flash(req, res, '/nomina/isn?tab=cuentas', 'error', msg);
  }
  return flash(req, res, '/nomina/isn?tab=cuentas', 'success', 'Cuenta estatal guardada.');
}

async function guardarTasa(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) return flash(req, res, '/nomina/isn?tab=tasas', 'error', error || 'Sin empresa');
  const entidad = trimUpper(req.body.entidad);
  const tasa = Number(req.body.tasa);
  const fechaInicio = parseDate(req.body.fechaInicio);
  if (!ENTIDADES.some((e) => e.value === entidad) || !Number.isFinite(tasa) || tasa < 0 || !fechaInicio) {
    return flash(req, res, '/nomina/isn?tab=tasas', 'error', 'Entidad, tasa y fecha de inicio son obligatorias.');
  }
  const codigos = [].concat(req.body.conceptoCodigo || []);
  const porcentajes = [].concat(req.body.conceptoPorcentaje || []);
  const vistos = new Set();
  const reglasConcepto = [];
  codigos.forEach((raw, i) => {
    const codigo = trimUpper(raw);
    if (!codigo || vistos.has(codigo)) return;
    vistos.add(codigo);
    let pct = Number(porcentajes[i]);
    if (!Number.isFinite(pct)) pct = 100;
    pct = Math.min(100, Math.max(0, Math.round(pct * 100) / 100));
    reglasConcepto.push({
      codigo,
      porcentajeGravado: pct,
      tratamiento: pct <= 0 ? 'exento' : pct >= 100 ? 'gravado' : 'especial'
    });
  });
  const { ConfigIsn } = await models();
  await ConfigIsn.create({
    tenantId: req.session.tenantId,
    empresaId: empresa._id,
    entidad,
    tasa,
    diaLimite: Number(req.body.diaLimite) || 17,
    reglaAtribucion: req.body.reglaAtribucion === 'domicilio_trabajador_si_fuera'
      ? 'domicilio_trabajador_si_fuera'
      : 'lugar_servicio',
    fundamentoLegal: trimString(req.body.fundamentoLegal),
    reglasConcepto,
    fechaInicio,
    fechaFin: parseDate(req.body.fechaFin),
    activo: true
  });
  return flash(req, res, '/nomina/isn?tab=tasas', 'success', 'Tasa de ISN guardada con su vigencia.');
}

async function calcular(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const { anio, mes, fuente } = periodoQuery(req);
  const back = `/nomina/isn?anio=${anio}&mes=${mes}&fuente=${fuente}`;
  if (error || !empresa) return flash(req, res, back, 'error', error || 'Sin empresa');
  try {
    if (req.body.autorizar === '1') {
      const { DeterminacionIsn } = await models();
      await DeterminacionIsn.updateMany(
        {
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          anio,
          mes,
          estatus: 'cerrado'
        },
        { $set: { estatus: 'reemplazado' } }
      );
    }
    await calcularIsnMes({
      tenantId: req.session.tenantId,
      empresaId: empresa._id,
      anio,
      mes,
      fuente,
      userLabel: userLabel(req)
    });
  } catch (err) {
    return flash(req, res, back, 'error', err.message || 'No se pudo calcular el ISN');
  }
  return flash(req, res, back, 'success', 'Determinación de ISN calculada. Revisa cada entidad antes de cerrarla.');
}

async function cerrar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const { DeterminacionIsn } = await models();
  const doc = empresa
    ? await DeterminacionIsn.findOne({
        _id: req.params.id,
        tenantId: req.session.tenantId,
        empresaId: empresa._id
      })
    : null;
  const back = doc ? `/nomina/isn?anio=${doc.anio}&mes=${doc.mes}` : '/nomina/isn';
  if (error || !doc) return flash(req, res, back, 'error', error || 'Determinación no encontrada');
  if (doc.estatus === 'cerrado') return flash(req, res, back, 'success', 'El mes ya estaba cerrado.');
  doc.estatus = 'cerrado';
  doc.cerradoPor = userLabel(req);
  doc.cerradoAt = new Date();
  await doc.save();
  return flash(req, res, back, 'success', 'Determinación cerrada. Un recálculo posterior queda como otra versión.');
}

async function declarar(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const { DeterminacionIsn } = await models();
  const doc = empresa
    ? await DeterminacionIsn.findOne({
        _id: req.params.id,
        tenantId: req.session.tenantId,
        empresaId: empresa._id
      })
    : null;
  const fuente = doc && doc.fuente === 'timbrado' ? 'timbrado' : 'historico';
  const entidad = trimUpper(req.body.entidad);
  const back = doc
    ? `/nomina/isn?anio=${doc.anio}&mes=${doc.mes}&fuente=${fuente}${entidad ? `&entidad=${entidad}` : ''}`
    : '/nomina/isn';
  if (error || !doc) return flash(req, res, back, 'error', error || 'Determinación no encontrada');
  const fila = (doc.porEntidad || []).find((e) => e.entidad === entidad);
  if (!fila) return flash(req, res, back, 'error', 'La declaración corresponde a una entidad de la determinación.');
  let archivo = null;
  try {
    archivo = comprobanteDe(req.file);
  } catch (err) {
    return flash(req, res, back, 'error', err.message);
  }
  const registroPatronal = trimUpper(req.body.registroPatronal).replace(/\s+/g, '').slice(0, 11);
  const pago = {
    entidad,
    tipo: req.body.tipo === 'complementaria' ? 'complementaria' : 'normal',
    folio: trimString(req.body.folio),
    fecha: parseDate(req.body.fecha) || new Date(),
    referenciaPago: trimString(req.body.referenciaPago),
    importe: Number(req.body.importe) || 0,
    registroPatronal,
    notas: trimString(req.body.notas),
    registradoPor: userLabel(req)
  };
  if (archivo) {
    try {
      const guardado = await subirComprobanteIsn({
        tenantId: req.session.tenantId,
        empresa,
        anio: doc.anio,
        mes: doc.mes,
        entidad,
        registroPatronal,
        buffer: archivo.buffer,
        nombreOriginal: archivo.originalname,
        contentType: archivo.mimetype || 'application/octet-stream',
        notas: pago.folio ? `Folio ${pago.folio}` : '',
        userId: req.session.userId || '',
        userLabel: userLabel(req)
      });
      pago.documentoId = guardado._id;
      pago.nombreArchivo = guardado.nombreOriginal || archivo.originalname;
    } catch (err) {
      return flash(req, res, back, 'error', err.message || 'No se pudo guardar el comprobante');
    }
  }
  doc.declaraciones.push(pago);
  await doc.save();
  const aviso = pago.documentoId ? ' con comprobante' : '';
  return flash(req, res, back, 'success', `Declaración de ${labelEntidad(entidad, ENTIDADES)} registrada${aviso}.`);
}

async function adjuntarComprobante(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  const { DeterminacionIsn } = await models();
  const doc = empresa
    ? await DeterminacionIsn.findOne({
        _id: req.params.id,
        tenantId: req.session.tenantId,
        empresaId: empresa._id
      })
    : null;
  const volver = req.body.volver === 'repositorio' ? 'repositorio' : 'determinacion';
  const back = doc
    ? `/nomina/isn?anio=${doc.anio}&mes=${doc.mes}&fuente=${doc.fuente === 'timbrado' ? 'timbrado' : 'historico'}&tab=${volver}`
    : '/nomina/isn?tab=repositorio';
  if (error || !doc) return flash(req, res, back, 'error', error || 'Determinación no encontrada');
  const decl = (doc.declaraciones || []).id(req.params.declId);
  if (!decl) return flash(req, res, back, 'error', 'Ese pago no está en la determinación.');
  let archivo = null;
  try {
    archivo = comprobanteDe(req.file);
  } catch (err) {
    return flash(req, res, back, 'error', err.message);
  }
  if (!archivo) return flash(req, res, back, 'error', 'Selecciona el comprobante de pago.');
  const registroPatronal = trimUpper(req.body.registroPatronal || decl.registroPatronal).replace(/\s+/g, '').slice(0, 11);
  try {
    const guardado = await subirComprobanteIsn({
      tenantId: req.session.tenantId,
      empresa,
      anio: doc.anio,
      mes: doc.mes,
      entidad: decl.entidad,
      registroPatronal,
      buffer: archivo.buffer,
      nombreOriginal: archivo.originalname,
      contentType: archivo.mimetype || 'application/octet-stream',
      notas: decl.folio ? `Folio ${decl.folio}` : '',
      userId: req.session.userId || '',
      userLabel: userLabel(req)
    });
    decl.registroPatronal = registroPatronal;
    decl.documentoId = guardado._id;
    decl.nombreArchivo = guardado.nombreOriginal || archivo.originalname;
    await doc.save();
  } catch (err) {
    return flash(req, res, back, 'error', err.message || 'No se pudo guardar el comprobante');
  }
  return flash(req, res, back, 'success', 'Comprobante archivado en el registro patronal y la entidad.');
}

async function descargarComprobante(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req);
  if (error || !empresa) return res.status(400).send(error || 'Sin empresa');
  try {
    const { doc, buffer } = await obtenerContenido(
      req.session.tenantId,
      empresa._id,
      req.params.documentoId,
      empresa
    );
    if (doc.tipoCodigo !== 'ISN_COMPROBANTE' && doc.tipoCodigo !== 'IMP_ISN') {
      return res.status(404).send('Documento no encontrado');
    }
    const nombre = String(doc.nombreOriginal || 'comprobante-isn').replace(/"/g, '');
    res.setHeader('Content-Type', doc.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (err) {
    return res.status(404).send(err.message || 'Documento no encontrado');
  }
}

async function exportCsv(req, res) {
  const { empresa } = await requireEmpresaForTenant(req);
  if (!empresa) return res.status(400).send('Sin empresa');
  const { anio, mes } = periodoQuery(req);
  const { DeterminacionIsn } = await models();
  const doc = await DeterminacionIsn.findOne({
    tenantId: req.session.tenantId,
    empresaId: empresa._id,
    anio,
    mes,
    estatus: { $in: ['borrador', 'cerrado'] }
  }).sort({ version: -1 }).lean();
  if (!doc) return res.status(404).send('Sin determinación');
  const tipo = req.query.tipo === 'detalle' ? 'detalle' : 'resumen';
  const entidadFiltro = trimUpper(req.query.entidad);
  const lines = [];
  if (tipo === 'resumen') {
    lines.push('entidad,trabajadores,base_gravable,base_exenta,tasa,isn,cuenta_estatal');
    for (const e of doc.porEntidad || []) {
      lines.push([
        labelEntidad(e.entidad, ENTIDADES),
        e.trabajadores,
        e.baseGravable,
        e.baseExenta,
        e.tasa == null ? '' : e.tasa,
        e.impuesto,
        `"${e.cuentaEstatal || ''}"`
      ].join(','));
    }
    lines.push(`TOTAL,,,${doc.totalBaseGravable},,${doc.totalImpuesto},`);
  } else {
    lines.push('num,nombre,establecimiento,registro_patronal,entidad,base_gravable,base_exenta,isn,regla');
    const filas = (doc.detalle || []).filter((d) => {
      if (!entidadFiltro) return true;
      if (entidadFiltro === '__SIN__') return !d.entidad;
      return String(d.entidad || '').toUpperCase() === entidadFiltro;
    });
    for (const d of filas) {
      lines.push([
        d.numEmpleado,
        `"${String(d.nombre || '').replace(/"/g, '')}"`,
        `"${String(d.establecimiento || '').replace(/"/g, '')}"`,
        d.registroPatronal,
        labelEntidad(d.entidad, ENTIDADES),
        d.baseGravable,
        d.baseExenta,
        d.impuesto,
        d.regla
      ].join(','));
    }
  }
  const sufijo = tipo === 'detalle' && entidadFiltro ? `-${entidadFiltro}` : '';
  const name = `isn-${empresa.rfc || 'rfc'}-${anio}-${String(mes).padStart(2, '0')}-${tipo}${sufijo}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
}

module.exports = {
  index,
  guardarPatronal,
  guardarCuenta,
  guardarTasa,
  calcular,
  cerrar,
  declarar,
  adjuntarComprobante,
  descargarComprobante,
  exportCsv
};
