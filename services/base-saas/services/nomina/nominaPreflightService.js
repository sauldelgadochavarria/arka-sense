'use strict';

const getFormulaConceptoModel = require('../../models/formulaConcepto');
const getConceptoNominaModel = require('../../models/conceptoNomina');
const getEmpleadoModel = require('../../models/empleado');
const getPayrollPeriodModel = require('../../models/payrollPeriod');
const getCatalogoSatModel = require('../../models/catalogoSat');
const { obtenerParametrosVigentes, obtenerTablaVigente } = require('./tablasFiscalesService');
const { obtenerFormulasVigentes } = require('./calculoNominaService');

async function validarClavesSat(conceptos, fechaRef) {
  const CatalogoSat = await getCatalogoSatModel();
  const advertencias = [];
  const ref = new Date(fechaRef);

  for (const c of conceptos) {
    const clave = c.sat?.clave || c.claveSAT;
    if (!clave) continue;
    const tipoSat = c.sat?.tipo || c.tipo;
    const catalogo =
      tipoSat === 'deduccion'
        ? 'c_TipoDeduccion'
        : tipoSat === 'otro_pago'
          ? 'c_TipoOtroPago'
          : 'c_TipoPercepcion';

    const existe = await CatalogoSat.findOne({
      catalogo,
      clave,
      activo: true,
      vigenciaDesde: { $lte: ref },
      $or: [{ vigenciaHasta: null }, { vigenciaHasta: { $gte: ref } }]
    }).lean();

    if (!existe) {
      advertencias.push({
        codigo: c.codigo,
        clave,
        catalogo,
        mensaje: `Clave SAT ${clave} no encontrada en ${catalogo}`
      });
    }
  }
  return advertencias;
}

async function validatePeriodoForCalculo(tenantId, periodo) {
  const bloqueos = [];
  const advertencias = [];

  if (periodo.estatus === 'calculando') {
    bloqueos.push({ codigo: 'CALCULANDO', mensaje: 'Hay un cálculo en curso. Espera a que termine.' });
  }

  const formulas = await obtenerFormulasVigentes(tenantId, periodo);
  if (!formulas.length) {
    bloqueos.push({
      codigo: 'SIN_FORMULAS',
      mensaje: `No hay fórmulas vigentes para ${periodo.tipoPeriodo} / ${periodo.tipoNomina}`
    });
  }

  const parametros = await obtenerParametrosVigentes(periodo.fechaInicio);
  if (!parametros.uma) {
    bloqueos.push({ codigo: 'SIN_UMA', mensaje: 'Falta parámetro UMA vigente. Ejecuta seed:nomina-fiscal.' });
  }

  const ConceptoNomina = await getConceptoNominaModel();
  const conceptosActivos = await ConceptoNomina.find({ tenantId, activo: true }).lean();

  const usaIsr = conceptosActivos.some((c) => c.codigo === 'ISR');
  if (usaIsr) {
    const { codigoTablaIsrParaPeriodo } = require('../../config/isrTablas2026');
    const codigoIsr = codigoTablaIsrParaPeriodo(periodo.tipoPeriodo);
    const tablaIsr = await obtenerTablaVigente(codigoIsr, periodo.fechaInicio);
    if (!tablaIsr) {
      bloqueos.push({
        codigo: 'SIN_TABLA_ISR',
        mensaje: `Concepto ISR activo pero no hay tabla ${codigoIsr} vigente. Ejecuta seed:nomina-fiscal.`
      });
    }
  }

  const usaImssObrero = conceptosActivos.some((c) => c.codigo === 'IMSS_OBRERO');
  if (usaImssObrero) {
    const tablaImss = await obtenerTablaVigente('IMSS_CUOTAS', periodo.fechaInicio);
    if (!tablaImss) {
      const legado = await obtenerTablaVigente('IMSS_OBRERO', periodo.fechaInicio);
      if (!legado) {
        advertencias.push({
          codigo: 'SIN_TABLA_IMSS',
          mensaje:
            'Sin tabla IMSS_CUOTAS vigente: se usará tasa fallback. Ejecuta seed:nomina-fiscal.'
        });
      }
    }
  }

  const usaImssPatronal = conceptosActivos.some((c) => c.codigo === 'IMSS_PATRONAL');
  if (usaImssPatronal) {
    const tablaPat = await obtenerTablaVigente('IMSS_CUOTAS', periodo.fechaInicio);
    if (!tablaPat) {
      advertencias.push({
        codigo: 'SIN_TABLA_IMSS_PATRONAL',
        mensaje: 'Sin IMSS_CUOTAS vigente para imssPatronal(). Ejecuta seed:nomina-fiscal.'
      });
    }
  }

  const Empleado = await getEmpleadoModel();
  const empleados = await Empleado.find({ tenantId, activo: true, estatus: 'activo' }).lean();
  if (!empleados.length) {
    bloqueos.push({ codigo: 'SIN_EMPLEADOS', mensaje: 'No hay empleados activos' });
  }

  const sinSalario = empleados
    .filter((e) => e.salarioDiario == null || e.salarioDiario <= 0)
    .map((e) => ({
      _id: e._id,
      numEmpleado: e.numEmpleado,
      nombre: `${e.firstName} ${e.lastName}`.trim()
    }));

  if (sinSalario.length === empleados.length && empleados.length > 0) {
    bloqueos.push({
      codigo: 'SIN_SALARIOS',
      mensaje: 'Ningún empleado activo tiene salario diario configurado'
    });
  } else if (sinSalario.length) {
    advertencias.push({
      codigo: 'EMPLEADOS_SIN_SALARIO',
      mensaje: `${sinSalario.length} empleado(s) sin salario diario (se omitirán en cálculo)`,
      detalle: sinSalario
    });
  }

  if (periodo.payrollPeriodId) {
    const PayrollPeriod = await getPayrollPeriodModel();
    const pre = await PayrollPeriod.findOne({ tenantId, _id: periodo.payrollPeriodId }).lean();
    if (!pre) {
      advertencias.push({
        codigo: 'PRENOMINA_NO_ENCONTRADA',
        mensaje: 'El período de pre-nómina vinculado ya no existe'
      });
    } else if (pre.estatus === 'abierto') {
      advertencias.push({
        codigo: 'PRENOMINA_ABIERTA',
        mensaje: 'La pre-nómina vinculada aún está abierta; calcula y cierra pre-nómina para mejores insumos'
      });
    } else {
      try {
        const { validateJornadaForPeriod } = require('../payrollPreflightService');
        const jornada = await validateJornadaForPeriod(pre, tenantId);
        for (const a of jornada.advertencias || []) {
          advertencias.push({ ...a, codigo: `JORNADA_${a.codigo}` });
        }
        for (const b of jornada.bloqueos || []) {
          bloqueos.push({ ...b, codigo: `JORNADA_${b.codigo}`, httpStatus: 422 });
        }
      } catch (err) {
        advertencias.push({
          codigo: 'JORNADA_PREFLIGHT_ERROR',
          mensaje: `No se pudo validar jornada: ${err.message}`
        });
      }
    }
  }

  const satAdvertencias = await validarClavesSat(conceptosActivos, periodo.fechaInicio);
  for (const s of satAdvertencias) {
    advertencias.push({ codigo: 'SAT_CLAVE', mensaje: s.mensaje, detalle: s });
  }

  return {
    ok: bloqueos.length === 0,
    bloqueos,
    advertencias,
    httpStatus: bloqueos.length ? 422 : 200,
    resumen: {
      formulas: formulas.length,
      conceptosActivos: conceptosActivos.length,
      empleadosActivos: empleados.length,
      empleadosCalculables: empleados.length - sinSalario.length
    }
  };
}

module.exports = { validatePeriodoForCalculo, validarClavesSat };
