'use strict';

/**
 * Genera históricos fake semanales 2026-01-01 → 2026-06-20
 * para empleados 001, 002, 007.
 *
 * node scripts/generar-historicos-fake-demo.js
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data', 'cargas-demo');

const EMPLEADOS = [
  {
    numEmpleado: '001',
    nombre: 'Roberto Vargas Herrera',
    // referencia semana “normal” 5 días (tabla usuario)
    base: { percepciones: 5464.79, deducciones: 1064.18, neto: 4400.61, dias: 5 }
  },
  {
    numEmpleado: '002',
    nombre: 'María López García',
    base: { percepciones: 4413.75, deducciones: 465.77, neto: 3947.98, dias: 5 }
  },
  {
    numEmpleado: '007',
    nombre: 'Fernando Castillo Núñez',
    base: { percepciones: 3599.25, deducciones: 471.91, neto: 3127.34, dias: 5 }
  }
];

function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(12, 0, 0, 0);
  return x;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Variación suave ±3% por semana (determinista). */
function factorSemana(numPeriodo, numEmpleado) {
  const seed = numPeriodo * 17 + Number(numEmpleado) * 3;
  const wave = Math.sin(seed / 4) * 0.03;
  return 1 + wave;
}

function diasCalendario(ini, fin) {
  const a = new Date(`${ini}T12:00:00`);
  const b = new Date(`${fin}T12:00:00`);
  return Math.round((b - a) / 86400000) + 1;
}

function buildWeeks() {
  const start = new Date('2026-01-01T12:00:00');
  const end = new Date('2026-06-20T12:00:00');
  let w = mondayOf(start);
  const weeks = [];
  let n = 1;
  while (w <= end) {
    const fin = new Date(w);
    fin.setDate(fin.getDate() + 6);
    if (fin >= start && w <= end) {
      const fi = w < start ? new Date(start) : new Date(w);
      const ff = fin > end ? new Date(end) : new Date(fin);
      weeks.push({
        n,
        ini: ymd(fi),
        fin: ymd(ff),
        mes: fi.getMonth() + 1,
        anio: fi.getFullYear()
      });
      n += 1;
    }
    w.setDate(w.getDate() + 7);
  }
  return weeks;
}

function montosPara(emp, week) {
  const cal = diasCalendario(week.ini, week.fin);
  // días laborables aprox: en semana completa 5; en parciales ~ proporcional a días calendario (máx 5)
  const diasLab = Math.min(5, Math.max(1, Math.round((cal / 7) * 5)));
  const f = factorSemana(week.n, emp.numEmpleado) * (diasLab / emp.base.dias);
  const percepciones = round2(emp.base.percepciones * f);
  const deducciones = round2(emp.base.deducciones * f);
  const neto = round2(percepciones - deducciones);
  const diasPagados = diasLab + (diasLab >= 5 ? 2 : diasLab >= 4 ? 1 : 0);
  return { percepciones, deducciones, neto, diasLaborados: diasLab, diasPagados };
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

function main() {
  const weeks = buildWeeks();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const histRows = [];
  const acumMap = new Map(); // key num|concepto -> { anual, gravado, porMes }

  function bump(num, concepto, mes, importe, gravado = importe, exento = 0) {
    const key = `${num}|${concepto}`;
    if (!acumMap.has(key)) {
      acumMap.set(key, {
        numEmpleado: num,
        anio: 2026,
        conceptoCodigo: concepto,
        importeAnual: 0,
        gravadoAnual: 0,
        exentoAnual: 0,
        porMes: Object.fromEntries([...Array(12)].map((_, i) => [`mes${String(i + 1).padStart(2, '0')}`, 0]))
      });
    }
    const a = acumMap.get(key);
    a.importeAnual = round2(a.importeAnual + importe);
    a.gravadoAnual = round2(a.gravadoAnual + gravado);
    a.exentoAnual = round2(a.exentoAnual + exento);
    const mk = `mes${String(mes).padStart(2, '0')}`;
    a.porMes[mk] = round2(a.porMes[mk] + importe);
  }

  for (const emp of EMPLEADOS) {
    for (const week of weeks) {
      const m = montosPara(emp, week);
      histRows.push({
        numEmpleado: emp.numEmpleado,
        anio: week.anio,
        numeroPeriodo: week.n,
        tipoPeriodo: 'semanal',
        fechaInicio: week.ini,
        fechaFin: week.fin,
        netoPagar: m.neto,
        percepciones: m.percepciones,
        deducciones: m.deducciones,
        diasLaborados: m.diasLaborados,
        diasPagados: m.diasPagados
      });

      // Desglose aproximado para acumulados (ISR ~70% de deducciones, IMSS el resto)
      const isr = round2(m.deducciones * 0.72);
      const imss = round2(m.deducciones - isr);
      const sueldo = round2(m.percepciones * 0.92);
      const otrosPerc = round2(m.percepciones - sueldo);

      bump(emp.numEmpleado, 'SUELDO', week.mes, sueldo, sueldo, 0);
      bump(emp.numEmpleado, 'PREMIO_ASISTENCIA', week.mes, otrosPerc, otrosPerc, 0);
      bump(emp.numEmpleado, 'ISR', week.mes, isr, 0, 0);
      bump(emp.numEmpleado, 'IMSS_OBRERO', week.mes, imss, 0, 0);
      bump(emp.numEmpleado, 'PERCEPCIONES_GRAVADAS', week.mes, m.percepciones, m.percepciones, 0);
      bump(emp.numEmpleado, 'DEDUCCIONES_TOTALES', week.mes, m.deducciones, 0, 0);
      bump(emp.numEmpleado, 'NETO_PAGAR', week.mes, m.neto, 0, 0);
    }
  }

  const histHeaders = [
    'numEmpleado',
    'anio',
    'numeroPeriodo',
    'tipoPeriodo',
    'fechaInicio',
    'fechaFin',
    'netoPagar',
    'percepciones',
    'deducciones',
    'diasLaborados',
    'diasPagados'
  ];
  const histCsv = toCsv(histHeaders, histRows);

  const acumHeaders = [
    'numEmpleado',
    'anio',
    'conceptoCodigo',
    'importeAnual',
    'gravadoAnual',
    'exentoAnual',
    'mes01',
    'mes02',
    'mes03',
    'mes04',
    'mes05',
    'mes06',
    'mes07',
    'mes08',
    'mes09',
    'mes10',
    'mes11',
    'mes12'
  ];
  const acumRows = [...acumMap.values()].map((a) => ({
    numEmpleado: a.numEmpleado,
    anio: a.anio,
    conceptoCodigo: a.conceptoCodigo,
    importeAnual: a.importeAnual,
    gravadoAnual: a.gravadoAnual,
    exentoAnual: a.exentoAnual,
    ...a.porMes
  }));
  const acumCsv = toCsv(acumHeaders, acumRows);

  const histPath = path.join(OUT_DIR, 'historico_recibos_semanal_2026_ene-jun.csv');
  const acumPath = path.join(OUT_DIR, 'acumulados_2026_ene-jun.csv');
  const resumenPath = path.join(OUT_DIR, 'resumen_historicos_fake.json');

  fs.writeFileSync(histPath, histCsv, 'utf8');
  fs.writeFileSync(acumPath, acumCsv, 'utf8');
  fs.writeFileSync(
    resumenPath,
    JSON.stringify(
      {
        rango: { desde: '2026-01-01', hasta: '2026-06-20' },
        tipoPeriodo: 'semanal',
        periodos: weeks.length,
        empleados: EMPLEADOS.map((e) => e.numEmpleado),
        filasHistorico: histRows.length,
        filasAcumulados: acumRows.length,
        archivos: {
          historico: path.basename(histPath),
          acumulados: path.basename(acumPath)
        },
        nota:
          'Histórico: dry-run en /config-empresa/cargas/historico_recibos. Acumulados: validar+aplicar en /config-empresa/cargas/acumulados.'
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Semanas: ${weeks.length}`);
  console.log(`Histórico: ${histRows.length} filas → ${histPath}`);
  console.log(`Acumulados: ${acumRows.length} filas → ${acumPath}`);
  console.log(`Resumen: ${resumenPath}`);
}

main();
