import { Events } from 'discord.js';
import type { BotEvent } from '../types.js';
import { processMessage } from '../lib/moderation.js';

export const event: BotEvent<Events.MessageCreate> = {
  name: Events.MessageCreate,
  async execute(message) {
    await processMessage(message, false);
  },
};
