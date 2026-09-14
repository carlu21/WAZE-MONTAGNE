import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { preferencesSchema, updateMeSchema, type UserPreferences } from "@mountain-live/core";
import { db } from "../db/client";
import {
  notifications,
  offlineZones,
  partners,
  photos,
  reportComments,
  reports,
  userPreferences,
  userReputationEvents,
  users,
  type UserRow,
} from "../db/schema";
import { requireAuth, type AppEnv } from "../middleware/auth";
import { readJson } from "../middleware/validate";
import { HttpError } from "../services/errors";
import { forgetUserPresence } from "../services/presence";
import { DELETED_USER_PSEUDO, toUserMe, toUserPublic } from "../services/serializers";
import { getPreferences, savePreferences } from "../services/users";
import { nowIso } from "../services/util";

/**
 * PATCH /users/me, PUT /users/me/preferences, DELETE /users/me (RGPD), GET /users/:id
 */
export const usersRoutes = new Hono<AppEnv>();

usersRoutes.patch("/me", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const input = await readJson(c, updateMeSchema);
  const patch: Partial<UserRow> = { updatedAt: nowIso() };
  if (input.pseudo !== undefined) {
    const pseudo = input.pseudo.trim();
    const taken = db
      .select({ id: users.id })
      .from(users)
      .where(sql`${users.pseudo} = ${pseudo} COLLATE NOCASE AND ${users.deletedAt} IS NULL AND ${users.id} <> ${user.id}`)
      .get();
    if (taken) throw new HttpError(409, "pseudo_taken", "Ce pseudo est déjà utilisé");
    patch.pseudo = pseudo;
  }
  if (input.practices !== undefined) patch.practices = input.practices;
  if (input.region !== undefined) patch.region = input.region?.trim() || null;
  if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl?.trim() || null;
  db.update(users).set(patch).where(eq(users.id, user.id)).run();
  const updated = { ...user, ...patch };
  return c.json({ user: toUserMe(updated, getPreferences(user.id)) });
});

usersRoutes.put("/me/preferences", requireAuth, async (c) => {
  const user = c.get("user") as UserRow;
  const input = await readJson(c, preferencesSchema);
  const prefs = savePreferences(user.id, { ...getPreferences(user.id), ...(input as UserPreferences) });
  return c.json({ user: toUserMe(user, prefs) });
});

/**
 * Suppression de compte (section 28) : anonymisation irréversible du compte, conservation
 * des signalements sans lien avec la personne, suppression des données personnelles annexes.
 */
usersRoutes.delete("/me", requireAuth, (c) => {
  const user = c.get("user") as UserRow;
  const now = nowIso();
  db.transaction((tx) => {
    tx.update(users)
      .set({
        email: `deleted+${user.id}@anonyme.invalid`,
        pseudo: DELETED_USER_PSEUDO,
        passwordHash: "",
        avatarUrl: null,
        practices: [],
        region: null,
        consentGivenAt: null,
        suspendedUntil: null,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id))
      .run();
    // Signalements et commentaires conservés, mais détachés de la personne.
    tx.update(reports).set({ userId: null, updatedAt: now }).where(eq(reports.userId, user.id)).run();
    tx.update(reportComments).set({ userId: null }).where(eq(reportComments.userId, user.id)).run();
    tx.update(photos).set({ userId: null }).where(eq(photos.userId, user.id)).run();
    // Données propres à la personne : fiche partenaire, journal de réputation, préférences, notifications, zones.
    tx.delete(partners).where(eq(partners.userId, user.id)).run();
    tx.delete(userReputationEvents).where(eq(userReputationEvents.userId, user.id)).run();
    tx.delete(userPreferences).where(eq(userPreferences.userId, user.id)).run();
    tx.delete(notifications).where(eq(notifications.userId, user.id)).run();
    tx.delete(offlineZones).where(eq(offlineZones.userId, user.id)).run();
  });
  forgetUserPresence(user.id);
  return c.body(null, 204);
});

usersRoutes.get("/:id", (c) => {
  const row = db.select().from(users).where(eq(users.id, c.req.param("id"))).get();
  if (!row || row.deletedAt) throw new HttpError(404, "not_found", "Utilisateur introuvable");
  return c.json({ user: toUserPublic(row) });
});
