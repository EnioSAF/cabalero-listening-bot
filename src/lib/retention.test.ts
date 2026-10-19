import assert from 'node:assert/strict';
import test from 'node:test';
import { retentionDeadline } from './retention.js';

test('programme 24 heures sans décision', () => {
  assert.equal(retentionDeadline(1_000, 'pending'), 1_000 + 24 * 60 * 60 * 1000);
});

test('programme 30 jours après conservation', () => {
  assert.equal(retentionDeadline(1_000, 'keep'), 1_000 + 30 * 24 * 60 * 60 * 1000);
});
