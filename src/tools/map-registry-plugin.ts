// @ts-nocheck
import { MapRegistry } from '../maps/map-registry.js';
import { lifecycleSchemaProperties } from '../lifecycle/resource-lifecycle.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const MAP_REGISTRY_PLUGIN = {
  id: 'system.map_registry',
  name: 'Map Registry Tools',
  version: '0.1.0',
  description: 'L0 map/location registry for scene mounting: id, name, type, parent, tags, summary, and references.',
  enabled: true,
  permissions: ['map-registry:read', 'map-registry:write'],
  tools: [
    {
      name: 'list_maps',
      title: 'List Maps',
      description: 'List L0 map registry entries with optional filters, tags, and text query.',
      inputSchema: listSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'registry', 'query']
    },
    {
      name: 'get_map',
      title: 'Get Map',
      description: 'Get one L0 map registry entry by id.',
      inputSchema: idSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'registry', 'query']
    },
    {
      name: 'upsert_map',
      title: 'Create Or Replace Map',
      description: 'Create or replace one L0 map registry entry. Requires explicit user authorization.',
      inputSchema: mapInputSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['map', 'registry', 'write']
    },
    {
      name: 'patch_map',
      title: 'Patch Map',
      description: 'Patch an existing L0 map registry entry. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          patch: mapPatchSchema()
        },
        required: ['id', 'patch'],
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['map', 'registry', 'write']
    },
    {
      name: 'delete_map',
      title: 'Delete Map',
      description: 'Delete one L0 map registry entry. Requires explicit user authorization.',
      inputSchema: idSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: {
        ...AUTH_METADATA,
        destructive: true
      },
      tags: ['map', 'registry', 'delete']
    },
    {
      name: 'import_document',
      title: 'Import Map Registry Document',
      description: 'Import L0 map registry entries from JSON, YAML, or XML. Requires explicit user authorization.',
      inputSchema: importSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['map', 'registry', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Map Registry Document',
      description: 'Export L0 map registry entries to JSON or YAML.',
      inputSchema: exportSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'registry', 'export', 'json', 'yaml']
    },
    {
      name: 'describe_registry',
      title: 'Describe Map Registry',
      description: 'Describe the underlying map registry collection and synchronized schema file.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'registry', 'schema']
    }
  ]
};

export function createMapRegistryHandlers({ dataManager, registry, appDatabase } = {}) {
  const mapRegistry = registry || new MapRegistry({ dataManager, appDatabase });
  return {
    list_maps: async ({ input }) => mapRegistry.listMaps(input),
    get_map: async ({ input }) => mapRegistry.getMap(input.id),
    upsert_map: async ({ input }) => mapRegistry.upsertMap(input),
    patch_map: async ({ input }) => mapRegistry.patchMap(input.id, input.patch),
    delete_map: async ({ input }) => mapRegistry.deleteMap(input.id),
    import_document: async ({ input }) => mapRegistry.importDocument(input),
    export_document: async ({ input }) => mapRegistry.exportDocument(input),
    describe_registry: async () => mapRegistry.describe()
  };
}

function mapInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      mapId: { type: 'string' },
      locationId: { type: 'string' },
      name: { type: 'string' },
      type: mapTypeSchema(),
      parentMapId: { type: 'string' },
      parentId: { type: 'string' },
      regionId: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      summary: { type: 'string' },
      description: { type: 'string' },
      text: { type: 'string' },
      environment: { type: 'object', additionalProperties: true },
      factionRefs: stringArraySchema(),
      factions: stringArraySchema(),
      npcRefs: stringArraySchema(),
      npcs: stringArraySchema(),
      entryPoints: arrayOrObjectSchema(),
      entries: arrayOrObjectSchema(),
      exits: arrayOrObjectSchema(),
      status: { type: 'string' },
      ...mapVisualSchemaProperties(),
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

function mapVisualSchemaProperties() {
  return {
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
    media: {}
  };
}

function mapPatchSchema() {
  const schema = mapInputSchema();
  delete schema.required;
  return schema;
}

function listSchema() {
  return {
    type: 'object',
    properties: {
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
      ...lifecycleSchemaProperties()
    },
    additionalProperties: false
  };
}

function idSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' }
    },
    required: ['id'],
    additionalProperties: false
  };
}

function importSchema() {
  return {
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
  };
}

function exportSchema() {
  return {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function emptySchema() {
  return {
    type: 'object',
    properties: {},
    additionalProperties: false
  };
}

function mapTypeSchema() {
  return {
    type: 'string',
    enum: ['world', 'region', 'city', 'district', 'building', 'room', 'dungeon', 'encounter', 'area', 'route', 'landmark']
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

function arrayOrObjectSchema() {
  return {
    anyOf: [
      { type: 'array', items: { type: 'object', additionalProperties: true } },
      { type: 'object', additionalProperties: true },
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
