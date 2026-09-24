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
  isValidClabe,
  TIPO_CONTRATO_SAT
} = require('./nomina12Helpers');

const SCHEMA_CFDI =
  'http://www.sat.gob.mx/cfd/4 http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd';
const SCHEMA_NOMINA =
  'http://www.sat.gob.mx/nomina12 http://www.sat.gob.mx/sitio_internet/cfd/nomina/nomina12.xsd';

function mapConceptosNomina(conceptos = [], catalogoMeta = {}, opts = {}) {
  const percepciones = [];
  const deducciones = [];
  const otrosPagos = [];
  const insumos = opts.insumosResumen || opts.recibo?.insumosResumen || {};

  for (const c of conceptos || []) {
    const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
    const meta = catalogoMeta[code] || {};
    const kind = clasificarConcepto(c, meta);
    if (kind === 'skip') continue;
    const importe = importeConcepto(c);
    const gravado = gravadoConcepto(c);
    const exento = exentoConcepto(c);
    // CFDI no admite importes negativos en deducciones (p.ej. ISR_DIFERENCIA).
    if (kind === 'deduccion' && !(importe > 0)) continue;
    // Otro pago 002 (subsidio) sí puede ir en 0 — lo exige NOM105 en nómina ordinaria.
    if (kind === 'otro_pago' && !(importe > 0)) {
      const claveSatTmp = String(claveSatDe(c, meta) || '').padStart(3, '0');
      if (claveSatTmp !== '002') continue;
    }
    if (kind === 'percepcion' && !(importe !== 0 || gravado || exento)) continue;

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
      const row = {
        TipoOtroPago: satCode(claveSat, '002'),
        Clave: claveInt,
        Concepto: nombre,
        Importe: money(importe)
      };
      if (String(row.TipoOtroPago).padStart(3, '0') === '002') {
        row.SubsidioAlEmpleo = {
          SubsidioCausado: money(resolveSubsidioCausado(c, opts.recibo, conceptos))
        };
      }
      otrosPagos.push(row);
    } else {
      // Preferir gravado/exento; si vienen en 0 pero hay importe, todo gravado.
      let g = gravado;
      let e = exento;
      if (!(g || e) && importe) {
        g = money(importe);
        e = 0;
      }
      const perc = {
        TipoPercepcion: claveSat,
        Clave: claveInt,
        Concepto: nombre,
        ImporteGravado: money(g),
        ImporteExento: money(e)
      };
      // NOM84: TipoPercepcion 019 exige elemento(s) HorasExtra.
      if (String(claveSat).padStart(3, '0') === '019') {
        perc.HorasExtra = buildHorasExtraForPercepcion(c, {
          importePagado: money(g + e),
          insumos
        });
      }
      percepciones.push(perc);
    }
  }

  return { percepciones, deducciones, otrosPagos };
}

function tipOtroPago(v) {
  return String(satCode(v, '', 3) || '').padStart(3, '0');
}

/** Subsidio causado: concepto SUBSIDIO_CAUSADO, variables del 002, o el propio importe entregado. */
function resolveSubsidioCausado(c002 = null, recibo = {}, conceptos = []) {
  if (recibo?.subsidioCausado != null && Number(recibo.subsidioCausado) >= 0) {
    return money(recibo.subsidioCausado);
  }
  for (const c of conceptos || []) {
    const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
    if (code === 'SUBSIDIO_CAUSADO') return money(importeConcepto(c));
  }
  const vars = c002?.variablesUsadas || {};
  if (vars.SUBSIDIO_CAUSADO != null) return money(vars.SUBSIDIO_CAUSADO);
  if (vars.subsidioCausado != null) return money(vars.subsidioCausado);
  if (c002) return money(importeConcepto(c002));
  return 0;
}

/**
 * NOM105: en nómina ordinaria (TipoNomina=O) debe existir OtroPago TipoOtroPago=002
 * (Subsidio para el empleo), con nodo SubsidioAlEmpleo. No puede coexistir con 007/008.
 */
function ensureSubsidioEmpleoOtroPago(mapped, { tipoNomina = 'O', conceptos = [], recibo = {} } = {}) {
  if (String(tipoNomina).toUpperCase() !== 'O') return mapped;

  // 002 no coexiste con 007/008 en ordinaria
  mapped.otrosPagos = (mapped.otrosPagos || []).filter((o) => {
    const t = tipOtroPago(o.TipoOtroPago);
    return t !== '007' && t !== '008';
  });

  let row002 = mapped.otrosPagos.find((o) => tipOtroPago(o.TipoOtroPago) === '002');
  let importe = row002 ? money(row002.Importe) : 0;
  if (!row002) {
    for (const c of conceptos || []) {
      const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
      if (code === 'SUBSIDIO_EMPLEO' || code === 'OTRO_PAGO_SUBSIDIO') {
        importe = money(importeConcepto(c));
        break;
      }
    }
    if (recibo?.subsidioEmpleo != null) importe = money(recibo.subsidioEmpleo);
  }

  const subsidioCausado = resolveSubsidioCausado(row002, recibo, conceptos);

  if (!row002) {
    row002 = {
      TipoOtroPago: '002',
      Clave: '00200',
      Concepto: 'Subsidio para el empleo',
      Importe: importe,
      SubsidioAlEmpleo: { SubsidioCausado: subsidioCausado }
    };
    mapped.otrosPagos.unshift(row002);
  } else {
    row002.TipoOtroPago = '002';
    row002.Importe = money(row002.Importe);
    row002.SubsidioAlEmpleo = {
      SubsidioCausado: money(
        row002.SubsidioAlEmpleo?.SubsidioCausado ?? subsidioCausado
      )
    };
  }
  return mapped;
}

/**
 * Nodo nomina12:HorasExtra (obligatorio si TipoPercepcion=019).
 * TipoHoras: 01 dobles, 02 triples, 03 sencillas.
 */
function buildHorasExtraForPercepcion(c = {}, { importePagado = 0, insumos = {} } = {}) {
  const code = String(c.conceptoCodigo || c.codigo || '').toUpperCase();
  const vars = c.variablesUsadas || {};
  const inc = vars.INCIDENCIAS || vars.incidencias || {};
  const emp = vars.EMPLEADO || vars.empleado || {};

  let tipoHoras = '01';
  if (/TRIPLE/.test(code)) tipoHoras = '02';
  else if (/SENCIL/.test(code)) tipoHoras = '03';
  else if (/DOBLE/.test(code) || /HORAS_EXTRA/.test(code)) tipoHoras = '01';

  let horas = Number(
    c.horasExtra ??
      c.horas ??
      (tipoHoras === '02'
        ? inc.horasExtraTriples ?? insumos.horasExtraTriples
        : tipoHoras === '03'
          ? inc.horasExtraSencillas ?? insumos.horasExtraSencillas
          : inc.horasExtraDobles ?? insumos.horasExtraDobles) ??
      0
  );
  if (!(horas > 0) && importePagado > 0) {
    const horasJornada = Number(emp.horasJornada || emp.atributos?.horasJornada || 8) || 8;
    const sd = Number(emp.salarioDiario || emp.sueldoDiario || insumos.sueldoDiario || 0);
    const valorHora = sd > 0 && horasJornada > 0 ? sd / horasJornada : 0;
    const factor = tipoHoras === '02' ? 3 : tipoHoras === '03' ? 1 : 2;
    if (valorHora > 0 && factor > 0) {
      horas = importePagado / (valorHora * factor);
    }
  }
  // XSD nómina12: HorasExtra y Dias son xs:int (no decimales).
  horas = Math.max(1, Math.round(Number(horas) || 0));

  let dias = Number(c.diasHorasExtra ?? c.dias ?? inc.diasHorasExtra ?? insumos.diasHorasExtra ?? 0);
  if (!(dias > 0)) {
    // Estimación conservadora: al menos 1 día; tope 3 h dobles/día típico
    dias = Math.max(1, Math.min(7, Math.ceil(horas / 3)));
  }
  dias = Math.max(1, Math.round(dias));

  return [
    {
      Dias: dias,
      TipoHoras: tipoHoras,
      HorasExtra: horas,
      ImportePagado: money(importePagado)
    }
  ];
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
  const mapped = mapConceptosNomina(conceptos, catalogoMeta, { recibo, insumosResumen: recibo.insumosResumen });
  ensureSubsidioEmpleoOtroPago(mapped, {
    tipoNomina: tipoNominaCfdi(periodo),
    conceptos,
    recibo
  });

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

  // Totales del complemento = suma de líneas CFDI (no informativos / no patronales).
  // Evita descuadre SubTotal/Descuento vs detalle y errores PAC (CFDI40999).
  const totalPercepciones = money(tPerc.TotalSueldos);
  const totalDeducciones = money(tDed.TotalOtrasDeducciones + tDed.TotalImpuestosRetenidos);
  const subTotal = totalPercepciones;
  const descuento = totalDeducciones;
  const total = money(subTotal - descuento + totalOtros);

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
    TipoContrato: TIPO_CONTRATO_SAT[String(emp.tipoContrato || '').toLowerCase()] || satCode(emp.tipoContrato, '01', 2),
    TipoJornada: satCode(emp.tipoJornada, '01', 2),
    TipoRegimen: satCode(emp.tipoRegimen, '02', 2),
    NumEmpleado: String(emp.numEmpleado || recibo.numEmpleado || ''),
    Departamento: String(emp.departamento || emp.departamentoNombre || '').slice(0, 100),
    Puesto: String(emp.puesto || emp.puestoNombre || '').slice(0, 100),
    RiesgoPuesto: satCode(emp.riesgoPuesto, '1', 1),
    PeriodicidadPago: periodicidadSat(periodo, emp),
    ClaveEntFed: String(emp.entidadFederativa || dom.entidad || emp.entidadNacimiento || 'JAL')
      .slice(0, 3)
      .toUpperCase()
  };

  const cuenta = String(banco.cuenta || banco.clabe || emp.cuenta || '').replace(/\D/g, '');
  if (cuenta.length === 18) {
    // NOM63: CLABE 18 → sin atributo Banco. NOM64: dígito verificador válido.
    if (isValidClabe(cuenta)) {
      nominaReceptor.CuentaBancaria = cuenta;
    } else {
      console.warn(
        `[cfdi] CLABE inválida (NOM64) para emp=${nominaReceptor.NumEmpleado}: se omite CuentaBancaria`
      );
    }
  } else if (cuenta.length >= 10 && cuenta.length <= 18) {
    nominaReceptor.CuentaBancaria = cuenta.slice(0, 18);
    const bancoCod = String(banco.bancoCodigo || emp.bancoCodigo || '').replace(/\D/g, '');
    if (bancoCod) nominaReceptor.Banco = bancoCod.padStart(3, '0').slice(0, 3);
  }

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
  if (mapped.otrosPagos.length) nominaAttrs.TotalOtrosPagos = moneyStr(totalOtros);
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
      Fecha: cfdiFecha(fechaEmision || new Date()),
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
      Percepcion: ctx.nomina.percepciones.map((p) => {
        const row = {
          TipoPercepcion: p.TipoPercepcion,
          Clave: p.Clave,
          Concepto: p.Concepto,
          ImporteGravado: moneyStr(p.ImporteGravado),
          ImporteExento: moneyStr(p.ImporteExento)
        };
        if (Array.isArray(p.HorasExtra) && p.HorasExtra.length) {
          row.HorasExtra = p.HorasExtra.map((h) => ({
            Dias: Math.max(1, Math.round(Number(h.Dias) || 1)),
            TipoHoras: String(h.TipoHoras || '01').padStart(2, '0').slice(-2),
            HorasExtra: Math.max(1, Math.round(Number(h.HorasExtra) || 0)),
            ImportePagado: moneyStr(h.ImportePagado)
          }));
        }
        return row;
      })
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
      OtroPago: ctx.nomina.otrosPagos.map((o) => {
        const row = {
          TipoOtroPago: o.TipoOtroPago,
          Clave: o.Clave,
          Concepto: o.Concepto,
          Importe: moneyStr(o.Importe)
        };
        if (tipOtroPago(o.TipoOtroPago) === '002') {
          row.SubsidioAlEmpleo = {
            SubsidioCausado: moneyStr(o.SubsidioAlEmpleo?.SubsidioCausado ?? 0)
          };
        }
        return row;
      })
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
    .map((p) => {
      const open =
        `<nomina12:Percepcion TipoPercepcion="${escXml(p.TipoPercepcion)}" Clave="${escXml(p.Clave)}"` +
        ` Concepto="${escXml(p.Concepto)}" ImporteGravado="${moneyStr(p.ImporteGravado)}"` +
        ` ImporteExento="${moneyStr(p.ImporteExento)}"`;
      if (Array.isArray(p.HorasExtra) && p.HorasExtra.length) {
        const heXml = p.HorasExtra.map(
          (h) =>
            `<nomina12:HorasExtra Dias="${Math.max(1, Math.round(Number(h.Dias) || 1))}"` +
            ` TipoHoras="${escXml(String(h.TipoHoras || '01').padStart(2, '0').slice(-2))}"` +
            ` HorasExtra="${Math.max(1, Math.round(Number(h.HorasExtra) || 0))}"` +
            ` ImportePagado="${moneyStr(h.ImportePagado)}"/>`
        ).join('\n          ');
        return `${open}>\n          ${heXml}\n        </nomina12:Percepcion>`;
      }
      return `${open}/>`;
    })
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
          .map((o) => {
            const open =
              `<nomina12:OtroPago TipoOtroPago="${escXml(o.TipoOtroPago)}" Clave="${escXml(o.Clave)}"` +
              ` Concepto="${escXml(o.Concepto)}" Importe="${moneyStr(o.Importe)}"`;
            if (tipOtroPago(o.TipoOtroPago) === '002') {
              const sc = moneyStr(o.SubsidioAlEmpleo?.SubsidioCausado ?? 0);
              return `${open}>\n          <nomina12:SubsidioAlEmpleo SubsidioCausado="${sc}"/>\n        </nomina12:OtroPago>`;
            }
            return `${open}/>`;
          })
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
