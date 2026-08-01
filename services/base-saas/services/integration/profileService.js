'use strict';

const getIntegrationProfileModel = require('../../models/integrationProfile');
const { DEFAULT_FIELD_MAPPING } = require('../../config/integraciones');

async function ensureDefaultProfiles(tenantId, empresaId) {
  const IntegrationProfile = await getIntegrationProfileModel();
  const count = await IntegrationProfile.countDocuments({ tenantId });
  if (count > 0) {
    return IntegrationProfile.find({ tenantId }).sort({ nombre: 1 }).lean();
  }

  const defaults = [
    { nombre: 'CONTPAQi Nóminas', adaptador: 'contpaqi' },
    { nombre: 'ASPEL NOI', adaptador: 'aspel' },
    { nombre: 'SAP HCM', adaptador: 'sap' },
    { nombre: 'CSV genérico', adaptador: 'csv', fieldMapping: { ...DEFAULT_FIELD_MAPPING } }
  ];

  await IntegrationProfile.insertMany(
    defaults.map((d) => ({
      tenantId,
      empresaId,
      fieldMapping: d.fieldMapping || {},
      activo: true,
      ...d
    }))
  );

  return IntegrationProfile.find({ tenantId }).sort({ nombre: 1 }).lean();
}

async function getProfile(tenantId, profileId) {
  const IntegrationProfile = await getIntegrationProfileModel();
  return IntegrationProfile.findOne({ _id: profileId, tenantId }).lean();
}

module.exports = { ensureDefaultProfiles, getProfile };
