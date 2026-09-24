'use strict';

/**
 * Motor de descuentos programados de nómina.
 * Config → descuentos activos → aplicación con saldo → movimientos → líneas de recibo (CFDI refleja el resultado).
 */

const getDescuentoProgramadoConfigModel = require('../../models/descuentoProgramadoConfig');
const getDescuentoProgramadoModel = require('../../models/descuentoProgramado');
const getDescuentoProgramadoMovimientoModel = require('../../models/descuentoProgramadoMovimiento');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const { calcularTotalesDesdeConfig } = require('./fiscalDesgloseService');

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function conceptoCfgMap(config) {
  const map = new Map();
  for (const c of config?.conceptos || []) {
    map.set(String(c.conceptoCodigo || '').toUpperCase(), c);
  }
  return map;
}

/**
 * Resuelve flags de aplicación para un concepto.
 * - Si hay lista en config: solo los activos de esa lista.
 * - Si el módulo está on pero la lista está vacía: usa catálogo (descuentoProgramado.permite).
 */
function resolverFlagsConcepto(cCfg, conceptoMeta, { listaConfigVacia = false } = {}) {
  const flags = conceptoMeta?.descuentoProgramado || {};
  if (flags.permite === false) {
    return { ok: false, motivo: 'concepto_no_permite' };
  }

  if (cCfg) {
    if (!cCfg.activo || cCfg.aplicaAutomatico === false) {
      return { ok: false, motivo: 'concepto_inactivo_en_config' };
    }
    return {
      ok: true,
      generaSaldo: cCfg.generaSaldo !== false && flags.permiteSaldo !== false,
      permiteParcial: cCfg.permiteParcial !== false && flags.permiteParcial !== false
    };
  }

  if (listaConfigVacia && flags.permite === true) {
    return {
      ok: true,
      generaSaldo: flags.permiteSaldo === true,
      permiteParcial: flags.permiteParcial !== false
    };
  }

  return { ok: false, motivo: 'concepto_no_en_config' };
}


/**
 * Resuelve config: subsidiaria específica o default empresa (subsidiariaId null).
 */
async function resolverConfig(tenantId, empresaId, subsidiariaId = null) {
  const Config = await getDescuentoProgramadoConfigModel();
  let cfg = null;
  if (subsidiariaId) {
    cfg = await Config.findOne({ tenantId, empresaId, subsidiariaId }).lean();
  }
  if (!cfg) {
    cfg = await Config.findOne({
      tenantId,
      empresaId,
      $or: [{ subsidiariaId: null }, { subsidiariaId: { $exists: false } }]
    }).lean();
  }
  return cfg;
}

async function upsertConfig({
  tenantId,
  empresaId,
  subsidiariaId = null,
  moduloActivo,
  conceptos = [],
  notas = '',
  usuario = {}
}) {
  const Config = await getDescuentoProgramadoConfigModel();
  const filter = {
    tenantId,
    empresaId,
    subsidiariaId: subsidiariaId || null
  };
  const update = {
    $set: {
      moduloActivo: Boolean(moduloActivo),
      conceptos: (conceptos || []).map((c) => ({
        conceptoCodigo: String(c.conceptoCodigo || '').toUpperCase(),
        activo: c.activo !== false && c.activo !== 'false',
        generaSaldo: c.generaSaldo !== false && c.generaSaldo !== 'false',
        aplicaAutomatico: c.aplicaAutomatico !== false && c.aplicaAutomatico !== 'false',
        permiteParcial: c.permiteParcial !== false && c.permiteParcial !== 'false',
        reglas: c.reglas || {}
      })),
      notas: notas || ''
    }
  };
  const doc = await Config.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  });
  return doc;
}

async function registrarMovimiento(payload) {
  const Mov = await getDescuentoProgramadoMovimientoModel();
  return Mov.create(payload);
}

async function resolverNumeroPeriodo(tenantId, periodoId) {
  if (!periodoId) return null;
  try {
    const getPeriodoNominaModel = require('../../models/periodoNomina');
    const Periodo = await getPeriodoNominaModel();
    const p = await Periodo.findOne({ _id: periodoId, tenantId }).select('numeroPeriodo').lean();
    return p && p.numeroPeriodo != null ? Number(p.numeroPeriodo) : null;
  } catch (_) {
    return null;
  }
}


async function crearDescuento(data, usuario = {}) {
  const Descuento = await getDescuentoProgramadoModel();
  const Concepto = await getConceptoNominaModel();
  const codigo = String(data.conceptoCodigo || '').toUpperCase();
  const concepto = await Concepto.findOne({ tenantId: data.tenantId, codigo }).lean();
  if (!concepto?.descuentoProgramado?.permite) {
    throw new Error(`El concepto ${codigo} no está habilitado para descuento programado`);
  }

  const montoOriginal = round2(data.montoOriginal);
  const permiteSaldo = concepto.descuentoProgramado.permiteSaldo !== false;
  const saldoPendiente =
    data.saldoPendiente != null
      ? round2(data.saldoPendiente)
      : permiteSaldo
        ? montoOriginal
        : 0;

  const doc = await Descuento.create({
    tenantId: data.tenantId,
    empresaId: data.empresaId,
    subsidiariaId: data.subsidiariaId || null,
    empleadoId: data.empleadoId,
    conceptoCodigo: codigo,
    fechaInicio: data.fechaInicio,
    fechaTermino: data.fechaTermino || null,
    montoOriginal,
    saldoPendiente,
    importePorPeriodo: round2(data.importePorPeriodo),
    modalidad: data.modalidad || 'monto_fijo',
    porcentaje: Number(data.porcentaje) || 0,
    basePorcentaje: data.basePorcentaje || 'sueldo_periodo',
    importeVariable: data.importeVariable != null ? round2(data.importeVariable) : null,
    periodicidad: data.periodicidad || 'cada_periodo',
    numeroPagos: data.numeroPagos != null && data.numeroPagos !== '' ? Number(data.numeroPagos) : null,
    pagosAplicados: 0,
    estatus: 'activo',
    observaciones: data.observaciones || '',
    creadoPor: usuario.userId || '',
    creadoPorLabel: usuario.userLabel || '',
    metadata: data.metadata || {}
  });

  await registrarMovimiento({
    tenantId: data.tenantId,
    descuentoId: doc._id,
    empleadoId: doc.empleadoId,
    conceptoCodigo: codigo,
    tipo: 'ALTA',
    usuarioId: usuario.userId || '',
    usuarioLabel: usuario.userLabel || '',
    valoresNuevos: {
      montoOriginal: doc.montoOriginal,
      saldoPendiente: doc.saldoPendiente,
      importePorPeriodo: doc.importePorPeriodo,
      modalidad: doc.modalidad,
      estatus: doc.estatus
    },
    mensaje: 'Alta de descuento programado'
  });

  return doc;
}

async function cambiarEstatus(descuentoId, tenantId, nuevoEstatus, usuario = {}, mensaje = '') {
  const Descuento = await getDescuentoProgramadoModel();
  const doc = await Descuento.findOne({ _id: descuentoId, tenantId });
  if (!doc) throw new Error('Descuento no encontrado');

  const anterior = doc.estatus;
  if (anterior === nuevoEstatus) return doc;

  const tipoMap = {
    suspendido: 'SUSPENSION',
    activo: 'REACTIVACION',
    cancelado: 'CANCELACION'
  };
  const tipo = tipoMap[nuevoEstatus] || 'MODIFICACION';

  doc.estatus = nuevoEstatus;
  doc.modificadoPor = usuario.userId || '';
  doc.modificadoPorLabel = usuario.userLabel || '';
  await doc.save();

  await registrarMovimiento({
    tenantId,
    descuentoId: doc._id,
    empleadoId: doc.empleadoId,
    conceptoCodigo: doc.conceptoCodigo,
    tipo,
    usuarioId: usuario.userId || '',
    usuarioLabel: usuario.userLabel || '',
    valoresAnteriores: { estatus: anterior },
    valoresNuevos: { estatus: nuevoEstatus },
    mensaje: mensaje || `${tipo}: ${anterior} → ${nuevoEstatus}`
  });

  return doc;
}

async function ajustarSaldo(descuentoId, tenantId, nuevoSaldo, usuario = {}, mensaje = '') {
  const Descuento = await getDescuentoProgramadoModel();
  const doc = await Descuento.findOne({ _id: descuentoId, tenantId });
  if (!doc) throw new Error('Descuento no encontrado');

  const saldoAnterior = round2(doc.saldoPendiente);
  const saldoPosterior = round2(nuevoSaldo);
  doc.saldoPendiente = saldoPosterior;
  doc.modificadoPor = usuario.userId || '';
  doc.modificadoPorLabel = usuario.userLabel || '';
  if (saldoPosterior <= 0 && doc.estatus === 'activo') {
    doc.estatus = 'liquidado';
  }
  await doc.save();

  await registrarMovimiento({
    tenantId,
    descuentoId: doc._id,
    empleadoId: doc.empleadoId,
    conceptoCodigo: doc.conceptoCodigo,
    tipo: 'AJUSTE_SALDO',
    saldoAnterior,
    saldoPosterior,
    usuarioId: usuario.userId || '',
    usuarioLabel: usuario.userLabel || '',
    valoresAnteriores: { saldoPendiente: saldoAnterior },
    valoresNuevos: { saldoPendiente: saldoPosterior, estatus: doc.estatus },
    mensaje: mensaje || 'Ajuste manual de saldo'
  });

  return doc;
}

function importeSolicitado(descuento, contexto = {}) {
  const mod = descuento.modalidad || 'monto_fijo';
  if (mod === 'liquidacion') {
    return round2(descuento.saldoPendiente);
  }
  if (mod === 'porcentaje') {
    let base = 0;
    const b = descuento.basePorcentaje || 'sueldo_periodo';
    if (b === 'percepciones_gravadas') base = Number(contexto.PERCEPCIONES_GRAVADAS) || 0;
    else if (b === 'neto_provisional') base = Number(contexto.NETO_PROVISIONAL) || 0;
    else base = Number(contexto.SUELDO) || Number(contexto.sueldoPeriodo) || 0;
    return round2((base * (Number(descuento.porcentaje) || 0)) / 100);
  }
  if (mod === 'monto_variable') {
    if (descuento.importeVariable == null) return 0;
    return round2(descuento.importeVariable);
  }
  return round2(descuento.importePorPeriodo);
}

function vigenteEnFecha(descuento, fecha) {
  const f = fecha ? new Date(fecha) : new Date();
  if (descuento.fechaInicio && new Date(descuento.fechaInicio) > f) return false;
  if (descuento.fechaTermino && new Date(descuento.fechaTermino) < f) return false;
  return true;
}

/**
 * Calcula líneas a inyectar en el detalle del recibo (sin persistir saldos aún).
 * Devuelve { lineas, pendientesConfirmacion }.
 */
async function calcularAplicacionesParaEmpleado({
  tenantId,
  empresaId,
  subsidiariaId,
  empleado,
  periodo,
  detalle,
  contexto,
  conceptosByCodigo,
  informativos
}) {
  const cfg = await resolverConfig(tenantId, empresaId, subsidiariaId || empleado?.subsidiariaId);
  if (!cfg?.moduloActivo) {
    return { lineas: [], pendientesConfirmacion: [] };
  }

  const cfgMap = conceptoCfgMap(cfg);
  const listaConfigVacia = !(cfg.conceptos && cfg.conceptos.length);
  const Descuento = await getDescuentoProgramadoModel();
  const fechaRef = periodo.fechaFin || periodo.fechaInicio || new Date();

  const activos = await Descuento.find({
    tenantId,
    empleadoId: empleado._id,
    estatus: 'activo'
  })
    .sort({ createdAt: 1 })
    .lean();

  const lineas = [];
  const pendientesConfirmacion = [];
  const informativosSet = informativos instanceof Set ? informativos : new Set(informativos || []);

  // Neto provisional para tope de aplicación parcial
  const totalesPrev = calcularTotalesDesdeConfig(detalle, informativosSet);
  let netoDisponible = round2(totalesPrev.netoPagar);

  for (const d of activos) {
    if (!vigenteEnFecha(d, fechaRef)) continue;

    const codigo = String(d.conceptoCodigo || '').toUpperCase();
    const cCfg = cfgMap.get(codigo);
    const conceptoMeta = conceptosByCodigo?.get?.(codigo) || {};
    const resolved = resolverFlagsConcepto(cCfg, conceptoMeta, { listaConfigVacia });
    if (!resolved.ok) continue;

    // Evitar doble aplicación si ya hay línea con importe del motor de fórmulas
    const existente = detalle.find((x) => String(x.conceptoCodigo).toUpperCase() === codigo);
    if (existente && round2(existente.importe) > 0) continue;

    const solicitado = importeSolicitado(d, {
      ...contexto,
      NETO_PROVISIONAL: netoDisponible,
      sueldoPeriodo: contexto.SUELDO
    });
    if (solicitado <= 0) continue;

    const generaSaldo = resolved.generaSaldo;
    const permiteParcial = resolved.permiteParcial;

    // Si genera saldo y quedó en 0 pero aún no ha habido pagos y hay monto original, usar ese tope
    let saldoBase = round2(d.saldoPendiente);
    if (generaSaldo && saldoBase <= 0 && round2(d.montoOriginal) > 0 && !(d.pagosAplicados > 0)) {
      saldoBase = round2(d.montoOriginal);
    }

    let aplicable = solicitado;
    if (generaSaldo) {
      aplicable = Math.min(aplicable, saldoBase);
    }
    if (d.numeroPagos != null && d.pagosAplicados >= d.numeroPagos) continue;

    if (aplicable <= 0) continue;

    if (aplicable > netoDisponible) {
      if (!permiteParcial) continue;
      aplicable = round2(netoDisponible);
    }
    if (aplicable <= 0) continue;

    const parcial = aplicable < solicitado - 0.005;
    const saldoAnterior = generaSaldo ? saldoBase : round2(d.saldoPendiente);
    const saldoPosterior = generaSaldo ? round2(saldoAnterior - aplicable) : saldoAnterior;

    const linea = {
      conceptoCodigo: codigo,
      formulaUsada: `descuento_programado:${d.modalidad}`,
      condicionUsada: `descuentoId=${d._id}`,
      variablesUsadas: {
        descuentoId: String(d._id),
        solicitado,
        aplicable,
        saldoAnterior,
        saldoPosterior,
        parcial
      },
      importe: aplicable,
      gravado: 0,
      exento: 0,
      isr: { gravado: 0, exento: 0 },
      imss: { integraSBC: 0, noIntegra: aplicable },
      desgloseModo: 'todo_exento',
      claveSAT: conceptoMeta.claveSAT || conceptoMeta.sat?.clave || '',
      fiscal: conceptoMeta.fiscal || {
        naturaleza: 'fiscal',
        integraISR: false,
        integraIMSS: false
      },
      tipo: 'deduccion',
      requiereRevision: false,
      errorCalculo: '',
      versionFormula: 1,
      origenDescuentoProgramado: true
    };

    if (existente && round2(existente.importe) === 0) {
      Object.assign(existente, linea);
    } else {
      lineas.push(linea);
      detalle.push(linea);
    }

    pendientesConfirmacion.push({
      descuentoId: d._id,
      conceptoCodigo: codigo,
      solicitado,
      aplicable,
      saldoAnterior,
      saldoPosterior,
      parcial,
      generaSaldo
    });

    netoDisponible = round2(netoDisponible - aplicable);
  }

  return { lineas, pendientesConfirmacion };
}

/**
 * Persiste saldos y movimientos tras crear el recibo.
 */
async function confirmarAplicaciones(pendientes, { tenantId, periodoId, reciboId, usuario = {} }) {
  if (!pendientes?.length) return [];
  const Descuento = await getDescuentoProgramadoModel();
  const resultados = [];
  const numeroPeriodo = await resolverNumeroPeriodo(tenantId, periodoId);

  for (const p of pendientes) {
    const doc = await Descuento.findOne({ _id: p.descuentoId, tenantId });
    if (!doc) continue;

    doc.saldoPendiente = p.saldoPosterior;
    doc.pagosAplicados = (doc.pagosAplicados || 0) + 1;
    if (p.generaSaldo && p.saldoPosterior <= 0) {
      doc.estatus = 'liquidado';
    } else if (doc.numeroPagos != null && doc.pagosAplicados >= doc.numeroPagos) {
      doc.estatus = 'liquidado';
    }
    await doc.save();

    const mov = await registrarMovimiento({
      tenantId,
      descuentoId: doc._id,
      empleadoId: doc.empleadoId,
      conceptoCodigo: doc.conceptoCodigo,
      tipo: p.parcial ? 'APLICACION_PARCIAL' : 'APLICACION',
      periodoId,
      numeroPeriodo,
      reciboId,
      importeSolicitado: p.solicitado,
      importeAplicado: p.aplicable,
      saldoAnterior: p.saldoAnterior,
      saldoPosterior: p.saldoPosterior,
      usuarioId: usuario.userId || 'sistema',
      usuarioLabel: usuario.userLabel || 'Cálculo de nómina',
      mensaje: p.parcial
        ? `Aplicación parcial ${p.aplicable} de ${p.solicitado}`
        : `Aplicación ${p.aplicable}`,
      detalle: { generaSaldo: p.generaSaldo }
    });
    resultados.push(mov);
  }
  return resultados;
}

/**
 * Revierte aplicaciones de un período (antes de recalcular / limpiar recibos).
 */
async function revertirAplicacionesPeriodo(tenantId, periodoId) {
  const Mov = await getDescuentoProgramadoMovimientoModel();
  const Descuento = await getDescuentoProgramadoModel();
  const numeroPeriodo = await resolverNumeroPeriodo(tenantId, periodoId);

  const movs = await Mov.find({
    tenantId,
    periodoId,
    tipo: { $in: ['APLICACION', 'APLICACION_PARCIAL'] }
  }).lean();

  for (const m of movs) {
    const doc = await Descuento.findOne({ _id: m.descuentoId, tenantId });
    if (doc) {
      const saldoAnterior = round2(doc.saldoPendiente);
      const restaurado = round2(saldoAnterior + (Number(m.importeAplicado) || 0));
      doc.saldoPendiente = restaurado;
      doc.pagosAplicados = Math.max(0, (doc.pagosAplicados || 0) - 1);
      if (doc.estatus === 'liquidado' && restaurado > 0) {
        doc.estatus = 'activo';
      }
      await doc.save();

      await registrarMovimiento({
        tenantId,
        descuentoId: doc._id,
        empleadoId: doc.empleadoId,
        conceptoCodigo: doc.conceptoCodigo,
        tipo: 'REVERSION',
        periodoId,
        numeroPeriodo: m.numeroPeriodo != null ? m.numeroPeriodo : numeroPeriodo,
        reciboId: m.reciboId,
        importeSolicitado: m.importeAplicado,
        importeAplicado: round2(-(Number(m.importeAplicado) || 0)),
        saldoAnterior,
        saldoPosterior: restaurado,
        usuarioId: 'sistema',
        usuarioLabel: 'Recálculo / limpieza período',
        mensaje: 'Reversión por recálculo de período',
        detalle: { movimientoOrigenId: String(m._id) }
      });
    }
  }

  // Marcar aplicaciones originales como revertidas en detalle (no borrar historial)
  if (movs.length) {
    await Mov.updateMany(
      { _id: { $in: movs.map((m) => m._id) } },
      { $set: { 'detalle.revertido': true } }
    );
  }

  return movs.length;
}

async function listarDescuentos(tenantId, filtros = {}) {
  const Descuento = await getDescuentoProgramadoModel();
  const q = { tenantId };
  if (filtros.empleadoId) q.empleadoId = filtros.empleadoId;
  if (filtros.subsidiariaId) q.subsidiariaId = filtros.subsidiariaId;
  if (filtros.conceptoCodigo) q.conceptoCodigo = String(filtros.conceptoCodigo).toUpperCase();
  if (filtros.estatus) q.estatus = filtros.estatus;
  if (filtros.empresaId) q.empresaId = filtros.empresaId;
  return Descuento.find(q).sort({ createdAt: -1 }).limit(filtros.limit || 200).lean();
}

async function listarMovimientos(tenantId, filtros = {}) {
  const Mov = await getDescuentoProgramadoMovimientoModel();
  const q = { tenantId };
  if (filtros.descuentoId) q.descuentoId = filtros.descuentoId;
  if (filtros.empleadoId) q.empleadoId = filtros.empleadoId;
  if (filtros.periodoId) q.periodoId = filtros.periodoId;
  if (filtros.tipo) q.tipo = filtros.tipo;
  return Mov.find(q).sort({ createdAt: -1 }).limit(filtros.limit || 100).lean();
}

async function conceptosHabilitadosCatalogo(tenantId) {
  const Concepto = await getConceptoNominaModel();
  return Concepto.find({
    tenantId,
    activo: true,
    tipo: 'deduccion',
    'descuentoProgramado.permite': true
  })
    .sort({ codigo: 1 })
    .lean();
}

module.exports = {
  resolverConfig,
  upsertConfig,
  crearDescuento,
  cambiarEstatus,
  ajustarSaldo,
  calcularAplicacionesParaEmpleado,
  confirmarAplicaciones,
  revertirAplicacionesPeriodo,
  listarDescuentos,
  listarMovimientos,
  conceptosHabilitadosCatalogo,
  importeSolicitado,
  resolverFlagsConcepto,
  round2
};
