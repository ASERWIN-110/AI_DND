// @ts-nocheck
import { normalizeCharacterCard } from '../characters/character-card.js';
import { normalizeWorldBook, selectWorldInfoEntries } from '../characters/world-info.js';

export function normalizeSillyTavernCharacterCard(input) {
  return normalizeCharacterCard(input);
}

export function normalizeSillyTavernWorldBook(input) {
  return normalizeWorldBook(input);
}

export function activateSillyTavernWorldInfo(worldBook, messages, options = {}) {
  return selectWorldInfoEntries(worldBook, messages, {
    scanDepth: 8,
    maxRecursionSteps: 2,
    ...options
  });
}

export const SILLYTAVERN_COMPATIBILITY_NOTES = {
  characterCards: [
    'Accepts Character Card V2-style JSON payloads and several legacy aliases.',
    'Supports {{char}}, {{user}}, and {{original}} prompt macros.'
  ],
  worldInfo: [
    'Supports entries arrays and SillyTavern-style object maps.',
    'Supports key/keysecondary, constant, selective, disable, caseSensitive/case_sensitive, matchWholeWords/match_whole_words, useRegex/use_regex, useProbability/use_probability, probability, priority, order/insertion_order, and basic recursive activation.'
  ],
  licensing: 'This compatibility layer is an independent implementation. It does not vendor SillyTavern AGPL source code.'
};

