const express = require('express');
const { isUserAllowed } = require('../middleware/authMiddleware');
const loadMenus = require('../middleware/menuMiddleware');
const usersController = require('../controllers/usersController');
const rolesController = require('../controllers/rolesController');
const subsidiariasController = require('../controllers/subsidiariasController');
const empresaController = require('../controllers/empresaController');
const cargasInicialesController = require('../controllers/cargasInicialesController');
const departamentosController = require('../controllers/departamentosController');
const puestosController = require('../controllers/puestosController');
const empleadosController = require('../controllers/empleadosController');
const historialLaboralController = require('../controllers/historialLaboralController');
const ajusteAnualController = require('../controllers/ajusteAnualController');
const tipoPeriodoNominaController = require('../controllers/tipoPeriodoNominaController');
const periodoAdministracionController = require('../controllers/periodoAdministracionController');
const centroCostoController = require('../controllers/centroCostoController');
const movimientoAsistenciaNominaController = require('../controllers/movimientoAsistenciaNominaController');
const turnosController = require('../controllers/turnosController');
const marcacionesController = require('../controllers/marcacionesController');
const asistenciaDiariaController = require('../controllers/asistenciaDiariaController');
const registroJornadaController = require('../controllers/registroJornadaController');
const incidenciasController = require('../controllers/incidenciasController');
const vacacionesController = require('../controllers/vacacionesController');
const portalController = require('../controllers/portalController');
const prenominaController = require('../controllers/prenominaController');
const nominaController = require('../controllers/nominaController');
const nominaPlaceholderController = require('../controllers/nominaPlaceholderController');
const nominaCatalogosController = require('../controllers/nominaCatalogosController');
const systemConfigController = require('../controllers/systemConfigController');
const integracionesController = require('../controllers/integracionesController');
const dispositivosController = require('../controllers/dispositivosController');
const gruposDispositivosController = require('../controllers/gruposDispositivosController');
const rotacionesController = require('../controllers/rotacionesController');
const reportesController = require('../controllers/reportesController');
const nominaReportesController = require('../controllers/nominaReportesController');
const suaExportController = require('../controllers/suaExportController');
const confrontaImssController = require('../controllers/confrontaImssController');
const ayudaController = require('../controllers/ayudaController');
const { getDashboardKpis } = require('../services/dashboardKpiService');
const { tableroCumplimiento } = require('../services/gestionDocumentalService');
const { getFlujoNominaActual } = require('../services/flujoNominaDashboardService');
const { tenantHasFeature } = require('../libs/tenantFeatureFlags');
const { requireEmpresaForTenant } = require('../libs/tenantScope');
const { requirePortalEmpleado } = require('../middleware/requirePortalEmpleado');
const { requireAdminAccess } = require('../middleware/requireAdminAccess');
const { requireReportesAccess } = require('../middleware/requireReportesAccess');

const router = express.Router();

router.use(isUserAllowed, loadMenus);

router.get('/portal', requirePortalEmpleado, portalController.portalHome);
router.get('/portal/asistencia', requirePortalEmpleado, portalController.portalAsistencia);
router.get('/portal/solicitudes', requirePortalEmpleado, portalController.portalSolicitudes);
router.get('/portal/solicitudes/nueva', requirePortalEmpleado, portalController.portalNuevaSolicitud);
router.post('/portal/solicitudes', requirePortalEmpleado, portalController.portalCrearSolicitud);
router.get('/portal/vacaciones', requirePortalEmpleado, portalController.portalVacaciones);

router.use(requireAdminAccess);

router.get(['/', '/dashboard', '/inicio'], async (req, res) => {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const kpis = empresa ? await getDashboardKpis(req.session.tenantId) : null;
  const featureFlags = req.tenant?.featureFlags || req.session?.featureFlags || {};
  const hasNomina = tenantHasFeature(featureFlags, 'nomina');
  let cumplimiento = null;
  let flujoNomina = null;
  if (empresa && tenantHasFeature(featureFlags, 'gestion_documental')) {
    try {
      const full = await tableroCumplimiento({
        tenantId: req.session.tenantId,
        empresaId: empresa._id
      });
      const nomina = (full.filas || []).filter((f) => f.procesoCodigo === 'NOMINA').slice(0, 1);
      const resto = (full.filas || []).filter((f) => f.procesoCodigo !== 'NOMINA');
      cumplimiento = { ...full, filas: [...nomina, ...resto] };
    } catch (err) {
      console.warn('[dashboard cumplimiento]', err.message);
    }
  }
  if (empresa) {
    try {
      flujoNomina = await getFlujoNominaActual({
        tenantId: req.session.tenantId,
        empresaId: empresa._id,
        hasNomina
      });
    } catch (err) {
      console.warn('[dashboard flujo]', err.message);
    }
  }
  res.render('dashboard', {
    session: req.session,
    tenant: req.tenant,
    menuTree: res.locals.menuTree,
    featureFlags,
    kpis,
    cumplimiento,
    flujoNomina
  });
});

router.get('/config-users', usersController.listUsers);
router.post('/config-users', usersController.createUser);
router.get('/config-users/:id/edit', usersController.editUser);
router.post('/config-users/:id', usersController.updateUser);
router.post('/config-users/:id/toggle', usersController.toggleUser);

router.get('/config-roles', rolesController.listRoles);
router.post('/config-roles', rolesController.createRole);

router.get('/config-empresa', empresaController.showEmpresa);
router.post('/config-empresa', empresaController.updateEmpresa);
router.get('/config-empresa/cargas', cargasInicialesController.index);
router.get('/config-empresa/cargas/creditos-saldos', cargasInicialesController.proximamenteCreditos);
router.get('/config-empresa/cargas/jobs/:id', cargasInicialesController.showJob);
router.post('/config-empresa/cargas/jobs/:id/aplicar', cargasInicialesController.applyJobAction);
router.get('/config-empresa/cargas/:tipo/plantilla.csv', cargasInicialesController.downloadTemplate);
router.get('/config-empresa/cargas/:tipo', cargasInicialesController.showTipo);
router.post('/config-empresa/cargas/:tipo/validar', cargasInicialesController.dryRun);

router.get('/config-subsidiarias', subsidiariasController.listSubsidiarias);
router.post('/config-subsidiarias', subsidiariasController.createSubsidiaria);
router.get('/config-subsidiarias/:id/edit', subsidiariasController.editSubsidiaria);
router.post('/config-subsidiarias/:id', subsidiariasController.updateSubsidiaria);
router.post('/config-subsidiarias/:id/toggle', subsidiariasController.toggleSubsidiaria);

router.get('/config-sistema/enums', systemConfigController.listEnums);
router.get('/config-sistema/enums/:grupo', systemConfigController.editEnum);
router.post('/config-sistema/enums/:grupo', systemConfigController.saveEnum);
router.post('/config-sistema/bootstrap-nomina', systemConfigController.bootstrapArquitectura);

router.get('/personal-departamentos', departamentosController.listDepartamentos);
router.get('/personal-departamentos/nuevo', departamentosController.newDepartamento);
router.post('/personal-departamentos', departamentosController.createDepartamento);
router.get('/personal-departamentos/:id/edit', departamentosController.editDepartamento);
router.post('/personal-departamentos/:id', departamentosController.updateDepartamento);
router.post('/personal-departamentos/:id/toggle', departamentosController.toggleDepartamento);

router.get('/personal-puestos', puestosController.listPuestos);
router.post('/personal-puestos', puestosController.createPuesto);
router.get('/personal-puestos/:id/edit', puestosController.editPuesto);
router.post('/personal-puestos/:id', puestosController.updatePuesto);
router.post('/personal-puestos/:id/toggle', puestosController.togglePuesto);

router.get('/personal-empleados', empleadosController.listEmpleados);
router.post('/personal-empleados', empleadosController.createEmpleado);
router.get('/personal-empleados/:id', empleadosController.showEmpleado);
router.get('/personal-empleados/:id/edit', empleadosController.editEmpleado);
router.post('/personal-empleados/:id', empleadosController.updateEmpleado);
router.post('/personal-empleados/:id/baja', empleadosController.bajaEmpleado);
router.post('/personal-empleados/:id/reactivar', empleadosController.reactivarEmpleado);
router.post('/personal-empleados/:id/calcular-sdi', empleadosController.calcularSdiAction);

const tablaPrestacionesController = require('../controllers/tablaPrestacionesController');
const layoutBancarioController = require('../controllers/layoutBancarioController');
const timbradoController = require('../controllers/timbradoController');
const envioCorreoController = require('../controllers/envioCorreoController');
const correoConfigController = require('../controllers/correoConfigController');
const gestionDocumentalController = require('../controllers/gestionDocumentalController');
const finiquitoController = require('../controllers/finiquitoController');
const multer = require('multer');
const uploadDocumentoMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});
router.get('/personal/prestaciones', tablaPrestacionesController.listTablas);
router.get('/personal/prestaciones/nueva', tablaPrestacionesController.newTabla);
router.post('/personal/prestaciones', tablaPrestacionesController.createTabla);
router.post('/personal/prestaciones/seed-global', tablaPrestacionesController.seedGlobal);
router.get('/personal/prestaciones/:id/edit', tablaPrestacionesController.editTabla);
router.post('/personal/prestaciones/:id', tablaPrestacionesController.updateTabla);
router.post('/personal/prestaciones/:id/toggle', tablaPrestacionesController.toggleTabla);

router.get('/nomina/layouts-bancarios', layoutBancarioController.list);
router.get('/nomina/layouts-bancarios/nuevo', layoutBancarioController.newForm);
router.post('/nomina/layouts-bancarios', layoutBancarioController.create);
router.post('/nomina/layouts-bancarios/seed-ejemplo', layoutBancarioController.seedEjemplo);
router.get('/nomina/layouts-bancarios/:id/edit', layoutBancarioController.edit);
router.post('/nomina/layouts-bancarios/:id', layoutBancarioController.update);
router.post('/nomina/layouts-bancarios/:id/toggle', layoutBancarioController.toggle);
router.get('/nomina/layouts-bancarios/:id/preview', layoutBancarioController.preview);

router.get('/nomina/dispersion-bancaria', layoutBancarioController.wizardDispersion);
router.post('/nomina/dispersion-bancaria/generar', layoutBancarioController.generarDispersion);

router.get('/nomina/reportes', nominaReportesController.index);
router.get('/nomina/reportes/export', nominaReportesController.exportCsv);

router.get('/nomina/finiquitos', finiquitoController.list);
router.get('/nomina/finiquitos/nuevo', finiquitoController.newForm);
router.post('/nomina/finiquitos/preview', finiquitoController.preview);
router.post('/nomina/finiquitos', finiquitoController.create);
router.get('/nomina/finiquitos/:id/editar', finiquitoController.editForm);
router.post('/nomina/finiquitos/:id/recalcular', finiquitoController.recalcularAction);
router.post('/nomina/finiquitos/:id/eliminar', finiquitoController.eliminarAction);
router.post('/nomina/finiquitos/:id/emitir-periodo', finiquitoController.emitirPeriodo);
router.get('/nomina/finiquitos/:id', finiquitoController.show);

router.get('/nomina/sua', suaExportController.index);
router.get('/nomina/sua/descargar', suaExportController.download);

router.get('/nomina/confronta', confrontaImssController.index);
router.post('/nomina/confronta', confrontaImssController.index);
router.get('/nomina/confronta/export', confrontaImssController.exportCsv);

router.get('/nomina/pac', timbradoController.listPac);
router.get('/nomina/pac/nuevo', timbradoController.newPacForm);
router.post('/nomina/pac', timbradoController.createPac);
router.post('/nomina/pac/seed-ejemplo', timbradoController.seedPacEjemplo);
router.get('/nomina/pac/:id/edit', timbradoController.editPac);
router.post('/nomina/pac/:id', timbradoController.updatePac);
router.post('/nomina/pac/:id/toggle', timbradoController.togglePac);

router.get('/nomina/recibos-pdf', timbradoController.listPlantillas);
router.get('/nomina/recibos-pdf/nuevo', timbradoController.newPlantillaForm);
router.post('/nomina/recibos-pdf', timbradoController.createPlantilla);
router.post('/nomina/recibos-pdf/seed-ejemplo', timbradoController.seedPlantillaEjemplo);
router.get('/nomina/recibos-pdf/html', timbradoController.reciboPdfHtml);
router.get('/nomina/recibos-pdf/:id/edit', timbradoController.editPlantilla);
router.post('/nomina/recibos-pdf/:id', timbradoController.updatePlantilla);
router.post('/nomina/recibos-pdf/:id/toggle', timbradoController.togglePlantilla);
router.post('/nomina/recibos-pdf/:id/aplicar-cfdi', timbradoController.aplicarLayoutCfdi);
router.get('/nomina/recibos-pdf/:id/preview', timbradoController.previewPlantilla);

router.get('/nomina/timbrado', timbradoController.wizardTimbrado);
router.post('/nomina/timbrado/generar', timbradoController.generarTimbrado);
router.get('/nomina/timbrado/lotes/:id', timbradoController.showLote);
router.get('/nomina/timbrado/archivos/:id/descargar', timbradoController.descargarCfdiArchivo);

router.get('/nomina/envio-correo', envioCorreoController.wizard);
router.post('/nomina/envio-correo/enviar', envioCorreoController.enviar);

router.get('/nomina/correo', correoConfigController.list);
router.get('/nomina/correo/nuevo', correoConfigController.newForm);
router.post('/nomina/correo', correoConfigController.create);
router.post('/nomina/correo/seed-ejemplo', correoConfigController.seedEjemplo);
router.get('/nomina/correo/:id/edit', correoConfigController.edit);
router.post('/nomina/correo/:id', correoConfigController.update);
router.post('/nomina/correo/:id/toggle', correoConfigController.toggle);
router.post('/nomina/correo/:id/default', correoConfigController.setDefault);
router.post('/nomina/correo/:id/probar', correoConfigController.probar);

router.get('/nomina/gestion-documental', gestionDocumentalController.tablero);
router.get('/nomina/gestion-documental/expediente', gestionDocumentalController.explorador);
router.get('/nomina/gestion-documental/config', gestionDocumentalController.configForm);
router.post('/nomina/gestion-documental/config', gestionDocumentalController.saveConfigAction);
router.get('/nomina/gestion-documental/subir', gestionDocumentalController.uploadForm);
router.post(
  '/nomina/gestion-documental/subir',
  uploadDocumentoMem.single('archivo'),
  gestionDocumentalController.uploadAction
);
router.get('/nomina/gestion-documental/reporte', gestionDocumentalController.reporte);
router.post('/nomina/gestion-documental/reindexar', gestionDocumentalController.reindexar);
router.get('/nomina/gestion-documental/:id/descargar', gestionDocumentalController.descargar);
router.post('/nomina/gestion-documental/:id/eliminar', gestionDocumentalController.eliminar);

router.get('/personal-empleados/:id/historial-laboral', historialLaboralController.showHistorialEmpleado);
router.post('/personal-empleados/:id/historial-laboral', historialLaboralController.createMovimientoManual);

router.get('/personal/tipos-movimiento-laboral', historialLaboralController.listTipos);
router.post('/personal/tipos-movimiento-laboral', historialLaboralController.createTipo);
router.post('/personal/tipos-movimiento-laboral/:id/toggle', historialLaboralController.toggleTipo);

router.get('/personal/ajuste-anual', ajusteAnualController.wizard);
router.post('/personal/ajuste-anual', ajusteAnualController.wizard);
router.post('/personal/ajuste-anual/guardar', ajusteAnualController.guardar);
router.get('/personal/ajuste-anual/lotes/:id', ajusteAnualController.showLote);
router.post('/personal/ajuste-anual/lotes/:id/autorizar', ajusteAnualController.postAutorizar);
router.post('/personal/ajuste-anual/lotes/:id/rechazar', ajusteAnualController.postRechazar);
router.post('/personal/ajuste-anual/lotes/:id/aplicar', ajusteAnualController.postAplicar);
router.get('/personal/ajuste-anual/lotes/:id/export', ajusteAnualController.exportCsv);

router.get('/asistencia-turnos', turnosController.listTurnos);
router.post('/asistencia-turnos', turnosController.createTurno);
router.get('/asistencia-turnos/:id/edit', turnosController.editTurno);
router.post('/asistencia-turnos/:id', turnosController.updateTurno);
router.post('/asistencia-turnos/:id/toggle', turnosController.toggleTurno);

router.get('/asistencia-rotaciones/cambios', rotacionesController.listCambios);
router.post('/asistencia-rotaciones/cambios', rotacionesController.createCambio);
router.post('/asistencia-rotaciones/cambios/:id/toggle', rotacionesController.toggleCambio);
router.get('/asistencia-rotaciones/matriz', rotacionesController.showMatriz);
router.get('/asistencia-rotaciones/asignaciones', rotacionesController.listAsignaciones);
router.post('/asistencia-rotaciones/asignaciones', rotacionesController.createAsignacion);
router.post('/asistencia-rotaciones/asignaciones/masiva', rotacionesController.createAsignacionMasiva);
router.post('/asistencia-rotaciones/asignaciones/:id/toggle', rotacionesController.toggleAsignacion);
router.get('/asistencia-rotaciones', rotacionesController.listRotaciones);
router.post('/asistencia-rotaciones', rotacionesController.createPlantilla);
router.get('/asistencia-rotaciones/:id/edit', rotacionesController.editPlantilla);
router.post('/asistencia-rotaciones/:id', rotacionesController.updatePlantilla);
router.post('/asistencia-rotaciones/:id/toggle', rotacionesController.togglePlantilla);

router.get('/asistencia-marcaciones', marcacionesController.listMarcaciones);
router.post('/asistencia-marcaciones', marcacionesController.createMarcacion);
router.post('/asistencia-marcaciones/:id/ajustar', marcacionesController.ajustarMarcacion);
router.post('/asistencia-marcaciones/:id/anular', marcacionesController.anularMarcacion);
router.post('/asistencia-marcaciones/:id/eliminar', marcacionesController.borrarMarcacionBloqueado);
router.delete('/asistencia-marcaciones/:id', marcacionesController.borrarMarcacionBloqueado);

router.get('/asistencia-diaria', asistenciaDiariaController.listDiaria);
router.post('/asistencia-diaria/reprocesar', asistenciaDiariaController.reprocesarDiaria);

router.get('/asistencia-registro-jornada', registroJornadaController.showRegistroJornada);

router.get('/incidencias', incidenciasController.listIncidencias);
router.post('/incidencias', incidenciasController.createIncidencia);
router.get('/incidencias/pendientes', incidenciasController.listPendientes);
router.get('/incidencias/tipos', incidenciasController.listTipos);
router.post('/incidencias/tipos', incidenciasController.createTipo);
router.get('/incidencias/tipos/:id/edit', incidenciasController.editTipo);
router.post('/incidencias/tipos/:id', incidenciasController.updateTipo);
router.post('/incidencias/tipos/:id/toggle', incidenciasController.toggleTipo);
router.get('/incidencias/vacaciones', vacacionesController.listVacaciones);
router.post('/incidencias/vacaciones/recalcular', vacacionesController.recalcularVacaciones);
router.post('/incidencias/aprobar-masivo', incidenciasController.aprobarMasivo);
router.post('/incidencias/:id/aprobar', incidenciasController.aprobarIncidencia);
router.post('/incidencias/:id/rechazar', incidenciasController.rechazarIncidencia);

router.get('/nomina', nominaController.index);
router.get('/nomina/periodos', nominaController.periodos);
router.post('/nomina/periodos', nominaController.createPeriodo);
router.get('/nomina/periodos/:id', nominaController.showPeriodo);
router.post('/nomina/periodos/:id/prestaciones', nominaController.updatePeriodoPrestacionesAction);
router.post('/nomina/periodos/:id/vincular-prenomina', nominaController.vincularPrenominaAction);
router.post('/nomina/periodos/:id/calcular', nominaController.calcularPeriodoAction);
router.get('/nomina/periodos/:id/estado-calculo', nominaController.estadoCalculoApi);
router.post('/nomina/periodos/:id/cerrar', nominaController.cerrarPeriodoAction);
router.get('/nomina/periodos/:id/recibos/:reciboId', nominaController.showRecibo);
router.get('/nomina/conceptos', nominaController.conceptos);
router.get('/nomina/conceptos/nuevo', nominaController.newConcepto);
router.post('/nomina/conceptos', nominaController.createConcepto);
router.get('/nomina/conceptos/:codigo', nominaController.showConcepto);
router.post('/nomina/conceptos/:codigo/props', nominaController.saveConceptoPropsAction);
router.post('/nomina/conceptos/:codigo/formula', nominaController.saveFormulaAction);
router.post('/nomina/conceptos/:codigo/toggle', nominaController.toggleConceptoAction);
router.post('/nomina/conceptos/validar-formula', nominaController.validarFormulaApi);
router.post('/nomina/conceptos/probar-formula', nominaController.probarFormulaApi);
router.get('/nomina/configuracion', nominaController.configuracion);
router.post('/nomina/configuracion/isr-motor', nominaController.saveIsrMotorConfig);
router.post('/nomina/configuracion/dias-pagados', nominaController.saveDiasPagadosConfig);
router.post('/nomina/configuracion/descuentos', nominaController.saveDescuentosConfig);
router.get('/nomina/placeholder/:slug', nominaPlaceholderController.show);
router.get('/nomina/catalogos', nominaCatalogosController.index);
router.get('/nomina/catalogos/sat', nominaCatalogosController.catalogoSat);
router.post('/nomina/catalogos/sat', nominaCatalogosController.createCatalogoSat);
router.post('/nomina/catalogos/sat/:id/toggle', nominaCatalogosController.toggleCatalogoSatAction);
router.get('/nomina/catalogos/mapeo-legado', nominaCatalogosController.mapeoLegado);
router.post('/nomina/catalogos/mapeo-legado', nominaCatalogosController.createMapeoLegado);
router.post('/nomina/catalogos/mapeo-legado/:id/toggle', nominaCatalogosController.toggleMapeoLegadoAction);
router.get('/nomina/catalogos/parametros', nominaCatalogosController.parametros);
router.post('/nomina/catalogos/parametros', nominaCatalogosController.createParametro);
router.get('/nomina/catalogos/formula-functions', nominaCatalogosController.formulaFunctions);
router.post('/nomina/catalogos/formula-functions', nominaCatalogosController.createFormulaFunctionAction);
router.post(
  '/nomina/catalogos/formula-functions/validate',
  nominaCatalogosController.validateFormulaFunctionApi
);
router.post(
  '/nomina/catalogos/formula-functions/test',
  nominaCatalogosController.testFormulaFunctionApi
);
router.get(
  '/nomina/catalogos/formula-functions/:id',
  nominaCatalogosController.showFormulaFunction
);
router.post(
  '/nomina/catalogos/formula-functions/:id',
  nominaCatalogosController.saveFormulaFunctionAction
);
router.post(
  '/nomina/catalogos/formula-functions/:id/publish',
  nominaCatalogosController.publishFormulaFunctionAction
);
router.post(
  '/nomina/catalogos/formula-functions/:id/toggle',
  nominaCatalogosController.toggleFormulaFunctionAction
);
router.get('/nomina/catalogos/tablas-fiscales', nominaCatalogosController.tablasFiscales);
router.post('/nomina/catalogos/tablas-fiscales', nominaCatalogosController.createTablaFiscal);
router.get('/nomina/catalogos/tablas-fiscales/:id', nominaCatalogosController.showTablaFiscal);
router.post('/nomina/catalogos/tablas-fiscales/:id/toggle', nominaCatalogosController.toggleTablaFiscalAction);
router.post('/nomina/catalogos/tablas-fiscales/:id/rangos', nominaCatalogosController.createRangoFiscal);
router.post('/nomina/catalogos/tablas-fiscales/:id/rangos/:rangoId/delete', nominaCatalogosController.deleteRangoFiscal);
router.post('/nomina/catalogos/tablas-fiscales/:id/copiar', nominaCatalogosController.copiarTablaFiscal);

router.get('/prenomina-periodos', prenominaController.listPeriodos);
router.post('/prenomina-periodos', prenominaController.createPeriodo);
router.get('/prenomina-periodos/:id', prenominaController.showPeriodo);
router.post('/prenomina-periodos/:id/abrir', prenominaController.abrirPeriodoAction);
router.post('/prenomina-periodos/:id/reprocesar-asistencia', prenominaController.reprocesarAsistenciaPeriodo);
router.post('/prenomina-periodos/:id/calcular', prenominaController.calcularPeriodo);
router.post('/prenomina-periodos/:id/cerrar', prenominaController.cerrarPeriodo);
router.get('/prenomina-periodos/:periodId/comprobante/:empleadoId', prenominaController.showComprobante);
router.post('/prenomina-periodos/:id/ajuste/:empleadoId', prenominaController.aplicarAjuste);
router.get('/prenomina-conceptos', prenominaController.listConceptos);
router.get('/prenomina-conceptos/nuevo', prenominaController.newConcepto);
router.post('/prenomina-conceptos', prenominaController.createConcepto);
router.get('/prenomina-conceptos/:id/edit', prenominaController.editConcepto);
router.post('/prenomina-conceptos/:id', prenominaController.updateConcepto);
router.post('/prenomina-conceptos/:id/toggle', prenominaController.toggleConcepto);

router.get('/prenomina/tipos-periodo', tipoPeriodoNominaController.list);
router.get('/prenomina/tipos-periodo/nuevo', tipoPeriodoNominaController.newForm);
router.post('/prenomina/tipos-periodo', tipoPeriodoNominaController.create);
router.get('/prenomina/tipos-periodo/:id/edit', tipoPeriodoNominaController.edit);
router.post('/prenomina/tipos-periodo/:id', tipoPeriodoNominaController.update);
router.post('/prenomina/tipos-periodo/:id/toggle', tipoPeriodoNominaController.toggle);

router.get('/catalogos/periodos', periodoAdministracionController.list);
router.get('/catalogos/periodos/generar', periodoAdministracionController.generarForm);
router.post('/catalogos/periodos/preview', periodoAdministracionController.previewApi);
router.post('/catalogos/periodos/generar', periodoAdministracionController.generar);
router.post('/catalogos/periodos/:id/abrir', periodoAdministracionController.abrir);
router.post('/catalogos/periodos/:id/cerrar', periodoAdministracionController.cerrar);

router.get('/prenomina/centros-costo', centroCostoController.list);
router.get('/prenomina/centros-costo/nuevo', centroCostoController.newForm);
router.post('/prenomina/centros-costo', centroCostoController.create);
router.get('/prenomina/centros-costo/:id/edit', centroCostoController.edit);
router.post('/prenomina/centros-costo/:id', centroCostoController.update);
router.post('/prenomina/centros-costo/:id/toggle', centroCostoController.toggle);
router.get('/prenomina/movimientos', movimientoAsistenciaNominaController.list);
router.post('/prenomina/movimientos', movimientoAsistenciaNominaController.create);

router.get('/integraciones/perfiles', integracionesController.listPerfiles);
router.get('/integraciones/perfiles/:id/edit', integracionesController.editPerfil);
router.post('/integraciones/perfiles/:id', integracionesController.updatePerfil);
router.get('/integraciones/exportacion', integracionesController.showExportacion);
router.post('/integraciones/exportacion/ejecutar', integracionesController.ejecutarExportacion);
router.get('/integraciones/abc', integracionesController.showAbcSync);
router.post('/integraciones/abc/exportar', integracionesController.ejecutarExportAbc);
router.post('/integraciones/abc/importar', integracionesController.ejecutarImportAbc);
router.get('/integraciones/logs', integracionesController.listLogs);
router.get('/integraciones/logs/:id', integracionesController.showLog);
router.get('/integraciones/logs/:id/descargar', integracionesController.descargarArchivoLog);
router.post('/integraciones/logs/:logId/conflictos/:conflictoId/resolver', integracionesController.resolverConflicto);

router.get('/integraciones/grupos-dispositivos', gruposDispositivosController.listGrupos);
router.post('/integraciones/grupos-dispositivos', gruposDispositivosController.createGrupo);
router.get('/integraciones/grupos-dispositivos/:id/edit', gruposDispositivosController.editGrupo);
router.post('/integraciones/grupos-dispositivos/:id', gruposDispositivosController.updateGrupo);
router.post('/integraciones/grupos-dispositivos/:id/toggle', gruposDispositivosController.toggleGrupo);

router.get('/integraciones/dispositivos', dispositivosController.listDispositivos);
router.post('/integraciones/dispositivos', dispositivosController.createDispositivo);
router.get('/integraciones/dispositivos/:id/edit', dispositivosController.editDispositivo);
router.post('/integraciones/dispositivos/:id', dispositivosController.updateDispositivo);
router.post('/integraciones/dispositivos/:id/ping', dispositivosController.pingDispositivo);
router.post('/integraciones/dispositivos/:id/sinc-catalogo', dispositivosController.sincronizarCatalogo);

router.get('/reportes', requireReportesAccess, reportesController.index);
router.get('/reportes/kpis', requireReportesAccess, reportesController.dashboardKpis);
router.get('/reportes/:slug/export', requireReportesAccess, reportesController.exportCsv);
router.get('/reportes/:slug', requireReportesAccess, reportesController.show);

router.get('/ayuda', ayudaController.index);
router.get('/ayuda/admin', ayudaController.admin);
router.get('/ayuda/admin/nuevo', ayudaController.nuevoForm);
router.post('/ayuda/admin', ayudaController.create);
router.get('/ayuda/admin/:id/edit', ayudaController.editForm);
router.post('/ayuda/admin/:id', ayudaController.update);
router.post('/ayuda/admin/:id/toggle', ayudaController.toggle);
router.get('/ayuda/:slug', ayudaController.show);

module.exports = router;
