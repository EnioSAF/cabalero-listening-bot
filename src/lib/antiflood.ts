/**
 * Suivi en mémoire du flood et du cooldown par (channel, utilisateur).
 * Volontairement non persisté : ces limites ne concernent que l'instant présent
 * d'une session, un redémarrage du bot peut les remettre à zéro sans dommage.
 */

const lastSubmissionAt = new Map<string, number>();
const recentMessages = new Map<string, number[]>();
const duplicateStrikes = new Map<string, number>();
const floodStrikes = new Map<string, number>();

function key(channelId: string, userId: string): string {
  return `${channelId}:${userId}`;
}

/** Incrémente et renvoie le nombre de fois où l'utilisateur a reposté un doublon. */
export function registerDuplicateOffense(channelId: string, userId: string): number {
  const k = key(channelId, userId);
  const n = (duplicateStrikes.get(k) ?? 0) + 1;
  duplicateStrikes.set(k, n);
  return n;
}

/** Incrémente et renvoie le nombre de fois où l'utilisateur a dépassé l'anti-flood. */
export function registerFloodOffense(channelId: string, userId: string): number {
  const k = key(channelId, userId);
  const n = (floodStrikes.get(k) ?? 0) + 1;
  floodStrikes.set(k, n);
  return n;
}

/**
 * Enregistre un message et indique s'il dépasse la limite anti-flood
 * (plus de `max` messages sur `windowSec` secondes).
 */
export function registerMessageAndCheckFlood(
  channelId: string,
  userId: string,
  max: number,
  windowSec: number
): boolean {
  const k = key(channelId, userId);
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const recent = (recentMessages.get(k) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  recentMessages.set(k, recent);
  return recent.length > max;
}

/** Secondes restantes avant que l'utilisateur puisse reposter un son (0 si OK). */
export function submissionCooldownRemaining(
  channelId: string,
  userId: string,
  cooldownSec: number
): number {
  const k = key(channelId, userId);
  const last = lastSubmissionAt.get(k);
  if (last === undefined) return 0;
  const elapsed = (Date.now() - last) / 1000;
  if (elapsed >= cooldownSec) {
    // Cooldown écoulé : on libère l'entrée (éviction paresseuse).
    lastSubmissionAt.delete(k);
    return 0;
  }
  return Math.ceil(cooldownSec - elapsed);
}

export function markSubmission(channelId: string, userId: string): void {
  lastSubmissionAt.set(key(channelId, userId), Date.now());
}

/** Réinitialise les compteurs d'un channel (à l'ouverture/fermeture d'une session). */
export function resetChannel(channelId: string): void {
  const prefix = `${channelId}:`;
  for (const k of lastSubmissionAt.keys()) {
    if (k.startsWith(prefix)) lastSubmissionAt.delete(k);
  }
  for (const k of recentMessages.keys()) {
    if (k.startsWith(prefix)) recentMessages.delete(k);
  }
  for (const k of duplicateStrikes.keys()) {
    if (k.startsWith(prefix)) duplicateStrikes.delete(k);
  }
  for (const k of floodStrikes.keys()) {
    if (k.startsWith(prefix)) floodStrikes.delete(k);
  }
}
