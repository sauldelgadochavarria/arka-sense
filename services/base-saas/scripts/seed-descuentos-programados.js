'use strict';

/**
 * Seed de conceptos de descuento programado (ejemplos de la especificación).
 * Uso (dentro del contenedor o con MONGO_* del servicio):
 *   node scripts/seed-descuentos-programados.js [tenantId]
 *
 * No activa el módulo: eso se hace en UI /nomina/descuentos-programados/config
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const getConceptoNominaModel = require('../models/conceptoNomina');
const getEmpresaModel = require('../models/empresa');
const { defaultFiscalFromNaturaleza } = require('../models/fiscalConceptoShared');

const CONCEPTOS = [
  {
    codigo: 'D340',
    nombre: 'Ahorro A La Vista',
    tipoInterno: 'ahorro_vista',
    satClave: '004',
    permiteSaldo: false,
    permiteParcial: true
  },
  {
    codigo: 'D450',
    nombre: 'Prestamo Caja De Ahorro',
    tipoInterno: 'prestamo_caja',
    satClave: '004',
    permiteSaldo: true,
    permiteParcial: true
  },
  {
    codigo: 'D455',
    nombre: 'Ahorro A Plazo',
    tipoInterno: 'ahorro_plazo',
    satClave: '004',
    permiteSaldo: true,
    permiteParcial: true
  },
  {
    codigo: 'D910',
    nombre: 'Mercancia a credito',
    tipoInterno: 'mercancia_credito',
    satClave: '017',
    permiteSaldo: true,
    permiteParcial: true
  },
  {
    codigo: 'D915',
    nombre: 'Mercancia',
    tipoInterno: 'mercancia',
    satClave: '017',
    permiteSaldo: true,
    permiteParcial: true
  }
];

async function main() {
  const tenantId = process.argv[2] || process.env.DEFAULT_TENANT_ID || process.env.TENANT_ID;
  if (!tenantId) {
    console.error('Indica tenantId: node scripts/seed-descuentos-programados.js <tenantId>');
    process.exit(1);
  }

  const Empresa = await getEmpresaModel();
  const Concepto = await getConceptoNominaModel();
  const empresa = await Empresa.findOne({ tenantId }).lean();
  if (!empresa) {
    console.error('No hay empresa para tenant', tenantId);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  for (const c of CONCEPTOS) {
    const existing = await Concepto.findOne({ tenantId, codigo: c.codigo });
    const payload = {
      empresaId: empresa._id,
      nombre: c.nombre,
      tipo: 'deduccion',
      naturaleza: 'fiscal',
      categoria: 'descuento_programado',
      aplicaEn: 'nomina',
      claveSAT: c.satClave,
      sat: { tipo: 'deduccion', clave: c.satClave, descripcion: c.nombre },
      fiscal: defaultFiscalFromNaturaleza('fiscal'),
      ordenCalculo: 800,
      ordenImpresion: 800,
      activo: true,
      descuentoProgramado: {
        permite: true,
        permiteSaldo: c.permiteSaldo,
        permiteParcial: c.permiteParcial,
        tipoInterno: c.tipoInterno
      }
    };

    if (existing) {
      await Concepto.updateOne(
        { _id: existing._id },
        {
          $set: {
            'descuentoProgramado.permite': true,
            'descuentoProgramado.permiteSaldo': c.permiteSaldo,
            'descuentoProgramado.permiteParcial': c.permiteParcial,
            'descuentoProgramado.tipoInterno': c.tipoInterno,
            'sat.clave': c.satClave,
            claveSAT: c.satClave
          }
        }
      );
      updated++;
      console.log('upd', c.codigo);
    } else {
      await Concepto.create({ tenantId, codigo: c.codigo, ...payload });
      created++;
      console.log('new', c.codigo);
    }
  }

  console.log(JSON.stringify({ tenantId, created, updated, total: CONCEPTOS.length }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
