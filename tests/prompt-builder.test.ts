// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt } from '../src/prompts/prompt-builder.js';

test('prompt preset can override character system prompt', () => {
  const prompt = buildPrompt({
    characterCard: {
      data: {
        name: 'Mira',
        system_prompt: 'Character card system prompt.',
        first_mes: 'Hello.'
      }
    },
    messages: [
      { role: 'user', content: 'Begin.' }
    ],
    promptPreset: {
      mainPrompt: 'Top menu system prompt.',
      ignoreCharacterSystemPrompt: true
    }
  });

  const systemText = prompt.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n');

  assert.match(systemText, /Top menu system prompt/);
  assert.doesNotMatch(systemText, /Character card system prompt/);
});
