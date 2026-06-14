// @ts-nocheck
import { SceneNpcMountManager } from '../npcs/scene-npc-mounts.js';

export const SCENE_NPC_PLUGIN = {
  id: 'system.scene_npcs',
  name: 'Scene NPC Mount Tools',
  version: '0.1.0',
  description: 'Per-chat current-scene NPC mounting tools backed by the chat data SQLite database.',
  enabled: true,
  permissions: ['scene-npcs:read', 'scene-npcs:write'],
  tools: [
    {
      name: 'list_mounted_npcs',
      title: 'List Mounted Scene NPCs',
      description: 'List NPCs mounted into one chat scene. Use this for current prompt context, scene UI, and debug inspection.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          includeInactive: { type: 'boolean', default: false },
          status: { type: 'string' },
          visibility: { type: 'string' },
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
      tags: ['npc', 'scene', 'mount', 'query']
    },
    {
      name: 'get_mounted_npc',
      title: 'Get Mounted Scene NPC',
      description: 'Get one mounted NPC by mount id, or by npcId within a scene.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          npcId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'scene', 'mount', 'query']
    },
    {
      name: 'mount_npc',
      title: 'Mount NPC Into Scene',
      description: 'Create or replace an NPC mount in the current chat scene. It can hydrate L0 data from the NPC registry when npcId matches a registry entry.',
      inputSchema: sceneNpcMountInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        idempotent: true
      },
      tags: ['npc', 'scene', 'mount', 'write']
    },
    {
      name: 'patch_mounted_npc',
      title: 'Patch Mounted Scene NPC',
      description: 'Patch one NPC mount in a chat scene by mount id, or by npcId plus sceneId.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          npcId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          patch: sceneNpcMountPatchSchema()
        },
        required: ['chatSessionId', 'patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session'
      },
      tags: ['npc', 'scene', 'mount', 'write']
    },
    {
      name: 'unmount_npc',
      title: 'Unmount Scene NPC',
      description: 'Remove one NPC from the current chat scene, or mark it as departed.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          npcId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          mode: { type: 'string', enum: ['delete', 'markDeparted', 'mark-departed'], default: 'delete' },
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
        destructive: true
      },
      tags: ['npc', 'scene', 'mount', 'delete']
    },
    {
      name: 'clear_scene_npcs',
      title: 'Clear Scene NPCs',
      description: 'Remove or mark departed all NPC mounts in one scene. Useful when the scene changes.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          mode: { type: 'string', enum: ['delete', 'markDeparted', 'mark-departed'], default: 'delete' },
          includeInactive: { type: 'boolean', default: true },
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
        destructive: true
      },
      tags: ['npc', 'scene', 'mount', 'delete']
    },
    {
      name: 'import_document',
      title: 'Import Scene NPC Mount Document',
      description: 'Import current-scene NPC mounts from JSON, YAML, or XML into one chat scene.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
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
      tags: ['npc', 'scene', 'mount', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Scene NPC Mount Document',
      description: 'Export one chat scene NPC mount set to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          includeInactive: { type: 'boolean', default: true },
          tags: stringArraySchema(),
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
      tags: ['npc', 'scene', 'mount', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_mounts',
      title: 'Describe Scene NPC Mount Collection',
      description: 'Describe the chat-local scene NPC mount collection and synchronized schema file.',
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
      tags: ['npc', 'scene', 'mount', 'schema']
    }
  ]
};

export function createSceneNpcHandlers({ appDatabase, dataManager, npcRegistry, manager } = {}) {
  const sceneNpcs = manager || new SceneNpcMountManager({
    appDatabase,
    dataManager,
    npcRegistry
  });
  return {
    list_mounted_npcs: async ({ input }) => sceneNpcs.listMountedNpcs(input),
    get_mounted_npc: async ({ input }) => sceneNpcs.getMountedNpc(input),
    mount_npc: async ({ input }) => sceneNpcs.mountNpc(input),
    patch_mounted_npc: async ({ input }) => sceneNpcs.patchMountedNpc(input),
    unmount_npc: async ({ input }) => sceneNpcs.unmountNpc(input),
    clear_scene_npcs: async ({ input }) => sceneNpcs.clearSceneNpcs(input),
    import_document: async ({ input }) => sceneNpcs.importDocument(input),
    export_document: async ({ input }) => sceneNpcs.exportDocument(input),
    describe_mounts: async ({ input }) => sceneNpcs.describe(input.chatSessionId)
  };
}

function sceneNpcMountInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      npcId: { type: 'string' },
      registryId: { type: 'string' },
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
      status: { type: 'string' },
      visibility: { type: 'string' },
      disposition: { type: 'string' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      profileRef: { type: 'string' },
      profile: { type: 'string' },
      registryRef: { type: 'string' },
      summary: { type: 'string' },
      mountReason: { type: 'string' },
      reason: { type: 'string' },
      source: { type: 'string' },
      orderIndex: { type: 'integer' },
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
      media: {},
      overrides: { type: 'object', additionalProperties: true },
      metadata: { type: 'object', additionalProperties: true }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function sceneNpcMountPatchSchema() {
  const schema = sceneNpcMountInputSchema();
  delete schema.required;
  delete schema.properties.chatSessionId;
  delete schema.properties.id;
  delete schema.properties.sceneId;
  return schema;
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
