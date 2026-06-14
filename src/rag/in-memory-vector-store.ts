// @ts-nocheck
import { cosineSimilarity } from './hash-embedding-provider.js';

export class InMemoryVectorStore {
  constructor() {
    this.collections = new Map();
  }

  async upsert({ collection = 'default', id, text, vector, metadata = {} }) {
    if (!id) throw new TypeError('Vector document id is required');
    if (!Array.isArray(vector)) throw new TypeError('Vector document vector must be an array');

    const docs = this.getCollection(collection);
    docs.set(id, {
      collection,
      id,
      text: String(text || ''),
      vector,
      metadata
    });

    return docs.get(id);
  }

  async search({ collection = 'default', queryVector, limit = 4, minScore = -1, filter }) {
    if (!Array.isArray(queryVector)) throw new TypeError('queryVector must be an array');

    const docs = this.getCollection(collection);
    return [...docs.values()]
      .filter((doc) => matchesMetadataFilter(doc.metadata, filter))
      .map((doc) => ({
        ...doc,
        score: cosineSimilarity(queryVector, doc.vector)
      }))
      .filter((doc) => doc.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async deleteCollection(collection = 'default') {
    this.collections.delete(collection);
  }

  async deleteDocument({ collection = 'default', id }) {
    return this.getCollection(collection).delete(id);
  }

  async deleteBySource({ collection = 'default', sourceId }) {
    const docs = this.getCollection(collection);
    let deleted = 0;
    for (const [id, doc] of docs.entries()) {
      if (doc.metadata?.sourceId === sourceId) {
        docs.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  listCollections() {
    return [...this.collections.entries()].map(([collection, docs]) => ({
      collection,
      count: docs.size,
      updatedAt: undefined
    })).sort((a, b) => a.collection.localeCompare(b.collection));
  }

  listDocuments({ collection = 'default', filter, limit = 500, offset = 0 } = {}) {
    const safeLimit = clampLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const documents = [...this.getCollection(collection).values()]
      .filter((doc) => matchesMetadataFilter(doc.metadata, filter))
      .slice(safeOffset, safeOffset + safeLimit);
    return {
      collection,
      documents,
      limit: safeLimit,
      offset: safeOffset
    };
  }

  getCollection(collection) {
    if (!this.collections.has(collection)) {
      this.collections.set(collection, new Map());
    }
    return this.collections.get(collection);
  }
}

function matchesMetadataFilter(metadata = {}, filter) {
  if (!filter || typeof filter !== 'object') return true;

  return Object.entries(filter).every(([key, expected]) => {
    const actual = metadata[key];
    if (Array.isArray(expected)) {
      return expected.includes(actual);
    }
    return actual === expected;
  });
}

function clampLimit(limit) {
  const value = Number(limit ?? 500);
  if (!Number.isInteger(value) || value < 1) return 500;
  return Math.min(value, 100000);
}

function normalizeOffset(offset) {
  const value = Number(offset || 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}
