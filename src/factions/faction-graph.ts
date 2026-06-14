// @ts-nocheck
import YAML from 'yaml';
import { parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';

export const FACTION_NODE_COLLECTION = 'faction_nodes';
export const FACTION_EDGE_COLLECTION = 'faction_edges';
export const FACTION_MEMBERSHIP_COLLECTION = 'faction_memberships';

export const FACTION_NODE_FIELDS = [
  { name: 'factionId', type: 'text', description: 'Stable faction id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'kind', type: 'text', description: 'guild, cult, family, state, gang, church, company, cell, faction, etc.' },
  { name: 'scale', type: 'text', description: 'individual, cell, local, regional, national, planar, cosmic, etc.' },
  { name: 'parentFactionId', type: 'text', description: 'Optional parent faction id.' },
  { name: 'status', type: 'text', description: 'active, hidden, collapsed, dissolved, dormant, etc.' },
  { name: 'visibility', type: 'text', description: 'known, suspected, secret, hidden, public, etc.' },
  { name: 'coreInterests', type: 'json', description: 'Core interests, needs, fears, and priorities.' },
  { name: 'goals', type: 'json', description: 'Current goals or agendas.' },
  { name: 'resources', type: 'json', description: 'Money, territory, magic, manpower, influence, assets.' },
  { name: 'territories', type: 'json', description: 'Controlled or contested places.' },
  { name: 'leaders', type: 'json', description: 'Leader actor ids or names.' },
  { name: 'values', type: 'json', description: 'Numeric faction state, e.g. reputation, stability, morale, alertLevel, resourcePressure.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'summary', type: 'text', description: 'Short faction summary.' },
  { name: 'publicFace', type: 'text', description: 'What outsiders usually know or believe.' },
  { name: 'secrets', type: 'json', description: 'Hidden truths; filter from player-visible output in UI if needed.' },
  { name: 'metadata', type: 'json', description: 'Extra faction metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest faction graph update timestamp.' }
];

export const FACTION_EDGE_FIELDS = [
  { name: 'fromFactionId', type: 'text', description: 'Source faction id.' },
  { name: 'toFactionId', type: 'text', description: 'Target faction id.' },
  { name: 'relationType', type: 'text', description: 'ally, enemy, contains, overlaps, neutral, rival, vassal, patron, etc.' },
  { name: 'label', type: 'text', description: 'Human-readable relation label.' },
  { name: 'direction', type: 'text', description: 'directed, undirected, or mutual.' },
  { name: 'weight', type: 'number', description: 'Generic relation strength, usually -100..100 or 0..100.' },
  { name: 'influence', type: 'number', description: 'Influence exerted through this relation.' },
  { name: 'trust', type: 'number', description: 'Optional trust score.' },
  { name: 'tension', type: 'number', description: 'Optional tension score.' },
  { name: 'aspects', type: 'json', description: 'Multiple simultaneous relation aspects, e.g. cooperation, rivalry, dependency, infiltration, public alliance/private hostility.' },
  { name: 'sharedInterests', type: 'json', description: 'Reasons they cooperate: shared enemies, trade, mutual survival, legitimacy, access, etc.' },
  { name: 'conflictingInterests', type: 'json', description: 'Reasons they oppose each other: territory, ideology, revenge, resource competition, secrets, etc.' },
  { name: 'leverage', type: 'json', description: 'Blackmail, hostages, debts, supply chains, secrets, legal pressure, or social leverage.' },
  { name: 'dependencies', type: 'json', description: 'Mutual dependencies and shared-risk logic such as mutual survival or collapse contagion.' },
  { name: 'activeStrategies', type: 'json', description: 'Current strategies or tactics: poach_members, indirect_pressure, proxy_conflict, rescue_to_pressure, etc.' },
  { name: 'activePressures', type: 'json', description: 'Current pressure points, crises, deadlines, provocations, or temporary incentives.' },
  { name: 'changeLog', type: 'json', description: 'Qualitative relation-change history. Numeric values are reference hints, not final decision makers.' },
  { name: 'decisionNotes', type: 'text', description: 'GM/agent notes explaining why this relation may not follow numeric hints.' },
  { name: 'status', type: 'text', description: 'active, hidden, broken, archived, etc.' },
  { name: 'visibility', type: 'text', description: 'known, hidden, suspected, secret, etc.' },
  { name: 'coreConflict', type: 'text', description: 'Main conflict or dependency behind the relation.' },
  { name: 'evidence', type: 'text', description: 'Short evidence or source text.' },
  { name: 'summary', type: 'text', description: 'Short edge summary.' },
  { name: 'tags', type: 'json', description: 'Edge tags.' },
  { name: 'metadata', type: 'json', description: 'Extra edge metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest faction graph update timestamp.' }
];

export const FACTION_MEMBERSHIP_FIELDS = [
  { name: 'actorId', type: 'text', description: 'NPC, player, or actor id.' },
  { name: 'actorName', type: 'text', description: 'Display name for the actor.' },
  { name: 'actorType', type: 'text', description: 'npc, player, monster, organization_contact, etc.' },
  { name: 'factionId', type: 'text', description: 'Faction id.' },
  { name: 'role', type: 'text', description: 'Member role, office, cover, or duty.' },
  { name: 'rank', type: 'text', description: 'Rank or status within the faction.' },
  { name: 'status', type: 'text', description: 'active, former, covert, coerced, infiltrator, traitor, dead, etc.' },
  { name: 'loyalty', type: 'number', description: 'Loyalty score, usually -100..100 or 0..100.' },
  { name: 'influence', type: 'number', description: 'Actor influence inside the faction.' },
  { name: 'reasons', type: 'json', description: 'Why this actor belongs, serves, infiltrates, or left.' },
  { name: 'obligations', type: 'json', description: 'Duties, debts, oaths, leverage, or blackmail.' },
  { name: 'benefits', type: 'json', description: 'Benefits gained from membership.' },
  { name: 'visibility', type: 'text', description: 'known, hidden, suspected, secret, public, etc.' },
  { name: 'evidence', type: 'text', description: 'Short evidence or source text.' },
  { name: 'summary', type: 'text', description: 'Short membership summary.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'metadata', type: 'json', description: 'Extra membership metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest membership update timestamp.' }
];

const DEFAULT_LIMIT = 100;
const MAX_RESULTS = 500;
const MAX_DEPTH = 8;

export class FactionGraph {
  constructor({
    dataManager = new SQLiteDataManager(),
    nodeCollection = FACTION_NODE_COLLECTION,
    edgeCollection = FACTION_EDGE_COLLECTION,
    membershipCollection = FACTION_MEMBERSHIP_COLLECTION,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.nodeCollection = nodeCollection;
    this.edgeCollection = edgeCollection;
    this.membershipCollection = membershipCollection;
    this.now = now || (() => new Date().toISOString());
    this.ensureGraph();
  }

  ensureGraph() {
    this.dataManager.ensureCollection(this.nodeCollection);
    this.dataManager.alterFields(this.nodeCollection, {
      add: FACTION_NODE_FIELDS,
      reason: 'factionGraph:nodes'
    });
    this.dataManager.ensureCollection(this.edgeCollection);
    this.dataManager.alterFields(this.edgeCollection, {
      add: FACTION_EDGE_FIELDS,
      reason: 'factionGraph:edges'
    });
    this.dataManager.ensureCollection(this.membershipCollection);
    this.dataManager.alterFields(this.membershipCollection, {
      add: FACTION_MEMBERSHIP_FIELDS,
      reason: 'factionGraph:memberships'
    });
    return this.describe();
  }

  describe() {
    return {
      factions: this.dataManager.describeCollection(this.nodeCollection),
      relations: this.dataManager.describeCollection(this.edgeCollection),
      memberships: this.dataManager.describeCollection(this.membershipCollection)
    };
  }

  upsertFaction(input = {}) {
    const normalized = normalizeFaction(input, { now: this.now });
    return this.dataManager.upsertRecord(this.nodeCollection, normalized, { id: normalized.factionId });
  }

  patchFaction({ factionId, id, patch = {} } = {}) {
    const current = this.getFaction(factionId || id);
    const normalized = normalizeFaction({
      ...current.data,
      ...patch,
      factionId: current.id
    }, { now: this.now });
    return this.dataManager.upsertRecord(this.nodeCollection, normalized, { id: current.id });
  }

  getFaction(factionId) {
    return this.dataManager.getRecord(this.nodeCollection, normalizeFactionId(factionId));
  }

  deleteFaction({ factionId, id, deleteRelations = true, deleteMemberships = true } = {}) {
    const normalizedFactionId = normalizeFactionId(factionId || id);
    const deletedRelations = [];
    const deletedMemberships = [];
    if (deleteRelations) {
      for (const edge of this.listRelations({ factionId: normalizedFactionId, includeArchived: true, limit: MAX_RESULTS }).records) {
        deletedRelations.push(this.dataManager.deleteRecord(this.edgeCollection, edge.id));
      }
    }
    if (deleteMemberships) {
      for (const membership of this.listMemberships({ factionId: normalizedFactionId, includeArchived: true, limit: MAX_RESULTS }).records) {
        deletedMemberships.push(this.dataManager.deleteRecord(this.membershipCollection, membership.id));
      }
    }
    return {
      ...this.dataManager.deleteRecord(this.nodeCollection, normalizedFactionId),
      deletedRelations,
      deletedMemberships
    };
  }

  listFactions({
    filter = {},
    tags = [],
    query = '',
    includeHidden = true,
    sort = [{ field: 'name', direction: 'asc' }],
    limit = DEFAULT_LIMIT,
    offset = 0
  } = {}) {
    const result = this.dataManager.queryRecords(this.nodeCollection, {
      filter,
      sort,
      limit,
      offset
    });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    return {
      ...result,
      records: result.records.filter((record) => matchesFaction(record, { requiredTags, normalizedQuery, includeHidden }))
    };
  }

  upsertRelation(input = {}) {
    const normalized = normalizeRelation(input, { now: this.now });
    if (input.createMissingFactions !== false) {
      this.ensureFactionExists(normalized.fromFactionId);
      this.ensureFactionExists(normalized.toFactionId);
    }
    return this.dataManager.upsertRecord(this.edgeCollection, normalized, { id: normalized.id });
  }

  patchRelation({ id, edgeId, relationId, patch = {} } = {}) {
    const current = this.getRelation(id || edgeId || relationId);
    const normalized = normalizeRelation({
      ...current.data,
      ...patch,
      id: current.id
    }, { now: this.now });
    if (patch.createMissingFactions !== false) {
      this.ensureFactionExists(normalized.fromFactionId);
      this.ensureFactionExists(normalized.toFactionId);
    }
    return this.dataManager.upsertRecord(this.edgeCollection, normalized, { id: current.id });
  }

  getRelation(id) {
    return this.dataManager.getRecord(this.edgeCollection, normalizeRequiredText(id, 'id'));
  }

  deleteRelation({ id, edgeId, relationId } = {}) {
    return this.dataManager.deleteRecord(this.edgeCollection, normalizeRequiredText(id || edgeId || relationId, 'id'));
  }

  planRelationShift(input = {}) {
    const relation = this.resolveRelationForShift(input, { allowMissing: Boolean(input.createIfMissing) });
    const relationData = relation?.data || normalizeRelation({
      ...input,
      relationType: input.relationType || input.type || 'mixed',
      label: input.label || input.eventType || input.tactic || 'planned relation shift'
    }, { now: this.now });
    const shift = normalizeRelationShiftInput(input);
    const patch = buildRelationShiftPatch(relationData, shift, { now: this.now });
    return {
      planId: normalizeOptionalText(input.planId || input.id) || `relation_shift_${shortHash(`${relationData.fromFactionId}:${relationData.toFactionId}:${shift.eventText}:${this.now()}`)}`,
      relation: relation ? { id: relation.id, ...relation.data } : undefined,
      createIfMissing: Boolean(input.createIfMissing && !relation),
      relationInput: relation ? undefined : {
        fromFactionId: relationData.fromFactionId,
        toFactionId: relationData.toFactionId,
        relationType: relationData.relationType,
        direction: relationData.direction,
        label: relationData.label,
        visibility: relationData.visibility,
        status: relationData.status
      },
      shift,
      patch,
      afterPreview: {
        ...relationData,
        ...patch
      },
      guidance: [
        'Faction relation numeric fields are only reference hints.',
        'Use aspects/sharedInterests/conflictingInterests/leverage/dependencies/activeStrategies/changeLog when judging complex faction behavior.',
        'Mixed relations can cooperate and oppose each other at the same time; do not collapse them into a single ally/enemy score.'
      ]
    };
  }

  applyRelationShift(input = {}) {
    const plan = input.plan || this.planRelationShift(input);
    const dryRun = input.dryRun !== false;
    if (dryRun) {
      return {
        status: 'dry_run',
        dryRun: true,
        plan,
        applied: undefined
      };
    }
    if (plan.createIfMissing) {
      const created = this.upsertRelation({
        ...plan.relationInput,
        ...plan.patch,
        createMissingFactions: input.createMissingFactions
      });
      return {
        status: 'applied',
        dryRun: false,
        plan,
        applied: created
      };
    }
    const relationIdToPatch = plan.relation?.id || input.id || input.edgeId || input.relationId;
    const applied = this.patchRelation({
      id: relationIdToPatch,
      patch: plan.patch
    });
    return {
      status: 'applied',
      dryRun: false,
      plan,
      applied
    };
  }

  listRelations({
    factionId,
    fromFactionId,
    toFactionId,
    relationType,
    relationTypes,
    includeIncoming = true,
    includeOutgoing = true,
    includeArchived = false,
    includeHidden = true,
    minWeight,
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'relationType', direction: 'asc' }],
    limit = DEFAULT_LIMIT,
    offset = 0
  } = {}) {
    const result = this.dataManager.queryRecords(this.edgeCollection, {
      filter,
      sort,
      limit: clampInteger(limit || DEFAULT_LIMIT, 1, MAX_RESULTS),
      offset
    });
    const normalizedFactionId = factionId ? normalizeFactionId(factionId) : '';
    const from = fromFactionId ? normalizeFactionId(fromFactionId) : '';
    const to = toFactionId ? normalizeFactionId(toFactionId) : '';
    const allowedTypes = new Set(normalizeStringArray(relationTypes || relationType).map(normalizeSearchText));
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const minimumWeight = minWeight === undefined || minWeight === null || minWeight === '' ? undefined : Number(minWeight);
    return {
      ...result,
      records: result.records.filter((record) => {
        const data = record.data || {};
        if (!includeArchived && ['archived', 'deleted', 'removed'].includes(normalizeSearchText(data.status))) return false;
        if (!includeHidden && ['hidden', 'secret', 'unknown'].includes(normalizeSearchText(data.visibility))) return false;
        if (from && data.fromFactionId !== from) return false;
        if (to && data.toFactionId !== to) return false;
        if (normalizedFactionId && !relationTouches(data, normalizedFactionId, { includeIncoming, includeOutgoing })) return false;
        if (allowedTypes.size > 0 && !allowedTypes.has(normalizeSearchText(data.relationType))) return false;
        if (Number.isFinite(minimumWeight) && Number(data.weight || 0) < minimumWeight) return false;
        if (requiredTags.length > 0) {
          const edgeTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
          if (!requiredTags.every((tag) => edgeTags.has(tag))) return false;
        }
        if (normalizedQuery && !matchesRelationQuery(record, normalizedQuery)) return false;
        return true;
      })
    };
  }

  resolveRelationForShift(input = {}, { allowMissing = false } = {}) {
    const explicitId = normalizeOptionalText(input.relationId || input.edgeId || input.id);
    if (explicitId) return this.getRelation(explicitId);
    const fromFactionId = normalizeOptionalText(input.fromFactionId || input.from || input.sourceFactionId || input.source);
    const toFactionId = normalizeOptionalText(input.toFactionId || input.to || input.targetFactionId || input.target);
    if (!fromFactionId || !toFactionId) {
      if (allowMissing) return undefined;
      throw validationError('relationId or fromFactionId/toFactionId is required');
    }
    const records = this.listRelations({
      fromFactionId,
      toFactionId,
      relationTypes: input.relationTypes || input.relationType || input.type,
      includeArchived: true,
      includeHidden: true,
      limit: 10
    }).records;
    const relation = records[0] || this.listRelations({
      fromFactionId: toFactionId,
      toFactionId: fromFactionId,
      relationTypes: input.relationTypes || input.relationType || input.type,
      includeArchived: true,
      includeHidden: true,
      limit: 10
    }).records.find((record) => isUndirected(record.data));
    if (relation) return relation;
    if (allowMissing) return undefined;
    throw notFound(`Faction relation not found between ${fromFactionId} and ${toFactionId}`);
  }

  upsertMembership(input = {}) {
    const normalized = normalizeMembership(input, { now: this.now });
    if (input.createMissingFaction !== false) this.ensureFactionExists(normalized.factionId);
    return this.dataManager.upsertRecord(this.membershipCollection, normalized, { id: normalized.id });
  }

  patchMembership({ id, membershipId, actorId, npcId, factionId, patch = {} } = {}) {
    const current = id || membershipId
      ? this.getMembership(id || membershipId)
      : this.getMembership(membershipIdFor(actorId || npcId, factionId));
    const normalized = normalizeMembership({
      ...current.data,
      ...patch,
      id: current.id
    }, { now: this.now });
    if (patch.createMissingFaction !== false) this.ensureFactionExists(normalized.factionId);
    return this.dataManager.upsertRecord(this.membershipCollection, normalized, { id: current.id });
  }

  getMembership(id) {
    return this.dataManager.getRecord(this.membershipCollection, normalizeRequiredText(id, 'id'));
  }

  deleteMembership({ id, membershipId, actorId, npcId, factionId } = {}) {
    const resolvedId = id || membershipId || membershipIdFor(actorId || npcId, factionId);
    return this.dataManager.deleteRecord(this.membershipCollection, normalizeRequiredText(resolvedId, 'id'));
  }

  listMemberships({
    actorId,
    npcId,
    factionId,
    status,
    includeArchived = false,
    includeHidden = true,
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'actorId', direction: 'asc' }, { field: 'factionId', direction: 'asc' }],
    limit = DEFAULT_LIMIT,
    offset = 0
  } = {}) {
    const mergedFilter = { ...filter };
    if (actorId || npcId) mergedFilter.actorId = normalizeActorId(actorId || npcId);
    if (factionId) mergedFilter.factionId = normalizeFactionId(factionId);
    if (status) mergedFilter.status = String(status);
    const result = this.dataManager.queryRecords(this.membershipCollection, {
      filter: mergedFilter,
      sort,
      limit: clampInteger(limit || DEFAULT_LIMIT, 1, MAX_RESULTS),
      offset
    });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    return {
      ...result,
      records: result.records.filter((record) => matchesMembership(record, {
        requiredTags,
        normalizedQuery,
        includeArchived,
        includeHidden
      }))
    };
  }

  getActorFactions(input = {}) {
    const actorId = normalizeActorId(input.actorId || input.npcId);
    const memberships = this.listMemberships({
      ...input,
      actorId,
      limit: input.limit || MAX_RESULTS
    }).records;
    const factions = memberships.map((membership) => {
      const faction = this.dataManager.getRecord(this.nodeCollection, membership.data.factionId, { missing: 'undefined' });
      return {
        membership,
        faction
      };
    });
    return { actorId, factions };
  }

  getFactionMembers(input = {}) {
    const factionId = normalizeFactionId(input.factionId || input.id);
    return {
      factionId,
      memberships: this.listMemberships({
        ...input,
        factionId,
        limit: input.limit || MAX_RESULTS
      }).records
    };
  }

  traverseRelations({
    startFactionId,
    factionId,
    maxDepth = 2,
    relationTypes,
    includeIncoming = true,
    includeOutgoing = true,
    includeArchived = false,
    includeHidden = true,
    limit = 100
  } = {}) {
    const start = normalizeFactionId(startFactionId || factionId);
    const safeDepth = clampInteger(maxDepth, 0, MAX_DEPTH);
    const safeLimit = clampInteger(limit || DEFAULT_LIMIT, 1, MAX_RESULTS);
    const visitedFactionIds = new Set([start]);
    const paths = [];
    const queue = [{ factionId: start, depth: 0, pathFactionIds: [start], pathRelationIds: [] }];
    while (queue.length > 0 && paths.length < safeLimit) {
      const current = queue.shift();
      if (current.depth >= safeDepth) continue;
      const relations = this.listRelations({
        factionId: current.factionId,
        relationTypes,
        includeIncoming,
        includeOutgoing,
        includeArchived,
        includeHidden,
        limit: MAX_RESULTS
      }).records;
      for (const relation of relations) {
        const next = nextFromRelation(relation.data, current.factionId);
        if (!next) continue;
        const nextPath = {
          fromFactionId: current.factionId,
          toFactionId: next,
          depth: current.depth + 1,
          relationId: relation.id,
          relationType: relation.data.relationType,
          weight: relation.data.weight,
          pathFactionIds: [...current.pathFactionIds, next],
          pathRelationIds: [...current.pathRelationIds, relation.id]
        };
        paths.push(nextPath);
        if (!visitedFactionIds.has(next)) {
          visitedFactionIds.add(next);
          queue.push({
            factionId: next,
            depth: current.depth + 1,
            pathFactionIds: nextPath.pathFactionIds,
            pathRelationIds: nextPath.pathRelationIds
          });
        }
        if (paths.length >= safeLimit) break;
      }
    }
    return {
      startFactionId: start,
      maxDepth: safeDepth,
      visitedFactionIds: [...visitedFactionIds],
      paths
    };
  }

  findRelationPath({
    startFactionId,
    targetFactionId,
    maxDepth = 4,
    relationTypes,
    includeIncoming = true,
    includeOutgoing = true,
    includeArchived = false,
    includeHidden = true
  } = {}) {
    const start = normalizeFactionId(startFactionId);
    const target = normalizeFactionId(targetFactionId);
    const safeDepth = clampInteger(maxDepth, 0, MAX_DEPTH);
    const visited = new Set([start]);
    const queue = [{ factionId: start, depth: 0, pathFactionIds: [start], pathRelationIds: [] }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current.factionId === target) {
        return {
          found: true,
          startFactionId: start,
          targetFactionId: target,
          depth: current.depth,
          pathFactionIds: current.pathFactionIds,
          pathRelationIds: current.pathRelationIds
        };
      }
      if (current.depth >= safeDepth) continue;
      const relations = this.listRelations({
        factionId: current.factionId,
        relationTypes,
        includeIncoming,
        includeOutgoing,
        includeArchived,
        includeHidden,
        limit: MAX_RESULTS
      }).records;
      for (const relation of relations) {
        const next = nextFromRelation(relation.data, current.factionId);
        if (!next || visited.has(next)) continue;
        visited.add(next);
        queue.push({
          factionId: next,
          depth: current.depth + 1,
          pathFactionIds: [...current.pathFactionIds, next],
          pathRelationIds: [...current.pathRelationIds, relation.id]
        });
      }
    }
    return {
      found: false,
      startFactionId: start,
      targetFactionId: target,
      maxDepth: safeDepth,
      visitedFactionIds: [...visited]
    };
  }

  importDocument(input = {}) {
    const parsed = parseStructuredDocument(input);
    const { factions, relations, memberships } = extractFactionDocument(parsed.data);
    const importedFactions = factions.map((faction) => this.upsertFaction({
      ...faction,
      source: input.source || faction.source || 'document-import'
    }));
    const importedRelations = relations.map((relation) => this.upsertRelation({
      ...relation,
      source: input.source || relation.source || 'document-import'
    }));
    const importedMemberships = memberships.map((membership) => this.upsertMembership({
      ...membership,
      source: input.source || membership.source || 'document-import'
    }));
    return {
      format: parsed.format,
      collections: {
        factions: this.nodeCollection,
        relations: this.edgeCollection,
        memberships: this.membershipCollection
      },
      factions: {
        count: importedFactions.length,
        ids: importedFactions.map((record) => record.id),
        records: importedFactions
      },
      relations: {
        count: importedRelations.length,
        ids: importedRelations.map((record) => record.id),
        records: importedRelations
      },
      memberships: {
        count: importedMemberships.length,
        ids: importedMemberships.map((record) => record.id),
        records: importedMemberships
      }
    };
  }

  exportDocument({
    format = 'json',
    factionId,
    actorId,
    query = '',
    includeHidden = true,
    includeArchived = true,
    limit = 500,
    offset = 0
  } = {}) {
    const factions = factionId
      ? [this.getFaction(factionId)]
      : this.listFactions({ query, includeHidden, limit, offset }).records;
    const relations = this.listRelations({
      factionId,
      query,
      includeHidden,
      includeArchived,
      limit,
      offset
    }).records;
    const memberships = this.listMemberships({
      factionId,
      actorId,
      query,
      includeHidden,
      includeArchived,
      limit,
      offset
    }).records;
    const payload = {
      factionGraph: {
        factions: factions.map((record) => ({ id: record.id, ...record.data })),
        relations: relations.map((record) => ({ id: record.id, ...record.data })),
        memberships: memberships.map((record) => ({ id: record.id, ...record.data }))
      }
    };
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return { format: 'json', text: `${JSON.stringify(payload, null, 2)}\n`, payload };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return { format: 'yaml', text: YAML.stringify(payload), payload };
    }
    throw validationError('export format must be json or yaml');
  }

  buildRagDocuments({
    factionId,
    actorId,
    query = '',
    includeHidden = false,
    includeArchived = false,
    limit = 500
  } = {}) {
    const factions = factionId
      ? [this.getFaction(factionId)]
      : this.listFactions({ query, includeHidden, limit }).records;
    const factionIds = new Set(factions.map((record) => record.id));
    const relations = this.listRelations({
      factionId,
      query,
      includeHidden,
      includeArchived,
      limit
    }).records.filter((record) => !factionId || factionIds.has(record.data.fromFactionId) || factionIds.has(record.data.toFactionId));
    const memberships = this.listMemberships({
      factionId,
      actorId,
      query,
      includeHidden,
      includeArchived,
      limit
    }).records;
    const docs = [
      ...factions.map((record) => factionToRagDocument(record)),
      ...relations.map((record) => relationToRagDocument(record)),
      ...memberships.map((record) => membershipToRagDocument(record))
    ];
    return {
      count: docs.length,
      documents: docs
    };
  }

  planActorInfluence(input = {}) {
    const actorId = normalizeActorId(input.actorId || input.npcId);
    const impact = normalizeActorInfluenceInput(input);
    const targetFactionIds = normalizeStringArray(input.targetFactionIds || input.factionIds || input.factionId)
      .map(normalizeFactionId);
    const memberships = this.listMemberships({
      actorId,
      includeArchived: input.includeArchived ?? false,
      includeHidden: input.includeHidden ?? true,
      limit: MAX_RESULTS
    }).records.filter((membership) => (
      targetFactionIds.length === 0 || targetFactionIds.includes(membership.data.factionId)
    ));

    const membershipPatches = memberships.map((membership) => buildMembershipInfluencePatch(membership, impact));
    const factionIds = [...new Set(memberships.map((membership) => membership.data.factionId).concat(targetFactionIds))];
    const factionPatches = factionIds
      .map((factionId) => {
        const faction = this.dataManager.getRecord(this.nodeCollection, factionId, { missing: 'undefined' });
        if (!faction) return undefined;
        return buildFactionInfluencePatch(faction, impact, {
          actorId,
          actorName: input.actorName,
          memberships: memberships.filter((membership) => membership.data.factionId === factionId)
        });
      })
      .filter(Boolean);

    const relationPatches = [];
    if (input.propagateRelations && impact.relationDeltas && Object.keys(impact.relationDeltas).length > 0) {
      for (const factionId of factionIds) {
        const relations = this.listRelations({
          factionId,
          relationTypes: input.relationTypes,
          includeArchived: input.includeArchived ?? false,
          includeHidden: input.includeHidden ?? true,
          limit: input.maxRelations || 100
        }).records;
        for (const relation of relations) {
          relationPatches.push(buildRelationInfluencePatch(relation, impact, { touchedFactionId: factionId }));
        }
      }
    }

    return {
      planId: normalizeOptionalText(input.planId || input.id) || `actor_influence_${shortHash(`${actorId}:${impact.eventText}:${this.now()}`)}`,
      actorId,
      actorName: normalizeOptionalText(input.actorName),
      impactType: impact.impactType,
      magnitude: impact.magnitude,
      eventText: impact.eventText,
      evidence: impact.evidence,
      dryRunDefault: true,
      memberships: memberships.map((record) => ({ id: record.id, ...record.data })),
      targetFactionIds: factionIds,
      membershipPatches,
      factionPatches,
      relationPatches,
      summary: normalizeOptionalText(input.summary) || `${actorId} produces ${impact.impactType} influence on ${factionIds.join(', ')}.`
    };
  }

  applyActorInfluence(input = {}) {
    const plan = input.plan || this.planActorInfluence(input);
    const dryRun = input.dryRun !== false;
    if (dryRun) {
      return {
        status: 'dry_run',
        dryRun: true,
        plan,
        applied: {
          memberships: [],
          factions: [],
          relations: []
        }
      };
    }

    const appliedMemberships = [];
    const appliedFactions = [];
    const appliedRelations = [];
    for (const item of plan.membershipPatches || []) {
      appliedMemberships.push(this.patchMembership({
        id: item.id,
        patch: item.patch
      }));
    }
    for (const item of plan.factionPatches || []) {
      appliedFactions.push(this.patchFaction({
        factionId: item.id,
        patch: item.patch
      }));
    }
    for (const item of plan.relationPatches || []) {
      appliedRelations.push(this.patchRelation({
        id: item.id,
        patch: item.patch
      }));
    }
    return {
      status: 'applied',
      dryRun: false,
      plan,
      applied: {
        memberships: appliedMemberships,
        factions: appliedFactions,
        relations: appliedRelations
      }
    };
  }

  ensureFactionExists(factionId) {
    const normalizedFactionId = normalizeFactionId(factionId);
    const existing = this.dataManager.getRecord(this.nodeCollection, normalizedFactionId, { missing: 'undefined' });
    if (existing) return existing;
    return this.upsertFaction({
      factionId: normalizedFactionId,
      name: normalizedFactionId,
      summary: 'Auto-created by faction relation or membership.'
    });
  }
}

function normalizeFaction(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('faction must be a plain object');
  const factionId = normalizeFactionId(input.factionId || input.id || input.name);
  return {
    factionId,
    name: normalizeOptionalText(input.name) || factionId,
    kind: normalizeOptionalText(input.kind || input.type || 'faction'),
    scale: normalizeOptionalText(input.scale || 'local'),
    parentFactionId: normalizeOptionalText(input.parentFactionId || input.parentId),
    status: normalizeOptionalText(input.status || 'active'),
    visibility: normalizeOptionalText(input.visibility || 'known'),
    coreInterests: normalizeArrayOrObject(input.coreInterests || input.interests || input.coreInterest),
    goals: normalizeArrayOrObject(input.goals || input.agendas),
    resources: normalizeArrayOrObject(input.resources || input.assets),
    territories: normalizeStringArray(input.territories || input.locations),
    leaders: normalizeStringArray(input.leaders || input.leaderIds),
    values: normalizeNumericObject(input.values),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    summary: normalizeOptionalText(input.summary || input.description),
    publicFace: normalizeOptionalText(input.publicFace || input.publicSummary),
    secrets: normalizeArrayOrObject(input.secrets),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

function normalizeRelation(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('faction relation must be a plain object');
  const fromFactionId = normalizeFactionId(input.fromFactionId || input.from || input.sourceFactionId || input.source);
  const toFactionId = normalizeFactionId(input.toFactionId || input.to || input.targetFactionId || input.target);
  if (fromFactionId === toFactionId && !input.allowSelfRelation) throw validationError('faction relation cannot connect a faction to itself');
  const relationType = normalizeRelationType(input.relationType || input.type || input.kind || 'related');
  const direction = normalizeDirection(input.direction || (input.directed ? 'directed' : defaultDirectionForRelation(relationType)));
  const id = normalizeOptionalText(input.id || input.edgeId || input.relationId)
    || relationId({ fromFactionId, toFactionId, relationType, direction, label: input.label });
  return {
    id,
    fromFactionId,
    toFactionId,
    relationType,
    label: normalizeOptionalText(input.label || input.name),
    direction,
    weight: normalizeOptionalNumber(input.weight ?? input.strength, 'weight'),
    influence: normalizeOptionalNumber(input.influence, 'influence'),
    trust: normalizeOptionalNumber(input.trust, 'trust'),
    tension: normalizeOptionalNumber(input.tension, 'tension'),
    aspects: normalizeArrayOrObject(input.aspects || input.stances || input.facets || input.relationAspects),
    sharedInterests: normalizeArrayOrObject(input.sharedInterests || input.cooperation || input.alignedInterests),
    conflictingInterests: normalizeArrayOrObject(input.conflictingInterests || input.conflicts || input.opposition),
    leverage: normalizeArrayOrObject(input.leverage || input.blackmail || input.pressureLeverage),
    dependencies: normalizeArrayOrObject(input.dependencies || input.dependency || input.mutualDependencies || input.sharedRisks),
    activeStrategies: normalizeArrayOrObject(input.activeStrategies || input.strategies || input.tactics),
    activePressures: normalizeArrayOrObject(input.activePressures || input.pressures || input.flashpoints),
    changeLog: normalizeArrayOrObject(input.changeLog || input.history || input.recentShifts),
    decisionNotes: normalizeOptionalText(input.decisionNotes || input.qualitativeNotes || input.notes),
    status: normalizeOptionalText(input.status || 'active'),
    visibility: normalizeOptionalText(input.visibility || (input.hidden ? 'hidden' : 'known')),
    coreConflict: normalizeOptionalText(input.coreConflict || input.conflict || input.reason),
    evidence: normalizeOptionalText(input.evidence || input.sourceText),
    summary: normalizeOptionalText(input.summary || input.description),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

function normalizeMembership(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw validationError('faction membership must be a plain object');
  const actorId = normalizeActorId(input.actorId || input.npcId || input.characterId || input.actorName || input.name);
  const factionId = normalizeFactionId(input.factionId || input.faction || input.organizationId);
  const id = normalizeOptionalText(input.id || input.membershipId) || membershipIdFor(actorId, factionId);
  return {
    id,
    actorId,
    actorName: normalizeOptionalText(input.actorName || input.name),
    actorType: normalizeOptionalText(input.actorType || input.type || (input.isPlayer ? 'player' : 'npc')),
    factionId,
    role: normalizeOptionalText(input.role || input.position),
    rank: normalizeOptionalText(input.rank),
    status: normalizeOptionalText(input.status || 'active'),
    loyalty: normalizeOptionalNumber(input.loyalty, 'loyalty'),
    influence: normalizeOptionalNumber(input.influence, 'influence'),
    reasons: normalizeArrayOrObject(input.reasons || input.reason || input.why),
    obligations: normalizeArrayOrObject(input.obligations || input.duties),
    benefits: normalizeArrayOrObject(input.benefits),
    visibility: normalizeOptionalText(input.visibility || (input.hidden ? 'hidden' : 'known')),
    evidence: normalizeOptionalText(input.evidence || input.sourceText),
    summary: normalizeOptionalText(input.summary || input.description),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

function normalizeActorInfluenceInput(input = {}) {
  const impactType = normalizeSearchText(input.impactType || input.type || 'event').replace(/[\s-]+/g, '_');
  const magnitude = clampInteger(input.magnitude ?? input.severity ?? input.importance ?? 1, -10, 10);
  const absoluteMagnitude = Math.max(1, Math.abs(magnitude));
  const defaultDeltas = defaultInfluenceDeltas(impactType, magnitude);
  return {
    impactType,
    magnitude,
    eventText: normalizeOptionalText(input.eventText || input.sourceText || input.text || input.content || input.summary),
    evidence: normalizeOptionalText(input.evidence || input.sourceText),
    tags: normalizeStringArray(input.tags),
    factionValueDeltas: {
      ...defaultDeltas.factionValueDeltas,
      ...normalizeNumericObject(input.factionValueDeltas || input.valueDeltas)
    },
    membershipDeltas: {
      ...defaultDeltas.membershipDeltas,
      ...normalizeNumericObject(input.membershipDeltas)
    },
    relationDeltas: normalizeOptionalNumericObject(input.relationDeltas),
    membershipStatus: normalizeOptionalText(input.membershipStatus) || defaultDeltas.membershipStatus,
    factionStatus: normalizeOptionalText(input.factionStatus),
    visibility: normalizeOptionalText(input.visibility || 'known'),
    note: normalizeOptionalText(input.note || input.reason),
    absoluteMagnitude
  };
}

function defaultInfluenceDeltas(impactType, magnitude) {
  const m = Math.max(1, Math.abs(Number(magnitude) || 1));
  const positive = magnitude >= 0 ? 1 : -1;
  const half = Math.ceil(m / 2);
  const third = Math.ceil(m / 3);
  const type = normalizeSearchText(impactType);
  if (['heroism', 'victory', 'rescue', 'diplomacy', 'public_support', 'success'].includes(type)) {
    return {
      factionValueDeltas: { reputation: positive * m, morale: positive * half, stability: positive * third },
      membershipDeltas: { influence: positive * half },
      membershipStatus: ''
    };
  }
  if (['promotion', 'appointment', 'honor'].includes(type)) {
    return {
      factionValueDeltas: { reputation: positive * half, morale: positive * third },
      membershipDeltas: { influence: positive * m, loyalty: positive * third },
      membershipStatus: ''
    };
  }
  if (['betrayal', 'defection', 'treason'].includes(type)) {
    return {
      factionValueDeltas: { stability: -m, reputation: -half, alertLevel: half },
      membershipDeltas: { loyalty: -m * 2, influence: -m },
      membershipStatus: m >= 7 ? 'traitor' : 'wavering'
    };
  }
  if (['scandal', 'crime', 'public_failure', 'failure'].includes(type)) {
    return {
      factionValueDeltas: { reputation: -m, stability: -half, morale: -third, alertLevel: third },
      membershipDeltas: { influence: -half },
      membershipStatus: ''
    };
  }
  if (['death', 'martyrdom', 'sacrifice'].includes(type)) {
    const sacrifice = ['martyrdom', 'sacrifice'].includes(type);
    return {
      factionValueDeltas: {
        morale: sacrifice ? half : -m,
        reputation: sacrifice ? half : 0,
        stability: -half
      },
      membershipDeltas: { influence: -m },
      membershipStatus: 'dead'
    };
  }
  if (['sabotage', 'exposure', 'leak'].includes(type)) {
    return {
      factionValueDeltas: { stability: -m, reputation: -half, alertLevel: m, resourcePressure: half },
      membershipDeltas: { loyalty: -half, influence: -third },
      membershipStatus: ''
    };
  }
  return {
    factionValueDeltas: { reputation: positive * third },
    membershipDeltas: {},
    membershipStatus: ''
  };
}

function buildMembershipInfluencePatch(record, impact) {
  const data = record.data || {};
  const patch = {
    loyalty: addDelta(data.loyalty, impact.membershipDeltas.loyalty),
    influence: addDelta(data.influence, impact.membershipDeltas.influence),
    status: impact.membershipStatus || data.status || 'active',
    evidence: impact.evidence || data.evidence || '',
    summary: appendSummary(data.summary, impact.eventText),
    tags: mergeStringArrays(data.tags, impact.tags, ['actor-influence']),
    metadata: appendInfluenceLog(data.metadata, {
      kind: 'membership',
      impactType: impact.impactType,
      magnitude: impact.magnitude,
      eventText: impact.eventText,
      evidence: impact.evidence
    })
  };
  return {
    id: record.id,
    before: { id: record.id, ...data },
    patch: removeUndefined(patch),
    afterPreview: {
      ...data,
      ...removeUndefined(patch)
    }
  };
}

function buildFactionInfluencePatch(record, impact, { actorId, actorName, memberships = [] } = {}) {
  const data = record.data || {};
  const values = applyNumericDeltas(data.values || {}, impact.factionValueDeltas);
  const patch = {
    values,
    status: impact.factionStatus || data.status || 'active',
    summary: appendSummary(data.summary, impact.eventText),
    tags: mergeStringArrays(data.tags, impact.tags, ['actor-influence']),
    metadata: appendInfluenceLog(data.metadata, {
      kind: 'faction',
      actorId,
      actorName: normalizeOptionalText(actorName),
      membershipIds: memberships.map((membership) => membership.id),
      impactType: impact.impactType,
      magnitude: impact.magnitude,
      valueDeltas: impact.factionValueDeltas,
      eventText: impact.eventText,
      evidence: impact.evidence
    })
  };
  return {
    id: record.id,
    before: { id: record.id, ...data },
    patch: removeUndefined(patch),
    afterPreview: {
      ...data,
      ...removeUndefined(patch)
    }
  };
}

function buildRelationInfluencePatch(record, impact, { touchedFactionId } = {}) {
  const data = record.data || {};
  const patch = {
    weight: addDelta(data.weight, impact.relationDeltas.weight),
    influence: addDelta(data.influence, impact.relationDeltas.influence),
    trust: addDelta(data.trust, impact.relationDeltas.trust),
    tension: addDelta(data.tension, impact.relationDeltas.tension),
    evidence: impact.evidence || data.evidence || '',
    summary: appendSummary(data.summary, impact.eventText),
    tags: mergeStringArrays(data.tags, impact.tags, ['actor-influence']),
    metadata: appendInfluenceLog(data.metadata, {
      kind: 'relation',
      touchedFactionId,
      impactType: impact.impactType,
      magnitude: impact.magnitude,
      relationDeltas: impact.relationDeltas,
      eventText: impact.eventText,
      evidence: impact.evidence
    })
  };
  return {
    id: record.id,
    before: { id: record.id, ...data },
    patch: removeUndefined(patch),
    afterPreview: {
      ...data,
      ...removeUndefined(patch)
    }
  };
}

function normalizeRelationShiftInput(input = {}) {
  const eventType = normalizeSearchText(input.eventType || input.type || input.tactic || input.strategy || 'relation_shift').replace(/[\s-]+/g, '_');
  const tactic = normalizeRelationTactic(input.tactic || input.strategy || eventType || input.eventText);
  const relationDeltas = normalizeOptionalNumericObject(input.relationDeltas || input.numericDeltas || input.valueDeltas);
  const defaults = defaultRelationShiftParts({ eventType, tactic, eventText: input.eventText || input.sourceText || input.text || input.summary });
  return {
    eventType,
    tactic,
    eventText: normalizeOptionalText(input.eventText || input.sourceText || input.text || input.content || input.summary),
    evidence: normalizeOptionalText(input.evidence || input.sourceText),
    mode: normalizeRelationShiftMode(input.mode),
    relationType: normalizeOptionalText(input.relationType || input.nextRelationType),
    status: normalizeOptionalText(input.status),
    visibility: normalizeOptionalText(input.visibility),
    label: normalizeOptionalText(input.label),
    coreConflict: normalizeOptionalText(input.coreConflict || input.conflict),
    summary: normalizeOptionalText(input.summary || input.description),
    decisionNotes: normalizeOptionalText(input.decisionNotes || input.qualitativeNotes || input.notes),
    tags: mergeStringArrays(input.tags, defaults.tags, ['relation-shift']),
    relationDeltas: relationDeltas || {},
    aspects: mergeArrayLike(defaults.aspects, input.aspects || input.stances || input.facets),
    sharedInterests: mergeArrayLike(defaults.sharedInterests, input.sharedInterests || input.cooperation || input.alignedInterests),
    conflictingInterests: mergeArrayLike(defaults.conflictingInterests, input.conflictingInterests || input.conflicts || input.opposition),
    leverage: mergeArrayLike(defaults.leverage, input.leverage || input.blackmail || input.pressureLeverage),
    dependencies: mergeArrayLike(defaults.dependencies, input.dependencies || input.dependency || input.mutualDependencies || input.sharedRisks),
    activeStrategies: mergeArrayLike(defaults.activeStrategies, input.activeStrategies || input.strategies || input.tactics),
    activePressures: mergeArrayLike(defaults.activePressures, input.activePressures || input.pressures || input.flashpoints)
  };
}

function buildRelationShiftPatch(data = {}, shift, { now = () => new Date().toISOString() } = {}) {
  const change = {
    id: `shift_${shortHash(`${shift.eventType}:${shift.eventText}:${now()}`)}`,
    eventType: shift.eventType,
    tactic: shift.tactic,
    eventText: shift.eventText,
    evidence: shift.evidence,
    relationDeltas: shift.relationDeltas,
    at: now()
  };
  const replace = shift.mode === 'replace';
  const patch = {
    relationType: shift.relationType || data.relationType,
    label: shift.label || data.label,
    weight: addDelta(data.weight, shift.relationDeltas.weight),
    influence: addDelta(data.influence, shift.relationDeltas.influence),
    trust: addDelta(data.trust, shift.relationDeltas.trust),
    tension: addDelta(data.tension, shift.relationDeltas.tension),
    aspects: mergeRelationField(data.aspects, shift.aspects, { replace }),
    sharedInterests: mergeRelationField(data.sharedInterests, shift.sharedInterests, { replace }),
    conflictingInterests: mergeRelationField(data.conflictingInterests, shift.conflictingInterests, { replace }),
    leverage: mergeRelationField(data.leverage, shift.leverage, { replace }),
    dependencies: mergeRelationField(data.dependencies, shift.dependencies, { replace }),
    activeStrategies: mergeRelationField(data.activeStrategies, shift.activeStrategies, { replace }),
    activePressures: mergeRelationField(data.activePressures, shift.activePressures, { replace }),
    changeLog: appendRelationChange(data.changeLog, change),
    status: shift.status || data.status || 'active',
    visibility: shift.visibility || data.visibility || 'known',
    coreConflict: shift.coreConflict || data.coreConflict,
    evidence: shift.evidence || data.evidence,
    summary: shift.summary || appendSummary(data.summary, shift.eventText),
    decisionNotes: shift.decisionNotes || data.decisionNotes,
    tags: mergeStringArrays(data.tags, shift.tags),
    metadata: appendRelationShiftLog(data.metadata, {
      kind: 'relation_shift',
      eventType: shift.eventType,
      tactic: shift.tactic,
      eventText: shift.eventText,
      evidence: shift.evidence,
      relationDeltas: shift.relationDeltas,
      note: 'Numeric relation values are reference hints only.'
    }),
    graphUpdatedAt: now()
  };
  return removeUndefined(patch);
}

function defaultRelationShiftParts({ eventType, tactic, eventText } = {}) {
  const text = normalizeSearchText([eventType, tactic, eventText].filter(Boolean).join(' '));
  const baseText = normalizeOptionalText(eventText);
  if (text.includes('poach') || text.includes('recruit') || text.includes('挖墙脚')) {
    return {
      tags: ['poach-members', 'subversion'],
      aspects: [{ id: 'poach_members', type: 'subversion', summary: baseText || 'One faction tries to poach members or assets from the other.', status: 'active' }],
      conflictingInterests: [{ id: 'talent_competition', summary: 'They compete over people, specialists, informants, legitimacy, or resources.' }],
      leverage: [{ id: 'recruitment_leverage', summary: 'Promises, blackmail, pay, safety, ideology, or secrets may pull members away.' }],
      activeStrategies: [{ id: 'poach_members', tactic: 'poach_members', summary: baseText || '挖墙脚: undermine the rival by recruiting or turning their people.' }],
      activePressures: [{ id: 'loyalty_pressure', summary: 'Members with weak loyalty or high grievances become pressure points.' }]
    };
  }
  if (text.includes('indirect') || text.includes('proxy') || text.includes('围魏救赵')) {
    return {
      tags: ['indirect-pressure', 'proxy-conflict'],
      aspects: [{ id: 'indirect_pressure', type: 'strategy', summary: baseText || 'One faction pressures a third point to force relief elsewhere.', status: 'active' }],
      conflictingInterests: [{ id: 'strategic_displacement', summary: 'They may attack leverage points instead of the visible front.' }],
      activeStrategies: [{ id: 'indirect_pressure', tactic: 'wei_wei_jiu_zhao', summary: baseText || '围魏救赵: threaten an exposed interest to force the opponent to redirect.' }],
      activePressures: [{ id: 'flank_or_proxy_target', summary: 'Allies, supply lines, hostages, reputation, or dependent settlements may become targets.' }]
    };
  }
  if (text.includes('mutual_survival') || text.includes('shared_risk') || text.includes('唇寒齿亡')) {
    return {
      tags: ['mutual-survival', 'shared-risk'],
      aspects: [{ id: 'mutual_survival', type: 'dependency', summary: baseText || 'They may dislike each other but collapse of one endangers the other.', status: 'active' }],
      sharedInterests: [{ id: 'shared_survival', summary: 'A shared enemy, disaster, economy, border, secret, or legitimacy chain makes cooperation rational.' }],
      dependencies: [{ id: 'lips_teeth_dependency', summary: baseText || '唇寒齿亡: one side falling exposes the other to greater danger.' }],
      activeStrategies: [{ id: 'conditional_support', tactic: 'conditional_support', summary: 'Support the other side only enough to prevent mutual loss.' }]
    };
  }
  if (text.includes('cooperat') || text.includes('ally') || text.includes('合作') || text.includes('结盟')) {
    return {
      tags: ['cooperation'],
      aspects: [{ id: 'cooperation', type: 'cooperation', summary: baseText || 'Temporary or practical cooperation.', status: 'active' }],
      sharedInterests: [{ id: 'shared_agenda', summary: baseText || 'They share an immediate goal.' }]
    };
  }
  if (text.includes('conflict') || text.includes('rival') || text.includes('betray') || text.includes('冲突') || text.includes('背叛')) {
    return {
      tags: ['conflict'],
      aspects: [{ id: 'conflict', type: 'opposition', summary: baseText || 'Active opposition or rivalry.', status: 'active' }],
      conflictingInterests: [{ id: 'active_conflict', summary: baseText || 'A current event increases conflict.' }]
    };
  }
  return {
    tags: ['relation-event'],
    aspects: baseText ? [{ id: `event_${shortHash(baseText)}`, type: 'event', summary: baseText, status: 'active' }] : []
  };
}

function normalizeRelationTactic(value) {
  const text = normalizeSearchText(value).replace(/[\s-]+/g, '_');
  if (text.includes('挖墙脚')) return 'poach_members';
  if (text.includes('围魏救赵')) return 'indirect_pressure';
  if (text.includes('唇寒齿亡')) return 'mutual_survival';
  return text || 'relation_shift';
}

function normalizeRelationShiftMode(value) {
  const mode = normalizeSearchText(value || 'append');
  return mode === 'replace' ? 'replace' : 'append';
}

function mergeArrayLike(...values) {
  const output = [];
  for (const value of values) {
    const normalized = normalizeArrayOrObject(value);
    if (Array.isArray(normalized)) output.push(...normalized);
    else if (Object.keys(normalized).length > 0) output.push(normalized);
  }
  return dedupeArrayObjects(output);
}

function mergeRelationField(existing, additions, { replace = false } = {}) {
  const normalizedAdditions = normalizeArrayOrObject(additions);
  const additionsEmpty = Array.isArray(normalizedAdditions)
    ? normalizedAdditions.length === 0
    : Object.keys(normalizedAdditions).length === 0;
  if (additionsEmpty) return existing;
  if (replace) return normalizedAdditions;
  const normalizedExisting = normalizeArrayOrObject(existing);
  if (!Array.isArray(normalizedExisting) && !Array.isArray(normalizedAdditions)) {
    return { ...normalizedExisting, ...normalizedAdditions };
  }
  return dedupeArrayObjects([
    ...(Array.isArray(normalizedExisting) ? normalizedExisting : [normalizedExisting]),
    ...(Array.isArray(normalizedAdditions) ? normalizedAdditions : [normalizedAdditions])
  ].filter((item) => item !== undefined && item !== null && item !== ''));
}

function appendRelationChange(changeLog, change) {
  return dedupeArrayObjects([
    ...normalizeArray(changeLog),
    removeUndefined(change)
  ]);
}

function dedupeArrayObjects(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (item === undefined || item === null || item === '') continue;
    const key = typeof item === 'object'
      ? (item.id || item.tactic || item.type && item.summary || JSON.stringify(item))
      : String(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function extractFactionDocument(data) {
  const root = data?.factionGraph || data?.faction_graph || data?.factionsGraph || data || {};
  const factions = [
    ...normalizeArray(root.factions),
    ...normalizeArray(root.nodes),
    ...normalizeArray(root.organizations),
    ...normalizeArray(root.groups)
  ];
  const relations = [
    ...normalizeArray(root.relations),
    ...normalizeArray(root.edges),
    ...normalizeArray(root.relationships),
    ...normalizeArray(root.links)
  ];
  const memberships = [
    ...normalizeArray(root.memberships),
    ...normalizeArray(root.members),
    ...normalizeArray(root.affiliations)
  ];
  return { factions, relations, memberships };
}

function matchesFaction(record, { requiredTags, normalizedQuery, includeHidden }) {
  const data = record.data || {};
  if (!includeHidden && ['hidden', 'secret', 'unknown'].includes(normalizeSearchText(data.visibility))) return false;
  if (requiredTags.length > 0) {
    const tags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
    if (!requiredTags.every((tag) => tags.has(tag))) return false;
  }
  if (!normalizedQuery) return true;
  return normalizeSearchText([
    record.id,
    data.factionId,
    data.name,
    data.kind,
    data.scale,
    data.parentFactionId,
    data.status,
    data.summary,
    data.publicFace,
    ...(Array.isArray(data.tags) ? data.tags : []),
    ...(Array.isArray(data.aliases) ? data.aliases : [])
  ].filter(Boolean).join(' ')).includes(normalizedQuery);
}

function matchesRelationQuery(record, normalizedQuery) {
  const data = record.data || {};
  return normalizeSearchText([
    record.id,
    data.fromFactionId,
    data.toFactionId,
    data.relationType,
    data.label,
    JSON.stringify(data.aspects || []),
    JSON.stringify(data.sharedInterests || []),
    JSON.stringify(data.conflictingInterests || []),
    JSON.stringify(data.leverage || []),
    JSON.stringify(data.dependencies || []),
    JSON.stringify(data.activeStrategies || []),
    JSON.stringify(data.activePressures || []),
    data.decisionNotes,
    data.coreConflict,
    data.evidence,
    data.summary,
    ...(Array.isArray(data.tags) ? data.tags : [])
  ].filter(Boolean).join(' ')).includes(normalizedQuery);
}

function matchesMembership(record, { requiredTags, normalizedQuery, includeArchived, includeHidden }) {
  const data = record.data || {};
  if (!includeArchived && ['former', 'dead', 'archived', 'removed'].includes(normalizeSearchText(data.status))) return false;
  if (!includeHidden && ['hidden', 'secret', 'unknown'].includes(normalizeSearchText(data.visibility))) return false;
  if (requiredTags.length > 0) {
    const tags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
    if (!requiredTags.every((tag) => tags.has(tag))) return false;
  }
  if (!normalizedQuery) return true;
  return normalizeSearchText([
    record.id,
    data.actorId,
    data.actorName,
    data.actorType,
    data.factionId,
    data.role,
    data.rank,
    data.status,
    data.evidence,
    data.summary,
    ...(Array.isArray(data.tags) ? data.tags : [])
  ].filter(Boolean).join(' ')).includes(normalizedQuery);
}

function factionToRagDocument(record) {
  const data = record.data || {};
  return {
    sourceId: `faction:${record.id}`,
    text: [
      `Faction: ${data.name || record.id} (${record.id})`,
      `Kind/scale: ${data.kind || ''} / ${data.scale || ''}`,
      data.parentFactionId ? `Parent faction: ${data.parentFactionId}` : '',
      data.summary ? `Summary: ${data.summary}` : '',
      data.publicFace ? `Public face: ${data.publicFace}` : '',
      `Core interests: ${JSON.stringify(data.coreInterests || [])}`,
      `Goals: ${JSON.stringify(data.goals || [])}`,
      `Resources: ${JSON.stringify(data.resources || [])}`,
      data.tags?.length ? `Tags: ${data.tags.join(', ')}` : ''
    ].filter(Boolean).join('\n'),
    metadata: {
      domain: 'faction',
      kind: 'faction',
      factionId: record.id,
      visibility: data.visibility,
      status: data.status
    }
  };
}

function relationToRagDocument(record) {
  const data = record.data || {};
  return {
    sourceId: `faction-relation:${record.id}`,
    text: [
      `Faction relation: ${data.fromFactionId} -> ${data.toFactionId}`,
      `Type: ${data.relationType}`,
      data.label ? `Label: ${data.label}` : '',
      data.summary ? `Summary: ${data.summary}` : '',
      `Aspects: ${JSON.stringify(data.aspects || [])}`,
      `Shared interests: ${JSON.stringify(data.sharedInterests || [])}`,
      `Conflicting interests: ${JSON.stringify(data.conflictingInterests || [])}`,
      `Leverage: ${JSON.stringify(data.leverage || [])}`,
      `Dependencies/shared risk: ${JSON.stringify(data.dependencies || [])}`,
      `Active strategies: ${JSON.stringify(data.activeStrategies || [])}`,
      `Active pressures: ${JSON.stringify(data.activePressures || [])}`,
      data.decisionNotes ? `Decision notes: ${data.decisionNotes}` : '',
      data.coreConflict ? `Core conflict/dependency: ${data.coreConflict}` : '',
      data.evidence ? `Evidence: ${data.evidence}` : ''
    ].filter(Boolean).join('\n'),
    metadata: {
      domain: 'faction',
      kind: 'faction_relation',
      relationId: record.id,
      fromFactionId: data.fromFactionId,
      toFactionId: data.toFactionId,
      relationType: data.relationType,
      visibility: data.visibility,
      status: data.status
    }
  };
}

function membershipToRagDocument(record) {
  const data = record.data || {};
  return {
    sourceId: `faction-membership:${record.id}`,
    text: [
      `Faction membership: ${data.actorName || data.actorId} (${data.actorId}) belongs to ${data.factionId}`,
      data.role ? `Role: ${data.role}` : '',
      data.rank ? `Rank: ${data.rank}` : '',
      data.summary ? `Summary: ${data.summary}` : '',
      `Reasons: ${JSON.stringify(data.reasons || [])}`,
      `Obligations: ${JSON.stringify(data.obligations || [])}`,
      data.evidence ? `Evidence: ${data.evidence}` : ''
    ].filter(Boolean).join('\n'),
    metadata: {
      domain: 'faction',
      kind: 'faction_membership',
      membershipId: record.id,
      actorId: data.actorId,
      factionId: data.factionId,
      visibility: data.visibility,
      status: data.status
    }
  };
}

function relationTouches(data, factionId, { includeIncoming = true, includeOutgoing = true } = {}) {
  if (includeOutgoing && data.fromFactionId === factionId) return true;
  if (includeIncoming && data.toFactionId === factionId) return true;
  if (isUndirected(data)) {
    if (includeOutgoing && data.toFactionId === factionId) return true;
    if (includeIncoming && data.fromFactionId === factionId) return true;
  }
  return false;
}

function nextFromRelation(data, factionId) {
  if (data.fromFactionId === factionId) return data.toFactionId;
  if (isUndirected(data) && data.toFactionId === factionId) return data.fromFactionId;
  return '';
}

function isUndirected(data = {}) {
  return normalizeDirection(data.direction) === 'undirected';
}

function defaultDirectionForRelation(relationType) {
  const normalized = normalizeSearchText(relationType);
  if (['contains', 'contained_by', 'vassal', 'patron', 'controls', 'funds', 'infiltrates'].includes(normalized)) return 'directed';
  return 'undirected';
}

function relationId({ fromFactionId, toFactionId, relationType, direction, label }) {
  const a = safeSegment(fromFactionId);
  const b = safeSegment(toFactionId);
  const type = safeSegment(relationType || 'related');
  const suffix = label ? `_${shortHash(label)}` : '';
  if (normalizeDirection(direction) === 'undirected') {
    const [first, second] = [a, b].sort();
    return `factionedge_${type}_${first}_${second}${suffix}`.slice(0, 128);
  }
  return `factionedge_${type}_${a}_${b}${suffix}`.slice(0, 128);
}

function membershipIdFor(actorId, factionId) {
  return `factionmember_${safeSegment(normalizeActorId(actorId))}_${safeSegment(normalizeFactionId(factionId))}`.slice(0, 128);
}

export function normalizeFactionId(value) {
  const base = safeSegment(value).slice(0, 128);
  return base || `faction_${shortHash(value)}`;
}

function normalizeActorId(value) {
  const base = safeSegment(value).slice(0, 128);
  return base || `actor_${shortHash(value)}`;
}

function normalizeRelationType(value) {
  return normalizeOptionalText(value || 'related').replace(/\s+/g, '_');
}

function normalizeDirection(value) {
  const normalized = normalizeSearchText(value || 'undirected').replace(/-/g, '_');
  if (['directed', 'one_way', 'oneway'].includes(normalized)) return 'directed';
  return 'undirected';
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeArrayOrObject(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return value;
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNumericObject(value) {
  const object = normalizeObject(value);
  return Object.fromEntries(Object.entries(object).map(([key, child]) => {
    const number = Number(child);
    if (!Number.isFinite(number)) throw validationError(`${key} must be numeric`);
    return [normalizeStateFieldName(key), number];
  }));
}

function normalizeOptionalNumericObject(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizeNumericObject(value);
}

function normalizeOptionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be numeric`);
  return number;
}

function normalizeRequiredText(value, field) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw validationError(`${field} is required`);
  return normalized;
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function normalizeStateFieldName(value) {
  const field = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  if (!field) throw validationError('Faction numeric value field name is required');
  return field;
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function applyNumericDeltas(values = {}, deltas = {}) {
  const current = normalizeNumericObject(values);
  for (const [key, delta] of Object.entries(deltas || {})) {
    const field = normalizeStateFieldName(key);
    current[field] = addDelta(current[field], delta) ?? 0;
  }
  return current;
}

function addDelta(value, delta) {
  if (delta === undefined || delta === null || delta === '') return value;
  const base = value === undefined || value === null || value === '' ? 0 : Number(value);
  const change = Number(delta);
  if (!Number.isFinite(base) || !Number.isFinite(change)) return value;
  return base + change;
}

function mergeStringArrays(...values) {
  return [...new Set(values.flatMap(normalizeStringArray))];
}

function appendSummary(summary, eventText) {
  const base = normalizeOptionalText(summary);
  const addition = normalizeOptionalText(eventText);
  if (!addition) return base;
  if (!base) return addition;
  if (base.includes(addition)) return base;
  return `${base}\n${addition}`.slice(0, 4000);
}

function appendInfluenceLog(metadata, entry) {
  const base = normalizeObject(metadata);
  const log = Array.isArray(base.actorInfluenceLog) ? base.actorInfluenceLog : [];
  return {
    ...base,
    actorInfluenceLog: [
      ...log.slice(-19),
      {
        ...entry,
        at: new Date().toISOString()
      }
    ]
  };
}

function appendRelationShiftLog(metadata, entry) {
  const base = normalizeObject(metadata);
  const log = Array.isArray(base.relationShiftLog) ? base.relationShiftLog : [];
  return {
    ...base,
    relationShiftLog: [
      ...log.slice(-19),
      {
        ...entry,
        at: new Date().toISOString()
      }
    ]
  };
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'FactionGraphValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'FactionGraphNotFoundError';
  error.statusCode = 404;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'faction');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
