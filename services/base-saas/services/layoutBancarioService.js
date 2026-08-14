'use strict';

/**
 * Motor de layouts bancarios: header (lote) + detalle (por recibo) + footer (lote).
 * Modos: ancho_fijo | delimitado | xml
 */

function getByPath(obj, path) {
  if (!path) return undefined;
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function pad(str, len, side = 'right', fill = ' ') {
  const s = String(str ?? '');
  if (len <= 0) return s;
  if (s.length > len) return s.slice(0, len);
  const padLen = len - s.length;
  const filler = fill.repeat(padLen);
  return side === 'left' ? filler + s : s + filler;
}

function formatDateValue(val, formato) {
  if (val == null || val === '') return '';
  const d = val instanceof Date ? val : new Date(val);
  if (Number.isNaN(d.getTime())) return String(val);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  const f = String(formato || '').toLowerCase();
  if (f === 'ddmmaaaa' || f === 'ddmmyyyy') return `${dd}${mm}${yyyy}`;
  if (f === 'aaaammdd' || f === 'yyyymmdd') return `${yyyy}${mm}${dd}`;
  if (f === 'dd-mm-aaaa' || f === 'dd-mm-yyyy') return `${dd}-${mm}-${yyyy}`;
  if (f === 'yyyy-mm-dd' || f === 'aaaa-mm-dd') return `${yyyy}-${mm}-${dd}`;
  return `${dd}${mm}${yyyy}`;
}

function formatMoneyZeros(val, longitud) {
  const n = Number(val) || 0;
  const fixed = Math.abs(n).toFixed(2);
  const [ent, dec] = fixed.split('.');
  const withDot = `${ent}.${dec}`;
  const withoutDot = `${ent}${dec}`;
  // Por defecto con punto (0000000.00). Si longitud encaja mejor sin punto, usarlo.
  let raw = withDot;
  if (longitud > 0 && withDot.length > longitud && withoutDot.length <= longitud) {
    raw = withoutDot;
  }
  return pad(raw, longitud || raw.length, 'left', '0');
}

/**
 * Si no hay path pero sí literal → tratar como literal (aunque el formato diga align.*).
 */
function effectiveFormato(campo = {}) {
  const path = String(campo.path || '').trim();
  const formato = String(campo.formato || 'align.izq').toLowerCase().trim();
  if (formato === 'space') return 'space';
  if (formato === 'literal') return 'literal';
  if (!path && campo.literal != null && String(campo.literal) !== '') return 'literal';
  return formato;
}

function formatCampo(value, campo = {}) {
  const formato = effectiveFormato(campo);
  const len = Number(campo.longitud) || 0;

  if (formato === 'space') {
    return pad('', len || 0, 'right', ' ');
  }
  if (formato === 'literal') {
    return pad(
      campo.literal != null ? campo.literal : '',
      len || String(campo.literal || '').length,
      'right',
      ' '
    );
  }

  if (
    formato === 'ddmmaaaa' ||
    formato === 'dd-mm-aaaa' ||
    formato === 'aaaammdd' ||
    formato === 'ddmmyyyy' ||
    formato === 'yyyy-mm-dd'
  ) {
    const formatted = formatDateValue(value, formato);
    return pad(formatted, len || formatted.length, 'right', ' ');
  }

  if (formato === '0000000.00' || /\.00$/.test(formato) || formato.includes('0.00')) {
    return formatMoneyZeros(value, len);
  }

  if (formato === '000' || /^0+$/.test(formato)) {
    const digits = String(value == null ? '' : value).replace(/\D/g, '');
    return pad(digits, len || formato.length || digits.length || 1, 'left', '0');
  }

  const text = value == null ? '' : String(value);
  if (formato === 'align.der' || formato === 'align.derech' || formato === 'right') {
    return pad(text, len || text.length, 'left', ' ');
  }
  return pad(text, len || text.length, 'right', ' ');
}

function addDays(base, days) {
  const d = base instanceof Date ? new Date(base.getTime()) : new Date(base);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d;
}

function startOfUtcDay(d = new Date()) {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  if (Number.isNaN(x.getTime())) return new Date();
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

/**
 * Resuelve el valor de un campo, incluyendo fechas dinámicas:
 * - fecha.hoy
 * - fecha.hoyMas (+ diasOffset)
 * - fecha.hoy_mas_N (atajo en el path)
 * - lote.fechaPago / lote.fechaGeneracion (captura en generación)
 */
function resolveCampoValue(campo, ctx) {
  const path = String(campo?.path || '').trim();
  const formato = String(campo?.formato || '').toLowerCase();
  if (formato === 'literal' || formato === 'space') return null;

  const hoy = ctx?.fecha?.hoy || startOfUtcDay(ctx?.lote?.fechaGeneracion || new Date());

  if (!path) return campo?.literal;

  if (path === 'fecha.hoy' || path === 'hoy') {
    return hoy;
  }

  // fecha.hoyMas | fecha.hoy_mas | fecha.hoy+N | fecha.hoy_mas_N
  const mAtajo = path.match(/^fecha\.hoy(?:Mas|_mas|\+)(\d+)?$/i);
  if (path === 'fecha.hoyMas' || path === 'fecha.hoy_mas' || mAtajo) {
    const fromPath = mAtajo && mAtajo[1] != null ? Number(mAtajo[1]) : null;
    const n = fromPath != null && !Number.isNaN(fromPath) ? fromPath : Number(campo.diasOffset) || 0;
    return addDays(hoy, n);
  }

  const mMas = path.match(/^fecha\.hoy_mas_(-?\d+)$/i);
  if (mMas) {
    return addDays(hoy, Number(mMas[1]));
  }

  return getByPath(ctx, path);
}

function sortCampos(campos = []) {
  return [...campos].sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
}

function renderCamposFijos(campos, ctx) {
  return sortCampos(campos)
    .map((c) => {
      const fmt = effectiveFormato(c);
      if (fmt === 'literal' || fmt === 'space') {
        return formatCampo(null, { ...c, formato: fmt });
      }
      const val = resolveCampoValue(c, ctx);
      return formatCampo(val, c);
    })
    .join('');
}

function renderCamposDelimitados(campos, ctx, delimitador) {
  const sep = delimitador == null ? ',' : String(delimitador);
  return sortCampos(campos)
    .map((c) => {
      const fmt = effectiveFormato(c);
      if (fmt === 'literal') {
        return String(c.literal ?? '');
      }
      if (fmt === 'space') {
        return '';
      }
      const val = resolveCampoValue(c, ctx);
      const formatted = formatCampo(val, { ...c, longitud: Number(c.longitud) || 0 });
      const needsQuote = sep && String(formatted).includes(sep);
      return needsQuote ? `"${String(formatted).replace(/"/g, '""')}"` : formatted;
    })
    .join(sep);
}

function applyTemplate(tpl, ctx) {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    const v = resolveCampoValue({ path }, ctx);
    if (v == null) return '';
    if (v instanceof Date) return formatDateValue(v, 'aaaammdd');
    return String(v);
  });
}

function buildFechaContext(opts = {}) {
  const hoy = startOfUtcDay(opts.ahora || opts.fechaGeneracion || new Date());
  return {
    hoy,
    /** Helper documentado; el path fecha.hoyMas usa diasOffset del campo */
    hoyMas: hoy
  };
}

function withFechaCtx(base, opts) {
  const fecha = buildFechaContext(opts);
  const lote = { ...(base.lote || {}) };
  if (!lote.fechaGeneracion) lote.fechaGeneracion = fecha.hoy;
  if (!lote.fechaPago) lote.fechaPago = opts.fechaPago || lote.fechaGeneracion;
  return { ...base, lote, fecha };
}

function renderSeccion(layout, seccionNombre, ctx) {
  const modo = layout.modo || 'ancho_fijo';
  const campos = layout[seccionNombre] || [];
  if (modo === 'xml') {
    // XML de sección usa plantillas solo a nivel documento/detalle
    return renderCamposFijos(campos, ctx);
  }
  if (modo === 'delimitado') {
    return renderCamposDelimitados(campos, ctx, layout.delimitador);
  }
  return renderCamposFijos(campos, ctx);
}

/**
 * @param {object} layout
 * @param {object} opts
 * @param {object} opts.lote
 * @param {object} opts.periodo
 * @param {object} opts.empresa
 * @param {Array<{ empleado: object, recibo: object }>} opts.items
 * @returns {{ contenido: string, lineas: number, encoding: string }}
 */
function renderLayoutBancario(layout, opts = {}) {
  const finLinea = layout.finLinea != null ? layout.finLinea : '\n';
  const encoding = layout.encoding || 'utf8';
  const periodo = opts.periodo || {};
  const empresa = opts.empresa || {};
  const items = Array.isArray(opts.items) ? opts.items : [];
  const fechaOpts = {
    ahora: opts.ahora,
    fechaGeneracion: opts.lote?.fechaGeneracion || opts.fechaGeneracion,
    fechaPago: opts.lote?.fechaPago || opts.fechaPago
  };

  const ctxLote = withFechaCtx(
    { lote: opts.lote || {}, periodo, empresa },
    fechaOpts
  );

  if (layout.modo === 'xml') {
    const headerTxt = layout.header?.length
      ? renderSeccion(layout, 'header', ctxLote)
      : '';
    const footerTxt = layout.footer?.length
      ? renderSeccion(layout, 'footer', ctxLote)
      : '';
    const detalleParts = items.map((it) => {
      const ctx = withFechaCtx(
        {
          lote: ctxLote.lote,
          periodo,
          empresa,
          empleado: it.empleado || {},
          recibo: it.recibo || {}
        },
        fechaOpts
      );
      if (layout.xmlPlantillaDetalle) {
        return applyTemplate(layout.xmlPlantillaDetalle, ctx);
      }
      return renderSeccion(layout, 'detalle', ctx);
    });
    const detalleJoined = detalleParts.join(finLinea);
    let contenido;
    if (layout.xmlPlantillaDocumento) {
      contenido = applyTemplate(layout.xmlPlantillaDocumento, {
        ...ctxLote,
        header: headerTxt,
        detalle: detalleJoined,
        footer: footerTxt
      });
    } else {
      contenido = [headerTxt, detalleJoined, footerTxt].filter(Boolean).join(finLinea);
    }
    return { contenido, lineas: detalleParts.length, encoding };
  }

  const lines = [];
  if (layout.header?.length) {
    lines.push(renderSeccion(layout, 'header', ctxLote));
  }
  for (const it of items) {
    const ctx = withFechaCtx(
      {
        lote: ctxLote.lote,
        periodo,
        empresa,
        empleado: it.empleado || {},
        recibo: it.recibo || {}
      },
      fechaOpts
    );
    lines.push(renderSeccion(layout, 'detalle', ctx));
  }
  if (layout.footer?.length) {
    lines.push(renderSeccion(layout, 'footer', ctxLote));
  }

  return {
    contenido: lines.join(finLinea) + (lines.length ? finLinea : ''),
    lineas: lines.length,
    encoding
  };
}

/**
 * Construye lote a partir de items (netos).
 */
function buildLoteContext(items, extras = {}) {
  let total = 0;
  for (const it of items) {
    total += Number(it?.recibo?.neto) || 0;
  }
  return {
    cantidadRecibos: items.length,
    totalPagar: Math.round(total * 100) / 100,
    fechaGeneracion: extras.fechaGeneracion || new Date(),
    fechaPago: extras.fechaPago || extras.fechaGeneracion || new Date(),
    secuencia: extras.secuencia || ''
  };
}

/**
 * Normaliza empleado/recibo operativos o históricos al shape del layout.
 */
function normalizeEmpleadoLayout(emp = {}) {
  const db = emp.datosBancarios || {};
  const nombre =
    emp.nombre ||
    `${emp.firstName || ''} ${emp.lastName || ''}`.trim() ||
    `${emp.firstName || ''} ${emp.apellidoPaterno || ''} ${emp.apellidoMaterno || ''}`.trim();
  return {
    numEmpleado: emp.numEmpleado || '',
    nombre,
    curp: emp.curp || '',
    rfc: emp.rfc || '',
    banco: db.bancoCodigo || emp.banco || '',
    bancoNombre: db.bancoNombre || emp.bancoNombre || '',
    cuenta: db.cuenta || emp.cuenta || '',
    clabe: db.clabe || emp.clabe || ''
  };
}

function normalizeReciboLayout(recibo = {}) {
  return {
    neto: recibo.neto != null ? recibo.neto : recibo.netoPagar,
    percepciones: recibo.percepciones != null ? recibo.percepciones : recibo.totalPercepciones,
    deducciones: recibo.deducciones != null ? recibo.deducciones : recibo.totalDeducciones,
    diasLaborados: recibo.diasLaborados || 0,
    calculoId: recibo.calculoId || ''
  };
}

function normalizePeriodoLayout(periodo = {}) {
  const nombre =
    periodo.nombre ||
    [
      periodo.tipoPeriodo || '',
      periodo.numeroPeriodo != null ? `#${periodo.numeroPeriodo}` : '',
      periodo.anio || ''
    ]
      .filter(Boolean)
      .join(' ');
  return {
    nombre,
    numeroPeriodo: periodo.numeroPeriodo,
    tipoPeriodo: periodo.tipoPeriodo || '',
    tipoNomina: periodo.tipoNomina || '',
    fechaInicio: periodo.fechaInicio,
    fechaFin: periodo.fechaFin,
    anio: periodo.anio
  };
}

module.exports = {
  getByPath,
  formatCampo,
  resolveCampoValue,
  renderLayoutBancario,
  buildLoteContext,
  buildFechaContext,
  normalizeEmpleadoLayout,
  normalizeReciboLayout,
  normalizePeriodoLayout,
  applyTemplate,
  addDays
};
