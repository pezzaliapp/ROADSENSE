/**
 * ROAD SENSE - decodificatore minimale di Mapbox Vector Tile.
 *
 * Usato SOLO da `scripts/build-demo-route.mjs`, in fase di sviluppo, per
 * generare una volta sola la route della DEMO MODE. Non entra nel bundle e non
 * viene eseguito dall'applicazione.
 *
 * Implementa il sottoinsieme di protobuf necessario alla specifica MVT 2.1,
 * per non aggiungere dipendenze al progetto.
 */

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  get atEnd() {
    return this.pos >= this.buf.length;
  }
  varint() {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }
  tag() {
    const v = this.varint();
    return { field: v >>> 3, wire: v & 0x7 };
  }
  bytes() {
    const len = this.varint();
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }
  string() {
    return Buffer.from(this.bytes()).toString('utf8');
  }
  double() {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }
  float() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`wire type non supportato: ${wire}`);
  }
}

const zigzag = (n) => (n >>> 1) ^ -(n & 1);

function readValue(buf) {
  const r = new Reader(buf);
  while (!r.atEnd) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) return r.string();
    if (field === 2 && wire === 5) return r.float();
    if (field === 3 && wire === 1) return r.double();
    if (field === 4 && wire === 0) return r.varint();
    if (field === 5 && wire === 0) return r.varint();
    if (field === 6 && wire === 0) return zigzag(r.varint());
    if (field === 7 && wire === 0) return r.varint() !== 0;
    r.skip(wire);
  }
  return null;
}

/** Decodifica la geometria: comandi MoveTo / LineTo / ClosePath. */
function readGeometry(buf) {
  const r = new Reader(buf);
  const lines = [];
  let current = null;
  let x = 0;
  let y = 0;
  while (!r.atEnd) {
    const cmdInt = r.varint();
    const cmd = cmdInt & 0x7;
    const count = cmdInt >> 3;
    if (cmd === 1) {
      for (let i = 0; i < count; i++) {
        x += zigzag(r.varint());
        y += zigzag(r.varint());
        current = [[x, y]];
        lines.push(current);
      }
    } else if (cmd === 2) {
      for (let i = 0; i < count; i++) {
        x += zigzag(r.varint());
        y += zigzag(r.varint());
        if (current) current.push([x, y]);
      }
    } else if (cmd === 7) {
      if (current && current.length > 0) current.push([...current[0]]);
    }
  }
  return lines;
}

function readFeature(buf, keys, values) {
  const r = new Reader(buf);
  let type = 0;
  let tags = [];
  let geometry = [];
  while (!r.atEnd) {
    const { field, wire } = r.tag();
    if (field === 2 && wire === 2) {
      const sub = new Reader(r.bytes());
      tags = [];
      while (!sub.atEnd) tags.push(sub.varint());
    } else if (field === 3 && wire === 0) {
      type = r.varint();
    } else if (field === 4 && wire === 2) {
      geometry = readGeometry(r.bytes());
    } else {
      r.skip(wire);
    }
  }
  const props = {};
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const k = keys[tags[i]];
    if (k !== undefined) props[k] = values[tags[i + 1]];
  }
  return { type, props, geometry };
}

function readLayer(buf) {
  const r = new Reader(buf);
  const layer = { name: '', extent: 4096, features: [] };
  const keys = [];
  const values = [];
  const rawFeatures = [];
  while (!r.atEnd) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) layer.name = r.string();
    else if (field === 2 && wire === 2) rawFeatures.push(r.bytes());
    else if (field === 3 && wire === 2) keys.push(r.string());
    else if (field === 4 && wire === 2) values.push(readValue(r.bytes()));
    else if (field === 5 && wire === 0) layer.extent = r.varint();
    else r.skip(wire);
  }
  layer.features = rawFeatures.map((f) => readFeature(f, keys, values));
  return layer;
}

export function decodeTile(buffer) {
  const r = new Reader(buffer);
  const layers = {};
  while (!r.atEnd) {
    const { field, wire } = r.tag();
    if (field === 3 && wire === 2) {
      const layer = readLayer(r.bytes());
      layers[layer.name] = layer;
    } else {
      r.skip(wire);
    }
  }
  return layers;
}

export function tileToLonLat(z, tx, ty, px, py, extent) {
  const n = 2 ** z;
  const lon = ((tx + px / extent) / n) * 360 - 180;
  const yy = Math.PI - 2 * Math.PI * ((ty + py / extent) / n);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy)));
  return [lon, lat];
}

export function lonLatToTile(z, lon, lat) {
  const n = 2 ** z;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x: Math.floor(x), y: Math.floor(y) };
}
