// @ts-nocheck
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';

export const NPC_STATE_PLUGIN = {
  id: 'system.npc_state',
  name: 'NPC Structured State Tools',
  version: '0.1.0',
  description: 'Chat-local NPC runtime state tools for numeric values, special statuses, and inventory only.',
  enabled: true,
  permissions: ['npc-state:read', 'npc-state:write'],
  tools: [
    {
      name: 'list_states',
      title: 'List NPC Structured States',
      description: 'List chat-local NPC numeric/status/inventory states.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string' },
          npcId: { type: 'string' },
          actorType: { type: 'string' },
          isPlayer: { type: 'boolean' },
          isProtagonist: { type: 'boolean' },
          playerId: { type: 'string' },
          greeting: { type: 'string' },
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
      tags: ['npc', 'state', 'query']
    },
    {
      name: 'get_state',
      title: 'Get NPC Structured State',
      description: 'Get one NPC structured state by record id, or by npcId and sceneId.',
      inputSchema: npcStateIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'state', 'query']
    },
    {
      name: 'patch_state',
      title: 'Patch NPC Structured State',
      description: 'Patch one NPC state. Only numeric values, special statuses, and inventory are accepted.',
      inputSchema: npcStateInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session'
      },
      tags: ['npc', 'state', 'write']
    },
    {
      name: 'rewrite_state',
      title: 'Rewrite NPC Structured State',
      description: 'Replace one NPC state. Only numeric values, special statuses, and inventory are accepted.',
      inputSchema: npcStateInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session'
      },
      tags: ['npc', 'state', 'write']
    },
    {
      name: 'delete_state',
      title: 'Delete NPC Structured State',
      description: 'Delete one NPC numeric/status/inventory state record.',
      inputSchema: npcStateIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['npc', 'state', 'delete']
    },
    {
      name: 'apply_output',
      title: 'Apply NPC Structured Output',
      description: 'Parse an assistant response containing an AI_DND_NPC_STATE block, strip the block from narrative text, and write numeric/status/inventory updates to the chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          content: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          defaultMode: { type: 'string', enum: ['patch', 'rewrite', 'replace', 'generate'], default: 'patch' },
          source: { type: 'string', default: 'assistant' }
        },
        required: ['chatSessionId', 'content'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session'
      },
      tags: ['npc', 'state', 'structured-output']
    },
    {
      name: 'build_prompt',
      title: 'Build NPC Structured State Prompt',
      description: 'Build a prompt section that asks the model to output only NPC numeric values, special statuses, and inventory changes.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          includeCurrentState: { type: 'boolean', default: true },
          mode: { type: 'string', enum: ['patch', 'rewrite'], default: 'patch' },
          extraInstructions: { type: 'string' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'state', 'prompt']
    },
    {
      name: 'import_document',
      title: 'Import NPC Structured State Document',
      description: 'Import NPC numeric/status/inventory states from JSON, YAML, or XML into one chat-local database.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          mode: { type: 'string', enum: ['patch', 'rewrite', 'replace', 'generate'], default: 'rewrite' },
          collection: { type: 'string' },
          collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
          idField: { type: 'string', default: 'id' },
          source: { type: 'string', default: 'document-import' }
        },
        required: ['chatSessionId', 'text'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session'
      },
      tags: ['npc', 'state', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export NPC Structured State Document',
      description: 'Export NPC numeric/status/inventory states to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string' },
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
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
      tags: ['npc', 'state', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_state_db',
      title: 'Describe NPC Structured State DB',
      description: 'Describe the chat-local NPC structured state collection and synchronized schema file.',
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
      tags: ['npc', 'state', 'schema']
    }
  ]
};

export function createNpcStateHandlers({ appDatabase, database, trace } = {}) {
  const npcState = database || new NpcStructuredStateDatabase({ appDatabase, trace });
  return {
    list_states: async ({ input }) => npcState.listNpcStates(input),
    get_state: async ({ input }) => npcState.getNpcState(input),
    patch_state: async ({ input }) => npcState.patchNpcState(input, { source: input.source || 'tool' }),
    rewrite_state: async ({ input }) => npcState.rewriteNpcState(input, { source: input.source || 'tool' }),
    delete_state: async ({ input }) => npcState.deleteNpcState(input),
    apply_output: async ({ input }) => npcState.applyModelOutput(input.chatSessionId, input.content, input),
    build_prompt: async ({ input }) => npcState.buildPrompt(input.chatSessionId, input),
    import_document: async ({ input }) => npcState.importDocument(input),
    export_document: async ({ input }) => npcState.exportDocument(input),
    describe_state_db: async ({ input }) => npcState.describe(input.chatSessionId)
  };
}

function npcStateInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      npcId: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      isPlayer: { type: 'boolean' },
      isProtagonist: { type: 'boolean' },
      protagonist: { type: 'boolean' },
      activeProtagonist: { type: 'boolean' },
      player: { type: 'boolean' },
      playerId: { type: 'string' },
      protagonistId: { type: 'string' },
      name: { type: 'string' },
      greeting: { type: 'string' },
      initialGreeting: { type: 'string' },
      initialSituation: { type: 'string' },
      openingSituation: { type: 'string' },
      values: numericValuesSchema(),
      numericValues: numericValuesSchema(),
      statusBar: { type: 'object', additionalProperties: true },
      skillBar: { type: 'object', additionalProperties: true },
      specialStatuses: statusArraySchema(),
      statuses: statusArraySchema(),
      inventory: inventorySchema(),
      equipment: { type: 'object', additionalProperties: true },
      resources: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function npcStateIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      npcId: { type: 'string' },
      playerId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function numericValuesSchema() {
  return {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'number' },
        { type: 'string' },
        { type: 'null' }
      ]
    }
  };
}

function statusArraySchema() {
  return {
    anyOf: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string' },
            active: { type: 'boolean' },
            stacks: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            intensity: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            remainingTurns: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            duration: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            turns: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            source: { type: 'string' },
            description: { type: 'string' },
            text: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
            _delete: { type: 'boolean' }
          },
          additionalProperties: false
        }
      },
      { type: 'object', additionalProperties: true }
    ]
  };
}

function inventorySchema() {
  return {
    type: 'object',
    properties: {
      currency: numericValuesSchema(),
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            quantity: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            count: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            equipped: { type: 'boolean' },
            value: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            weight: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            tags: stringArraySchema(),
            description: { type: 'string' },
            text: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
            _delete: { type: 'boolean' }
          },
          additionalProperties: false
        }
      }
    },
    additionalProperties: false
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
