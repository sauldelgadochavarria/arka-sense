'use strict';

const getEmpleadoModel = require('../models/empleado');
const getAttendanceRecordModel = require('../models/attendanceRecord');
const getSubsidiariaModel = require('../models/subsidiaria');
const getEmpresaModel = require('../models/empresa');
const { resolveTurnoVigente } = require('./turnoResolverService');
const { recalculateDailyAttendance } = require('./attendanceProcessingService');
const { registrarAuditoriaAsistencia } = require('./asistenciaAuditoriaService');
const {
  parseTimeHHMM,
  parseDateTimeLocal,
  ymdInTimeZone,
  DEFAULT_TZ
} = require('../libs/timeHelpers');

const RANGO_DEFAULT = {
  entradaAntesMin: 10,
  entradaDespuesMin: 5,
  salidaAntesMin: 5,
  salidaDespuesMin: 10
};

function clampMin(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(180, Math.round(n));
}

function rangoDe(subsidiaria) {
  const raw = subsidiaria?.marcacionAutomatica || {};
  return {
    entradaAntesMin: clampMin(raw.entradaAntesMin, RANGO_DEFAULT.entradaAntesMin),
    entradaDespuesMin: clampMin(raw.entradaDespuesMin, RANGO_DEFAULT.entradaDespuesMin),
    salidaAntesMin: clampMin(raw.salidaAntesMin, RANGO_DEFAULT.salidaAntesMin),
    salidaDespuesMin: clampMin(raw.salidaDespuesMin, RANGO_DEFAULT.salidaDespuesMin)
  };
}

function offsetEstable(seed, antes, despues) {
  const a = Math.max(0, antes);
  const d = Math.max(0, despues);
  const span = a + d;
  if (!span) return 0;
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return -a + ((h >>> 0) % (span + 1));
}

function offsetSorteo(antes, despues) {
  const a = Math.max(0, antes);
  const d = Math.max(0, despues);
  const span = a + d;
  if (!span) return 0;
  return -a + Math.floor(Math.random() * (span + 1));
}

function hhmm(hora) {
  const t = parseTimeHHMM(hora);
  if (!t) return null;
  return `${String(t.hours).padStart(2, '0')}:${String(t.minutes).padStart(2, '0')}`;
}

function instanteEnDia(ymd, hora, zona, deltaMin) {
  const reloj = hhmm(hora);
  if (!reloj) return null;
  const centro = parseDateTimeLocal(`${ymd}T${reloj}`, zona);
  if (!centro) return null;
  return new Date(centro.getTime() + deltaMin * 60000);
}

function anclaLaboral(ymd) {
  return new Date(`${ymd}T12:00:00.000Z`);
}

function esDiaLaborable(turno, ymd) {
  const day = anclaLaboral(ymd).getUTCDay();
  if (turno.descansaDomingo && day === 0) return false;
  if (turno.descansaSabado && day === 6) return false;
  if (Array.isArray(turno.diasLaborables) && turno.diasLaborables.length > 0) {
    return turno.diasLaborables.includes(day);
  }
  return true;
}

function activa(rec) {
  return rec.estado !== 'anulada';
}

function tocadaPorPersona(rec) {
  return rec.origen === 'ajuste' || Boolean(rec.ajustadoEn);
}

/**
 * Crea entrada y salida (y comida, si el turno la exige) para empleados
 * con marcación automática.
 * modo 'auto': hora estable; solo si ya llegó; no pisa checadas existentes.
 * modo 'reproceso': nuevo sorteo; anula las automáticas no corregidas.
 */
async function generarMarcacionesAutomaticas({
  tenantId,
  subsidiaria,
  ymd,
  departamentoId = null,
  modo = 'auto',
  actor = {}
}) {
  const resumen = {
    creadas: 0,
    empleados: 0,
    descanso: 0,
    sinTurno: 0,
    sinHorario: 0,
    conservadas: 0,
    pendientes: 0
  };
  if (!tenantId || !subsidiaria?._id || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) {
    return resumen;
  }

  const zona = subsidiaria.zonaHoraria || DEFAULT_TZ;
  const rango = rangoDe(subsidiaria);
  const reproceso = modo === 'reproceso';
  const ahora = new Date();
  const Empleado = await getEmpleadoModel();
  const AttendanceRecord = await getAttendanceRecordModel();

  const empQ = {
    tenantId,
    subsidiariaId: subsidiaria._id,
    estatus: 'activo',
    activo: true,
    marcacionAutomatica: true,
    tipoRegistro: { $ne: 'ninguno' }
  };
  if (departamentoId) empQ.departamentoId = departamentoId;

  const empleados = await Empleado.find(empQ).select(
    'turnoId subsidiariaId tipoRegistro departamentoId'
  ).lean();

  const desde = new Date(`${ymd}T00:00:00.000Z`);
  const hasta = new Date(`${ymd}T23:59:59.999Z`);
  const fecha = anclaLaboral(ymd);

  for (const empleado of empleados) {
    const resolved = await resolveTurnoVigente(tenantId, empleado, fecha);
    if (resolved.esDescansoForzado || !resolved.turno) {
      if (!resolved.turno) resumen.sinTurno += 1;
      else resumen.descanso += 1;
      continue;
    }
    const turno = resolved.turno;
    if (!esDiaLaborable(turno, ymd)) {
      resumen.descanso += 1;
      continue;
    }
    if (!hhmm(turno.horaEntrada) || !hhmm(turno.horaSalida)) {
      resumen.sinHorario += 1;
      continue;
    }

    const existentes = await AttendanceRecord.find({
      tenantId,
      empleadoId: empleado._id,
      fecha: { $gte: desde, $lte: hasta }
    }).lean();

    const planes = [
      {
        tipo: 'entrada',
        antes: rango.entradaAntesMin,
        despues: rango.entradaDespuesMin,
        hora: turno.horaEntrada
      },
      {
        tipo: 'salida',
        antes: rango.salidaAntesMin,
        despues: rango.salidaDespuesMin,
        hora: turno.horaSalida
      }
    ];

    const entradaTs = instanteEnDia(
      ymd,
      turno.horaEntrada,
      zona,
      reproceso
        ? offsetSorteo(rango.entradaAntesMin, rango.entradaDespuesMin)
        : offsetEstable(`${empleado._id}|${ymd}|entrada`, rango.entradaAntesMin, rango.entradaDespuesMin)
    );
    const salidaTs = instanteEnDia(
      ymd,
      turno.horaSalida,
      zona,
      reproceso
        ? offsetSorteo(rango.salidaAntesMin, rango.salidaDespuesMin)
        : offsetEstable(`${empleado._id}|${ymd}|salida`, rango.salidaAntesMin, rango.salidaDespuesMin)
    );

    const slots = planes.map((p) => ({
      ...p,
      timestamp: p.tipo === 'entrada' ? entradaTs : salidaTs
    }));

    if (turno.comidaChecada && entradaTs && salidaTs && salidaTs > entradaTs) {
      const comida = Math.max(0, Number(turno.tiempoComidaMin) || 60);
      const totalMin = (salidaTs - entradaTs) / 60000;
      if (totalMin > comida + 20) {
        const ini = (totalMin - comida) / 2;
        const jitter = reproceso
          ? offsetSorteo(2, 2)
          : offsetEstable(`${empleado._id}|${ymd}|comida`, 2, 2);
        const salidaComida = new Date(entradaTs.getTime() + (ini + jitter) * 60000);
        const regreso = new Date(salidaComida.getTime() + comida * 60000);
        if (regreso < salidaTs) {
          slots.splice(1, 0,
            { tipo: 'salida_comida', timestamp: salidaComida },
            { tipo: 'regreso_comida', timestamp: regreso }
          );
        }
      }
    }

    let creo = 0;
    let cambio = false;
    for (const slot of slots) {
      if (!slot.timestamp) continue;
      const delTipo = existentes.filter((r) => r.tipoMarcacion === slot.tipo);
      const humanas = delTipo.filter((r) => activa(r) && r.metodo !== 'automatico');
      const corregidas = delTipo.filter((r) => activa(r) && r.metodo === 'automatico' && tocadaPorPersona(r));
      if (humanas.length || corregidas.length) {
        resumen.conservadas += 1;
        continue;
      }
      if (!reproceso && delTipo.length) {
        resumen.conservadas += 1;
        continue;
      }
      if (!reproceso && slot.timestamp > ahora) {
        resumen.pendientes += 1;
        continue;
      }

      const automaticas = delTipo.filter((r) => activa(r) && r.metodo === 'automatico' && !tocadaPorPersona(r));
      if (reproceso && automaticas.length) {
        await AttendanceRecord.updateMany(
          { _id: { $in: automaticas.map((r) => r._id) } },
          {
            $set: {
              estado: 'anulada',
              motivoAnulacion: 'Reproceso de marcación automática',
              anuladoPorUserId: actor.userId || 'sistema',
              anuladoEn: new Date()
            }
          }
        );
        cambio = true;
      }

      const doc = await AttendanceRecord.create({
        tenantId,
        empleadoId: empleado._id,
        turnoId: turno._id,
        subsidiariaId: empleado.subsidiariaId || subsidiaria._id,
        fecha,
        timestamp: slot.timestamp,
        timestampOriginal: slot.timestamp,
        servidorRegisteredAt: new Date(),
        zonaHoraria: zona,
        tipoMarcacion: slot.tipo,
        metodo: 'automatico',
        registradoPorUserId: actor.userId || 'sistema',
        notas: 'Marcación automática (rango de la subsidiaria)',
        procesado: false,
        origen: 'original',
        estado: 'activa',
        geocerca: {
          skipped: true,
          allowed: true,
          politica: 'disabled',
          fueraDeZona: false
        }
      });
      existentes.push(doc.toObject());
      creo += 1;
      resumen.creadas += 1;
      cambio = true;
    }

    if (creo) resumen.empleados += 1;
    if (cambio) {
      await recalculateDailyAttendance(tenantId, empleado._id, fecha);
      if (reproceso || creo) {
        await registrarAuditoriaAsistencia({
          tenantId,
          accion: reproceso ? 'MARCACION_AUTOMATICA_REPROCESO' : 'MARCACION_AUTOMATICA',
          empleadoId: empleado._id,
          fechaJornada: fecha,
          userId: actor.userId || 'sistema',
          userLabel: actor.userLabel || 'Sistema',
          mensaje: reproceso
            ? `Reproceso de marcación automática (${creo} checadas)`
            : `Marcación automática generada (${creo} checadas)`,
          detalle: { ymd, modo }
        });
      }
    }
  }

  return resumen;
}

function textoResumen(resumen, reproceso) {
  const partes = [
    `${reproceso ? 'Reproceso' : 'Generación'}: ${resumen.creadas} checada(s) en ${resumen.empleados} empleado(s)`
  ];
  if (resumen.descanso) partes.push(`${resumen.descanso} en descanso`);
  if (resumen.sinTurno) partes.push(`${resumen.sinTurno} sin turno`);
  if (resumen.conservadas) partes.push(`${resumen.conservadas} checadas se conservaron`);
  if (resumen.pendientes) partes.push(`${resumen.pendientes} aún no llegan a su hora`);
  return partes.join('. ') + '.';
}

let workerIniciado = false;
let workerCorriendo = false;

function iniciarWorkerMarcacionAutomatica() {
  if (workerIniciado) return;
  workerIniciado = true;
  const tick = async () => {
    if (workerCorriendo) return;
    workerCorriendo = true;
    try {
      const Subsidiaria = await getSubsidiariaModel();
      const Empresa = await getEmpresaModel();
      const subs = await Subsidiaria.find({ activo: { $ne: false } }).lean();
      for (const sub of subs) {
        const empresa = await Empresa.findById(sub.empresaId).select('tenantId').lean();
        if (!empresa?.tenantId) continue;
        const zona = sub.zonaHoraria || DEFAULT_TZ;
        const ymd = ymdInTimeZone(new Date(), zona);
        const resumen = await generarMarcacionesAutomaticas({
          tenantId: empresa.tenantId,
          subsidiaria: sub,
          ymd,
          modo: 'auto'
        });
        if (resumen.creadas) {
          console.log(
            `[marcacion-auto] ${sub.codigo || sub.nombre} ${ymd} creadas=${resumen.creadas}`
          );
        }
      }
    } catch (err) {
      console.error('[marcacion-auto]', err.message);
    } finally {
      workerCorriendo = false;
    }
  };
  setTimeout(tick, 20000).unref?.();
  setInterval(tick, 10 * 60 * 1000).unref?.();
}

module.exports = {
  RANGO_DEFAULT,
  rangoDe,
  generarMarcacionesAutomaticas,
  textoResumen,
  iniciarWorkerMarcacionAutomatica
};
