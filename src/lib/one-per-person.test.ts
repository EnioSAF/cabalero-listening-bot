import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOnePerPersonSubmission } from './one-per-person.js';

test('refuse un premier message contenant plusieurs sons', () => {
  assert.equal(validateOnePerPersonSubmission(0, 2), 'too-many');
});

test('accepte un premier message contenant exactement un son', () => {
  assert.equal(validateOnePerPersonSubmission(0, 1), 'allowed');
});

test('refuse un nouveau son quand la personne en a déjà déposé un', () => {
  assert.equal(validateOnePerPersonSubmission(1, 1), 'already-submitted');
});
