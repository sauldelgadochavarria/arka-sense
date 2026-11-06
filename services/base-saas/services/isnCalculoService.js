'use strict';

const { models } = require('../models/isn');
const getEmpleadoModel = require('../models/empleado');
const getSubsidiariaModel = require('../models/subsidiaria');
const getConceptoNominaModel = require('../models/conceptoNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getHistorialLaboralModel = require('../models/historialLaboral');
const { models: cumplimientoModels } = require('../models/cumplimientoPatronal');

function money(n) {
  const x = Number(n) || 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function dayStart(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

function daysInclusive(a, b) {
  const ms = dayStart(b) - dayStart(a);
  return Math.max(1, Math.floor(ms / 86400000) + 1);
}

function labelEntidad(clave, catalogo) {
  const row = (catalogo || []).find((e) => e.value === clave);
  return row ? row.label : clave || 'Sin entidad';
}

/**
 * El domicilio del trabajador y el domicilio fiscal no atribuyen el ISN,
 * salvo que la configuración del estado lo pida de forma explícita.
 */
function resolverEntidad({ empleado, subsidiaria, regla }) {
  const lugar = String(empleado?.estadoTrabajo || subsidiaria?.entidadFederativa || '').toUpperCase();
  const domicilio = String(empleado?.domicilio?.entidad || '').toUpperCase();
  if (regla === 'domicilio_trabajador_si_fuera' && domicilio && lugar && domicilio !== lugar) {
    return {
      entidad: domicilio,
      regla: 'domicilio_trabajador_si_fuera',
      nota: 'La regla estatal atribuye la remuneración al domicilio del trabajador. Debe validarla el área fiscal.'
    };
  }
  if (lugar) return { entidad: lugar, regla: 'lugar_servicio', nota: '' };
  return {
    entidad: '',
    regla: 'sin_entidad',
    nota: 'Falta la entidad. En el empleado, pestaña Organización, o en la sucursal: Entidad del ISN.'
  };
}

function configVigente(configs, entidad, fecha) {
  const t = dayStart(fecha).getTime();
  const rows = (configs || [])
    .filter((c) => c.activo !== false && String(c.entidad) === entidad)
    .filter((c) => {
      const ini = c.fechaInicio ? dayStart(c.fechaInicio).getTime() : 0;
      const fin = c.fechaFin ? dayStart(c.fechaFin).getTime() : Infinity;
      return ini <= t && t <= fin;
    })
    .sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio));
  return rows[0] || null;
}

function porcentajeDeRegla(regla) {
  if (regla && regla.porcentajeGravado != null && Number.isFinite(Number(regla.porcentajeGravado))) {
    return Math.min(100, Math.max(0, Number(regla.porcentajeGravado)));
  }
  if (regla?.tratamiento === 'exento') return 0;
  if (regla) return 100;
  return null;
}

function tratamientoConcepto(codigo, tipo, fiscal, config) {
  const regla = (config?.reglasConcepto || []).find((r) => String(r.codigo).toUpperCase() === codigo);
  const pct = porcentajeDeRegla(regla);
  if (pct != null) {
    if (pct <= 0) return 'exento';
    if (pct >= 100) return 'gravado';
    return 'especial';
  }
  if (tipo === 'deduccion') return 'excluido';
  if (fiscal && fiscal.integraISN === false) return 'exento';
  if (fiscal && fiscal.integraISN === true) return 'gravado';
  if (tipo === 'otro_pago') return 'exento';
  return 'gravado';
}

function porcentajeConcepto(codigo, tipo, fiscal, config) {
  const regla = (config?.reglasConcepto || []).find((r) => String(r.codigo).toUpperCase() === codigo);
  const pct = porcentajeDeRegla(regla);
  if (pct != null) return pct;
  const trat = tratamientoConcepto(codigo, tipo, fiscal, null);
  if (trat === 'excluido') return null;
  if (trat === 'exento') return 0;
  return 100;
}

function asignacionesDelDia(lista, fecha) {
  const t = dayStart(fecha).getTime();
  return (lista || []).filter((a) => {
    const ini = a.fechaInicio ? dayStart(a.fechaInicio).getTime() : 0;
    const fin = a.fechaFin ? dayStart(a.fechaFin).getTime() : Infinity;
    return ini <= t && t <= fin && Number(a.porcentajeAsignacion) > 0 && String(a.entidad || '').trim();
  });
}

/** Si las asignaciones del día 15 suman 100%, el ISN usa esa entidad. Si no hay, sigue el empleado. */
function aplicarAsignaciones(partes, asignaciones, fechaRef, advertencias, etiqueta) {
  const vivas = asignacionesDelDia(asignaciones, fechaRef);
  if (!vivas.length) return partes;
  const suma = vivas.reduce((s, a) => s + Number(a.porcentajeAsignacion), 0);
  if (Math.abs(suma - 100) > 0.2) {
    advertencias.push(
      `${etiqueta}: la asignación por entidad suma ${suma}%. El ISN sigue la entidad del empleado.`
    );
    return partes;
  }
  if (vivas.length === 1) {
    const ent = String(vivas[0].entidad).toUpperCase();
    return partes.map((p) => ({ ...p, empleado: { ...p.empleado, estadoTrabajo: ent } }));
  }
  const out = [];
  for (const p of partes) {
    for (const a of vivas) {
      out.push({
        ...p,
        peso: p.peso * (Number(a.porcentajeAsignacion) / 100),
        empleado: {
          ...p.empleado,
          estadoTrabajo: String(a.entidad).toUpperCase(),
          registroPatronalId: a.registroPatronalId || p.empleado.registroPatronalId
        }
      });
    }
  }
  return out;
}

function segmentosRecibo(recibo, historial, empleado, subsById, configs) {
  const ini = recibo.periodo?.fechaInicio ? new Date(recibo.periodo.fechaInicio) : null;
  const fin = recibo.periodo?.fechaFin ? new Date(recibo.periodo.fechaFin) : null;
  if (!ini || !fin) {
    return [{ peso: 1, empleado, subsidiariaId: recibo.subsidiariaId }];
  }
  const cambios = (historial || [])
    .filter((h) => {
      const f = new Date(h.fechaMovimiento);
      return f > ini && f <= fin;
    })
    .sort((a, b) => new Date(a.fechaMovimiento) - new Date(b.fechaMovimiento));
  if (!cambios.length) {
    return [{ peso: 1, empleado, subsidiariaId: recibo.subsidiariaId || empleado.subsidiariaId }];
  }

  const cortes = [ini, ...cambios.map((h) => new Date(h.fechaMovimiento)), fin];
  const total = daysInclusive(ini, fin);
  const partes = [];
  let cursorEmp = {
    ...empleado,
    estadoTrabajo: empleado.estadoTrabajo,
    subsidiariaId: recibo.subsidiariaId || empleado.subsidiariaId
  };
  const previos = (historial || [])
    .filter((h) => new Date(h.fechaMovimiento) <= ini)
    .sort((a, b) => new Date(b.fechaMovimiento) - new Date(a.fechaMovimiento));
  if (previos[0]) {
    cursorEmp = aplicarMovimiento(cursorEmp, previos[0]);
  }
  for (let i = 0; i < cortes.length - 1; i += 1) {
    const desde = cortes[i];
    const hasta = i === cortes.length - 2 ? cortes[i + 1] : new Date(dayStart(cortes[i + 1]).getTime() - 86400000);
    const dias = Math.max(0, daysInclusive(desde, hasta > desde ? hasta : desde));
    partes.push({
      peso: dias / total,
      empleado: { ...cursorEmp },
      subsidiariaId: cursorEmp.subsidiariaId
    });
    const mov = cambios.find((h) => dayStart(h.fechaMovimiento).getTime() === dayStart(cortes[i + 1]).getTime());
    if (mov) cursorEmp = aplicarMovimiento(cursorEmp, mov);
  }
  const distintos = new Set(
    partes.map((p) => resolverEntidad({
      empleado: p.empleado,
      subsidiaria: subsById.get(String(p.subsidiariaId || '')),
      regla: 'lugar_servicio'
    }).entidad)
  );
  if (distintos.size < 2) {
    return [{ peso: 1, empleado, subsidiariaId: recibo.subsidiariaId || empleado.subsidiariaId }];
  }
  const suma = partes.reduce((s, p) => s + p.peso, 0) || 1;
  return partes.map((p) => ({ ...p, peso: p.peso / suma }));
}

function aplicarMovimiento(emp, mov) {
  return {
    ...emp,
    estadoTrabajo: mov.estadoTrabajo || emp.estadoTrabajo || '',
    subsidiariaId: mov.subsidiariaId || emp.subsidiariaId,
    modalidadTrabajo: mov.modalidadTrabajo || emp.modalidadTrabajo || '',
    registroPatronalId: mov.registroPatronalId || emp.registroPatronalId || null,
    registroPatronal: emp.registroPatronal
  };
}

async function calcularIsnMes({
  tenantId,
  empresaId,
  anio,
  mes,
  fuente = 'historico',
  userLabel = ''
}) {
  const { ConfigIsn, RegistroIsn, RegistroPatronal, DeterminacionIsn } = await models();
  const Empleado = await getEmpleadoModel();
  const Subsidiaria = await getSubsidiariaModel();
  const Concepto = await getConceptoNominaModel();
  const Historico = await getNominaHistoricoReciboModel();
  const Historial = await getHistorialLaboralModel();

  const fechaRef = new Date(Date.UTC(anio, mes - 1, 15));
  const [configs, registros, patronales, conceptos, subsidiarias] = await Promise.all([
    ConfigIsn.find({ tenantId, empresaId, activo: true }).lean(),
    RegistroIsn.find({ tenantId, empresaId, activo: true }).lean(),
    RegistroPatronal.find({ tenantId, empresaId, activo: true }).lean(),
    Concepto.find({ tenantId, empresaId }).select('codigo tipo fiscal').lean(),
    Subsidiaria.find({ empresaId }).select('nombre entidadFederativa').lean()
  ]);
  const conceptoMap = new Map(conceptos.map((c) => [String(c.codigo).toUpperCase(), c]));
  const subsById = new Map(subsidiarias.map((s) => [String(s._id), s]));
  const rpById = new Map(patronales.map((r) => [String(r._id), r]));
  const cuentaPorEntidad = new Map(registros.map((r) => [r.entidad, r.cuentaEstatal || '']));

  const q = { tenantId, empresaId, anio: Number(anio), mes: Number(mes) };
  if (fuente === 'timbrado') q['timbrado.estatus'] = 'timbrado';
  const recibos = await Historico.find(q).lean();
  const empIds = [...new Set(recibos.map((r) => String(r.empleadoId)))];
  const empleados = await Empleado.find({ tenantId, _id: { $in: empIds } }).lean();
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const finMes = new Date(Date.UTC(anio, mes, 0, 23, 59, 59));
  const historiales = empIds.length
    ? await Historial.find({
        tenantId,
        empresaId,
        empleadoId: { $in: empIds },
        fechaMovimiento: { $lte: finMes }
      }).lean()
    : [];
  const histPorEmp = new Map();
  for (const h of historiales) {
    const k = String(h.empleadoId);
    if (!histPorEmp.has(k)) histPorEmp.set(k, []);
    histPorEmp.get(k).push(h);
  }
  const { TrabajadorAsignacion } = await cumplimientoModels();
  const asignaciones = empIds.length
    ? await TrabajadorAsignacion.find({ tenantId, empresaId, empleadoId: { $in: empIds } }).lean()
    : [];
  const asigPorEmp = new Map();
  for (const a of asignaciones) {
    const k = String(a.empleadoId);
    if (!asigPorEmp.has(k)) asigPorEmp.set(k, []);
    asigPorEmp.get(k).push(a);
  }

  const acumulado = new Map();
  const advertencias = [];
  if (!recibos.length) {
    advertencias.push(
      fuente === 'timbrado'
        ? 'No hay recibos timbrados en ese mes.'
        : 'No hay recibos cerrados en ese mes.'
    );
  }

  for (const rec of recibos) {
    const emp = empMap.get(String(rec.empleadoId));
    if (!emp) continue;
    let partes = segmentosRecibo(rec, histPorEmp.get(String(emp._id)) || [], emp, subsById, configs);
    partes = aplicarAsignaciones(
      partes,
      asigPorEmp.get(String(emp._id)) || [],
      fechaRef,
      advertencias,
      emp.numEmpleado || ''
    );
    const conceptosRec = (rec.conceptos || []).filter((c) => Number(c.importe) !== 0);
    partes.forEach((parte, idx) => {
      const sub = subsById.get(String(parte.subsidiariaId || '')) || null;
      const provisional = resolverEntidad({ empleado: parte.empleado, subsidiaria: sub, regla: 'lugar_servicio' });
      const cfg = configVigente(configs, provisional.entidad, fechaRef);
      const atrib = resolverEntidad({
        empleado: parte.empleado,
        subsidiaria: sub,
        regla: cfg?.reglaAtribucion || 'lugar_servicio'
      });
      const cfgFinal = configVigente(configs, atrib.entidad, fechaRef) || cfg;
      const key = `${emp._id}|${atrib.entidad}`;
      if (!acumulado.has(key)) {
        const rp = rpById.get(String(parte.empleado.registroPatronalId || emp.registroPatronalId || ''));
        acumulado.set(key, {
          empleadoId: emp._id,
          numEmpleado: emp.numEmpleado || rec.empleado?.numEmpleado || '',
          nombre: rec.empleado?.nombre || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
          subsidiariaId: parte.subsidiariaId || null,
          establecimiento: sub?.nombre || '',
          registroPatronal: emp.registroPatronal || rp?.numero || '',
          entidad: atrib.entidad,
          regla: atrib.regla,
          nota: atrib.nota,
          baseGravable: 0,
          baseExenta: 0,
          conceptos: []
        });
      }
      const row = acumulado.get(key);
      if (atrib.nota && !row.nota) row.nota = atrib.nota;
      const peso = idx === partes.length - 1 ? parte.peso : parte.peso;
      for (const c of conceptosRec) {
        const codigo = String(c.conceptoCodigo || '').toUpperCase();
        const cat = conceptoMap.get(codigo);
        const pct = porcentajeConcepto(codigo, c.tipo || cat?.tipo || '', cat?.fiscal, cfgFinal);
        if (pct == null) continue;
        const importe = money(Number(c.importe) * peso);
        const gravable = money(importe * (pct / 100));
        const exento = money(importe - gravable);
        const sumar = (tratamiento, monto) => {
          if (!monto) return;
          const prev = row.conceptos.find((x) => x.codigo === codigo && x.tratamiento === tratamiento);
          if (prev) prev.importe = money(prev.importe + monto);
          else row.conceptos.push({ codigo, importe: monto, tratamiento });
        };
        row.baseGravable = money(row.baseGravable + gravable);
        row.baseExenta = money(row.baseExenta + exento);
        sumar(pct > 0 && pct < 100 ? 'especial' : 'gravado', gravable);
        sumar('exento', exento);
      }
    });
  }

  const detalle = [...acumulado.values()].map((row) => {
    const cfg = configVigente(configs, row.entidad, fechaRef);
    const tasa = cfg ? Number(cfg.tasa) : null;
    const impuesto = tasa == null ? 0 : money(row.baseGravable * (tasa / 100));
    if (!row.entidad) {
      advertencias.push(`${row.numEmpleado} ${row.nombre}: sin entidad de ISN. ${row.nota}`);
    } else if (tasa == null) {
      advertencias.push(`${labelEntidad(row.entidad)} no tiene tasa vigente para este mes.`);
    }
    return { ...row, impuesto, tasa };
  });

  const porEntidadMap = new Map();
  for (const row of detalle) {
    const k = row.entidad || '—';
    if (!porEntidadMap.has(k)) {
      const cfg = configVigente(configs, row.entidad, fechaRef);
      porEntidadMap.set(k, {
        entidad: row.entidad,
        trabajadores: 0,
        ids: new Set(),
        baseGravable: 0,
        baseExenta: 0,
        tasa: cfg ? Number(cfg.tasa) : null,
        impuesto: 0,
        cuentaEstatal: cuentaPorEntidad.get(row.entidad) || '',
        sinTasa: !cfg
      });
    }
    const g = porEntidadMap.get(k);
    g.ids.add(String(row.empleadoId));
    g.baseGravable = money(g.baseGravable + row.baseGravable);
    g.baseExenta = money(g.baseExenta + row.baseExenta);
    g.impuesto = money(g.impuesto + row.impuesto);
  }
  const porEntidad = [...porEntidadMap.values()]
    .map((g) => ({
      entidad: g.entidad,
      trabajadores: g.ids.size,
      baseGravable: g.baseGravable,
      baseExenta: g.baseExenta,
      tasa: g.tasa,
      impuesto: g.impuesto,
      cuentaEstatal: g.cuentaEstatal,
      sinTasa: g.sinTasa
    }))
    .sort((a, b) => String(a.entidad).localeCompare(String(b.entidad)));

  const uniqWarn = [...new Set(advertencias)];
  const vigente = await DeterminacionIsn.findOne({
    tenantId,
    empresaId,
    anio: Number(anio),
    mes: Number(mes),
    estatus: { $in: ['borrador', 'cerrado'] }
  }).sort({ version: -1 });

  const payload = {
    fuente: fuente === 'timbrado' ? 'timbrado' : 'historico',
    porEntidad,
    detalle: detalle.sort((a, b) => String(a.entidad).localeCompare(String(b.entidad)) || String(a.numEmpleado).localeCompare(String(b.numEmpleado))),
    totalBaseGravable: money(porEntidad.reduce((s, e) => s + e.baseGravable, 0)),
    totalImpuesto: money(porEntidad.reduce((s, e) => s + e.impuesto, 0)),
    advertencias: uniqWarn,
    calculadoPor: userLabel
  };

  if (vigente && vigente.estatus === 'cerrado') {
    const err = new Error('El mes está cerrado. Autoriza el recálculo para generar otra versión.');
    err.code = 'CERRADO';
    err.determinacionId = vigente._id;
    throw err;
  }
  if (vigente) {
    Object.assign(vigente, payload);
    await vigente.save();
    return vigente.toObject();
  }
  const last = await DeterminacionIsn.findOne({ tenantId, empresaId, anio: Number(anio), mes: Number(mes) })
    .sort({ version: -1 })
    .select('version')
    .lean();
  const doc = await DeterminacionIsn.create({
    tenantId,
    empresaId,
    anio: Number(anio),
    mes: Number(mes),
    version: (last?.version || 0) + 1,
    estatus: 'borrador',
    ...payload
  });
  return doc.toObject();
}

module.exports = {
  calcularIsnMes,
  resolverEntidad,
  tratamientoConcepto,
  labelEntidad,
  money
};
