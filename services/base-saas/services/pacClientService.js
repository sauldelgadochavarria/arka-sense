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
  return `${code}${body.message || body.messageDetail || fallback}`;
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
    const uuid = d.uuid || '';
    if (!uuid) throw new Error('Timbrado PAC: respuesta OK pero sin UUID');
    return {
      uuid,
      xml: d.cfdi || d.xml || '',
      cadenaOriginal: d.cadenaOriginalSAT || '',
      selloSAT: d.selloSAT || '',
      selloCFDI: d.selloCFDI || '',
      noCertificadoSAT: d.noCertificadoSAT || '',
      fechaTimbrado: d.fechaTimbrado || '',
      qrCode: d.qrCode || '',
      raw: body
    };
  }
  throw new Error(`Timbrado PAC: ${extractPacError(body, 'estructura de respuesta inesperada')}`);
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

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlTimbrado, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/jsontoxml',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const rawText = await res.text();
    const body = parseJsonSafe(rawText);

    if (!httpOk(res.status)) {
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
  if (!xml || !String(xml).trim()) throw new Error('Timbrado PAC: XML vacío');

  const { body, contentType } = buildMultipartXmlBody(String(xml));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
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

    if (!httpOk(res.status)) {
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

/**
 * Despacha timbrado según formato PAC (JSON | XML).
 */
async function timbrarCfdiSw({ formato = 'JSON', urlTimbrado, token, jsonPayload, xmlPayload, timeoutMs }) {
  if (String(formato).toUpperCase() === 'XML') {
    return timbrarXmlSw({ urlTimbrado, token, xml: xmlPayload, timeoutMs });
  }
  return timbrarJsonSw({ urlTimbrado, token, payload: jsonPayload, timeoutMs });
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
  uuidSimulado
};
