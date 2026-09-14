/** Concaténation de classes sans dépendance (équivalent minimal de clsx). */
export type ClassValue = string | number | null | undefined | false | ClassValue[] | Record<string, boolean | null | undefined>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const push = (v: ClassValue): void => {
    if (!v && v !== 0) return;
    if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
    } else if (Array.isArray(v)) {
      for (const x of v) push(x);
    } else if (typeof v === "object") {
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
    }
  };
  for (const i of inputs) push(i);
  return out.join(" ");
}
