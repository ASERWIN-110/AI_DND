// @ts-nocheck
import { SceneMapMountManager } from '../maps/scene-map-mounts.js';

export const SCENE_MAP_PLUGIN = {
  id: 'system.scene_maps',
  name: 'Scene Map Mount Tools',
  version: '0.1.0',
  description: 'Per-chat current-scene map mounting tools backed by the chat data SQLite database.',
  enabled: true,
  permissions: ['scene-maps:read', 'scene-maps:write'],
  tools: [
    {
      name: 'list_mounted_maps',
      title: 'List Mounted Scene Maps',
      description: 'List maps mounted into one chat scene. Use this for current prompt context, scene UI, and debug inspection.',
      inputSchema: listSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'scene', 'mount', 'query']
    },
    {
      name: 'get_mounted_map',
      title: 'Get Mounted Scene Map',
      description: 'Get one mounted map by mount id, or by mapId within a scene.',
      inputSchema: identitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'scene', 'mount', 'query']
    },
    {
      name: 'mount_map',
      title: 'Mount Map Into Scene',
      description: 'Create or replace a map mount in the current chat scene. It can hydrate L0 data from the map registry when mapId matches a registry entry.',
      inputSchema: sceneMapMountInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        idempotent: true
      },
      tags: ['map', 'scene', 'mount', 'write']
    },
    {
      name: 'patch_mounted_map',
      title: 'Patch Mounted Scene Map',
      description: 'Patch one map mount in a chat scene by mount id, or by mapId plus sceneId.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          mapId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          patch: sceneMapMountPatchSchema()
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
      tags: ['map', 'scene', 'mount', 'write']
    },
    {
      name: 'unmount_map',
      title: 'Unmount Scene Map',
      description: 'Remove one map from the current chat scene, or mark it inactive.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          mapId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          mode: { type: 'string', enum: ['delete', 'markInactive', 'mark-inactive'], default: 'delete' },
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
      tags: ['map', 'scene', 'mount', 'delete']
    },
    {
      name: 'clear_scene_maps',
      title: 'Clear Scene Maps',
      description: 'Remove or mark inactive all map mounts in one scene. Useful when the scene changes.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          mode: { type: 'string', enum: ['delete', 'markInactive', 'mark-inactive'], default: 'delete' },
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
      tags: ['map', 'scene', 'mount', 'delete']
    },
    {
      name: 'import_document',
      title: 'Import Scene Map Mount Document',
      description: 'Import current-scene map mounts from JSON, YAML, or XML into one chat scene.',
      inputSchema: importSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        scope: 'chat-session'
      },
      tags: ['map', 'scene', 'mount', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Scene Map Mount Document',
      description: 'Export one chat scene map mount set to JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'scene', 'mount', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_mounts',
      title: 'Describe Scene Map Mount Collection',
      description: 'Describe the chat-local scene map mount collection and synchronized schema file.',
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
      tags: ['map', 'scene', 'mount', 'schema']
    }
  ]
};

export function createSceneMapHandlers({ appDatabase, dataManager, mapRegistry, manager } = {}) {
  const sceneMaps = manager || new SceneMapMountManager({
    appDatabase,
    dataManager,
    mapRegistry
  });
  return {
    list_mounted_maps: async ({ input }) => sceneMaps.listMountedMaps(input),
    get_mounted_map: async ({ input }) => sceneMaps.getMountedMap(input),
    mount_map: async ({ input }) => sceneMaps.mountMap(input),
    patch_mounted_map: async ({ input }) => sceneMaps.patchMountedMap(input),
    unmount_map: async ({ input }) => sceneMaps.unmountMap(input),
    clear_scene_maps: async ({ input }) => sceneMaps.clearSceneMaps(input),
    import_document: async ({ input }) => sceneMaps.importDocument(input),
    export_document: async ({ input }) => sceneMaps.exportDocument(input),
    describe_mounts: async ({ input }) => sceneMaps.describe(input.chatSessionId)
  };
}

function sceneMapMountInputSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      mapId: { type: 'string' },
      registryId: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      parentMapId: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      status: { type: 'string' },
      visibility: { type: 'string' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      registryRef: { type: 'string' },
      summary: { type: 'string' },
      mountReason: { type: 'string' },
      reason: { type: 'string' },
      source: { type: 'string' },
      orderIndex: { type: 'integer' },
      image: { type: 'string' },
      imageUrl: { type: 'string' },
      imageUri: { type: 'string' },
      background: { type: 'string' },
      backgroundUrl: { type: 'string' },
      backgroundImage: { type: 'string' },
      backgroundImageUrl: { type: 'string' },
      cg: { type: 'string' },
      cgUrl: { type: 'string' },
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

function sceneMapMountPatchSchema() {
  const schema = sceneMapMountInputSchema();
  delete schema.required;
  delete schema.properties.chatSessionId;
  delete schema.properties.id;
  delete schema.properties.sceneId;
  return schema;
}

function listSchema() {
  return {
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
  };
}

function identitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      mapId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function importSchema() {
  return {
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
  };
}

function exportSchema() {
  return {
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
