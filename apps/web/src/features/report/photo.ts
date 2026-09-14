/**
 * Réduction de la photo côté client avant envoi (section 4 : photo facultative).
 *
 * - côté le plus long ramené à 1600 px, ré-encodage JPEG qualité 0,8 ;
 * - le ré-encodage sur canvas supprime les métadonnées EXIF (dont la position
 *   GPS embarquée par l'appareil) : la seule position transmise est celle du
 *   signalement ;
 * - si l'image ne peut pas être décodée ou que le canvas est indisponible,
 *   le fichier d'origine est renvoyé tel quel (l'API vérifie type et taille).
 */

export const PHOTO_MAX_PX = 1600;
export const PHOTO_JPEG_QUALITY = 0.8;
/** Limite acceptée par POST /reports/:id/photos. */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_OUTPUT_TYPE = "image/jpeg";

export interface TargetSize {
  width: number;
  height: number;
  /** L'image dépasse la limite et doit être réduite. */
  scaled: boolean;
}

/** Dimensions cibles en conservant le ratio (jamais agrandies). */
export function targetSize(width: number, height: number, maxPx: number = PHOTO_MAX_PX): TargetSize {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const longest = Math.max(w, h);
  if (longest <= maxPx) return { width: w, height: h, scaled: false };
  const ratio = maxPx / longest;
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)), scaled: true };
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decodeWithBitmap(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    let bitmap: ImageBitmap;
    try {
      // « from-image » applique l'orientation EXIF (photos prises en portrait).
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      bitmap = await createImageBitmap(file);
    }
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    return null;
  }
}

async function decodeWithImage(file: Blob): Promise<Decoded | null> {
  if (typeof Image === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

export interface ResizeOptions {
  maxPx?: number;
  quality?: number;
}

/**
 * Réduit et ré-encode la photo en JPEG. Renvoie un `File` nommé « photo.jpg »
 * (ou le fichier d'origine si le traitement est impossible).
 */
export async function resizeImage(file: Blob, opts: ResizeOptions = {}): Promise<Blob> {
  const maxPx = opts.maxPx ?? PHOTO_MAX_PX;
  const quality = opts.quality ?? PHOTO_JPEG_QUALITY;
  if (typeof document === "undefined") return file;

  const decoded = (await decodeWithBitmap(file)) ?? (await decodeWithImage(file));
  if (!decoded || !decoded.width || !decoded.height) return file;

  try {
    const { width, height } = targetSize(decoded.width, decoded.height, maxPx);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await encode(canvas, PHOTO_OUTPUT_TYPE, quality);
    if (!blob || blob.size === 0) return file;
    return typeof File === "function" ? new File([blob], "photo.jpg", { type: PHOTO_OUTPUT_TYPE }) : blob;
  } catch {
    return file;
  } finally {
    decoded.close();
  }
}

/** « 1,2 Mo », « 340 Ko ». */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}
