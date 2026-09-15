/**
 * Pseudonymisation des contributions (sections 34 et 35 du moteur cartographique).
 *
 * Les passages enregistrés dans `segment_traversals` ne portent jamais
 * l'identifiant du compte, mais une clé dérivée par HMAC-SHA256 d'un secret
 * serveur. Cette clé permet exactement une chose : compter des utilisateurs
 * distincts et éviter qu'un seul marcheur ne pèse comme une foule. Elle ne
 * permet pas de remonter au compte sans le secret, et le secret ne quitte
 * jamais le serveur.
 *
 * Conséquences assumées :
 * - changer `PSEUDONYM_SECRET` remet à zéro le comptage d'utilisateurs distincts ;
 * - supprimer un compte détache ses activités (user_id à null) : les statistiques
 *   restent cohérentes et anonymes ; supprimer une activité efface ses passages.
 */
import { createHmac } from "node:crypto";
import { config } from "../config";

/** Clé pseudonyme stable d'un utilisateur (16 caractères hexadécimaux). */
export function userKey(userId: string): string {
  return createHmac("sha256", config.pseudonymSecret).update(`user:${userId}`).digest("hex").slice(0, 16);
}

/**
 * Clé d'un contributeur anonyme (activité importée sans compte) : dérivée de
 * l'identifiant d'activité, donc jamais reliée à une autre activité.
 */
export function anonymousKey(activityId: string): string {
  return createHmac("sha256", config.pseudonymSecret).update(`anon:${activityId}`).digest("hex").slice(0, 16);
}
