'use strict';

const getEmpleadoModel = require('../models/empleado');
const getTurnoModel = require('../models/turno');
const getDailyAttendanceModel = require('../models/dailyAttendance');
const getIncidenciaModel = require('../models/incidencia');
const getPayrollDetailModel = require('../models/payrollDetail');
const getPayrollPeriodModel = require('../models/payrollPeriod');
const { ensurePayrollConceptsForTenant, listPrenominaConceptos } = require('./payrollConceptService');
const {
  listPendientesPorRango,
  vincularAlPeriodo
} = require('./movimientoAsistenciaNominaService');
const { validateCodigoExternoForPeriod } = require('./payrollPreflightService');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');
const { filterEmpleadosByTipoMotor } = require('../libs/empleadoTipoPeriodo');
const { listTiposPeriodo } = require('./tipoPeriodoNominaService');
const { clasificarHorasExtraPeriodo } = require('../libs/horasExtraClasificacion');

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function getHorasJornada(turno) {
  return turno?.horasJornada > 0 ? turno.horasJornada : 8;
}

function dateKey(d) {
  return startOfDay(d).toISOString().slice(0, 10);
}

function eachDayInRange(inicio, fin, fn) {
  let d = startOfDay(inicio);
  const end = startOfDay(fin);
  while (d <= end) {
    fn(new Date(d));
    d = new Date(d.getTime() + 86400000);
  }
}

function calcularEmpleadoPeriodo(empleado, turno, dailies, incidencias) {
  const salarioDiario = Number(empleado.salarioDiario) || 0;
  const horasJornada = getHorasJornada(turno);
  const minutosJornada = horasJornada * 60;
  const salarioHora = salarioDiario / horasJornada;

  let diasTrabajados = 0;
  let minutosRetardo = 0;
  let minutosHorasExtra = 0;
  let minutosHEOrdinaria = 0;
  let minutosHEDoble = 0;
  let minutosHETriple = 0;
  let minutosSalidaAnticipada = 0;
  let diasConRetardo = 0;
  const diasCubiertos = new Set();
  const diasFaltaSet = new Set();
  const diasHE = [];

  for (const day of dailies) {
    if (day.estatus === 'presente' || day.estatus === 'retardo') {
      diasTrabajados += 1;
      diasCubiertos.add(dateKey(day.fecha));
    }
    if (['falta', 'registro_parcial', 'fuera_de_rango'].includes(day.estatus)) {
      diasFaltaSet.add(dateKey(day.fecha));
    }
    const minRet = day.minutosRetardo || 0;
    minutosRetardo += minRet;
    if (minRet > 0 || day.estatus === 'retardo') {
      diasConRetardo += 1;
    }
    minutosSalidaAnticipada += day.minutosSalidaAnticipada || 0;
    const minHeDia =
      Number(day.minutosHorasExtra) ||
      (Number(day.minutosHEOrdinaria) || 0) +
        (Number(day.minutosHEDoble) || 0) +
        (Number(day.minutosHETriple) || 0);
    if (minHeDia > 0) {
      diasHE.push({ fecha: day.fecha, minutosExtra: minHeDia });
    }
  }

  const clasif = clasificarHorasExtraPeriodo(diasHE);
  minutosHEOrdinaria = 0;
  minutosHEDoble = clasif.minutosDobles;
  minutosHETriple = clasif.minutosTriples;
  minutosHorasExtra = minutosHEDoble + minutosHETriple;

  for (const inc of incidencias) {
    if (inc.codigo === 'VAC' || inc.codigo === 'PCG') {
      eachDayInRange(inc.fechaInicio, inc.fechaFin, (d) => {
        const key = dateKey(d);
        if (!diasCubiertos.has(key)) {
          diasTrabajados += 1;
          diasCubiertos.add(key);
        }
      });
    }
    if (inc.codigo === 'PSG') {
      eachDayInRange(inc.fechaInicio, inc.fechaFin, (d) => {
        const key = dateKey(d);
        if (diasCubiertos.has(key)) {
          diasTrabajados = Math.max(0, diasTrabajados - 1);
          diasCubiertos.delete(key);
        }
        diasFaltaSet.add(key);
      });
    }
    if (inc.codigo === 'FI') {
      eachDayInRange(inc.fechaInicio, inc.fechaFin, (d) => {
        const key = dateKey(d);
        // Asistencia presente/retardo gana: no cobrar falta el mismo día
        if (diasCubiertos.has(key)) return;
        diasFaltaSet.add(key);
      });
    }
  }

  // Días ya pagados vía diasTrabajados no deben vivir también en faltas
  for (const key of diasCubiertos) diasFaltaSet.delete(key);
  const diasFalta = diasFaltaSet.size;

  const percepcionSalario = roundMoney(salarioDiario * diasTrabajados);
  // Dobles (LFT) al ×2; triples (excedente día/semana) al ×3
  const percepcionHE = roundMoney(
    (minutosHEDoble / 60) * salarioHora * 2 + (minutosHETriple / 60) * salarioHora * 3
  );
  const deduccionRetardos = roundMoney((minutosRetardo / minutosJornada) * salarioDiario);
  // P001 ya es solo días trabajados: no volver a descontar faltas (sería doble castigo)
  const deduccionFaltas = 0;
  const deduccionSA = roundMoney((minutosSalidaAnticipada / minutosJornada) * salarioDiario);

  const percepciones = [];
  const deducciones = [];

  if (percepcionSalario > 0) {
    percepciones.push({ clave: 'P001', nombre: 'Salario del período', tipo: 'percepcion', monto: percepcionSalario, formula: 'salario_periodo' });
  }
  if (percepcionHE > 0) {
    percepciones.push({ clave: 'P002', nombre: 'Horas extra', tipo: 'percepcion', monto: percepcionHE, formula: 'horas_extra' });
  }
  if (deduccionRetardos > 0) {
    deducciones.push({ clave: 'D001', nombre: 'Retardos', tipo: 'deduccion', monto: deduccionRetardos, formula: 'retardos' });
  }
  if (deduccionFaltas > 0) {
    deducciones.push({ clave: 'D002', nombre: 'Faltas injustificadas', tipo: 'deduccion', monto: deduccionFaltas, formula: 'faltas' });
  }
  if (deduccionSA > 0) {
    deducciones.push({ clave: 'D003', nombre: 'Salidas anticipadas', tipo: 'deduccion', monto: deduccionSA, formula: 'salida_anticipada' });
  }

  const totalPercepciones = roundMoney(percepciones.reduce((s, l) => s + l.monto, 0));
  const totalDeducciones = roundMoney(deducciones.reduce((s, l) => s + l.monto, 0));

  return {
    diasTrabajados,
    diasFalta,
    diasConRetardo,
    minutosRetardo,
    minutosHorasExtra,
    minutosHEOrdinaria,
    minutosHEDoble,
    minutosHETriple,
    minutosSalidaAnticipada,
    salarioDiario,
    percepciones,
    deducciones,
    totalPercepciones,
    totalDeducciones,
    netoPagar: roundMoney(totalPercepciones - totalDeducciones),
    estatus: 'calculado'
  };
}

function resolverTipoMovimiento(tipoMov) {
  const t = String(tipoMov || '').trim().toLowerCase();
  if (t === '2' || t === 'deduccion' || t === 'd') return 'deduccion';
  return 'percepcion';
}

function buildConceptosMap(conceptos) {
  const map = new Map();
  for (const c of conceptos || []) {
    map.set(String(c.clave).toUpperCase(), c);
    if (c.codigoExterno) map.set(String(c.codigoExterno).toUpperCase(), c);
  }
  return map;
}

function aplicarMovimientosAlCalculo(calc, movimientos, conceptosMap) {
  if (!movimientos?.length) return calc;

  for (const mov of movimientos) {
    const claveRaw = String(mov.conceptoClave || mov.claPerded || '').trim();
    if (!claveRaw) continue;
    const claveLookup = claveRaw.toUpperCase();
    const monto = roundMoney(mov.monto);
    if (monto <= 0) continue;

    const cat = conceptosMap.get(claveLookup);
    const tipo = cat?.tipo || resolverTipoMovimiento(mov.tipoMovimiento);
    const nombre = cat?.nombre || (mov.referencia ? mov.referencia : `Mov. ${claveRaw}`);
    const linea = {
      clave: cat?.clave || claveRaw,
      nombre,
      tipo,
      monto,
      formula: 'manual'
    };

    if (tipo === 'deduccion') calc.deducciones.push(linea);
    else calc.percepciones.push(linea);
  }

  calc.totalPercepciones = roundMoney(calc.percepciones.reduce((s, l) => s + l.monto, 0));
  calc.totalDeducciones = roundMoney(calc.deducciones.reduce((s, l) => s + l.monto, 0));
  calc.netoPagar = roundMoney(calc.totalPercepciones - calc.totalDeducciones);
  return calc;
}

async function calculatePayrollPeriod(periodId, tenantId, userId = '') {
  const PayrollPeriod = await getPayrollPeriodModel();
  const period = await PayrollPeriod.findOne({ _id: periodId, tenantId });
  if (!period) throw new Error('PERIOD_NOT_FOUND');
  if (period.estatus === 'cerrado') throw new Error('PERIOD_CLOSED');
  if (period.estatus === 'pendiente') throw new Error('PERIOD_NOT_OPEN');
  // abierto = primer cálculo; borrador = recálculo tras corregir asistencia
  if (!['abierto', 'borrador'].includes(period.estatus)) throw new Error('PERIOD_NOT_OPEN');

  await ensurePayrollConceptsForTenant(tenantId, period.empresaId);
  const conceptos = await listPrenominaConceptos(tenantId, { soloActivos: true });
  const conceptosMap = buildConceptosMap(conceptos);

  const Empleado = await getEmpleadoModel();
  const Turno = await getTurnoModel();
  const DailyAttendance = await getDailyAttendanceModel();
  const Incidencia = await getIncidenciaModel();
  const PayrollDetail = await getPayrollDetailModel();

  const empleadosAll = await Empleado.find({ tenantId, estatus: 'activo', activo: true }).lean();
  const tiposPeriodo = await listTiposPeriodo(tenantId, false);
  const tipoMotor = period.tipo || null;
  const empleados = filterEmpleadosByTipoMotor(empleadosAll, tiposPeriodo, tipoMotor, {
    strict: false
  });
  const inicio = startOfDay(period.fechaInicio);
  const fin = endOfDay(period.fechaFin);
  const usaAsistencia = period.aplicaAsistenciaPrenomina !== false;

  const movimientos = await listPendientesPorRango(tenantId, inicio, fin, period._id);
  const movPorEmpleado = new Map();
  const movimientoIds = [];
  for (const mov of movimientos) {
    if (!mov.empleadoId) continue;
    const key = String(mov.empleadoId);
    if (!movPorEmpleado.has(key)) movPorEmpleado.set(key, []);
    movPorEmpleado.get(key).push(mov);
    movimientoIds.push(mov._id);
  }

  let totales = { empleados: 0, percepciones: 0, deducciones: 0, neto: 0 };

  for (const empleado of empleados) {
    const [dailies, incidencias, turno] = await Promise.all([
      usaAsistencia
        ? DailyAttendance.find({
            tenantId,
            empleadoId: empleado._id,
            fecha: { $gte: inicio, $lte: fin }
          }).lean()
        : Promise.resolve([]),
      Incidencia.find({
        tenantId,
        empleadoId: empleado._id,
        estatus: 'aprobada',
        fechaInicio: { $lte: fin },
        fechaFin: { $gte: inicio }
      }).lean(),
      empleado.turnoId ? Turno.findById(empleado.turnoId).lean() : null
    ]);

    let calc = calcularEmpleadoPeriodo(empleado, turno, dailies, incidencias);
    const movsEmp = movPorEmpleado.get(String(empleado._id)) || [];
    if (movsEmp.length) {
      calc = aplicarMovimientosAlCalculo(calc, movsEmp, conceptosMap);
    }

    await PayrollDetail.findOneAndUpdate(
      { tenantId, periodId: period._id, empleadoId: empleado._id },
      {
        $set: {
          tenantId,
          periodId: period._id,
          empleadoId: empleado._id,
          ...calc,
          ajustesManuales: []
        }
      },
      { upsert: true }
    );

    totales.empleados += 1;
    totales.percepciones += calc.totalPercepciones;
    totales.deducciones += calc.totalDeducciones;
    totales.neto += calc.netoPagar;
  }

  if (movimientoIds.length) {
    await vincularAlPeriodo(tenantId, movimientoIds, period._id);
  }

  period.estatus = 'borrador';
  period.calculadoAt = new Date();
  period.calculadoPorUserId = userId;
  period.totales = {
    empleados: totales.empleados,
    percepciones: roundMoney(totales.percepciones),
    deducciones: roundMoney(totales.deducciones),
    neto: roundMoney(totales.neto)
  };
  await period.save();

  return period.toObject();
}

async function applyManualAdjustment(periodId, tenantId, empleadoId, ajuste, userId) {
  const PayrollPeriod = await getPayrollPeriodModel();
  const PayrollDetail = await getPayrollDetailModel();

  const period = await PayrollPeriod.findOne({ _id: periodId, tenantId });
  if (!period) throw new Error('PERIOD_NOT_FOUND');
  if (period.estatus === 'cerrado') throw new Error('PERIOD_CLOSED');

  const detail = await PayrollDetail.findOne({ tenantId, periodId, empleadoId });
  if (!detail) throw new Error('DETAIL_NOT_FOUND');

  const monto = roundMoney(ajuste.monto);
  const tipo = ajuste.tipo === 'deduccion' ? 'deduccion' : 'percepcion';
  const linea = {
    clave: 'AJM',
    nombre: ajuste.concepto || 'Ajuste manual',
    tipo,
    monto: Math.abs(monto)
  };

  if (tipo === 'percepcion') detail.percepciones.push(linea);
  else detail.deducciones.push(linea);

  detail.ajustesManuales.push({
    concepto: linea.nombre,
    monto: linea.monto,
    nota: ajuste.nota || '',
    userId,
    fecha: new Date()
  });

  detail.totalPercepciones = roundMoney(detail.percepciones.reduce((s, l) => s + l.monto, 0));
  detail.totalDeducciones = roundMoney(detail.deducciones.reduce((s, l) => s + l.monto, 0));
  detail.netoPagar = roundMoney(detail.totalPercepciones - detail.totalDeducciones);
  detail.estatus = 'ajustado';
  await detail.save();

  await recalcularTotalesPeriodo(period);
  return detail.toObject();
}

async function recalcularTotalesPeriodo(period) {
  const PayrollDetail = await getPayrollDetailModel();
  const details = await PayrollDetail.find({ tenantId: period.tenantId, periodId: period._id }).lean();
  period.totales = {
    empleados: details.length,
    percepciones: roundMoney(details.reduce((s, d) => s + d.totalPercepciones, 0)),
    deducciones: roundMoney(details.reduce((s, d) => s + d.totalDeducciones, 0)),
    neto: roundMoney(details.reduce((s, d) => s + d.netoPagar, 0))
  };
  await period.save();
}

async function closePayrollPeriod(periodId, tenantId, userId = '') {
  const PayrollPeriod = await getPayrollPeriodModel();
  const period = await PayrollPeriod.findOne({ _id: periodId, tenantId });
  if (!period) throw new Error('PERIOD_NOT_FOUND');
  if (period.estatus === 'cerrado') throw new Error('PERIOD_CLOSED');
  if (period.estatus === 'abierto') throw new Error('PERIOD_NOT_CALCULATED');

  const preflight = await validateCodigoExternoForPeriod(period, tenantId);
  if (!preflight.ok) {
    const err = new Error('MISSING_CODIGO_EXTERNO');
    err.sinCodigo = preflight.sinCodigo;
    throw err;
  }

  period.estatus = 'cerrado';
  period.cerradoAt = new Date();
  period.cerradoPorUserId = userId;
  await period.save();
  return period.toObject();
}

module.exports = {
  calcularEmpleadoPeriodo,
  aplicarMovimientosAlCalculo,
  buildConceptosMap,
  calculatePayrollPeriod,
  applyManualAdjustment,
  closePayrollPeriod,
  roundMoney
};
