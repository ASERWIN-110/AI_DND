// @ts-nocheck
import { MapRelationshipGraph } from '../maps/map-relationship-graph.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const MAP_RELATIONSHIP_PLUGIN = {
  id: 'system.map_relationships',
  name: 'Map Relationship Graph Tools',
  version: '0.1.0',
  description: 'Global map relationship graph and scene-aware pathfinding tools for RPG movement.',
  enabled: true,
  permissions: ['map-relationships:read', 'map-relationships:write'],
  tools: [
    {
      name: 'describe_graph',
      title: 'Describe Map Relationship Graph',
      description: 'Describe global map relationship node and edge collections plus scene graph sources.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'graph', 'schema']
    },
    {
      name: 'upsert_node',
      title: 'Create Or Replace Map Node',
      description: 'Create or replace one persistent map graph node. Requires explicit user authorization.',
      inputSchema: nodeInputSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { ...AUTH_METADATA, idempotent: true },
      tags: ['map', 'relationship', 'node', 'write']
    },
    {
      name: 'patch_node',
      title: 'Patch Map Node',
      description: 'Patch one persistent map graph node. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          mapId: { type: 'string' },
          id: { type: 'string' },
          patch: nodePatchSchema()
        },
        required: ['patch'],
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['map', 'relationship', 'node', 'write']
    },
    {
      name: 'delete_node',
      title: 'Delete Map Node',
      description: 'Delete one persistent map graph node. By default this also deletes related edges. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          mapId: { type: 'string' },
          id: { type: 'string' },
          deleteEdges: { type: 'boolean', default: true }
        },
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { ...AUTH_METADATA, destructive: true },
      tags: ['map', 'relationship', 'node', 'delete']
    },
    {
      name: 'get_node',
      title: 'Get Map Node',
      description: 'Get one persistent map graph node by mapId or id.',
      inputSchema: {
        type: 'object',
        properties: {
          mapId: { type: 'string' },
          id: { type: 'string' }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'node', 'query']
    },
    {
      name: 'list_nodes',
      title: 'List Map Nodes',
      description: 'List persistent map graph nodes with tags, text query, and filters.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: { type: 'object', additionalProperties: true },
          tags: stringArraySchema(),
          query: { type: 'string' },
          sort: sortSchema(),
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'node', 'query']
    },
    {
      name: 'upsert_edge',
      title: 'Create Or Replace Map Edge',
      description: 'Create or replace one persistent movement edge between maps or areas. Missing endpoint nodes are auto-created by default. Requires explicit user authorization.',
      inputSchema: edgeInputSchema(),
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { ...AUTH_METADATA, idempotent: true },
      tags: ['map', 'relationship', 'edge', 'write']
    },
    {
      name: 'patch_edge',
      title: 'Patch Map Edge',
      description: 'Patch one persistent map graph edge. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          edgeId: { type: 'string' },
          patch: edgePatchSchema()
        },
        required: ['patch'],
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['map', 'relationship', 'edge', 'write']
    },
    {
      name: 'delete_edge',
      title: 'Delete Map Edge',
      description: 'Delete one persistent map graph edge. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          edgeId: { type: 'string' }
        },
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: { ...AUTH_METADATA, destructive: true },
      tags: ['map', 'relationship', 'edge', 'delete']
    },
    {
      name: 'get_edge',
      title: 'Get Map Edge',
      description: 'Get one persistent map graph edge by id.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          edgeId: { type: 'string' }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'edge', 'query']
    },
    {
      name: 'list_edges',
      title: 'List Map Edges',
      description: 'List persistent movement edges by map, endpoints, relation type, travel mode, difficulty, tags, and query.',
      inputSchema: edgeQuerySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'edge', 'query']
    },
    {
      name: 'traverse_map',
      title: 'Traverse Map Graph',
      description: 'Recursively traverse reachable persistent map nodes from one map using BFS.',
      inputSchema: {
        type: 'object',
        properties: {
          startMapId: { type: 'string' },
          maxDepth: { type: 'integer', minimum: 0, maximum: 12, default: 3 },
          includeBlocked: { type: 'boolean', default: false },
          includeHidden: { type: 'boolean', default: false },
          relationTypes: stringArraySchema(),
          travelModes: stringArraySchema(),
          limit: { type: 'integer', minimum: 1, maximum: 500 }
        },
        required: ['startMapId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'graph', 'recursive', 'query']
    },
    {
      name: 'find_path',
      title: 'Find Global Map Path',
      description: 'Find the lowest-cost path between two persistent map graph nodes.',
      inputSchema: pathSchema(false),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'graph', 'path', 'query']
    },
    {
      name: 'build_scene_graph',
      title: 'Build Scene Movement Graph',
      description: 'Build the merged scene movement graph from global map relationships, mounted maps, and map structured state.',
      inputSchema: sceneGraphSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'scene', 'movement', 'graph', 'debug']
    },
    {
      name: 'find_scene_path',
      title: 'Find Scene Movement Path',
      description: 'Find the lowest-cost movement path inside one chat scene by merging global map edges, scene map mounts, and map_state exits/routes.',
      inputSchema: pathSchema(true),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'scene', 'movement', 'path', 'query']
    },
    {
      name: 'import_document',
      title: 'Import Map Relationship Graph Document',
      description: 'Import persistent map graph nodes and edges from JSON, YAML, or XML. Requires explicit user authorization.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', minLength: 1 },
          format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
          source: { type: 'string', default: 'document-import' }
        },
        required: ['text'],
        additionalProperties: false
      },
      annotations: { requiresUserAuthorization: true },
      visibility: 'public',
      autoCallable: false,
      mutatesState: true,
      metadata: AUTH_METADATA,
      tags: ['map', 'relationship', 'graph', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export Map Relationship Graph Document',
      description: 'Export persistent map graph nodes and edges to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          mapId: { type: 'string' },
          includeBlocked: { type: 'boolean', default: true },
          includeHidden: { type: 'boolean', default: true },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['map', 'relationship', 'graph', 'export', 'json', 'yaml']
    }
  ]
};

export function createMapRelationshipHandlers({ dataManager, appDatabase, graph } = {}) {
  const relationships = graph || new MapRelationshipGraph({ dataManager, appDatabase });
  return {
    describe_graph: async () => relationships.describe(),
    upsert_node: async ({ input }) => relationships.upsertNode(input),
    patch_node: async ({ input }) => relationships.patchNode(input),
    delete_node: async ({ input }) => relationships.deleteNode(input),
    get_node: async ({ input }) => relationships.getNode(input.mapId || input.id),
    list_nodes: async ({ input }) => relationships.listNodes(input),
    upsert_edge: async ({ input }) => relationships.upsertEdge(input),
    patch_edge: async ({ input }) => relationships.patchEdge(input),
    delete_edge: async ({ input }) => relationships.deleteEdge(input),
    get_edge: async ({ input }) => relationships.getEdge(input.id || input.edgeId),
    list_edges: async ({ input }) => relationships.listEdges(input),
    traverse_map: async ({ input }) => relationships.traverseMap(input),
    find_path: async ({ input }) => relationships.findPath(input),
    build_scene_graph: async ({ input }) => relationships.buildSceneGraph(input),
    find_scene_path: async ({ input }) => relationships.findScenePath(input),
    import_document: async ({ input }) => relationships.importDocument(input),
    export_document: async ({ input }) => relationships.exportDocument(input)
  };
}

function nodeInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      mapId: { type: 'string' },
      locationId: { type: 'string' },
      name: { type: 'string' },
      type: { type: 'string' },
      parentMapId: { type: 'string' },
      parentId: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      summary: { type: 'string' },
      description: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function nodePatchSchema() {
  const schema = nodeInputSchema();
  delete schema.properties.id;
  delete schema.properties.mapId;
  delete schema.properties.locationId;
  return schema;
}

function edgeInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      edgeId: { type: 'string' },
      fromMapId: { type: 'string' },
      from: { type: 'string' },
      sourceMapId: { type: 'string' },
      source: { type: 'string' },
      toMapId: { type: 'string' },
      to: { type: 'string' },
      targetMapId: { type: 'string' },
      target: { type: 'string' },
      relationType: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      label: { type: 'string' },
      direction: { type: 'string', enum: ['directed', 'undirected', 'mutual', 'one-way', 'one_way', 'bidirectional', 'bi-directional'] },
      directed: { type: 'boolean' },
      travelMode: { type: 'string' },
      mode: { type: 'string' },
      cost: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      travelCost: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      weight: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      distance: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      difficulty: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      dc: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      status: { type: 'string' },
      visibility: { type: 'string' },
      hidden: { type: 'boolean' },
      requirements: arrayOrObjectSchema(),
      requires: arrayOrObjectSchema(),
      conditions: arrayOrObjectSchema(),
      evidence: { type: 'string' },
      sourceText: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true },
      allowSelfRelation: { type: 'boolean' },
      createMissingNodes: { type: 'boolean' }
    },
    additionalProperties: false
  };
}

function edgePatchSchema() {
  return edgeInputSchema();
}

function edgeQuerySchema() {
  return {
    type: 'object',
    properties: {
      mapId: { type: 'string' },
      fromMapId: { type: 'string' },
      toMapId: { type: 'string' },
      relationType: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      relationTypes: stringArraySchema(),
      travelMode: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      travelModes: stringArraySchema(),
      includeIncoming: { type: 'boolean', default: true },
      includeOutgoing: { type: 'boolean', default: true },
      includeBlocked: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: false },
      maxDifficulty: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function pathSchema(sceneAware) {
  return {
    type: 'object',
    properties: {
      ...(sceneAware ? {
        chatSessionId: { type: 'string' },
        sceneId: { type: 'string', default: 'current' },
        includeGlobal: { type: 'boolean', default: true },
        includeMountedMaps: { type: 'boolean', default: true },
        includeStructuredState: { type: 'boolean', default: true },
        includeParentLinks: { type: 'boolean', default: false },
        includeInactive: { type: 'boolean', default: false }
      } : {}),
      startMapId: { type: 'string' },
      targetMapId: { type: 'string' },
      fromMapId: { type: 'string' },
      toMapId: { type: 'string' },
      startNodeId: { type: 'string' },
      targetNodeId: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      maxDepth: { type: 'integer', minimum: 0, maximum: 32, default: 32 },
      relationType: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      relationTypes: stringArraySchema(),
      travelMode: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      travelModes: stringArraySchema(),
      includeIncoming: { type: 'boolean', default: true },
      includeOutgoing: { type: 'boolean', default: true },
      includeBlocked: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: false },
      maxDifficulty: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      tags: stringArraySchema()
    },
    required: sceneAware ? ['chatSessionId'] : [],
    additionalProperties: false
  };
}

function sceneGraphSchema() {
  return {
    type: 'object',
    properties: {
      chatSessionId: { type: 'string' },
      sceneId: { type: 'string', default: 'current' },
      includeGlobal: { type: 'boolean', default: true },
      includeMountedMaps: { type: 'boolean', default: true },
      includeStructuredState: { type: 'boolean', default: true },
      includeParentLinks: { type: 'boolean', default: false },
      includeInactive: { type: 'boolean', default: false },
      includeBlocked: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: false },
      relationType: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      relationTypes: stringArraySchema(),
      travelMode: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      travelModes: stringArraySchema(),
      maxDifficulty: { anyOf: [{ type: 'number' }, { type: 'string' }] }
    },
    required: ['chatSessionId'],
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
      { type: 'array', items: {} },
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
