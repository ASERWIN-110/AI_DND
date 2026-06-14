// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFirstJsonObject } from '../src/utils/json.js';

test('parseFirstJsonObject ignores prose after a valid object', () => {
  assert.deepEqual(parseFirstJsonObject('{"ok":true}\nextra explanation'), { ok: true });
});

test('parseFirstJsonObject returns the first object from multiple JSON objects', () => {
  assert.deepEqual(parseFirstJsonObject('{"first":1}\n{"second":2}'), { first: 1 });
});

test('parseFirstJsonObject handles braces inside JSON strings', () => {
  assert.deepEqual(parseFirstJsonObject('prefix {"text":"keep {this} literal","value":3} suffix'), {
    text: 'keep {this} literal',
    value: 3
  });
});

test('parseFirstJsonObject parses fenced JSON before surrounding prose', () => {
  assert.deepEqual(parseFirstJsonObject('Result:\n```json\n{"id":"plan"}\n```\nDone.'), { id: 'plan' });
});
