// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectWorldInfoEntries } from '../src/index.js';

test('activates regex and whole-word world info entries', () => {
  const entries = selectWorldInfoEntries({
    entries: [
      {
        uid: 1,
        key: ['\\bdoor\\b'],
        useRegex: true,
        content: 'Regex door entry.'
      },
      {
        uid: 2,
        key: ['key'],
        matchWholeWords: true,
        content: 'Whole word key entry.'
      }
    ]
  }, [
    { role: 'user', content: 'I inspect the door and key.' }
  ]);

  assert.deepEqual(entries.map((entry) => entry.uid), [1, 2]);
});

test('supports basic recursive activation', () => {
  const entries = selectWorldInfoEntries({
    entries: [
      {
        uid: 1,
        key: ['tower'],
        content: 'The tower mentions the Tidewright Guild.'
      },
      {
        uid: 2,
        key: ['Tidewright Guild'],
        content: 'The guild kept bronze ledgers.'
      }
    ]
  }, [
    { role: 'user', content: 'I enter the tower.' }
  ], {
    maxRecursionSteps: 2
  });

  assert.deepEqual(entries.map((entry) => entry.uid), [1, 2]);
});

test('respects probability controls with injected random function', () => {
  const entries = selectWorldInfoEntries({
    entries: [
      {
        uid: 1,
        key: ['tower'],
        useProbability: true,
        probability: 10,
        content: 'Rare entry.'
      }
    ]
  }, [
    { role: 'user', content: 'tower' }
  ], {
    random: () => 0.5
  });

  assert.equal(entries.length, 0);
});
