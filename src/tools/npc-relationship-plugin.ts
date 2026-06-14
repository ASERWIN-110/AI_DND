// @ts-nocheck
import { NpcRelationshipGraph } from '../npcs/npc-relationship-graph.js';

export const NPC_RELATIONSHIP_PLUGIN = {
  id: 'system.npc_relationships',
  name: 'NPC Relationship Graph Tools',
  version: '0.1.0',
  description: 'Global NPC relationship graph database with node/edge CRUD, recursive traversal, and path finding.',
  enabled: true,
  permissions: ['npc-relationships:read', 'npc-relationships:write'],
  tools: [
    {
      name: 'describe_graph',
      title: 'Describe NPC Relationship Graph',
      description: 'Describe relationship graph node and edge collections plus synchronized schema files.',
      inputSchema: emptySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'relationship', 'graph', 'schema']
    },
    {
      name: 'upsert_node',
      title: 'Create Or Replace Relationship Node',
      description: 'Create or replace one NPC relationship graph node. Agent and user can both call this directly.',
      inputSchema: nodeInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        idempotent: true
      },
      tags: ['npc', 'relationship', 'node', 'write']
    },
    {
      name: 'patch_node',
      title: 'Patch Relationship Node',
      description: 'Patch one NPC relationship graph node.',
      inputSchema: {
        type: 'object',
        properties: {
          npcId: { type: 'string' },
          id: { type: 'string' },
          patch: nodePatchSchema()
        },
        required: ['patch'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['npc', 'relationship', 'node', 'write']
    },
    {
      name: 'delete_node',
      title: 'Delete Relationship Node',
      description: 'Delete one NPC relationship graph node. By default this also deletes related edges.',
      inputSchema: {
        type: 'object',
        properties: {
          npcId: { type: 'string' },
          id: { type: 'string' },
          deleteEdges: { type: 'boolean', default: true }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        destructive: true
      },
      tags: ['npc', 'relationship', 'node', 'delete']
    },
    {
      name: 'get_node',
      title: 'Get Relationship Node',
      description: 'Get one NPC relationship graph node.',
      inputSchema: {
        type: 'object',
        properties: {
          npcId: { type: 'string' },
          id: { type: 'string' }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'relationship', 'node', 'query']
    },
    {
      name: 'list_nodes',
      title: 'List Relationship Nodes',
      description: 'List NPC relationship graph nodes with tags, text query, and filters.',
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
      tags: ['npc', 'relationship', 'node', 'query']
    },
    {
      name: 'upsert_edge',
      title: 'Create Or Replace Relationship Edge',
      description: 'Create or replace one relationship edge between two NPCs. Missing endpoint nodes are auto-created by default.',
      inputSchema: edgeInputSchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      metadata: {
        idempotent: true
      },
      tags: ['npc', 'relationship', 'edge', 'write']
    },
    {
      name: 'patch_edge',
      title: 'Patch Relationship Edge',
      description: 'Patch one relationship edge.',
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
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['npc', 'relationship', 'edge', 'write']
    },
    {
      name: 'delete_edge',
      title: 'Delete Relationship Edge',
      description: 'Delete one relationship edge.',
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
      mutatesState: true,
      metadata: {
        destructive: true
      },
      tags: ['npc', 'relationship', 'edge', 'delete']
    },
    {
      name: 'get_edge',
      title: 'Get Relationship Edge',
      description: 'Get one relationship edge by id.',
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
      tags: ['npc', 'relationship', 'edge', 'query']
    },
    {
      name: 'list_edges',
      title: 'List Relationship Edges',
      description: 'List relationship edges by npcId, endpoints, relation type, tags, query, and direction options.',
      inputSchema: edgeQuerySchema(),
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'relationship', 'edge', 'query']
    },
    {
      name: 'traverse_relations',
      title: 'Traverse NPC Relationships Recursively',
      description: 'Recursively traverse the NPC relationship graph from one NPC up to maxDepth using BFS. Use this instead of repeated manual tool calls.',
      inputSchema: {
        type: 'object',
        properties: {
          startNpcId: { type: 'string' },
          maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 2 },
          relationTypes: stringArraySchema(),
          includeIncoming: { type: 'boolean', default: true },
          includeOutgoing: { type: 'boolean', default: true },
          includeArchived: { type: 'boolean', default: false },
          minWeight: { anyOf: [{ type: 'number' }, { type: 'string' }] },
          limit: { type: 'integer', minimum: 1, maximum: 500 }
        },
        required: ['startNpcId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'relationship', 'graph', 'recursive', 'query']
    },
    {
      name: 'find_path',
      title: 'Find NPC Relationship Path',
      description: 'Find a relationship path between two NPCs with recursive BFS up to maxDepth.',
      inputSchema: {
        type: 'object',
        properties: {
          startNpcId: { type: 'string' },
          targetNpcId: { type: 'string' },
          maxDepth: { type: 'integer', minimum: 0, maximum: 6, default: 4 },
          relationTypes: stringArraySchema(),
          includeIncoming: { type: 'boolean', default: true },
          includeOutgoing: { type: 'boolean', default: true },
          includeArchived: { type: 'boolean', default: false },
          minWeight: { anyOf: [{ type: 'number' }, { type: 'string' }] }
        },
        required: ['startNpcId', 'targetNpcId'],
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'relationship', 'graph', 'path', 'recursive', 'query']
    },
    {
      name: 'import_document',
      title: 'Import NPC Relationship Graph Document',
      description: 'Import NPC relationship graph nodes and edges from JSON, YAML, or XML.',
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
      visibility: 'public',
      autoCallable: true,
      mutatesState: true,
      tags: ['npc', 'relationship', 'graph', 'import', 'json', 'yaml', 'xml']
    },
    {
      name: 'export_document',
      title: 'Export NPC Relationship Graph Document',
      description: 'Export NPC relationship graph nodes and edges to JSON or YAML.',
      inputSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'yaml', 'yml'], default: 'json' },
          npcId: { type: 'string' },
          relationTypes: stringArraySchema(),
          includeArchived: { type: 'boolean', default: true },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 500 },
          offset: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      },
      visibility: 'public',
      autoCallable: true,
      mutatesState: false,
      tags: ['npc', 'relationship', 'graph', 'export', 'json', 'yaml']
    }
  ]
};

export function createNpcRelationshipHandlers({ dataManager, graph } = {}) {
  const relationships = graph || new NpcRelationshipGraph({ dataManager });
  return {
    describe_graph: async () => relationships.describe(),
    upsert_node: async ({ input }) => relationships.upsertNode(input),
    patch_node: async ({ input }) => relationships.patchNode(input),
    delete_node: async ({ input }) => relationships.deleteNode(input),
    get_node: async ({ input }) => relationships.getNode(input.npcId || input.id),
    list_nodes: async ({ input }) => relationships.listNodes(input),
    upsert_edge: async ({ input }) => relationships.upsertEdge(input),
    patch_edge: async ({ input }) => relationships.patchEdge(input),
    delete_edge: async ({ input }) => relationships.deleteEdge(input),
    get_edge: async ({ input }) => relationships.getEdge(input.id || input.edgeId),
    list_edges: async ({ input }) => relationships.listEdges(input),
    traverse_relations: async ({ input }) => relationships.traverseRelations(input),
    find_path: async ({ input }) => relationships.findPath(input),
    import_document: async ({ input }) => relationships.importDocument(input),
    export_document: async ({ input }) => relationships.exportDocument(input)
  };
}

function nodeInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      npcId: { type: 'string' },
      name: { type: 'string' },
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      summary: { type: 'string' },
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function nodePatchSchema() {
  const schema = nodeInputSchema();
  delete schema.properties.id;
  delete schema.properties.npcId;
  return schema;
}

function edgeInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      edgeId: { type: 'string' },
      fromNpcId: { type: 'string' },
      from: { type: 'string' },
      sourceNpcId: { type: 'string' },
      source: { type: 'string' },
      toNpcId: { type: 'string' },
      to: { type: 'string' },
      targetNpcId: { type: 'string' },
      target: { type: 'string' },
      relationType: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      label: { type: 'string' },
      direction: { type: 'string', enum: ['directed', 'undirected', 'mutual', 'one-way', 'one_way', 'bidirectional', 'bi-directional'] },
      directed: { type: 'boolean' },
      weight: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      strength: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      attitude: { type: 'string' },
      trust: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      familiarity: { anyOf: [{ type: 'number' }, { type: 'string' }] },
      status: { type: 'string' },
      visibility: { type: 'string' },
      evidence: { type: 'string' },
      sourceText: { type: 'string' },
      summary: { type: 'string' },
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
      npcId: { type: 'string' },
      fromNpcId: { type: 'string' },
      toNpcId: { type: 'string' },
      relationType: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      relationTypes: stringArraySchema(),
      includeIncoming: { type: 'boolean', default: true },
      includeOutgoing: { type: 'boolean', default: true },
      includeArchived: { type: 'boolean', default: false },
      minWeight: { anyOf: [{ type: 'number' }, { type: 'string' }] },
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
