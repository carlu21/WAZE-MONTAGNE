import type { Context } from "hono";
import type { ZodError, ZodTypeAny, z } from "zod";
import { HttpError } from "../services/errors";

/**
 * Validation des entrées avec les schémas zod partagés (packages/core/src/schemas.ts).
 * Toute erreur renvoie 400 `{ error: { code: "validation_error", message, details } }`
 * où `details` liste les problèmes champ par champ.
 */
function formatIssues(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join(".") || "(racine)", message: i.message }));
}

function fail(err: ZodError): never {
  const details = formatIssues(err);
  const first = details[0];
  throw new HttpError(
    400,
    "validation_error",
    first ? `Données invalides : ${first.path} — ${first.message}` : "Données invalides",
    details,
  );
}

/** Lit et valide un corps JSON. */
export async function readJson<S extends ZodTypeAny>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError(400, "validation_error", "Corps de requête JSON invalide ou absent");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) fail(parsed.error);
  return parsed.data;
}

/** Valide les paramètres de requête (query string). */
export function readQuery<S extends ZodTypeAny>(c: Context, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) fail(parsed.error);
  return parsed.data;
}
