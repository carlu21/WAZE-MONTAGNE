import fs from "node:fs";
import path from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { photos, type PhotoRow } from "../db/schema";
import { HttpError } from "./errors";
import { newId, nowIso } from "./util";

/**
 * Photos de signalement : validation par type MIME ET signature binaire, taille max 5 Mo,
 * stockage sous `<uploadDir>/<reportId>/<photoId>.<ext>`, servi statiquement sous `/uploads`.
 */

const ALLOWED: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Détection du type par signature (magic bytes) : ne fait pas confiance au client. */
export function sniffImageMime(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** Dimensions lues dans les en-têtes (PNG IHDR, JPEG SOFn, WebP VP8/VP8L/VP8X). */
export function imageDimensions(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = buf.readUInt16BE(i + 2);
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp" && buf.length >= 30) {
      const chunk = buf.subarray(12, 16).toString("ascii");
      if (chunk === "VP8X") {
        return {
          width: 1 + buf.readUIntLE(24, 3),
          height: 1 + buf.readUIntLE(27, 3),
        };
      }
      if (chunk === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const b0 = buf[21];
        const b1 = buf[22];
        const b2 = buf[23];
        const b3 = buf[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface StoredPhotoInput {
  reportId: string;
  userId: string | null;
  buffer: Buffer;
  declaredMime: string;
}

export function storePhoto(input: StoredPhotoInput): PhotoRow {
  if (input.buffer.length === 0) throw new HttpError(400, "validation_error", "Fichier vide");
  if (input.buffer.length > config.maxPhotoBytes) {
    throw new HttpError(413, "photo_too_large", "Photo trop volumineuse (5 Mo maximum)");
  }
  const sniffed = sniffImageMime(input.buffer);
  const declared = input.declaredMime.toLowerCase().split(";")[0].trim();
  if (!sniffed || !(declared in ALLOWED) || sniffed !== declared) {
    throw new HttpError(415, "unsupported_media_type", "Format accepté : JPEG, PNG ou WebP");
  }
  const id = newId();
  const ext = ALLOWED[sniffed];
  const relative = path.posix.join(input.reportId, `${id}.${ext}`);
  const absolute = path.join(config.uploadDir, input.reportId, `${id}.${ext}`);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, input.buffer);
  const dims = imageDimensions(input.buffer, sniffed);
  const row: PhotoRow = {
    id,
    reportId: input.reportId,
    userId: input.userId,
    url: `/uploads/${relative}`,
    storagePath: relative,
    mime: sniffed,
    sizeBytes: input.buffer.length,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
    createdAt: nowIso(),
    deletedAt: null,
  };
  db.insert(photos).values(row).run();
  return row;
}

export function listPhotosForReports(reportIds: string[]): Map<string, PhotoRow[]> {
  const map = new Map<string, PhotoRow[]>();
  if (!reportIds.length) return map;
  const rows = db
    .select()
    .from(photos)
    .where(and(inArray(photos.reportId, reportIds), isNull(photos.deletedAt)))
    .orderBy(asc(photos.createdAt))
    .all();
  for (const r of rows) {
    const list = map.get(r.reportId) ?? [];
    list.push(r);
    map.set(r.reportId, list);
  }
  return map;
}

/** Suppression logique + suppression du fichier (best effort). */
export function softDeletePhoto(id: string): boolean {
  const row = db.select().from(photos).where(eq(photos.id, id)).get();
  if (!row || row.deletedAt) return false;
  db.update(photos).set({ deletedAt: nowIso() }).where(eq(photos.id, id)).run();
  removePhotoFile(row.storagePath);
  return true;
}

export function removePhotoFile(storagePath: string): void {
  try {
    fs.unlinkSync(path.join(config.uploadDir, storagePath));
  } catch {
    // Fichier déjà absent : rien à faire.
  }
}
