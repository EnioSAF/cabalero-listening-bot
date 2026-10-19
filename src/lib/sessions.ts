import type { Client } from 'discord.js';
import {
  countDistinctPosters,
  countSubmissions,
  getChannelConfig,
  getSession,
  listUnfinalizedSessions,
  listSessionSanctions,
  markSessionOutputComplete,
  startSession,
  stopSession,
} from '../db.js';
import { resetChannel } from './antiflood.js';
import { fetchSendableChannel } from './channels.js';
import { backupSession } from './backup.js';
import { persona } from './persona.js';
import { summarizeSanctions, type SanctionEvent, type SanctionReason } from './sanctions.js';
import { chunkDiscordText, formatDetailedSanctions, formatSanctionHeadline } from './session-summary.js';
import { scheduleSessionRetention } from './retention.js';

const SANCTIONS_THREAD_ID = '1561744399057166406';
const FINALIZE_RETRY_MS = 5 * 60_000;
const finalizing = new Set<number>();

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

function sessionSanctions(sessionId: number) {
  const events: SanctionEvent[] = listSessionSanctions(sessionId).map((row) => ({
    userId: row.user_id,
    reason: row.reason as SanctionReason,
    deleted: row.message_deleted === 1,
    warned: row.warning_sent === 1,
    timeoutMs: row.timeout_ms,
    banned: row.banned === 1,
  }));
  return summarizeSanctions(events);
}

async function finalizeSession(client: Client, sessionId: number): Promise<void> {
  if (finalizing.has(sessionId)) return;
  finalizing.add(sessionId);
  let complete = false;
  try {
    let session = getSession(sessionId);
    if (!session || session.ended_at === null || session.purge_at !== null) return;
    const cfg = getChannelConfig(session.channel_id);
    if (!cfg) return;

    if (session.backup_completed !== 1) {
      const backedUp = await backupSession(client, cfg, session);
      if (!backedUp) return;
      markSessionOutputComplete(sessionId, 'backup');
    }

    session = getSession(sessionId);
    if (!session) return;
    if (session.sanctions_report_completed !== 1) {
      const thread = await fetchSendableChannel(client, SANCTIONS_THREAD_ID);
      if (!thread) return;
      const detail = formatDetailedSanctions(sessionId, sessionSanctions(sessionId));
      for (const chunk of chunkDiscordText(detail)) {
        const sent = await thread
          .send({ content: chunk, allowedMentions: { parse: [] } })
          .then(() => true)
          .catch(() => false);
        if (!sent) return;
      }
      markSessionOutputComplete(sessionId, 'sanctions');
    }

    complete = await scheduleSessionRetention(client, sessionId);
  } catch (e) {
    console.error(`[sessions] finalisation séance ${sessionId}`, e);
  } finally {
    finalizing.delete(sessionId);
    if (!complete && getSession(sessionId)?.purge_at === null) {
      const timer = setTimeout(() => void finalizeSession(client, sessionId), FINALIZE_RETRY_MS);
      timer.unref();
    }
  }
}

export function resumeSessionFinalizations(client: Client): void {
  for (const session of listUnfinalizedSessions()) void finalizeSession(client, session.id);
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

  const sanctions = sessionSanctions(sessionId);
  const sanctionHeadline = formatSanctionHeadline(sanctions.totals);

  const channel = await fetchSendableChannel(client, channelId);
  if (channel) {
    await channel.send(persona.announceClose(total, posters, sanctionHeadline)).catch(() => {});
  }


  void finalizeSession(client, sessionId);

  return { closed: true, total, posters };
}
