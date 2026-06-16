import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getChannelConfig, getLatestSession, getSession } from '../db.js';
import { fetchGuildTextChannel } from './channels.js';
import { collectMessagesInWindow } from './messages.js';
import { persona } from './persona.js';

const CAP = 1000;
const CUSTOM_ID_PREFIX = 'session-clear';

// Verrou anti double-clic, par message de confirmation.
const inFlight = new Set<string>();

/** Étape 1 : compte les messages de la dernière session terminée et demande confirmation. */
export async function prepareClear(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Refuse de purger pendant une session ouverte : la fenêtre serait mobile et
  // on supprimerait des sons en cours. Il faut fermer d'abord.
  const cfg = getChannelConfig(interaction.channelId);
  if (cfg && cfg.active_session_id !== null) {
    await interaction.editReply(
      '⛔ Une session est encore **ouverte** ici. Ferme-la avec `/session stop` avant de purger.'
    );
    return;
  }

  const session = getLatestSession(interaction.channelId);
  if (!session || session.ended_at === null) {
    await interaction.editReply('ℹ️ Aucune session terminée sur ce salon.');
    return;
  }

  const channel = await fetchGuildTextChannel(interaction.client, interaction.channelId);
  if (!channel) {
    await interaction.editReply('❌ Salon introuvable ou non textuel.');
    return;
  }

  // Fenêtre figée [started_at, ended_at] : pas de borne mobile.
  const messages = await collectMessagesInWindow(
    channel,
    session.started_at,
    session.ended_at,
    CAP
  );

  if (messages.length === 0) {
    await interaction.editReply('ℹ️ Aucun message à supprimer pour la dernière session.');
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:confirm:${session.id}`)
      .setLabel(persona.clearButton(messages.length))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}:cancel`)
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary)
  );

  const capNote =
    messages.length >= CAP
      ? `\n(plafonné à ${CAP} — relance la commande après suppression pour le reste)`
      : '';

  await interaction.editReply({
    content: persona.clearConfirm(
      messages.length,
      session.id,
      Math.floor(session.started_at / 1000),
      Math.floor(session.ended_at / 1000),
      capNote
    ),
    components: [row],
  });
}

export function isClearButton(customId: string): boolean {
  return customId.startsWith(`${CUSTOM_ID_PREFIX}:`);
}

/** Étape 2 : traite le clic sur Confirmer / Annuler. */
export async function handleClearButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      content: '⛔ Réservé au staff (permission « Gérer les messages »).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const [, action, rawSessionId] = interaction.customId.split(':');

  if (action === 'cancel') {
    await interaction.update({ content: persona.clearCancel(), components: [] });
    return;
  }

  const sessionId = Number(rawSessionId);
  if (action !== 'confirm' || !Number.isInteger(sessionId) || sessionId <= 0) {
    await interaction.reply({ content: '❌ Action invalide.', flags: MessageFlags.Ephemeral });
    return;
  }

  const lockKey = interaction.message.id;
  if (inFlight.has(lockKey)) {
    await interaction.reply({
      content: '⏳ Suppression déjà en cours…',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  inFlight.add(lockKey);

  try {
    await interaction.update({ content: '🧹 Suppression en cours…', components: [] });

    const session = getSession(sessionId);
    if (!session) {
      await interaction.editReply('❌ Session introuvable.');
      return;
    }
    if (session.ended_at === null) {
      await interaction.editReply('❌ Session encore active — ferme-la avant de purger.');
      return;
    }

    const channel = await fetchGuildTextChannel(interaction.client, session.channel_id);
    if (!channel) {
      await interaction.editReply('❌ Salon introuvable.');
      return;
    }

    const messages = await collectMessagesInWindow(
      channel,
      session.started_at,
      session.ended_at,
      CAP
    );

    let deleted = 0;
    let failed = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100).map((m) => m.id);
      try {
        // filterOld=true : ignore (sans erreur) les messages de plus de 14 jours.
        const removed = await channel.bulkDelete(chunk, true);
        deleted += removed.size;
      } catch (e) {
        console.error('[clear] bulkDelete', e);
        failed += chunk.length;
      }
    }

    const tooOld = messages.length - deleted - failed;
    await interaction.editReply(persona.clearDone(deleted, tooOld, failed));
  } finally {
    inFlight.delete(lockKey);
  }
}
