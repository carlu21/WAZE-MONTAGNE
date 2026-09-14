/**
 * Photo facultative du signalement : prise de vue (caméra arrière) ou galerie,
 * réduction côté client (1600 px, JPEG 0,8), aperçu et retrait.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, RefreshCw, X } from "lucide-react";
import { fr } from "@mountain-live/core";
import { Button, toast } from "@/components/ui";
import { PHOTO_MAX_BYTES, formatBytes, resizeImage } from "./photo";

export interface PhotoFieldProps {
  photo: Blob | null;
  onChange: (photo: Blob | null) => void;
  disabled?: boolean;
}

export const PHOTO_MESSAGES = {
  tooLarge: "Photo trop volumineuse : 5 Mo maximum.",
  unreadable: "Impossible de lire cette photo. Essayez une autre image.",
  notImage: "Choisissez une image (JPEG, PNG ou WebP).",
} as const;

export function PhotoField({ photo, onChange, disabled = false }: PhotoFieldProps) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Aperçu : URL d'objet révoquée à chaque changement de photo.
  useEffect(() => {
    if (!photo || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Permet de re-sélectionner le même fichier après un retrait.
    input.value = "";
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      toast.warning(PHOTO_MESSAGES.notImage);
      return;
    }
    setBusy(true);
    try {
      const reduced = await resizeImage(file);
      if (reduced.size > PHOTO_MAX_BYTES) {
        toast.warning(PHOTO_MESSAGES.tooLarge);
        return;
      }
      onChange(reduced);
    } catch {
      toast.danger(PHOTO_MESSAGES.unreadable);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFile} aria-hidden="true" tabIndex={-1} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={handleFile} aria-hidden="true" tabIndex={-1} />

      {photo ? (
        <>
          <figure className="relative overflow-hidden rounded-2xl border-2 border-line bg-surface-2">
            {previewUrl ? (
              <img src={previewUrl} alt="Aperçu de la photo du signalement" className="h-52 w-full object-cover" />
            ) : (
              <div className="flex h-52 items-center justify-center text-muted">
                <Camera className="size-8" aria-hidden="true" />
              </div>
            )}
            <figcaption className="glass-strong absolute bottom-2 left-2 rounded-md px-2 py-1 text-[12px] font-semibold text-fg shadow-sm">
              Photo prête · {formatBytes(photo.size)}
            </figcaption>
          </figure>
          <div className="flex gap-2">
            <Button variant="outline" size="md" className="flex-1" leftIcon={<RefreshCw />} onClick={() => cameraRef.current?.click()} disabled={disabled} loading={busy} loadingLabel="Lecture…">
              Remplacer
            </Button>
            <Button variant="ghost" size="md" className="flex-1" leftIcon={<X />} onClick={() => onChange(null)} disabled={disabled || busy}>
              {fr.wizard.photoRemove}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="lg" fullWidth leftIcon={<Camera />} onClick={() => cameraRef.current?.click()} disabled={disabled} loading={busy} loadingLabel="Lecture de la photo…">
            {fr.wizard.photoTake}
          </Button>
          <Button variant="ghost" size="md" fullWidth leftIcon={<ImagePlus />} onClick={() => galleryRef.current?.click()} disabled={disabled || busy}>
            {fr.wizard.photoChoose}
          </Button>
        </div>
      )}
    </div>
  );
}
