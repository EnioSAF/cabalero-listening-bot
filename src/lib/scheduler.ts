import cron from 'node-cron';
import type { Client } from 'discord.js';
import { listAutoScheduleChannels, type ChannelConfig } from '../db.js';
import { closeSession, openSession } from './sessions.js';
import { isValidTimezone } from './time.js';

type Task = ReturnType<typeof cron.schedule>;

const jobs = new Map<string, { open: Task; close: Task }>();

function clearJobs(): void {
  for (const { open, close } of jobs.values()) {
    open.stop();
    close.stop();
  }
  jobs.clear();
}

function registerChannel(client: Client, cfg: ChannelConfig): void {
  if (!cron.validate(cfg.open_cron) || !cron.validate(cfg.close_cron)) {
    console.warn(
      `[scheduler] cron invalide pour le channel ${cfg.channel_id}, ignoré.`
    );
    return;
  }
  if (!isValidTimezone(cfg.timezone)) {
    console.warn(
      `[scheduler] fuseau « ${cfg.timezone} » invalide pour le channel ${cfg.channel_id}, ignoré.`
    );
    return;
  }

  try {
    // `name` stable par salon : node-cron remplace au lieu d'accumuler dans son
    // registre global à chaque resynchronisation (évite une fuite mémoire).
    const open = cron.schedule(
      cfg.open_cron,
      () => {
        void openSession(client, cfg.channel_id, cfg.guild_id, null).catch((e) =>
          console.error('[scheduler] échec ouverture auto', e)
        );
      },
      { timezone: cfg.timezone, name: `${cfg.channel_id}:open` }
    );

    const close = cron.schedule(
      cfg.close_cron,
      () => {
        void closeSession(client, cfg.channel_id, null).catch((e) =>
          console.error('[scheduler] échec fermeture auto', e)
        );
      },
      { timezone: cfg.timezone, name: `${cfg.channel_id}:close` }
    );

    jobs.set(cfg.channel_id, { open, close });
  } catch (e) {
    console.error(
      `[scheduler] impossible de planifier le channel ${cfg.channel_id}, ignoré :`,
      e
    );
  }
}

/**
 * (Re)construit tous les jobs cron à partir de la config en base.
 * À appeler au démarrage et après toute modification d'un planning.
 */
export function syncSchedules(client: Client): void {
  clearJobs();
  const channels = listAutoScheduleChannels();
  for (const cfg of channels) registerChannel(client, cfg);
  console.log(`[scheduler] ${jobs.size} planning(s) auto actif(s).`);
}
