'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');
const {
  trimString,
  trimUpper,
  parseCheckbox,
  parseOptionalObjectId,
  parseDate
} = require('../libs/formHelpers');
const getLayoutBancarioModel = require('../models/layoutBancario');
const getSubsidiariaModel = require('../models/subsidiaria');
const getPeriodoNominaModel = require('../models/periodoNomina');
const { resolveUserLabel } = require('../libs/userLabel');
const { generarDispersionBancaria } = require('../services/dispersionBancariaService');
const {
  LAYOUT_BANCARIO_VARIABLES,
  LAYOUT_BANCARIO_FORMATOS,
  LAYOUT_BANCARIO_MODOS,
  LAYOUT_EJEMPLO_DETALLE,
  LAYOUT_EJEMPLO_HEADER,
  LAYOUT_EJEMPLO_FOOTER
} = require('../config/layoutBancarioCatalog');
const {
  renderLayoutBancario,
  buildLoteContext,
  normalizeEmpleadoLayout,
  normalizeReciboLayout,
  normalizePeriodoLayout
} = require('../services/layoutBancarioService');

function parseCamposFromBody(body, prefix) {
  const paths = [].concat(body[`${prefix}_path`] || []);
  const longitudes = [].concat(body[`${prefix}_longitud`] || []);
  const formatos = [].concat(body[`${prefix}_formato`] || []);
  const literales = [].concat(body[`${prefix}_literal`] || []);
  const diasOffsets = [].concat(body[`${prefix}_diasOffset`] || []);
  const out = [];
  const n = Math.max(
    paths.length,
    longitudes.length,
    formatos.length,
    literales.length,
    diasOffsets.length
  );
  for (let i = 0; i < n; i += 1) {
    const path = trimString(paths[i]);
    const formato = trimString(formatos[i]) || 'align.izq';
    const literal = literales[i] != null ? String(literales[i]) : '';
    const longitud = Number(longitudes[i]) || 0;
    const diasOffset = Number(diasOffsets[i]) || 0;
    if (!path && formato !== 'literal' && formato !== 'space' && !literal) continue;
    out.push({ path, longitud, formato, literal, diasOffset, orden: i + 1 });
  }
  return out;
}

function buildPayload(body, tenantId, empresaId) {
  const modo = trimString(body.modo) || 'ancho_fijo';
  return {
    tenantId,
    empresaId,
    subsidiariaId: parseOptionalObjectId(body.subsidiariaId),
    codigo: trimUpper(body.codigo),
    nombre: trimString(body.nombre),
    descripcion: trimString(body.descripcion),
    bancoNombre: trimString(body.bancoNombre),
    modo: ['ancho_fijo', 'delimitado', 'xml'].includes(modo) ? modo : 'ancho_fijo',
    delimitador: body.delimitador != null ? String(body.delimitador) : ',',
    finLinea: body.finLinea === '\\r\\n' ? '\r\n' : '\n',
    encoding: trimString(body.encoding) || 'utf8',
    xmlPlantillaDetalle: body.xmlPlantillaDetalle != null ? String(body.xmlPlantillaDetalle) : '',
    xmlPlantillaDocumento: body.xmlPlantillaDocumento != null ? String(body.xmlPlantillaDocumento) : '',
    header: parseCamposFromBody(body, 'header'),
    detalle: parseCamposFromBody(body, 'detalle'),
    footer: parseCamposFromBody(body, 'footer'),
    activo: body.activo == null ? true : parseCheckbox(body, 'activo')
  };
}

async function loadSubsidiarias(empresaId) {
  if (!empresaId) return [];
  const Subsidiaria = await getSubsidiariaModel();
  return Subsidiaria.find({ empresaId, activo: { $ne: false } }).sort({ nombre: 1 }).lean();
}

function viewLocals(extra = {}) {
  return {
    variables: LAYOUT_BANCARIO_VARIABLES,
    formatos: LAYOUT_BANCARIO_FORMATOS,
    modos: LAYOUT_BANCARIO_MODOS,
    ...extra
  };
}

async function list(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Layout = await getLayoutBancarioModel();
  const layouts = empresa
    ? await Layout.find({ tenantId: req.session.tenantId, empresaId: empresa._id })
        .sort({ codigo: 1 })
        .lean()
    : [];
  res.render(
    'Nomina/layouts-bancarios/list',
    viewLocals({ layouts, empresa, error: error || null, session: req.session })
  );
}

async function newForm(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const subsidiarias = await loadSubsidiarias(empresa?._id);
  res.render(
    'Nomina/layouts-bancarios/edit',
    viewLocals({
      layout: {
        codigo: '',
        nombre: '',
        modo: 'ancho_fijo',
        delimitador: ',',
        header: [],
        detalle: [],
        footer: [],
        activo: true
      },
      isNew: true,
      subsidiarias,
      empresa,
      error: error || null,
      session: req.session
    })
  );
}

async function create(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/layouts-bancarios');
    }
    const Layout = await getLayoutBancarioModel();
    const payload = buildPayload(req.body, req.session.tenantId, empresa._id);
    if (!payload.codigo || !payload.nombre) {
      req.flash('error', 'Código y nombre son obligatorios');
      return res.redirect('/nomina/layouts-bancarios/nuevo');
    }
    await Layout.create(payload);
    req.flash('success', 'Layout bancario creado');
    res.redirect('/nomina/layouts-bancarios');
  } catch (err) {
    req.flash('error', err.code === 11000 ? 'Ya existe ese código' : err.message || 'Error al crear');
    res.redirect('/nomina/layouts-bancarios/nuevo');
  }
}

async function edit(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Layout = await getLayoutBancarioModel();
  const layout = await Layout.findOne({
    tenantId: req.session.tenantId,
    _id: req.params.id
  }).lean();
  if (!layout) return res.status(404).send('Layout no encontrado');
  const subsidiarias = await loadSubsidiarias(empresa?._id);
  res.render(
    'Nomina/layouts-bancarios/edit',
    viewLocals({
      layout,
      isNew: false,
      subsidiarias,
      empresa,
      error: error || null,
      session: req.session
    })
  );
}

async function update(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/layouts-bancarios');
    }
    const Layout = await getLayoutBancarioModel();
    const payload = buildPayload(req.body, req.session.tenantId, empresa._id);
    delete payload.tenantId;
    delete payload.empresaId;
    await Layout.updateOne(
      { tenantId: req.session.tenantId, _id: req.params.id },
      { $set: payload }
    );
    req.flash('success', 'Layout actualizado');
    res.redirect('/nomina/layouts-bancarios');
  } catch (err) {
    req.flash('error', err.code === 11000 ? 'Ya existe ese código' : err.message || 'Error al guardar');
    res.redirect(`/nomina/layouts-bancarios/${req.params.id}/edit`);
  }
}

async function toggle(req, res) {
  try {
    const Layout = await getLayoutBancarioModel();
    const doc = await Layout.findOne({ tenantId: req.session.tenantId, _id: req.params.id });
    if (!doc) {
      req.flash('error', 'No encontrado');
      return res.redirect('/nomina/layouts-bancarios');
    }
    doc.activo = !doc.activo;
    await doc.save();
    req.flash('success', doc.activo ? 'Layout activado' : 'Layout desactivado');
  } catch (err) {
    req.flash('error', err.message || 'Error');
  }
  res.redirect('/nomina/layouts-bancarios');
}

async function seedEjemplo(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/layouts-bancarios');
    }
    const Layout = await getLayoutBancarioModel();
    await Layout.updateOne(
      { tenantId: req.session.tenantId, empresaId: empresa._id, codigo: 'EJEMPLO_FIJO' },
      {
        $set: {
          nombre: 'Ejemplo dispersión ancho fijo',
          descripcion: 'Header + detalle + footer con totales de lote',
          bancoNombre: 'Ejemplo',
          modo: 'ancho_fijo',
          delimitador: ',',
          finLinea: '\n',
          encoding: 'utf8',
          header: LAYOUT_EJEMPLO_HEADER,
          detalle: LAYOUT_EJEMPLO_DETALLE,
          footer: LAYOUT_EJEMPLO_FOOTER,
          activo: true
        },
        $setOnInsert: {
          tenantId: req.session.tenantId,
          empresaId: empresa._id,
          codigo: 'EJEMPLO_FIJO'
        }
      },
      { upsert: true }
    );
    req.flash('success', 'Layout ejemplo EJEMPLO_FIJO listo');
  } catch (err) {
    req.flash('error', err.message || 'No se pudo crear el ejemplo');
  }
  res.redirect('/nomina/layouts-bancarios');
}

/** Vista previa con datos de muestra (JSON o defaults). */
async function preview(req, res) {
  try {
    const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
    let layout;
    if (req.params.id) {
      const Layout = await getLayoutBancarioModel();
      layout = await Layout.findOne({ tenantId: req.session.tenantId, _id: req.params.id }).lean();
    } else {
      layout = buildPayload(req.body, req.session.tenantId, empresa?._id);
    }
    if (!layout) {
      return res.status(404).json({ ok: false, error: 'Layout no encontrado' });
    }

    const sampleItems = [
      {
        empleado: normalizeEmpleadoLayout({
          numEmpleado: '001',
          firstName: 'Roberto',
          lastName: 'Vargas Herrera',
          curp: 'VAHR800101HDFRRB01',
          datosBancarios: { bancoCodigo: '012', cuenta: '123456789012345678' }
        }),
        recibo: normalizeReciboLayout({ netoPagar: 12500.5, totalPercepciones: 15000, totalDeducciones: 2499.5 })
      },
      {
        empleado: normalizeEmpleadoLayout({
          numEmpleado: '002',
          firstName: 'Ana',
          lastName: 'López',
          curp: 'LOXA900202MDFPLN09',
          datosBancarios: { bancoCodigo: '014', cuenta: '987654321098765432' }
        }),
        recibo: normalizeReciboLayout({ netoPagar: 9800.0 })
      }
    ];
    const periodo = normalizePeriodoLayout({
      tipoPeriodo: 'semanal',
      numeroPeriodo: 1,
      anio: 2026,
      tipoNomina: 'ordinaria',
      fechaInicio: new Date('2026-01-01'),
      fechaFin: new Date('2026-01-07')
    });
    const lote = buildLoteContext(sampleItems, {
      fechaPago: new Date('2026-01-08'),
      fechaGeneracion: new Date(),
      secuencia: '1'
    });
    const result = renderLayoutBancario(layout, {
      lote,
      periodo,
      empresa: empresa || { rfc: 'AAA010101AAA', razonSocial: 'Empresa Demo' },
      items: sampleItems
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Error en preview' });
  }
}

async function wizardDispersion(req, res) {
  const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
  const Layout = await getLayoutBancarioModel();
  const Periodo = await getPeriodoNominaModel();
  const tenantId = req.session.tenantId;

  const layouts = empresa
    ? await Layout.find({ tenantId, empresaId: empresa._id, activo: true }).sort({ codigo: 1 }).lean()
    : [];
  const periodos = await Periodo.find({
    tenantId,
    estatus: { $in: ['calculado', 'cerrado'] }
  })
    .sort({ fechaInicio: -1 })
    .limit(80)
    .lean();

  let periodoPre = null;
  if (req.query.periodoId) {
    periodoPre = periodos.find((p) => String(p._id) === String(req.query.periodoId)) || null;
  }

  res.render('Nomina/layouts-bancarios/dispersion', {
    empresa,
    error: error || null,
    layouts,
    periodos,
    periodoPre,
    fechaPagoDefault: new Date().toISOString().slice(0, 10),
    session: req.session
  });
}

async function generarDispersion(req, res) {
  try {
    const { empresa, error } = await requireEmpresaForTenant(req.session.tenantId);
    if (error || !empresa) {
      req.flash('error', error || 'Sin empresa');
      return res.redirect('/nomina/dispersion-bancaria');
    }
    const userId = req.session.userid || req.session.userId || '';
    const userLabel =
      req.session.userLabel || (userId ? await resolveUserLabel(userId) : '') || '';

    const result = await generarDispersionBancaria({
      tenantId: req.session.tenantId,
      periodoId: req.body.periodoId,
      layoutId: req.body.layoutId,
      fechaPago: req.body.fechaPago,
      userId,
      userLabel
    });

    const buf = Buffer.from(result.contenido || '', result.encoding === 'latin1' ? 'latin1' : 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${result.archivoNombre}"`);
    res.send(buf);
  } catch (err) {
    console.error('[dispersion]', err);
    req.flash('error', err.message || 'No se pudo generar el archivo');
    const q = req.body.periodoId ? `?periodoId=${req.body.periodoId}` : '';
    res.redirect(`/nomina/dispersion-bancaria${q}`);
  }
}

module.exports = {
  list,
  newForm,
  create,
  edit,
  update,
  toggle,
  seedEjemplo,
  preview,
  wizardDispersion,
  generarDispersion
};
