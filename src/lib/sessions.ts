import type { Client } from 'discord.js';
import {
  countDistinctPosters,
  countSubmissions,
  getChannelConfig,
  getSession,
  startSession,
  stopSession,
} from '../db.js';
import { resetChannel } from './antiflood.js';
import { fetchSendableChannel } from './channels.js';
import { backupSession } from './backup.js';
import { persona } from './persona.js';

export interface OpenResult {
  sessionId: number;
  alreadyOpen: boolean;
}

/** Ouvre une session sur le channel (idempotent) et poste l'annonce. */
export async function openSession(
  client: Client,
  channelId: string,
  guildId: string,
  startedBy: string | null
): Promise<OpenResult> {
  const cfg = getChannelConfig(channelId);
  if (cfg && cfg.active_session_id !== null) {
    return { sessionId: cfg.active_session_id, alreadyOpen: true };
  }

  const sessionId = startSession(channelId, guildId, startedBy);
  resetChannel(channelId);

  const channel = await fetchSendableChannel(client, channelId);
  if (channel) {
    await channel.send(persona.announceOpen()).catch(() => {});
  }

  return { sessionId, alreadyOpen: false };
}

export interface CloseResult {
  closed: boolean;
  total: number;
  posters: number;
}

/** Ferme la session active du channel, réplique le salon dans le backup, poste un récap. */
export async function closeSession(
  client: Client,
  channelId: string,
  endedBy: string | null
): Promise<CloseResult> {
  const cfg = getChannelConfig(channelId);
  if (!cfg || cfg.active_session_id === null) {
    return { closed: false, total: 0, posters: 0 };
  }

  const sessionId = cfg.active_session_id;
  const total = countSubmissions(sessionId);
  const posters = countDistinctPosters(sessionId);

  stopSession(channelId, endedBy);
  resetChannel(channelId);

  // Backup (réplication du salon) détaché : la réplication peut être longue
  // (gros volume + rate limits webhook), elle ne doit pas bloquer la réponse de
  // la commande ni la fenêtre du token d'interaction (15 min). Les messages
  // restent dans le salon jusqu'au /session clear, donc rien n'est perdu.
  const finished = getSession(sessionId);
  if (finished) {
    void backupSession(client, cfg, finished).catch((e) =>
      console.error('[sessions] échec du backup', e)
    );
  }

  const channel = await fetchSendableChannel(client, channelId);
  if (channel) {
    await channel.send(persona.announceClose(total, posters)).catch(() => {});
  }

  return { closed: true, total, posters };
}
