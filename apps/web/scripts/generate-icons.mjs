#!/usr/bin/env node
/**
 * Génère public/icons/icon-192.png et icon-512.png sans dépendance :
 * encodeur PNG minimal (zlib + CRC32) et rastérisation vectorielle
 * sur-échantillonnée (4×4) du logo — fond vert forêt #1F4D28, montagne
 * beige #F4F1EA, soleil orange sécurité #D9822B (même dessin que icon.svg).
 *
 * Les deux images sont « plein cadre » (sans coins arrondis transparents) :
 * c'est le format attendu par les icônes maskables (PWA) et par iOS, qui
 * appliquent eux-mêmes leur masque. Le motif tient dans la zone sûre (80 %).
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/* ---------- Couleurs ---------- */
const BG = [0x1f, 0x4d, 0x28];
const MOUNTAIN = [0xf4, 0xf1, 0xea];
const SUN = [0xd9, 0x82, 0x2b];

/* ---------- Dessin dans le repère 64×64 de icon.svg ---------- */
/** M8 48 24 22 l8 12 6 -8 18 22 Z */
const MOUNTAIN_POLY = [
  [8, 48],
  [24, 22],
  [32, 34],
  [38, 26],
  [56, 48],
];
const SUN_CIRCLE = { cx: 46, cy: 16, r: 5 };

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInCircle(x, y, { cx, cy, r }) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Couleur d'un point (repère 64×64) : soleil > montagne > fond. */
function sample(x, y) {
  if (pointInCircle(x, y, SUN_CIRCLE)) return SUN;
  if (pointInPolygon(x, y, MOUNTAIN_POLY)) return MOUNTAIN;
  return BG;
}

/** Rastérise l'icône en RGBA (sur-échantillonnage 4×4 pour des bords lisses). */
function raster(size) {
  const SS = 4;
  const safe = 0.8; // zone sûre maskable
  const scale = (size * safe) / 64;
  const offset = (size * (1 - safe)) / 2;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS - offset) / scale;
          const y = (py + (sy + 0.5) / SS - offset) / scale;
          const c = sample(x, y);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const n = SS * SS;
      const i = (py * size + pxi) * 4;
      px[i] = Math.round(r / n);
      px[i + 1] = Math.round(g / n);
      px[i + 2] = Math.round(b / n);
      px[i + 3] = 255;
    }
  }
  return px;
}

/* ---------- Encodeur PNG ---------- */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur 8 bits
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Filtre 0 (None) devant chaque ligne
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, raster(size)));
  console.log(`✓ ${file}`);
}
