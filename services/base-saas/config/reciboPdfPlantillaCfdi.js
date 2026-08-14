'use strict';

/** Representación impresa CFDI 4.0 / Nómina 1.2 (layout tipo SAT). */
const PLANTILLA_PDF_CFDI = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>Recibo de nómina {{empleado.numEmpleado}}</title>
<style>
  @page { size: letter; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8.5px; color: #111; margin: 0; }
  h1 { font-size: 14px; margin: 0 0 2px; letter-spacing: .02em; }
  .muted { color: #444; }
  table { border-collapse: collapse; width: 100%; }
  .box { border: 1px solid #111; }
  .hdr { background: #d9d9d9; font-weight: bold; text-align: center; padding: 2px 4px; font-size: 8px; }
  .lab { color: #333; font-size: 7.5px; }
  .val { font-weight: bold; }
  .num { text-align: right; white-space: nowrap; }
  .tiny { font-size: 7px; }
  .row2 { display: flex; gap: 0; }
  .row2 > div { flex: 1; }
  .kv td { padding: 1px 4px; vertical-align: top; }
  .grid6 { display: grid; grid-template-columns: repeat(6, 1fr); }
  .grid6 div, .grid4 div { border: 1px solid #111; border-top: 0; padding: 2px 4px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); }
  .cell { padding: 2px 4px; }
  th { background: #d9d9d9; font-size: 7.5px; padding: 2px 3px; border: 1px solid #111; }
  td { border: 1px solid #111; padding: 2px 3px; }
  .legal { font-size: 7px; text-align: justify; margin: 4px 0; }
  .foot { font-size: 7px; display: flex; justify-content: space-between; margin-top: 4px; }
  .sello { font-size: 6.5px; word-break: break-all; border: 1px solid #111; padding: 3px; margin-bottom: 3px; min-height: 28px; }
  .qr { width: 110px; height: 110px; border: 1px solid #111; }
  .firma { border-top: 1px solid #111; margin-top: 18px; text-align: center; padding-top: 2px; width: 46%; }
</style>
</head>
<body>
  <table class="box">
    <tr>
      <td style="width:62%;padding:6px 8px;text-align:center;vertical-align:top">
        <h1>{{empresa.razonSocial}}</h1>
        <div>RFC: {{empresa.rfc}}</div>
        <div class="tiny">{{empresa.domicilio}}</div>
        <div>REG. PATRONAL: {{empresa.registroPatronal}}</div>
        <div class="tiny" style="margin-top:4px;text-align:left">
          REGIMEN FISCAL: {{empresa.regimenFiscal}}<br/>
          EXPEDIDO EN: {{empresa.expedidoEn}}
        </div>
      </td>
      <td style="width:38%;padding:0;vertical-align:top">
        <div class="hdr">FECHA</div>
        <div class="cell">{{cfdi.fecha}}</div>
        <div class="hdr">CERTIFICADO DIGITAL EMISOR</div>
        <div class="cell tiny">{{cfdi.certificadoEmisor}}</div>
        <div class="hdr">FOLIO FISCAL</div>
        <div class="cell tiny">{{cfdi.uuid}}</div>
        <div class="hdr">CERTIFICADO DIGITAL SAT</div>
        <div class="cell tiny">{{cfdi.certificadoSat}}</div>
        <div class="hdr">FECHA DE CERTIFICACIÓN</div>
        <div class="cell">{{cfdi.fechaCertificacion}}</div>
      </td>
    </tr>
  </table>

  <table class="box" style="border-top:0">
    <tr>
      <td style="width:62%;vertical-align:top;padding:0">
        <div class="hdr">COLABORADOR</div>
        <table class="kv" style="border:0">
          <tr><td class="lab" style="width:28%;border:0">No.</td><td class="val" style="border:0">{{empleado.numEmpleado}}</td></tr>
          <tr><td class="lab" style="border:0">NOMBRE</td><td class="val" style="border:0">{{empleado.nombre}}</td></tr>
          <tr><td class="lab" style="border:0">RFC</td><td style="border:0">{{empleado.rfc}}</td></tr>
          <tr><td class="lab" style="border:0">NUM. SEG. SOCIAL</td><td style="border:0">{{empleado.nss}}</td></tr>
          <tr><td class="lab" style="border:0">REG.FISCAL</td><td style="border:0">{{empleado.regimenFiscal}}</td></tr>
          <tr><td class="lab" style="border:0">CURP</td><td style="border:0">{{empleado.curp}}</td></tr>
          <tr><td class="lab" style="border:0">INGRESO</td><td style="border:0">{{empleado.fechaIngreso}}</td></tr>
          <tr><td class="lab" style="border:0">C.P.</td><td style="border:0">{{empleado.codigoPostal}}</td></tr>
          <tr><td class="lab" style="border:0">DOMICILIO</td><td class="tiny" style="border:0">{{empleado.domicilio}}</td></tr>
        </table>
      </td>
      <td style="width:38%;vertical-align:top;padding:0">
        <div class="hdr">COMPROBANTE</div>
        <table class="kv" style="border:0">
          <tr><td class="lab" style="width:48%;border:0">TIPO COMPROBANTE</td><td style="border:0">{{cfdi.tipoComprobante}}</td></tr>
          <tr><td class="lab" style="border:0">FORMA DE PAGO</td><td style="border:0">{{cfdi.formaPago}}</td></tr>
          <tr><td class="lab" style="border:0">METODO DE PAGO</td><td style="border:0">{{cfdi.metodoPago}}</td></tr>
          <tr><td class="lab" style="border:0">USO CFDI</td><td style="border:0">{{cfdi.usoCfdi}}</td></tr>
          <tr><td class="lab" style="border:0">SERIE / FOLIO</td><td style="border:0">{{cfdi.serie}}-{{cfdi.folio}}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <table>
    <thead>
      <tr>
        <th>CLAVE SERV</th><th>CANTIDAD</th><th>UNIDAD</th><th>DESCRIPCIÓN</th>
        <th>VALOR UNITARIO</th><th>IMPORTE</th><th>DESCUENTO</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>{{cfdi.claveProdServ}}</td>
        <td class="num">1</td>
        <td>ACT</td>
        <td>Pago de nómina</td>
        <td class="num">{{recibo.totalPercepciones}}</td>
        <td class="num">{{recibo.totalPercepciones}}</td>
        <td class="num">{{recibo.totalDeducciones}}</td>
      </tr>
    </tbody>
  </table>

  <div class="hdr box" style="border-top:0">DETALLE</div>
  <div class="grid6">
    <div><span class="lab">NÓMINA</span><br/>{{periodo.numeroPeriodo}}</div>
    <div><span class="lab">TIPO</span><br/>{{periodo.tipoNominaLabel}}</div>
    <div><span class="lab">FECHA INICIAL</span><br/>{{periodo.fechaInicio}}</div>
    <div><span class="lab">FECHA FINAL</span><br/>{{periodo.fechaFin}}</div>
    <div><span class="lab">DIAS PAGADOS</span><br/>{{recibo.diasPagados}}</div>
    <div><span class="lab">FECHA PAGO</span><br/>{{periodo.fechaPago}}</div>
  </div>
  <div class="grid6">
    <div><span class="lab">UBICACION</span><br/>{{empleado.ubicacion}}</div>
    <div><span class="lab">CENTRO DE COSTO</span><br/>{{empleado.centroCosto}}</div>
    <div><span class="lab">DEPARTAMENTO</span><br/>{{empleado.departamento}}</div>
    <div><span class="lab">PUESTO</span><br/>{{empleado.puesto}}</div>
    <div><span class="lab">PERIODO</span><br/>{{periodo.tipoPeriodo}}</div>
    <div><span class="lab">TIPO REGIMEN</span><br/>{{empleado.tipoRegimen}}</div>
  </div>
  <div class="grid6">
    <div><span class="lab">TIPO CONTRATO</span><br/>{{empleado.tipoContrato}}</div>
    <div><span class="lab">PERIODICIDAD PAGO</span><br/>{{periodo.periodicidadPago}}</div>
    <div><span class="lab">RIESGO PUESTO</span><br/>{{empleado.riesgoPuesto}}</div>
    <div><span class="lab">TIPO JORNADA</span><br/>{{empleado.tipoJornada}}</div>
    <div><span class="lab">ANTIGUEDAD</span><br/>{{empleado.antiguedad}}</div>
    <div><span class="lab">SINDICALIZADO</span><br/>{{empleado.sindicalizado}}</div>
  </div>
  <div class="grid6">
    <div><span class="lab">S.D.I.</span><br/><span class="num" style="display:block">{{empleado.sdi}}</span></div>
    <div><span class="lab">BANCO</span><br/>{{empleado.banco}}</div>
    <div><span class="lab">CUENTA</span><br/>{{empleado.cuenta}}</div>
    <div><span class="lab">S.B.C.</span><br/><span class="num" style="display:block">{{empleado.sbc}}</span></div>
    <div><span class="lab">CLAVE ENT. FED.</span><br/>{{empleado.entidadFederativa}}</div>
    <div><span class="lab">SUELDO DIARIO</span><br/><span class="num" style="display:block">{{empleado.salarioDiario}}</span></div>
  </div>

  <div class="row2" style="margin-top:4px">
    <div>
      <table>
        <thead>
          <tr><th colspan="6" class="hdr">PERCEPCIONES</th></tr>
          <tr><th>SAT</th><th>DESCRIPCIÓN</th><th>GRAVADO</th><th>EXENTO</th><th>IMPORTE</th><th>SALDO/ACUM</th></tr>
        </thead>
        <tbody>
{{#percepciones}}
          <tr>
            <td>{{sat}}</td>
            <td>{{nombre}}</td>
            <td class="num">{{gravado}}</td>
            <td class="num">{{exento}}</td>
            <td class="num">{{importe}}</td>
            <td class="num">{{acumulado}}</td>
          </tr>
{{/percepciones}}
          <tr>
            <td colspan="4" class="num"><strong>TOTAL</strong></td>
            <td class="num"><strong>{{recibo.totalPercepciones}}</strong></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div>
      <table>
        <thead>
          <tr><th colspan="4" class="hdr">DEDUCCIONES</th></tr>
          <tr><th>SAT</th><th>DESCRIPCIÓN</th><th>IMPORTE</th><th>SALDO/ACUM</th></tr>
        </thead>
        <tbody>
{{#deducciones}}
          <tr>
            <td>{{sat}}</td>
            <td>{{nombre}}</td>
            <td class="num">{{importe}}</td>
            <td class="num">{{acumulado}}</td>
          </tr>
{{/deducciones}}
          <tr>
            <td colspan="2" class="num"><strong>TOTAL</strong></td>
            <td class="num"><strong>{{recibo.totalDeducciones}}</strong></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <table style="margin-top:4px">
    <thead>
      <tr><th colspan="4">OTROS PAGOS</th></tr>
      <tr><th>TIPO OTRO PAGO</th><th>CLAVE</th><th>CONCEPTO</th><th>IMPORTE</th></tr>
    </thead>
    <tbody>
{{#otrosPagos}}
      <tr><td>{{sat}}</td><td>{{codigo}}</td><td>{{nombre}}</td><td class="num">{{importe}}</td></tr>
{{/otrosPagos}}
      <tr>
        <td colspan="2"><span class="lab">SUBSIDIO AL EMPLEO</span> {{recibo.subsidioEmpleo}}</td>
        <td colspan="2"><span class="lab">SUBSIDIO CAUSADO</span> {{recibo.subsidioCausado}}</td>
      </tr>
    </tbody>
  </table>

  <div class="hdr box" style="margin-top:4px">RESUMEN</div>
  <div class="grid4">
    <div><span class="lab">PERCEPCIONES</span><br/><strong>{{recibo.totalPercepciones}}</strong></div>
    <div><span class="lab">DEDUCCIONES</span><br/><strong>{{recibo.totalDeducciones}}</strong></div>
    <div><span class="lab">OTROS PAGOS</span><br/><strong>{{recibo.totalOtrosPagos}}</strong></div>
    <div><span class="lab">TOTAL</span><br/><strong>{{recibo.netoPagar}}</strong></div>
  </div>

  <p class="legal">
    Recibí de <strong>{{empresa.razonSocial}}</strong> la cantidad neta de este comprobante por concepto de mi salario
    y demás percepciones, y estoy de acuerdo con las deducciones que se especifican. Este documento es una
    representación impresa de un CFDI.
  </p>

  <table>
    <tr>
      <td style="width:58%;border:0;vertical-align:top">
        <div><span class="lab">CANTIDAD CON LETRA</span><br/><strong>{{recibo.cantidadLetra}}</strong></div>
        <div class="firma">FIRMA</div>
      </td>
      <td style="width:42%;border:0;vertical-align:top">
        <table>
          <tr><td>EN ESPECIE</td><td class="num">{{recibo.enEspecie}}</td></tr>
          <tr><td>SUB TOTAL</td><td class="num">{{recibo.totalPercepciones}}</td></tr>
          <tr><td>DESCUENTOS</td><td class="num">{{recibo.totalDeducciones}}</td></tr>
          <tr><td><strong>TOTAL</strong></td><td class="num"><strong>{{recibo.netoPagar}}</strong></td></tr>
        </table>
      </td>
    </tr>
  </table>

  <div class="row2" style="margin-top:8px;gap:8px">
    <div style="flex:0 0 120px">
      <img class="qr" alt="QR CFDI" src="{{cfdi.qrUrl}}"/>
    </div>
    <div style="flex:1">
      <div class="sello"><strong>CADENA ORIGINAL DEL TIMBRE</strong><br/>{{cfdi.cadenaOriginal}}</div>
      <div class="sello"><strong>SELLO DIGITAL DEL EMISOR</strong><br/>{{cfdi.selloEmisor}}</div>
      <div class="sello"><strong>SELLO DIGITAL SAT</strong><br/>{{cfdi.selloSat}}</div>
    </div>
  </div>
  <div class="foot">
    <span>CFDI 4.0 - Nomina 1.2</span>
    <span>ESTE DOCUMENTO ES UNA REPRESENTACIÓN IMPRESA DE UN CFDI</span>
    <span>Hoja 1 / 1</span>
  </div>
</body>
</html>`;

module.exports = { PLANTILLA_PDF_CFDI };
