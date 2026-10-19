import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeSanctions, type SanctionEvent } from './sanctions.js';

const events: SanctionEvent[] = [
  { userId: 'a', reason: 'duplicate', deleted: true, warned: true, timeoutMs: 60_000, banned: false },
  { userId: 'a', reason: 'partial-duplicate', deleted: false, warned: true, timeoutMs: 0, banned: false },
  { userId: 'b', reason: 'flood', deleted: true, warned: false, timeoutMs: 0, banned: false },
];

test('agrège les sanctions globales et classe les utilisateurs', () => {
  const summary = summarizeSanctions(events);
  assert.deepEqual(summary.totals, {
    incidents: 3,
    deleted: 2,
    warned: 2,
    timeouts: 1,
    timeoutMs: 60_000,
    bans: 0,
  });
  assert.equal(summary.users[0]?.userId, 'a');
  assert.equal(summary.users[0]?.incidents, 2);
  assert.equal(summary.users[1]?.userId, 'b');
});

test('renvoie des totaux nuls sans sanction', () => {
  const summary = summarizeSanctions([]);
  assert.equal(summary.totals.incidents, 0);
  assert.deepEqual(summary.users, []);
});
