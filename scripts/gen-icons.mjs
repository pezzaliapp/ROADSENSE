/**
 * ROAD SENSE - generatore di icone PNG.
 *
 * Genera le icone della PWA senza alcuna dipendenza esterna: disegna i pixel
 * a mano e li codifica in PNG usando solo `node:zlib`.
 * Motivo: niente pacchetti grafici da installare, niente asset binari opachi
 * nel repository, icone riproducibili con `npm run icons`.
 *
 * Disegno: triangolo di allerta ambra su fondo scuro, con un punto al centro
 * (il "sensore"). Coerente con il pulsante "△ SEGNALA".
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'public', 'icons');

const BG = [0x0b, 0x0e, 0x11];
const FG = [0xff, 0xb0, 0x20];

/** Distanza con segno di un punto dal lato di un triangolo (per antialiasing). */
function edgeDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return ((px - ax) * dy - (py - ay) * dx) / len;
}

/**
 * Copertura del triangolo nel punto (x, y), 0..1, con bordo sfumato di 1 px.
 * `inset` restringe il triangolo per ricavare il contorno cavo.
 */
function triangleCoverage(x, y, cx, cy, radius) {
  const pts = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
  let minDist = Infinity;
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % 3];
    // I vertici sono ordinati in senso orario nel sistema a y crescente verso
    // il basso: il segno va invertito perche' l'interno risulti positivo.
    minDist = Math.min(minDist, -edgeDistance(x, y, ax, ay, bx, by));
  }
  // minDist > 0 => interno. Sfumatura su 1 pixel.
  return Math.max(0, Math.min(1, minDist + 0.5));
}

function drawIcon(size, padding) {
  const cx = size / 2;
  const cy = size / 2 + size * 0.03; // il baricentro ottico di un triangolo e' basso
  const outer = size / 2 - padding;
  const inner = outer - size * 0.085; // spessore del contorno
  const dotR = size * 0.055;

  const pixels = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const outerCov = triangleCoverage(px, py, cx, cy, outer);
      const innerCov = triangleCoverage(px, py, cx, cy, inner);
      // Contorno = interno del triangolo grande meno interno di quello piccolo.
      let alpha = Math.max(0, outerCov - innerCov);

      // Punto centrale.
      const d = Math.hypot(px - cx, py - (cy + size * 0.07));
      alpha = Math.max(alpha, Math.max(0, Math.min(1, dotR - d + 0.5)));

      const i = (y * size + x) * 4;
      pixels[i] = Math.round(BG[0] + (FG[0] - BG[0]) * alpha);
      pixels[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * alpha);
      pixels[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * alpha);
      pixels[i + 3] = 255; // fondo opaco: richiesto per le icone maskable
    }
  }
  return pixels;
}

// -- codifica PNG (RGBA, 8 bit, filtro 0) -----------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "None"
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, size, paddingRatio) {
  const png = encodePng(size, drawIcon(size, size * paddingRatio));
  writeFileSync(resolve(OUT, name), png);
  console.log(`  ${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}

mkdirSync(OUT, { recursive: true });
console.log('ROAD SENSE - generazione icone');
write('icon-192.png', 192, 0.12);
write('icon-512.png', 512, 0.12);
// Le icone maskable vengono ritagliate: serve una zona di sicurezza ampia.
write('maskable-512.png', 512, 0.22);
write('apple-touch-icon.png', 180, 0.12);
