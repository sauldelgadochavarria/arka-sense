'use strict';

/**
 * ZIP mínimo (método store, sin compresión). Suficiente para empaquetar XML/HTML.
 * Evita dependencia externa (archiver/jszip).
 */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * @param {{ name: string, data: Buffer|string }[]} entries
 * @returns {Buffer}
 */
function buildZipStore(entries = []) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = String(entry.name || 'file').replace(/\\/g, '/');
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data == null ? '' : String(entry.data), 'utf8');
    const crc = crc32(data);
    const size = data.length;

    const local =
      Buffer.concat([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBuf.length),
        u16(0),
        nameBuf,
        data
      ]);

    const central =
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBuf.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBuf
      ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end =
    Buffer.concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(centrals.length),
      u16(centrals.length),
      u32(centralDir.length),
      u32(offset),
      u16(0)
    ]);

  return Buffer.concat([...locals, centralDir, end]);
}

module.exports = { buildZipStore, crc32 };
