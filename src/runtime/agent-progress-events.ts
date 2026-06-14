// @ts-nocheck
import { EventEmitter } from 'node:events';
import { createId, nowIso } from '../utils/id.js';

export class AgentProgressEventBus {
  constructor({ now = nowIso, maxHistory = 200 } = {}) {
    this.now = now;
    this.maxHistory = maxHistory;
    this.emitter = new EventEmitter();
    this.sequence = 0;
    this.history = [];
  }

  publish(event = {}) {
    const payload = {
      id: event.id || createId('agent_event'),
      sequence: ++this.sequence,
      createdAt: event.createdAt || this.now(),
      ...event
    };
    this.history.push(payload);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    this.emitter.emit('event', payload);
    return payload;
  }

  subscribe(filter = {}, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Agent progress listener must be a function');
    }
    const normalizedFilter = normalizeProgressFilter(filter);
    const wrapped = (event) => {
      if (matchesProgressFilter(event, normalizedFilter)) listener(event);
    };
    this.emitter.on('event', wrapped);
    return () => this.emitter.off('event', wrapped);
  }

  list(filter = {}) {
    const normalizedFilter = normalizeProgressFilter(filter);
    return this.history.filter((event) => matchesProgressFilter(event, normalizedFilter));
  }
}

export class AgentRouterReviewStore {
  constructor({ now = nowIso } = {}) {
    this.now = now;
    this.skips = new Map();
  }

  requestSkip({ chatSessionId, turnId, itemId, reason, actor = 'user' } = {}) {
    const normalized = normalizeRouterReviewRef({ chatSessionId, turnId, itemId });
    if (!normalized) return undefined;
    const record = {
      ...normalized,
      reason: normalizeOptionalString(reason) || 'player_skipped_router_item',
      actor: normalizeOptionalString(actor) || 'user',
      createdAt: this.now()
    };
    this.skips.set(routerReviewKey(record), record);
    return record;
  }

  isSkipped({ chatSessionId, turnId, itemId } = {}) {
    const normalized = normalizeRouterReviewRef({ chatSessionId, turnId, itemId });
    return normalized ? this.skips.has(routerReviewKey(normalized)) : false;
  }

  getSkip({ chatSessionId, turnId, itemId } = {}) {
    const normalized = normalizeRouterReviewRef({ chatSessionId, turnId, itemId });
    return normalized ? this.skips.get(routerReviewKey(normalized)) : undefined;
  }

  clearTurn({ chatSessionId, turnId } = {}) {
    const chat = normalizeOptionalString(chatSessionId);
    const turn = normalizeOptionalString(turnId);
    if (!chat || !turn) return 0;
    let count = 0;
    for (const [key, record] of this.skips.entries()) {
      if (record.chatSessionId === chat && record.turnId === turn) {
        this.skips.delete(key);
        count += 1;
      }
    }
    return count;
  }
}

export const agentRouterReviewStore = new AgentRouterReviewStore();

export function normalizeProgressFilter(filter = {}) {
  return {
    chatSessionId: normalizeOptionalString(filter.chatSessionId || filter.chatId || filter.sessionId),
    turnId: normalizeOptionalString(filter.turnId),
    afterSequence: Number.isFinite(Number(filter.afterSequence)) ? Number(filter.afterSequence) : undefined
  };
}

function matchesProgressFilter(event = {}, filter = {}) {
  if (filter.chatSessionId && event.chatSessionId !== filter.chatSessionId) return false;
  if (filter.turnId && event.turnId !== filter.turnId && event.rootTurnId !== filter.turnId) return false;
  if (filter.afterSequence !== undefined && event.sequence <= filter.afterSequence) return false;
  return true;
}

function normalizeOptionalString(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizeRouterReviewRef({ chatSessionId, turnId, itemId } = {}) {
  const chat = normalizeOptionalString(chatSessionId);
  const turn = normalizeOptionalString(turnId);
  const item = normalizeOptionalString(itemId);
  if (!chat || !turn || !item) return undefined;
  return {
    chatSessionId: chat,
    turnId: turn,
    itemId: item
  };
}

function routerReviewKey({ chatSessionId, turnId, itemId }) {
  return `${chatSessionId}\n${turnId}\n${itemId}`;
}
