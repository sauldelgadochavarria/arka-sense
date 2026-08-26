'use strict';

const { PLANTILLA_PDF_CFDI } = require('./reciboPdfPlantillaCfdi');

/** Defaults SW Sapien (producción) y catálogo de variables de plantilla PDF. */

const PAC_PROVEEDORES = ['SW Sapien', 'Otro'];

const PAC_SW_DEFAULTS = {
  proveedor: 'SW Sapien',
  ambiente: '1',
  formato: 'JSON',
  urlAuth: 'https://services.sw.com.mx/v2/security/authenticate',
  urlTimbrado: 'https://services.sw.com.mx/v3/cfdi33/issue/json/v4',
  urlTimbradoXml: 'https://services.sw.com.mx/cfdi33/issue/v4',
  urlCancelacion: 'https://services.sw.com.mx/cfdi33/cancel/csd',
  urlConsulta: 'https://services.sw.com.mx/cfdi33/status',
  timeout: 30,
  reintentos: 3,
  serieDefault: 'TST',
  rfcSatTest: 'IIA040805DZ4',
  nombreSatTest: 'INDUSTRIA ILUMINADORA DE ALMACENES',
  templateIngreso: '129',
  templateEgreso: '131',
  templatePago: '110',
  templateTraslado: '158'
};

/** URLs ambiente de pruebas SW (credenciales distintas a producción). */
const PAC_SW_TEST_URLS = {
  urlAuth: 'https://services.test.sw.com.mx/v2/security/authenticate',
  urlTimbrado: 'https://services.test.sw.com.mx/v3/cfdi33/issue/json/v4',
  urlTimbradoXml: 'https://services.test.sw.com.mx/cfdi33/issue/v4',
  urlCancelacion: 'https://services.test.sw.com.mx/cfdi33/cancel/csd',
  urlConsulta: 'https://services.test.sw.com.mx/cfdi33/status'
};

const RECIBO_PDF_VARIABLES = [
  { path: 'empresa.razonSocial', seccion: 'empresa' },
  { path: 'empresa.rfc', seccion: 'empresa' },
  { path: 'empresa.registroPatronal', seccion: 'empresa' },
  { path: 'empresa.domicilio', seccion: 'empresa' },
  { path: 'empresa.regimenFiscal', seccion: 'empresa' },
  { path: 'empresa.expedidoEn', seccion: 'empresa' },
  { path: 'empleado.numEmpleado', seccion: 'empleado' },
  { path: 'empleado.nombre', seccion: 'empleado' },
  { path: 'empleado.rfc', seccion: 'empleado' },
  { path: 'empleado.curp', seccion: 'empleado' },
  { path: 'empleado.nss', seccion: 'empleado' },
  { path: 'empleado.departamento', seccion: 'empleado' },
  { path: 'empleado.centroCosto', seccion: 'empleado' },
  { path: 'empleado.puesto', seccion: 'empleado' },
  { path: 'empleado.domicilio', seccion: 'empleado' },
  { path: 'empleado.sdi', seccion: 'empleado' },
  { path: 'empleado.sbc', seccion: 'empleado' },
  { path: 'empleado.salarioDiario', seccion: 'empleado' },
  { path: 'empleado.banco', seccion: 'empleado' },
  { path: 'empleado.cuenta', seccion: 'empleado' },
  { path: 'empleado.antiguedad', seccion: 'empleado' },
  { path: 'periodo.tipoPeriodo', seccion: 'periodo' },
  { path: 'periodo.tipoNominaLabel', seccion: 'periodo' },
  { path: 'periodo.numeroPeriodo', seccion: 'periodo' },
  { path: 'periodo.fechaInicio', seccion: 'periodo' },
  { path: 'periodo.fechaFin', seccion: 'periodo' },
  { path: 'periodo.fechaPago', seccion: 'periodo' },
  { path: 'periodo.periodicidadPago', seccion: 'periodo' },
  { path: 'recibo.totalPercepciones', seccion: 'recibo' },
  { path: 'recibo.totalDeducciones', seccion: 'recibo' },
  { path: 'recibo.totalOtrosPagos', seccion: 'recibo' },
  { path: 'recibo.netoPagar', seccion: 'recibo' },
  { path: 'recibo.diasPagados', seccion: 'recibo' },
  { path: 'recibo.cantidadLetra', seccion: 'recibo' },
  { path: 'recibo.subsidioEmpleo', seccion: 'recibo' },
  { path: 'cfdi.uuid', seccion: 'cfdi' },
  { path: 'cfdi.serie', seccion: 'cfdi' },
  { path: 'cfdi.folio', seccion: 'cfdi' },
  { path: 'cfdi.fecha', seccion: 'cfdi' },
  { path: 'cfdi.qrUrl', seccion: 'cfdi' },
  { path: '#percepciones / #deducciones / #otrosPagos / #conceptos', seccion: 'bloques' }
];

/** Layout CFDI 4.0 / Nómina 1.2 (representación impresa). */
const PLANTILLA_PDF_EJEMPLO = PLANTILLA_PDF_CFDI;

function pacAmbienteEsPrueba(ambiente) {
  return String(ambiente) === '0';
}

function isSwTestHost(url) {
  return /services\.test\.sw\.com\.mx/i.test(String(url || ''));
}

function isSwProdHost(url) {
  const s = String(url || '');
  return /services\.sw\.com\.mx/i.test(s) && !/services\.test\./i.test(s);
}

function swUrlsForAmbiente(ambiente) {
  if (pacAmbienteEsPrueba(ambiente)) return { ...PAC_SW_TEST_URLS };
  return {
    urlAuth: PAC_SW_DEFAULTS.urlAuth,
    urlTimbrado: PAC_SW_DEFAULTS.urlTimbrado,
    urlTimbradoXml: PAC_SW_DEFAULTS.urlTimbradoXml,
    urlCancelacion: PAC_SW_DEFAULTS.urlCancelacion,
    urlConsulta: PAC_SW_DEFAULTS.urlConsulta
  };
}

/** Alinea URLs SW con ambiente 0/1 al guardar PAC. */
function syncSwPacUrls(payload) {
  if (!payload || payload.proveedor !== 'SW Sapien') return payload;
  return { ...payload, ...swUrlsForAmbiente(payload.ambiente) };
}

function validateSwPacAmbiente(pac) {
  if (!pac || pac.proveedor !== 'SW Sapien') return null;
  const esPrueba = pacAmbienteEsPrueba(pac.ambiente);
  if (esPrueba && isSwProdHost(pac.urlAuth)) {
    return (
      'Ambiente de pruebas (0) pero URL Auth apunta a producción (services.sw.com.mx). ' +
      'Las credenciales de sandbox no autentican ahí (AU2000). Guarde el PAC de nuevo o use services.test.sw.com.mx.'
    );
  }
  if (!esPrueba && isSwTestHost(pac.urlAuth)) {
    return 'Ambiente producción (1) pero URL Auth apunta a pruebas (services.test.sw.com.mx).';
  }
  if (!pac.password) {
    return 'Contraseña PAC vacía. Ingrese la contraseña en el formulario y guarde.';
  }
  return null;
}

module.exports = {
  PAC_PROVEEDORES,
  PAC_SW_DEFAULTS,
  PAC_SW_TEST_URLS,
  RECIBO_PDF_VARIABLES,
  PLANTILLA_PDF_EJEMPLO,
  pacAmbienteEsPrueba,
  isSwTestHost,
  isSwProdHost,
  swUrlsForAmbiente,
  syncSwPacUrls,
  validateSwPacAmbiente
};
