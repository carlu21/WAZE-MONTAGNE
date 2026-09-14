/**
 * Boussole du téléphone (section 2) : cap absolu via `deviceorientationabsolute`
 * (Android) ou `webkitCompassHeading` (iOS, après autorisation explicite).
 * Sert à orienter le marqueur à l'arrêt et à départager les chemins quand le
 * déplacement est trop faible pour déduire un cap fiable.
 */
import { useEffect, useState } from "react";

type OrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean };

export function headingFromEvent(e: OrientationEvent): number | null {
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) return e.webkitCompassHeading;
  if (e.alpha === null || e.alpha === undefined || !Number.isFinite(e.alpha)) return null;
  // alpha croît dans le sens antihoraire ; cap = 360 − alpha (uniquement fiable en mode absolu).
  if (e.absolute === false) return null;
  return (360 - e.alpha + 360) % 360;
}

/** Demande l'autorisation iOS si nécessaire ; renvoie true si la boussole peut être écoutée. */
export async function requestCompassPermission(): Promise<boolean> {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") return false;
  const ctor = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
  if (typeof ctor.requestPermission === "function") {
    try {
      return (await ctor.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

let latestHeading: number | null = null;

export function currentCompassHeading(): number | null {
  return latestHeading;
}

export function useCompass(active: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let last = 0;
    const handler = (e: Event) => {
      const h = headingFromEvent(e as OrientationEvent);
      if (h === null) return;
      latestHeading = Math.round(h);
      const now = Date.now();
      if (now - last < 250) return;
      last = now;
      setHeading(latestHeading);
    };
    const absolute = "ondeviceorientationabsolute" in window;
    const type = absolute ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(type, handler as EventListener, { passive: true });
    return () => {
      window.removeEventListener(type, handler as EventListener);
      latestHeading = null;
    };
  }, [active]);
  return heading;
}
