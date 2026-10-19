import { Events, MessageFlags } from 'discord.js';
import type { BotEvent } from '../types.js';
import { handleClearButton, isClearButton } from '../lib/clear.js';
import { handleRetentionButton, isRetentionButton } from '../lib/retention.js';

export const event: BotEvent<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction, ctx) {
    // Boutons (confirmation de suppression).
    if (interaction.isButton()) {
      if (isRetentionButton(interaction.customId)) {
        try {
          await handleRetentionButton(interaction);
        } catch (err) {
          console.error('[button:retention]', err);
        }
        return;
      }
      if (isClearButton(interaction.customId)) {
        try {
          await handleClearButton(interaction);
        } catch (err) {
          console.error('[button:clear]', err);
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = ctx.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, ctx);
    } catch (err) {
      console.error(`[command:${interaction.commandName}]`, err);
      const payload = {
        content: '❌ Une erreur est survenue lors de l\'exécution de la commande.',
        flags: MessageFlags.Ephemeral,
      } as const;
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
        // L'interaction a peut-être expiré : rien de plus à faire.
      }
    }
  },
};
