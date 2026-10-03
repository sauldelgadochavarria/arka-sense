'use strict';

const { XMLParser } = require('fast-xml-parser');
const { deriveFromCurp } = require('../../libs/curpDerive');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  isArray: (name) =>
    [
      'Percepcion',
      'Deduccion',
      'OtroPago',
      'Incapacidad',
      'HorasExtra',
      'CfdiRelacionado',
      'Complemento'
    ].includes(name)
});

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function parseDateYmd(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function findNominaNode(root) {
  const comp = root.Comprobante || root;
  const complements = asArray(comp.Complemento);
  for (const c of complements) {
    if (c?.Nomina) return asArray(c.Nomina)[0];
    if (c && typeof c === 'object') {
      for (const [k, v] of Object.entries(c)) {
        if (/^Nomina$/i.test(k)) return asArray(v)[0];
      }
    }
  }
  if (comp.Nomina) return asArray(comp.Nomina)[0];
  return null;
}

function findTimbre(root) {
  const comp = root.Comprobante || root;
  const complements = asArray(comp.Complemento);
  for (const c of complements) {
    if (c?.TimbreFiscalDigital) return asArray(c.TimbreFiscalDigital)[0];
    if (c && typeof c === 'object') {
      for (const [k, v] of Object.entries(c)) {
        if (/TimbreFiscalDigital/i.test(k)) return asArray(v)[0];
      }
    }
  }
  return null;
}

function mapConceptoLine(tipo, node) {
  const tipoSat =
    node.TipoPercepcion || node.TipoDeduccion || node.TipoOtroPago || '';
  const clave = String(node.Clave || '').trim().toUpperCase();
  const concepto = String(node.Concepto || '').trim();
  const gravado = money(node.ImporteGravado);
  const exento = money(node.ImporteExento);
  const importe =
    tipo === 'otro_pago'
      ? money(node.Importe)
      : Math.round((gravado + exento) * 100) / 100 || money(node.Importe);

  const codigoBase = clave || `SAT${tipoSat}` || 'SIN_CLAVE';
  const codigo = String(codigoBase)
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 40)
    .toUpperCase();

  return {
    tipo,
    tipoSat: String(tipoSat).padStart(3, '0').slice(-3),
    claveSat: String(tipoSat).padStart(3, '0').slice(-3),
    claveInterna: clave,
    conceptoCodigo: codigo,
    nombre: concepto || codigo,
    importe,
    gravado,
    exento
  };
}

/**
 * Parsea un XML CFDI 4.0 con complemento Nómina 1.2.
 * @returns {{ ok: boolean, error?: string, data?: object }}
 */
function parseNomina12Xml(xmlText, { anioFiltro = null } = {}) {
  let root;
  try {
    root = parser.parse(String(xmlText || ''));
  } catch (err) {
    return { ok: false, error: `xml_malformado: ${err.message}` };
  }

  const comprobante = root.Comprobante || root?.cfdi?.Comprobante || null;
  if (!comprobante) return { ok: false, error: 'sin_comprobante' };

  const nomina = findNominaNode(root);
  if (!nomina) return { ok: false, error: 'sin_complemento_nomina' };

  const timbre = findTimbre(root);
  const uuid = String(timbre?.UUID || '').trim().toUpperCase();
  if (!uuid) return { ok: false, error: 'sin_uuid' };

  const emisor = comprobante.Emisor || {};
  const receptor = comprobante.Receptor || {};
  const nomEmisor = nomina.Emisor || {};
  const nomReceptor = nomina.Receptor || {};

  const fechaPago = parseDateYmd(nomina.FechaPago) || parseDateYmd(nomina.FechaFinalPago);
  const fechaInicio = parseDateYmd(nomina.FechaInicialPago);
  const fechaFin = parseDateYmd(nomina.FechaFinalPago) || fechaPago;
  const anio = fechaPago ? fechaPago.getUTCFullYear() : null;

  if (anioFiltro && anio && anio !== Number(anioFiltro)) {
    return { ok: false, error: 'fuera_de_anio', anio, uuid };
  }

  const percepciones = asArray(nomina.Percepciones?.Percepcion).map((n) =>
    mapConceptoLine('percepcion', n)
  );
  const deducciones = asArray(nomina.Deducciones?.Deduccion).map((n) =>
    mapConceptoLine('deduccion', n)
  );
  const otrosPagos = asArray(nomina.OtrosPagos?.OtroPago).map((n) =>
    mapConceptoLine('otro_pago', n)
  );

  const totalPercepciones = money(nomina.TotalPercepciones) || money(comprobante.SubTotal);
  const totalDeducciones = money(nomina.TotalDeducciones) || money(comprobante.Descuento);
  const totalOtros = money(nomina.TotalOtrosPagos);
  const totalXml = money(comprobante.Total);
  const netoCalc =
    Math.round((totalPercepciones - totalDeducciones + totalOtros) * 100) / 100;
  const cuadra = Math.abs(netoCalc - totalXml) <= 0.05;

  const curpEmp = String(nomReceptor.Curp || '').trim().toUpperCase();
  const curpInfo = deriveFromCurp(curpEmp);

  const nombreCompleto = String(receptor.Nombre || '').trim();
  const nombreParts = nombreCompleto.split(/\s+/).filter(Boolean);
  const firstName = nombreParts[0] || 'SIN';
  const lastName = nombreParts.slice(1).join(' ') || 'NOMBRE';

  const departamento = String(nomReceptor.Departamento || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  const puesto = String(nomReceptor.Puesto || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

  const bitacora = [];
  if (!curpInfo.ok && curpEmp) bitacora.push({ tipo: 'curp_invalido', detalle: curpInfo.error });
  if (!cuadra) bitacora.push({ tipo: 'recibo_no_cuadra', detalle: `${netoCalc} vs ${totalXml}` });

  const sepNode = nomina.SeparacionIndemnizacion || nomina.Separacionindemnizacion || null;
  const separacion = sepNode
    ? {
        totalPagado: money(sepNode.TotalPagado),
        numAniosServicio: Number(sepNode.NumAñosServicio || sepNode.NumAniosServicio) || 0,
        ultimoSueldoMensOrd: money(sepNode.UltimoSueldoMensOrd),
        ingresoAcumulable: money(sepNode.IngresoAcumulable),
        ingresoNoAcumulable: money(sepNode.IngresoNoAcumulable)
      }
    : null;

  return {
    ok: true,
    data: {
      uuid,
      serie: String(comprobante.Serie || ''),
      folio: String(comprobante.Folio || ''),
      fechaTimbrado: parseDateYmd(String(timbre?.FechaTimbrado || '').slice(0, 10)),
      fechaPago,
      fechaInicio,
      fechaFin,
      anio,
      tipoNomina: String(nomina.TipoNomina || 'O').toUpperCase(),
      diasPagados: money(nomina.NumDiasPagados),
      emisor: {
        rfc: String(emisor.Rfc || '').toUpperCase(),
        nombre: String(emisor.Nombre || '').trim(),
        regimenFiscal: String(emisor.RegimenFiscal || ''),
        lugarExpedicion: String(comprobante.LugarExpedicion || ''),
        registroPatronal: String(nomEmisor.RegistroPatronal || '').toUpperCase(),
        curp: String(nomEmisor.Curp || '').toUpperCase()
      },
      empleado: {
        rfc: String(receptor.Rfc || '').toUpperCase(),
        curp: curpInfo.ok ? curpInfo.curp : curpEmp,
        nss: String(nomReceptor.NumSeguridadSocial || '').replace(/\D/g, ''),
        numEmpleado: String(nomReceptor.NumEmpleado || '').trim(),
        nombre: nombreCompleto,
        firstName,
        lastName,
        fechaIngreso: parseDateYmd(nomReceptor.FechaInicioRelLaboral),
        tipoContrato: String(nomReceptor.TipoContrato || ''),
        tipoJornada: String(nomReceptor.TipoJornada || ''),
        tipoRegimen: String(nomReceptor.TipoRegimen || ''),
        /** Atributo SAT NominaReceptor@Sindicalizado (Sí/No) → tipoEmpleado interno */
        sindicalizado: (() => {
          const raw = String(nomReceptor.Sindicalizado || '').trim().toLowerCase();
          if (!raw) return null;
          if (raw === 'sí' || raw === 'si' || raw === 'yes' || raw === '1' || raw === 'true') {
            return true;
          }
          if (raw === 'no' || raw === '0' || raw === 'false') return false;
          return null;
        })(),
        periodicidadPago: String(nomReceptor.PeriodicidadPago || ''),
        riesgoPuesto: String(nomReceptor.RiesgoPuesto || ''),
        banco: String(nomReceptor.Banco || ''),
        cuentaBancaria: String(nomReceptor.CuentaBancaria || ''),
        sbc: money(nomReceptor.SalarioBaseCotApor),
        sdi: money(nomReceptor.SalarioDiarioIntegrado),
        entidadFederativa: String(nomReceptor.ClaveEntFed || '').toUpperCase(),
        codigoPostal: String(receptor.DomicilioFiscalReceptor || comprobante.LugarExpedicion || ''),
        departamento,
        puesto,
        fechaNacimiento: curpInfo.fechaNacimiento,
        sexo: curpInfo.sexo || '',
        entidadNacimiento: curpInfo.entidadNacimiento || '',
        curpOk: !!curpInfo.ok
      },
      conceptos: [...percepciones, ...deducciones, ...otrosPagos],
      totales: {
        percepciones: totalPercepciones,
        deducciones: totalDeducciones,
        otrosPagos: totalOtros,
        totalXml,
        netoCalc,
        cuadra
      },
      bitacora,
      tieneSeparacion: !!sepNode,
      separacion
    }
  };
}

module.exports = { parseNomina12Xml };
