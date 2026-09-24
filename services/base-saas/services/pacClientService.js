'use strict';

/**
 * Cliente HTTP para PAC (SW Sapien y compatibles).
 * - JSON: Content-Type application/jsontoxml (emisión + timbrado)
 * - XML: multipart/form-data campo xml (emisión + timbrado, PAC genéricos)
 */

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function httpOk(status) {
  return status === 200 || status === 201;
}

function extractPacError(body, fallback) {
  const code = body.code ? `[${body.code}] ` : '';
  const msg = body.message || body.messageDetail || fallback;
  const detail =
    body.messageDetail && body.messageDetail !== body.message
      ? ` | ${body.messageDetail}`
      : '';
  return `${code}${msg}${detail}`;
}

function uuidFromTfd(tfd) {
  const m = String(tfd || '').match(/\bUUID="([^"]+)"/i);
  return m ? m[1] : '';
}

function extractCfdiXml(data = {}) {
  const candidates = [data.cfdi, data.xml, data.cfdiXml, data.CFDI, data.Xml];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

/** Log seguro: recorta xml/qr enormes pero deja ver estructura. */
function summarizePacBody(body) {
  if (!body || typeof body !== 'object') return body;
  const data = body.data && typeof body.data === 'object' ? { ...body.data } : body.data;
  if (data && typeof data === 'object') {
    for (const key of ['cfdi', 'xml', 'tfd', 'qrCode', 'cadenaOriginalSAT', 'selloSAT', 'selloCFDI']) {
      if (typeof data[key] === 'string' && data[key].length > 180) {
        data[key] = `${data[key].slice(0, 120)}…[len=${data[key].length}]`;
      }
    }
  }
  return {
    status: body.status,
    message: body.message,
    messageDetail: body.messageDetail,
    code: body.code,
    dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
    data
  };
}

function logPacResponse(label, httpStatus, rawText, body) {
  const preview = String(rawText || '').slice(0, 800);
  console.log(
    `[pac] ${label} http=${httpStatus} rawLen=${String(rawText || '').length} preview=${preview}`
  );
  console.log(`[pac] ${label} parsed=`, JSON.stringify(summarizePacBody(body), null, 2));
}

/**
 * Autentica con SW y obtiene token Bearer.
 * @returns {{ token: string, raw: object }}
 */
async function authenticateSw({ urlAuth, usuario, password, timeoutMs = 30000 }) {
  const user = String(usuario || '').trim();
  const pass = String(password || '');
  if (!user) throw new Error('Auth PAC: falta usuario (correo SW)');
  if (!pass) throw new Error('Auth PAC: falta contraseña');
  if (!urlAuth) throw new Error('Auth PAC: falta URL de autenticación');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlAuth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password: pass }),
      signal: ctrl.signal
    });
    const rawText = await res.text();
    const body = parseJsonSafe(rawText);
    logPacResponse('auth', res.status, rawText, body);

    if (!httpOk(res.status)) {
      throw new Error(`Auth PAC: ${extractPacError(body, `HTTP ${res.status}`)}`);
    }

    const token = body.data?.token;
    if (!token || typeof token !== 'string') {
      throw new Error(`Auth PAC: ${body.message || 'token no encontrado en data.token'}`);
    }

    return { token, raw: body };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Auth PAC: tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function parseStampResponse(body) {
  if (body.status === 'success' && body.data) {
    const d = body.data;
    const uuid = d.uuid || uuidFromTfd(d.tfd) || '';
    const xml = extractCfdiXml(d);
    if (!uuid) throw new Error('Timbrado PAC: respuesta OK pero sin UUID (ni en data.uuid ni en tfd)');
    return {
      uuid,
      xml,
      cadenaOriginal: d.cadenaOriginalSAT || '',
      selloSAT: d.selloSAT || '',
      selloCFDI: d.selloCFDI || '',
      noCertificadoSAT: d.noCertificadoSAT || '',
      fechaTimbrado: d.fechaTimbrado || '',
      qrCode: d.qrCode || '',
      tfd: d.tfd || '',
      raw: body
    };
  }
  throw new Error(`Timbrado PAC: ${extractPacError(body, 'estructura de respuesta inesperada')}`);
}

function isEmptyCfdiRequestError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('xml cfdi no proporcionado') || msg.includes('viene vacio') || msg.includes('viene vacío');
}

function buildMultipartXmlBody(xml) {
  const boundary = `----PayPilot${Date.now()}${Math.random().toString(16).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="xml"; filename="cfdi.xml"\r\n' +
    'Content-Type: application/xml; charset=utf-8\r\n\r\n' +
    `${xml}\r\n` +
    `--${boundary}--\r\n`;
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

/**
 * Timbra CFDI JSON (SW convierte JSON → XML y sella).
 */
async function timbrarJsonSw({ urlTimbrado, token, payload, timeoutMs = 30000 }) {
  if (!urlTimbrado) throw new Error('Timbrado PAC: falta URL de timbrado');
  if (!token) throw new Error('Timbrado PAC: falta token');

  const bodyStr = JSON.stringify(payload);
  if (!bodyStr || bodyStr === 'undefined' || bodyStr === 'null' || bodyStr === '{}') {
    throw new Error('Timbrado PAC: JSON del CFDI vacío o inválido antes de enviar');
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    console.log(
      `[pac] timbrar JSON url=${urlTimbrado} bodyBytes=${Buffer.byteLength(bodyStr, 'utf8')} keys=${Object.keys(payload || {}).join(',')}`
    );
    const res = await fetch(urlTimbrado, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/jsontoxml',
        Authorization: `Bearer ${token}`
      },
      body: bodyStr,
      signal: ctrl.signal
    });
    const rawText = await res.text();
    const body = parseJsonSafe(rawText);
    logPacResponse('timbrar-json', res.status, rawText, body);

    if (!httpOk(res.status) || body.status === 'error') {
      const detail = extractPacError(body, rawText || `HTTP ${res.status}`);
      const urlHint = res.status === 404 ? ` (${urlTimbrado})` : '';
      throw new Error(`Timbrado PAC: ${detail}${urlHint}`);
    }
    return parseStampResponse(body);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timbrado PAC: tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Timbra CFDI XML (multipart campo xml — SW issue/v4 y PAC genéricos).
 */
async function timbrarXmlSw({ urlTimbrado, token, xml, timeoutMs = 30000 }) {
  if (!urlTimbrado) throw new Error('Timbrado PAC: falta URL de timbrado');
  if (!token) throw new Error('Timbrado PAC: falta token');
  const xmlStr = String(xml || '').trim();
  if (!xmlStr) throw new Error('Timbrado PAC: XML vacío');

  const { body, contentType } = buildMultipartXmlBody(xmlStr);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    console.log(
      `[pac] timbrar XML url=${urlTimbrado} xmlBytes=${Buffer.byteLength(xmlStr, 'utf8')} starts=${xmlStr.slice(0, 80)}`
    );
    const res = await fetch(urlTimbrado, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${token}`
      },
      body,
      signal: ctrl.signal
    });
    const rawText = await res.text();
    const parsed = parseJsonSafe(rawText);
    logPacResponse('timbrar-xml', res.status, rawText, parsed);

    if (!httpOk(res.status) || parsed.status === 'error') {
      const detail = extractPacError(parsed, rawText || `HTTP ${res.status}`);
      const urlHint = res.status === 404 ? ` (${urlTimbrado})` : '';
      throw new Error(`Timbrado PAC: ${detail}${urlHint}`);
    }
    return parseStampResponse(parsed);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timbrado PAC: tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function deriveXmlUrlFromJsonUrl(urlTimbrado) {
  const url = String(urlTimbrado || '').trim();
  if (!url) return '';
  // /v3|v4/cfdi33/issue/json/v4 → /v4/cfdi33/issue/v4 (docs actuales SW)
  if (url.includes('/cfdi33/issue/json/')) {
    return url
      .replace('/v3/cfdi33/issue/json/', '/v4/cfdi33/issue/')
      .replace('/v4/cfdi33/issue/json/', '/v4/cfdi33/issue/');
  }
  if (url.includes('/issue/json/')) return url.replace('/issue/json/', '/issue/');
  if (url.includes('/json/v4')) return url.replace('/json/v4', '/v4');
  return url;
}

/**
 * Despacha timbrado según formato PAC (JSON | XML).
 * Si JSON falla con "Xml CFDI no proporcionado…", reintenta en XML multipart.
 */
async function timbrarCfdiSw({
  formato = 'JSON',
  urlTimbrado,
  urlTimbradoXml,
  token,
  jsonPayload,
  xmlPayload,
  timeoutMs
}) {
  const fmt = String(formato || 'JSON').toUpperCase();
  if (fmt === 'XML') {
    return timbrarXmlSw({
      urlTimbrado: urlTimbradoXml || deriveXmlUrlFromJsonUrl(urlTimbrado) || urlTimbrado,
      token,
      xml: xmlPayload,
      timeoutMs
    });
  }

  try {
    return await timbrarJsonSw({ urlTimbrado, token, payload: jsonPayload, timeoutMs });
  } catch (err) {
    const xmlUrl = urlTimbradoXml || deriveXmlUrlFromJsonUrl(urlTimbrado);
    if (isEmptyCfdiRequestError(err) && xmlPayload && xmlUrl) {
      console.warn(
        `[pac] JSON rechazado (${err.message}). Reintento automático en XML → ${xmlUrl}`
      );
      return timbrarXmlSw({ urlTimbrado: xmlUrl, token, xml: xmlPayload, timeoutMs });
    }
    throw err;
  }
}

/**
 * Cancela CFDI ante SW.
 * @returns {{ acuse: string, raw: object }}
 */
async function cancelarSw({
  urlCancelacion,
  token,
  uuid,
  rfcReceptor,
  motivo = '02',
  uuidSustitucion = '',
  timeoutMs = 30000
}) {
  if (!urlCancelacion) throw new Error('Cancel PAC: falta URL');
  if (!token) throw new Error('Cancel PAC: falta token');
  if (!uuid) throw new Error('Cancel PAC: falta UUID');

  const cancelData = {
    rfc: String(rfcReceptor || '').trim(),
    uuid: String(uuid).trim(),
    motivo: String(motivo || '02')
  };
  if (uuidSustitucion && motivo === '01') {
    cancelData.folioSustitucion = uuidSustitucion;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlCancelacion, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(cancelData),
      signal: ctrl.signal
    });
    const rawText = await res.text();
    const body = parseJsonSafe(rawText);
    logPacResponse('cancel', res.status, rawText, body);

    if (!httpOk(res.status)) {
      throw new Error(`Cancel PAC: ${extractPacError(body, `HTTP ${res.status}`)}`);
    }
    if (body.status !== 'success') {
      throw new Error(`Cancel PAC: ${extractPacError(body, 'cancelación rechazada')}`);
    }
    return { acuse: body.data?.acuse || '', raw: body };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Cancel PAC: tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

function uuidSimulado() {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`.toUpperCase();
}

module.exports = {
  authenticateSw,
  timbrarJsonSw,
  timbrarXmlSw,
  timbrarCfdiSw,
  cancelarSw,
  uuidSimulado,
  parseStampResponse,
  extractCfdiXml
};
