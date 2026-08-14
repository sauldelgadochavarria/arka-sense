'use strict';

/**
 * Confronta Nómina – SUA – IDSE
 * Cruza SBC teórico (nómina) vs SBC IDSE vs SBC SUA por trabajador/periodo.
 */

const getReciboNominaModel = require('../models/reciboNomina');
const getNominaHistoricoReciboModel = require('../models/nominaHistoricoRecibo');
const getPeriodoNominaModel = require('../models/periodoNomina');
const getEmpleadoModel = require('../models/empleado');
const getEmpresaModel = require('../models/empresa');
const { resolverBaseImss } = require('../libs/sdiHelpers');
const { obtenerParametrosVigentes } = require('./nomina/tablasFiscalesService');
const { TOLERANCIA_DEFAULT } = require('../config/confrontaImssDefaults');

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pct(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function normNss(v) {
  return String(v || '').replace(/\D/g, '');
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_');
}

/**
 * Parsea CSV flexible (coma o pipe). Requiere columnas nss + sbc.
 * Alias: nss|imss|num_seguro, sbc|salario|sdi|sueldo
 */
function parseSbcCsv(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return { rows: [], errors: ['CSV vacío'] };

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['Sin líneas'] };

  const sep = lines[0].includes('|') ? '|' : ',';
  const headers = lines[0].split(sep).map(normHeader);
  const idxNss = headers.findIndex((h) =>
    ['nss', 'imss', 'num_seguro', 'numero_seguro', 'seguridad_social'].includes(h)
  );
  const idxSbc = headers.findIndex((h) =>
    ['sbc', 'sdi', 'salario', 'sueldo', 'sbc_diario', 'salario_base'].includes(h)
  );
  const idxRfc = headers.findIndex((h) => h === 'rfc');
  const idxNombre = headers.findIndex((h) =>
    ['nombre', 'trabajador', 'empleado'].includes(h)
  );
  const idxRp = headers.findIndex((h) =>
    ['registro_patronal', 'rp', 'patronal'].includes(h)
  );

  if (idxNss < 0 || idxSbc < 0) {
    return {
      rows: [],
      errors: [
        'Se requieren columnas NSS y SBC (encabezados). Ej: nss,sbc o NSS|SBC'
      ]
    };
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
    const nss = normNss(cols[idxNss]);
    const sbcRaw = String(cols[idxSbc] || '').replace(/[$,\s]/g, '').replace(',', '.');
    const sbc = Number(sbcRaw);
    if (nss.length !== 11) {
      errors.push(`Línea ${i + 1}: NSS inválido (${cols[idxNss] || ''})`);
      continue;
    }
    if (!Number.isFinite(sbc) || sbc < 0) {
      errors.push(`Línea ${i + 1}: SBC inválido`);
      continue;
    }
    rows.push({
      nss,
      sbc: money(sbc),
      rfc: idxRfc >= 0 ? String(cols[idxRfc] || '').toUpperCase() : '',
      nombre: idxNombre >= 0 ? cols[idxNombre] || '' : '',
      registroPatronal: idxRp >= 0 ? String(cols[idxRp] || '').toUpperCase() : ''
    });
  }

  return { rows, errors };
}

function labelPeriodo(p) {
  if (!p) return '';
  const tipo = p.tipoPeriodo || '';
  const num = p.numeroPeriodo != null ? p.numeroPeriodo : '';
  const anio = p.anio || '';
  if (tipo === 'semanal') return `Sem ${num} - ${anio}`;
  if (tipo === 'quincenal') return `Qna ${num} - ${anio}`;
  if (tipo === 'mensual') return `Mes ${num} - ${anio}`;
  return `${tipo} #${num} ${anio}`.trim();
}

function clasificarFila({
  sbcNomina,
  sbcIdse,
  sbcSua,
  tolerancia,
  tipoSalario,
  topeSbc,
  sdi
}) {
  const difNominaIdse =
    sbcIdse == null ? null : money(sbcNomina - sbcIdse);
  const difIdseSua =
    sbcIdse == null || sbcSua == null ? null : money(sbcIdse - sbcSua);
  const difNominaSua =
    sbcSua == null ? null : money(sbcNomina - sbcSua);

  const overTol = (d) => d != null && Math.abs(d) > tolerancia;
  const pctVsIdse =
    sbcIdse > 0 && difNominaIdse != null
      ? pct((difNominaIdse / sbcIdse) * 100)
      : null;

  let semaforo = 'OK';
  let prioridad = 'Baja';
  let movimientoPendiente = 'No';
  const obs = [];

  if (sbcIdse == null) {
    semaforo = 'Revisar';
    prioridad = 'Alta';
    movimientoPendiente = 'Sí';
    obs.push('Sin SBC en IDSE (no aparece en EMA/EBA importada)');
  } else if (overTol(difNominaIdse)) {
    semaforo = 'Revisar';
    if (difNominaIdse > 0) {
      prioridad = 'Alta';
      movimientoPendiente = 'Sí';
      obs.push(
        tipoSalario === 'fijo'
          ? 'Nómina > IDSE: posible modificación de salario fijo pendiente'
          : 'Nómina > IDSE: revisar ventana bimestral de variable/mixto o movimiento pendiente'
      );
    } else {
      prioridad = 'Media';
      obs.push('Nómina < IDSE: revisar SDI capturado o tope / baja incorrecta');
    }
  }

  if (sbcSua == null && sbcIdse != null) {
    if (semaforo === 'OK') semaforo = 'Revisar';
    if (prioridad === 'Baja') prioridad = 'Media';
    obs.push('Sin SBC en SUA local — sincronizar emisión');
  } else if (overTol(difIdseSua)) {
    if (semaforo === 'OK') semaforo = 'Revisar';
    if (prioridad === 'Baja') prioridad = 'Media';
    obs.push('IDSE ≠ SUA: base local desactualizada respecto al padrón');
  }

  if (topeSbc > 0 && sdi > topeSbc + 0.01 && Math.abs(sbcNomina - topeSbc) > tolerancia) {
    semaforo = 'Revisar';
    prioridad = 'Alta';
    obs.push(`SDI ${sdi} supera tope 25 UMA (${topeSbc}) pero SBC nómina no está topado`);
  }

  return {
    difNominaIdse,
    difIdseSua,
    difNominaSua,
    pctVsIdse,
    semaforo,
    prioridad,
    movimientoPendiente,
    observaciones: obs.join('; ')
  };
}

async function loadNominaRows(tenantId, empresaId, periodoId) {
  const Periodo = await getPeriodoNominaModel();
  const periodo = await Periodo.findOne({ _id: periodoId, tenantId }).lean();
  if (!periodo) throw new Error('Período no encontrado');

  const Empleado = await getEmpleadoModel();
  const Empresa = await getEmpresaModel();
  const empresa = await Empresa.findOne({ tenantId }).lean();
  const params = await obtenerParametrosVigentes(periodo.fechaInicio || new Date());
  const uma = params.uma || 0;
  const topeUma = params.topeUmaImss || 25;

  const Recibo = await getReciboNominaModel();
  let recibos = await Recibo.find({ tenantId, periodoId }).lean();
  let desdeHistorico = false;

  if (!recibos.length) {
    const Hist = await getNominaHistoricoReciboModel();
    const hist = await Hist.find({ tenantId, periodoId }).lean();
    recibos = hist.map((h) => ({
      _id: h._id,
      empleadoId: h.empleadoId,
      basesFiscales: h.basesFiscales || {},
      diasPago: h.diasPago || {},
      cerrado: true
    }));
    desdeHistorico = true;
  }

  const empIds = recibos.map((r) => r.empleadoId);
  const empleados = await Empleado.find({ tenantId, _id: { $in: empIds } }).lean();
  const empMap = new Map(empleados.map((e) => [String(e._id), e]));
  const rpEmpresa = String(empresa?.registroPatronal || '').toUpperCase();

  const rows = [];
  for (const r of recibos) {
    const emp = empMap.get(String(r.empleadoId));
    if (!emp) continue;
    const base = resolverBaseImss(emp, uma, topeUma);
    const baseImssPeriodo = money(r.basesFiscales?.BASE_IMSS || 0);
    const diasCot =
      Number(r.diasPago?.diasCotizacion) ||
      Number(r.diasLaborados) ||
      Number(periodo.diasPeriodo) ||
      0;

    // SBC diario teórico: preferir SDI topado del empleado (fuente afiliatoria);
    // si hay BASE_IMSS y días, también exponer implícito periodo/días como contraste.
    const sbcDiarioTeorico = money(base.sbc);
    const sbcDesdeBase =
      diasCot > 0 && baseImssPeriodo > 0 ? money(baseImssPeriodo / diasCot) : null;

    rows.push({
      empleadoId: emp._id,
      numEmpleado: emp.numEmpleado,
      registroPatronal: String(emp.registroPatronal || rpEmpresa || '').toUpperCase(),
      nss: normNss(emp.nss),
      rfc: String(emp.rfc || '').toUpperCase(),
      trabajador: `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
      periodoLabel: labelPeriodo(periodo),
      tipoSalario: base.tipoSalario || 'fijo',
      sdi: money(base.sdi),
      sbcNomina: sbcDiarioTeorico,
      sbcNominaDesdeBase: sbcDesdeBase,
      baseImssPeriodo,
      diasCotizacion: diasCot,
      topeSbc: money(base.topeSbc)
    });
  }

  return {
    periodo,
    desdeHistorico,
    uma,
    topeUma,
    topeSbc: money(uma * topeUma),
    rows
  };
}

/**
 * Ejecuta confronta.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.empresaId
 * @param {string} opts.periodoId
 * @param {number} [opts.tolerancia]
 * @param {string} [opts.csvIdse]
 * @param {string} [opts.csvSua]
 * @param {'diario'|'base'} [opts.fuenteNomina] diario=SDI topado; base=BASE_IMSS/días
 */
async function ejecutarConfronta(opts = {}) {
  const tolerancia = Number(opts.tolerancia);
  const tol = Number.isFinite(tolerancia) && tolerancia >= 0 ? tolerancia : TOLERANCIA_DEFAULT;

  const pack = await loadNominaRows(opts.tenantId, opts.empresaId, opts.periodoId);
  const idseParse = parseSbcCsv(opts.csvIdse || '');
  const suaParse = parseSbcCsv(opts.csvSua || '');

  const idseMap = new Map(idseParse.rows.map((r) => [r.nss, r]));
  const suaMap = new Map(suaParse.rows.map((r) => [r.nss, r]));

  const usarBase = opts.fuenteNomina === 'base';
  const filas = [];
  let i = 0;

  for (const n of pack.rows) {
    i += 1;
    const idse = idseMap.get(n.nss);
    const sua = suaMap.get(n.nss);
    const sbcNomina = usarBase && n.sbcNominaDesdeBase != null ? n.sbcNominaDesdeBase : n.sbcNomina;
    const sbcIdse = idse ? idse.sbc : null;
    const sbcSua = sua ? sua.sbc : null;

    const cls = clasificarFila({
      sbcNomina,
      sbcIdse,
      sbcSua,
      tolerancia: tol,
      tipoSalario: n.tipoSalario,
      topeSbc: n.topeSbc,
      sdi: n.sdi
    });

    filas.push({
      no: i,
      registroPatronal: n.registroPatronal || idse?.registroPatronal || '',
      nss: n.nss || '—',
      rfc: n.rfc,
      trabajador: n.trabajador,
      periodo: n.periodoLabel,
      tipoSalario: n.tipoSalario,
      sbcNomina,
      sbcIdse,
      sbcSua,
      baseImssPeriodo: n.baseImssPeriodo,
      ...cls
    });
  }

  // NSS en IDSE/SUA que no están en nómina del periodo
  const nssNomina = new Set(pack.rows.map((r) => r.nss).filter((x) => x.length === 11));
  const extras = [];
  for (const [nss, row] of idseMap) {
    if (!nssNomina.has(nss)) {
      extras.push({
        nss,
        fuente: 'IDSE',
        sbc: row.sbc,
        nombre: row.nombre,
        observacion: 'Vigente en IDSE pero sin recibo en el período de nómina'
      });
    }
  }
  for (const [nss, row] of suaMap) {
    if (!nssNomina.has(nss) && !extras.some((e) => e.nss === nss && e.fuente === 'IDSE')) {
      extras.push({
        nss,
        fuente: 'SUA',
        sbc: row.sbc,
        nombre: row.nombre,
        observacion: 'En SUA local pero sin recibo en el período'
      });
    }
  }

  const resumen = {
    total: filas.length,
    ok: filas.filter((f) => f.semaforo === 'OK').length,
    revisar: filas.filter((f) => f.semaforo === 'Revisar').length,
    alta: filas.filter((f) => f.prioridad === 'Alta').length,
    movimientoPendiente: filas.filter((f) => f.movimientoPendiente === 'Sí').length,
    extras: extras.length
  };

  return {
    tolerancia: tol,
    fuenteNomina: usarBase ? 'base' : 'diario',
    periodo: pack.periodo,
    periodoLabel: labelPeriodo(pack.periodo),
    desdeHistorico: pack.desdeHistorico,
    uma: pack.uma,
    topeSbc: pack.topeSbc,
    filas,
    extras,
    resumen,
    parseErrors: {
      idse: idseParse.errors,
      sua: suaParse.errors
    },
    importCounts: {
      idse: idseParse.rows.length,
      sua: suaParse.rows.length
    }
  };
}

function toConfrontaCsv(result) {
  const headers = [
    'No.',
    'Registro Patronal',
    'NSS',
    'RFC',
    'Trabajador',
    'Periodo',
    'Tipo de salario',
    'SBC Nomina',
    'SBC IDSE',
    'SBC SUA',
    'Dif Nomina-IDSE',
    'Dif IDSE-SUA',
    'Dif Nomina-SUA',
    '% Dif vs IDSE',
    'Semaforo',
    'Prioridad',
    'Movimiento pendiente',
    'Observaciones'
  ];
  const lines = [headers.join(',')];
  for (const f of result.filas || []) {
    const cells = [
      f.no,
      f.registroPatronal,
      f.nss,
      f.rfc,
      `"${String(f.trabajador || '').replace(/"/g, '""')}"`,
      `"${f.periodo || ''}"`,
      f.tipoSalario,
      f.sbcNomina ?? '',
      f.sbcIdse ?? '',
      f.sbcSua ?? '',
      f.difNominaIdse ?? '',
      f.difIdseSua ?? '',
      f.difNominaSua ?? '',
      f.pctVsIdse ?? '',
      f.semaforo,
      f.prioridad,
      f.movimientoPendiente,
      `"${String(f.observaciones || '').replace(/"/g, '""')}"`
    ];
    lines.push(cells.join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

module.exports = {
  parseSbcCsv,
  ejecutarConfronta,
  toConfrontaCsv,
  labelPeriodo,
  clasificarFila
};
