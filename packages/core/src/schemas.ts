import { z } from "zod";
import { CATEGORY_IDS, SUBTYPE_IDS } from "./taxonomy";

/**
 * Schémas de validation (zod) partagés par l'API (validation des entrées)
 * et le web (validation des formulaires).
 */

export const latSchema = z.number().min(-90).max(90);
export const lngSchema = z.number().min(-180).max(180);

export const categorySchema = z.enum(CATEGORY_IDS as [string, ...string[]]);
export const subtypeSchema = z.enum(SUBTYPE_IDS as [string, ...string[]]);
export const dangerLevelSchema = z.enum(["low", "moderate", "high", "critical"]);
export const confirmationKindSchema = z.enum(["still_present", "improved", "gone", "disputed"]);
export const practiceSchema = z.enum([
  "hiker",
  "trail",
  "rider",
  "mtb",
  "hunter",
  "fisher",
  "shepherd",
  "professional",
  "manager",
  "other",
]);
export const basemapSchema = z.enum(["topo", "satellite", "classic", "relief"]);
export const flagReasonSchema = z.enum([
  "false_info",
  "dangerous_content",
  "inappropriate_photo",
  "harassment",
  "obsolete",
  "spam",
]);
export const notificationTypeSchema = z.enum([
  "new_danger_on_route",
  "new_battue_nearby",
  "trail_closed",
  "report_updated",
  "report_confirmed",
  "report_resolved",
  "official_alert",
  "system",
]);

export const bboxSchema = z.object({
  west: lngSchema,
  south: latSchema,
  east: lngSchema,
  north: latSchema,
});

/** Chaîne "west,south,east,north" -> BBox */
export const bboxStringSchema = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([lngSchema, latSchema, lngSchema, latSchema]))
  .transform(([west, south, east, north]) => ({ west, south, east, north }));

export const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  pseudo: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[\p{L}\p{N} _\-.]+$/u, "Caractères non autorisés"),
  practices: z.array(practiceSchema).max(10).default([]),
  region: z.string().max(80).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "Consentement requis" }) }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const preferencesSchema = z.object({
  filters: z.array(categorySchema).max(6),
  showOfficialOnly: z.boolean(),
  basemap: basemapSchema,
  theme: z.enum(["light", "dark", "system"]),
  alerts: z.object({
    enabled: z.boolean(),
    radiusM: z.number().int().min(200).max(2000),
    categories: z.array(categorySchema).max(6),
  }),
  notifications: z.record(notificationTypeSchema, z.boolean()),
  aroundRadiusM: z.number().int().min(500).max(10000),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const updateMeSchema = z.object({
  pseudo: registerSchema.shape.pseudo.optional(),
  practices: z.array(practiceSchema).max(10).optional(),
  region: z.string().max(80).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const createReportSchema = z.object({
  subtype: subtypeSchema,
  lat: latSchema,
  lng: lngSchema,
  dangerLevel: dangerLevelSchema.nullable().optional(),
  description: z.string().max(600).nullable().optional(),
  /** Durée de validité souhaitée en minutes (bornée par la taxonomie côté serveur). */
  ttlMinutes: z.number().int().min(15).max(365 * 24 * 60).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  zone: z.string().max(120).nullable().optional(),
  /** Identifiant local (offline) pour dédoublonner lors de la synchronisation. */
  clientId: z.string().max(64).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const updateReportSchema = z.object({
  description: z.string().max(600).nullable().optional(),
  dangerLevel: dangerLevelSchema.nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  status: z.enum(["active", "resolved"]).optional(),
  subtype: subtypeSchema.optional(),
});
export type UpdateReportInput = z.infer<typeof updateReportSchema>;

export const confirmSchema = z.object({
  kind: confirmationKindSchema,
  comment: z.string().max(300).nullable().optional(),
});
export type ConfirmInput = z.infer<typeof confirmSchema>;

export const commentSchema = z.object({
  body: z.string().min(1).max(600),
});
export type CommentInput = z.infer<typeof commentSchema>;

export const flagSchema = z.object({
  reportId: z.string().optional(),
  commentId: z.string().optional(),
  photoId: z.string().optional(),
  reason: flagReasonSchema,
  details: z.string().max(600).nullable().optional(),
});
export type FlagInput = z.infer<typeof flagSchema>;

export const listReportsQuerySchema = z.object({
  bbox: bboxStringSchema.optional(),
  categories: z
    .string()
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(categorySchema))
    .optional(),
  source: z.enum(["official", "partner", "community"]).optional(),
  since: z.string().datetime().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  includeInactive: z.coerce.boolean().optional(),
});
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;

export const aroundQuerySchema = z.object({
  lat: z.coerce.number().pipe(latSchema),
  lng: z.coerce.number().pipe(lngSchema),
  radius: z.coerce.number().int().min(100).max(20000).default(3000),
  categories: listReportsQuerySchema.shape.categories,
});
export type AroundQuery = z.infer<typeof aroundQuerySchema>;

export const presenceSchema = z.object({
  lat: latSchema,
  lng: lngSchema,
});

export const adminUpdateReportSchema = z.object({
  subtype: subtypeSchema.optional(),
  status: z
    .enum(["active", "confirmed", "probably_resolved", "resolved", "expired", "disputed", "deleted"])
    .optional(),
  dangerLevel: dangerLevelSchema.nullable().optional(),
  description: z.string().max(600).nullable().optional(),
  source: z.enum(["official", "partner", "community"]).optional(),
});

export const adminSuspendSchema = z.object({
  /** Durée en heures ; 0 = lever la suspension. */
  hours: z.number().int().min(0).max(24 * 365),
  reason: z.string().max(300).optional(),
});

export const adminFlagUpdateSchema = z.object({
  status: z.enum(["open", "reviewing", "resolved", "rejected"]),
  resolutionNote: z.string().max(600).nullable().optional(),
  /** Action appliquée au contenu visé. */
  action: z.enum(["none", "delete_content", "suspend_author"]).optional(),
});

export const officialAlertSchema = z.object({
  organisation: z.string().min(2).max(120),
  title: z.string().min(3).max(160),
  body: z.string().max(2000),
  category: categorySchema,
  severity: dangerLevelSchema,
  geometry: z.union([
    z.object({ type: z.literal("Point"), coordinates: z.tuple([lngSchema, latSchema]) }),
    z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.tuple([lngSchema, latSchema])).min(4)).min(1),
    }),
  ]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Seules les adresses http(s) sont acceptées")
    .nullable()
    .optional(),
});
export type OfficialAlertInput = z.infer<typeof officialAlertSchema>;
