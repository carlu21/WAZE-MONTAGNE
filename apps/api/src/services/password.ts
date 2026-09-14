import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hachage des mots de passe avec scrypt (node:crypto) : sel aléatoire de 16 octets,
 * paramètres explicites stockés avec le hash pour pouvoir les faire évoluer.
 * Format : `scrypt$N$r$p$<sel hex>$<hash hex>`.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("hex"), hash.toString("hex")].join("$");
}

/** Comparaison en temps constant ; false pour un hash vide (compte anonymisé). */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!salt.length || !expected.length) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
