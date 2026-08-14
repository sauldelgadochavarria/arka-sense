'use strict';

/**
 * Motor de plantillas HTML de recibo (Mustache-lite).
 * Soporta {{path}} y bloques {{#lista}}…{{/lista}} (percepciones, deducciones, etc.).
 */

const { cantidadConLetra } = require('../libs/numeroALetras');
const { PERIODICIDAD_SAT } = require('../config/tipoPeriodoDefaults');

const SKIP_CODIGOS = new Set([
  'ISR_SAT',
  'ISR_PROYECTADO',
  'ISR_AJUSTADO',
  'ISR_DIFERENCIA',
  'PERCEPCIONES_GRAVADAS',
  'PERCEPCIONES_TOTALES',
  'DEDUCCIONES_TOTALES',
  'NETO_PAGAR',
  'BASE_GRAVADA',
  'ISR_BASE'
]);

const SAT_CLAVE_FALLBACK = {
  SUELDO: '001',
  SUELDO_DIARIO: '001',
  ISR: '002',
  IMSS_OBRERO: '001',
  IMSS: '001',
  INFONAVIT: '010',
  FONACOT: '011',
  FONDO_AHORRO: '005',
  DED_FONDO_AHORRO: '002',
  PREMIO_ASISTENCIA: '010',
  HORAS_EXTRA: '019',
  AGUINALDO: '002',
  PRIMA_VACACIONAL: '021',
  VACACIONES: '001',
  DESPENSA: '029',
  SUBSIDIO_EMPLEO: '002',
  OTRO_PAGO_SUBSIDIO: '002'
};

const TIPO_CONTRATO_SAT = {
  indefinido: '01 - Tiempo indeterminado',
  determinado: '03 - Tiempo determinado',
  obra: '05 - Por obra determinada',
  temporada: '08 - Por temporada',
  prueba: '07 - Periodo de prueba',
  '01': '01 - Tiempo indeterminado',
  '03': '03 - Tiempo determinado'
};

const PERIODICIDAD_POR_TIPO = {
  diario: '01 - Diario',
  semanal: '02 - Semanal',
  catorcenal: '03 - Catorcenal',
  quincenal: '04 - Quincenal',
  mensual: '05 - Mensual',
  bimestral: '06 - Bimestral',
  decena: '10 - Decena'
};

const TIPO_NOMINA_LABEL = {
  ordinaria: 'Nómina ordinaria',
  extraordinaria: 'Nómina extraordinaria',
  aguinaldo: 'Aguinaldo',
  finiquito: 'Finiquito / liquidación'
};

const MONEY_PATH = /neto|percepcion|deduccion|importe|total|gravado|exento|sdi|sbc|salario|subsidio|especie|acumulado|descuento/i;

function getByPath(obj, path) {
  if (!path) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('es-MX');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatIsoDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatIsoDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${formatIsoDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderScalar(val, path) {
  if (val == null) return '';
  if (val instanceof Date) return formatIsoDate(val);
  if (typeof val === 'number') {
    if (MONEY_PATH.test(path || '')) return formatMoney(val);
    return String(val);
  }
  return String(val);
}

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function renderListBlock(inner, list) {
  const rows = Array.isArray(list) ? list : [];
  return rows
    .map((item) => {
      let row = inner;
      row = row.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
        const v = item[key];
        if (v == null) return '';
        if (typeof v === 'number' && MONEY_PATH.test(key)) return escapeHtml(formatMoney(v));
        if (v instanceof Date) return escapeHtml(formatIsoDate(v));
        return escapeHtml(String(v));
      });
      return row;
    })
    .join('');
}

/**
 * Renderiza plantilla HTML con contexto.
 * @param {string} tpl
 * @param {object} ctx
 */
function renderPlantillaHtml(tpl, ctx = {}) {
  let out = String(tpl || '');

  out = out.replace(/\{\{#([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, inner) => {
    return renderListBlock(inner, ctx[name]);
  });

  out = out.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    const v = getByPath(ctx, path);
    return escapeHtml(renderScalar(v, path));
  });

  return out;
}

function joinNombre(emp = {}) {
  if (emp.nombre) return String(emp.nombre).trim();
  const parts = [emp.firstName, emp.apellidoPaterno || emp.lastName, emp.apellidoMaterno].filter(Boolean);
  if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
  return `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
}

function joinDomicilio(dom = {}) {
  if (typeof dom === 'string') return dom;
  const bits = [
    dom.calle,
    [dom.numeroExt, dom.numeroInt].filter(Boolean).join(' Int. '),
    dom.colonia,
    dom.poblacion,
    dom.entidad,
    dom.codigoPostal ? `CP ${dom.codigoPostal}` : ''
  ].filter(Boolean);
  return bits.join(', ');
}

function antiguedadSat(ingreso, ref) {
  if (!ingreso) return '';
  const a = ingreso instanceof Date ? ingreso : new Date(ingreso);
  const b = ref ? (ref instanceof Date ? ref : new Date(ref)) : new Date();
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return '';
  let y = b.getFullYear() - a.getFullYear();
  let m = b.getMonth() - a.getMonth();
  let d = b.getDate() - a.getDate();
  if (d < 0) {
    m -= 1;
    d += new Date(b.getFullYear(), b.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return `P${y}Y${m}M${d}D`;
}

function periodicidadLabel(periodo = {}) {
  if (periodo.periodicidadPago) return periodo.periodicidadPago;
  const sat = Number(periodo.periodicidadPagoSat);
  if (Number.isFinite(sat)) {
    const row = PERIODICIDAD_SAT.find((p) => p.value === sat);
    if (row) return `${String(sat).padStart(2, '0')} - ${row.label}`;
  }
  const tipo = String(periodo.tipoPeriodo || '').toLowerCase();
  return PERIODICIDAD_POR_TIPO[tipo] || tipo;
}

function clasificarConcepto(c, meta = {}) {
  const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
  if (SKIP_CODIGOS.has(code)) return 'skip';
  const t = String(c.tipo || meta.tipo || meta.satTipo || '').toLowerCase();
  const nat = String(meta.naturaleza || '').toLowerCase();
  if (code === 'SUBSIDIO_EMPLEO' || t === 'otro_pago' || t.includes('otro')) return 'otro_pago';
  if (t.includes('deduc')) return 'deduccion';
  if (nat === 'informativo' || t.includes('info') || t.includes('acum') || t === 'fiscal') return 'skip';
  if (t.includes('percep') || !t) return 'percepcion';
  return 'skip';
}

function claveSatDe(c, meta = {}) {
  return (
    c.claveSAT ||
    c.satClave ||
    (c.sat && c.sat.clave) ||
    meta.claveSAT ||
    SAT_CLAVE_FALLBACK[String(c.conceptoCodigo || c.codigo || '').toUpperCase()] ||
    ''
  );
}

function qrSatUrl({ uuid, rfcEmisor, rfcReceptor, total, sello }) {
  const tt = Number(total || 0).toFixed(6);
  const fe = String(sello || '00000000').slice(-8);
  const data = [
    'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx',
    `?id=${encodeURIComponent(uuid || '')}`,
    `&re=${encodeURIComponent(rfcEmisor || '')}`,
    `&rr=${encodeURIComponent(rfcReceptor || '')}`,
    `&tt=${tt}`,
    `&fe=${encodeURIComponent(fe)}`
  ].join('');
  return `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(data)}`;
}

function cadenaOriginalTimbre(cfdi = {}) {
  if (cfdi.cadenaOriginal) return cfdi.cadenaOriginal;
  if (!cfdi.uuid) return '';
  return `||1.1|${cfdi.uuid}|${cfdi.fechaCertificacion || cfdi.fechaTimbrado || ''}|${cfdi.selloEmisor || ''}|${cfdi.certificadoSat || ''}|`;
}

/**
 * Construye contexto para PDF a partir de recibo/histórico + catálogos.
 */
function buildReciboPdfContext({
  empresa = {},
  empleado = {},
  periodo = {},
  recibo = {},
  conceptos = [],
  cfdi = {},
  catalogoNombres = {},
  catalogoMeta = {}
} = {}) {
  const metaOf = (code) => catalogoMeta[code] || {};
  const conceptosView = [];
  const percepciones = [];
  const deducciones = [];
  const otrosPagos = [];
  let subsidioEmpleo = 0;
  let subsidioCausado = 0;

  for (const c of conceptos || []) {
    const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
    const importe = money(c.importe);
    if (!code) continue;
    const meta = metaOf(code);
    const nombre = catalogoNombres[code] || meta.nombre || c.nombre || code;
    const sat = claveSatDe(c, meta);
    const kind = clasificarConcepto(c, meta);
    const row = {
      codigo: code,
      nombre,
      tipo: c.tipo || meta.tipo || '',
      sat,
      importe,
      gravado: money(c.gravado),
      exento: money(c.exento),
      acumulado: money(c.acumulado || c.saldo || 0)
    };
    if (importe !== 0 && kind !== 'skip') conceptosView.push(row);
    if (code === 'SUBSIDIO_EMPLEO' || code === 'OTRO_PAGO_SUBSIDIO') subsidioEmpleo = importe;
    if (code === 'SUBSIDIO_CAUSADO') subsidioCausado = importe;
    if (importe === 0) continue;
    if (kind === 'percepcion') percepciones.push(row);
    else if (kind === 'deduccion') deducciones.push(row);
    else if (kind === 'otro_pago') otrosPagos.push(row);
  }

  const totalPerc = money(
    recibo.totalPercepciones != null
      ? recibo.totalPercepciones
      : percepciones.reduce((s, r) => s + r.importe, 0)
  );
  const totalDed = money(
    recibo.totalDeducciones != null
      ? recibo.totalDeducciones
      : deducciones.reduce((s, r) => s + r.importe, 0)
  );
  const totalOtros = money(
    recibo.totalOtrosPagos != null
      ? recibo.totalOtrosPagos
      : otrosPagos.reduce((s, r) => s + r.importe, 0)
  );
  const neto = money(recibo.netoPagar != null ? recibo.netoPagar : totalPerc - totalDed + totalOtros);

  const dom = empleado.domicilio || {};
  const banco = empleado.datosBancarios || {};
  const sdi = money(empleado.sdi || empleado.sueldoIntegrado || empleado.nominaConfig?.sueldoIntegrado || 0);
  const salarioDiario = money(empleado.salarioDiario || 0);
  const sbc = money(empleado.sbc || sdi);
  const fechaIngreso = empleado.fechaIngreso || '';
  const fechaFin = periodo.fechaFin || '';
  const fechaPago = periodo.fechaPago || periodo.fechaFin || recibo.fechaPago || '';
  const fechaCfdi = cfdi.fecha || cfdi.fechaTimbrado || new Date();
  const fechaCert = cfdi.fechaCertificacion || cfdi.fechaTimbrado || fechaCfdi;
  const uuid = cfdi.uuid || '';
  const selloSat = cfdi.selloSat || cfdi.selloCFD || '';
  const rfcEmp = empleado.rfc || '';
  const sindicalizado =
    empleado.sindicalizado != null
      ? empleado.sindicalizado
      : /sind/i.test(String(empleado.tipoEmpleado || empleado.leyenda || ''))
        ? 'Sí'
        : 'No';

  const domicilioEmp = joinDomicilio(dom) || empleado.domicilioTexto || '';
  const domicilioEmpresa =
    empresa.domicilioFiscal ||
    [empresa.ciudad, empresa.estado, empresa.codigoPostal ? `CP ${empresa.codigoPostal}` : '']
      .filter(Boolean)
      .join(' ');

  return {
    empresa: {
      razonSocial: empresa.razonSocial || empresa.nombreComercial || '',
      rfc: empresa.rfc || '',
      registroPatronal: empleado.registroPatronal || empresa.registroPatronal || '',
      codigoPostal: empresa.codigoPostal || '',
      domicilio: domicilioEmpresa,
      regimenFiscal: empresa.regimenFiscal || '601 - General de Ley Personas Morales',
      expedidoEn: [empresa.ciudad, empresa.estado, empresa.codigoPostal ? `CP ${empresa.codigoPostal}` : '']
        .filter(Boolean)
        .join(' ') || domicilioEmpresa
    },
    empleado: {
      numEmpleado: empleado.numEmpleado || '',
      nombre: joinNombre(empleado),
      rfc: rfcEmp,
      curp: empleado.curp || '',
      nss: empleado.nss || empleado.imss || '',
      departamento: empleado.departamento || empleado.departamentoNombre || '',
      centroCosto: empleado.centroCosto || empleado.centroCostoNombre || empleado.centroCostoCodigo || '',
      puesto: empleado.puesto || empleado.puestoNombre || '',
      ubicacion: empleado.ubicacion || empresa.ciudad || '',
      regimenFiscal: empleado.regimenFiscal || '605 - Sueldos y Salarios e Ingresos Asimilados a Salarios',
      fechaIngreso: formatIsoDate(fechaIngreso),
      codigoPostal: dom.codigoPostal || empleado.codigoPostal || '',
      domicilio: domicilioEmp,
      tipoContrato: TIPO_CONTRATO_SAT[String(empleado.tipoContrato || '').toLowerCase()] || empleado.tipoContrato || '01 - Tiempo indeterminado',
      tipoRegimen: empleado.tipoRegimen || '02 - Sueldos',
      riesgoPuesto: empleado.riesgoPuesto || '2',
      tipoJornada: empleado.tipoJornada || '01 - Diurna',
      antiguedad: empleado.antiguedad || antiguedadSat(fechaIngreso, fechaFin),
      sindicalizado,
      sdi,
      sbc,
      salarioDiario,
      banco: banco.bancoNombre || banco.bancoCodigo || empleado.banco || '',
      cuenta: banco.cuenta || banco.clabe || empleado.cuenta || '',
      entidadFederativa: dom.entidad || empleado.entidadFederativa || ''
    },
    periodo: {
      tipoPeriodo: periodo.tipoPeriodo || periodo.tipoPeriodoNombre || '',
      tipoNomina: periodo.tipoNomina || 'ordinaria',
      tipoNominaLabel: TIPO_NOMINA_LABEL[periodo.tipoNomina] || periodo.tipoNomina || 'Nómina ordinaria',
      numeroPeriodo: periodo.numeroPeriodo != null ? periodo.numeroPeriodo : '',
      fechaInicio: formatIsoDate(periodo.fechaInicio),
      fechaFin: formatIsoDate(periodo.fechaFin),
      fechaPago: formatIsoDate(fechaPago),
      anio: periodo.anio || '',
      periodicidadPago: periodicidadLabel(periodo)
    },
    recibo: {
      totalPercepciones: totalPerc,
      totalDeducciones: totalDed,
      totalOtrosPagos: totalOtros,
      netoPagar: neto,
      diasLaborados: recibo.diasLaborados != null ? recibo.diasLaborados : '',
      diasPagados:
        recibo.diasPagados != null
          ? recibo.diasPagados
          : recibo.diasLaborados != null
            ? recibo.diasLaborados
            : '',
      subsidioEmpleo,
      subsidioCausado,
      enEspecie: money(recibo.enEspecie),
      cantidadLetra: cantidadConLetra(neto)
    },
    cfdi: {
      uuid,
      serie: cfdi.serie || '',
      folio: cfdi.folio || '',
      fecha: formatIsoDateTime(fechaCfdi),
      fechaCertificacion: formatIsoDateTime(fechaCert),
      certificadoEmisor: cfdi.certificadoEmisor || cfdi.noCertificado || '',
      certificadoSat: cfdi.certificadoSat || cfdi.noCertificadoSAT || '',
      selloEmisor: cfdi.selloEmisor || cfdi.selloCFD || '',
      selloSat,
      cadenaOriginal: cadenaOriginalTimbre({
        ...cfdi,
        uuid,
        fechaCertificacion: formatIsoDateTime(fechaCert)
      }),
      tipoComprobante: cfdi.tipoComprobante || 'N - Nómina',
      formaPago: cfdi.formaPago || '99 - Por definir',
      metodoPago: cfdi.metodoPago || 'PUE - Pago en una sola exhibición',
      usoCfdi: cfdi.usoCfdi || 'CN01 - Nómina',
      claveProdServ: cfdi.claveProdServ || '84111505',
      qrUrl: qrSatUrl({
        uuid,
        rfcEmisor: empresa.rfc,
        rfcReceptor: rfcEmp,
        total: neto,
        sello: selloSat || cfdi.selloEmisor
      })
    },
    conceptos: conceptosView,
    percepciones,
    deducciones,
    otrosPagos
  };
}

async function enrichEmpleadoPdf(empleado) {
  if (!empleado) return {};
  const out = { ...empleado };
  const tasks = [];
  if (empleado.departamentoId && !empleado.departamentoNombre && !empleado.departamento) {
    tasks.push(
      (async () => {
        const getDepartamentoModel = require('../models/departamento');
        const Departamento = await getDepartamentoModel();
        const d = await Departamento.findById(empleado.departamentoId).select('nombre').lean();
        if (d) out.departamentoNombre = d.nombre;
      })()
    );
  }
  if (empleado.centroCostoId && !empleado.centroCostoNombre && !empleado.centroCosto) {
    tasks.push(
      (async () => {
        const getCentroCostoModel = require('../models/centroCosto');
        const CentroCosto = await getCentroCostoModel();
        const c = await CentroCosto.findById(empleado.centroCostoId).select('codigo nombre').lean();
        if (c) {
          out.centroCostoNombre = c.nombre;
          out.centroCostoCodigo = c.codigo;
        }
      })()
    );
  }
  if (empleado.puestoId && !empleado.puestoNombre && !empleado.puesto) {
    tasks.push(
      (async () => {
        const getPuestoModel = require('../models/puesto');
        const Puesto = await getPuestoModel();
        const p = await Puesto.findById(empleado.puestoId).select('nombre').lean();
        if (p) out.puestoNombre = p.nombre;
      })()
    );
  }
  if (tasks.length) await Promise.all(tasks);
  return out;
}

function mergeEmpleadoPdf(snap = {}, live = {}) {
  return {
    ...live,
    ...snap,
    domicilio: live.domicilio || snap.domicilio,
    datosBancarios: live.datosBancarios || snap.datosBancarios,
    nominaConfig: live.nominaConfig || snap.nominaConfig,
    numEmpleado: snap.numEmpleado || live.numEmpleado,
    nombre: snap.nombre || joinNombre(live),
    departamentoNombre: snap.departamentoNombre || live.departamentoNombre,
    centroCostoNombre: snap.centroCostoNombre || live.centroCostoNombre,
    rfc: live.rfc || snap.rfc,
    curp: live.curp || snap.curp,
    nss: live.nss || snap.nss,
    sdi: live.sdi != null ? live.sdi : snap.sdi,
    salarioDiario: live.salarioDiario != null ? live.salarioDiario : snap.salarioDiario,
    fechaIngreso: live.fechaIngreso || snap.fechaIngreso,
    tipoContrato: snap.tipoContrato || live.tipoContrato,
    tipoEmpleado: snap.tipoEmpleado || live.tipoEmpleado
  };
}

/**
 * Resuelve plantilla: prioridad tipoPeriodo+RFC > tipoPeriodo > RFC > default.
 */
async function resolverPlantillaPdf(Plantilla, { tenantId, empresaId, tipoPeriodoId, rfcEmisor }) {
  const rfc = String(rfcEmisor || '').trim().toUpperCase();
  const base = { tenantId, empresaId, activo: true };
  const candidates = [];

  if (tipoPeriodoId && rfc) {
    candidates.push({ ...base, tipoPeriodoId, rfcEmisor: rfc });
  }
  if (tipoPeriodoId) {
    candidates.push({ ...base, tipoPeriodoId, rfcEmisor: '' });
  }
  if (rfc) {
    candidates.push({ ...base, tipoPeriodoId: null, rfcEmisor: rfc });
  }
  candidates.push({ ...base, esDefault: true });
  candidates.push({ ...base });

  for (const q of candidates) {
    const found = await Plantilla.findOne(q).sort({ orden: 1, createdAt: 1 }).lean();
    if (found) return found;
  }
  return null;
}

module.exports = {
  renderPlantillaHtml,
  buildReciboPdfContext,
  resolverPlantillaPdf,
  enrichEmpleadoPdf,
  mergeEmpleadoPdf,
  formatMoney,
  formatDate,
  formatIsoDate,
  formatIsoDateTime
};
