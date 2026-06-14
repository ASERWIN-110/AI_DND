// @ts-nocheck
import { LRUCache } from 'lru-cache';

export class HashEmbeddingProvider {
  constructor({ dimensions = 256, cacheSize = 2000, version } = {}) {
    this.dimensions = dimensions;
    this.cache = new LRUCache({ max: cacheSize });
    this.provider = 'hash';
    this.model = `hash-bow-${dimensions}`;
    this.version = version || `${this.provider}:${this.model}:v1`;
  }

  describe() {
    return {
      provider: this.provider,
      model: this.model,
      dimensions: this.dimensions,
      version: this.version
    };
  }

  async embed(text) {
    const cacheKey = `${this.dimensions}:${text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const vector = new Array(this.dimensions).fill(0);
    const tokens = tokenize(text);

    for (const token of tokens) {
      const hash = fnv1a(token);
      const index = hash % this.dimensions;
      const sign = hash & 1 ? 1 : -1;
      vector[index] += sign;
    }

    const embedded = normalize(vector);
    this.cache.set(cacheKey, embedded);
    return embedded;
  }
}

export function tokenize(text) {
  const normalized = String(text || '').toLowerCase();
  const tokens = [];

  for (const match of normalized.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const token = match[0];
    if (/^\p{Script=Han}+$/u.test(token)) {
      tokens.push(...Array.from(token));
      for (let index = 0; index < token.length - 1; index += 1) {
        tokens.push(token.slice(index, index + 2));
      }
    } else {
      tokens.push(token);
    }
  }

  return tokens;
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
