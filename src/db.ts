import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './env.js';
import { DEFAULTS } from './config.js';

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

export const db = new Database(env.DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// WAL + synchronous=NORMAL : durable et bien plus rapide en écriture (pas de
// fsync à chaque transaction). busy_timeout : tolère les écritures concurrentes.
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS channel_config (
    channel_id        TEXT PRIMARY KEY,
    guild_id          TEXT NOT NULL,
    managed           INTEGER NOT NULL DEFAULT 1,
    auto_schedule     INTEGER NOT NULL DEFAULT 0,
    open_cron         TEXT NOT NULL,
    close_cron        TEXT NOT NULL,
    timezone          TEXT NOT NULL,
    cooldown_sec      INTEGER NOT NULL,
    flood_max         INTEGER NOT NULL,
    flood_window_sec  INTEGER NOT NULL,
    require_submission INTEGER NOT NULL DEFAULT 0,
    active_session_id INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    started_by  TEXT,
    ended_at    INTEGER,
    ended_by    TEXT
  );

  CREATE TABLE IF NOT EXISTS submission (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL,
    channel_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    kind        TEXT NOT NULL,
    identifier  TEXT NOT NULL,
    display     TEXT,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sanction (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL,
    user_id         TEXT NOT NULL,
    reason          TEXT NOT NULL,
    message_deleted INTEGER NOT NULL,
    warning_sent    INTEGER NOT NULL,
    timeout_ms      INTEGER NOT NULL DEFAULT 0,
    banned          INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_unique
    ON submission(session_id, identifier);
  CREATE INDEX IF NOT EXISTS idx_submission_session
    ON submission(session_id);
  -- Utilisé à chaque message/édition (deleteSubmissionsByMessage / listMessageIdentifiers).
  CREATE INDEX IF NOT EXISTS idx_submission_message
    ON submission(message_id);
  -- Utilisé par getLatestSession (/session clear).
  CREATE INDEX IF NOT EXISTS idx_session_channel
    ON session(channel_id);
  CREATE INDEX IF NOT EXISTS idx_sanction_session
    ON sanction(session_id);
`);

// --- Migrations légères (colonnes ajoutées après coup) ---
function ensureColumn(table: string, column: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
ensureColumn('channel_config', 'backup_channel_id', 'TEXT');
ensureColumn('channel_config', 'one_per_person', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('channel_config', 'bypass_roles', 'TEXT');
ensureColumn('session', 'purge_at', 'INTEGER');
ensureColumn('session', 'retention_channel_id', 'TEXT');
ensureColumn('session', 'retention_message_id', 'TEXT');
ensureColumn('session', 'backup_completed', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('session', 'sanctions_report_completed', 'INTEGER NOT NULL DEFAULT 0');

export interface ChannelConfig {
  channel_id: string;
  guild_id: string;
  managed: number;
  auto_schedule: number;
  open_cron: string;
  close_cron: string;
  timezone: string;
  cooldown_sec: number;
  flood_max: number;
  flood_window_sec: number;
  require_submission: number;
  one_per_person: number;
  bypass_roles: string | null;
  backup_channel_id: string | null;
  active_session_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: number;
  channel_id: string;
  guild_id: string;
  started_at: number;
  started_by: string | null;
  ended_at: number | null;
  ended_by: string | null;
  purge_at: number | null;
  retention_channel_id: string | null;
  retention_message_id: string | null;
  backup_completed: number;
  sanctions_report_completed: number;
}

export interface SanctionRow {
  id: number;
  session_id: number;
  user_id: string;
  reason: string;
  message_deleted: number;
  warning_sent: number;
  timeout_ms: number;
  banned: number;
  created_at: number;
}

export interface SubmissionRow {
  id: number;
  session_id: number;
  channel_id: string;
  user_id: string;
  message_id: string;
  kind: string;
  identifier: string;
  display: string | null;
  created_at: number;
}

const stmt = {
  getChannel: db.prepare('SELECT * FROM channel_config WHERE channel_id = ?'),
  listManaged: db.prepare('SELECT * FROM channel_config WHERE managed = 1'),
  listAuto: db.prepare(
    'SELECT * FROM channel_config WHERE managed = 1 AND auto_schedule = 1'
  ),
  listActiveSessions: db.prepare(
    'SELECT * FROM channel_config WHERE managed = 1 AND active_session_id IS NOT NULL'
  ),
  insertChannel: db.prepare(`
    INSERT INTO channel_config (
      channel_id, guild_id, managed, auto_schedule, open_cron, close_cron,
      timezone, cooldown_sec, flood_max, flood_window_sec, require_submission,
      active_session_id, created_at, updated_at
    ) VALUES (
      @channel_id, @guild_id, 1, 0, @open_cron, @close_cron,
      @timezone, @cooldown_sec, @flood_max, @flood_window_sec, 0,
      NULL, @now, @now
    )
  `),
  setActiveSession: db.prepare(
    'UPDATE channel_config SET active_session_id = ?, updated_at = ? WHERE channel_id = ?'
  ),
  insertSession: db.prepare(`
    INSERT INTO session (channel_id, guild_id, started_at, started_by)
    VALUES (@channel_id, @guild_id, @started_at, @started_by)
  `),
  endSession: db.prepare(
    'UPDATE session SET ended_at = ?, ended_by = ? WHERE id = ?'
  ),
  getSession: db.prepare('SELECT * FROM session WHERE id = ?'),
  getLatestSession: db.prepare(
    'SELECT * FROM session WHERE channel_id = ? ORDER BY id DESC LIMIT 1'
  ),
  listSessionSubmissions: db.prepare(
    'SELECT * FROM submission WHERE session_id = ? ORDER BY id ASC'
  ),
  findSubmission: db.prepare(
    'SELECT * FROM submission WHERE session_id = ? AND identifier = ?'
  ),
  deleteByMessage: db.prepare('DELETE FROM submission WHERE message_id = ?'),
  listByMessage: db.prepare('SELECT identifier FROM submission WHERE message_id = ?'),
  insertSubmission: db.prepare(`
    INSERT INTO submission (
      session_id, channel_id, user_id, message_id, kind, identifier, display, created_at
    ) VALUES (
      @session_id, @channel_id, @user_id, @message_id, @kind, @identifier, @display, @created_at
    )
  `),
  countSubmissions: db.prepare(
    'SELECT COUNT(*) AS n FROM submission WHERE session_id = ?'
  ),
  countDistinctPosters: db.prepare(
    'SELECT COUNT(DISTINCT user_id) AS n FROM submission WHERE session_id = ?'
  ),
  countUserSubmissions: db.prepare(
    'SELECT COUNT(*) AS n FROM submission WHERE session_id = ? AND user_id = ?'
  ),
  insertSanction: db.prepare(`
    INSERT INTO sanction (
      session_id, user_id, reason, message_deleted, warning_sent, timeout_ms, banned, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listSanctions: db.prepare('SELECT * FROM sanction WHERE session_id = ? ORDER BY id ASC'),
  listPendingPurges: db.prepare('SELECT * FROM session WHERE purge_at IS NOT NULL'),
  listUnfinalized: db.prepare(`
    SELECT * FROM session
    WHERE ended_at IS NOT NULL AND purge_at IS NULL
  `),
};

export function getChannelConfig(channelId: string): ChannelConfig | undefined {
  return stmt.getChannel.get(channelId) as ChannelConfig | undefined;
}

export function listManagedChannels(): ChannelConfig[] {
  return stmt.listManaged.all() as ChannelConfig[];
}

export function listAutoScheduleChannels(): ChannelConfig[] {
  return stmt.listAuto.all() as ChannelConfig[];
}

/** Salons gérés ayant une session actuellement ouverte (pour la réconciliation). */
export function listChannelsWithActiveSession(): ChannelConfig[] {
  return stmt.listActiveSessions.all() as ChannelConfig[];
}

/** Crée la config du channel avec les valeurs par défaut si elle n'existe pas. */
export function ensureChannelConfig(
  channelId: string,
  guildId: string
): ChannelConfig {
  const existing = getChannelConfig(channelId);
  if (existing) return existing;
  const now = Date.now();
  stmt.insertChannel.run({
    channel_id: channelId,
    guild_id: guildId,
    open_cron: DEFAULTS.openCron,
    close_cron: DEFAULTS.closeCron,
    timezone: env.DEFAULT_TIMEZONE,
    cooldown_sec: DEFAULTS.cooldownSec,
    flood_max: DEFAULTS.floodMax,
    flood_window_sec: DEFAULTS.floodWindowSec,
    now,
  });
  return getChannelConfig(channelId)!;
}

type ChannelPatch = Partial<
  Pick<
    ChannelConfig,
    | 'managed'
    | 'auto_schedule'
    | 'open_cron'
    | 'close_cron'
    | 'timezone'
    | 'cooldown_sec'
    | 'flood_max'
    | 'flood_window_sec'
    | 'require_submission'
    | 'one_per_person'
    | 'bypass_roles'
    | 'backup_channel_id'
  >
>;

const PATCHABLE_COLUMNS = [
  'managed',
  'auto_schedule',
  'open_cron',
  'close_cron',
  'timezone',
  'cooldown_sec',
  'flood_max',
  'flood_window_sec',
  'require_submission',
  'one_per_person',
  'bypass_roles',
  'backup_channel_id',
] as const;

export function updateChannelConfig(channelId: string, patch: ChannelPatch): void {
  const keys = PATCHABLE_COLUMNS.filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = { channel_id: channelId, now: Date.now() };
  for (const k of keys) params[k] = patch[k];
  db.prepare(
    `UPDATE channel_config SET ${setClause}, updated_at = @now WHERE channel_id = @channel_id`
  ).run(params);
}

/** Ouvre une nouvelle session sur le channel et la marque active. */
export function startSession(
  channelId: string,
  guildId: string,
  startedBy: string | null
): number {
  const tx = db.transaction(() => {
    const info = stmt.insertSession.run({
      channel_id: channelId,
      guild_id: guildId,
      started_at: Date.now(),
      started_by: startedBy,
    });
    const sessionId = Number(info.lastInsertRowid);
    stmt.setActiveSession.run(sessionId, Date.now(), channelId);
    return sessionId;
  });
  return tx();
}

/** Ferme la session active du channel. Renvoie l'id fermé ou null si aucune. */
export function stopSession(channelId: string, endedBy: string | null): number | null {
  const cfg = getChannelConfig(channelId);
  if (!cfg || cfg.active_session_id === null) return null;
  const sessionId = cfg.active_session_id;
  const tx = db.transaction(() => {
    stmt.endSession.run(Date.now(), endedBy, sessionId);
    stmt.setActiveSession.run(null, Date.now(), channelId);
  });
  tx();
  return sessionId;
}

export function getSession(sessionId: number): SessionRow | undefined {
  return stmt.getSession.get(sessionId) as SessionRow | undefined;
}

/** Session la plus récente d'un salon (active ou terminée), pour le clear. */
export function getLatestSession(channelId: string): SessionRow | undefined {
  return stmt.getLatestSession.get(channelId) as SessionRow | undefined;
}

/** Toutes les soumissions d'une session, dans l'ordre, pour le récap de backup. */
export function listSessionSubmissions(sessionId: number): SubmissionRow[] {
  return stmt.listSessionSubmissions.all(sessionId) as SubmissionRow[];
}

/** Supprime tous les enregistrements liés à un message (re-évaluation après édition). */
export function deleteSubmissionsByMessage(messageId: string): void {
  stmt.deleteByMessage.run(messageId);
}

/** Identifiants de sons déjà enregistrés pour ce message. */
export function listMessageIdentifiers(messageId: string): string[] {
  return (stmt.listByMessage.all(messageId) as { identifier: string }[]).map(
    (r) => r.identifier
  );
}

/** Renvoie la soumission déjà enregistrée pour cet identifiant, si elle existe. */
export function getSubmission(
  sessionId: number,
  identifier: string
): SubmissionRow | undefined {
  return stmt.findSubmission.get(sessionId, identifier) as SubmissionRow | undefined;
}

/** Renvoie la 1re soumission déjà enregistrée correspondant à l'un des identifiants. */
export function findDuplicateSubmission(
  sessionId: number,
  identifiers: string[]
): SubmissionRow | undefined {
  for (const id of identifiers) {
    const existing = stmt.findSubmission.get(sessionId, id) as
      | SubmissionRow
      | undefined;
    if (existing) return existing;
  }
  return undefined;
}

export interface RecordResult {
  status: 'recorded' | 'duplicate';
  duplicateOf?: SubmissionRow;
}

/**
 * Vérifie qu'aucun des identifiants n'a déjà été posté dans la session, puis
 * les enregistre tous de façon atomique. Synchrone : pas de course possible
 * entre deux messages (better-sqlite3 est bloquant, Node mono-thread).
 */
export function recordSubmissions(
  sessionId: number,
  channelId: string,
  userId: string,
  messageId: string,
  subs: { kind: string; identifier: string; display: string }[]
): RecordResult {
  const session = getSession(sessionId);
  if (!session || session.ended_at !== null) return { status: 'duplicate' };
  for (const s of subs) {
    const existing = stmt.findSubmission.get(sessionId, s.identifier) as
      | SubmissionRow
      | undefined;
    if (existing) return { status: 'duplicate', duplicateOf: existing };
  }
  const now = Date.now();
  const tx = db.transaction(() => {
    for (const s of subs) {
      stmt.insertSubmission.run({
        session_id: sessionId,
        channel_id: channelId,
        user_id: userId,
        message_id: messageId,
        kind: s.kind,
        identifier: s.identifier,
        display: s.display,
        created_at: now,
      });
    }
  });
  tx();
  return { status: 'recorded' };
}

export function countSubmissions(sessionId: number): number {
  const row = stmt.countSubmissions.get(sessionId) as { n: number };
  return row.n;
}

export function countDistinctPosters(sessionId: number): number {
  const row = stmt.countDistinctPosters.get(sessionId) as { n: number };
  return row.n;
}

/** Nombre de sons déjà enregistrés par cet utilisateur dans la session. */
export function countUserSubmissions(sessionId: number, userId: string): number {
  const row = stmt.countUserSubmissions.get(sessionId, userId) as { n: number };
  return row.n;
}

export function recordSanction(
  sessionId: number,
  userId: string,
  reason: string,
  deleted: boolean,
  warned: boolean,
  timeoutMs = 0,
  banned = false
): void {
  const session = getSession(sessionId);
  if (!session || session.ended_at !== null) return;
  stmt.insertSanction.run(
    sessionId,
    userId,
    reason,
    deleted ? 1 : 0,
    warned ? 1 : 0,
    timeoutMs,
    banned ? 1 : 0,
    Date.now()
  );
}

export function listSessionSanctions(sessionId: number): SanctionRow[] {
  return stmt.listSanctions.all(sessionId) as SanctionRow[];
}

export function setSessionRetention(
  sessionId: number,
  purgeAt: number,
  channelId?: string,
  messageId?: string
): void {
  db.prepare(`
    UPDATE session SET purge_at = ?,
      retention_channel_id = COALESCE(?, retention_channel_id),
      retention_message_id = COALESCE(?, retention_message_id)
    WHERE id = ?
  `).run(purgeAt, channelId ?? null, messageId ?? null, sessionId);
}

export function listPendingSessionPurges(): SessionRow[] {
  return stmt.listPendingPurges.all() as SessionRow[];
}

export function listUnfinalizedSessions(): SessionRow[] {
  return stmt.listUnfinalized.all() as SessionRow[];
}

export function markSessionOutputComplete(
  sessionId: number,
  output: 'backup' | 'sanctions'
): void {
  const column = output === 'backup' ? 'backup_completed' : 'sanctions_report_completed';
  db.prepare(`UPDATE session SET ${column} = 1 WHERE id = ?`).run(sessionId);
}

export function purgeSessionData(sessionId: number): void {
  db.transaction(() => {
    db.prepare('DELETE FROM sanction WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM submission WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM session WHERE id = ? AND ended_at IS NOT NULL').run(sessionId);
  })();
}
