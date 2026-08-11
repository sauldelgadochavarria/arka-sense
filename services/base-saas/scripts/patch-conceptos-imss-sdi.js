'use strict';

/**
 * Corrige fiscal IMSS/SDI/INFONAVIT (+ ISR donde aplica) en conceptos del tenant.
 *
 *   node scripts/patch-conceptos-imss-sdi.js [tenantSlug]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const dbConfig = require('../config/db');
const { emptyImssDesglose } = require('../models/fiscalConceptoShared');

function imssExcluido() {
  return {
    naturalezaSdi: 'excluido',
    desglose: emptyImssDesglose({ modo: 'todo_excluye' })
  };
}

function imssFijo() {
  return {
    naturalezaSdi: 'fijo',
    desglose: emptyImssDesglose({ modo: 'todo_integra' })
  };
}

function imssVariable(desglose = {}) {
  return {
    naturalezaSdi: 'variable',
    desglose: emptyImssDesglose({ modo: 'todo_integra', ...desglose })
  };
}

/** Parches por código. Campos opcionales: integraISR, desglose, naturaleza, integraINFONAVIT */
const PATCHES = {
  // --- Salario fijo ---
  SUELDO: {
    integraIMSS: true,
    integraINFONAVIT: true,
    integraISR: true,
    imss: imssFijo()
  },
  SALARIO_PERIODO: {
    integraIMSS: true,
    integraINFONAVIT: true,
    integraISR: true,
    imss: imssFijo()
  },

  // --- Ya en factor / excluidos LSS ---
  AGUINALDO: {
    naturaleza: 'mixto',
    integraISR: true,
    integraIMSS: false,
    integraINFONAVIT: false,
    desglose: { modo: 'regla_ley', topeExentoUMA: 30, codigoRegla: 'aguinaldo' },
    imss: imssExcluido()
  },
  FINIQUITO_AGUINALDO: {
    naturaleza: 'mixto',
    integraISR: true,
    integraIMSS: false,
    integraINFONAVIT: false,
    desglose: { modo: 'regla_ley', topeExentoUMA: 30, codigoRegla: 'aguinaldo' },
    imss: imssExcluido()
  },
  PRIMA_VACACIONAL: {
    naturaleza: 'mixto',
    integraISR: true,
    integraIMSS: false,
    integraINFONAVIT: false,
    desglose: { modo: 'regla_ley', topeExentoUMA: 15, codigoRegla: 'prima_vacacional' },
    imss: imssExcluido()
  },
  PTU: {
    naturaleza: 'mixto',
    integraISR: true,
    integraIMSS: false,
    integraINFONAVIT: false,
    desglose: { modo: 'regla_ley', topeExentoUMA: 15, codigoRegla: 'ptu' },
    imss: imssExcluido()
  },
  INDEMNIZACION_90_DIAS: {
    integraISR: true,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  SUBSIDIO_EMPLEO: {
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    naturaleza: 'informativo',
    desglose: { modo: 'todo_exento' },
    imss: imssExcluido()
  },
  FONDO_AHORRO_EMPRESA: {
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  FONDO_AHORRO_TRABAJADOR: {
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  FINIQUITO_FONDO_AHORRO: {
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },

  // --- HE / premios ---
  HORAS_EXTRA_DOBLES: {
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  HE_PRENOMINA: {
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  HORAS_EXTRA_TRIPLES: {
    integraIMSS: true,
    integraINFONAVIT: false,
    imss: imssVariable()
  },
  SEPTIMO_DIA: {
    integraISR: true,
    integraIMSS: true,
    integraINFONAVIT: true,
    imss: imssFijo()
  },
  PRIMA_DOMINICAL: {
    naturaleza: 'mixto',
    integraISR: true,
    integraIMSS: true,
    integraINFONAVIT: false,
    desglose: { modo: 'regla_ley', topeExentoUMA: 1, codigoRegla: 'prima_dominical' },
    imss: imssVariable()
  },
  PREMIO_ASISTENCIA: {
    integraIMSS: true,
    integraINFONAVIT: false,
    imss: imssVariable({
      modo: 'regla_ley',
      topeNoIntegraPctSbc: 10,
      codigoRegla: 'premio_10_sbc'
    })
  },
  PREMIO_PUNTUALIDAD: {
    integraIMSS: true,
    integraINFONAVIT: false,
    imss: imssVariable({
      modo: 'regla_ley',
      topeNoIntegraPctSbc: 10,
      codigoRegla: 'premio_10_sbc'
    })
  },

  // --- Deducciones / motores (nunca integran SBC) ---
  RETARDOS: { integraISR: false, integraIMSS: false, integraINFONAVIT: false, imss: imssExcluido() },
  FALTAS: { integraISR: false, integraIMSS: false, integraINFONAVIT: false, imss: imssExcluido() },
  SALIDA_ANTICIPADA: {
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  ISR: {
    naturaleza: 'fiscal',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  IMSS_OBRERO: {
    naturaleza: 'fiscal',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  IMSS_PATRONAL: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  INFONAVIT: {
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  DED_FONDO_AHORRO: {
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  DED_FONDO_AHORRO_EMPRESA: {
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  ISR_SAT: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  ISR_PROYECTADO: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  ISR_AJUSTADO: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  ISR_DIFERENCIA: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  PERCEPCIONES_GRAVADAS: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  DEDUCCIONES_TOTALES: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  },
  NETO_PAGAR: {
    naturaleza: 'informativo',
    integraISR: false,
    integraIMSS: false,
    integraINFONAVIT: false,
    imss: imssExcluido()
  }
};

(async () => {
  await mongoose.connect(dbConfig.connectionStringConfig || 'mongodb://localhost:27020/config');
  const slug = process.argv[2] || 'empresa-demo';
  const tenant = await mongoose.connection.collection('tenants').findOne({ slug });
  if (!tenant) throw new Error('Tenant no encontrado: ' + slug);
  const col = mongoose.connection.collection('nomina_conceptos');

  let n = 0;
  const missing = [];
  for (const [codigo, p] of Object.entries(PATCHES)) {
    const $set = {
      'fiscal.integraIMSS': p.integraIMSS,
      'fiscal.integraINFONAVIT': p.integraINFONAVIT === true,
      'fiscal.imss': p.imss,
      'metadata.esVariableSdi': p.imss.naturalezaSdi === 'variable',
      'metadata.naturalezaSdi': p.imss.naturalezaSdi
    };
    if (p.integraISR !== undefined) $set['fiscal.integraISR'] = p.integraISR;
    if (p.naturaleza) {
      $set.naturaleza = p.naturaleza;
      $set['fiscal.naturaleza'] = p.naturaleza;
    }
    if (p.desglose) {
      $set['fiscal.desglose.modo'] = p.desglose.modo;
      if (p.desglose.codigoRegla != null) $set['fiscal.desglose.codigoRegla'] = p.desglose.codigoRegla;
      if (p.desglose.topeExentoUMA != null) {
        $set['fiscal.desglose.topeExentoUMA'] = p.desglose.topeExentoUMA;
      }
    }

    const r = await col.updateOne({ tenantId: tenant.tenantId, codigo }, { $set });
    if (r.matchedCount) {
      n += 1;
      console.log(
        'OK',
        codigo,
        'IMSS=' + p.integraIMSS,
        'SDI=' + p.imss.naturalezaSdi,
        'INF=' + (p.integraINFONAVIT === true)
      );
    } else {
      missing.push(codigo);
    }
  }

  if (missing.length) console.log('no encontrados:', missing.join(', '));
  console.log('patched', n, '/', Object.keys(PATCHES).length);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
