import {
  ChannelType,
  Webhook,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import {
  listSessionSubmissions,
  type ChannelConfig,
  type SessionRow,
} from '../db.js';
import { fetchGuildTextChannel } from './channels.js';
import { collectMessagesInWindow } from './messages.js';
import { persona } from './persona.js';

const WEBHOOK_NAME = 'Session Backup';
const MAX_MESSAGES = 1000;
const MAX_SONS_LISTED = 15;

// Sérialise la résolution du webhook par salon pour éviter d'en créer en double
// si deux backups visent le même salon en parallèle.
const webhookLocks = new Map<string, Promise<Webhook | null>>();

function supportsWebhook(channel: GuildTextBasedChannel): boolean {
  return (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement
  );
}

// Pseudo de webhook valide (1–80 car., sans « discord »/« clyde »).
function sanitizeUsername(name: string): string {
  const n = name.trim().slice(0, 80);
  if (!n || /discord|clyde/i.test(n)) return 'Participant';
  return n;
}

function chunkString(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

async function getOrCreateWebhook(
  channel: GuildTextBasedChannel,
  client: Client
): Promise<Webhook | null> {
  if (!supportsWebhook(channel) || !('fetchWebhooks' in channel)) return null;

  const pending = webhookLocks.get(channel.id);
  if (pending) return pending;

  const task = (async (): Promise<Webhook | null> => {
    try {
      const hooks = await channel.fetchWebhooks();
      const mine = hooks
        .filter((h) => h.name === WEBHOOK_NAME && h.owner?.id === client.user?.id && !!h.token)
        // Plus ancien d'abord : réutilisation déterministe, les doublons convergent.
        .sort((a, b) => (a.id === b.id ? 0 : BigInt(a.id) < BigInt(b.id) ? -1 : 1))
        .first();
      if (mine) return mine;
      return await channel.createWebhook({ name: WEBHOOK_NAME });
    } catch (e) {
      console.warn(
        '[backup] webhook indisponible (permission « Gérer les webhooks » ou type de salon ?) :',
        e
      );
      return null;
    } finally {
      webhookLocks.delete(channel.id);
    }
  })();

  webhookLocks.set(channel.id, task);
  return task;
}

/** Réplique un message via webhook. Renvoie false si rien n'a pu être envoyé. */
async function replicateMessage(webhook: Webhook, msg: Message<true>): Promise<boolean> {
  const username = sanitizeUsername(msg.member?.displayName ?? msg.author.username);
  const avatarURL = msg.author.displayAvatarURL();
  const attachments = [...msg.attachments.values()];
  const content = msg.content.length > 0 ? msg.content : undefined;

  if (!content && attachments.length === 0) return false;

  try {
    await webhook.send({
      username,
      avatarURL,
      content,
      files: attachments.length > 0 ? attachments : undefined,
      allowedMentions: { parse: [] },
    });
    return true;
  } catch {
    // Pièce jointe trop lourde / indisponible : repli texte avec les liens,
    // découpé en morceaux <= 2000 caractères pour ne rien perdre.
    const links = attachments.map((a) => a.url).join('\n');
    const full = [content, links].filter(Boolean).join('\n');
    if (!full) return false;

    let sent = false;
    for (const piece of chunkString(full, 2000)) {
      try {
        await webhook.send({ username, avatarURL, content: piece, allowedMentions: { parse: [] } });
        sent = true;
      } catch (e) {
        console.error('[backup] échec réplication message', msg.id, e);
      }
    }
    return sent;
  }
}

/**
 * À la fermeture d'une session : réplique fidèlement le salon de session dans le
 * salon privé de backup (webhook reproduisant pseudo + avatar + contenu + pièces
 * jointes), précédé d'un récap listant les sons. Sans effet si aucun salon de
 * backup n'est configuré. Les messages du bot lui-même sont exclus.
 */
export async function backupSession(
  client: Client,
  cfg: ChannelConfig,
  session: SessionRow
): Promise<boolean> {
  if (!cfg.backup_channel_id) return true;

  const backupChannel = await fetchGuildTextChannel(client, cfg.backup_channel_id);
  if (!backupChannel) {
    console.warn(`[backup] salon de backup ${cfg.backup_channel_id} introuvable.`);
    return false;
  }

  const start = session.started_at;
  const end = session.ended_at ?? Date.now();
  const baseChannel = await fetchGuildTextChannel(client, cfg.channel_id);
  const collected = baseChannel
    ? await collectMessagesInWindow(baseChannel, start, end, MAX_MESSAGES)
    : [];
  const truncated = collected.length >= MAX_MESSAGES;

  // Exclut les messages du bot / webhooks (annonces, avis) — comme messageCreate.
  const messages = collected.filter((m) => !m.author.bot && !m.webhookId);
  // Messages réellement réplicables (au moins du texte ou une pièce jointe).
  const replicable = messages.filter(
    (m) => m.content.length > 0 || m.attachments.size > 0
  );

  // En-tête + récap des sons.
  const subs = listSessionSubmissions(session.id);
  const recap: string[] = [
    persona.backupHeader(session.id, cfg.channel_id),
    `<t:${Math.floor(start / 1000)}:f> → <t:${Math.floor(end / 1000)}:f>`,
    `**${subs.length}** son(s) · **${replicable.length}** message(s) répliqué(s) ci-dessous.` +
      (truncated ? ` ⚠️ tronqué aux ${MAX_MESSAGES} plus récents.` : ''),
  ];
  if (subs.length > 0) {
    recap.push('');
    recap.push('**Sons postés :**');
    for (const [i, s] of subs.slice(0, MAX_SONS_LISTED).entries()) {
      const link = `https://discord.com/channels/${cfg.guild_id}/${cfg.channel_id}/${s.message_id}`;
      const label = (s.display ?? s.identifier).slice(0, 80);
      recap.push(`${i + 1}. ${label} — <@${s.user_id}> — ${link}`);
    }
    if (subs.length > MAX_SONS_LISTED) {
      recap.push(`… et ${subs.length - MAX_SONS_LISTED} autre(s).`);
    }
  }
  const headerSent = await backupChannel
    .send({ content: recap.join('\n').slice(0, 1990), allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);
  if (!headerSent) return false;

  if (replicable.length === 0) return true;

  const webhook = await getOrCreateWebhook(backupChannel, client);
  if (!webhook) {
    await backupChannel
      .send({
        content:
          '⚠️ Impossible de répliquer les messages (webhook indisponible — vérifie la permission « Gérer les webhooks » du bot sur ce salon).',
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    return false;
  }

  let complete = true;
  for (const msg of replicable) {
    if (!(await replicateMessage(webhook, msg))) complete = false;
  }
  return complete;
}
