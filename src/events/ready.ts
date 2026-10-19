import { Events } from 'discord.js';
import type { BotEvent } from '../types.js';
import { syncSchedules } from '../lib/scheduler.js';
import { reconcileSessions } from '../lib/reconcile.js';
import { restoreRetentionTimers } from '../lib/retention.js';
import { resumeSessionFinalizations } from '../lib/sessions.js';

export const event: BotEvent<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    syncSchedules(client);
    await reconcileSessions(client);
    restoreRetentionTimers(client);
    resumeSessionFinalizations(client);
  },
};
