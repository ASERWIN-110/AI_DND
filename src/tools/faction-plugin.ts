// @ts-nocheck
import { FactionGraph } from '../factions/faction-graph.js';

const AUTH_METADATA = {
  requiresUserAuthorization: true
};

export const FACTION_PLUGIN = {
  id: 'system.factions',
  name: 'Faction Graph Tools',
  version: '0.1.0',
  description: 'Global faction graph database: large/small factions, faction relations, actor memberships, and faction RAG helpers.',
  enabled: true,
  permissions: ['factions:read', 'factions:write', 'factions:rag'],
  tools: [
    tool('describe_graph', 'Describe Faction Graph', 'Describe faction, relation, and membership collections.', emptySchema(), false, ['faction', 'schema']),
    tool('upsert_faction', 'Create Or Replace Faction', 'Create or replace a faction. Agent and user can both call this directly.', factionInputSchema(), true, ['faction', 'write'], { idempotent: true }),
    tool('patch_faction', 'Patch Faction', 'Patch one faction.', patchSchema('faction'), true, ['faction', 'write']),
    tool('delete_faction', 'Delete Faction', 'Delete one faction and optionally related relations/memberships.', {
      type: 'object',
      properties: {
        factionId: { type: 'string' },
        id: { type: 'string' },
        deleteRelations: { type: 'boolean', default: true },
        deleteMemberships: { type: 'boolean', default: true }
      },
      additionalProperties: false
    }, true, ['faction', 'delete'], { destructive: true }),
    tool('get_faction', 'Get Faction', 'Get one faction by id.', idSchema('factionId'), false, ['faction', 'query']),
    tool('list_factions', 'List Factions', 'List factions with filters, tags, visibility, and query.', listSchema(), false, ['faction', 'query']),

    tool('upsert_relation', 'Create Or Replace Faction Relation', 'Create or replace a relation between two factions.', relationInputSchema(), true, ['faction', 'relation', 'write'], { idempotent: true }),
    tool('patch_relation', 'Patch Faction Relation', 'Patch one faction relation.', patchSchema('relation'), true, ['faction', 'relation', 'write']),
    tool('plan_relation_shift', 'Plan Faction Relation Shift', 'Plan a qualitative faction relation change such as mixed cooperation/conflict, poaching members, indirect pressure, or mutual-survival dependency. Does not mutate state.', relationShiftSchema(false), false, ['faction', 'relation', 'shift', 'plan']),
    tool('apply_relation_shift', 'Apply Faction Relation Shift', 'Apply or dry-run a qualitative faction relation change. Defaults to dryRun=true and treats numeric values as reference hints only.', relationShiftSchema(true), true, ['faction', 'relation', 'shift', 'apply']),
    tool('delete_relation', 'Delete Faction Relation', 'Delete one faction relation.', relationIdSchema(), true, ['faction', 'relation', 'delete'], { destructive: true }),
    tool('get_relation', 'Get Faction Relation', 'Get one faction relation by id.', relationIdSchema(), false, ['faction', 'relation', 'query']),
    tool('list_relations', 'List Faction Relations', 'List faction relations by endpoint, relation type, tags, and query.', relationQuerySchema(), false, ['faction', 'relation', 'query']),

    tool('upsert_membership', 'Create Or Replace Faction Membership', 'Create or replace an actor-to-faction membership record.', membershipInputSchema(), true, ['faction', 'membership', 'write'], { idempotent: true }),
    tool('patch_membership', 'Patch Faction Membership', 'Patch one faction membership.', patchSchema('membership'), true, ['faction', 'membership', 'write']),
    tool('delete_membership', 'Delete Faction Membership', 'Delete one faction membership.', membershipIdSchema(), true, ['faction', 'membership', 'delete'], { destructive: true }),
    tool('get_membership', 'Get Faction Membership', 'Get one faction membership by id.', { type: 'object', properties: { id: { type: 'string' }, membershipId: { type: 'string' } }, additionalProperties: false }, false, ['faction', 'membership', 'query']),
    tool('list_memberships', 'List Faction Memberships', 'List actor/faction memberships by actor, faction, status, tags, and query.', membershipQuerySchema(), false, ['faction', 'membership', 'query']),
    tool('get_actor_factions', 'Get Actor Factions', 'Get all faction memberships for one actor/NPC and hydrate matching faction records.', actorFactionSchema(), false, ['faction', 'membership', 'actor', 'query']),
    tool('get_faction_members', 'Get Faction Members', 'Get all actor memberships for one faction.', factionMembersSchema(), false, ['faction', 'membership', 'members', 'query']),
    tool('plan_actor_influence', 'Plan Actor Influence On Factions', 'Plan reverse influence from an important actor/NPC event onto faction membership, faction numeric values, and optionally faction relations. Does not mutate state.', actorInfluenceSchema(false), false, ['faction', 'actor-influence', 'plan']),
    tool('apply_actor_influence', 'Apply Actor Influence On Factions', 'Apply or dry-run reverse influence from an important actor/NPC event onto factions. Defaults to dryRun=true.', actorInfluenceSchema(true), true, ['faction', 'actor-influence', 'apply']),
    tool('traverse_relations', 'Traverse Faction Relations', 'Recursively traverse the faction graph from one faction using BFS.', traverseSchema(), false, ['faction', 'graph', 'recursive', 'query']),
    tool('find_relation_path', 'Find Faction Relation Path', 'Find a relation path between two factions.', findPathSchema(), false, ['faction', 'graph', 'path', 'query']),

    tool('import_document', 'Import Faction Graph Document', 'Import factions, relations, and memberships from JSON, YAML, or XML.', importSchema(), true, ['faction', 'import', 'json', 'yaml', 'xml']),
    tool('export_document', 'Export Faction Graph Document', 'Export factions, relations, and memberships to JSON or YAML.', exportSchema(), false, ['faction', 'export', 'json', 'yaml']),
    tool('build_rag_documents', 'Build Faction RAG Documents', 'Build readable faction graph documents for RAG indexing without mutating vector stores.', ragDocumentSchema(), false, ['faction', 'rag', 'build']),
    tool('remember_runtime_rag', 'Remember Factions In Runtime RAG', 'Index faction graph documents into runtime RAG for agent recall.', {
      type: 'object',
      properties: {
        collection: { type: 'string', default: 'runtime-factions' },
        factionId: { type: 'string' },
        actorId: { type: 'string' },
        query: { type: 'string' },
        includeHidden: { type: 'boolean', default: false },
        includeArchived: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      },
      additionalProperties: false
    }, true, ['faction', 'rag', 'runtime']),
    {
      ...tool('index_permanent_rag', 'Index Factions In Permanent RAG', 'User-authorized indexing of faction graph documents into permanent RAG.', {
        type: 'object',
        properties: {
          collection: { type: 'string', default: 'permanent-factions' },
          factionId: { type: 'string' },
          actorId: { type: 'string' },
          query: { type: 'string' },
          includeHidden: { type: 'boolean', default: false },
          includeArchived: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 500 }
        },
        additionalProperties: false
      }, true, ['faction', 'rag', 'permanent'], AUTH_METADATA),
      annotations: { requiresUserAuthorization: true },
      autoCallable: false
    },
    tool('search_rag', 'Search Faction RAG', 'Search runtime and/or permanent faction RAG collections.', {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        runtimeCollection: { type: 'string', default: 'runtime-factions' },
        permanentCollection: { type: 'string', default: 'permanent-factions' },
        layer: { type: 'string', enum: ['both', 'runtime', 'permanent'], default: 'both' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
        minScore: { type: 'number' },
        filter: { type: 'object', additionalProperties: true }
      },
      required: ['query'],
      additionalProperties: false
    }, false, ['faction', 'rag', 'search'])
  ]
};

export function createFactionHandlers({ dataManager, graph, runtimeRagService, permanentRagService } = {}) {
  const factions = graph || new FactionGraph({ dataManager });
  return {
    describe_graph: async () => factions.describe(),
    upsert_faction: async ({ input }) => factions.upsertFaction(input),
    patch_faction: async ({ input }) => factions.patchFaction(input),
    delete_faction: async ({ input }) => factions.deleteFaction(input),
    get_faction: async ({ input }) => factions.getFaction(input.factionId || input.id),
    list_factions: async ({ input }) => factions.listFactions(input),
    upsert_relation: async ({ input }) => factions.upsertRelation(input),
    patch_relation: async ({ input }) => factions.patchRelation(input),
    plan_relation_shift: async ({ input }) => factions.planRelationShift(input),
    apply_relation_shift: async ({ input }) => factions.applyRelationShift(input),
    delete_relation: async ({ input }) => factions.deleteRelation(input),
    get_relation: async ({ input }) => factions.getRelation(input.id || input.edgeId || input.relationId),
    list_relations: async ({ input }) => factions.listRelations(input),
    upsert_membership: async ({ input }) => factions.upsertMembership(input),
    patch_membership: async ({ input }) => factions.patchMembership(input),
    delete_membership: async ({ input }) => factions.deleteMembership(input),
    get_membership: async ({ input }) => factions.getMembership(input.id || input.membershipId),
    list_memberships: async ({ input }) => factions.listMemberships(input),
    get_actor_factions: async ({ input }) => factions.getActorFactions(input),
    get_faction_members: async ({ input }) => factions.getFactionMembers(input),
    plan_actor_influence: async ({ input }) => factions.planActorInfluence(input),
    apply_actor_influence: async ({ input }) => factions.applyActorInfluence(input),
    traverse_relations: async ({ input }) => factions.traverseRelations(input),
    find_relation_path: async ({ input }) => factions.findRelationPath(input),
    import_document: async ({ input }) => factions.importDocument(input),
    export_document: async ({ input }) => factions.exportDocument(input),
    build_rag_documents: async ({ input }) => factions.buildRagDocuments(input),
    remember_runtime_rag: async ({ input }) => ingestFactionDocuments(runtimeRagService, factions.buildRagDocuments(input), {
      collection: input.collection || 'runtime-factions'
    }),
    index_permanent_rag: async ({ input }) => ingestFactionDocuments(permanentRagService, factions.buildRagDocuments(input), {
      collection: input.collection || 'permanent-factions'
    }),
    search_rag: async ({ input }) => searchFactionRag({ input, runtimeRagService, permanentRagService })
  };
}

async function ingestFactionDocuments(service, built, { collection }) {
  if (!service || typeof service.ingestText !== 'function') throw unavailable('Faction RAG service is not configured');
  const ingested = [];
  for (const document of built.documents) {
    ingested.push(...await service.ingestText({
      collection,
      sourceId: document.sourceId,
      text: document.text,
      metadata: document.metadata
    }));
  }
  return {
    collection,
    sourceDocuments: built.count,
    chunks: ingested.length,
    documents: ingested
  };
}

async function searchFactionRag({ input, runtimeRagService, permanentRagService }) {
  const limit = input.limit || 5;
  const minScore = input.minScore ?? 0.15;
  const output = { query: input.query, runtime: undefined, permanent: undefined };
  if ((input.layer || 'both') !== 'permanent' && runtimeRagService) {
    output.runtime = await runtimeRagService.retrieve({
      collection: input.runtimeCollection || 'runtime-factions',
      query: input.query,
      limit,
      minScore,
      filter: input.filter
    });
  }
  if ((input.layer || 'both') !== 'runtime' && permanentRagService) {
    output.permanent = await permanentRagService.retrieve({
      collection: input.permanentCollection || 'permanent-factions',
      query: input.query,
      limit,
      minScore,
      filter: input.filter
    });
  }
  if (!output.runtime && !output.permanent) throw unavailable('No faction RAG service is configured');
  return output;
}

function tool(name, title, description, inputSchema, mutatesState, tags, metadata = {}) {
  return {
    name,
    title,
    description,
    inputSchema,
    visibility: 'public',
    autoCallable: true,
    mutatesState,
    metadata,
    tags
  };
}

function factionInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      factionId: { type: 'string' },
      name: { type: 'string' },
      kind: { type: 'string' },
      type: { type: 'string' },
      scale: { type: 'string' },
      parentFactionId: { type: 'string' },
      parentId: { type: 'string' },
      status: { type: 'string' },
      visibility: { type: 'string' },
      coreInterests: arrayOrObjectSchema(),
      interests: arrayOrObjectSchema(),
      goals: arrayOrObjectSchema(),
      resources: arrayOrObjectSchema(),
      territories: stringArraySchema(),
      leaders: stringArraySchema(),
      values: numericObjectSchema(),
      tags: stringArraySchema(),
      aliases: stringArraySchema(),
      summary: { type: 'string' },
      description: { type: 'string' },
      publicFace: { type: 'string' },
      secrets: arrayOrObjectSchema(),
      metadata: { type: 'object', additionalProperties: true }
    },
    additionalProperties: false
  };
}

function relationInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      edgeId: { type: 'string' },
      relationId: { type: 'string' },
      fromFactionId: { type: 'string' },
      from: { type: 'string' },
      sourceFactionId: { type: 'string' },
      source: { type: 'string' },
      toFactionId: { type: 'string' },
      to: { type: 'string' },
      targetFactionId: { type: 'string' },
      target: { type: 'string' },
      relationType: { type: 'string' },
      type: { type: 'string' },
      kind: { type: 'string' },
      label: { type: 'string' },
      direction: { type: 'string' },
      directed: { type: 'boolean' },
      weight: numberOrStringSchema(),
      strength: numberOrStringSchema(),
      influence: numberOrStringSchema(),
      trust: numberOrStringSchema(),
      tension: numberOrStringSchema(),
      aspects: arrayOrObjectSchema(),
      stances: arrayOrObjectSchema(),
      facets: arrayOrObjectSchema(),
      relationAspects: arrayOrObjectSchema(),
      sharedInterests: arrayOrObjectSchema(),
      cooperation: arrayOrObjectSchema(),
      alignedInterests: arrayOrObjectSchema(),
      conflictingInterests: arrayOrObjectSchema(),
      conflicts: arrayOrObjectSchema(),
      opposition: arrayOrObjectSchema(),
      leverage: arrayOrObjectSchema(),
      blackmail: arrayOrObjectSchema(),
      pressureLeverage: arrayOrObjectSchema(),
      dependencies: arrayOrObjectSchema(),
      dependency: arrayOrObjectSchema(),
      mutualDependencies: arrayOrObjectSchema(),
      sharedRisks: arrayOrObjectSchema(),
      activeStrategies: arrayOrObjectSchema(),
      strategies: arrayOrObjectSchema(),
      tactics: arrayOrObjectSchema(),
      activePressures: arrayOrObjectSchema(),
      pressures: arrayOrObjectSchema(),
      flashpoints: arrayOrObjectSchema(),
      changeLog: arrayOrObjectSchema(),
      history: arrayOrObjectSchema(),
      recentShifts: arrayOrObjectSchema(),
      decisionNotes: { type: 'string' },
      qualitativeNotes: { type: 'string' },
      notes: { type: 'string' },
      status: { type: 'string' },
      visibility: { type: 'string' },
      hidden: { type: 'boolean' },
      coreConflict: { type: 'string' },
      conflict: { type: 'string' },
      reason: { type: 'string' },
      evidence: { type: 'string' },
      sourceText: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true },
      allowSelfRelation: { type: 'boolean' },
      createMissingFactions: { type: 'boolean' }
    },
    additionalProperties: false
  };
}

function membershipInputSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      membershipId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      characterId: { type: 'string' },
      actorName: { type: 'string' },
      name: { type: 'string' },
      actorType: { type: 'string' },
      type: { type: 'string' },
      isPlayer: { type: 'boolean' },
      factionId: { type: 'string' },
      faction: { type: 'string' },
      organizationId: { type: 'string' },
      role: { type: 'string' },
      position: { type: 'string' },
      rank: { type: 'string' },
      status: { type: 'string' },
      loyalty: numberOrStringSchema(),
      influence: numberOrStringSchema(),
      reasons: arrayOrObjectSchema(),
      reason: arrayOrObjectSchema(),
      why: arrayOrObjectSchema(),
      obligations: arrayOrObjectSchema(),
      duties: arrayOrObjectSchema(),
      benefits: arrayOrObjectSchema(),
      visibility: { type: 'string' },
      hidden: { type: 'boolean' },
      evidence: { type: 'string' },
      sourceText: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      tags: stringArraySchema(),
      metadata: { type: 'object', additionalProperties: true },
      createMissingFaction: { type: 'boolean' }
    },
    additionalProperties: false
  };
}

function patchSchema(kind) {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      edgeId: { type: 'string' },
      relationId: { type: 'string' },
      membershipId: { type: 'string' },
      factionId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      patch: kind === 'faction' ? factionInputSchema() : (kind === 'relation' ? relationInputSchema() : membershipInputSchema())
    },
    required: ['patch'],
    additionalProperties: false
  };
}

function listSchema() {
  return {
    type: 'object',
    properties: {
      filter: { type: 'object', additionalProperties: true },
      tags: stringArraySchema(),
      query: { type: 'string' },
      includeHidden: { type: 'boolean', default: true },
      sort: sortSchema(),
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function relationQuerySchema() {
  return {
    type: 'object',
    properties: {
      factionId: { type: 'string' },
      fromFactionId: { type: 'string' },
      toFactionId: { type: 'string' },
      relationType: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
      relationTypes: stringArraySchema(),
      includeIncoming: { type: 'boolean', default: true },
      includeOutgoing: { type: 'boolean', default: true },
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true },
      minWeight: numberOrStringSchema(),
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

function relationShiftSchema(allowPlan) {
  return {
    type: 'object',
    properties: {
      ...(allowPlan ? { plan: { type: 'object', additionalProperties: true } } : {}),
      planId: { type: 'string' },
      id: { type: 'string' },
      edgeId: { type: 'string' },
      relationId: { type: 'string' },
      fromFactionId: { type: 'string' },
      from: { type: 'string' },
      sourceFactionId: { type: 'string' },
      source: { type: 'string' },
      toFactionId: { type: 'string' },
      to: { type: 'string' },
      targetFactionId: { type: 'string' },
      target: { type: 'string' },
      relationType: { type: 'string' },
      nextRelationType: { type: 'string' },
      type: { type: 'string' },
      eventType: { type: 'string' },
      tactic: { type: 'string' },
      strategy: { type: 'string' },
      eventText: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      evidence: { type: 'string' },
      mode: { type: 'string', enum: ['append', 'replace'], default: 'append' },
      label: { type: 'string' },
      status: { type: 'string' },
      visibility: { type: 'string' },
      coreConflict: { type: 'string' },
      conflict: { type: 'string' },
      summary: { type: 'string' },
      description: { type: 'string' },
      decisionNotes: { type: 'string' },
      qualitativeNotes: { type: 'string' },
      notes: { type: 'string' },
      relationDeltas: numericObjectSchema(),
      numericDeltas: numericObjectSchema(),
      valueDeltas: numericObjectSchema(),
      aspects: arrayOrObjectSchema(),
      stances: arrayOrObjectSchema(),
      facets: arrayOrObjectSchema(),
      sharedInterests: arrayOrObjectSchema(),
      cooperation: arrayOrObjectSchema(),
      alignedInterests: arrayOrObjectSchema(),
      conflictingInterests: arrayOrObjectSchema(),
      conflicts: arrayOrObjectSchema(),
      opposition: arrayOrObjectSchema(),
      leverage: arrayOrObjectSchema(),
      blackmail: arrayOrObjectSchema(),
      pressureLeverage: arrayOrObjectSchema(),
      dependencies: arrayOrObjectSchema(),
      dependency: arrayOrObjectSchema(),
      mutualDependencies: arrayOrObjectSchema(),
      sharedRisks: arrayOrObjectSchema(),
      activeStrategies: arrayOrObjectSchema(),
      strategies: arrayOrObjectSchema(),
      tactics: arrayOrObjectSchema(),
      activePressures: arrayOrObjectSchema(),
      pressures: arrayOrObjectSchema(),
      flashpoints: arrayOrObjectSchema(),
      tags: stringArraySchema(),
      createIfMissing: { type: 'boolean', default: false },
      createMissingFactions: { type: 'boolean', default: true },
      ...(allowPlan ? { dryRun: { type: 'boolean', default: true } } : {})
    },
    additionalProperties: false
  };
}

function membershipQuerySchema() {
  return {
    type: 'object',
    properties: {
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      factionId: { type: 'string' },
      status: { type: 'string' },
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true },
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

function traverseSchema() {
  return {
    type: 'object',
    properties: {
      startFactionId: { type: 'string' },
      factionId: { type: 'string' },
      maxDepth: { type: 'integer', minimum: 0, maximum: 8, default: 2 },
      relationTypes: stringArraySchema(),
      includeIncoming: { type: 'boolean', default: true },
      includeOutgoing: { type: 'boolean', default: true },
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 }
    },
    additionalProperties: false
  };
}

function findPathSchema() {
  return {
    type: 'object',
    properties: {
      startFactionId: { type: 'string' },
      targetFactionId: { type: 'string' },
      maxDepth: { type: 'integer', minimum: 0, maximum: 8, default: 4 },
      relationTypes: stringArraySchema(),
      includeIncoming: { type: 'boolean', default: true },
      includeOutgoing: { type: 'boolean', default: true },
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true }
    },
    required: ['startFactionId', 'targetFactionId'],
    additionalProperties: false
  };
}

function actorFactionSchema() {
  return {
    type: 'object',
    properties: {
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 }
    },
    additionalProperties: false
  };
}

function factionMembersSchema() {
  return {
    type: 'object',
    properties: {
      factionId: { type: 'string' },
      id: { type: 'string' },
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 }
    },
    additionalProperties: false
  };
}

function actorInfluenceSchema(allowPlan) {
  return {
    type: 'object',
    properties: {
      ...(allowPlan ? { plan: { type: 'object', additionalProperties: true } } : {}),
      planId: { type: 'string' },
      id: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      actorName: { type: 'string' },
      eventText: { type: 'string' },
      sourceText: { type: 'string' },
      text: { type: 'string' },
      content: { type: 'string' },
      impactType: { type: 'string', default: 'event' },
      type: { type: 'string' },
      magnitude: numberOrStringSchema(),
      severity: numberOrStringSchema(),
      importance: numberOrStringSchema(),
      factionId: { type: 'string' },
      factionIds: stringArraySchema(),
      targetFactionIds: stringArraySchema(),
      includeArchived: { type: 'boolean', default: false },
      includeHidden: { type: 'boolean', default: true },
      factionValueDeltas: numericObjectSchema(),
      valueDeltas: numericObjectSchema(),
      membershipDeltas: numericObjectSchema(),
      relationDeltas: numericObjectSchema(),
      membershipStatus: { type: 'string' },
      factionStatus: { type: 'string' },
      visibility: { type: 'string' },
      evidence: { type: 'string' },
      summary: { type: 'string' },
      note: { type: 'string' },
      reason: { type: 'string' },
      tags: stringArraySchema(),
      propagateRelations: { type: 'boolean', default: false },
      relationTypes: stringArraySchema(),
      maxRelations: { type: 'integer', minimum: 1, maximum: 500 },
      ...(allowPlan ? { dryRun: { type: 'boolean', default: true } } : {})
    },
    additionalProperties: false
  };
}

function importSchema() {
  return {
    type: 'object',
    properties: {
      text: { type: 'string', minLength: 1 },
      format: { type: 'string', enum: ['auto', 'json', 'yaml', 'yml', 'xml'], default: 'auto' },
      source: { type: 'string', default: 'document-import' }
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
      factionId: { type: 'string' },
      actorId: { type: 'string' },
      query: { type: 'string' },
      includeHidden: { type: 'boolean', default: true },
      includeArchived: { type: 'boolean', default: true },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  };
}

function ragDocumentSchema() {
  return {
    type: 'object',
    properties: {
      factionId: { type: 'string' },
      actorId: { type: 'string' },
      query: { type: 'string' },
      includeHidden: { type: 'boolean', default: false },
      includeArchived: { type: 'boolean', default: false },
      limit: { type: 'integer', minimum: 1, maximum: 500 }
    },
    additionalProperties: false
  };
}

function idSchema(name) {
  return {
    type: 'object',
    properties: {
      [name]: { type: 'string' },
      id: { type: 'string' }
    },
    additionalProperties: false
  };
}

function relationIdSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      edgeId: { type: 'string' },
      relationId: { type: 'string' }
    },
    additionalProperties: false
  };
}

function membershipIdSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      membershipId: { type: 'string' },
      actorId: { type: 'string' },
      npcId: { type: 'string' },
      factionId: { type: 'string' }
    },
    additionalProperties: false
  };
}

function emptySchema() {
  return { type: 'object', properties: {}, additionalProperties: false };
}

function stringArraySchema() {
  return { anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] };
}

function numberOrStringSchema() {
  return { anyOf: [{ type: 'number' }, { type: 'string' }] };
}

function numericObjectSchema() {
  return {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'number' },
        { type: 'string' }
      ]
    }
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

function unavailable(message) {
  const error = new Error(message);
  error.name = 'FactionRagUnavailableError';
  error.statusCode = 503;
  return error;
}
