import type { Message } from 'discord.js';
import {
  countUserSubmissions,
  deleteSubmissionsByMessage,
  getChannelConfig,
  getSubmission,
  listMessageIdentifiers,
  recordSubmissions,
} from '../db.js';
import { extractSubmissions, type AttachmentLike } from './normalize.js';
import { timeoutDurationMs } from '../config.js';
import {
  markSubmission,
  registerDuplicateOffense,
  registerFloodOffense,
  registerMessageAndCheckFlood,
  submissionCooldownRemaining,
} from './antiflood.js';
import { notifyAuthor, removeAndNotify } from './respond.js';
import { persona } from './persona.js';

export function parseRoles(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((r) => r.trim()).filter(Boolean);
}

export function serializeRoles(roles: string[]): string | null {
  return roles.length > 0 ? roles.join(',') : null;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

/**
 * Cœur de la modération d'un message de session — partagé entre la création et
 * l'édition. `isEdit` = true quand le message a été modifié (on saute le flood et
 * le cooldown, et on ré-évalue proprement en repartant de zéro pour ce message).
 */
export async function processMessage(message: Message, isEdit: boolean): Promise<void> {
  if (message.author.bot || message.webhookId) return;
  if (!message.inGuild()) return;

  const cfg = getChannelConfig(message.channelId);
  if (!cfg || cfg.managed !== 1) return;

  const sessionId = cfg.active_session_id;
  if (sessionId === null) return;

  const userId = message.author.id;
  const member = message.member;

  // --- Rôles bypass : aucune règle ne s'applique à ces membres. ---
  const bypassRoles = parseRoles(cfg.bypass_roles);
  const isBypass = bypassRoles.length > 0 && (member?.roles.cache.hasAny(...bypassRoles) ?? false);

  // --- Déjà réduit au silence (timeout en cours) : suppression MUETTE, sans MP
  // ni nouveau timeout → coût minimal (1 appel API) sous spam soutenu. ---
  if (!isBypass && member?.isCommunicationDisabled()) {
    await message.delete().catch(() => {});
    return;
  }

  const attachments: AttachmentLike[] = message.attachments.map((a) => ({
    name: a.name,
    contentType: a.contentType,
    size: a.size,
  }));
  const subs = extractSubmissions(message.content, attachments);

  // Bypass : on catalogue tout de même leurs nouveaux sons (anti-repost par d'autres).
  if (isBypass) {
    deleteSubmissionsByMessage(message.id);
    const fresh = subs.filter((s) => !getSubmission(sessionId, s.identifier));
    if (fresh.length > 0) {
      recordSubmissions(sessionId, message.channelId, userId, message.id, fresh);
      if (!isEdit) await message.react('✅').catch(() => {});
    }
    return;
  }

  // --- Édition : si l'ensemble des sons n'a pas changé (ex. embed qui se charge),
  // on ne refait rien. Sinon on repart proprement de zéro pour ce message. ---
  if (isEdit) {
    const before = listMessageIdentifiers(message.id);
    if (sameSet(before, subs.map((s) => s.identifier))) return;
  }
  deleteSubmissionsByMessage(message.id);

  // 1. Anti-flood (uniquement à la création) → escalade vers timeout exponentiel.
  if (!isEdit) {
    const flooding = registerMessageAndCheckFlood(
      message.channelId,
      userId,
      cfg.flood_max,
      cfg.flood_window_sec
    );
    if (flooding) {
      const fstrike = registerFloodOffense(message.channelId, userId);
      const sanctionMs = timeoutDurationMs(fstrike);
      let appliedTimeoutMs = 0;
      if (sanctionMs > 0 && member) {
        try {
          await member.timeout(sanctionMs, 'Flood — séance d\'écoute');
          appliedTimeoutMs = sanctionMs;
        } catch (e) {
          console.warn(
            `[timeout] flood ${message.author.tag} :`,
            e instanceof Error ? e.message : e
          );
        }
      }
      const reason = persona.flood(appliedTimeoutMs);
      await removeAndNotify(message, reason);
      return;
    }
  }

  if (subs.length === 0) {
    if (cfg.require_submission === 1) {
      await removeAndNotify(message, persona.requireSubmission());
    }
    return;
  }

  // 2. Sépare doublons et nouveaux (les enregistrements de CE message ont été
  // retirés, donc il ne peut pas matcher avec lui-même).
  const news: typeof subs = [];
  const dups: { existing: ReturnType<typeof getSubmission> }[] = [];
  for (const s of subs) {
    const existing = getSubmission(sessionId, s.identifier);
    if (existing) dups.push({ existing });
    else news.push(s);
  }

  const linkTo = (messageId: string) =>
    `https://discord.com/channels/${message.guildId}/${message.channelId}/${messageId}`;

  // 2a. Tout est doublon → suppression + escalade (strikes + timeout exponentiel).
  if (news.length === 0) {
    const first = dups[0]?.existing;
    const link = first ? linkTo(first.message_id) : '';
    const strike = registerDuplicateOffense(message.channelId, userId);

    const sanctionMs = timeoutDurationMs(strike);
    let appliedTimeoutMs = 0;
    if (sanctionMs > 0 && member) {
      try {
        await member.timeout(sanctionMs, 'Spam de doublons — séance d\'écoute');
        appliedTimeoutMs = sanctionMs;
      } catch (e) {
        console.warn(
          `[timeout] impossible de timeout ${message.author.tag} :`,
          e instanceof Error ? e.message : e
        );
      }
    }

    const reason = persona.duplicate(link, subs.length > 1, strike, appliedTimeoutMs);
    await removeAndNotify(message, reason);
    return;
  }

  // 2b. Mode « 1 son par personne ».
  if (cfg.one_per_person === 1) {
    if (countUserSubmissions(sessionId, userId) > 0) {
      await removeAndNotify(message, persona.oneOnly());
      return;
    }
    if (news.length > 1) news.length = 1;
  }

  // 3. Cooldown (uniquement à la création).
  if (!isEdit) {
    const wait = submissionCooldownRemaining(message.channelId, userId, cfg.cooldown_sec);
    if (wait > 0) {
      await removeAndNotify(message, persona.cooldown(wait));
      return;
    }
  }

  // 4. Enregistrement des nouveaux sons.
  recordSubmissions(sessionId, message.channelId, userId, message.id, news);
  if (!isEdit) markSubmission(message.channelId, userId);
  await message.react('✅').catch(() => {});

  // 5. Doublon partiel : on garde le message, on prévient juste pour les ignorés.
  if (dups.length > 0) {
    const first = dups[0]?.existing;
    const link = first ? linkTo(first.message_id) : '';
    await notifyAuthor(message, persona.partialDuplicate(dups.length, link));
  }
}
