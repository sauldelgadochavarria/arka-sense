'use strict';

const getEmpleadoModel = require('../models/empleado');
const getAjusteAnualLoteModel = require('../models/ajusteAnualLote');
const getDepartamentoModel = require('../models/departamento');
const getPuestoModel = require('../models/puesto');
const { obtenerParametrosVigentes } = require('./nomina/tablasFiscalesService');
const { calcularSdiEmpleado } = require('./sdiCalculoService');
const { sbcTopado, resolverSdi } = require('../libs/sdiHelpers');
const { registrarCambioAutomatico } = require('./historialLaboralService');
const {
  ETAPAS_AUTORIZACION,
  MATRIZ_DESEMPENO_DEFAULT,
  DIAS_MES_REF,
  TASA_IMSS_PATRONAL_BASE,
  TASA_INFONAVIT_PATRONAL,
  TASA_ISN_DEFAULT
} = require('../config/ajusteAnualCatalog');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pct(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function clampDesempeno(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function parseCsvEvaluaciones(raw) {
  const text = String(raw || '').trim();
  if (!text) return new Map();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return new Map();
  const header = lines[0].split(/[,;|\t]/).map((h) => h.trim().toLowerCase().replace(/\s+/g, ''));
  const idx = (aliases) => header.findIndex((h) => aliases.includes(h));
  const iNum = idx(['numempleado', 'empleado', 'numero', 'no']);
  const iDes = idx(['desempeno', 'desempeño', 'performance', 'eval', 'evaluacion']);
  const iCompa = idx(['comparatio', 'compa', 'compa_ratio', 'ratio']);
  const iPct = idx(['porcentaje', 'pct', '%', 'incremento']);
  const iSd = idx(['salariodiaronuevo', 'salario_nuevo', 'sdnuevo', 'nuevosd']);
  if (iNum < 0) throw new Error('CSV: se requiere columna numEmpleado');
  const start = header.some((h) => h.includes('empleado') || h === 'numempleado') ? 1 : 0;
  const map = new Map();
  for (const line of lines.slice(start === 1 ? 1 : 0)) {
    const cols = line.split(/[,;|\t]/);
    const num = String(cols[iNum] || '').trim();
    if (!num || /^numempleado$/i.test(num)) continue;
    const porcentajeRaw = iPct >= 0 ? Number(String(cols[iPct] || '').replace(',', '.')) : NaN;
    const sdRaw = iSd >= 0 ? Number(String(cols[iSd] || '').replace(',', '.')) : NaN;
    map.set(num, {
      desempeno: iDes >= 0 ? clampDesempeno(cols[iDes]) : null,
      compaRatio: iCompa >= 0 ? Number(String(cols[iCompa] || '').replace(',', '.')) : null,
      porcentaje: Number.isFinite(porcentajeRaw) ? porcentajeRaw : null,
      salarioDiarioNuevo: Number.isFinite(sdRaw) && sdRaw > 0 ? sdRaw : null
    });
  }
  return map;
}

function buildAutorizaciones() {
  return ETAPAS_AUTORIZACION.map((e) => ({
    etapa: e.codigo,
    nombre: e.nombre,
    estatus: 'pendiente',
    userId: '',
    userLabel: '',
    fecha: null,
    comentario: ''
  }));
}

function matrizPct(regla, desempeno) {
  const m = regla.matriz || MATRIZ_DESEMPENO_DEFAULT;
  const d = clampDesempeno(desempeno) || 3;
  const v = Number(m[d] ?? m[String(d)] ?? MATRIZ_DESEMPENO_DEFAULT[d]);
  return Number.isFinite(v) ? v : MATRIZ_DESEMPENO_DEFAULT[d];
}

function pesoPresupuesto(sd, evalRow, regla) {
  const base = Math.max(sd, 0.01);
  if (!evalRow) return base;
  const des = clampDesempeno(evalRow.desempeno) || 3;
  const compa = Number(evalRow.compaRatio);
  const factorDes = matrizPct(regla, des) / 6;
  const factorCompa = Number.isFinite(compa) && compa > 0 ? Math.max(0.4, 2 - Math.min(compa, 1.8)) : 1;
  return base * Math.max(0.2, factorDes) * factorCompa;
}

function resolverPorcentaje({ modo, regla, evalRow, sd }) {
  if (evalRow?.porcentaje != null) return pct(evalRow.porcentaje);
  if (modo === 'matriz') return pct(matrizPct(regla, evalRow?.desempeno));
  if (modo === 'carga_empleado') return 0;
  if (modo === 'porcentaje') return pct(regla.porcentaje || 0);
  return 0;
}

function aplicarPisoYTope(sdNuevo, salarioMinimo) {
  const piso = money(salarioMinimo);
  let sd = money(sdNuevo);
  let pisoSm = false;
  if (piso > 0 && sd < piso) {
    sd = piso;
    pisoSm = true;
  }
  return { sd, pisoSm };
}

async function loadEmpleadosEnAlcance(tenantId, empresaId, filtros = {}) {
  const Empleado = await getEmpleadoModel();
  const q = { tenantId, empresaId, estatus: 'activo' };
  if (filtros.departamentoId) q.departamentoId = filtros.departamentoId;
  if (filtros.puestoId) q.puestoId = filtros.puestoId;
  if (filtros.tipoPeriodoId) q.tipoPeriodoId = filtros.tipoPeriodoId;
  if (filtros.centroCostoId) q.centroCostoId = filtros.centroCostoId;
  if (filtros.subsidiariaId) q.subsidiariaId = filtros.subsidiariaId;
  if (filtros.tipoEmpleado) q.tipoEmpleado = filtros.tipoEmpleado;
  return Empleado.find(q)
    .select(
      'numEmpleado firstName lastName departamentoId puestoId tipoEmpleado tipoSalario salarioDiario sdi nominaConfig fechaIngreso tablaPrestacionesId estatus subsidiariaId tipoContrato'
    )
    .sort({ numEmpleado: 1 })
    .lean();
}

async function lookupNombres(tenantId, empleados) {
  const Departamento = await getDepartamentoModel();
  const Puesto = await getPuestoModel();
  const deptoIds = [...new Set(empleados.map((e) => e.departamentoId).filter(Boolean))];
  const puestoIds = [...new Set(empleados.map((e) => e.puestoId).filter(Boolean))];
  const [deptos, puestos] = await Promise.all([
    deptoIds.length ? Departamento.find({ _id: { $in: deptoIds }, tenantId }).select('nombre').lean() : [],
    puestoIds.length ? Puesto.find({ _id: { $in: puestoIds }, tenantId }).select('nombre').lean() : []
  ]);
  return {
    depto: new Map(deptos.map((d) => [String(d._id), d.nombre])),
    puesto: new Map(puestos.map((p) => [String(p._id), p.nombre]))
  };
}

function estimarCargas({ deltaMasaMensual, deltaSbcMensual, primaRt, tasaIsn }) {
  const imss = money(deltaSbcMensual * (TASA_IMSS_PATRONAL_BASE + (Number(primaRt) || 0)));
  const infonavit = money(deltaSbcMensual * TASA_INFONAVIT_PATRONAL);
  const isn = money(deltaMasaMensual * (Number(tasaIsn) || TASA_ISN_DEFAULT));
  const cargas = money(imss + infonavit + isn);
  return {
    imssPatronalMensual: imss,
    infonavitPatronalMensual: infonavit,
    isnMensual: isn,
    cargasMensual: cargas,
    costoTotalMensual: money(deltaMasaMensual + cargas),
    costoTotalAnual: money((deltaMasaMensual + cargas) * 12)
  };
}

/**
 * Preview en memoria (no persiste).
 */
async function previewAjuste({ tenantId, empresaId, empresa, input }) {
  const fechaRef = input.fechaAplicacion || new Date();
  const params = await obtenerParametrosVigentes(fechaRef);
  const uma = params.uma;
  const salarioMinimo = params.salarioMinimo;
  const topeUma = params.topeUmaImss || 25;
  const topeSbc = money(uma * topeUma);

  const evalMap = parseCsvEvaluaciones(input.csvEvaluaciones);
  const empleados = await loadEmpleadosEnAlcance(tenantId, empresaId, input.filtros || {});
  if (!empleados.length) {
    throw new Error('No hay empleados activos con esos filtros');
  }
  const names = await lookupNombres(tenantId, empleados);
  const modo = input.modo || 'porcentaje';
  const regla = input.regla || {};
  const forzarPisoSm = input.regla?.forzarPisoSm !== false;
  const respetarTopeMasa = !!regla.respetarTopeMasa;

  const candidatos = [];
  for (const emp of empleados) {
    const num = String(emp.numEmpleado || '');
    const evalRow = evalMap.get(num) || null;
    const sdAntes = money(emp.salarioDiario || 0);
    const sdiAntes = money(resolverSdi(emp));
    const sbcAntes = money(sbcTopado(sdiAntes, uma, topeUma));
    const tipo = String(emp.tipoSalario || 'fijo').toLowerCase() || 'fijo';
    const alertas = [];
    let omitido = false;
    let omitidoMotivo = '';

    if (tipo === 'variable') {
      omitido = true;
      omitidoMotivo = 'Salario variable: el % no aplica sobre salario diario; revisa SDI capturado';
    }
    if (modo === 'carga_empleado' && !evalRow) {
      omitido = true;
      omitidoMotivo = omitidoMotivo || 'Sin renglón en CSV';
    }

    candidatos.push({
      emp,
      evalRow,
      sdAntes,
      sdiAntes,
      sbcAntes,
      tipo,
      omitido,
      omitidoMotivo,
      alertas,
      porcentaje: omitido ? 0 : resolverPorcentaje({ modo, regla, evalRow, sd: sdAntes })
    });
  }

  if (modo === 'presupuesto') {
    const presupuesto = money(regla.presupuestoMensual || 0);
    if (presupuesto <= 0) throw new Error('Indica el presupuesto mensual a distribuir');
    const vivos = candidatos.filter((c) => !c.omitido && c.sdAntes > 0);
    const pesoTotal = vivos.reduce((s, c) => s + pesoPresupuesto(c.sdAntes, c.evalRow, regla), 0);
    if (pesoTotal <= 0) throw new Error('No hay masa salarial para distribuir el presupuesto');
    for (const c of vivos) {
      const peso = pesoPresupuesto(c.sdAntes, c.evalRow, regla);
      const deltaMensual = (peso / pesoTotal) * presupuesto;
      const deltaDiario = deltaMensual / DIAS_MES_REF;
      c.porcentaje = c.sdAntes > 0 ? pct((deltaDiario / c.sdAntes) * 100) : 0;
    }
  }

  let items = [];
  for (const c of candidatos) {
    const emp = c.emp;
    let sdNuevo = c.sdAntes;
    if (!c.omitido) {
      if (c.evalRow?.salarioDiarioNuevo) {
        sdNuevo = money(c.evalRow.salarioDiarioNuevo);
        c.porcentaje = c.sdAntes > 0 ? pct(((sdNuevo - c.sdAntes) / c.sdAntes) * 100) : 0;
      } else {
        sdNuevo = money(c.sdAntes * (1 + c.porcentaje / 100));
      }
    }
    let pisoSm = false;
    if (!c.omitido && forzarPisoSm) {
      const r = aplicarPisoYTope(sdNuevo, salarioMinimo);
      if (r.pisoSm) {
        c.alertas.push(`Piso salario mínimo CONASAMI (${salarioMinimo})`);
        c.porcentaje = c.sdAntes > 0 ? pct(((r.sd - c.sdAntes) / c.sdAntes) * 100) : 0;
      }
      sdNuevo = r.sd;
      pisoSm = r.pisoSm;
    } else if (!c.omitido && salarioMinimo > 0 && sdNuevo < salarioMinimo) {
      c.alertas.push(`Queda bajo el salario mínimo (${salarioMinimo})`);
    }

    let sdiNuevo = c.sdiAntes;
    let sbcNuevo = c.sbcAntes;
    if (!c.omitido && c.tipo !== 'variable') {
      const cloned = { ...emp, salarioDiario: sdNuevo };
      try {
        const calc = await calcularSdiEmpleado({
          tenantId,
          empresaId,
          empleado: cloned,
          uma,
          topeUma,
          fechaRef
        });
        sdiNuevo = money(calc.sdi);
        sbcNuevo = money(calc.sbc);
      } catch {
        const factor = c.sdAntes > 0 ? c.sdiAntes / c.sdAntes : 1;
        sdiNuevo = money(sdNuevo * factor);
        sbcNuevo = money(sbcTopado(sdiNuevo, uma, topeUma));
      }
    }
    const topeSbcFlag = sdiNuevo > topeSbc + 0.005;
    if (topeSbcFlag) c.alertas.push(`SDI supera tope 25 UMA; SBC = ${topeSbc}`);

    items.push({
      empleadoId: emp._id,
      numEmpleado: emp.numEmpleado || '',
      nombre: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      departamentoNombre: names.depto.get(String(emp.departamentoId || '')) || '',
      puestoNombre: names.puesto.get(String(emp.puestoId || '')) || '',
      tipoEmpleado: emp.tipoEmpleado || '',
      tipoSalario: c.tipo,
      desempeno: c.evalRow?.desempeno ?? null,
      compaRatio: Number.isFinite(c.evalRow?.compaRatio) ? c.evalRow.compaRatio : null,
      porcentaje: c.porcentaje,
      salarioDiarioAntes: c.sdAntes,
      salarioDiarioDespues: c.omitido ? c.sdAntes : sdNuevo,
      sdiAntes: c.sdiAntes,
      sdiDespues: c.omitido ? c.sdiAntes : sdiNuevo,
      sbcAntes: c.sbcAntes,
      sbcDespues: c.omitido ? c.sbcAntes : sbcNuevo,
      pisoSm,
      topeSbc: topeSbcFlag,
      omitido: c.omitido,
      omitidoMotivo: c.omitidoMotivo,
      alertas: c.alertas
    });
  }

  const aplicables = items.filter((i) => !i.omitido);
  if (!aplicables.length) {
    throw new Error('Ningún empleado resulta aplicable (revisa filtros, CSV o salarios variables)');
  }
  let masaAntes = aplicables.reduce((s, i) => s + i.salarioDiarioAntes * DIAS_MES_REF, 0);
  let masaDespues = aplicables.reduce((s, i) => s + i.salarioDiarioDespues * DIAS_MES_REF, 0);
  let deltaMasa = money(masaDespues - masaAntes);
  const topePct = Number(regla.topePctMasa);
  if (respetarTopeMasa && topePct >= 0 && masaAntes > 0) {
    const maxDelta = money(masaAntes * (topePct / 100));
    if (deltaMasa > maxDelta && deltaMasa > 0) {
      const scale = maxDelta / deltaMasa;
      for (const i of aplicables) {
        const delta = i.salarioDiarioDespues - i.salarioDiarioAntes;
        i.salarioDiarioDespues = money(i.salarioDiarioAntes + delta * scale);
        i.porcentaje =
          i.salarioDiarioAntes > 0
            ? pct(((i.salarioDiarioDespues - i.salarioDiarioAntes) / i.salarioDiarioAntes) * 100)
            : 0;
        const factor = i.salarioDiarioAntes > 0 ? i.sdiAntes / i.salarioDiarioAntes : 1;
        i.sdiDespues = money(i.salarioDiarioDespues * factor);
        i.sbcDespues = money(sbcTopado(i.sdiDespues, uma, topeUma));
        i.alertas.push('Incremento recortado al tope de masa salarial');
      }
      masaDespues = aplicables.reduce((s, i) => s + i.salarioDiarioDespues * DIAS_MES_REF, 0);
      deltaMasa = money(masaDespues - masaAntes);
    }
  }

  const sbcAntes = aplicables.reduce((s, i) => s + i.sbcAntes * DIAS_MES_REF, 0);
  const sbcDespues = aplicables.reduce((s, i) => s + i.sbcDespues * DIAS_MES_REF, 0);
  const deltaSbc = money(sbcDespues - sbcAntes);
  const tasaIsn = Number(regla.tasaIsn);
  const cargas = estimarCargas({
    deltaMasaMensual: deltaMasa,
    deltaSbcMensual: deltaSbc,
    primaRt: empresa?.primaRiesgoTrabajo,
    tasaIsn: Number.isFinite(tasaIsn) ? tasaIsn : TASA_ISN_DEFAULT
  });
  const presupuesto = money(regla.presupuestoMensual || 0);
  const pctMasa = masaAntes > 0 ? pct((deltaMasa / masaAntes) * 100) : 0;

  return {
    parametrosFiscales: { uma, salarioMinimo, topeUmaImss: topeUma, topeSbc },
    items,
    totales: {
      empleados: items.length,
      aplicables: aplicables.length,
      omitidos: items.length - aplicables.length,
      bajoSm: items.filter((i) => i.pisoSm || i.alertas.some((a) => /mínimo/i.test(a))).length,
      topeSbc: items.filter((i) => i.topeSbc).length,
      masaAntes: money(masaAntes),
      masaDespues: money(masaDespues),
      deltaMasa,
      pctMasa,
      presupuestoMensual: presupuesto,
      desviacionPresupuesto: presupuesto > 0 ? money(deltaMasa - presupuesto) : null,
      sbcAntes: money(sbcAntes),
      sbcDespues: money(sbcDespues),
      deltaSbc,
      ...cargas
    }
  };
}

async function guardarLote({ tenantId, empresaId, empresa, input, userId, userLabel }) {
  const preview = await previewAjuste({ tenantId, empresaId, empresa, input });
  const Lote = await getAjusteAnualLoteModel();
  const doc = await Lote.create({
    tenantId,
    empresaId,
    nombre: input.nombre || `Ajuste ${new Date().toISOString().slice(0, 10)}`,
    proposito: input.proposito || 'inflacion',
    modo: input.modo || 'porcentaje',
    vigenciaDesde: input.vigenciaDesde || input.fechaAplicacion || null,
    vigenciaHasta: input.vigenciaHasta || null,
    fechaAplicacion: input.fechaAplicacion || new Date(),
    retroactivo: !!input.retroactivo,
    fechaRetroactiva: input.fechaRetroactiva || null,
    filtros: input.filtros || {},
    regla: input.regla || {},
    parametrosFiscales: preview.parametrosFiscales,
    totales: preview.totales,
    autorizaciones: buildAutorizaciones(),
    items: preview.items,
    estatus: 'en_autorizacion',
    creadoPorUserId: userId || '',
    creadoPorLabel: userLabel || '',
    notas: input.notas || ''
  });
  return doc.toObject();
}

function actorLabel(session) {
  return session?.user || session?.email || session?.username || '';
}

async function autorizarEtapa({ tenantId, loteId, etapa, userId, userLabel, comentario, adminTodas }) {
  const Lote = await getAjusteAnualLoteModel();
  const lote = await Lote.findOne({ _id: loteId, tenantId });
  if (!lote) throw new Error('Lote no encontrado');
  if (!['en_autorizacion', 'borrador'].includes(lote.estatus)) {
    throw new Error('El lote no está en autorización');
  }
  if (lote.estatus === 'borrador') lote.estatus = 'en_autorizacion';

  const etapas = lote.autorizaciones || [];
  if (adminTodas) {
    for (const a of etapas) {
      a.estatus = 'autorizado';
      a.userId = userId || '';
      a.userLabel = userLabel || '';
      a.fecha = new Date();
      a.comentario = comentario || 'Autorización completa (admin)';
    }
  } else {
    const idx = etapas.findIndex((a) => a.etapa === etapa);
    if (idx < 0) throw new Error('Etapa inválida');
    for (let i = 0; i < idx; i += 1) {
      if (etapas[i].estatus !== 'autorizado') {
        throw new Error(`Falta autorización de ${etapas[i].nombre}`);
      }
    }
    const actual = etapas[idx];
    if (actual.estatus === 'autorizado') throw new Error('Esta etapa ya está autorizada');
    actual.estatus = 'autorizado';
    actual.userId = userId || '';
    actual.userLabel = userLabel || '';
    actual.fecha = new Date();
    actual.comentario = comentario || '';
  }

  const todas = etapas.every((a) => a.estatus === 'autorizado');
  lote.estatus = todas ? 'autorizado' : 'en_autorizacion';
  lote.markModified('autorizaciones');
  await lote.save();
  return lote.toObject();
}

async function rechazarLote({ tenantId, loteId, userId, userLabel, comentario }) {
  const Lote = await getAjusteAnualLoteModel();
  const lote = await Lote.findOne({ _id: loteId, tenantId });
  if (!lote) throw new Error('Lote no encontrado');
  if (['aplicado', 'cancelado'].includes(lote.estatus)) {
    throw new Error('No se puede rechazar este lote');
  }
  const pendiente = (lote.autorizaciones || []).find((a) => a.estatus === 'pendiente');
  if (pendiente) {
    pendiente.estatus = 'rechazado';
    pendiente.userId = userId || '';
    pendiente.userLabel = userLabel || '';
    pendiente.fecha = new Date();
    pendiente.comentario = comentario || '';
  }
  lote.estatus = 'rechazado';
  lote.markModified('autorizaciones');
  await lote.save();
  return lote.toObject();
}

function scaleMonto(val, pctInc) {
  const n = Number(val) || 0;
  if (n <= 0) return n;
  return money(n * (1 + pctInc / 100));
}

async function aplicarLote({ tenantId, empresaId, loteId, userId, userLabel }) {
  const Lote = await getAjusteAnualLoteModel();
  const Empleado = await getEmpleadoModel();
  const lote = await Lote.findOne({ _id: loteId, tenantId, empresaId });
  if (!lote) throw new Error('Lote no encontrado');
  if (lote.estatus !== 'autorizado') {
    throw new Error('El lote debe estar autorizado por Líder, RRHH y Finanzas');
  }

  const fechaMov = lote.fechaAplicacion || new Date();
  const params = lote.parametrosFiscales || {};
  const escalaPrestaciones = lote.regla?.escalaPrestaciones === true;
  let aplicados = 0;
  let errores = 0;

  for (const item of lote.items) {
    if (item.omitido) continue;
    const emp = await Empleado.findOne({ _id: item.empleadoId, tenantId });
    if (!emp) {
      item.alertas = [...(item.alertas || []), 'Empleado no encontrado al aplicar'];
      errores += 1;
      continue;
    }
    const antes = emp.toObject();
    emp.salarioDiario = money(item.salarioDiarioDespues);

    try {
      const calc = await calcularSdiEmpleado({
        tenantId,
        empresaId,
        empleado: emp.toObject(),
        uma: params.uma,
        topeUma: params.topeUmaImss || 25,
        fechaRef: fechaMov
      });
      emp.sdi = money(calc.sdi);
      item.sdiDespues = emp.sdi;
      item.sbcDespues = money(calc.sbc);
    } catch {
      emp.sdi = money(item.sdiDespues);
    }

    if (escalaPrestaciones) {
      const cfg = emp.nominaConfig || {};
      const p = item.porcentaje || 0;
      if (cfg.despensaModalidad === 'fijo') {
        cfg.despensaMontoMensual = scaleMonto(cfg.despensaMontoMensual || cfg.despensaMonto, p);
        cfg.despensaMonto = cfg.despensaMontoMensual;
      }
      if (Number(cfg.sueldoIntegrado) > 0) {
        cfg.sueldoIntegrado = scaleMonto(cfg.sueldoIntegrado, p);
      }
      emp.nominaConfig = cfg;
      emp.markModified('nominaConfig');
    }

    await emp.save();
    await registrarCambioAutomatico(tenantId, empresaId, antes, emp.toObject(), {
      tipoMovimientoCodigo: 'REAJUSTE',
      fechaMovimiento: fechaMov,
      origen: 'sistema',
      registradoPor: userLabel || '',
      observaciones: `Ajuste anual (${lote.proposito}) lote ${lote._id}`,
      metadata: {
        loteAjusteAnualId: String(lote._id),
        porcentaje: item.porcentaje,
        retroactivo: !!lote.retroactivo
      }
    });
    aplicados += 1;
  }

  lote.estatus = 'aplicado';
  lote.aplicadoAt = new Date();
  lote.aplicadoPorUserId = userId || '';
  lote.aplicadoPorLabel = userLabel || '';
  lote.markModified('items');
  await lote.save();
  return { lote: lote.toObject(), aplicados, errores };
}

async function listLotes(tenantId, empresaId, limit = 20) {
  const Lote = await getAjusteAnualLoteModel();
  return Lote.find({ tenantId, empresaId })
    .select('-items')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

async function getLote(tenantId, empresaId, id) {
  const Lote = await getAjusteAnualLoteModel();
  return Lote.findOne({ _id: id, tenantId, empresaId }).lean();
}

function toAjusteCsv(lote) {
  const headers = [
    'numEmpleado',
    'nombre',
    'departamento',
    'puesto',
    'desempeno',
    'compaRatio',
    'porcentaje',
    'sdAntes',
    'sdDespues',
    'sdiAntes',
    'sdiDespues',
    'sbcAntes',
    'sbcDespues',
    'pisoSm',
    'topeSbc',
    'omitido',
    'alertas'
  ];
  const rows = (lote.items || []).map((i) =>
    [
      i.numEmpleado,
      i.nombre,
      i.departamentoNombre,
      i.puestoNombre,
      i.desempeno ?? '',
      i.compaRatio ?? '',
      i.porcentaje,
      i.salarioDiarioAntes,
      i.salarioDiarioDespues,
      i.sdiAntes,
      i.sdiDespues,
      i.sbcAntes,
      i.sbcDespues,
      i.pisoSm ? 'SI' : '',
      i.topeSbc ? 'SI' : '',
      i.omitido ? i.omitidoMotivo : '',
      (i.alertas || []).join('; ')
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

module.exports = {
  parseCsvEvaluaciones,
  previewAjuste,
  guardarLote,
  autorizarEtapa,
  rechazarLote,
  aplicarLote,
  listLotes,
  getLote,
  toAjusteCsv,
  actorLabel,
  money
};
