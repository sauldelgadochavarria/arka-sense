'use strict';

/**
 * Cliente HTTP mínimo para PAC SW Sapien.
 * En modoReal=false no se llama a la red (el proceso de timbrado simula).
 */

async function authenticateSw({ urlAuth, usuario, password, timeoutMs = 30000 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlAuth, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        user: usuario,
        password
      },
      signal: ctrl.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.message || body.messageDetail || `HTTP ${res.status}`;
      throw new Error(`Auth PAC: ${msg}`);
    }
    const token = body.data?.token || body.token || body.data;
    if (!token) throw new Error('Auth PAC: sin token');
    return { token: String(token), raw: body };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Timbrado JSON v4 (stub de envío). El payload CFDI completo se construirá en fase siguiente.
 */
async function timbrarJsonSw({ urlTimbrado, token, payload, timeoutMs = 30000 }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlTimbrado, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.message || body.messageDetail || `HTTP ${res.status}`;
      throw new Error(`Timbrado PAC: ${msg}`);
    }
    return body;
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
  uuidSimulado
};
