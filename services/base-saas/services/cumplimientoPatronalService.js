'use strict';

const { models } = require('../models/cumplimientoPatronal');
const { models: isnModels } = require('../models/isn');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getDescuentoProgramadoModel = require('../models/descuentoProgramado');
const { crearDescuento, cambiarEstatus } = require('./nomina/descuentoProgramadoService');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dayBefore(fecha) {
  const x = new Date(fecha);
  x.setUTCDate(x.getUTCDate() - 1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

async function auditar(payload) {
  const { AuditoriaCumplimiento } = await models();
  await AuditoriaCumplimiento.create({
    tenantId: payload.tenantId,
    empresaId: payload.empresaId,
    entidad: payload.entidad,
    entidadId: String(payload.entidadId || ''),
    campo: payload.campo,
    valorAnterior: payload.valorAnterior == null ? null : payload.valorAnterior,
    valorNuevo: payload.valorNuevo == null ? null : payload.valorNuevo,
    motivo: payload.motivo || '',
    usuario: payload.usuario || ''
  });
}

/**
 * Cierra la vigencia abierta y agrega la prima real. No asigna la prima media de la clase.
 */
async function agregarPrima(doc, { prima, fechaInicio, claseRiesgo, fraccion, motivo, usuario, tenantId, empresaId }) {
  if (!Number.isFinite(prima)) {
    throw new Error('La prima se captura del documento de determinación. No hay prima por defecto.');
  }
  if (!fechaInicio) throw new Error('La vigencia de la prima necesita fecha de inicio');
  const inicio = new Date(fechaInicio);
  if (!Array.isArray(doc.primas)) doc.primas = [];
  const abiertas = doc.primas.filter((p) => !p.fechaFin);
  for (const p of abiertas) {
    if (new Date(p.fechaInicio) >= inicio) {
      throw new Error('Ya existe una prima con vigencia igual o posterior a esa fecha');
    }
    p.fechaFin = dayBefore(inicio);
  }
  const anterior = doc.primaRiesgo;
  doc.primas.push({
    prima,
    claseRiesgo: claseRiesgo || doc.claseRiesgo || '',
    fraccion: fraccion || doc.fraccion || '',
    fechaInicio: inicio,
    fechaFin: null,
    motivo: motivo || '',
    registradoPor: usuario || ''
  });
  doc.primaRiesgo = prima;
  if (claseRiesgo) doc.claseRiesgo = claseRiesgo;
  if (fraccion) doc.fraccion = fraccion;
  await doc.save();
  await auditar({
    tenantId,
    empresaId,
    entidad: 'registro_patronal',
    entidadId: doc._id,
    campo: 'primaRiesgo',
    valorAnterior: anterior,
    valorNuevo: prima,
    motivo: motivo || `Vigencia ${inicio.toISOString().slice(0, 10)}`,
    usuario
  });
  return doc;
}

async function conceptoDescuento(tenantId, empresaId, institucion) {
  const Concepto = await getConceptoNominaModel();
  const conceptos = await Concepto.find({
    tenantId,
    empresaId,
    tipo: 'deduccion',
    activo: { $ne: false }
  })
    .select('codigo nombre descuentoProgramado fiscal')
    .lean();
  const esFonacot = institucion === 'FONACOT';
  const candidatos = conceptos.filter((c) => {
    const codigo = String(c.codigo || '').toUpperCase();
    const nombre = String(c.nombre || '').toUpperCase();
    if (esFonacot) return codigo.includes('FONACOT') || nombre.includes('FONACOT') || c.fiscal?.integraFONACOT === true;
    return codigo.includes('INFONAVIT') || nombre.includes('INFONAVIT') || c.fiscal?.integraINFONAVIT === true;
  });
  return candidatos.find((c) => c.descuentoProgramado?.permite) || null;
}

function estatusDescuentoDeCredito(estatus) {
  if (estatus === 'suspendido') return 'suspendido';
  if (estatus === 'liquidado') return 'liquidado';
  if (estatus === 'cancelado') return 'cancelado';
  return 'activo';
}

/**
 * Actualiza el descuento que aplicará el próximo cálculo.
 * Un factor de INFONAVIT no se convierte a pesos.
 */
async function sincronizarDescuentoCredito(credito, usuario = {}) {
  if (credito.tipoDescuento === 'factor') {
    return {
      vinculado: false,
      mensaje: 'El factor queda en el crédito. La nómina no lo convierte a importe.'
    };
  }
  const concepto = await conceptoDescuento(credito.tenantId, credito.empresaId, credito.institucion);
  if (!concepto) {
    return {
      vinculado: false,
      mensaje: `No hay un concepto de deducción ${credito.institucion} habilitado para descuento programado. El crédito quedó registrado y la nómina no lo descontará todavía.`
    };
  }
  const Descuento = await getDescuentoProgramadoModel();
  const modalidad = credito.tipoDescuento === 'porcentaje' ? 'porcentaje' : 'monto_fijo';
  const usuarioDto = { userId: usuario.userId || '', userLabel: usuario.userLabel || usuario.usuario || '' };
  let doc = credito.descuentoProgramadoId
    ? await Descuento.findOne({ _id: credito.descuentoProgramadoId, tenantId: credito.tenantId })
    : null;
  if (!doc) {
    doc = await crearDescuento(
      {
        tenantId: credito.tenantId,
        empresaId: credito.empresaId,
        subsidiariaId: credito.subsidiariaId,
        empleadoId: credito.empleadoId,
        conceptoCodigo: concepto.codigo,
        fechaInicio: credito.fechaInicio,
        fechaTermino: credito.fechaFin,
        montoOriginal: modalidad === 'monto_fijo' ? credito.valorDescuento : 0,
        saldoPendiente: 0,
        importePorPeriodo: modalidad === 'monto_fijo' ? credito.valorDescuento : 0,
        modalidad,
        porcentaje: modalidad === 'porcentaje' ? credito.valorDescuento : 0,
        periodicidad: 'cada_periodo',
        observaciones: `Crédito ${credito.institucion} ${credito.numeroCredito}`,
        metadata: { creditoId: String(credito._id), institucion: credito.institucion }
      },
      usuarioDto
    );
  } else {
    doc.importePorPeriodo = modalidad === 'monto_fijo' ? money(credito.valorDescuento) : 0;
    doc.porcentaje = modalidad === 'porcentaje' ? Number(credito.valorDescuento) || 0 : 0;
    doc.modalidad = modalidad;
    doc.fechaTermino = credito.fechaFin || doc.fechaTermino;
    doc.modificadoPorLabel = usuarioDto.userLabel;
    await doc.save();
  }
  const estatus = estatusDescuentoDeCredito(credito.estatus);
  if (doc.estatus !== estatus) {
    await cambiarEstatus(
      doc._id,
      credito.tenantId,
      estatus,
      usuarioDto,
      `Aviso ${credito.institucion} ${credito.numeroCredito}`
    );
  }
  credito.descuentoProgramadoId = doc._id;
  credito.conceptoCodigo = concepto.codigo;
  await credito.save();
  await auditar({
    tenantId: credito.tenantId,
    empresaId: credito.empresaId,
    entidad: 'credito',
    entidadId: credito._id,
    campo: 'valorDescuento',
    valorAnterior: null,
    valorNuevo: credito.valorDescuento,
    motivo: `Descuento ${concepto.codigo} para el próximo cálculo. Los periodos cerrados no se reescriben.`,
    usuario: usuarioDto.userLabel
  });
  return {
    vinculado: true,
    mensaje: `El descuento ${concepto.codigo} queda para el próximo cálculo. Los periodos ya cerrados no se modifican.`
  };
}

function esDeduccionInfonavit(linea, cat) {
  if (String(linea.tipo || cat?.tipo || '') !== 'deduccion') return false;
  const codigo = String(linea.conceptoCodigo || '').toUpperCase();
  const nombre = String(cat?.nombre || '').toUpperCase();
  const sat = String(linea.claveSAT || '').padStart(3, '0');
  if (codigo.includes('FONACOT') || nombre.includes('FONACOT')) return false;
  return (
    cat?.sua?.archivo === 'CRED' ||
    cat?.fiscal?.integraINFONAVIT === true ||
    codigo.includes('INFONAVIT') ||
    nombre.includes('INFONAVIT') ||
    sat === '010'
  );
}

function esDeduccionFonacot(linea, cat) {
  if (String(linea.tipo || cat?.tipo || '') !== 'deduccion') return false;
  const codigo = String(linea.conceptoCodigo || '').toUpperCase();
  const nombre = String(cat?.nombre || '').toUpperCase();
  const sat = String(linea.claveSAT || '').padStart(3, '0');
  return cat?.fiscal?.integraFONACOT === true || codigo.includes('FONACOT') || nombre.includes('FONACOT') || sat === '011';
}

async function upsertAutomatica(payload) {
  const { ConciliacionObligacion } = await models();
  const previa = await ConciliacionObligacion.findOne({
    tenantId: payload.tenantId,
    empresaId: payload.empresaId,
    obligacion: payload.obligacion,
    anio: payload.anio,
    mes: payload.mes,
    entidad: payload.entidad || '',
    registroPatronal: payload.registroPatronal || '',
    origen: 'automatica',
    estatus: { $ne: 'resuelta' }
  });
  const data = {
    ...payload,
    diferencia: money(payload.importeCalculado - payload.importeOficial),
    origen: 'automatica',
    estatus: previa?.estatus && previa.estatus !== 'resuelta' ? previa.estatus : 'pendiente'
  };
  if (previa) {
    Object.assign(previa, data);
    await previa.save();
    return 'actualizada';
  }
  await ConciliacionObligacion.create(data);
  return 'creada';
}

async function armarConciliacionMes({ tenantId, empresaId, anio, mes, usuario }) {
  const Concepto = await getConceptoNominaModel();
  const Historico = await getNominaHistoricoReciboModel();
  const { CreditoAviso } = await models();
  const { DeterminacionIsn } = await isnModels();
  const conceptos = await Concepto.find({ tenantId, empresaId }).select('codigo nombre tipo fiscal').lean();
  const map = new Map(conceptos.map((c) => [String(c.codigo).toUpperCase(), c]));
  const recibos = await Historico.find({ tenantId, empresaId, anio: Number(anio), mes: Number(mes) })
    .select('conceptos')
    .lean();
  let infonavit = 0;
  let fonacot = 0;
  for (const rec of recibos) {
    for (const linea of rec.conceptos || []) {
      const cat = map.get(String(linea.conceptoCodigo || '').toUpperCase());
      const importe = Number(linea.importe) || 0;
      if (!importe) continue;
      if (esDeduccionFonacot(linea, cat)) fonacot += importe;
      else if (esDeduccionInfonavit(linea, cat)) infonavit += importe;
    }
  }
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;
  const avisos = await CreditoAviso.find({
    tenantId,
    empresaId,
    institucion: 'FONACOT',
    periodoCedula: periodo
  }).lean();
  const cedula = avisos.reduce((s, a) => s + (Number(a.importeCedula) || 0), 0);
  const notas = [];
  let creadas = 0;
  let actualizadas = 0;
  const contar = (r) => {
    if (r === 'creada') creadas += 1;
    else actualizadas += 1;
  };

  contar(
    await upsertAutomatica({
      tenantId,
      empresaId,
      obligacion: 'INFONAVIT',
      anio: Number(anio),
      mes: Number(mes),
      importeCalculado: money(infonavit),
      importeOficial: 0,
      motivo: 'Retención del mes en nómina. Falta la emisión EBA para el importe oficial.',
      responsable: usuario || ''
    })
  );
  notas.push('INFONAVIT compara la retención del mes. El oficial queda en cero hasta importar la EBA.');

  contar(
    await upsertAutomatica({
      tenantId,
      empresaId,
      obligacion: 'FONACOT',
      anio: Number(anio),
      mes: Number(mes),
      importeCalculado: money(fonacot),
      importeOficial: money(cedula),
      motivo: avisos.length
        ? `Retención del mes contra ${avisos.length} cédula(s) del periodo ${periodo}.`
        : 'Retención del mes en nómina. No hay cédula capturada para este periodo.',
      responsable: usuario || ''
    })
  );

  const det = await DeterminacionIsn.findOne({
    tenantId,
    empresaId,
    anio: Number(anio),
    mes: Number(mes),
    estatus: { $in: ['borrador', 'cerrado'] }
  })
    .sort({ version: -1 })
    .lean();
  if (!det) {
    notas.push('ISN no tiene una determinación de ese mes.');
  } else {
    for (const ent of det.porEntidad || []) {
      const oficial = (det.declaraciones || [])
        .filter((d) => String(d.entidad || '').toUpperCase() === String(ent.entidad || '').toUpperCase())
        .reduce((s, d) => s + (Number(d.importe) || 0), 0);
      contar(
        await upsertAutomatica({
          tenantId,
          empresaId,
          obligacion: 'ISN',
          anio: Number(anio),
          mes: Number(mes),
          entidad: ent.entidad || '',
          importeCalculado: money(ent.impuesto),
          importeOficial: money(oficial),
          motivo: oficial
            ? 'Impuesto calculado contra declaraciones capturadas de la entidad.'
            : 'Impuesto calculado. Esa entidad no tiene declaración capturada.',
          responsable: usuario || ''
        })
      );
    }
  }
  notas.push('IMSS no se arma solo: importa el renglón de la EMA o la EBA.');
  return { creadas, actualizadas, notas };
}

function filasCsv(texto) {
  const lines = String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const primera = lines[0].toLowerCase();
  const conEncabezado = primera.includes('obligacion') && primera.includes('calculado');
  const cuerpo = conEncabezado ? lines.slice(1) : lines;
  return cuerpo.map((line) => {
    const c = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    return {
      obligacion: String(c[0] || '').toUpperCase(),
      anio: Number(c[1]),
      mes: Number(c[2]),
      referencia: c[3] || '',
      calculado: money(c[4]),
      oficial: money(c[5])
    };
  });
}

module.exports = {
  auditar,
  agregarPrima,
  sincronizarDescuentoCredito,
  armarConciliacionMes,
  filasCsv,
  money
};
