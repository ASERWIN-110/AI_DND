// @ts-nocheck
import { SceneManager } from '../scenes/scene-manager.js';

export const SCENE_MANAGER_PLUGIN = {
  id: 'system.scene_manager',
  name: 'Scene Manager Tools',
  version: '0.1.0',
  description: 'Chat-local scene orchestration tools that mount maps/NPCs, load RAG, initialize time/events, inject structured UI, and end scenes with compression/unmount cleanup.',
  enabled: true,
  permissions: ['scene:read', 'scene:write'],
  tools: [
    {
      name: 'describe_manager',
      title: 'Describe Scene Manager',
      description: 'Describe scene records plus dependent map, NPC, time, and compression collections.',
      inputSchema: chatSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['scene', 'schema', 'help']
    },
    {
      name: 'enter_scene',
      title: 'Enter Scene',
      description: 'Create or activate one scene, mount requested maps/NPCs, retrieve related RAG, initialize clock/events/encounter, and optionally inject structured UI.',
      inputSchema: enterSceneSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        idempotent: true
      },
      tags: ['scene', 'enter', 'orchestrate', 'write']
    },
    {
      name: 'end_scene',
      title: 'End Scene',
      description: 'End the active or selected scene, optionally write a scene_summary compression record, and unload temporary map/NPC mounts.',
      inputSchema: endSceneSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        destructive: true
      },
      tags: ['scene', 'end', 'compression', 'cleanup']
    },
    {
      name: 'upsert_scene',
      title: 'Upsert Scene Record',
      description: 'Create or replace a scene record without running enter-scene orchestration.',
      inputSchema: sceneRecordSchema({ required: ['chatSessionId'] }),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        scope: 'chat-session',
        idempotent: true
      },
      tags: ['scene', 'record', 'write']
    },
    {
      name: 'patch_scene',
      title: 'Patch Scene Record',
      description: 'Patch one scene record by id or sceneId without changing mounted objects.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          id: { type: 'string' },
          sceneId: { type: 'string' },
          patch: sceneRecordPatchSchema()
        },
        required: ['chatSessionId', 'patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['scene', 'record', 'write']
    },
    {
      name: 'get_scene',
      title: 'Get Scene Record',
      description: 'Get a scene record by id or sceneId.',
      inputSchema: sceneIdentitySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['scene', 'query']
    },
    {
      name: 'list_scenes',
      title: 'List Scene Records',
      description: 'List scene records in one chat.',
      inputSchema: listScenesSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['scene', 'query']
    },
    {
      name: 'build_prompt_context',
      title: 'Build Scene Prompt Context',
      description: 'Build compact scene context text from the scene record, mounted maps, mounted NPCs, loaded RAG, and timeline snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          chatSessionId: { type: 'string' },
          sceneId: { type: 'string', default: 'current' },
          includeInactive: { type: 'boolean', default: false }
        },
        required: ['chatSessionId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['scene', 'prompt', 'context']
    },
    {
      name: 'import_document',
      title: 'Import Scene Records',
      description: 'Import scene records from JSON, YAML, or XML. This only updates scene records; use enter_scene to mount dependencies.',
      inputSchema: importSchema(),
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { scope: 'chat-session' },
      tags: ['scene', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Scene Records',
      description: 'Export scene records as JSON or YAML for manual inspection and transfer.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['scene', 'export', 'json', 'yaml']
    }
  ]
};

export function createSceneManagerHandlers({
  appDatabase,
  dataManager,
  manager,
  sceneMaps,
  sceneNpcs,
  timeManager,
  chatCompression,
  runtimeRagService,
  permanentRagService,
  structuredInterfaceStore,
  chatProvider,
  trace
} = {}) {
  const scenes = manager || new SceneManager({
    appDatabase,
    dataManager,
    sceneMaps,
    sceneNpcs,
    timeManager,
    chatCompression,
    runtimeRagService,
    permanentRagService,
    structuredInterfaceStore,
    chatProvider,
    trace
  });
  return {
    describe_manager: async ({ input }) => scenes.describe(input.chatSessionId),
    enter_scene: async ({ input }) => scenes.enterScene(input),
    end_scene: async ({ input }) => scenes.endScene(input),
    upsert_scene: async ({ input }) => scenes.upsertScene(input),
    patch_scene: async ({ input }) => scenes.patchScene(input),
    get_scene: async ({ input }) => scenes.getScene(input),
    list_scenes: async ({ input }) => scenes.listScenes(input),
    build_prompt_context: async ({ input }) => scenes.buildScenePromptContext(input),
    import_document: async ({ input }) => scenes.importDocument(input),
    export_document: async ({ input }) => scenes.exportDocument(input)
  };
}

function chatSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function enterSceneSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      sceneId: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      status: { type: 'string', default: 'active' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      maps: { type: 'array', items: mapMountSchema() },
      mapMounts: { type: 'array', items: mapMountSchema() },
      mapRefs: { type: 'array', items: mapMountSchema() },
      npcs: { type: 'array', items: npcMountSchema() },
      npcMounts: { type: 'array', items: npcMountSchema() },
      npcRefs: { type: 'array', items: npcMountSchema() },
      ragQuery: { type: 'string' },
      rag: ragSchema(),
      time: timeInitSchema(),
      runtimeSessionId: { type: 'string' },
      structuredSessionId: { type: 'string' },
      structuredInterface: structuredInterfaceSchema(),
      ui: structuredInterfaceSchema(),
      endPreviousActive: { type: 'boolean', default: false },
      enteredAt: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function endSceneSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      sceneId: { type: 'string' },
      status: { type: 'string', default: 'ended' },
      summary: { type: 'string' },
      facts: arraySchema(),
      openThreads: arraySchema(),
      npcNotes: arraySchema(),
      sceneNotes: arraySchema(),
      sourceMessageIds: arraySchema(),
      fromMessageId: { type: 'string' },
      toMessageId: { type: 'string' },
      fromOrderIndex: { type: 'integer' },
      toOrderIndex: { type: 'integer' },
      compressMemory: { type: 'boolean', default: true },
      unmountNpcs: { type: 'boolean', default: true },
      unmountMaps: { type: 'boolean', default: true },
      npcUnmountMode: { type: 'string', enum: ['delete', 'markDeparted', 'mark-departed'], default: 'markDeparted' },
      mapUnmountMode: { type: 'string', enum: ['delete', 'markInactive', 'mark-inactive'], default: 'markInactive' },
      runtimeSessionId: { type: 'string' },
      structuredSessionId: { type: 'string' },
      structuredInterface: structuredInterfaceSchema(),
      ui: structuredInterfaceSchema(),
      endedAt: { type: 'string' },
      source: { type: 'string' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function sceneRecordSchema({ required = [] } = {}) {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      sceneId: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string' },
      locationLabel: { type: 'string' },
      location: { type: 'string' },
      mapRefs: arraySchema(),
      maps: arraySchema(),
      npcRefs: arraySchema(),
      npcs: arraySchema(),
      ragQueries: arraySchema(),
      ragContext: { type: 'object', additionalProperties: true },
      timeConfig: { type: 'object', additionalProperties: true },
      time: { type: 'object', additionalProperties: true },
      structuredInterface: { type: 'object', additionalProperties: true },
      memorySummaryId: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true },
      enteredAt: { type: 'string' },
      endedAt: { type: 'string' }
    },
    required,
    additionalProperties: false
  };
}

function sceneRecordPatchSchema() {
  const schema = sceneRecordSchema();
  delete schema.properties.chatSessionId;
  return schema;
}

function sceneIdentitySchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      id: { type: 'string' },
      sceneId: { type: 'string', default: 'current' }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function listScenesSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      status: { type: 'string' },
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

function mapMountSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sceneId: { type: 'string' },
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
          overrides: { type: 'object', additionalProperties: true },
          metadata: { type: 'object', additionalProperties: true }
        },
        additionalProperties: false
      }
    ]
  };
}

function npcMountSchema() {
  return {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sceneId: { type: 'string' },
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
          importance: { type: 'string' },
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
          overrides: { type: 'object', additionalProperties: true },
          metadata: { type: 'object', additionalProperties: true }
        },
        additionalProperties: false
      }
    ]
  };
}

function ragSchema() {
  return {
    type: 'object',
    properties: {
      query: stringArraySchema(),
      queries: stringArraySchema(),
      collection: stringArraySchema(),
      collections: stringArraySchema(),
      runtimeCollections: stringArraySchema(),
      permanentCollections: stringArraySchema(),
      includePermanent: { type: 'boolean' },
      runtime: { type: 'boolean' },
      permanent: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      minScore: { type: 'number' },
      filter: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function timeInitSchema() {
  return {
    type: 'object',
    properties: {
      initializeClock: { type: 'boolean', default: true },
      advance: { type: 'object', additionalProperties: true },
      encounter: { type: 'object', additionalProperties: true },
      events: { type: 'array', items: { type: 'object', additionalProperties: true } }
    },
    additionalProperties: false
  };
}

function structuredInterfaceSchema() {
  return {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      mode: { type: 'string' },
      source: { type: 'string' },
      rewrite: { type: 'boolean' },
      update: { type: 'object', additionalProperties: true },
      state: { type: 'object', additionalProperties: true },
      endUpdate: { type: 'object', additionalProperties: true },
      clearUpdate: { type: 'object', additionalProperties: true },
      endMode: { type: 'string' }
    },
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
      format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
      status: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    required: ['chatSessionId'],
    additionalProperties: false
  };
}

function arraySchema() {
  return { type: 'array', items: {} };
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
