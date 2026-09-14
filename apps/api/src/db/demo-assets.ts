import fs from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

/**
 * Génération de petites images PNG de démonstration (seed) : paysage stylisé
 * (ciel dégradé, crêtes, bandeau de couleur de catégorie). Aucune dépendance :
 * encodeur PNG minimal (RGB 8 bits, filtre 0, un seul IDAT).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export type Rgb = [number, number, number];

export interface DemoImageSpec {
  width: number;
  height: number;
  skyTop: Rgb;
  skyBottom: Rgb;
  ridgeFar: Rgb;
  ridgeNear: Rgb;
  band: Rgb;
  /** Graine pour varier le profil des crêtes. */
  seed: number;
}

function ridgeHeight(x: number, width: number, seed: number, base: number, amp: number): number {
  const t = (x / width) * Math.PI * 2;
  return (
    base +
    amp * (0.6 * Math.sin(t * 1.3 + seed) + 0.3 * Math.sin(t * 3.1 + seed * 1.7) + 0.1 * Math.sin(t * 7.3 + seed * 0.3))
  );
}

export function encodeDemoPng(spec: DemoImageSpec): Buffer {
  const { width, height } = spec;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const bandHeight = Math.round(height * 0.12);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filtre « None »
    for (let x = 0; x < width; x++) {
      const far = ridgeHeight(x, width, spec.seed, height * 0.45, height * 0.12);
      const near = ridgeHeight(x, width, spec.seed + 2.3, height * 0.68, height * 0.1);
      let px: Rgb;
      if (y >= height - bandHeight) px = spec.band;
      else if (y >= near) px = spec.ridgeNear;
      else if (y >= far) px = spec.ridgeFar;
      else {
        const k = y / Math.max(1, far);
        px = [
          Math.round(spec.skyTop[0] + (spec.skyBottom[0] - spec.skyTop[0]) * k),
          Math.round(spec.skyTop[1] + (spec.skyBottom[1] - spec.skyTop[1]) * k),
          Math.round(spec.skyTop[2] + (spec.skyBottom[2] - spec.skyTop[2]) * k),
        ];
      }
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 2; // couleur RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Écrit l'image dans `<uploadDir>/demo/<name>.png` et renvoie l'URL relative. */
export function writeDemoPng(uploadDir: string, name: string, spec: DemoImageSpec): { url: string; storagePath: string; bytes: number } {
  const dir = path.join(uploadDir, "demo");
  fs.mkdirSync(dir, { recursive: true });
  const png = encodeDemoPng(spec);
  fs.writeFileSync(path.join(dir, `${name}.png`), png);
  return { url: `/uploads/demo/${name}.png`, storagePath: `demo/${name}.png`, bytes: png.length };
}
