// @ts-nocheck
import { createId, nowIso } from '../utils/id.js';

export class InMemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  async create(session) {
    const now = nowIso();
    const stored = {
      id: session.id || createId('sess'),
      createdAt: session.createdAt || now,
      updatedAt: now,
      ...session
    };
    this.sessions.set(stored.id, stored);
    return stored;
  }

  async get(id) {
    return this.sessions.get(id);
  }

  async list() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async update(id, updater) {
    const current = await this.get(id);
    if (!current) return undefined;

    const next = typeof updater === 'function'
      ? updater(current)
      : { ...current, ...updater };

    const stored = {
      ...next,
      id,
      updatedAt: nowIso()
    };
    this.sessions.set(id, stored);
    return stored;
  }
}

