'use strict';

/**
 * Exportación SUA — Guía Rápida oficial (3 archivos de importación, ancho fijo).
 *
 * ASEG.TXT (164)  Alta / directorio de trabajadores
 * MOVT.TXT (49)   Baja(02), Mod. salario(07), Reingreso(08), Ausentismo(11), Incapacidad(12)
 * CRED.TXT (52)   Movimientos de crédito INFONAVIT (15–20)
 *
 * Reglas: MAYÚSCULAS; Ñ→/; numéricos con ceros a la izquierda; nombre AP$AM$NOMBRES;
 * SDI 5+2 sin punto; CRLF; descarga ANSI/latin1.
 *
 * Importante: el ALTA va en ASEG.TXT, no en MOVT (08 = solo reingreso).
 */

const getEmpleadoModel = require('../models/empleado');
const getEmpresaModel = require('../models/empresa');
const getHistorialLaboralModel = require('../models/historialLaboral');
const { startOfDay, endOfDay } = require('../libs/timeHelpers');

/** Historial → MOVT (sin ALTA: esa va a ASEG). */
const MAPA_MOV_SUA = {
  BAJA: '02',
  REAJUSTE: '07',
  REINGRESO: '08'
};

const TIPOS_MOV_SUA_LABEL = {
  '02': 'Baja',
  '07': 'Modificación de salario',
  '08': 'Reingreso',
  '11': 'Ausentismo',
  '12': 'Incapacidad'
};

const TIPOS_CRED_SUA_LABEL = {
  '15': 'Inicio de crédito de vivienda',
  '16': 'Suspensión de descuento',
  '17': 'Reinicio de descuento',
  '18': 'Modificación de tipo de descuento',
  '19': 'Modificación de valor de descuento',
  '20': 'Modificación de número de crédito'
};

function padRight(str, len) {
  const s = String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Ñ/g, '/')
    .replace(/ñ/g, '/')
    .toUpperCase();
  return s.slice(0, len).padEnd(len, ' ');
}

function padLeftNum(str, len) {
  const digits = String(str || '').replace(/\D/g, '');
  return digits.slice(-len).padStart(len, '0');
}

function formatDateDdmmyyyy(date) {
  if (!date) return '00000000';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '00000000';

  const utcDateOnly =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (utcDateOnly) {
    return (
      String(d.getUTCDate()).padStart(2, '0') +
      String(d.getUTCMonth() + 1).padStart(2, '0') +
      String(d.getUTCFullYear())
    );
  }

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(d);
  const dd = parts.find((p) => p.type === 'day')?.value || '00';
  const mm = parts.find((p) => p.type === 'month')?.value || '00';
  const yyyy = parts.find((p) => p.type === 'year')?.value || '0000';
  return `${dd}${mm}${yyyy}`;
}

/** Fecha inicio descuento INFONAVIT: si &lt; 01/07/1997 → 30061997. */
function formatFechaInicioDescuento(date) {
  if (!date) return '00000000';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '00000000';
  const cutoff = Date.UTC(1997, 6, 1); // 01/07/1997
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (t < cutoff) return '30061997';
  return formatDateDdmmyyyy(d);
}

/** SDI: 5 enteros + 2 decimales sin punto (150.45 → 0015045). */
function formatSdi7(monto) {
  const n = Math.round((Number(monto) || 0) * 100);
  return String(Math.min(Math.max(n, 0), 9999999)).padStart(7, '0');
}

/**
 * Valor descuento CRED/ASEG (8 chars, sin punto):
 * TD=1 porcentaje → 00EEDD00
 * TD=2 cuota fija → EEEEEDD0
 * TD=3 VSM/factor → 0EEEDDDD
 */
function formatValorDescuento8(tipoDesc, valor) {
  const v = Number(valor) || 0;
  const td = String(tipoDesc || '0');
  if (td === '1') {
    // 2 enteros + 2 dec → embebido como 00EEDD00
    const cents = Math.round(v * 100);
    const body = String(Math.min(Math.max(cents, 0), 9999)).padStart(4, '0');
    return `00${body}00`;
  }
  if (td === '2') {
    // 5 enteros + 2 dec → EEEEEDD0
    const cents = Math.round(v * 100);
    const body = String(Math.min(Math.max(cents, 0), 9999999)).padStart(7, '0');
    return `${body}0`;
  }
  if (td === '3') {
    // 3 enteros + 4 dec → 0EEEDDDD
    const scaled = Math.round(v * 10000);
    const body = String(Math.min(Math.max(scaled, 0), 9999999)).padStart(7, '0');
    return `0${body}`.slice(-8);
  }
  return '00000000';
}

function resolveRp(empleado, empresaRp) {
  const rp = String(empleado.registroPatronal || empresaRp || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  return padRight(rp, 11);
}

function resolveNss(empleado) {
  return padLeftNum(empleado.nss, 11);
}

function resolveSdi(empleado) {
  const sdi = Number(empleado.sdi) || 0;
  const sd = Number(empleado.salarioDiario) || 0;
  const integrado = Number(empleado.nominaConfig?.sueldoIntegrado) || 0;
  return sdi > 0 ? sdi : integrado > 0 ? integrado : sd;
}

function resolveNombreSua(empleado) {
  let paterno = String(empleado.apellidoPaterno || '').trim();
  let materno = String(empleado.apellidoMaterno || '').trim();
  let nombres = String(empleado.firstName || '').trim();

  if (!paterno && !materno && empleado.lastName) {
    const parts = String(empleado.lastName).trim().split(/\s+/);
    paterno = parts[0] || '';
    materno = parts.slice(1).join(' ');
  }

  if (!paterno && materno) {
    return padRight(`${materno}$$${nombres}`, 50);
  }
  return padRight(`${paterno}$${materno}$${nombres}`, 50);
}

function tipoTrabajadorCodigo(empleado) {
  const t = String(empleado.tipoEmpleado || empleado.tipoContrato || '').toLowerCase();
  if (t.includes('event')) return '2';
  if (t.includes('obra') || t.includes('constr')) return '3';
  return '1';
}

function jornadaCodigo() {
  return '0';
}

function resolveInfonavitSua(empleado) {
  const cfg = empleado.nominaConfig || {};
  const numCredito = String(cfg.infonavitNumeroCredito || '').replace(/\s+/g, '');
  if (!numCredito && !cfg.tipoCreditoInfonavit) {
    return {
      tieneCredito: false,
      credito: padRight('', 10),
      fechaInicio: '00000000',
      tipoDesc: '0',
      valor: '00000000'
    };
  }

  let tipoDesc = '0';
  let valorNum = 0;
  if (cfg.tipoCreditoInfonavit === 'porcentaje') {
    tipoDesc = '1';
    valorNum = Number(cfg.tasaInfonavit) || 0;
  } else if (cfg.tipoCreditoInfonavit === 'cuota_fija') {
    tipoDesc = '2';
    valorNum = Number(cfg.tasaInfonavit) || Number(cfg.infonavitDescuento) || 0;
  } else if (cfg.tipoCreditoInfonavit === 'vsm') {
    tipoDesc = '3';
    valorNum = Number(cfg.tasaInfonavit) || 0;
  }

  return {
    tieneCredito: !!numCredito,
    credito: padRight(numCredito, 10),
    fechaInicio: formatFechaInicioDescuento(cfg.infonavitFechaInicio || null),
    tipoDesc: numCredito ? tipoDesc || '1' : '0',
    valor: numCredito ? formatValorDescuento8(tipoDesc || '1', valorNum) : '00000000'
  };
}

/** ASEG.TXT — 164 caracteres. */
function buildAsegLine(empleado, empresaRp) {
  const inf = resolveInfonavitSua(empleado);
  const line =
    resolveRp(empleado, empresaRp) +
    resolveNss(empleado) +
    padRight(empleado.rfc, 13) +
    padRight(empleado.curp, 18) +
    resolveNombreSua(empleado) +
    tipoTrabajadorCodigo(empleado) +
    jornadaCodigo() +
    formatDateDdmmyyyy(empleado.fechaIngreso) +
    formatSdi7(resolveSdi(empleado)) +
    padRight(empleado.umf || '', 17) +
    inf.credito +
    (inf.tieneCredito ? inf.fechaInicio : '00000000') +
    (inf.tieneCredito ? inf.tipoDesc : '0') +
    (inf.tieneCredito ? inf.valor : '00000000');

  return line.slice(0, 164).padEnd(164, ' ');
}

/**
 * MOVT.TXT — 49 caracteres.
 * 02 Baja | 07 Mod. salario | 08 Reingreso | 11 Ausentismo | 12 Incapacidad
 */
function buildMovtLine({ empleado, empresaRp, tipoSua, fecha, sdi, dias = 0, folioIncap = '' }) {
  const needsSdi = tipoSua === '07' || tipoSua === '08';
  const needsDias = tipoSua === '11' || tipoSua === '12';
  const needsFolio = tipoSua === '12';

  const line =
    resolveRp(empleado, empresaRp) +
    resolveNss(empleado) +
    padLeftNum(tipoSua, 2) +
    formatDateDdmmyyyy(fecha) +
    (needsFolio ? padRight(folioIncap, 8) : padRight('', 8)) +
    (needsDias ? padLeftNum(dias, 2) : '00') +
    (needsSdi ? formatSdi7(sdi != null ? sdi : resolveSdi(empleado)) : '0000000');

  return line.slice(0, 49).padEnd(49, ' ');
}

/**
 * CRED.TXT — 52 caracteres (layout Visma / manual crédito).
 * 15 inicio | 16 suspensión | 17 reinicio | 18 mod. tipo | 19 mod. valor | 20 mod. número
 */
function buildCredLine({
  empleado,
  empresaRp,
  tipoMov = '15',
  fecha = null,
  numeroCredito = '',
  tipoDesc = '1',
  valor = 0,
  aplicaReduccion = '0'
}) {
  const cfg = empleado.nominaConfig || {};
  const credito = padRight(numeroCredito || cfg.infonavitNumeroCredito || '', 10);
  const fechaMov = formatDateDdmmyyyy(fecha || cfg.infonavitFechaInicio || new Date());
  const td = String(tipoDesc || '1');
  const line =
    resolveRp(empleado, empresaRp) +
    resolveNss(empleado) +
    credito +
    padLeftNum(tipoMov, 2) +
    fechaMov +
    td.slice(0, 1) +
    formatValorDescuento8(td, valor) +
    String(aplicaReduccion || '0').slice(0, 1);

  return line.slice(0, 52).padEnd(52, ' ');
}

function joinLines(lines) {
  return lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

function validateEmpleadoParaSua(empleado, empresaRp, { exigirCurpRfc = true } = {}) {
  const issues = [];
  const rp = String(empleado.registroPatronal || empresaRp || '').replace(/\s+/g, '');
  if (!rp) {
    issues.push(
      'Sin registro patronal (captúralo en el empleado o en Datos de empresa → IMSS)'
    );
  } else if (rp.length < 10) {
    issues.push('Registro patronal incompleto');
  }
  const nss = String(empleado.nss || '').replace(/\D/g, '');
  if (nss.length !== 11) issues.push('NSS debe tener 11 dígitos');
  if (exigirCurpRfc) {
    if (!empleado.curp || String(empleado.curp).length !== 18) issues.push('CURP incompleta');
    if (!empleado.rfc || String(empleado.rfc).length < 12) issues.push('RFC incompleto');
  }
  if (!empleado.fechaIngreso) issues.push('Sin fecha de ingreso');
  if (!(resolveSdi(empleado) > 0)) issues.push('Sin SDI / salario diario');
  const entidad = String(empleado.domicilio?.entidad || '').trim();
  if (!entidad) {
    issues.push('Sin entidad federativa (domicilio) — requerida para ISN estatal');
  }
  return issues;
}

async function loadEmpresaRp(tenantId, overrideRp = '') {
  if (overrideRp) return String(overrideRp).toUpperCase().replace(/\s+/g, '');
  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId }).lean();
  return String(empresa?.registroPatronal || '')
    .toUpperCase()
    .replace(/\s+/g, '');
}

/** ASEG.TXT — directorio / altas masivas. */
async function generarDirectorioSua(tenantId, options = {}) {
  const { estatus = 'activo', registroPatronal = '', soloConNss = true } = options;

  const empresaRp = await loadEmpresaRp(tenantId, registroPatronal);
  const Empleado = await getEmpleadoModel();
  const q = { tenantId };
  if (estatus === 'activo') q.estatus = 'activo';
  else if (estatus === 'baja') q.estatus = 'baja';

  let empleados = await Empleado.find(q).sort({ lastName: 1, firstName: 1 }).lean();
  if (soloConNss) {
    empleados = empleados.filter((e) => String(e.nss || '').replace(/\D/g, '').length === 11);
  }

  const preview = [];
  const asegLines = [];
  const omitidos = [];

  for (const emp of empleados) {
    const issues = validateEmpleadoParaSua(emp, empresaRp);
    const bloquear = issues.some((i) => i.startsWith('NSS') || i.startsWith('Sin registro'));
    if (bloquear) {
      omitidos.push({
        numEmpleado: emp.numEmpleado,
        nombre: `${emp.firstName} ${emp.lastName}`,
        issues
      });
      continue;
    }
    asegLines.push(buildAsegLine(emp, empresaRp));
    preview.push({
      numEmpleado: emp.numEmpleado,
      nss: emp.nss,
      nombre: resolveNombreSua(emp).trim(),
      sdi: resolveSdi(emp),
      fechaIngreso: emp.fechaIngreso,
      issues
    });
  }

  return {
    tipo: 'directorio',
    empresaRp,
    total: asegLines.length,
    omitidos,
    preview,
    archivos: { 'ASEG.TXT': joinLines(asegLines) }
  };
}

/**
 * Altas del período (historial ALTA) → ASEG.TXT
 * (el alta oficial no va en MOVT).
 */
async function generarAltasPeriodoSua(tenantId, options = {}) {
  const { fechaInicio, fechaFin, registroPatronal = '' } = options;
  const empresaRp = await loadEmpresaRp(tenantId, registroPatronal);
  const Historial = await getHistorialLaboralModel();
  const Empleado = await getEmpleadoModel();

  const fi = startOfDay(fechaInicio || new Date());
  const ff = endOfDay(fechaFin || new Date());

  const movs = await Historial.find({
    tenantId,
    fechaMovimiento: { $gte: fi, $lte: ff },
    tipoMovimientoCodigo: 'ALTA'
  })
    .sort({ fechaMovimiento: 1 })
    .lean();

  const empIds = [...new Set(movs.map((m) => String(m.empleadoId)))];
  const empleados = await Empleado.find({ tenantId, _id: { $in: empIds } }).lean();
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));

  const preview = [];
  const lines = [];
  const omitidos = [];
  const seen = new Set();

  for (const mov of movs) {
    const id = String(mov.empleadoId);
    if (seen.has(id)) continue;
    seen.add(id);
    const emp = empMap.get(id);
    if (!emp) {
      omitidos.push({ folio: mov.folio, issues: ['Empleado no encontrado'] });
      continue;
    }
    const issues = validateEmpleadoParaSua(emp, empresaRp);
    if (issues.some((i) => i.startsWith('NSS') || i.startsWith('Sin registro'))) {
      omitidos.push({ numEmpleado: emp.numEmpleado, issues });
      continue;
    }
    // Usar fecha del movimiento ALTA como fecha de alta en el layout
    const empAlta = { ...emp, fechaIngreso: mov.fechaMovimiento || emp.fechaIngreso };
    if (Number(mov.sueldoIntegrado) > 0) empAlta.sdi = Number(mov.sueldoIntegrado);
    else if (Number(mov.salarioDiario) > 0) empAlta.sdi = Number(mov.salarioDiario);

    lines.push(buildAsegLine(empAlta, empresaRp));
    preview.push({
      numEmpleado: emp.numEmpleado,
      nss: emp.nss,
      nombre: resolveNombreSua(emp).trim(),
      sdi: resolveSdi(empAlta),
      fechaIngreso: empAlta.fechaIngreso,
      issues
    });
  }

  return {
    tipo: 'altas',
    empresaRp,
    total: lines.length,
    omitidos,
    preview,
    archivos: { 'ASEG.TXT': joinLines(lines) }
  };
}

/** MOVT.TXT desde historial (sin ALTA). */
async function generarMovimientosSua(tenantId, options = {}) {
  const {
    fechaInicio,
    fechaFin,
    registroPatronal = '',
    tiposInternos = ['BAJA', 'REAJUSTE', 'REINGRESO']
  } = options;

  const empresaRp = await loadEmpresaRp(tenantId, registroPatronal);
  const Historial = await getHistorialLaboralModel();
  const Empleado = await getEmpleadoModel();

  const fi = startOfDay(fechaInicio || new Date());
  const ff = endOfDay(fechaFin || new Date());

  const movs = await Historial.find({
    tenantId,
    fechaMovimiento: { $gte: fi, $lte: ff },
    tipoMovimientoCodigo: { $in: tiposInternos }
  })
    .sort({ fechaMovimiento: 1 })
    .lean();

  const empIds = [...new Set(movs.map((m) => String(m.empleadoId)))];
  const empleados = await Empleado.find({ tenantId, _id: { $in: empIds } }).lean();
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));

  const preview = [];
  const lines = [];
  const omitidos = [];

  for (const mov of movs) {
    const tipoSua = MAPA_MOV_SUA[mov.tipoMovimientoCodigo];
    if (!tipoSua) continue;
    const emp = empMap.get(String(mov.empleadoId));
    if (!emp) {
      omitidos.push({ folio: mov.folio, issues: ['Empleado no encontrado'] });
      continue;
    }
    const issues = validateEmpleadoParaSua(emp, empresaRp, { exigirCurpRfc: false });
    if (issues.some((i) => i.startsWith('NSS') || i.startsWith('Sin registro'))) {
      omitidos.push({
        numEmpleado: emp.numEmpleado,
        tipo: mov.tipoMovimientoCodigo,
        issues
      });
      continue;
    }

    const sdi =
      Number(mov.sueldoIntegrado) || Number(mov.salarioDiario) || resolveSdi(emp);

    lines.push(
      buildMovtLine({
        empleado: emp,
        empresaRp,
        tipoSua,
        fecha: mov.fechaMovimiento,
        sdi
      })
    );
    preview.push({
      numEmpleado: emp.numEmpleado,
      nss: emp.nss,
      tipoInterno: mov.tipoMovimientoCodigo,
      tipoSua,
      tipoLabel: TIPOS_MOV_SUA_LABEL[tipoSua] || tipoSua,
      fecha: mov.fechaMovimiento,
      sdi,
      issues
    });
  }

  return {
    tipo: 'movimientos',
    empresaRp,
    total: lines.length,
    omitidos,
    preview,
    archivos: { 'MOVT.TXT': joinLines(lines) }
  };
}

/** CRED.TXT — créditos INFONAVIT (inicio 15 por defecto). */
async function generarCreditosSua(tenantId, options = {}) {
  const { registroPatronal = '', tipoMovCred = '15', estatus = 'activo' } = options;
  const empresaRp = await loadEmpresaRp(tenantId, registroPatronal);
  const Empleado = await getEmpleadoModel();

  const q = { tenantId };
  if (estatus === 'activo') q.estatus = 'activo';

  const empleados = await Empleado.find(q).sort({ lastName: 1 }).lean();
  const preview = [];
  const lines = [];
  const omitidos = [];

  for (const emp of empleados) {
    const cfg = emp.nominaConfig || {};
    const numCredito = String(cfg.infonavitNumeroCredito || '').replace(/\s+/g, '');
    if (!numCredito) continue;

    const issues = validateEmpleadoParaSua(emp, empresaRp, { exigirCurpRfc: false });
    if (String(emp.nss || '').replace(/\D/g, '').length !== 11) {
      omitidos.push({ numEmpleado: emp.numEmpleado, issues: ['NSS inválido'] });
      continue;
    }

    let tipoDesc = '1';
    let valor = Number(cfg.tasaInfonavit) || 0;
    if (cfg.tipoCreditoInfonavit === 'cuota_fija') {
      tipoDesc = '2';
      valor = Number(cfg.tasaInfonavit) || Number(cfg.infonavitDescuento) || 0;
    } else if (cfg.tipoCreditoInfonavit === 'vsm') {
      tipoDesc = '3';
    } else if (cfg.tipoCreditoInfonavit === 'porcentaje') {
      tipoDesc = '1';
    }

    lines.push(
      buildCredLine({
        empleado: emp,
        empresaRp,
        tipoMov: tipoMovCred,
        fecha: cfg.infonavitFechaInicio || emp.fechaIngreso || new Date(),
        numeroCredito: numCredito,
        tipoDesc,
        valor,
        aplicaReduccion: '0'
      })
    );
    preview.push({
      numEmpleado: emp.numEmpleado,
      nss: emp.nss,
      credito: numCredito,
      tipoSua: tipoMovCred,
      tipoLabel: TIPOS_CRED_SUA_LABEL[tipoMovCred] || tipoMovCred,
      tipoDesc,
      valor,
      issues
    });
  }

  return {
    tipo: 'creditos',
    empresaRp,
    total: lines.length,
    omitidos,
    preview,
    archivos: { 'CRED.TXT': joinLines(lines) }
  };
}

module.exports = {
  MAPA_MOV_SUA,
  TIPOS_MOV_SUA_LABEL,
  TIPOS_CRED_SUA_LABEL,
  padRight,
  padLeftNum,
  formatDateDdmmyyyy,
  formatFechaInicioDescuento,
  formatSdi7,
  formatValorDescuento8,
  buildAsegLine,
  buildMovtLine,
  buildCredLine,
  validateEmpleadoParaSua,
  generarDirectorioSua,
  generarAltasPeriodoSua,
  generarMovimientosSua,
  generarCreditosSua
};
