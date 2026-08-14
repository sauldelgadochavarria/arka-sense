'use strict';

const getPeriodoNominaModel = require('../models/periodoNomina');
const getEmpleadoModel = require('../models/empleado');
const getReciboNominaModel = require('../models/reciboNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getLayoutBancarioModel = require('../models/layoutBancario');
const getEmpresaModel = require('../models/empresa');
const {
  renderLayoutBancario,
  buildLoteContext,
  normalizeEmpleadoLayout,
  normalizeReciboLayout,
  normalizePeriodoLayout
} = require('./layoutBancarioService');

function parseFechaInput(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = String(v).trim();
  if (!s) return null;
  // yyyy-mm-dd from <input type="date">
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeFilename(name) {
  return String(name || 'dispersion')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80);
}

/**
 * Arma items (empleado+recibo) desde histórico (cerrado) o recibos operativos.
 */
async function loadItemsParaDispersion(tenantId, periodo) {
  const Empleado = await getEmpleadoModel();
  const empresaId = periodo.empresaId;

  if (periodo.estatus === 'cerrado') {
    const Historico = await getNominaHistoricoReciboModel();
    const filter = { tenantId, periodoId: periodo._id, origen: 'cierre' };
    if (empresaId) filter.empresaId = empresaId;
    const hist = await Historico.find(filter).lean();
    const empIds = hist.map((h) => h.empleadoId);
    const empleados = await Empleado.find({ _id: { $in: empIds } }).lean();
    const byId = new Map(empleados.map((e) => [String(e._id), e]));

    return hist.map((h) => {
      const empDoc = byId.get(String(h.empleadoId)) || {};
      const empMerged = {
        ...empDoc,
        numEmpleado: h.empleado?.numEmpleado || empDoc.numEmpleado,
        firstName: empDoc.firstName || (h.empleado?.nombre || '').split(' ')[0],
        lastName: empDoc.lastName || h.empleado?.nombre || '',
        curp: empDoc.curp || '',
        rfc: empDoc.rfc || '',
        datosBancarios: empDoc.datosBancarios || {}
      };
      return {
        historicoId: h._id,
        reciboOrigenId: h.reciboOrigenId,
        empleadoId: h.empleadoId,
        empleado: normalizeEmpleadoLayout(empMerged),
        recibo: normalizeReciboLayout({
          netoPagar: h.netoPagar,
          totalPercepciones: h.totalPercepciones,
          totalDeducciones: h.totalDeducciones,
          diasLaborados: h.diasLaborados,
          calculoId: h.calculoId
        })
      };
    });
  }

  const Recibo = await getReciboNominaModel();
  const recibos = await Recibo.find({ tenantId, periodoId: periodo._id }).lean();
  const empIds = recibos.map((r) => r.empleadoId);
  const empleados = await Empleado.find({ _id: { $in: empIds } }).lean();
  const byId = new Map(empleados.map((e) => [String(e._id), e]));

  return recibos.map((r) => {
    const empDoc = byId.get(String(r.empleadoId)) || {};
    return {
      reciboId: r._id,
      empleadoId: r.empleadoId,
      empleado: normalizeEmpleadoLayout(empDoc),
      recibo: normalizeReciboLayout(r)
    };
  });
}

/**
 * Genera archivo bancario y marca estatus en período + recibos/histórico.
 */
async function generarDispersionBancaria({
  tenantId,
  periodoId,
  layoutId,
  fechaPago,
  userId = '',
  userLabel = ''
}) {
  const Periodo = await getPeriodoNominaModel();
  const Layout = await getLayoutBancarioModel();
  const Empresa = await getEmpresaModel();

  const periodo = await Periodo.findOne({ tenantId, _id: periodoId }).lean();
  if (!periodo) throw new Error('Período no encontrado');
  if (periodo.estatus !== 'cerrado' && periodo.estatus !== 'calculado') {
    throw new Error('Solo se puede generar dispersión en períodos calculados o cerrados');
  }

  const layout = await Layout.findOne({
    tenantId,
    _id: layoutId,
    activo: true
  }).lean();
  if (!layout) throw new Error('Layout bancario no encontrado o inactivo');

  const empresa = await Empresa.findOne({ tenantId }).lean();
  const itemsRaw = await loadItemsParaDispersion(tenantId, periodo);
  if (!itemsRaw.length) throw new Error('El período no tiene recibos para dispersar');

  const fechaPagoDate = parseFechaInput(fechaPago) || new Date();
  const fechaGeneracion = new Date();
  const lote = buildLoteContext(itemsRaw, {
    fechaPago: fechaPagoDate,
    fechaGeneracion,
    secuencia: String(periodo.numeroPeriodo || '')
  });

  const rendered = renderLayoutBancario(layout, {
    lote,
    periodo: normalizePeriodoLayout(periodo),
    empresa: empresa || {},
    items: itemsRaw,
    ahora: fechaGeneracion,
    fechaPago: fechaPagoDate,
    fechaGeneracion
  });

  const stamp = fechaGeneracion.toISOString().slice(0, 10).replace(/-/g, '');
  const archivoNombre = safeFilename(
    `${layout.codigo || 'LAYOUT'}_${periodo.tipoPeriodo || 'per'}_${periodo.numeroPeriodo || 'x'}_${stamp}.txt`
  );

  const statusPatch = {
    estatus: 'generado',
    layoutId: layout._id,
    layoutCodigo: layout.codigo || '',
    layoutNombre: layout.nombre || '',
    fechaPago: fechaPagoDate,
    fechaGeneracion,
    archivoNombre,
    cantidadRecibos: itemsRaw.length,
    totalPagar: lote.totalPagar,
    generadoPorUserId: userId || '',
    generadoPorLabel: userLabel || ''
  };

  await Periodo.updateOne(
    { _id: periodo._id },
    { $set: { layoutBancario: statusPatch } }
  );

  if (periodo.estatus === 'cerrado') {
    const Historico = await getNominaHistoricoReciboModel();
    const ids = itemsRaw.map((i) => i.historicoId).filter(Boolean);
    if (ids.length) {
      await Historico.updateMany(
        { _id: { $in: ids } },
        { $set: { layoutBancario: statusPatch } }
      );
    }
  } else {
    const Recibo = await getReciboNominaModel();
    const ids = itemsRaw.map((i) => i.reciboId).filter(Boolean);
    if (ids.length) {
      await Recibo.updateMany(
        { _id: { $in: ids } },
        { $set: { layoutBancario: statusPatch } }
      );
    }
  }

  return {
    contenido: rendered.contenido,
    encoding: rendered.encoding || 'utf8',
    archivoNombre,
    lineas: rendered.lineas,
    lote,
    layout,
    periodo,
    status: statusPatch
  };
}

module.exports = {
  generarDispersionBancaria,
  loadItemsParaDispersion,
  parseFechaInput
};
