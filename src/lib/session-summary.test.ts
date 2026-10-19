import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDetailedSanctions, formatSanctionHeadline } from './session-summary.js';
import { summarizeSanctions } from './sanctions.js';

test('formate le total destiné au salon principal', () => {
  const summary = summarizeSanctions([
    { userId: '42', reason: 'duplicate', deleted: true, warned: true, timeoutMs: 60_000, banned: false },
  ]);
  assert.equal(
    formatSanctionHeadline(summary.totals),
    '**Sanctions : 1** incident — 1 message supprimé, 1 avertissement, 1 timeout, 0 bans.'
  );
});

test('inclut le top et la liste complète dans le rapport détaillé', () => {
  const summary = summarizeSanctions([
    { userId: '42', reason: 'duplicate', deleted: true, warned: true, timeoutMs: 60_000, banned: false },
  ]);
  const text = formatDetailedSanctions(7, summary);
  assert.match(text, /Séance #7/);
  assert.match(text, /Top des utilisateurs sanctionnés/);
  assert.match(text, /<@42>/);
  assert.match(text, /1 min/);
  assert.match(text, /doublon: 1/);
});
