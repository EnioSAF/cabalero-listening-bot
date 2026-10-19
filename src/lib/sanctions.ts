export type SanctionReason =
  | 'duplicate'
  | 'partial-duplicate'
  | 'flood'
  | 'no-submission'
  | 'cooldown'
  | 'one-per-person'
  | 'multiple-submissions'
  | 'muted-message';

export interface SanctionEvent {
  userId: string;
  reason: SanctionReason;
  deleted: boolean;
  warned: boolean;
  timeoutMs: number;
  banned: boolean;
}

export interface SanctionCounters {
  incidents: number;
  deleted: number;
  warned: number;
  timeouts: number;
  timeoutMs: number;
  bans: number;
}

export interface UserSanctionCounters extends SanctionCounters {
  userId: string;
  reasons: Partial<Record<SanctionReason, number>>;
}

const emptyCounters = (): SanctionCounters => ({
  incidents: 0,
  deleted: 0,
  warned: 0,
  timeouts: 0,
  timeoutMs: 0,
  bans: 0,
});

function add(counters: SanctionCounters, event: SanctionEvent): void {
  counters.incidents++;
  if (event.deleted) counters.deleted++;
  if (event.warned) counters.warned++;
  if (event.timeoutMs > 0) counters.timeouts++;
  counters.timeoutMs += event.timeoutMs;
  if (event.banned) counters.bans++;
}

export function summarizeSanctions(events: SanctionEvent[]): {
  totals: SanctionCounters;
  users: UserSanctionCounters[];
} {
  const totals = emptyCounters();
  const byUser = new Map<string, UserSanctionCounters>();
  for (const event of events) {
    add(totals, event);
    let user = byUser.get(event.userId);
    if (!user) {
      user = { userId: event.userId, ...emptyCounters(), reasons: {} };
      byUser.set(event.userId, user);
    }
    add(user, event);
    user.reasons[event.reason] = (user.reasons[event.reason] ?? 0) + 1;
  }
  const users = [...byUser.values()].sort(
    (a, b) => b.incidents - a.incidents || b.timeouts - a.timeouts || a.userId.localeCompare(b.userId)
  );
  return { totals, users };
}
