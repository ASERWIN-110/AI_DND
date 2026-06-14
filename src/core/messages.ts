// @ts-nocheck
import { createId, ensureString, nowIso } from '../utils/id.js';

export const MESSAGE_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

export function createMessage({ id, role, content, name, metadata, createdAt } = {}) {
  if (!MESSAGE_ROLES.has(role)) {
    throw new TypeError(`Invalid message role: ${role}`);
  }

  return {
    id: id || createId('msg'),
    role,
    content: ensureString(content),
    name: name ? ensureString(name) : undefined,
    metadata: metadata || {},
    createdAt: createdAt || nowIso()
  };
}

export function trimMessagesByCount(messages, maxMessages = 40) {
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) {
    return [];
  }
  return messages.slice(Math.max(0, messages.length - maxMessages));
}

export function serializeDialogue(messages, { includeNames = true } = {}) {
  return messages
    .map((message) => {
      const label = includeNames && message.name ? `${message.name} (${message.role})` : message.role;
      return `${label}: ${message.content}`;
    })
    .join('\n');
}

export function toProviderMessage(message) {
  const providerMessage = {
    role: message.role,
    content: message.content
  };

  if (message.name) {
    providerMessage.name = message.name;
  }

  return providerMessage;
}

