// @ts-nocheck
import { getCurrentToolExecutionContext } from '../tools/tool-plugin-manager.js';

export class ContextualChatProvider {
  constructor({ defaultProvider, resolveProvider } = {}) {
    if (!defaultProvider || typeof defaultProvider.generate !== 'function') {
      throw new TypeError('ContextualChatProvider requires defaultProvider.generate');
    }
    if (typeof resolveProvider !== 'function') {
      throw new TypeError('ContextualChatProvider requires resolveProvider');
    }
    this.defaultProvider = defaultProvider;
    this.resolveProvider = resolveProvider;
  }

  async generate(request = {}) {
    const execution = getCurrentToolExecutionContext();
    const settings = resolveExecutionApiSettings(execution);
    const promptSettings = resolveExecutionPromptSettings(execution);
    const requestWithPromptSettings = promptSettings
      ? applyPromptSettings(request, promptSettings, execution)
      : request;
    const provider = settings
      ? this.resolveProvider({ api: settings })
      : this.defaultProvider;
    return provider.generate({
      ...requestWithPromptSettings,
      temperature: requestWithPromptSettings.temperature ?? parseOptionalNumber(settings?.temperature),
      maxTokens: requestWithPromptSettings.maxTokens ?? parseOptionalPositiveInteger(settings?.maxTokens),
      extra: {
        ...(settings?.extra && isPlainObject(settings.extra) ? settings.extra : {}),
        ...(requestWithPromptSettings.extra || {})
      }
    });
  }
}

function resolveExecutionApiSettings(execution) {
  const context = execution?.context;
  if (!context || typeof context !== 'object') return undefined;
  const direct = context.api || context.apiSettings || context.llmApi || context.llm?.api;
  if (isUsableApiSettings(direct)) return direct;

  const targets = context.llm?.targets || context.apiTargets;
  if (!targets || typeof targets !== 'object') return undefined;
  const toolId = execution.tool?.id;
  const pluginId = execution.plugin?.id;
  for (const key of [toolId, pluginId, 'tool-calling', 'tools', 'default']) {
    if (isUsableApiSettings(targets[key])) return targets[key];
  }
  return undefined;
}

function resolveExecutionPromptSettings(execution) {
  const context = execution?.context;
  if (!context || typeof context !== 'object') return undefined;
  const sources = [
    context.llm?.promptOverrides,
    context.llmPromptOverrides,
    context.promptOverrides,
    context.llmPrompts
  ].filter((source) => source && typeof source === 'object');
  if (sources.length === 0) return undefined;

  const toolId = execution.tool?.id;
  const pluginId = execution.plugin?.id;
  for (const source of sources) {
    for (const key of [toolId, pluginId, 'default']) {
      const settings = normalizePromptSettings(source[key]);
      if (settings) return settings;
    }
  }
  return undefined;
}

function normalizePromptSettings(value) {
  if (!value || typeof value !== 'object') return undefined;
  const settings = {
    enabled: value.enabled !== false,
    mode: value.mode === 'replace' ? 'replace' : 'inject',
    replacementPrompt: String(value.replacementPrompt || value.replacement || value.prompt || '').trim(),
    systemPrompt: String(value.systemPrompt || value.system || '').trim(),
    promptPrefix: String(value.promptPrefix || value.prefix || '').trim(),
    promptSuffix: String(value.promptSuffix || value.suffix || '').trim(),
    references: String(value.references || value.referenceMaterial || value.reference || '').trim()
  };
  if (!settings.enabled) return undefined;
  if (!settings.replacementPrompt && !settings.systemPrompt && !settings.promptPrefix && !settings.promptSuffix && !settings.references) {
    return undefined;
  }
  return settings;
}

function applyPromptSettings(request, settings, execution) {
  const messages = Array.isArray(request.messages)
    ? request.messages.map((message) => ({ ...message }))
    : [];
  const toolId = execution?.tool?.id || 'tool';

  const injectedSystemMessages = [];
  if (settings.systemPrompt) {
    injectedSystemMessages.push({
      role: 'system',
      content: settings.systemPrompt
    });
  }
  if (settings.references) {
    injectedSystemMessages.push({
      role: 'system',
      content: `Reference material for ${toolId}:\n${settings.references}`
    });
  }
  if (injectedSystemMessages.length > 0) {
    messages.unshift(...injectedSystemMessages);
  }

  const userIndex = findLastUserMessageIndex(messages);
  if (settings.mode === 'replace' && settings.replacementPrompt) {
    if (userIndex >= 0) {
      messages[userIndex] = {
        ...messages[userIndex],
        content: settings.replacementPrompt
      };
    } else {
      messages.push({ role: 'user', content: settings.replacementPrompt });
    }
  } else if (settings.promptPrefix || settings.promptSuffix) {
    const content = [
      settings.promptPrefix,
      userIndex >= 0 ? messages[userIndex].content : '',
      settings.promptSuffix
    ].filter(Boolean).join('\n\n');
    if (userIndex >= 0) {
      messages[userIndex] = {
        ...messages[userIndex],
        content
      };
    } else {
      messages.push({ role: 'user', content });
    }
  }

  return {
    ...request,
    messages
  };
}

function findLastUserMessageIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function isUsableApiSettings(value) {
  if (!value || typeof value !== 'object') return false;
  const provider = String(value.provider || '').trim();
  return Boolean(provider && provider !== 'server');
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  return Math.floor(number);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
