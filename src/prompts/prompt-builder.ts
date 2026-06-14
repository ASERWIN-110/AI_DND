// @ts-nocheck
import { createMessage, toProviderMessage, trimMessagesByCount } from '../core/messages.js';
import {
  applyMacros,
  getCharacterData,
  renderCharacterSections,
  resolvePromptOverride
} from '../characters/character-card.js';
import { selectWorldInfoEntries } from '../characters/world-info.js';
import { countTokens } from '../tokens/token-counter.js';
import { createPromptPreset } from './preset.js';

export function buildPrompt({
  characterCard,
  messages = [],
  userName = 'User',
  promptPreset,
  ragContext = [],
  worldInfoEntries,
  playerPersona = '',
  structuredInterfacePrompt = ''
} = {}) {
  const preset = createPromptPreset(promptPreset);
  const data = getCharacterData(characterCard);
  const charName = data.name || 'Character';
  const context = { charName, userName };
  const itemization = [];
  const output = [];

  const mainPrompt = resolvePromptOverride(
    preset.mainPrompt,
    preset.ignoreCharacterSystemPrompt ? '' : data.system_prompt,
    context
  );
  pushSystem(output, itemization, 'preset.main', 'Main Prompt', mainPrompt);

  const selectedWorldInfo = worldInfoEntries || selectWorldInfoEntries(
    data.character_book,
    messages,
    preset.worldInfo
  );
  if (selectedWorldInfo.length > 0) {
    pushSystem(
      output,
      itemization,
      'world-info',
      'World Info',
      selectedWorldInfo.map((entry) => entry.content).join('\n\n')
    );
  }

  if (playerPersona) {
    pushSystem(
      output,
      itemization,
      'player.persona',
      `${userName} Persona`,
      applyMacros(playerPersona, context)
    );
  }

  for (const section of renderCharacterSections(characterCard, { userName })) {
    output.push(createMessage(section));
    itemization.push({
      id: section.id,
      title: section.title,
      role: section.role,
      chars: section.content.length,
      tokens: countTokens(section.content)
    });
  }

  if (ragContext.length > 0) {
    pushSystem(
      output,
      itemization,
      'rag.context',
      'Retrieved Context',
      ragContext.map(formatRagHit).join('\n\n')
    );
  }

  const history = trimMessagesByCount(messages, preset.maxHistoryMessages)
    .filter((message) => message.role !== 'system')
    .map(toProviderMessage);
  output.push(...history);
  itemization.push({
    id: 'chat.history',
    title: 'Chat History',
    role: 'mixed',
    messages: history.length,
    chars: history.reduce((sum, message) => sum + message.content.length, 0),
    tokens: countTokens(history.map((message) => message.content).join('\n'))
  });

  const postHistoryPrompt = resolvePromptOverride(
    preset.postHistoryPrompt,
    data.post_history_instructions,
    context
  );
  pushSystem(output, itemization, 'preset.post-history', 'Post History Instructions', postHistoryPrompt);
  pushSystem(output, itemization, 'structured.interface', 'Structured Interface State', structuredInterfacePrompt);

  return {
    messages: output.map(toProviderMessage),
    itemization,
    usage: summarizePromptUsage(output),
    characterName: charName,
    userName,
    worldInfoEntries: selectedWorldInfo,
    ragContext
  };
}

function pushSystem(output, itemization, id, title, content) {
  const rendered = String(content || '').trim();
  if (!rendered) return;

  output.push(createMessage({
    role: 'system',
    content: `## ${title}\n${rendered}`
  }));
  itemization.push({
    id,
    title,
    role: 'system',
    chars: rendered.length,
    tokens: countTokens(rendered)
  });
}

function formatRagHit(hit, index) {
  const source = hit.metadata?.sourceId || hit.id || `hit-${index + 1}`;
  const score = Number.isFinite(hit.score) ? ` score=${hit.score.toFixed(3)}` : '';
  return `[${source}${score}]\n${hit.text}`;
}

function summarizePromptUsage(messages) {
  const content = messages.map((message) => message.content).join('\n');
  return {
    messages: messages.length,
    chars: content.length,
    tokens: countTokens(content)
  };
}
