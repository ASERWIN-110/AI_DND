// @ts-nocheck
import { RagLayerManager } from '../rag/rag-layer-manager.js';
import { evaluateRagRetrieval } from '../rag/rag-evaluator.js';
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

export const RAG_PERMANENT_PLUGIN = {
  id: 'system.rag_permanent',
  name: 'Permanent RAG Tools',
  version: '0.1.0',
  description: 'Read-mostly permanent RAG. Agent-facing surface is query-only; imports and exports require explicit user authorization.',
  enabled: true,
  permissions: ['rag-permanent:read', 'rag-permanent:write'],
  tools: [
    {
      name: 'search',
      title: 'Search Permanent RAG',
      description: 'Search immutable or user-curated permanent RAG collections. This is the only permanent RAG tool intended for agent use.',
      inputSchema: searchSchema('permanent-default'),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['rag', 'permanent', 'search']
    },
    {
      name: 'import_file',
      title: 'Import Permanent RAG File',
      description: 'User-only import of arbitrary text, markdown, JSON, YAML, or XML into permanent RAG.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'permanent-default' },
          sourceId: { type: 'string' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['text', 'txt', 'markdown', 'md', 'auto', 'json', 'yaml', 'yml', 'xml'], default: 'text' },
          chunking: chunkingSchema(),
          fieldChunking: { type: 'boolean', default: true },
          chunkSize: { type: 'integer', minimum: 80, maximum: 20000 },
          overlap: { type: 'integer', minimum: 0, maximum: 5000 },
          filename: { type: 'string' },
          mimeType: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          ...lifecycleSchemaProperties()
        },
        required: ['text'],
        additionalProperties: false
      },
      visibility: 'private',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        requiresUserAuthorization: true,
        scope: 'permanent-rag'
      },
      tags: ['rag', 'permanent', 'import']
    },
    {
      name: 'import_database_snapshot',
      title: 'Import Database Snapshot To Permanent RAG',
      description: 'User-only one-click import of global data, chat-data, or app chat archive information into permanent RAG.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'permanent-default' },
          sourceId: { type: 'string' },
          database: { type: 'string', enum: ['global-data', 'chat-data', 'app-chat'], default: 'global-data' },
          sourceCollection: { type: 'string' },
          chatSessionId: { type: 'string' },
          includeMessages: { type: 'boolean', default: true },
          chunking: chunkingSchema(),
          fieldChunking: { type: 'boolean', default: true },
          metadata: { type: 'object', additionalProperties: true },
          ...lifecycleSchemaProperties()
        },
        additionalProperties: false
      },
      visibility: 'private',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        requiresUserAuthorization: true,
        scope: 'permanent-rag'
      },
      tags: ['rag', 'permanent', 'database', 'import']
    },
    {
      name: 'export_collection',
      title: 'Export Permanent RAG Collection',
      description: 'User-only export of permanent RAG documents to JSON, YAML, or text.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'permanent-default' },
          format: { type: 'string', enum: ['json', 'yaml', 'yml', 'text', 'txt'], default: 'json' },
          filter: { type: 'object', additionalProperties: true },
          limit: { type: 'integer', minimum: 1, maximum: 100000 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'private',
      autoCallable: false,
      mutatesState: false,
      metadata: {
        requiresUserAuthorization: true,
        scope: 'permanent-rag'
      },
      tags: ['rag', 'permanent', 'export']
    },
    {
      name: 'list_collections',
      title: 'List Permanent RAG Collections',
      description: 'User-only list of permanent RAG collections.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      visibility: 'private',
      autoCallable: false,
      mutatesState: false,
      metadata: {
        requiresUserAuthorization: true,
        scope: 'permanent-rag'
      },
      tags: ['rag', 'permanent', 'schema']
    },
    {
      name: 'reindex_collection',
      title: 'Reindex Permanent RAG Collection',
      description: 'User-only maintenance operation that recomputes vectors for a permanent RAG collection with the active embedding provider.',
      inputSchema: maintenanceCollectionSchema(),
      visibility: 'private',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        requiresUserAuthorization: true,
        scope: 'permanent-rag'
      },
      tags: ['rag', 'permanent', 'maintenance', 'embedding']
    },
    {
      name: 'evaluate_collection',
      title: 'Evaluate Permanent RAG Collection',
      description: 'User-only retrieval evaluation for recall and precision test cases.',
      inputSchema: evaluationSchema('permanent-default'),
      visibility: 'private',
      autoCallable: false,
      mutatesState: false,
      metadata: {
        requiresUserAuthorization: true,
        scope: 'permanent-rag'
      },
      tags: ['rag', 'permanent', 'eval']
    }
  ]
};

export const RAG_RUNTIME_PLUGIN = {
  id: 'system.rag_runtime',
  name: 'Runtime RAG Tools',
  version: '0.1.0',
  description: 'Ephemeral runtime RAG tools backed by the existing vector store, for agent memory enhancement during a run.',
  enabled: true,
  permissions: ['rag-runtime:read', 'rag-runtime:write'],
  tools: [
    {
      name: 'remember',
      title: 'Remember Runtime RAG Text',
      description: 'Store short-lived runtime memory in the existing vector store for later retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'runtime-default' },
          sourceId: { type: 'string' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['text', 'txt', 'markdown', 'md', 'auto', 'json', 'yaml', 'yml'], default: 'text' },
          chunking: chunkingSchema(),
          fieldChunking: { type: 'boolean', default: true },
          chunkSize: { type: 'integer', minimum: 80, maximum: 20000 },
          overlap: { type: 'integer', minimum: 0, maximum: 5000 },
          ttlMs: { type: 'integer', minimum: 1 },
          ttlSeconds: { type: 'integer', minimum: 1 },
          expiresAt: { type: 'string' },
          importance: { type: 'number' },
          sceneId: { type: 'string' },
          actorIds: stringListSchema(),
          memoryType: { type: 'string' },
          domain: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          ...lifecycleSchemaProperties()
        },
        required: ['text'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'runtime-rag'
      },
      tags: ['rag', 'runtime', 'memory', 'write']
    },
    {
      name: 'search',
      title: 'Search Runtime RAG',
      description: 'Search short-lived runtime RAG memory.',
      inputSchema: searchSchema('runtime-default'),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['rag', 'runtime', 'search']
    },
    {
      name: 'prune_expired',
      title: 'Prune Expired Runtime RAG',
      description: 'Delete expired runtime RAG memories from one collection.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'runtime-default' }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'runtime-rag'
      },
      tags: ['rag', 'runtime', 'maintenance']
    },
    {
      name: 'maintain',
      title: 'Maintain Runtime RAG',
      description: 'Prune expired memories, merge highly similar runtime memories, and evict low-priority excess documents.',
      inputSchema: {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'runtime-default' },
          filter: { type: 'object', additionalProperties: true },
          maxDocuments: { type: 'integer', minimum: 1, maximum: 100000, default: 500 },
          similarityThreshold: { type: 'number', default: 0.92 },
          maxGroupSize: { type: 'integer', minimum: 2, maximum: 50, default: 6 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'runtime-rag'
      },
      tags: ['rag', 'runtime', 'maintenance', 'memory']
    }
  ]
};

export function createRagPermanentHandlers({ ragLayers, permanentRagService, runtimeRagService, dataManager, appDatabase } = {}) {
  const manager = ragLayers || new RagLayerManager({
    permanentRagService,
    runtimeRagService,
    dataManager,
    appDatabase
  });
  return {
    search: async ({ input }) => manager.searchPermanent(input),
    import_file: async ({ input }) => manager.importPermanentFile(input),
    import_database_snapshot: async ({ input }) => manager.importDatabaseSnapshot(input),
    export_collection: async ({ input }) => manager.exportPermanentCollection(input),
    list_collections: async () => manager.listPermanentCollections(),
    reindex_collection: async ({ input }) => manager.reindexPermanent(input),
    evaluate_collection: async ({ input }) => evaluateRagRetrieval({
      ragService: manager.permanentRagService,
      ...input
    })
  };
}

export function createRagRuntimeHandlers({ ragLayers, permanentRagService, runtimeRagService, dataManager, appDatabase } = {}) {
  const manager = ragLayers || new RagLayerManager({
    permanentRagService,
    runtimeRagService,
    dataManager,
    appDatabase
  });
  return {
    remember: async ({ input }) => manager.rememberRuntime(input),
    search: async ({ input }) => manager.searchRuntime(input),
    prune_expired: async ({ input }) => manager.pruneRuntime(input),
    maintain: async ({ input }) => manager.maintainRuntime(input)
  };
}

function searchSchema(defaultCollection) {
  return {
    type: 'object',
    properties: {
      collection: { type: 'string', default: defaultCollection },
      query: { type: 'string', minLength: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      minScore: { type: 'number' },
      filter: { type: 'object', additionalProperties: true },
      mode: { type: 'string', enum: ['hybrid', 'vector', 'keyword'] },
      searchLimit: { type: 'integer', minimum: 1, maximum: 100000 },
      vectorWeight: { type: 'number' },
      keywordWeight: { type: 'number' },
      entityWeight: { type: 'number' },
      recencyWeight: { type: 'number' },
      importanceWeight: { type: 'number' },
      lifecycleWeight: { type: 'number' },
      diversity: { type: 'boolean' },
      mmrLambda: { type: 'number' },
      includeExpired: { type: 'boolean', default: false },
      ...lifecycleSchemaProperties()
    },
    required: ['query'],
    additionalProperties: false
  };
}

function chunkingSchema() {
  return { type: 'string', enum: ['auto', 'text', 'plain', 'markdown', 'structured', 'database', 'chat'] };
}

function maintenanceCollectionSchema() {
  return {
    type: 'object',
    properties: {
      collection: { type: 'string', default: 'permanent-default' },
      filter: { type: 'object', additionalProperties: true },
      limit: { type: 'integer', minimum: 1, maximum: 100000 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function evaluationSchema(defaultCollection) {
  return {
    type: 'object',
    properties: {
      collection: { type: 'string', default: defaultCollection },
      cases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            query: { type: 'string', minLength: 1 },
            expected: stringListSchema(),
            expectedIds: stringListSchema(),
            expectedSourceIds: stringListSchema(),
            unexpected: stringListSchema(),
            unexpectedIds: stringListSchema(),
            unexpectedSourceIds: stringListSchema(),
            collection: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 50 },
            minScore: { type: 'number' },
            mode: { type: 'string', enum: ['hybrid', 'vector', 'keyword'] },
            filter: { type: 'object', additionalProperties: true }
          },
          required: ['query'],
          additionalProperties: false
        }
      },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      minScore: { type: 'number' },
      mode: { type: 'string', enum: ['hybrid', 'vector', 'keyword'] },
      filter: { type: 'object', additionalProperties: true }
    },
    required: ['cases'],
    additionalProperties: false
  };
}

function stringListSchema() {
  return {
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } }
    ]
  };
}
