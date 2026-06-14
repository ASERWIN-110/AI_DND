// @ts-nocheck
import { MapStructuredStateDatabase } from '../maps/map-structured-state.js';

export const MAP_STATE_PLUGIN = {
  id: 'system.map_state',
  name: 'Map Structured State Tools',
  version: '0.1.0',
  description: 'Chat-local map runtime state tools for position, areas, exits, objects, hazards, fog of war, routes, and numeric map values.',
  enabled: true,
  permissions: ['map-state:read', 'map-state:write'],
  tools: [
    {
      name: 'list_states',
      title: 'List Map Structured States',
      description: 'List chat-local map runtime states.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string' },
          mapId: { type: 'string' },
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
      tags: ['map', 'state', 'query']
    },
    {
      name: 'get_state',
      title: 'Get Map Structured State',
      description: 'Get one map structured state by record id, or by mapId and sceneId.',
      inputSchema: mapStateIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'state', 'query']
    },
    {
      name: 'patch_state',
      title: 'Patch Map Structured State',
      description: 'Patch one map state. Position, areas, exits, objects, hazards, fog of war, routes, and numeric values are accepted.',
      inputSchema: mapStateInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['map', 'state', 'write']
    },
    {
      name: 'rewrite_state',
      title: 'Rewrite Map Structured State',
      description: 'Replace one map state.',
      inputSchema: mapStateInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['map', 'state', 'write']
    },
    {
      name: 'delete_state',
      title: 'Delete Map Structured State',
      description: 'Delete one map structured state record.',
      inputSchema: mapStateIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['map', 'state', 'delete']
    },
    {
      name: 'apply_output',
      title: 'Apply Map Structured Output',
      description: 'Parse an assistant response containing an AI_DND_MAP_STATE block, strip the block from narrative text, and write map updates to the chat-local database.',
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
      metadata: { scope: 'chat-session' },
      tags: ['map', 'state', 'structured-output']
    },
    {
      name: 'build_prompt',
      title: 'Build Map Structured State Prompt',
      description: 'Build a prompt section that asks the model to output map exploration and state changes.',
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
      tags: ['map', 'state', 'prompt']
    },
    {
      name: 'import_document',
      title: 'Import Map Structured State Document',
      description: 'Import map structured states from JSON, YAML, or XML into one chat-local database.',
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
      metadata: { scope: 'chat-session' },
      tags: ['map', 'state', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Map Structured State Document',
      description: 'Export map structured states to JSON or YAML.',
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
      tags: ['map', 'state', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_state_db',
      title: 'Describe Map Structured State DB',
      description: 'Describe the chat-local map structured state collection and synchronized schema file.',
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
      tags: ['map', 'state', 'schema']
    }
  ]
};

export function createMapStateHandlers({ appDatabase, database, trace } = {}) {
  const mapState = database || new MapStructuredStateDatabase({ appDatabase, trace });
  return {
    list_states: async ({ input }) => mapState.listMapStates(input),
    get_state: async ({ input }) => mapState.getMapState(input),
    patch_state: async ({ input }) => mapState.patchMapState(input, { source: input.source || 'tool' }),
    rewrite_state: async ({ input }) => mapState.rewriteMapState(input, { source: input.source || 'tool' }),
    delete_state: async ({ input }) => mapState.deleteMapState(input),
    apply_output: async ({ input }) => mapState.applyModelOutput(input.chatSessionId, input.content, input),
    build_prompt: async ({ input }) => mapState.buildPrompt(input.chatSessionId, input),
    import_document: async ({ input }) => mapState.importDocument(input),
    export_document: async ({ input }) => mapState.exportDocument(input),
    describe_state_db: async ({ input }) => mapState.describe(input.chatSessionId)
  };
}

function mapStateInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      mapId: { type: 'string' },
      name: { type: 'string' },
      position: { type: 'object', additionalProperties: true },
      areas: objectArraySchema(),
      exits: objectArraySchema(),
      objects: objectArraySchema(),
      visibleObjects: objectArraySchema(),
      hazards: objectArraySchema(),
      fogOfWar: { type: 'object', additionalProperties: true },
      routes: objectArraySchema(),
      values: numericValuesSchema(),
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function mapStateIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      recordId: { type: 'string' },
      mapId: { type: 'string' },
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

function objectArraySchema() {
  return {
    anyOf: [
      {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      { type: 'object', additionalProperties: true }
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
