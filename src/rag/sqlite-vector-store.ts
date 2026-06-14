// @ts-nocheck
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { nowIso } from '../utils/id.js';
import { getDatabaseSync } from '../utils/node-sqlite.js';
import { cosineSimilarity } from './hash-embedding-provider.js';

let DatabaseSync;

export class SQLiteVectorStore {
  constructor({
    databasePath = 'data/permanent-rag.sqlite',
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    this.cwd = cwd;
    this.databasePath = databasePath === ':memory:' ? databasePath : resolve(cwd, databasePath);
    this.now = now;

    if (this.databasePath !== ':memory:' && !existsSync(dirname(this.databasePath))) {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }

    DatabaseSync ||= getDatabaseSync();
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.migrate();
  }

  close() {
    this.db.close();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );

      CREATE INDEX IF NOT EXISTS idx_rag_documents_collection_updated
      ON rag_documents (collection, updated_at);

      CREATE INDEX IF NOT EXISTS idx_rag_documents_collection_id
      ON rag_documents (collection, id);
    `);
  }

  async upsert({ collection = 'default', id, text, vector, metadata = {} }) {
    if (!id) throw new TypeError('Vector document id is required');
    if (!Array.isArray(vector)) throw new TypeError('Vector document vector must be an array');

    const timestamp = this.now();
    const existing = this.db.prepare(`
      SELECT created_at
      FROM rag_documents
      WHERE collection = ? AND id = ?
    `).get(collection, id);
    const createdAt = existing?.created_at || timestamp;

    this.db.prepare(`
      INSERT INTO rag_documents (
        collection, id, text, vector_json, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection, id) DO UPDATE SET
        text = excluded.text,
        vector_json = excluded.vector_json,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      String(collection),
      String(id),
      String(text || ''),
      JSON.stringify(vector),
      JSON.stringify(metadata || {}),
      createdAt,
      timestamp
    );

    return this.getDocument({ collection, id });
  }

  async search({ collection = 'default', queryVector, limit = 4, minScore = -1, filter }) {
    if (!Array.isArray(queryVector)) throw new TypeError('queryVector must be an array');

    const safeLimit = clampLimit(limit);
    const rows = this.db.prepare(`
      SELECT *
      FROM rag_documents
      WHERE collection = ?
    `).all(String(collection));

    return rows
      .map(rowToDocument)
      .filter((doc) => matchesMetadataFilter(doc.metadata, filter))
      .map((doc) => ({
        ...doc,
        score: cosineSimilarity(queryVector, doc.vector)
      }))
      .filter((doc) => doc.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);
  }

  async deleteCollection(collection = 'default') {
    this.db.prepare('DELETE FROM rag_documents WHERE collection = ?').run(String(collection));
  }

  async deleteDocument({ collection = 'default', id }) {
    const result = this.db.prepare('DELETE FROM rag_documents WHERE collection = ? AND id = ?')
      .run(String(collection), String(id));
    return result.changes > 0;
  }

  async deleteBySource({ collection = 'default', sourceId }) {
    const docs = this.listDocuments({ collection, limit: 100000 });
    let deleted = 0;
    const statement = this.db.prepare('DELETE FROM rag_documents WHERE collection = ? AND id = ?');
    for (const doc of docs.documents) {
      if (doc.metadata?.sourceId === sourceId) {
        statement.run(String(collection), doc.id);
        deleted += 1;
      }
    }
    return deleted;
  }

  getDocument({ collection = 'default', id }) {
    const row = this.db.prepare(`
      SELECT *
      FROM rag_documents
      WHERE collection = ? AND id = ?
    `).get(String(collection), String(id));
    if (!row) return undefined;
    return rowToDocument(row);
  }

  listCollections() {
    return this.db.prepare(`
      SELECT collection, COUNT(*) AS count, MAX(updated_at) AS updated_at
      FROM rag_documents
      GROUP BY collection
      ORDER BY collection ASC
    `).all().map((row) => ({
      collection: row.collection,
      count: row.count,
      updatedAt: row.updated_at
    }));
  }

  listDocuments({ collection = 'default', filter, limit = 500, offset = 0 } = {}) {
    const safeLimit = clampLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const rows = this.db.prepare(`
      SELECT *
      FROM rag_documents
      WHERE collection = ?
      ORDER BY updated_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).all(String(collection), safeLimit, safeOffset);
    const documents = rows
      .map(rowToDocument)
      .filter((doc) => matchesMetadataFilter(doc.metadata, filter));
    return {
      collection: String(collection),
      documents,
      limit: safeLimit,
      offset: safeOffset
    };
  }
}

function rowToDocument(row) {
  return {
    collection: row.collection,
    id: row.id,
    text: row.text,
    vector: safeJsonParse(row.vector_json, []),
    metadata: safeJsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
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

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function clampLimit(limit) {
  const number = Number(limit ?? 500);
  if (!Number.isInteger(number) || number < 1) return 500;
  return Math.min(number, 100000);
}

function normalizeOffset(offset) {
  const number = Number(offset || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}
