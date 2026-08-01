'use strict';

const { requireEmpresaForTenant } = require('../libs/tenantScope');

const PLACEHOLDERS = {
  'centros-costos': {
    titulo: 'Centro de costos',
    descripcion: 'Catálogo pendiente de habilitar para pre-nómina y nómina.'
  },
  'movimientos-prenomina': {
    titulo: 'Movimientos',
    descripcion: 'Bandeja de movimientos operativos para pre-nómina.'
  },
  plantilla: {
    titulo: 'Plantilla',
    descripcion: 'Plantillas de cálculo/layout de nómina.'
  },
  'pago-dispersion': {
    titulo: 'Pago y dispersión',
    descripcion: 'Integración de dispersión bancaria y conciliación de pago.'
  },
  timbrador: {
    titulo: 'Timbrador',
    descripcion: 'Timbrado CFDI de nómina.'
  },
  'envio-correo': {
    titulo: 'Envío de correo',
    descripcion: 'Entrega de recibos por correo.'
  },
  apis: {
    titulo: 'APIs',
    descripcion: 'Servicios API para integración externa de nómina.'
  }
};

async function show(req, res) {
  const { empresa } = await requireEmpresaForTenant(req.session.tenantId);
  const key = String(req.params.slug || '');
  const seccion = PLACEHOLDERS[key] || {
    titulo: 'Sección en construcción',
    descripcion: 'Esta sección está definida en el menú y se implementará en la siguiente fase.'
  };

  res.render('Nomina/placeholder', {
    seccion,
    empresa,
    session: req.session
  });
}

module.exports = { show };

