import type { SanctionCounters, UserSanctionCounters } from './sanctions.js';

const REASON_LABELS: Record<string, string> = {
  duplicate: 'doublon',
  'partial-duplicate': 'doublon partiel',
  flood: 'flood',
  'no-submission': 'message sans son',
  cooldown: 'cooldown',
  'one-per-person': 'limite par personne',
  'multiple-submissions': 'plusieurs sons',
  'muted-message': 'message pendant timeout',
};

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

function duration(ms: number): string {
  if (ms <= 0) return '0 min';
  const minutes = Math.ceil(ms / 60_000);
  return minutes >= 60 && minutes % 60 === 0
    ? plural(minutes / 60, 'h', 'h')
    : plural(minutes, 'min', 'min');
}

export function formatSanctionHeadline(t: SanctionCounters): string {
  return (
    `**Sanctions : ${t.incidents}** ${t.incidents === 1 ? 'incident' : 'incidents'} — ` +
    `${plural(t.deleted, 'message supprimé', 'messages supprimés')}, ` +
    `${plural(t.warned, 'avertissement')}, ${plural(t.timeouts, 'timeout')}, ` +
    `${plural(t.bans, 'ban')}.`
  );
}

function userLine(user: UserSanctionCounters, rank?: number): string {
  const prefix = rank === undefined ? '•' : `${rank}.`;
  const reasons = Object.entries(user.reasons)
    .map(([reason, count]) => `${REASON_LABELS[reason] ?? reason}: ${count}`)
    .join(', ');
  return (
    `${prefix} <@${user.userId}> — ${plural(user.incidents, 'incident')}, ` +
    `${plural(user.deleted, 'suppression')}, ${plural(user.warned, 'avertissement')}, ` +
    `${plural(user.timeouts, 'timeout')} (${duration(user.timeoutMs)}), ${plural(user.bans, 'ban')}` +
    (reasons ? ` — ${reasons}` : '')
  );
}

export function formatDetailedSanctions(
  sessionId: number,
  summary: { totals: SanctionCounters; users: UserSanctionCounters[] }
): string {
  const lines = [
    `## Récap sanctions — Séance #${sessionId}`,
    formatSanctionHeadline(summary.totals),
    `**Durée cumulée des timeouts :** ${duration(summary.totals.timeoutMs)}`,
    '',
    '**Top des utilisateurs sanctionnés**',
  ];
  if (summary.users.length === 0) lines.push('Aucune sanction.');
  else summary.users.slice(0, 5).forEach((u, i) => lines.push(userLine(u, i + 1)));
  lines.push('', '**Liste complète**');
  if (summary.users.length === 0) lines.push('Aucun utilisateur sanctionné.');
  else summary.users.forEach((u) => lines.push(userLine(u)));
  return lines.join('\n');
}

export function chunkDiscordText(text: string, max = 1900): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (line.length <= max) current = line;
    else {
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
