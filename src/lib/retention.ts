import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import {
  getSession,
  listPendingSessionPurges,
  purgeSessionData,
  setSessionRetention,
  type SessionRow,
} from '../db.js';
import { fetchSendableChannel } from './channels.js';

export const RETENTION_CHANNEL_ID = '1509220620196647023';
const PREFIX = 'session-retention';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TIMER_MS = 2_147_000_000;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function retentionDeadline(now: number, choice: 'pending' | 'keep'): number {
  return now + (choice === 'keep' ? 30 : 1) * DAY_MS;
}

export function isRetentionButton(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}

async function markExpired(client: Client, session: SessionRow): Promise<void> {
  if (!session.retention_channel_id || !session.retention_message_id) return;
  try {
    const channel = await fetchSendableChannel(client, session.retention_channel_id);
    if (!channel || !('messages' in channel)) return;
    const message = await channel.messages.fetch(session.retention_message_id);
    await message.edit({ content: `🗑️ Données de la séance #${session.id} supprimées automatiquement.`, components: [] });
  } catch {
    // Le nettoyage reste prioritaire si le message Discord n'est plus accessible.
  }
}

function armTimer(client: Client, sessionId: number, purgeAt: number): void {
  const previous = timers.get(sessionId);
  if (previous) clearTimeout(previous);
  const delay = purgeAt - Date.now();
  if (delay <= 0) {
    const session = getSession(sessionId);
    if (session) {
      purgeSessionData(sessionId);
      timers.delete(sessionId);
      void markExpired(client, session);
    }
    return;
  }
  const timer = setTimeout(() => armTimer(client, sessionId, purgeAt), Math.min(delay, MAX_TIMER_MS));
  timer.unref();
  timers.set(sessionId, timer);
}

export async function scheduleSessionRetention(client: Client, sessionId: number): Promise<boolean> {
  const purgeAt = retentionDeadline(Date.now(), 'pending');
  const channel = await fetchSendableChannel(client, RETENTION_CHANNEL_ID);
  if (!channel) return false;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:keep:${sessionId}`)
      .setLabel('Conserver 30 jours')
      .setEmoji('💾')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:delete:${sessionId}`)
      .setLabel('Supprimer maintenant')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );
  const message = await channel.send({
    content:
      `Données de la séance **#${sessionId}** : conservation pendant 24 h sans décision. ` +
      'Choisis une action ci-dessous.',
    components: [row],
  });
  setSessionRetention(sessionId, purgeAt, channel.id, message.id);
  armTimer(client, sessionId, purgeAt);
  return true;
}

export async function handleRetentionButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: '⛔ Réservé au staff.', flags: MessageFlags.Ephemeral });
    return;
  }
  const [, action, rawId] = interaction.customId.split(':');
  const sessionId = Number(rawId);
  const session = getSession(sessionId);
  if (!session || (action !== 'keep' && action !== 'delete')) {
    await interaction.update({ content: 'ℹ️ Ces données ont déjà été supprimées.', components: [] });
    return;
  }
  if (action === 'delete') {
    const timer = timers.get(sessionId);
    if (timer) clearTimeout(timer);
    timers.delete(sessionId);
    purgeSessionData(sessionId);
    await interaction.update({ content: `🗑️ Données de la séance #${sessionId} supprimées.`, components: [] });
    return;
  }
  const purgeAt = retentionDeadline(Date.now(), 'keep');
  setSessionRetention(sessionId, purgeAt);
  armTimer(interaction.client, sessionId, purgeAt);
  await interaction.update({
    content: `💾 Données de la séance #${sessionId} conservées jusqu'au <t:${Math.floor(purgeAt / 1000)}:f>.`,
    components: [],
  });
}

export function restoreRetentionTimers(client: Client): void {
  for (const session of listPendingSessionPurges()) {
    if (session.purge_at !== null) armTimer(client, session.id, session.purge_at);
  }
}
