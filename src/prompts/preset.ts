// @ts-nocheck
export const DEFAULT_MAIN_PROMPT = [
  'Generate the next in-character reply for {{char}} in an interactive fiction chat with {{user}}.',
  'Keep continuity with the established scene, respect known facts, and do not invent tool or dice results.',
  'Write vivid but concise prose. Treat concrete player input as an attempted action to resolve now, not as a request for a menu of options.',
  'Ask for player intent only when a required target, resource choice, or high-risk irreversible decision is genuinely missing.'
].join('\n');

export const DEFAULT_POST_HISTORY_PROMPT = [
  'Continue as {{char}}.',
  'Use only the supplied context as authoritative game state.',
  'If a rule check, random result, or external fact is needed, request a tool call in the host application instead of fabricating the result.'
].join('\n');

export const DEFAULT_PROMPT_PRESET = {
  id: 'ai-dnd-default',
  name: 'AI DND Default Chat',
  maxHistoryMessages: 40,
  rag: {
    collection: 'campaign-default',
    limit: 4,
    minScore: 0.15
  },
  worldInfo: {
    scanDepth: 8,
    budgetChars: 2500
  },
  mainPrompt: DEFAULT_MAIN_PROMPT,
  postHistoryPrompt: DEFAULT_POST_HISTORY_PROMPT,
  ignoreCharacterSystemPrompt: false
};

export function createPromptPreset(overrides = {}) {
  return {
    ...DEFAULT_PROMPT_PRESET,
    ...overrides,
    rag: {
      ...DEFAULT_PROMPT_PRESET.rag,
      ...(overrides.rag || {})
    },
    worldInfo: {
      ...DEFAULT_PROMPT_PRESET.worldInfo,
      ...(overrides.worldInfo || {})
    }
  };
}
