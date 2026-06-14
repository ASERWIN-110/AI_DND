// @ts-nocheck
import { assertPlainObject, ensureString } from '../utils/id.js';

const DEFAULT_DATA = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  tags: [],
  creator: '',
  character_version: '',
  extensions: {},
  character_book: undefined
};

export function normalizeCharacterCard(input = {}) {
  assertPlainObject(input, 'character card');

  const sourceData = input.spec === 'chara_card_v2' && input.data
    ? input.data
    : input.data && input.name === undefined
      ? input.data
      : input;

  assertPlainObject(sourceData, 'character card data');

  const data = {
    ...DEFAULT_DATA,
    ...sourceData,
    name: sourceData.name || sourceData.char_name || sourceData.character_name || '',
    description: sourceData.description || sourceData.char_persona || '',
    personality: sourceData.personality || sourceData.personality_summary || '',
    first_mes: sourceData.first_mes || sourceData.first_message || '',
    mes_example: sourceData.mes_example || sourceData.example_dialogue || '',
    creator_notes: sourceData.creator_notes || sourceData.creatorcomment || '',
    alternate_greetings: normalizeArray(sourceData.alternate_greetings),
    tags: normalizeArray(sourceData.tags),
    extensions: normalizeExtensions(sourceData.extensions),
    character_book: sourceData.character_book || sourceData.char_book
  };

  return {
    spec: 'chara_card_v2',
    spec_version: input.spec_version || '2.0',
    data
  };
}

export function getCharacterData(card) {
  return normalizeCharacterCard(card).data;
}

export function applyMacros(text, context = {}) {
  const charName = context.charName || context.characterName || 'Character';
  const userName = context.userName || 'User';
  const original = context.original || '';

  return ensureString(text)
    .replaceAll('{{char}}', charName)
    .replaceAll('{{user}}', userName)
    .replaceAll('{{original}}', original);
}

export function renderCharacterSections(card, options = {}) {
  const normalized = normalizeCharacterCard(card);
  const data = normalized.data;
  const context = {
    charName: data.name || 'Character',
    userName: options.userName || 'User'
  };

  const sections = [];

  pushSection(sections, 'character.name', 'Character Name', data.name, context);
  pushSection(sections, 'character.description', 'Character Profile', data.description, context);
  pushSection(sections, 'character.personality', 'Personality', data.personality, context);
  pushSection(sections, 'character.scenario', 'Scenario', data.scenario, context);
  pushSection(sections, 'character.examples', 'Example Dialogue', data.mes_example, context);

  return sections;
}

export function resolvePromptOverride(defaultText, overrideText, context = {}) {
  if (!overrideText) {
    return applyMacros(defaultText, context);
  }

  if (overrideText.includes('{{original}}')) {
    return applyMacros(overrideText, {
      ...context,
      original: applyMacros(defaultText, context)
    });
  }

  return applyMacros(overrideText, context);
}

function pushSection(sections, id, title, content, context) {
  const rendered = applyMacros(content, context).trim();
  if (!rendered) return;

  sections.push({
    id,
    title,
    role: 'system',
    content: `## ${title}\n${rendered}`
  });
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((item) => ensureString(item)).filter(Boolean) : [];
}

function normalizeExtensions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

