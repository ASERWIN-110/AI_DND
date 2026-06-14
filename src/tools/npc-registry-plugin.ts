// @ts-nocheck
import { NpcRegistry } from '../npcs/npc-registry.js';
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const NPC_REGISTRY_PLUGIN = {
  id: 'system.npc_registry',
  name: 'NPC Registry Tools',
  version: '0.1.0',
  description: 'L0 NPC registry for scene mounting: id, name, role, importance, tags, location, and profile reference.',
  enabled: true,
  permissions: ['npc-registry:read', 'npc-registry:write'],
  tools: [
    {
      name: 'list_npcs',
      title: 'List NPCs',
      description: 'List L0 NPC registry entries with optional filters, tags, and text query.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'object', additionalProperties: true },
          tags: { type: 'array', items: { type: 'string' } },
          query: { type: 'string' },
          sort: {
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
          },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 },
          ...lifecycleSchemaProperties()
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'registry', 'query']
    },
    {
      name: 'get_npc',
      title: 'Get NPC',
      description: 'Get one L0 NPC registry entry by id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'registry', 'query']
    },
    {
      name: 'upsert_npc',
      title: 'Create Or Replace NPC',
      description: 'Create or replace one L0 NPC registry entry. Requires explicit user authorization.',
      inputSchema: npcInputSchema(),
      annotations: {
        requiresUserAuthorization: true
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['npc', 'registry', 'write']
    },
    {
      name: 'patch_npc',
      title: 'Patch NPC',
      description: 'Patch an existing L0 NPC registry entry. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: npcPatchSchema()
        },
        required: ['id', 'patch'],
        additionalProperties: false
      },
      annotations: {
        requiresUserAuthorization: true
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['npc', 'registry', 'write']
    },
    {
      name: 'delete_npc',
      title: 'Delete NPC',
      description: 'Delete one L0 NPC registry entry. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id'],
        additionalProperties: false
      },
      annotations: {
        requiresUserAuthorization: true
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        ...AUTH_METADATA,
        destructive: true
      },
      tags: ['npc', 'registry', 'delete']
    },
    {
      name: 'import_document',
      title: 'Import NPC Registry Document',
      description: 'Import L0 NPC registry entries from JSON, YAML, or XML. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          collection: { type: 'string' },
          collectionMap: { type: 'object', additionalProperties: { type: 'string' } },
          idField: { type: 'string', default: 'id' },
          source: { type: 'string', default: 'agent-import' },
          ...lifecycleSchemaProperties()
        },
        required: ['text'],
        additionalProperties: false
      },
      annotations: {
        requiresUserAuthorization: true
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['npc', 'registry', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export NPC Registry Document',
      description: 'Export L0 NPC registry entries to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          filter: { type: 'object', additionalProperties: true },
          tags: { type: 'array', items: { type: 'string' } },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'registry', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_registry',
      title: 'Describe NPC Registry',
      description: 'Describe the underlying NPC registry collection and synchronized schema file.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'registry', 'schema']
    }
  ]
};

export function createNpcRegistryHandlers({ dataManager, registry, appDatabase } = {}) {
  const npcRegistry = registry || new NpcRegistry({ dataManager, appDatabase });
  return {
    list_npcs: async ({ input }) => npcRegistry.listNpcs(input),
    get_npc: async ({ input }) => npcRegistry.getNpc(input.id),
    upsert_npc: async ({ input }) => npcRegistry.upsertNpc(input),
    patch_npc: async ({ input }) => npcRegistry.patchNpc(input.id, input.patch),
    delete_npc: async ({ input }) => npcRegistry.deleteNpc(input.id),
    import_document: async ({ input }) => npcRegistry.importDocument(input),
    export_document: async ({ input }) => npcRegistry.exportDocument(input),
    describe_registry: async () => npcRegistry.describe()
  };
}

function npcInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      npcId: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      isPlayer: { type: 'boolean' },
      player: { type: 'boolean' },
      playerId: { type: 'string' },
      protagonistId: { type: 'string' },
      role: { type: 'string' },
      importance: { type: 'string', enum: ['minor', 'supporting', 'major', 'key'] },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      currentLocation: { type: 'string' },
      location: { type: 'string' },
      profileRef: { type: 'string' },
      profile: { type: 'string' },
      characterCardRef: { type: 'string' },
      status: { type: 'string' },
      summary: { type: 'string' },
      ...npcVisualSchemaProperties(),
      metadata: { type: 'object', additionalProperties: true },
      source: { type: 'string' },
      campaignId: { type: 'string' },
      chatSessionId: { type: 'string' },
      ...lifecycleSchemaProperties()
    },
    required: ['name'],
    additionalProperties: false
  };
}

function npcPatchSchema() {
  return {
    type: 'object',
    properties: {
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      isPlayer: { type: 'boolean' },
      player: { type: 'boolean' },
      playerId: { type: 'string' },
      protagonistId: { type: 'string' },
      role: { type: 'string' },
      importance: { type: 'string', enum: ['minor', 'supporting', 'major', 'key'] },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      currentLocation: { type: 'string' },
      location: { type: 'string' },
      profileRef: { type: 'string' },
      profile: { type: 'string' },
      characterCardRef: { type: 'string' },
      status: { type: 'string' },
      summary: { type: 'string' },
      ...npcVisualSchemaProperties(),
      metadata: { type: 'object', additionalProperties: true },
      source: { type: 'string' },
      campaignId: { type: 'string' },
      chatSessionId: { type: 'string' },
      ...lifecycleSchemaProperties()
    },
    additionalProperties: false
  };
}

function npcVisualSchemaProperties() {
  return {
    image: { type: 'string' },
    imageUrl: { type: 'string' },
    imageUri: { type: 'string' },
    avatar: { type: 'string' },
    avatarUrl: { type: 'string' },
    portrait: { type: 'string' },
    portraitUrl: { type: 'string' },
    portraitImage: { type: 'string' },
    cg: { type: 'string' },
    cgUrl: { type: 'string' },
    sprite: { type: 'string' },
    spriteUrl: { type: 'string' },
    token: { type: 'string' },
    tokenUrl: { type: 'string' },
    visual: { type: 'object', additionalProperties: true },
    assets: {},
    media: {}
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
