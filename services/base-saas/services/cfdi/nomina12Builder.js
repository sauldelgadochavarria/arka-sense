'use strict';

/**
 * Builder CFDI 4.0 + complemento Nómina 1.2 Rev. E (JSON SW y XML).
 * Referencia: https://developers.sw.com.mx/knowledge-base/nomina-1-2/
 */

const {
  buildSeparacionIndemnizacionData,
  buildSeparacionIndemnizacionXml,
  buildPercepcionesSeparacionXml
} = require('./separacionIndemnizacionBuilder');
const {
  money,
  moneyStr,
  ymd,
  cfdiFecha,
  satCode,
  escXml,
  joinNombre,
  antiguedadSat,
  tipoNominaCfdi,
  periodicidadSat,
  clasificarConcepto,
  claveSatDe,
  claveInternaDe,
  nombreConceptoDe,
  importeConcepto,
  gravadoConcepto,
  exentoConcepto,
  TIPO_CONTRATO_SAT
} = require('./nomina12Helpers');

const SCHEMA_CFDI =
  'http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd';
const SCHEMA_NOMINA =
  'http://www.sat.gob.mx/nomina12 http://www.sat.gob.mx/sitio_internet/cfd/nomina/nomina12.xsd';

function mapConceptosNomina(conceptos = [], catalogoMeta = {}) {
  const percepciones = [];
  const deducciones = [];
  const otrosPagos = [];

  for (const c of conceptos || []) {
    const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
    const meta = catalogoMeta[code] || {};
    const kind = clasificarConcepto(c, meta);
    if (kind === 'skip') continue;
    const importe = importeConcepto(c);
    if (!(importe !== 0 || gravadoConcepto(c) || exentoConcepto(c))) continue;

    const claveSat = claveSatDe(c, meta);
    const claveInt = claveInternaDe(c, meta, claveSat);
    const nombre = nombreConceptoDe(c, meta);

    if (kind === 'deduccion') {
      deducciones.push({
        TipoDeduccion: claveSat,
        Clave: claveInt,
        Concepto: nombre,
        Importe: money(importe)
      });
    } else if (kind === 'otro_pago') {
      otrosPagos.push({
        TipoOtroPago: claveSat,
        Clave: claveInt,
        Concepto: nombre,
        Importe: money(importe)
      });
    } else {
      percepciones.push({
        TipoPercepcion: claveSat,
        Clave: claveInt,
        Concepto: nombre,
        ImporteGravado: gravadoConcepto(c),
        ImporteExento: exentoConcepto(c)
      });
    }
  }

  return { percepciones, deducciones, otrosPagos };
}

function totalesPercepciones(percepciones) {
  let totalGravado = 0;
  let totalExento = 0;
  let totalSueldos = 0;
  for (const p of percepciones) {
    totalGravado += money(p.ImporteGravado);
    totalExento += money(p.ImporteExento);
    totalSueldos += money(p.ImporteGravado) + money(p.ImporteExento);
  }
  return {
    TotalSueldos: money(totalSueldos),
    TotalGravado: money(totalGravado),
    TotalExento: money(totalExento)
  };
}

function totalesDeducciones(deducciones) {
  let totalOtras = 0;
  let totalIsr = 0;
  for (const d of deducciones) {
    const imp = money(d.Importe);
    if (d.TipoDeduccion === '002') totalIsr += imp;
    else totalOtras += imp;
  }
  return {
    TotalOtrasDeducciones: money(totalOtras),
    TotalImpuestosRetenidos: money(totalIsr)
  };
}

/**
 * Arma contexto canónico desde recibo / histórico + empresa.
 */
function buildNomina12Context({
  empresa = {},
  empleado = {},
  periodo = {},
  recibo = {},
  conceptos = [],
  catalogoMeta = {},
  separacionIndemnizacion = null,
  serie = '',
  folio = '',
  fechaEmision = new Date()
} = {}) {
  const emp = empleado || {};
  const dom = emp.domicilio || {};
  const banco = emp.datosBancarios || {};
  const mapped = mapConceptosNomina(conceptos, catalogoMeta);

  const sepData =
    separacionIndemnizacion && separacionIndemnizacion.aplica !== false
      ? separacionIndemnizacion
      : buildSeparacionIndemnizacionData({
          conceptos,
          antiguedad: recibo.antiguedad || {},
          salarioDiario: emp.salarioDiario || recibo.insumosResumen?.sueldoDiario || 0,
          fiscalSeparacion: recibo.basesFiscales?.fiscalSeparacion || {}
        });

  const tPerc = totalesPercepciones(mapped.percepciones);
  const tDed = totalesDeducciones(mapped.deducciones);
  const totalOtros = money(
    mapped.otrosPagos.reduce((s, o) => s + money(o.Importe), 0)
  );

  const totalPercepciones = money(
    recibo.totalPercepciones != null
      ? recibo.totalPercepciones
      : tPerc.TotalSueldos + totalOtros
  );
  const totalDeducciones = money(
    recibo.totalDeducciones != null
      ? recibo.totalDeducciones
      : tDed.TotalOtrasDeducciones + tDed.TotalImpuestosRetenidos
  );
  const subTotal = totalPercepciones;
  const descuento = totalDeducciones;
  const total = money(recibo.netoPagar != null ? recibo.netoPagar : subTotal - descuento);

  const fechaPago = periodo.fechaPago || periodo.fechaFin || fechaEmision;
  const fechaIni = periodo.fechaInicio || fechaPago;
  const fechaFin = periodo.fechaFin || fechaPago;
  const numDias = Number(recibo.diasPagados || recibo.diasLaborados || periodo.diasPeriodo || 1);

  const registroPatronal = emp.registroPatronal || empresa.registroPatronal || '';
  const cpReceptor = dom.codigoPostal || emp.codigoPostal || '00000';
  const cpExpedicion = empresa.codigoPostal || cpReceptor || '00000';

  const nominaReceptor = {
    Curp: String(emp.curp || 'XEXX010101HNEXXXA4').trim(),
    NumSeguridadSocial: String(emp.nss || emp.imss || '00000000000').trim(),
    FechaInicioRelLaboral: ymd(emp.fechaIngreso),
    Antigüedad: emp.antiguedad || antiguedadSat(emp.fechaIngreso, fechaFin),
    TipoContrato: TIPO_CONTRATO_SAT[String(emp.tipoContrato || '').toLowerCase()] || satCode(emp.tipoContrato, '01'),
    TipoJornada: satCode(emp.tipoJornada, '01'),
    TipoRegimen: satCode(emp.tipoRegimen, '02'),
    NumEmpleado: String(emp.numEmpleado || recibo.numEmpleado || ''),
    Departamento: String(emp.departamento || emp.departamentoNombre || '').slice(0, 100),
    Puesto: String(emp.puesto || emp.puestoNombre || '').slice(0, 100),
    RiesgoPuesto: satCode(emp.riesgoPuesto, '1'),
    PeriodicidadPago: periodicidadSat(periodo, emp),
    ClaveEntFed: String(emp.entidadFederativa || dom.entidad || emp.entidadNacimiento || 'JAL')
      .slice(0, 3)
      .toUpperCase()
  };

  const cuenta = String(banco.cuenta || banco.clabe || emp.cuenta || '').replace(/\D/g, '');
  if (cuenta) nominaReceptor.CuentaBancaria = cuenta.slice(0, 18);
  const bancoCod = String(banco.bancoCodigo || emp.bancoCodigo || '').replace(/\D/g, '');
  if (bancoCod) nominaReceptor.Banco = bancoCod.padStart(3, '0').slice(0, 3);

  const sdi = money(emp.sdi || emp.sueldoIntegrado || emp.salarioDiario || 0);
  if (sdi > 0) {
    nominaReceptor.SalarioDiarioIntegrado = moneyStr(sdi);
    nominaReceptor.SalarioBaseCotApor = moneyStr(emp.sbc || sdi);
  }

  if (/sind/i.test(String(emp.tipoEmpleado || ''))) nominaReceptor.Sindicalizado = 'Sí';
  else nominaReceptor.Sindicalizado = 'No';

  const nominaAttrs = {
    Version: '1.2',
    TipoNomina: tipoNominaCfdi(periodo),
    FechaPago: ymd(fechaPago),
    FechaInicialPago: ymd(fechaIni),
    FechaFinalPago: ymd(fechaFin),
    NumDiasPagados: String(numDias),
    TotalPercepciones: moneyStr(totalPercepciones),
    TotalDeducciones: moneyStr(totalDeducciones)
  };
  if (totalOtros > 0) nominaAttrs.TotalOtrosPagos = moneyStr(totalOtros);
  if (sepData?.aplica) {
    nominaAttrs.TotalSeparacionIndemnizacion = moneyStr(
      sepData.TotalSeparacionIndemnizacion || sepData.TotalPagado
    );
  }

  return {
    comprobante: {
      Version: '4.0',
      Serie: String(serie || ''),
      Folio: String(folio || ''),
      Fecha: cfdiFecha(fechaEmision),
      SubTotal: moneyStr(subTotal),
      Descuento: moneyStr(descuento),
      Moneda: 'MXN',
      Total: moneyStr(total),
      TipoDeComprobante: 'N',
      Exportacion: '01',
      MetodoPago: 'PUE',
      LugarExpedicion: String(cpExpedicion).slice(0, 5)
    },
    emisor: {
      Rfc: String(empresa.rfc || '').trim(),
      Nombre: String(empresa.razonSocial || empresa.nombreComercial || '').trim(),
      RegimenFiscal: satCode(empresa.regimenFiscal, '601')
    },
    receptor: {
      Rfc: String(emp.rfc || 'XAXX010101000').trim(),
      Nombre: joinNombre(emp) || String(recibo.nombre || '').trim(),
      DomicilioFiscalReceptor: String(cpReceptor).slice(0, 5),
      RegimenFiscalReceptor: satCode(emp.regimenFiscal, '605'),
      UsoCFDI: 'CN01'
    },
    concepto: {
      ClaveProdServ: '84111505',
      Cantidad: '1',
      ClaveUnidad: 'ACT',
      Descripcion: 'Pago de nómina',
      ValorUnitario: moneyStr(subTotal),
      Importe: moneyStr(subTotal),
      Descuento: moneyStr(descuento),
      ObjetoImp: '01'
    },
    nomina: {
      attrs: nominaAttrs,
      emisor: {
        RegistroPatronal: registroPatronal,
        RfcPatronOrigen: String(empresa.rfc || '').trim()
      },
      receptor: nominaReceptor,
      percepciones: mapped.percepciones,
      deducciones: mapped.deducciones,
      otrosPagos: mapped.otrosPagos,
      totalesPercepciones: tPerc,
      totalesDeducciones: tDed,
      separacion: sepData?.aplica ? sepData : null
    },
    totales: { subTotal, descuento, total, totalPercepciones, totalDeducciones, totalOtros }
  };
}

/** JSON SW (Complemento.Any → Nomina12:Nomina). */
function toCfdiJson(ctx) {
  const nominaNode = {
    Version: ctx.nomina.attrs.Version,
    TipoNomina: ctx.nomina.attrs.TipoNomina,
    FechaPago: ctx.nomina.attrs.FechaPago,
    FechaInicialPago: ctx.nomina.attrs.FechaInicialPago,
    FechaFinalPago: ctx.nomina.attrs.FechaFinalPago,
    NumDiasPagados: ctx.nomina.attrs.NumDiasPagados,
    TotalPercepciones: ctx.nomina.attrs.TotalPercepciones,
    TotalDeducciones: ctx.nomina.attrs.TotalDeducciones,
    Emisor: ctx.nomina.emisor,
    Receptor: ctx.nomina.receptor
  };
  if (ctx.nomina.attrs.TotalOtrosPagos) nominaNode.TotalOtrosPagos = ctx.nomina.attrs.TotalOtrosPagos;
  if (ctx.nomina.attrs.TotalSeparacionIndemnizacion) {
    nominaNode.TotalSeparacionIndemnizacion = ctx.nomina.attrs.TotalSeparacionIndemnizacion;
  }

  if (ctx.nomina.percepciones.length || ctx.nomina.separacion) {
    nominaNode.Percepciones = {
      TotalSueldos: moneyStr(ctx.nomina.totalesPercepciones.TotalSueldos),
      TotalGravado: moneyStr(ctx.nomina.totalesPercepciones.TotalGravado),
      TotalExento: moneyStr(ctx.nomina.totalesPercepciones.TotalExento),
      Percepcion: ctx.nomina.percepciones.map((p) => ({
        TipoPercepcion: p.TipoPercepcion,
        Clave: p.Clave,
        Concepto: p.Concepto,
        ImporteGravado: moneyStr(p.ImporteGravado),
        ImporteExento: moneyStr(p.ImporteExento)
      }))
    };
    if (ctx.nomina.separacion) {
      nominaNode.Percepciones.SeparacionIndemnizacion = {
        TotalPagado: moneyStr(ctx.nomina.separacion.TotalPagado),
        NumAniosServicio: Number(ctx.nomina.separacion.NumAniosServicio) || 0,
        'NumAñosServicio': Number(ctx.nomina.separacion.NumAniosServicio) || 0,
        UltimoSueldoMensOrd: moneyStr(ctx.nomina.separacion.UltimoSueldoMensOrd),
        IngresoAcumulable: moneyStr(ctx.nomina.separacion.IngresoAcumulable),
        IngresoNoAcumulable: moneyStr(ctx.nomina.separacion.IngresoNoAcumulable)
      };
    }
  }

  if (ctx.nomina.deducciones.length) {
    nominaNode.Deducciones = {
      TotalOtrasDeducciones: moneyStr(ctx.nomina.totalesDeducciones.TotalOtrasDeducciones),
      TotalImpuestosRetenidos: moneyStr(ctx.nomina.totalesDeducciones.TotalImpuestosRetenidos),
      Deduccion: ctx.nomina.deducciones.map((d) => ({
        TipoDeduccion: d.TipoDeduccion,
        Clave: d.Clave,
        Concepto: d.Concepto,
        Importe: moneyStr(d.Importe)
      }))
    };
  }

  if (ctx.nomina.otrosPagos.length) {
    nominaNode.OtrosPagos = {
      OtroPago: ctx.nomina.otrosPagos.map((o) => ({
        TipoOtroPago: o.TipoOtroPago,
        Clave: o.Clave,
        Concepto: o.Concepto,
        Importe: moneyStr(o.Importe)
      }))
    };
  }

  return {
    ...ctx.comprobante,
    Emisor: ctx.emisor,
    Receptor: ctx.receptor,
    Conceptos: [ctx.concepto],
    Complemento: {
      Any: [{ 'Nomina12:Nomina': nominaNode }]
    }
  };
}

function attrsXml(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}="${escXml(v)}"`)
    .join(' ');
}

/** XML CFDI 4.0 + nómina 1.2 (sin sello/certificado; listo para PAC XML). */
function toCfdiXml(ctx, { incluirTfdSimulado = false, uuidSimulado = '' } = {}) {
  const c = ctx.comprobante;
  const sepXml = ctx.nomina.separacion ? buildSeparacionIndemnizacionXml(ctx.nomina.separacion) : '';

  let percInner = ctx.nomina.percepciones
    .map(
      (p) =>
        `<nomina12:Percepcion TipoPercepcion="${escXml(p.TipoPercepcion)}" Clave="${escXml(p.Clave)}"` +
        ` Concepto="${escXml(p.Concepto)}" ImporteGravado="${moneyStr(p.ImporteGravado)}"` +
        ` ImporteExento="${moneyStr(p.ImporteExento)}"/>`
    )
    .join('\n        ');

  if (ctx.nomina.separacion && !percInner.includes('SeparacionIndemnizacion')) {
    const extra = buildPercepcionesSeparacionXml(ctx.nomina.separacion);
    percInner = [percInner, extra].filter(Boolean).join('\n        ');
  }

  const percBlock =
    percInner || sepXml
      ? `<nomina12:Percepciones ${attrsXml({
          TotalSueldos: moneyStr(ctx.nomina.totalesPercepciones.TotalSueldos),
          TotalGravado: moneyStr(ctx.nomina.totalesPercepciones.TotalGravado),
          TotalExento: moneyStr(ctx.nomina.totalesPercepciones.TotalExento),
          ...(ctx.nomina.attrs.TotalSeparacionIndemnizacion
            ? { TotalSeparacionIndemnizacion: ctx.nomina.attrs.TotalSeparacionIndemnizacion }
            : {})
        })}>
        ${percInner}
        ${sepXml}
      </nomina12:Percepciones>`
      : '';

  const dedBlock = ctx.nomina.deducciones.length
    ? `<nomina12:Deducciones ${attrsXml({
        TotalOtrasDeducciones: moneyStr(ctx.nomina.totalesDeducciones.TotalOtrasDeducciones),
        TotalImpuestosRetenidos: moneyStr(ctx.nomina.totalesDeducciones.TotalImpuestosRetenidos)
      })}>
        ${ctx.nomina.deducciones
          .map(
            (d) =>
              `<nomina12:Deduccion TipoDeduccion="${escXml(d.TipoDeduccion)}" Clave="${escXml(d.Clave)}"` +
              ` Concepto="${escXml(d.Concepto)}" Importe="${moneyStr(d.Importe)}"/>`
          )
          .join('\n        ')}
      </nomina12:Deducciones>`
    : '';

  const otrosBlock = ctx.nomina.otrosPagos.length
    ? `<nomina12:OtrosPagos>
        ${ctx.nomina.otrosPagos
          .map(
            (o) =>
              `<nomina12:OtroPago TipoOtroPago="${escXml(o.TipoOtroPago)}" Clave="${escXml(o.Clave)}"` +
              ` Concepto="${escXml(o.Concepto)}" Importe="${moneyStr(o.Importe)}"/>`
          )
          .join('\n        ')}
      </nomina12:OtrosPagos>`
    : '';

  const nomEmisorAttrs = attrsXml(ctx.nomina.emisor);
  const nomReceptorAttrs = attrsXml(ctx.nomina.receptor);

  const tfdBlock =
    incluirTfdSimulado && uuidSimulado
      ? `\n    <tfd:TimbreFiscalDigital Version="1.1" UUID="${escXml(uuidSimulado)}" FechaTimbrado="${escXml(c.Fecha)}" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"/>`
      : '';

  const nomAttrs = attrsXml(ctx.nomina.attrs);

  return `<?xml version="1.0" encoding="utf-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:nomina12="http://www.sat.gob.mx/nomina12"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  xsi:schemaLocation="${SCHEMA_CFDI} ${SCHEMA_NOMINA}"
  ${attrsXml({ ...c, Sello: '', NoCertificado: '', Certificado: '' })}>
  <cfdi:Emisor ${attrsXml(ctx.emisor)}/>
  <cfdi:Receptor ${attrsXml(ctx.receptor)}/>
  <cfdi:Conceptos>
    <cfdi:Concepto ${attrsXml(ctx.concepto)}/>
  </cfdi:Conceptos>
  <cfdi:Complemento>
    <nomina12:Nomina ${nomAttrs}>
      <nomina12:Emisor ${nomEmisorAttrs}/>
      <nomina12:Receptor ${nomReceptorAttrs}/>
      ${percBlock}
      ${dedBlock}
      ${otrosBlock}
    </nomina12:Nomina>${tfdBlock}
  </cfdi:Complemento>
</cfdi:Comprobante>
`;
}

/**
 * Punto único: contexto + JSON + XML desde recibo de nómina.
 */
function buildCfdiNominaPayload(input) {
  const ctx = buildNomina12Context(input);
  const json = toCfdiJson(ctx);
  const xml = toCfdiXml(ctx, {
    incluirTfdSimulado: !!input.incluirTfdSimulado,
    uuidSimulado: input.uuidSimulado || ''
  });
  return { ctx, json, xml };
}

module.exports = {
  buildNomina12Context,
  buildCfdiNominaPayload,
  toCfdiJson,
  toCfdiXml,
  mapConceptosNomina
};
