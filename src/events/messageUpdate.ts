import { Events } from 'discord.js';
import type { BotEvent } from '../types.js';
import { processMessage } from '../lib/moderation.js';

export const event: BotEvent<Events.MessageUpdate> = {
  name: Events.MessageUpdate,
  async execute(_oldMessage, newMessage) {
    // Le message édité peut être partiel (pas en cache) : on le récupère.
    const message = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;
    if (!message) return;
    await processMessage(message, true);
  },
};
