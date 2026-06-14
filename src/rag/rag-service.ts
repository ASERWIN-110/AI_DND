// @ts-nocheck
import { createId } from '../utils/id.js';
import { chunkDocuments, chunkText } from './chunking.js';
import { cosineSimilarity, HashEmbeddingProvider, tokenize } from './hash-embedding-provider.js';
import { InMemoryVectorStore } from './in-memory-vector-store.js';
import { compactRagHit, isExpiredRagDocument, rankRagDocuments } from './retrieval-ranking.js';

export class RagService {
  constructor({
    embeddingProvider = new HashEmbeddingProvider(),
    vectorStore = new InMemoryVectorStore(),
    defaultCollection = 'campaign-default',
    chunkSize = 1200,
    overlap = 150,
    retrieval = {},
    now = () => new Date().toISOString()
  } = {}) {
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore;
    this.defaultCollection = defaultCollection;
    this.chunkSize = chunkSize;
    this.overlap = overlap;
    this.retrieval = retrieval;
    this.now = now;
  }

  async ingestText({
    collection = this.defaultCollection,
    sourceId,
    text,
    metadata = {},
    chunking,
    format,
    fieldChunking,
    chunkSize = this.chunkSize,
    overlap = this.overlap
  }) {
    const source = sourceId || createId('source');
    const chunks = chunkDocuments(text, {
      chunkSize,
      overlap,
      strategy: chunking,
      format,
      metadata,
      fieldChunking
    });
    const embedding = this.describeEmbeddingProvider();

    const docs = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const id = `${source}#${chunk.idSuffix || index + 1}`;
      const vector = await this.embeddingProvider.embed(chunk.text);
      docs.push(await this.vectorStore.upsert({
        collection,
        id,
        text: chunk.text,
        vector,
        metadata: {
          ...metadata,
          ...(chunk.metadata || {}),
          collection,
          sourceId: source,
          chunkIndex: index,
          embeddingProvider: embedding.provider,
          embeddingModel: embedding.model,
          embeddingDimensions: embedding.dimensions || vector.length,
          embeddingVersion: embedding.version,
          embeddedAt: this.now()
        }
      }));
    }

    return docs;
  }

  async retrieve({
    collection = this.defaultCollection,
    query,
    limit = 4,
    minScore = 0.15,
    filter,
    mode,
    searchLimit,
    vectorWeight,
    keywordWeight,
    entityWeight,
    recencyWeight,
    importanceWeight,
    lifecycleWeight,
    diversity,
    mmrLambda,
    includeExpired = false
  }) {
    const queryVector = await this.embeddingProvider.embed(query);
    const resolvedMode = String(mode || this.retrieval.mode || 'hybrid').toLowerCase();
    const safeSearchLimit = normalizePositiveInteger(searchLimit, 100000);
    if (resolvedMode !== 'vector' && typeof this.vectorStore.listDocuments === 'function') {
      const listed = this.vectorStore.listDocuments({
        collection,
        filter,
        limit: Math.max(safeSearchLimit, limit),
        offset: 0
      });
      const documents = listed.documents
        .map((doc) => ({ ...doc, collection: doc.collection || collection }))
        .filter((doc) => includeExpired || !isExpiredRagDocument(doc, this.now));
      return rankRagDocuments(documents, {
        query,
        queryVector,
        limit,
        minScore,
        mode: resolvedMode,
        vectorWeight: vectorWeight ?? this.retrieval.vectorWeight,
        keywordWeight: keywordWeight ?? this.retrieval.keywordWeight,
        entityWeight: entityWeight ?? this.retrieval.entityWeight,
        recencyWeight: recencyWeight ?? this.retrieval.recencyWeight,
        importanceWeight: importanceWeight ?? this.retrieval.importanceWeight,
        lifecycleWeight: lifecycleWeight ?? this.retrieval.lifecycleWeight,
        diversity: diversity ?? this.retrieval.diversity ?? true,
        mmrLambda: mmrLambda ?? this.retrieval.mmrLambda,
        now: this.now
      });
    }

    const hits = await this.vectorStore.search({
      collection,
      queryVector,
      limit,
      minScore,
      filter
    });
    return hits
      .map((hit) => {
        const withCollection = { ...hit, collection: hit.collection || collection };
        return { ...withCollection, compact: compactRagHit(withCollection) };
      })
      .filter((hit) => includeExpired || !isExpiredRagDocument(hit, this.now));
  }

  async deleteSource({ collection = this.defaultCollection, sourceId }) {
    return this.vectorStore.deleteBySource({ collection, sourceId });
  }

  async deleteCollection(collection = this.defaultCollection) {
    if (typeof this.vectorStore.deleteCollection !== 'function') {
      return undefined;
    }
    return this.vectorStore.deleteCollection(collection);
  }

  async deleteDocument({ collection = this.defaultCollection, id }) {
    if (typeof this.vectorStore.deleteDocument !== 'function') {
      return undefined;
    }
    return this.vectorStore.deleteDocument({ collection, id });
  }

  async upsertDocument({ collection = this.defaultCollection, id, text, vector, metadata = {} }) {
    const resolvedVector = Array.isArray(vector) ? vector : await this.embeddingProvider.embed(text);
    const embedding = this.describeEmbeddingProvider();
    return this.vectorStore.upsert({
      collection,
      id,
      text,
      vector: resolvedVector,
      metadata: {
        ...metadata,
        collection,
        embeddingProvider: metadata.embeddingProvider || embedding.provider,
        embeddingModel: metadata.embeddingModel || embedding.model,
        embeddingDimensions: metadata.embeddingDimensions || resolvedVector.length || embedding.dimensions,
        embeddingVersion: metadata.embeddingVersion || embedding.version
      }
    });
  }

  async reindexCollection({
    collection = this.defaultCollection,
    filter,
    limit = 100000,
    offset = 0
  } = {}) {
    const result = this.listDocuments({ collection, filter, limit, offset });
    const embedding = this.describeEmbeddingProvider();
    const reindexed = [];
    for (const document of result.documents) {
      const vector = await this.embeddingProvider.embed(document.text);
      reindexed.push(await this.upsertDocument({
        collection,
        id: document.id,
        text: document.text,
        vector,
        metadata: {
          ...(document.metadata || {}),
          embeddingProvider: embedding.provider,
          embeddingModel: embedding.model,
          embeddingDimensions: embedding.dimensions || vector.length,
          embeddingVersion: embedding.version,
          reindexedAt: this.now()
        }
      }));
    }
    return {
      collection,
      reindexedDocuments: reindexed.length,
      embedding
    };
  }

  async pruneExpired({ collection = this.defaultCollection, now = this.now } = {}) {
    const result = this.listDocuments({ collection, limit: 100000 });
    const deleted = [];
    for (const document of result.documents) {
      if (!isExpiredRagDocument(document, now)) continue;
      const ok = await this.deleteDocument({ collection, id: document.id });
      if (ok !== false) deleted.push({ collection, id: document.id, sourceId: document.metadata?.sourceId });
    }
    return {
      collection,
      deleted
    };
  }

  async maintainCollection({
    collection = this.defaultCollection,
    filter,
    maxDocuments = 500,
    similarityThreshold = 0.92,
    maxGroupSize = 6,
    now = this.now
  } = {}) {
    const pruned = await this.pruneExpired({ collection, now });
    const documents = this.listDocuments({ collection, filter, limit: 100000 }).documents
      .filter((doc) => !isExpiredRagDocument(doc, now));
    const consolidated = await this.consolidateSimilarDocuments({
      collection,
      documents,
      similarityThreshold,
      maxGroupSize,
      now
    });
    const afterConsolidation = this.listDocuments({ collection, filter, limit: 100000 }).documents
      .filter((doc) => !isExpiredRagDocument(doc, now));
    const evicted = await this.evictLowPriorityDocuments({
      collection,
      documents: afterConsolidation,
      maxDocuments
    });
    return {
      collection,
      pruned,
      consolidated,
      evicted
    };
  }

  async consolidateSimilarDocuments({
    collection = this.defaultCollection,
    documents,
    similarityThreshold = 0.92,
    maxGroupSize = 6,
    now = this.now
  } = {}) {
    const candidates = (documents || this.listDocuments({ collection, limit: 100000 }).documents)
      .filter((doc) => doc.metadata?.sourceKind !== 'agent-memory-consolidated');
    const used = new Set();
    const groups = [];
    for (const doc of candidates) {
      if (used.has(doc.id)) continue;
      const group = [doc];
      used.add(doc.id);
      for (const other of candidates) {
        if (used.has(other.id)) continue;
        if (memoryGroupKey(doc) !== memoryGroupKey(other)) continue;
        if (ragDocumentSimilarity(doc, other) < similarityThreshold) continue;
        group.push(other);
        used.add(other.id);
        if (group.length >= maxGroupSize) break;
      }
      if (group.length > 1) groups.push(group);
    }

    const merged = [];
    for (const group of groups) {
      const base = group[0];
      const sourceIds = [...new Set(group.map((doc) => doc.metadata?.sourceId || doc.id))];
      const id = `${sourceIds[0]}__merged_${shortHash(sourceIds.join('|'))}`.slice(0, 180);
      const text = [
        'Merged runtime RAG memory:',
        ...group.map((doc) => `- ${String(doc.text || '').replace(/\s+/g, ' ').trim()}`).filter((line) => line.length > 2)
      ].join('\n');
      const vector = await this.embeddingProvider.embed(text);
      const record = await this.upsertDocument({
        collection,
        id,
        text,
        vector,
        metadata: {
          ...(base.metadata || {}),
          sourceId: id,
          sourceKind: 'agent-memory-consolidated',
          sourceIds,
          mergedDocumentIds: group.map((doc) => doc.id),
          consolidatedAt: typeof now === 'function' ? now() : now,
          importance: Math.max(...group.map((doc) => Number(doc.metadata?.importance || 0))),
          accessCount: group.reduce((sum, doc) => sum + Number(doc.metadata?.accessCount || 0), 0)
        }
      });
      for (const doc of group) {
        await this.deleteDocument({ collection, id: doc.id });
      }
      merged.push({
        id,
        sourceIds,
        mergedDocumentIds: group.map((doc) => doc.id),
        document: record
      });
    }
    return { merged };
  }

  async evictLowPriorityDocuments({
    collection = this.defaultCollection,
    documents,
    maxDocuments = 500
  } = {}) {
    const safeMax = normalizePositiveInteger(maxDocuments, 500);
    const docs = documents || this.listDocuments({ collection, limit: 100000 }).documents;
    if (docs.length <= safeMax) return { deleted: [] };
    const deleted = [];
    const victims = [...docs].sort((a, b) => evictionPriority(a) - evictionPriority(b)).slice(0, docs.length - safeMax);
    for (const doc of victims) {
      const ok = await this.deleteDocument({ collection, id: doc.id });
      if (ok !== false) deleted.push({ collection, id: doc.id, sourceId: doc.metadata?.sourceId });
    }
    return { deleted };
  }

  async touchDocuments(documents = [], { accessedAt = this.now() } = {}) {
    const touched = [];
    for (const document of documents) {
      if (!document?.id) continue;
      const collection = document.collection || document.metadata?.collection || this.defaultCollection;
      const metadata = document.metadata || {};
      touched.push(await this.upsertDocument({
        collection,
        id: document.id,
        text: document.text,
        vector: document.vector,
        metadata: {
          ...metadata,
          lastAccessedAt: accessedAt,
          accessCount: Number(metadata.accessCount || 0) + 1
        }
      }));
    }
    return {
      touched: touched.length
    };
  }

  async replaceCollection({ collection = this.defaultCollection, documents = [] } = {}) {
    await this.deleteCollection(collection);
    const restored = [];
    for (const document of documents) {
      restored.push(await this.upsertDocument({
        collection,
        id: document.id,
        text: document.text,
        vector: document.vector,
        metadata: document.metadata || {}
      }));
    }
    return {
      collection,
      restoredDocuments: restored.length
    };
  }

  exportCollections({ collections, limit = 100000 } = {}) {
    const selected = Array.isArray(collections) && collections.length > 0
      ? collections
      : this.listCollections().map((collection) => collection.collection);
    return selected.map((collection) => this.listDocuments({ collection, limit }));
  }

  async restoreCollections(collectionSnapshots = []) {
    const restored = [];
    for (const snapshot of collectionSnapshots) {
      restored.push(await this.replaceCollection({
        collection: snapshot.collection,
        documents: snapshot.documents || []
      }));
    }
    return restored;
  }

  listCollections() {
    return typeof this.vectorStore.listCollections === 'function'
      ? this.vectorStore.listCollections()
      : [];
  }

  listDocuments({ collection = this.defaultCollection, filter, limit, offset } = {}) {
    if (typeof this.vectorStore.listDocuments !== 'function') {
      return {
        collection,
        documents: [],
        limit,
        offset
      };
    }
    return this.vectorStore.listDocuments({ collection, filter, limit, offset });
  }

  describeEmbeddingProvider() {
    if (typeof this.embeddingProvider.describe === 'function') {
      return this.embeddingProvider.describe();
    }
    return {
      provider: this.embeddingProvider.provider || this.embeddingProvider.constructor?.name || 'unknown',
      model: this.embeddingProvider.model || 'unknown',
      dimensions: this.embeddingProvider.dimensions,
      version: this.embeddingProvider.version || 'unknown'
    };
  }
}

export { chunkText };

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function memoryGroupKey(doc = {}) {
  const metadata = doc.metadata || {};
  return [
    metadata.sceneId || '',
    normalizeArray(metadata.actorIds).sort().join(','),
    metadata.memoryType || '',
    metadata.domain || ''
  ].join('|');
}

function ragDocumentSimilarity(a = {}, b = {}) {
  if (Array.isArray(a.vector) && Array.isArray(b.vector)) {
    return Math.max(0, cosineSimilarity(a.vector, b.vector));
  }
  const aTokens = new Set(tokenize(a.text || ''));
  const bTokens = new Set(tokenize(b.text || ''));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.min(aTokens.size, bTokens.size);
}

function evictionPriority(doc = {}) {
  const metadata = doc.metadata || {};
  const importance = Number(metadata.importance || 0);
  const accessCount = Number(metadata.accessCount || 0);
  const accessed = Date.parse(metadata.lastAccessedAt || metadata.rememberedAt || metadata.importedAt || doc.updatedAt || doc.createdAt || '');
  const recency = Number.isFinite(accessed) ? accessed / 86400000 : 0;
  return (importance * 1000) + (accessCount * 10) + recency;
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((entry) => normalizeArray(entry));
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
