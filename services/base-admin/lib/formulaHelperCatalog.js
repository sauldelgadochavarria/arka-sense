'use strict';

/**
 * Catálogo de ayuda para editores de funciones de fórmula (admin / referencia).
 * Lee Mongo config compartido con base-saas.
 */

const FORMULA_FN_COLLECTION =
  process.env.BASE_COLLECTION_FORMULA_FUNCTIONS || 'nomina_formula_functions';
const SYSTEM_ENUMS_COLLECTION =
  process.env.BASE_COLLECTION_SYSTEM_ENUMS || 'system_enums';
const PARAMS_COLLECTION =
  process.env.BASE_COLLECTION_PARAMETROS_GENERALES || 'parametros_generales';

/** Insumos / args frecuentes en scripts de nómina (no viven en enums). */
const ARGS_COMUNES = [
  { key: 'sueldoDiario', label: 'Sueldo diario', descripcion: 'SDI / salario diario del empleado' },
  { key: 'sueldo', label: 'Sueldo (alias)', descripcion: 'Alias frecuente de sueldoDiario en scripts' },
  { key: 'diasLaborados', label: 'Días laborados', descripcion: 'Días trabajados / pagados del período' },
  { key: 'dias', label: 'Días (alias)', descripcion: 'Alias de diasLaborados' },
  { key: 'diasPeriodo', label: 'Días del período', descripcion: 'Calendario del período (ej. 14/15)' },
  { key: 'porcentajeFondoAhorro', label: '% fondo ahorro', descripcion: 'Porcentaje del empleado o parámetro' },
  { key: 'porc', label: '% (alias)', descripcion: 'Alias corto de porcentaje' },
  { key: 'aplicaFondoAhorro', label: 'Aplica fondo (0/1)', descripcion: '1 si el empleado tiene fondo' },
  { key: 'fondoAhorroTopeExento', label: 'Tope exento fondo', descripcion: 'Insumo precalculado del motor' },
  { key: 'fondoAhorroEmpresa', label: 'Aportación empresa', descripcion: 'Mitad de la aportación' },
  { key: 'uma', label: 'UMA diaria', descripcion: 'Parámetro fiscal vigente' }
];

const HELPERS_SANDBOX_JS = [
  { key: 'si', label: 'si(cond, a, b)', descripcion: 'Helper en sandbox JS' },
  { key: 'redondear', label: 'redondear(x, n?)', descripcion: 'Redondeo a n decimales (default 2)' },
  { key: 'min', label: 'min(…)', descripcion: 'Math.min' },
  { key: 'max', label: 'max(…)', descripcion: 'Math.max' },
  { key: 'abs', label: 'abs(x)', descripcion: 'Math.abs' },
  { key: 'Math', label: 'Math.*', descripcion: 'Objeto Math estándar' }
];

async function loadFormulaHelperCatalog(mongooseConnection) {
  const db = mongooseConnection.db;

  const [enumDocs, fnDocs, paramDocs] = await Promise.all([
    db
      .collection(SYSTEM_ENUMS_COLLECTION)
      .find({
        grupo: { $in: ['formula_context_vars', 'formula_functions'] },
        activo: { $ne: false }
      })
      .project({ grupo: 1, nombre: 1, items: 1 })
      .toArray(),
    db
      .collection(FORMULA_FN_COLLECTION)
      .find({
        activo: { $ne: false },
        $or: [{ tipo: 'nativa' }, { estado: 'publicado' }, { estado: { $exists: false } }]
      })
      .project({
        name: 1,
        signature: 1,
        descripcion: 1,
        ejemplo: 1,
        tipo: 1,
        args: 1
      })
      .sort({ name: 1 })
      .toArray(),
    db
      .collection(PARAMS_COLLECTION)
      .find({})
      .project({ clave: 1, valor: 1, descripcion: 1, vigenciaDesde: 1 })
      .sort({ clave: 1, vigenciaDesde: -1 })
      .limit(80)
      .toArray()
  ]);

  const byGrupo = Object.fromEntries(enumDocs.map((e) => [e.grupo, e]));

  const contextVars = (byGrupo.formula_context_vars?.items || [])
    .filter((it) => it.activo !== false)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .map((it) => ({
      key: it.value,
      label: it.label || it.value,
      descripcion: it.descripcion || '',
      grupo: it.meta?.namespace || 'contexto'
    }));

  const seenParam = new Set();
  const parametros = [];
  for (const p of paramDocs) {
    const clave = p.clave;
    if (!clave || seenParam.has(clave)) continue;
    seenParam.add(clave);
    parametros.push({
      key: clave,
      label: clave,
      descripcion: p.descripcion || `Valor: ${p.valor}`,
      valor: p.valor
    });
  }

  const funciones = fnDocs.map((f) => ({
    key: f.name,
    label: f.signature || `${f.name}(…)`,
    descripcion: f.descripcion || f.tipo || '',
    tipo: f.tipo,
    ejemplo: f.ejemplo || '',
    args: f.args || []
  }));

  return {
    argsComunes: ARGS_COMUNES,
    helpersSandbox: HELPERS_SANDBOX_JS,
    contextVars,
    parametros,
    funciones,
    notaJs:
      'En el cuerpo JS solo existen los argumentos que declares y los helpers del sandbox (si, redondear, Math…). Las variables de contexto (INCIDENCIAS.*, etc.) hay que pasarlas como argumentos si las necesitas.'
  };
}

module.exports = {
  loadFormulaHelperCatalog,
  ARGS_COMUNES,
  HELPERS_SANDBOX_JS
};
