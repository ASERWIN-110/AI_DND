// @ts-nocheck
import { ChatCompressionMemory } from '../memory/chat-compression.js';

export const CHAT_COMPRESSION_PLUGIN = {
  id: 'system.chat_compression',
  name: 'Chat Compression Memory Tools',
  version: '0.1.0',
  description: 'Chat-local derived memory compression tools. Raw chat messages remain the source of truth.',
  enabled: true,
  permissions: ['chat-compression:read', 'chat-compression:write'],
  tools: [
    {
      name: 'list_summaries',
      title: 'List Chat Compression Summaries',
      description: 'List chat-local compressed memory records for one chat session.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          type: compressionTypeSchema(),
          status: compressionStatusSchema(),
          query: { type: 'string' },
          filter: { type: 'object', additionalProperties: true },
          sort: sortSchema(),
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'compression', 'query']
    },
    {
      name: 'get_summary',
      title: 'Get Chat Compression Summary',
      description: 'Get one compressed memory record by id.',
      inputSchema: compressionIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'compression', 'query']
    },
    {
      name: 'upsert_summary',
      title: 'Upsert Chat Compression Summary',
      description: 'Create or replace a compressed memory record without changing raw chat messages.',
      inputSchema: compressionRecordSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        derivedMemory: true
      },
      tags: ['memory', 'compression', 'write']
    },
    {
      name: 'patch_summary',
      title: 'Patch Chat Compression Summary',
      description: 'Patch one compressed memory record. Raw chat messages are not modified.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          recordId: { type: 'string' },
          summaryId: { type: 'string' },
          patch: compressionPatchSchema(),
          update: compressionPatchSchema()
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        derivedMemory: true
      },
      tags: ['memory', 'compression', 'write']
    },
    {
      name: 'delete_summary',
      title: 'Delete Chat Compression Summary',
      description: 'Delete one compressed memory record. Raw chat messages are not modified.',
      inputSchema: compressionIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true,
        derivedMemory: true
      },
      tags: ['memory', 'compression', 'delete']
    },
    {
      name: 'build_prompt',
      title: 'Build Chat Compression Prompt',
      description: 'Build a prompt section that asks a model to compress selected raw chat messages into AI_DND_CHAT_COMPRESSION records.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          type: compressionTypeSchema('segment_summary'),
          messageIds: stringArraySchema(),
          fromMessageId: { type: 'string' },
          toMessageId: { type: 'string' },
          fromOrderIndex: { type: 'integer' },
          toOrderIndex: { type: 'integer' },
          recentCount: { type: 'integer', minimum: 0, maximum: 500 },
          includeExistingContext: { type: 'boolean', default: true },
          extraInstructions: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'compression', 'prompt']
    },
    {
      name: 'apply_output',
      title: 'Apply Chat Compression Output',
      description: 'Parse an assistant response containing an AI_DND_CHAT_COMPRESSION block, strip the block, and write compressed memory records to the chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          content: { type: 'string' },
          source: { type: 'string', default: 'assistant' },
          defaultType: compressionTypeSchema('segment_summary')
        },
        required: ['chatSessionId', 'content'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        derivedMemory: true
      },
      tags: ['memory', 'compression', 'structured-output']
    },
    {
      name: 'get_prompt_context',
      title: 'Get Compressed Prompt Context',
      description: 'Build future prompt context from compressed summaries plus a configurable tail of raw messages.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          query: { type: 'string' },
          recentMessageCount: { type: 'integer', minimum: 0, maximum: 500 },
          includeRolling: { type: 'boolean', default: true },
          includeSegmentSummaries: { type: 'boolean', default: true },
          includePinnedFacts: { type: 'boolean', default: true },
          summaryLimit: { type: 'integer', minimum: 0, maximum: 500 },
          pinnedLimit: { type: 'integer', minimum: 0, maximum: 500 },
          maxContextTokens: { type: 'integer', minimum: 1 },
          includeRawMessages: { type: 'boolean', default: true }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'compression', 'prompt', 'context']
    },
    {
      name: 'import_document',
      title: 'Import Chat Compression Document',
      description: 'Import compressed chat memory records from JSON, YAML, or XML into one chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          collection: { type: 'string' },
          collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
          idField: { type: 'string', default: 'id' },
          defaultType: compressionTypeSchema('manual_note'),
          source: { type: 'string', default: 'document-import' }
        },
        required: ['chatSessionId', 'text'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        derivedMemory: true
      },
      tags: ['memory', 'compression', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Chat Compression Document',
      description: 'Export compressed chat memory records to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          type: compressionTypeSchema(),
          status: compressionStatusSchema(),
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'compression', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_compression_db',
      title: 'Describe Chat Compression DB',
      description: 'Describe the chat-local compression collection and synchronized schema file.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'compression', 'schema']
    }
  ]
};

export function createChatCompressionHandlers({ appDatabase, memory, trace } = {}) {
  const chatCompression = memory || new ChatCompressionMemory({ appDatabase, trace });
  return {
    list_summaries: async ({ input }) => chatCompression.listSummaries(input),
    get_summary: async ({ input }) => chatCompression.getSummary(input),
    upsert_summary: async ({ input }) => chatCompression.upsertSummary(input, { source: input.source || 'tool' }),
    patch_summary: async ({ input }) => chatCompression.patchSummary(input, { source: input.source || 'tool' }),
    delete_summary: async ({ input }) => chatCompression.deleteSummary(input),
    build_prompt: async ({ input }) => chatCompression.buildPrompt(input.chatSessionId, input),
    apply_output: async ({ input }) => chatCompression.applyModelOutput(input.chatSessionId, input.content, input),
    get_prompt_context: async ({ input }) => chatCompression.getPromptContext(input.chatSessionId, input),
    import_document: async ({ input }) => chatCompression.importDocument(input),
    export_document: async ({ input }) => chatCompression.exportDocument(input),
    describe_compression_db: async ({ input }) => chatCompression.describe(input.chatSessionId)
  };
}

function compressionRecordSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      summaryId: { type: 'string' },
      type: compressionTypeSchema('segment_summary'),
      title: { type: 'string' },
      summary: { type: 'string' },
      text: { type: 'string' },
      facts: objectArraySchema(),
      openThreads: objectArraySchema(),
      threads: objectArraySchema(),
      npcNotes: objectArraySchema(),
      npcs: objectArraySchema(),
      sceneNotes: objectArraySchema(),
      scenes: objectArraySchema(),
      sourceMessageIds: stringArraySchema(),
      messageIds: stringArraySchema(),
      fromMessageId: { type: 'string' },
      toMessageId: { type: 'string' },
      fromOrderIndex: { type: 'integer' },
      toOrderIndex: { type: 'integer' },
      tokenEstimate: { type: 'integer' },
      importance: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      status: compressionStatusSchema('active'),
      source: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function compressionPatchSchema() {
  const schema = compressionRecordSchema();
  delete schema.required;
  delete schema.properties.chatSessionId;
  delete schema.properties.id;
  delete schema.properties.recordId;
  delete schema.properties.summaryId;
  return schema;
}

function compressionIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      summaryId: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function compressionTypeSchema(defaultValue) {
  return {
    type: 'string',
    enum: ['rolling_summary', 'segment_summary', 'pinned_fact', 'scene_summary', 'manual_note'],
    ...(defaultValue ? { default: defaultValue } : {})
  };
}

function compressionStatusSchema(defaultValue) {
  return {
    type: 'string',
    enum: ['active', 'superseded', 'archived', 'draft'],
    ...(defaultValue ? { default: defaultValue } : {})
  };
}

function objectArraySchema() {
  return {
    anyOf: [
      {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      { type: 'object', additionalProperties: true },
      { type: 'string' }
    ]
  };
}

function stringArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'string' } },
      { type: 'string' }
    ]
  };
}

function sortSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        field: { type: 'string' },
        direction: { type: 'string', enum: ['asc', 'desc'] }
      },
      required: ['field'],
      additionalProperties: false
    }
  };
}
