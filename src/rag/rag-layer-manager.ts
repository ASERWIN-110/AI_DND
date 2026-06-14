// @ts-nocheck
import YAML from 'yaml';
import { parseStructuredDocument } from '../data/structured-document-importer.js';
import {
  lifecycleFromData,
  recordVisibleInLifecycle,
  resolveResourceLifecycle,
  resolveLifecycleQuery,
  shouldApplyLifecycleFilter
} from '../lifecycle/resource-lifecycle.js';
import { RagService } from './rag-service.js';

const DEFAULT_PERMANENT_COLLECTION = 'permanent-default';
const DEFAULT_RUNTIME_COLLECTION = 'runtime-default';

export class RagLayerManager {
  constructor({
    permanentRagService = new RagService({ defaultCollection: DEFAULT_PERMANENT_COLLECTION }),
    runtimeRagService = new RagService({ defaultCollection: DEFAULT_RUNTIME_COLLECTION }),
    dataManager,
    appDatabase,
    now = () => new Date().toISOString()
  } = {}) {
    this.permanentRagService = permanentRagService;
    this.runtimeRagService = runtimeRagService;
    this.dataManager = dataManager;
    this.appDatabase = appDatabase;
    this.now = now;
  }

  async searchPermanent(input = {}) {
    const {
    collection = DEFAULT_PERMANENT_COLLECTION,
    query,
    limit = 6,
    minScore = 0.1,
    filter
    } = input;
    const rawHits = await this.permanentRagService.retrieve({
      collection,
      query: requiredText(query, 'query'),
      limit: limit * 4,
      minScore,
      filter,
      ...retrievalOptions(input)
    });
    const hits = this.filterRagHits(rawHits, input).slice(0, limit);
    return {
      layer: 'permanent',
      collection,
      hits
    };
  }

  async importPermanentFile(input = {}) {
    const {
    collection = DEFAULT_PERMANENT_COLLECTION,
    sourceId,
    text,
    format = 'text',
    filename = '',
    mimeType = '',
    metadata = {}
    } = input;
    const sourceText = normalizeImportText({ text, format });
    const source = sourceId || sourceIdFromParts('file', filename || 'document', this.now());
    const lifecycle = resolveResourceLifecycle({
      ...input,
      ...metadata,
      lifecycleCanonicalId: source
    }, {
      appDatabase: this.appDatabase,
      defaultLevel: 'L1',
      now: this.now
    });
    const docs = await this.permanentRagService.ingestText({
      collection,
      sourceId: source,
      text: sourceText,
      format: normalizedIngestFormat(format),
      chunking: input.chunking,
      fieldChunking: input.fieldChunking,
      chunkSize: input.chunkSize,
      overlap: input.overlap,
      metadata: {
        ...metadata,
        ...lifecycle,
        layer: 'permanent',
        sourceKind: 'file',
        filename,
        mimeType,
        importedAt: this.now()
      }
    });
    return {
      layer: 'permanent',
      collection,
      sourceId: source,
      importedChunks: docs.length,
      documents: docs
    };
  }

  async importDatabaseSnapshot(input = {}) {
    const {
    collection = DEFAULT_PERMANENT_COLLECTION,
    sourceId,
    database = 'global-data',
    sourceCollection,
    chatSessionId,
    includeMessages = true,
    metadata = {}
    } = input;
    const snapshot = this.buildDatabaseSnapshot({
      database,
      sourceCollection,
      chatSessionId,
      includeMessages
    });
    const source = sourceId || sourceIdFromParts('db', `${database}-${sourceCollection || chatSessionId || 'all'}`, this.now());
    const lifecycle = resolveResourceLifecycle({
      ...input,
      ...metadata,
      lifecycleCanonicalId: source
    }, {
      appDatabase: this.appDatabase,
      defaultLevel: 'L1',
      now: this.now
    });
    const docs = await this.permanentRagService.ingestText({
      collection,
      sourceId: source,
      text: snapshot.text,
      format: 'json',
      chunking: input.chunking || 'database',
      fieldChunking: input.fieldChunking,
      metadata: {
        ...metadata,
        ...lifecycle,
        layer: 'permanent',
        sourceKind: 'database',
        database,
        sourceCollection: sourceCollection || '',
        chatSessionId: chatSessionId || '',
        importedAt: this.now()
      }
    });
    return {
      layer: 'permanent',
      collection,
      sourceId: source,
      source: snapshot.source,
      importedChunks: docs.length,
      documents: docs
    };
  }

  exportPermanentCollection({
    collection = DEFAULT_PERMANENT_COLLECTION,
    format = 'json',
    filter,
    limit = 500,
    offset = 0
  } = {}) {
    const result = this.permanentRagService.listDocuments({
      collection,
      filter,
      limit,
      offset
    });
    const payload = {
      layer: 'permanent',
      collection: result.collection,
      exportedAt: this.now(),
      documents: result.documents.map(exportDocument)
    };
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        text: `${JSON.stringify(payload, null, 2)}\n`,
        payload
      };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(payload),
        payload
      };
    }
    if (normalizedFormat === 'text' || normalizedFormat === 'txt') {
      return {
        format: 'text',
        text: result.documents.map((doc) => [
          `# ${doc.id}`,
          `metadata: ${JSON.stringify(doc.metadata || {})}`,
          doc.text
        ].join('\n')).join('\n\n'),
        payload
      };
    }
    throw validationError('export format must be json, yaml, or text');
  }

  listPermanentCollections() {
    return {
      layer: 'permanent',
      collections: this.permanentRagService.listCollections()
    };
  }

  async rememberRuntime(input = {}) {
    const {
    collection = DEFAULT_RUNTIME_COLLECTION,
    sourceId,
    text,
    ttlMs,
    ttlSeconds,
    expiresAt,
    importance,
    sceneId,
    actorIds,
    memoryType,
    domain,
    metadata = {}
    } = input;
    const source = sourceId || sourceIdFromParts('runtime', 'memory', this.now());
    const lifecycle = resolveResourceLifecycle({
      ...input,
      ...metadata,
      lifecycleCanonicalId: source
    }, {
      appDatabase: this.appDatabase,
      defaultLevel: 'L1',
      now: this.now
    });
    const docs = await this.runtimeRagService.ingestText({
      collection,
      sourceId: source,
      text: requiredText(text, 'text'),
      format: input.format,
      chunking: input.chunking,
      fieldChunking: input.fieldChunking,
      chunkSize: input.chunkSize,
      overlap: input.overlap,
      metadata: {
        ...metadata,
        ...lifecycle,
        layer: 'runtime',
        sceneId: sceneId || metadata.sceneId,
        actorIds: normalizeArray(actorIds ?? metadata.actorIds),
        memoryType: memoryType || metadata.memoryType,
        domain: domain || metadata.domain,
        importance: normalizeOptionalNumber(importance ?? metadata.importance),
        expiresAt: expiresAt || resolveExpiresAt({ ttlMs, ttlSeconds, now: this.now }) || metadata.expiresAt,
        sourceKind: metadata.sourceKind || 'agent-memory',
        rememberedAt: this.now()
      }
    });
    return {
      layer: 'runtime',
      collection,
      sourceId: source,
      importedChunks: docs.length,
      documents: docs
    };
  }

  async searchRuntime(input = {}) {
    const {
    collection = DEFAULT_RUNTIME_COLLECTION,
    query,
    limit = 6,
    minScore = 0.1,
    filter
    } = input;
    const rawHits = await this.runtimeRagService.retrieve({
      collection,
      query: requiredText(query, 'query'),
      limit: limit * 4,
      minScore,
      filter,
      ...retrievalOptions(input)
    });
    const hits = this.filterRagHits(rawHits, input).slice(0, limit);
    await this.runtimeRagService.touchDocuments(hits);
    return {
      layer: 'runtime',
      collection,
      hits
    };
  }

  async reindexPermanent(input = {}) {
    return {
      layer: 'permanent',
      ...(await this.permanentRagService.reindexCollection({
        collection: input.collection || DEFAULT_PERMANENT_COLLECTION,
        filter: input.filter,
        limit: input.limit,
        offset: input.offset
      }))
    };
  }

  async pruneRuntime(input = {}) {
    return {
      layer: 'runtime',
      ...(await this.runtimeRagService.pruneExpired({
        collection: input.collection || DEFAULT_RUNTIME_COLLECTION,
        now: this.now
      }))
    };
  }

  async maintainRuntime(input = {}) {
    return {
      layer: 'runtime',
      ...(await this.runtimeRagService.maintainCollection({
        collection: input.collection || DEFAULT_RUNTIME_COLLECTION,
        filter: input.filter,
        maxDocuments: input.maxDocuments,
        similarityThreshold: input.similarityThreshold,
        maxGroupSize: input.maxGroupSize,
        now: this.now
      }))
    };
  }

  filterRagHits(hits = [], input = {}) {
    if (!shouldApplyLifecycleFilter(input, { appDatabase: this.appDatabase })) return hits;
    const query = resolveLifecycleQuery(input, { appDatabase: this.appDatabase });
    const visible = hits.filter((hit) => recordVisibleInLifecycle(hit.metadata || {}, query));
    const byCanonical = new Map();
    for (const hit of visible) {
      const lifecycle = lifecycleFromData(hit.metadata || {});
      const canonical = lifecycle.lifecycleCanonicalId || hit.metadata?.sourceId || hit.id;
      const current = byCanonical.get(canonical);
      if (!current || ragHitPriority(hit) > ragHitPriority(current)) {
        byCanonical.set(canonical, hit);
      }
    }
    return [...byCanonical.values()].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  buildDatabaseSnapshot({
    database = 'global-data',
    sourceCollection,
    chatSessionId,
    includeMessages = true
  } = {}) {
    const normalizedDatabase = String(database || 'global-data');
    if (normalizedDatabase === 'global-data') {
      if (!this.dataManager) throw validationError('global-data import requires dataManager');
      const collections = sourceCollection
        ? [sourceCollection]
        : this.dataManager.listCollections();
      const payload = collections.map((collection) => ({
        collection,
        records: this.dataManager.queryRecords(collection, { limit: 500 }).records
      }));
      return {
        source: { database: normalizedDatabase, collections },
        text: JSON.stringify({ database: normalizedDatabase, collections: payload }, null, 2)
      };
    }

    if (normalizedDatabase === 'chat-data') {
      if (!this.appDatabase) throw validationError('chat-data import requires appDatabase');
      const sessionId = requiredText(chatSessionId, 'chatSessionId');
      const exported = this.appDatabase.exportChatDataDatabase(sessionId);
      const collections = sourceCollection
        ? exported.collections.filter((item) => item.collection === sourceCollection)
        : exported.collections;
      return {
        source: { database: normalizedDatabase, chatSessionId: sessionId, collections: collections.map((item) => item.collection) },
        text: JSON.stringify({ database: normalizedDatabase, chatSessionId: sessionId, collections }, null, 2)
      };
    }

    if (normalizedDatabase === 'app-chat') {
      if (!this.appDatabase) throw validationError('app-chat import requires appDatabase');
      const sessionId = requiredText(chatSessionId, 'chatSessionId');
      const exported = this.appDatabase.exportChatSession(sessionId);
      const payload = includeMessages ? exported : {
        ...exported,
        messages: []
      };
      return {
        source: { database: normalizedDatabase, chatSessionId: sessionId, includeMessages },
        text: JSON.stringify(payload, null, 2)
      };
    }

    throw validationError(`Unsupported database import source: ${database}`);
  }
}

function normalizeImportText({ text, format = 'text' } = {}) {
  const source = requiredText(text, 'text');
  const normalizedFormat = String(format || 'text').toLowerCase();
  if (['text', 'txt', 'markdown', 'md'].includes(normalizedFormat)) return source;
  const parsed = parseStructuredDocument({
    text: source,
    format: normalizedFormat === 'auto' ? 'auto' : normalizedFormat
  });
  return JSON.stringify(parsed.data, null, 2);
}

function normalizedIngestFormat(format) {
  const normalizedFormat = String(format || 'text').toLowerCase();
  return ['auto', 'json', 'yaml', 'yml', 'xml'].includes(normalizedFormat) ? 'json' : normalizedFormat;
}

function exportDocument(doc) {
  return {
    id: doc.id,
    text: doc.text,
    metadata: doc.metadata || {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function sourceIdFromParts(prefix, name, timestamp) {
  return `${prefix}_${safeSegment(name)}_${safeSegment(timestamp)}`.slice(0, 160);
}

function ragHitPriority(hit = {}) {
  const lifecycle = lifecycleFromData(hit.metadata || {});
  const scopePriority = lifecycle.lifecycleScope === 'chat'
    ? 3
    : lifecycle.lifecycleScope === 'character'
      ? 2
      : lifecycle.lifecycleScope === 'global'
        ? 1
        : 0;
  return (scopePriority * 1000) + (hit.score || 0);
}

function retrievalOptions(input = {}) {
  return {
    mode: input.mode,
    searchLimit: input.searchLimit,
    vectorWeight: input.vectorWeight,
    keywordWeight: input.keywordWeight,
    entityWeight: input.entityWeight,
    recencyWeight: input.recencyWeight,
    importanceWeight: input.importanceWeight,
    lifecycleWeight: input.lifecycleWeight,
    diversity: input.diversity,
    mmrLambda: input.mmrLambda,
    includeExpired: input.includeExpired
  };
}

function resolveExpiresAt({ ttlMs, ttlSeconds, now }) {
  const millis = Number.isFinite(Number(ttlMs))
    ? Number(ttlMs)
    : Number.isFinite(Number(ttlSeconds))
      ? Number(ttlSeconds) * 1000
      : undefined;
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  const start = Date.parse(now());
  if (!Number.isFinite(start)) return undefined;
  return new Date(start + millis).toISOString();
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((entry) => normalizeArray(entry));
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'source';
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw validationError(`${field} is required`);
  return text;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'RagLayerValidationError';
  error.statusCode = 400;
  return error;
}
