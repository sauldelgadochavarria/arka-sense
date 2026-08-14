'use strict';

/**
 * Catálogo de gestión documental (expediente nómina + trabajadores).
 * Árbol alineado a operación mensual MX.
 */

const MESES = [
  { num: 1, codigo: '01', nombre: 'Enero' },
  { num: 2, codigo: '02', nombre: 'Febrero' },
  { num: 3, codigo: '03', nombre: 'Marzo' },
  { num: 4, codigo: '04', nombre: 'Abril' },
  { num: 5, codigo: '05', nombre: 'Mayo' },
  { num: 6, codigo: '06', nombre: 'Junio' },
  { num: 7, codigo: '07', nombre: 'Julio' },
  { num: 8, codigo: '08', nombre: 'Agosto' },
  { num: 9, codigo: '09', nombre: 'Septiembre' },
  { num: 10, codigo: '10', nombre: 'Octubre' },
  { num: 11, codigo: '11', nombre: 'Noviembre' },
  { num: 12, codigo: '12', nombre: 'Diciembre' }
];

/** Proveedores de storage (Linode Object Storage es S3-compatible). */
const STORAGE_PROVEEDORES = [
  {
    value: 'local',
    label: 'Carpeta local por empresa',
    descripcion: 'Filesystem del servidor / volumen Docker. Económico en on-prem.'
  },
  {
    value: 's3',
    label: 'Bucket remoto S3-compatible (Linode / AWS / MinIO)',
    descripcion: 'Object storage. Linode Object Storage suele ser más económico que S3 AWS.'
  }
];

const LINNODE_ENDPOINTS = [
  { value: 'https://us-east-1.linodeobjects.com', label: 'Linode Newark (us-east-1)' },
  { value: 'https://us-southeast-1.linodeobjects.com', label: 'Linode Atlanta (us-southeast-1)' },
  { value: 'https://eu-central-1.linodeobjects.com', label: 'Linode Frankfurt (eu-central-1)' },
  { value: 'https://ap-south-1.linodeobjects.com', label: 'Linode Singapore (ap-south-1)' },
  { value: '', label: 'Otro (endpoint personalizado)' }
];

/**
 * Tipos documentales del expediente operativo (año/mes/…).
 * scope: periodo | mes | empleado
 */
const TIPOS_DOCUMENTO = [
  // —— Por período de nómina ——
  { codigo: 'PRENOMINA', nombre: 'Prenómina', ambito: 'periodo', carpeta: 'Prenomina', grupo: 'nomina', obligatorio: false },
  { codigo: 'INCIDENCIAS', nombre: 'Incidencias', ambito: 'periodo', carpeta: 'Incidencias', grupo: 'nomina', obligatorio: false },
  { codigo: 'CFDI_XML', nombre: 'CFDI XML', ambito: 'periodo', carpeta: 'CFDI_XML', grupo: 'nomina', obligatorio: true },
  { codigo: 'CFDI_PDF', nombre: 'CFDI PDF', ambito: 'periodo', carpeta: 'CFDI_PDF', grupo: 'nomina', obligatorio: true },
  { codigo: 'LAYOUT_BANCO', nombre: 'Layout banco', ambito: 'periodo', carpeta: 'Layout_banco', grupo: 'nomina', obligatorio: false },
  { codigo: 'ACUSE_TIMBRADO', nombre: 'Acuse timbrado', ambito: 'periodo', carpeta: 'Acuse_timbrado', grupo: 'nomina', obligatorio: false },
  { codigo: 'POLIZA_CONTABLE', nombre: 'Póliza contable', ambito: 'periodo', carpeta: 'Poliza_contable', grupo: 'nomina', obligatorio: false },

  // —— SUA (mensual) ——
  { codigo: 'SUA_ARCHIVO', nombre: 'Archivo SUA', ambito: 'mes', carpeta: 'SUA/Archivo_SUA', grupo: 'sua', obligatorio: true },
  { codigo: 'SUA_LINEA_CAPTURA', nombre: 'Línea de captura', ambito: 'mes', carpeta: 'SUA/Linea_captura', grupo: 'sua', obligatorio: false },
  { codigo: 'SUA_COMPROBANTE_PAGO', nombre: 'Comprobante de pago SUA', ambito: 'mes', carpeta: 'SUA/Comprobante_pago', grupo: 'sua', obligatorio: false },
  { codigo: 'SUA_ACUSE_CONFRONTA', nombre: 'Acuse + resultado confronta', ambito: 'mes', carpeta: 'SUA/Acuse_confronta', grupo: 'sua', obligatorio: false },

  // —— Impuestos (mensual) ——
  { codigo: 'IMP_ISR', nombre: 'ISR', ambito: 'mes', carpeta: 'Impuestos/ISR', grupo: 'impuestos', obligatorio: false },
  { codigo: 'IMP_IVA', nombre: 'IVA (si aplica)', ambito: 'mes', carpeta: 'Impuestos/IVA', grupo: 'impuestos', obligatorio: false },
  { codigo: 'IMP_ISN', nombre: 'ISN', ambito: 'mes', carpeta: 'Impuestos/ISN', grupo: 'impuestos', obligatorio: false },

  // —— INFONAVIT (mensual) ——
  { codigo: 'INF_EMA', nombre: 'EMA', ambito: 'mes', carpeta: 'INFONAVIT/EMA', grupo: 'infonavit', obligatorio: false },
  { codigo: 'INF_EBA', nombre: 'EBA', ambito: 'mes', carpeta: 'INFONAVIT/EBA', grupo: 'infonavit', obligatorio: false },
  { codigo: 'INF_PAGO', nombre: 'Pago INFONAVIT', ambito: 'mes', carpeta: 'INFONAVIT/Pago', grupo: 'infonavit', obligatorio: false },
  { codigo: 'INF_ACUSE', nombre: 'Acuse INFONAVIT', ambito: 'mes', carpeta: 'INFONAVIT/Acuse', grupo: 'infonavit', obligatorio: false },

  // —— Trabajador ——
  { codigo: 'EMP_CONTRATO', nombre: 'Contrato', ambito: 'empleado', carpeta: 'Contrato', grupo: 'trabajador', obligatorio: true, vigencia: true },
  { codigo: 'EMP_INE', nombre: 'INE / Identificación', ambito: 'empleado', carpeta: 'INE_Identificacion', grupo: 'trabajador', obligatorio: true, vigencia: true },
  { codigo: 'EMP_RFC', nombre: 'RFC / Constancia SAT', ambito: 'empleado', carpeta: 'RFC_SAT', grupo: 'trabajador', obligatorio: true },
  { codigo: 'EMP_NSS', nombre: 'NSS / Alta IMSS', ambito: 'empleado', carpeta: 'NSS', grupo: 'trabajador', obligatorio: true },
  { codigo: 'EMP_COMP_DOMICILIO', nombre: 'Comprobante de domicilio', ambito: 'empleado', carpeta: 'Comprobante_domicilio', grupo: 'trabajador', obligatorio: false, vigencia: true },
  { codigo: 'EMP_INCAPACIDADES', nombre: 'Incapacidades', ambito: 'empleado', carpeta: 'Incapacidades', grupo: 'trabajador', obligatorio: false },
  { codigo: 'EMP_FINIQUITO', nombre: 'Finiquito / liquidación', ambito: 'empleado', carpeta: 'Finiquito', grupo: 'trabajador', obligatorio: false },
  { codigo: 'EMP_PARTICULARES', nombre: 'Documentos particulares', ambito: 'empleado', carpeta: 'Documentos_particulares', grupo: 'trabajador', obligatorio: false }
];

const GRUPOS = [
  { codigo: 'nomina', nombre: 'Nómina del período' },
  { codigo: 'sua', nombre: 'SUA' },
  { codigo: 'impuestos', nombre: 'Impuestos' },
  { codigo: 'infonavit', nombre: 'INFONAVIT' },
  { codigo: 'trabajador', nombre: 'Expediente del trabajador' }
];

function tipoByCodigo(codigo) {
  return TIPOS_DOCUMENTO.find((t) => t.codigo === String(codigo || '').toUpperCase()) || null;
}

function mesByNum(n) {
  return MESES.find((m) => m.num === Number(n)) || null;
}

function slugPath(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'sin_nombre';
}

const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Procesos de cumplimiento con fecha límite típica MX.
 * diaLimiteMesSiguiente: 17 = IMSS/SAT/INFONAVIT (día 17 del mes siguiente).
 */
const PROCESOS_CUMPLIMIENTO = [
  {
    codigo: 'NOMINA',
    nombre: 'Nómina',
    origen: 'periodo',
    tiposDoc: ['CFDI_XML', 'CFDI_PDF'],
    href: '/nomina/periodos'
  },
  {
    codigo: 'SUA',
    nombre: 'SUA',
    origen: 'mes',
    tiposOk: ['SUA_COMPROBANTE_PAGO', 'SUA_ACUSE_CONFRONTA'],
    tiposParcial: ['SUA_ARCHIVO', 'SUA_LINEA_CAPTURA'],
    diaLimiteMesSiguiente: 17,
    href: '/nomina/sua'
  },
  {
    codigo: 'ISR',
    nombre: 'ISR',
    origen: 'mes',
    tiposOk: ['IMP_ISR'],
    tiposParcial: [],
    diaLimiteMesSiguiente: 17,
    href: '/nomina/gestion-documental/subir'
  },
  {
    codigo: 'ISN',
    nombre: 'ISN',
    origen: 'mes',
    tiposOk: ['IMP_ISN'],
    tiposParcial: [],
    diaLimiteMesSiguiente: 17,
    href: '/nomina/gestion-documental/subir'
  },
  {
    codigo: 'INFONAVIT',
    nombre: 'INFONAVIT',
    origen: 'bimestre',
    tiposOk: ['INF_PAGO', 'INF_ACUSE'],
    tiposParcial: ['INF_EMA', 'INF_EBA'],
    diaLimiteMesSiguiente: 17,
    href: '/nomina/gestion-documental/subir'
  }
];

const TIPOS_EXPEDIENTE_OBLIGATORIOS = TIPOS_DOCUMENTO.filter(
  (t) => t.ambito === 'empleado' && t.obligatorio
).map((t) => t.codigo);

function fechaDiaMesSiguiente(anio, mes, dia) {
  let y = Number(anio);
  let m = Number(mes) + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return new Date(y, m - 1, dia);
}

function mesAnteriorDe(ref) {
  const d = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  return { anio: d.getFullYear(), mes: d.getMonth() + 1, nombre: MESES[d.getMonth()].nombre };
}

/** Último bimestre INFONAVIT cerrado (1=ene-feb … 6=nov-dic) y su fecha límite (día 17 del mes siguiente). */
function bimestreInfonavitCerrado(ref) {
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  let endMonth = m % 2 === 0 ? m - 2 : m - 1;
  let year = y;
  if (endMonth <= 0) {
    endMonth += 12;
    year -= 1;
  }
  const startMonth = endMonth - 1;
  const num = Math.ceil(endMonth / 2);
  const limite = fechaDiaMesSiguiente(year, endMonth, 17);
  return {
    num,
    anio: year,
    mesInicio: startMonth,
    mesFin: endMonth,
    label: `Bim. ${num} (${MESES_CORTO[startMonth - 1]}-${MESES_CORTO[endMonth - 1]})`,
    fechaLimite: limite
  };
}

function formatFechaCorta(d) {
  if (!d) return '—';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
}

function formatRangoPeriodo(inicio, fin) {
  const a = new Date(inicio);
  const b = new Date(fin);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${String(a.getDate()).padStart(2, '0')}-${String(b.getDate()).padStart(2, '0')} ${MESES_CORTO[a.getMonth()]}`;
  }
  return `${String(a.getDate()).padStart(2, '0')} ${MESES_CORTO[a.getMonth()]} – ${String(b.getDate()).padStart(2, '0')} ${MESES_CORTO[b.getMonth()]}`;
}

function semaforo({ cumplido, parcial, fechaLimite, now, labelOk, labelParcial, labelPendiente, labelAtrasado }) {
  const n = startOfDay(now);
  const lim = fechaLimite ? startOfDay(fechaLimite) : null;
  const vencido = lim && n > lim;
  if (cumplido) {
    return { codigo: 'ok', label: labelOk || 'Cumplido' };
  }
  if (parcial) {
    return { codigo: vencido ? 'atrasado' : 'pendiente', label: labelParcial || 'Pendiente' };
  }
  if (vencido) {
    return { codigo: 'atrasado', label: labelAtrasado || 'Sin presentar' };
  }
  return { codigo: 'pendiente', label: labelPendiente || 'Pendiente' };
}

function startOfDay(d) {
  const x = d instanceof Date ? d : new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

module.exports = {
  MESES,
  MESES_CORTO,
  STORAGE_PROVEEDORES,
  LINNODE_ENDPOINTS,
  TIPOS_DOCUMENTO,
  GRUPOS,
  PROCESOS_CUMPLIMIENTO,
  TIPOS_EXPEDIENTE_OBLIGATORIOS,
  tipoByCodigo,
  mesByNum,
  slugPath,
  fechaDiaMesSiguiente,
  mesAnteriorDe,
  bimestreInfonavitCerrado,
  formatFechaCorta,
  formatRangoPeriodo,
  semaforo
};
