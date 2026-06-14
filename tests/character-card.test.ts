// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMacros,
  normalizeCharacterCard,
  resolvePromptOverride
} from '../src/index.js';

test('normalizes v1-style character card fields', () => {
  const card = normalizeCharacterCard({
    char_name: 'GM',
    char_persona: 'Runs the game.',
    first_message: 'Begin.'
  });

  assert.equal(card.spec, 'chara_card_v2');
  assert.equal(card.data.name, 'GM');
  assert.equal(card.data.description, 'Runs the game.');
  assert.equal(card.data.first_mes, 'Begin.');
});

test('applies SillyTavern-style macros', () => {
  const rendered = applyMacros('{{char}} greets {{user}}.', {
    charName: 'Mira',
    userName: 'Player'
  });

  assert.equal(rendered, 'Mira greets Player.');
});

test('resolves prompt override with original placeholder', () => {
  const rendered = resolvePromptOverride('Base for {{char}}.', '{{original}}\nExtra.', {
    charName: 'Mira'
  });

  assert.equal(rendered, 'Base for Mira.\nExtra.');
});

