// @ts-nocheck
import YAML from 'yaml';
import { parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';

export const NPC_RELATION_NODE_COLLECTION = 'npc_relation_nodes';
export const NPC_RELATION_EDGE_COLLECTION = 'npc_relation_edges';

export const NPC_RELATION_NODE_FIELDS = [
  { name: 'npcId', type: 'text', description: 'Stable NPC id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'tags', type: 'json', description: 'Node tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'summary', type: 'text', description: 'Short node summary.' },
  { name: 'metadata', type: 'json', description: 'Extra node metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest relationship graph update timestamp.' }
];

export const NPC_RELATION_EDGE_FIELDS = [
  { name: 'fromNpcId', type: 'text', description: 'Source NPC id.' },
  { name: 'toNpcId', type: 'text', description: 'Target NPC id.' },
  { name: 'relationType', type: 'text', description: 'ally, enemy, family, owes, faction, mentor, etc.' },
  { name: 'label', type: 'text', description: 'Human-readable relation label.' },
  { name: 'direction', type: 'text', description: 'directed, undirected, or mutual.' },
  { name: 'weight', type: 'number', description: 'Generic relation strength, usually -100..100 or 0..100.' },
  { name: 'attitude', type: 'text', description: 'friendly, hostile, wary, loyal, afraid, etc.' },
  { name: 'trust', type: 'number', description: 'Optional trust score.' },
  { name: 'familiarity', type: 'number', description: 'Optional familiarity score.' },
  { name: 'status', type: 'text', description: 'active, hidden, broken, archived, etc.' },
  { name: 'visibility', type: 'text', description: 'known, hidden, suspected, secret, etc.' },
  { name: 'evidence', type: 'text', description: 'Short evidence or source text.' },
  { name: 'summary', type: 'text', description: 'Short edge summary.' },
  { name: 'tags', type: 'json', description: 'Edge tags.' },
  { name: 'metadata', type: 'json', description: 'Extra edge metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest relationship graph update timestamp.' }
];

const DEFAULT_LIMIT = 100;
const MAX_TRAVERSAL_DEPTH = 6;
const MAX_TRAVERSAL_RESULTS = 500;

export class NpcRelationshipGraph {
  constructor({
    dataManager = new SQLiteDataManager(),
    nodeCollection = NPC_RELATION_NODE_COLLECTION,
    edgeCollection = NPC_RELATION_EDGE_COLLECTION,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.nodeCollection = nodeCollection;
    this.edgeCollection = edgeCollection;
    this.now = now || (() => new Date().toISOString());
    this.ensureGraph();
  }

  ensureGraph() {
    this.dataManager.ensureCollection(this.nodeCollection);
    this.dataManager.alterFields(this.nodeCollection, {
      add: NPC_RELATION_NODE_FIELDS,
      reason: 'npcRelationshipGraph:nodes'
    });
    this.dataManager.ensureCollection(this.edgeCollection);
    this.dataManager.alterFields(this.edgeCollection, {
      add: NPC_RELATION_EDGE_FIELDS,
      reason: 'npcRelationshipGraph:edges'
    });
    return this.describe();
  }

  describe() {
    return {
      nodes: this.dataManager.describeCollection(this.nodeCollection),
      edges: this.dataManager.describeCollection(this.edgeCollection)
    };
  }

  upsertNode(input = {}) {
    const normalized = normalizeRelationNode(input, { now: this.now });
    return this.dataManager.upsertRecord(this.nodeCollection, normalized, { id: normalized.npcId });
  }

  patchNode({ npcId, id, patch = {} } = {}) {
    const current = this.getNode(npcId || id);
    const normalized = normalizeRelationNode({
      ...current.data,
      ...patch,
      npcId: current.id
    }, { now: this.now });
    return this.dataManager.upsertRecord(this.nodeCollection, normalized, { id: current.id });
  }

  getNode(npcId) {
    return this.dataManager.getRecord(this.nodeCollection, normalizeNpcId(npcId));
  }

  deleteNode({ npcId, id, deleteEdges = true } = {}) {
    const normalizedNpcId = normalizeNpcId(npcId || id);
    const deletedEdges = [];
    if (deleteEdges) {
      const related = this.listEdges({ npcId: normalizedNpcId, includeArchived: true, limit: MAX_TRAVERSAL_RESULTS }).records;
      for (const edge of related) {
        deletedEdges.push(this.dataManager.deleteRecord(this.edgeCollection, edge.id));
      }
    }
    const deleted = this.dataManager.deleteRecord(this.nodeCollection, normalizedNpcId);
    return {
      ...deleted,
      deletedEdges
    };
  }

  listNodes({
    filter = {},
    tags = [],
    query = '',
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
      records: result.records.filter((record) => {
        const data = record.data || {};
        if (requiredTags.length > 0) {
          const nodeTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
          if (!requiredTags.every((tag) => nodeTags.has(tag))) return false;
        }
        if (normalizedQuery) {
          const haystack = normalizeSearchText([
            record.id,
            data.name,
            data.summary,
            ...(Array.isArray(data.tags) ? data.tags : []),
            ...(Array.isArray(data.aliases) ? data.aliases : [])
          ].filter(Boolean).join(' '));
          if (!haystack.includes(normalizedQuery)) return false;
        }
        return true;
      })
    };
  }

  upsertEdge(input = {}) {
    const normalized = normalizeRelationEdge(input, { now: this.now });
    if (input.createMissingNodes !== false) {
      this.ensureNodeExists(normalized.fromNpcId);
      this.ensureNodeExists(normalized.toNpcId);
    }
    return this.dataManager.upsertRecord(this.edgeCollection, normalized, { id: normalized.id });
  }

  patchEdge({ id, edgeId, patch = {} } = {}) {
    const current = this.getEdge(id || edgeId);
    const normalized = normalizeRelationEdge({
      ...current.data,
      ...patch,
      id: current.id
    }, { now: this.now });
    if (patch.createMissingNodes !== false) {
      this.ensureNodeExists(normalized.fromNpcId);
      this.ensureNodeExists(normalized.toNpcId);
    }
    return this.dataManager.upsertRecord(this.edgeCollection, normalized, { id: current.id });
  }

  getEdge(id) {
    return this.dataManager.getRecord(this.edgeCollection, normalizeRequiredText(id, 'id'));
  }

  deleteEdge({ id, edgeId } = {}) {
    return this.dataManager.deleteRecord(this.edgeCollection, normalizeRequiredText(id || edgeId, 'id'));
  }

  listEdges({
    npcId,
    fromNpcId,
    toNpcId,
    relationType,
    relationTypes,
    includeIncoming = true,
    includeOutgoing = true,
    includeArchived = false,
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
      limit: Math.min(Math.max(Number(limit || DEFAULT_LIMIT), 1), MAX_TRAVERSAL_RESULTS),
      offset
    });
    const normalizedNpcId = npcId ? normalizeNpcId(npcId) : '';
    const from = fromNpcId ? normalizeNpcId(fromNpcId) : '';
    const to = toNpcId ? normalizeNpcId(toNpcId) : '';
    const allowedTypes = new Set(normalizeStringArray(relationTypes || relationType).map(normalizeSearchText));
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const minimumWeight = minWeight === undefined || minWeight === null || minWeight === '' ? undefined : Number(minWeight);

    return {
      ...result,
      records: result.records.filter((record) => {
        const data = record.data || {};
        if (!includeArchived && ['archived', 'deleted'].includes(String(data.status || '').toLowerCase())) return false;
        if (from && data.fromNpcId !== from) return false;
        if (to && data.toNpcId !== to) return false;
        if (normalizedNpcId && !edgeTouches(data, normalizedNpcId, { includeIncoming, includeOutgoing })) return false;
        if (allowedTypes.size > 0 && !allowedTypes.has(normalizeSearchText(data.relationType))) return false;
        if (Number.isFinite(minimumWeight) && Number(data.weight || 0) < minimumWeight) return false;
        if (requiredTags.length > 0) {
          const edgeTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
          if (!requiredTags.every((tag) => edgeTags.has(tag))) return false;
        }
        if (normalizedQuery) {
          const haystack = normalizeSearchText([
            record.id,
            data.fromNpcId,
            data.toNpcId,
            data.relationType,
            data.label,
            data.attitude,
            data.status,
            data.visibility,
            data.summary,
            data.evidence,
            ...(Array.isArray(data.tags) ? data.tags : [])
          ].filter(Boolean).join(' '));
          if (!haystack.includes(normalizedQuery)) return false;
        }
        return true;
      })
    };
  }

  traverseRelations({
    startNpcId,
    maxDepth = 2,
    relationTypes,
    includeIncoming = true,
    includeOutgoing = true,
    includeArchived = false,
    minWeight,
    limit = 100
  } = {}) {
    const start = normalizeNpcId(startNpcId);
    const safeDepth = clampDepth(maxDepth);
    const safeLimit = clampLimit(limit);
    const visitedNodes = new Set([start]);
    const includedEdges = new Map();
    const paths = [];
    const queue = [{
      npcId: start,
      depth: 0,
      pathNpcIds: [start],
      pathEdgeIds: []
    }];

    while (queue.length > 0 && paths.length < safeLimit) {
      const item = queue.shift();
      if (item.depth >= safeDepth) continue;
      const edges = this.listEdges({
        npcId: item.npcId,
        relationTypes,
        includeIncoming,
        includeOutgoing,
        includeArchived,
        minWeight,
        limit: MAX_TRAVERSAL_RESULTS
      }).records;

      for (const edge of edges) {
        const nextNpcId = nextFromEdge(edge.data, item.npcId, { includeIncoming, includeOutgoing });
        if (!nextNpcId) continue;
        includedEdges.set(edge.id, edge);
        const nextPath = {
          fromNpcId: item.npcId,
          toNpcId: nextNpcId,
          depth: item.depth + 1,
          edgeId: edge.id,
          relationType: edge.data.relationType,
          pathNpcIds: [...item.pathNpcIds, nextNpcId],
          pathEdgeIds: [...item.pathEdgeIds, edge.id]
        };
        paths.push(nextPath);
        if (!visitedNodes.has(nextNpcId)) {
          visitedNodes.add(nextNpcId);
          queue.push({
            npcId: nextNpcId,
            depth: item.depth + 1,
            pathNpcIds: nextPath.pathNpcIds,
            pathEdgeIds: nextPath.pathEdgeIds
          });
        }
        if (paths.length >= safeLimit) break;
      }
    }

    return {
      startNpcId: start,
      maxDepth: safeDepth,
      nodes: [...visitedNodes].map((npcId) => this.getNode(npcIdOrFallback(npcId))),
      edges: [...includedEdges.values()],
      paths
    };
  }

  findPath({
    startNpcId,
    targetNpcId,
    maxDepth = 4,
    relationTypes,
    includeIncoming = true,
    includeOutgoing = true,
    includeArchived = false,
    minWeight
  } = {}) {
    const start = normalizeNpcId(startNpcId);
    const target = normalizeNpcId(targetNpcId);
    const safeDepth = clampDepth(maxDepth);
    const visited = new Set([start]);
    const queue = [{
      npcId: start,
      depth: 0,
      pathNpcIds: [start],
      pathEdgeIds: []
    }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (item.npcId === target) {
        return {
          found: true,
          startNpcId: start,
          targetNpcId: target,
          depth: item.depth,
          pathNpcIds: item.pathNpcIds,
          pathEdgeIds: item.pathEdgeIds,
          edges: item.pathEdgeIds.map((edgeId) => this.getEdge(edgeId)),
          nodes: item.pathNpcIds.map((npcId) => this.getNode(npcIdOrFallback(npcId)))
        };
      }
      if (item.depth >= safeDepth) continue;
      const edges = this.listEdges({
        npcId: item.npcId,
        relationTypes,
        includeIncoming,
        includeOutgoing,
        includeArchived,
        minWeight,
        limit: MAX_TRAVERSAL_RESULTS
      }).records;
      for (const edge of edges) {
        const nextNpcId = nextFromEdge(edge.data, item.npcId, { includeIncoming, includeOutgoing });
        if (!nextNpcId || visited.has(nextNpcId)) continue;
        visited.add(nextNpcId);
        queue.push({
          npcId: nextNpcId,
          depth: item.depth + 1,
          pathNpcIds: [...item.pathNpcIds, nextNpcId],
          pathEdgeIds: [...item.pathEdgeIds, edge.id]
        });
      }
    }

    return {
      found: false,
      startNpcId: start,
      targetNpcId: target,
      maxDepth: safeDepth,
      visitedNpcIds: [...visited]
    };
  }

  importDocument(input = {}) {
    const parsed = parseStructuredDocument(input);
    const { nodes, edges } = extractGraphDocument(parsed.data);
    const importedNodes = nodes.map((node) => this.upsertNode({
      ...node,
      source: input.source || node.source || 'document-import'
    }));
    const importedEdges = edges.map((edge) => this.upsertEdge({
      ...edge,
      source: input.source || edge.source || 'document-import'
    }));
    return {
      format: parsed.format,
      nodeCollection: this.nodeCollection,
      edgeCollection: this.edgeCollection,
      nodes: {
        count: importedNodes.length,
        ids: importedNodes.map((record) => record.id),
        records: importedNodes
      },
      edges: {
        count: importedEdges.length,
        ids: importedEdges.map((record) => record.id),
        records: importedEdges
      }
    };
  }

  exportDocument({
    format = 'json',
    npcId,
    relationTypes,
    includeArchived = true,
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const nodes = npcId
      ? this.traverseRelations({ startNpcId: npcId, maxDepth: 1, includeArchived, limit }).nodes
      : this.listNodes({ query, limit, offset }).records;
    const edges = this.listEdges({
      npcId,
      relationTypes,
      includeArchived,
      query,
      limit,
      offset
    }).records;
    const payload = {
      npcRelationshipGraph: {
        nodes: nodes.map((record) => ({ id: record.id, ...record.data })),
        edges: edges.map((record) => ({ id: record.id, ...record.data }))
      }
    };
    const normalizedFormat = String(format || 'json').toLowerCase();
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        text: `${JSON.stringify(payload, null, 2)}\n`,
        payload
      };
    }
    if (normalizedFormat === 'yaml' || normalizedFormat === 'yml') {
      return {
        format: 'yaml',
        text: YAML.stringify(payload),
        payload
      };
    }
    throw validationError('export format must be json or yaml');
  }

  ensureNodeExists(npcId) {
    const normalizedNpcId = normalizeNpcId(npcId);
    const existing = this.dataManager.getRecord(this.nodeCollection, normalizedNpcId, { missing: 'undefined' });
    if (existing) return existing;
    return this.upsertNode({
      npcId: normalizedNpcId,
      name: normalizedNpcId,
      summary: '',
      metadata: {
        autoCreated: true
      }
    });
  }
}

export function normalizeRelationNode(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('relationship node must be a plain object');
  }
  const npcId = normalizeNpcId(input.npcId || input.id || input.name);
  return {
    npcId,
    name: normalizeOptionalText(input.name) || npcId,
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    summary: normalizeOptionalText(input.summary),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

export function normalizeRelationEdge(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('relationship edge must be a plain object');
  }
  const fromNpcId = normalizeNpcId(input.fromNpcId || input.from || input.sourceNpcId || input.source);
  const toNpcId = normalizeNpcId(input.toNpcId || input.to || input.targetNpcId || input.target);
  if (fromNpcId === toNpcId && input.allowSelfRelation !== true) {
    throw validationError('relationship edge cannot point to the same npc unless allowSelfRelation is true');
  }
  const relationType = normalizeOptionalText(input.relationType || input.type || input.kind || 'related');
  const direction = normalizeDirection(input.direction || (input.directed === true ? 'directed' : 'undirected'));
  const id = normalizeOptionalText(input.id || input.edgeId) || relationIdFor(fromNpcId, toNpcId, relationType, direction);
  return {
    id,
    fromNpcId,
    toNpcId,
    relationType,
    label: normalizeOptionalText(input.label),
    direction,
    weight: normalizeOptionalNumber(input.weight ?? input.strength, 1),
    attitude: normalizeOptionalText(input.attitude),
    trust: normalizeOptionalNumber(input.trust),
    familiarity: normalizeOptionalNumber(input.familiarity),
    status: normalizeOptionalText(input.status || 'active'),
    visibility: normalizeOptionalText(input.visibility || 'known'),
    evidence: normalizeOptionalText(input.evidence || input.sourceText),
    summary: normalizeOptionalText(input.summary),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

function extractGraphDocument(data) {
  const root = data?.npcRelationshipGraph || data?.npc_relationship_graph || data?.relationshipGraph || data?.graph || data || {};
  const nodes = normalizeDocumentArray(root.nodes || root.npcs || root.characters || root.relationNodes || root.relationshipNodes);
  const edges = normalizeDocumentArray(root.edges || root.relationships || root.relations || root.relationEdges);

  if (edges.length === 0 && Array.isArray(data)) {
    return {
      nodes: [],
      edges: data
    };
  }
  if (edges.length === 0 && looksLikeEdge(root)) {
    return {
      nodes: [],
      edges: [root]
    };
  }
  return { nodes, edges };
}

function normalizeDocumentArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({
      ...(item && typeof item === 'object' && !Array.isArray(item) ? item : { summary: String(item) }),
      id: item?.id || item?.npcId || key,
      npcId: item?.npcId || key
    }));
  }
  return [];
}

function looksLikeEdge(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && (
    value.fromNpcId || value.toNpcId || value.from || value.to || value.sourceNpcId || value.targetNpcId
  );
}

function edgeTouches(edge, npcId, { includeIncoming = true, includeOutgoing = true } = {}) {
  const direction = normalizeDirection(edge.direction);
  if (edge.fromNpcId === npcId && includeOutgoing) return true;
  if (edge.toNpcId === npcId && (includeIncoming || direction !== 'directed')) return true;
  if (direction !== 'directed' && edge.toNpcId === npcId && includeOutgoing) return true;
  if (direction !== 'directed' && edge.fromNpcId === npcId && includeIncoming) return true;
  return false;
}

function nextFromEdge(edge, npcId, { includeIncoming = true, includeOutgoing = true } = {}) {
  const direction = normalizeDirection(edge.direction);
  if (edge.fromNpcId === npcId && includeOutgoing) return edge.toNpcId;
  if (edge.toNpcId === npcId && direction !== 'directed' && (includeOutgoing || includeIncoming)) return edge.fromNpcId;
  if (edge.toNpcId === npcId && direction === 'directed' && includeIncoming) return edge.fromNpcId;
  if (edge.fromNpcId === npcId && direction !== 'directed' && includeIncoming) return edge.toNpcId;
  return undefined;
}

function relationIdFor(fromNpcId, toNpcId, relationType, direction) {
  const pair = direction === 'directed'
    ? [fromNpcId, toNpcId]
    : [fromNpcId, toNpcId].sort();
  return `rel_${safeSegment(pair[0])}_${safeSegment(pair[1])}_${safeSegment(relationType)}`.slice(0, 128);
}

function normalizeNpcId(value) {
  const text = normalizeRequiredText(value, 'npcId');
  return safeSegment(text) || `npc_${shortHash(text)}`;
}

function npcIdOrFallback(value) {
  return normalizeNpcId(value);
}

function normalizeDirection(value) {
  const normalized = String(value || 'undirected').toLowerCase();
  if (['directed', 'one-way', 'one_way'].includes(normalized)) return 'directed';
  if (['mutual', 'bidirectional', 'bi-directional'].includes(normalized)) return 'mutual';
  return 'undirected';
}

function normalizeOptionalNumber(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw validationError(`Expected finite number, got: ${value}`);
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

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function clampDepth(value) {
  const number = Number(value ?? 2);
  if (!Number.isInteger(number) || number < 0) return 2;
  return Math.min(number, MAX_TRAVERSAL_DEPTH);
}

function clampLimit(value) {
  const number = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isInteger(number) || number < 1) return DEFAULT_LIMIT;
  return Math.min(number, MAX_TRAVERSAL_RESULTS);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'NpcRelationshipGraphValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'npc-relation');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
