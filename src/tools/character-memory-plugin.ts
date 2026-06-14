// @ts-nocheck
import { CharacterMemoryStore } from '../memory/character-memory.js';

export const CHARACTER_MEMORY_PLUGIN = {
  id: 'system.character_memory',
  name: 'Character Memory Tools',
  version: '0.1.0',
  description: 'Chat-local per-character subjective memory tools derived from chat compression records.',
  enabled: true,
  permissions: ['character-memory:read', 'character-memory:write'],
  tools: [
    {
      name: 'list_memories',
      title: 'List Character Memories',
      description: 'List chat-local memories for one or more characters.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          characterId: { type: 'string' },
          characterIds: stringArraySchema(),
          memoryType: memoryTypeSchema(),
          memoryTypes: memoryTypeArraySchema(),
          knowledgeState: knowledgeStateSchema(),
          visibility: visibilitySchema(),
          status: memoryStatusSchema(),
          tags: stringArraySchema(),
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
      tags: ['memory', 'character', 'query']
    },
    {
      name: 'get_memory',
      title: 'Get Character Memory',
      description: 'Get one character memory record by id.',
      inputSchema: memoryIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'character', 'query']
    },
    {
      name: 'upsert_memory',
      title: 'Upsert Character Memory',
      description: 'Create or replace a chat-local subjective memory for a character.',
      inputSchema: memoryRecordSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        derivedMemory: true
      },
      tags: ['memory', 'character', 'write']
    },
    {
      name: 'patch_memory',
      title: 'Patch Character Memory',
      description: 'Patch one chat-local character memory record.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          recordId: { type: 'string' },
          memoryId: { type: 'string' },
          patch: memoryPatchSchema(),
          update: memoryPatchSchema(),
          source: { type: 'string' }
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
      tags: ['memory', 'character', 'write']
    },
    {
      name: 'delete_memory',
      title: 'Delete Character Memory',
      description: 'Delete one chat-local character memory record.',
      inputSchema: memoryIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true,
        derivedMemory: true
      },
      tags: ['memory', 'character', 'delete']
    },
    {
      name: 'build_prompt',
      title: 'Build Character Memory Prompt',
      description: 'Build a prompt that projects chat compression records into per-character subjective memories.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          characterId: { type: 'string' },
          characterIds: stringArraySchema(),
          sceneId: { type: 'string' },
          sourceCompressionIds: stringArraySchema(),
          compressionTypes: compressionTypeArraySchema(),
          compressionQuery: { type: 'string' },
          compressionLimit: { type: 'integer', minimum: 0, maximum: 500 },
          includeExistingMemories: { type: 'boolean', default: true },
          memoryLimit: { type: 'integer', minimum: 0, maximum: 500 },
          extraInstructions: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'character', 'prompt']
    },
    {
      name: 'apply_output',
      title: 'Apply Character Memory Output',
      description: 'Parse an assistant response containing an AI_DND_CHARACTER_MEMORY block and write character memories to the chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          content: { type: 'string' },
          source: { type: 'string', default: 'assistant' },
          defaultMemoryType: memoryTypeSchema('observation')
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
      tags: ['memory', 'character', 'structured-output']
    },
    {
      name: 'get_prompt_context',
      title: 'Get Character Memory Prompt Context',
      description: 'Build prompt context for specific characters or for the currently mounted scene NPCs.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          characterId: { type: 'string' },
          characterIds: stringArraySchema(),
          sceneId: { type: 'string' },
          query: { type: 'string' },
          memoryTypes: memoryTypeArraySchema(),
          visibility: visibilitySchema(),
          status: memoryStatusSchema(),
          limitPerCharacter: { type: 'integer', minimum: 0, maximum: 500 },
          maxContextTokens: { type: 'integer', minimum: 1 }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['memory', 'character', 'prompt', 'context']
    },
    {
      name: 'import_document',
      title: 'Import Character Memory Document',
      description: 'Import character memory records from JSON, YAML, or XML into one chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          collection: { type: 'string' },
          collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
          idField: { type: 'string', default: 'id' },
          defaultMemoryType: memoryTypeSchema('observation'),
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
      tags: ['memory', 'character', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Character Memory Document',
      description: 'Export character memory records to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          characterId: { type: 'string' },
          characterIds: stringArraySchema(),
          memoryType: memoryTypeSchema(),
          memoryTypes: memoryTypeArraySchema(),
          status: memoryStatusSchema(),
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
      tags: ['memory', 'character', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_memory_db',
      title: 'Describe Character Memory DB',
      description: 'Describe the chat-local character memory collection and synchronized schema file.',
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
      tags: ['memory', 'character', 'schema']
    }
  ]
};

export function createCharacterMemoryHandlers({ appDatabase, store, chatCompression, trace } = {}) {
  const characterMemory = store || new CharacterMemoryStore({ appDatabase, chatCompression, trace });
  return {
    list_memories: async ({ input }) => characterMemory.listMemories(input),
    get_memory: async ({ input }) => characterMemory.getMemory(input),
    upsert_memory: async ({ input }) => characterMemory.upsertMemory(input, { source: input.source || 'tool' }),
    patch_memory: async ({ input }) => characterMemory.patchMemory(input, { source: input.source || 'tool' }),
    delete_memory: async ({ input }) => characterMemory.deleteMemory(input),
    build_prompt: async ({ input }) => characterMemory.buildPrompt(input.chatSessionId, input),
    apply_output: async ({ input }) => characterMemory.applyModelOutput(input.chatSessionId, input.content, input),
    get_prompt_context: async ({ input }) => characterMemory.getPromptContext(input.chatSessionId, input),
    import_document: async ({ input }) => characterMemory.importDocument(input),
    export_document: async ({ input }) => characterMemory.exportDocument(input),
    describe_memory_db: async ({ input }) => characterMemory.describe(input.chatSessionId)
  };
}

function memoryRecordSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      memoryId: { type: 'string' },
      characterId: { type: 'string' },
      npcId: { type: 'string' },
      name: { type: 'string' },
      aliases: stringArraySchema(),
      memoryType: memoryTypeSchema('observation'),
      type: memoryTypeSchema(),
      summary: { type: 'string' },
      text: { type: 'string' },
      knowledgeState: knowledgeStateSchema('known'),
      state: knowledgeStateSchema(),
      importance: numberLikeSchema(),
      emotionalWeight: numberLikeSchema(),
      emotionWeight: numberLikeSchema(),
      confidence: numberLikeSchema(),
      visibility: visibilitySchema('private'),
      status: memoryStatusSchema('active'),
      tags: stringArraySchema(),
      relatedCharacterIds: stringArraySchema(),
      relatedNpcIds: stringArraySchema(),
      sourceCompressionIds: stringArraySchema(),
      compressionIds: stringArraySchema(),
      sourceMessageIds: stringArraySchema(),
      messageIds: stringArraySchema(),
      fromOrderIndex: { type: 'integer' },
      toOrderIndex: { type: 'integer' },
      source: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function memoryPatchSchema() {
  const schema = memoryRecordSchema();
  delete schema.required;
  delete schema.properties.chatSessionId;
  delete schema.properties.id;
  delete schema.properties.recordId;
  delete schema.properties.memoryId;
  return schema;
}

function memoryIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      memoryId: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function memoryTypeSchema(defaultValue) {
  return {
    type: 'string',
    enum: ['fact', 'promise', 'relationship', 'secret', 'emotion', 'goal', 'rumor', 'misunderstanding', 'preference', 'observation', 'plan', 'rule'],
    ...(defaultValue ? { default: defaultValue } : {})
  };
}

function memoryTypeArraySchema() {
  return {
    anyOf: [
      { type: 'array', items: memoryTypeSchema() },
      memoryTypeSchema()
    ]
  };
}

function compressionTypeArraySchema() {
  return {
    anyOf: [
      {
        type: 'array',
        items: {
          type: 'string',
          enum: ['rolling_summary', 'segment_summary', 'pinned_fact', 'scene_summary', 'manual_note']
        }
      },
      {
        type: 'string',
        enum: ['rolling_summary', 'segment_summary', 'pinned_fact', 'scene_summary', 'manual_note']
      }
    ]
  };
}

function knowledgeStateSchema(defaultValue) {
  return {
    type: 'string',
    enum: ['known', 'believed', 'suspected', 'false', 'unknown'],
    ...(defaultValue ? { default: defaultValue } : {})
  };
}

function visibilitySchema(defaultValue) {
  return {
    type: 'string',
    enum: ['private', 'shared', 'public'],
    ...(defaultValue ? { default: defaultValue } : {})
  };
}

function memoryStatusSchema(defaultValue) {
  return {
    type: 'string',
    enum: ['active', 'superseded', 'archived', 'draft'],
    ...(defaultValue ? { default: defaultValue } : {})
  };
}

function numberLikeSchema() {
  return {
    anyOf: [
      { type: 'number' },
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
