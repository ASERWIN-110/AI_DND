// @ts-nocheck
import YAML from 'yaml';
import { parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import { MAP_STRUCTURED_STATE_COLLECTION } from './map-structured-state.js';
import { SCENE_MAP_MOUNTS_COLLECTION } from './scene-map-mounts.js';

export const MAP_RELATION_NODE_COLLECTION = 'map_relation_nodes';
export const MAP_RELATION_EDGE_COLLECTION = 'map_relation_edges';

export const MAP_RELATION_NODE_FIELDS = [
  { name: 'mapId', type: 'text', description: 'Stable map/location id.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'type', type: 'text', description: 'world, region, city, district, building, room, area, route, landmark, etc.' },
  { name: 'parentMapId', type: 'text', description: 'Optional parent map/location id.' },
  { name: 'tags', type: 'json', description: 'Node tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'summary', type: 'text', description: 'Short node summary.' },
  { name: 'metadata', type: 'json', description: 'Extra node metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest map graph update timestamp.' }
];

export const MAP_RELATION_EDGE_FIELDS = [
  { name: 'fromMapId', type: 'text', description: 'Source map/location id.' },
  { name: 'toMapId', type: 'text', description: 'Target map/location id.' },
  { name: 'relationType', type: 'text', description: 'path, door, stairs, portal, road, route, contains, adjacent, shortcut, etc.' },
  { name: 'label', type: 'text', description: 'Human-readable connection label.' },
  { name: 'direction', type: 'text', description: 'directed, undirected, or mutual.' },
  { name: 'travelMode', type: 'text', description: 'walk, climb, swim, fly, ride, vehicle, teleport, crawl, custom, etc.' },
  { name: 'cost', type: 'number', description: 'Weighted movement cost used by pathfinding.' },
  { name: 'distance', type: 'number', description: 'Optional distance value.' },
  { name: 'difficulty', type: 'number', description: 'Optional traversal difficulty or DC-like score.' },
  { name: 'status', type: 'text', description: 'open, active, blocked, locked, hidden, sealed, collapsed, unreachable, etc.' },
  { name: 'visibility', type: 'text', description: 'known, visible, hidden, secret, unknown, fogged, etc.' },
  { name: 'requirements', type: 'json', description: 'Keys, checks, abilities, tools, mounts, or narrative requirements.' },
  { name: 'conditions', type: 'json', description: 'Scene, time, weather, puzzle, combat, or story conditions.' },
  { name: 'evidence', type: 'text', description: 'Short evidence or source text.' },
  { name: 'summary', type: 'text', description: 'Short connection summary.' },
  { name: 'tags', type: 'json', description: 'Edge tags.' },
  { name: 'metadata', type: 'json', description: 'Extra edge metadata.' },
  { name: 'graphUpdatedAt', type: 'text', description: 'Latest map graph update timestamp.' }
];

const DEFAULT_LIMIT = 100;
const MAX_PATH_DEPTH = 32;
const MAX_GRAPH_EDGES = 2000;
const BLOCKED_STATUSES = new Set(['blocked', 'locked', 'sealed', 'collapsed', 'unreachable', 'closed', 'inactive', 'removed']);
const HIDDEN_VISIBILITIES = new Set(['hidden', 'secret', 'unknown', 'fogged']);

export class MapRelationshipGraph {
  constructor({
    dataManager = new SQLiteDataManager(),
    appDatabase,
    nodeCollection = MAP_RELATION_NODE_COLLECTION,
    edgeCollection = MAP_RELATION_EDGE_COLLECTION,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.appDatabase = appDatabase;
    this.nodeCollection = nodeCollection;
    this.edgeCollection = edgeCollection;
    this.now = now || (() => new Date().toISOString());
    this.ensureGraph();
  }

  ensureGraph() {
    this.dataManager.ensureCollection(this.nodeCollection);
    this.dataManager.alterFields(this.nodeCollection, {
      add: MAP_RELATION_NODE_FIELDS,
      reason: 'mapRelationshipGraph:nodes'
    });
    this.dataManager.ensureCollection(this.edgeCollection);
    this.dataManager.alterFields(this.edgeCollection, {
      add: MAP_RELATION_EDGE_FIELDS,
      reason: 'mapRelationshipGraph:edges'
    });
    return this.describe();
  }

  describe() {
    return {
      nodes: this.dataManager.describeCollection(this.nodeCollection),
      edges: this.dataManager.describeCollection(this.edgeCollection),
      sceneSources: {
        sceneMapMounts: SCENE_MAP_MOUNTS_COLLECTION,
        mapStructuredStates: MAP_STRUCTURED_STATE_COLLECTION
      }
    };
  }

  upsertNode(input = {}) {
    const normalized = normalizeMapNode(input, { now: this.now });
    return this.dataManager.upsertRecord(this.nodeCollection, normalized, { id: normalized.mapId });
  }

  patchNode({ mapId, id, patch = {} } = {}) {
    const current = this.getNode(mapId || id);
    const normalized = normalizeMapNode({
      ...current.data,
      ...patch,
      mapId: current.id
    }, { now: this.now });
    return this.dataManager.upsertRecord(this.nodeCollection, normalized, { id: current.id });
  }

  getNode(mapId) {
    return this.dataManager.getRecord(this.nodeCollection, normalizeMapId(mapId));
  }

  deleteNode({ mapId, id, deleteEdges = true } = {}) {
    const normalizedMapId = normalizeMapId(mapId || id);
    const deletedEdges = [];
    if (deleteEdges) {
      const related = this.listEdges({ mapId: normalizedMapId, includeBlocked: true, includeHidden: true, limit: MAX_GRAPH_EDGES }).records;
      for (const edge of related) {
        deletedEdges.push(this.dataManager.deleteRecord(this.edgeCollection, edge.id));
      }
    }
    const deleted = this.dataManager.deleteRecord(this.nodeCollection, normalizedMapId);
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
      records: result.records.filter((record) => matchesNode(record, { requiredTags, normalizedQuery }))
    };
  }

  upsertEdge(input = {}) {
    const normalized = normalizeMapEdge(input, { now: this.now });
    if (input.createMissingNodes !== false) {
      this.ensureNodeExists(normalized.fromMapId);
      this.ensureNodeExists(normalized.toMapId);
    }
    return this.dataManager.upsertRecord(this.edgeCollection, normalized, { id: normalized.id });
  }

  patchEdge({ id, edgeId, patch = {} } = {}) {
    const current = this.getEdge(id || edgeId);
    const normalized = normalizeMapEdge({
      ...current.data,
      ...patch,
      id: current.id
    }, { now: this.now });
    if (patch.createMissingNodes !== false) {
      this.ensureNodeExists(normalized.fromMapId);
      this.ensureNodeExists(normalized.toMapId);
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
    mapId,
    fromMapId,
    toMapId,
    relationType,
    relationTypes,
    travelMode,
    travelModes,
    includeIncoming = true,
    includeOutgoing = true,
    includeBlocked = false,
    includeHidden = false,
    maxDifficulty,
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
      limit: Math.min(Math.max(Number(limit || DEFAULT_LIMIT), 1), MAX_GRAPH_EDGES),
      offset
    });
    const normalizedMapId = mapId ? normalizeMapId(mapId) : '';
    const from = fromMapId ? normalizeMapId(fromMapId) : '';
    const to = toMapId ? normalizeMapId(toMapId) : '';
    const allowedTypes = new Set(normalizeStringArray(relationTypes || relationType).map(normalizeSearchText));
    const allowedModes = new Set(normalizeStringArray(travelModes || travelMode).map(normalizeSearchText));
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const difficultyLimit = maxDifficulty === undefined || maxDifficulty === null || maxDifficulty === '' ? undefined : Number(maxDifficulty);

    return {
      ...result,
      records: result.records.filter((record) => {
        const data = record.data || {};
        if (!includeBlocked && isBlockedEdge(data)) return false;
        if (!includeHidden && isHiddenEdge(data)) return false;
        if (from && data.fromMapId !== from) return false;
        if (to && data.toMapId !== to) return false;
        if (normalizedMapId && !edgeTouches(data, normalizedMapId, { includeIncoming, includeOutgoing })) return false;
        if (allowedTypes.size > 0 && !allowedTypes.has(normalizeSearchText(data.relationType))) return false;
        if (allowedModes.size > 0 && !allowedModes.has(normalizeSearchText(data.travelMode))) return false;
        if (Number.isFinite(difficultyLimit) && Number(data.difficulty || 0) > difficultyLimit) return false;
        if (requiredTags.length > 0) {
          const edgeTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
          if (!requiredTags.every((tag) => edgeTags.has(tag))) return false;
        }
        if (normalizedQuery && !matchesEdgeQuery(record, normalizedQuery)) return false;
        return true;
      })
    };
  }

  findPath(input = {}) {
    return findShortestPath({
      startMapId: input.startMapId || input.fromMapId || input.startNodeId || input.from,
      targetMapId: input.targetMapId || input.toMapId || input.targetNodeId || input.to,
      edges: this.listEdges({
        relationTypes: input.relationTypes || input.relationType,
        travelModes: input.travelModes || input.travelMode,
        includeIncoming: input.includeIncoming ?? true,
        includeOutgoing: input.includeOutgoing ?? true,
        includeBlocked: input.includeBlocked ?? false,
        includeHidden: input.includeHidden ?? false,
        maxDifficulty: input.maxDifficulty,
        tags: input.tags,
        limit: MAX_GRAPH_EDGES
      }).records,
      nodes: this.listNodes({ limit: 500 }).records,
      options: input
    });
  }

  findScenePath(input = {}) {
    if (!this.appDatabase) throw validationError('findScenePath requires appDatabase');
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId);
    const sceneGraph = this.buildSceneGraph({
      ...input,
      chatSessionId,
      sceneId
    });
    const result = findShortestPath({
      startMapId: input.startMapId || input.fromMapId || input.startNodeId || input.from,
      targetMapId: input.targetMapId || input.toMapId || input.targetNodeId || input.to,
      edges: sceneGraph.edges,
      nodes: sceneGraph.nodes,
      options: input
    });
    return {
      ...result,
      chatSessionId,
      sceneId,
      graphSources: sceneGraph.sources,
      mountedMapIds: sceneGraph.mountedMapIds,
      mode: 'scene'
    };
  }

  buildSceneGraph({
    chatSessionId,
    sceneId = 'current',
    includeGlobal = true,
    includeMountedMaps = true,
    includeStructuredState = true,
    includeParentLinks = false,
    includeInactive = false,
    includeBlocked = false,
    includeHidden = false,
    relationTypes,
    relationType,
    travelModes,
    travelMode,
    maxDifficulty
  } = {}) {
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    const nodes = new Map();
    const edgeMap = new Map();
    const sources = [];

    if (includeGlobal) {
      const globalNodes = this.listNodes({ limit: 500 }).records;
      for (const node of globalNodes) nodes.set(node.id, node);
      for (const edge of this.listEdges({
        relationTypes: relationTypes || relationType,
        travelModes: travelModes || travelMode,
        includeBlocked,
        includeHidden,
        maxDifficulty,
        limit: MAX_GRAPH_EDGES
      }).records) {
        edgeMap.set(edge.id, edge);
      }
      sources.push('global_map_relationships');
    }

    const mounted = includeMountedMaps && manager.hasCollection?.(SCENE_MAP_MOUNTS_COLLECTION)
      ? manager.queryRecords(SCENE_MAP_MOUNTS_COLLECTION, {
        filter: { sceneId },
        limit: 500
      }).records.filter((record) => includeInactive || !isInactiveMount(record.data))
      : [];
    for (const mount of mounted) {
      const node = sceneMountToNode(mount);
      nodes.set(node.id, node);
      if (includeParentLinks && mount.data.parentMapId) {
        const parentId = normalizeMapId(mount.data.parentMapId);
        if (!nodes.has(parentId)) nodes.set(parentId, syntheticNode(parentId, { source: 'scene_parent' }));
        const edge = syntheticEdge({
          id: `scene-parent:${sceneId}:${parentId}->${node.id}`,
          fromMapId: parentId,
          toMapId: node.id,
          relationType: 'contains',
          label: 'scene parent link',
          direction: 'undirected',
          cost: 1,
          status: mount.data.status || 'open',
          visibility: mount.data.visibility || 'visible',
          source: 'scene_map_mounts'
        });
        edgeMap.set(edge.id, edge);
      }
    }
    if (mounted.length > 0) sources.push('scene_map_mounts');

    const states = includeStructuredState && manager.hasCollection?.(MAP_STRUCTURED_STATE_COLLECTION)
      ? manager.queryRecords(MAP_STRUCTURED_STATE_COLLECTION, {
        filter: { sceneId },
        limit: 500
      }).records
      : [];
    for (const state of states) {
      const mapId = normalizeMapId(state.data.mapId || state.id);
      if (!nodes.has(mapId)) nodes.set(mapId, syntheticNode(mapId, { name: state.data.name, source: 'map_structured_state' }));
      for (const node of mapStateToNodes(state)) {
        nodes.set(node.id, node);
      }
      for (const edge of mapStateToEdges(state)) {
        edgeMap.set(edge.id, edge);
        if (!nodes.has(edge.data.fromMapId)) nodes.set(edge.data.fromMapId, syntheticNode(edge.data.fromMapId, { source: 'map_state_edge' }));
        if (!nodes.has(edge.data.toMapId)) nodes.set(edge.data.toMapId, syntheticNode(edge.data.toMapId, { source: 'map_state_edge' }));
      }
    }
    if (states.length > 0) sources.push('map_structured_states');

    const filteredEdges = [...edgeMap.values()].filter((edge) => {
      const data = edge.data || {};
      if (!includeBlocked && isBlockedEdge(data)) return false;
      if (!includeHidden && isHiddenEdge(data)) return false;
      const allowedTypes = new Set(normalizeStringArray(relationTypes || relationType).map(normalizeSearchText));
      const allowedModes = new Set(normalizeStringArray(travelModes || travelMode).map(normalizeSearchText));
      if (allowedTypes.size > 0 && !allowedTypes.has(normalizeSearchText(data.relationType))) return false;
      if (allowedModes.size > 0 && !allowedModes.has(normalizeSearchText(data.travelMode))) return false;
      const difficultyLimit = maxDifficulty === undefined || maxDifficulty === null || maxDifficulty === '' ? undefined : Number(maxDifficulty);
      if (Number.isFinite(difficultyLimit) && Number(data.difficulty || 0) > difficultyLimit) return false;
      return true;
    });

    return {
      nodes: [...nodes.values()],
      edges: filteredEdges,
      sources,
      mountedMapIds: mounted.map((record) => normalizeMapId(record.data.mapId || record.id))
    };
  }

  traverseMap({
    startMapId,
    maxDepth = 3,
    includeBlocked = false,
    includeHidden = false,
    relationTypes,
    travelModes,
    limit = 100
  } = {}) {
    const start = normalizeMapId(startMapId);
    const safeDepth = clampInteger(maxDepth, 0, 12);
    const safeLimit = clampInteger(limit, 1, 500);
    const visited = new Set([start]);
    const paths = [];
    const queue = [{ mapId: start, depth: 0, pathMapIds: [start], pathEdgeIds: [] }];

    while (queue.length > 0 && paths.length < safeLimit) {
      const item = queue.shift();
      if (item.depth >= safeDepth) continue;
      const edges = this.listEdges({
        mapId: item.mapId,
        includeBlocked,
        includeHidden,
        relationTypes,
        travelModes,
        limit: MAX_GRAPH_EDGES
      }).records;
      for (const edge of edges) {
        const next = nextFromEdge(edge.data, item.mapId);
        if (!next) continue;
        const nextPath = {
          fromMapId: item.mapId,
          toMapId: next,
          depth: item.depth + 1,
          edgeId: edge.id,
          relationType: edge.data.relationType,
          cost: edgeCost(edge.data),
          pathMapIds: [...item.pathMapIds, next],
          pathEdgeIds: [...item.pathEdgeIds, edge.id]
        };
        paths.push(nextPath);
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({
            mapId: next,
            depth: item.depth + 1,
            pathMapIds: nextPath.pathMapIds,
            pathEdgeIds: nextPath.pathEdgeIds
          });
        }
        if (paths.length >= safeLimit) break;
      }
    }

    return {
      startMapId: start,
      maxDepth: safeDepth,
      visitedMapIds: [...visited],
      paths
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
    mapId,
    includeBlocked = true,
    includeHidden = true,
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const nodes = mapId
      ? [this.getNode(mapId)]
      : this.listNodes({ query, limit, offset }).records;
    const edges = this.listEdges({
      mapId,
      includeBlocked,
      includeHidden,
      query,
      limit,
      offset
    }).records;
    const payload = {
      mapRelationshipGraph: {
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

  ensureNodeExists(mapId) {
    const normalizedMapId = normalizeMapId(mapId);
    const existing = this.dataManager.getRecord(this.nodeCollection, normalizedMapId, { missing: 'undefined' });
    if (existing) return existing;
    return this.upsertNode({
      mapId: normalizedMapId,
      name: normalizedMapId,
      summary: 'Auto-created by map relationship edge.'
    });
  }
}

export function findShortestPath({
  startMapId,
  targetMapId,
  edges = [],
  nodes = [],
  options = {}
} = {}) {
  const start = normalizeMapId(startMapId);
  const target = normalizeMapId(targetMapId);
  const maxDepth = clampInteger(options.maxDepth ?? MAX_PATH_DEPTH, 0, MAX_PATH_DEPTH);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeNodeIds = new Set();
  for (const edge of edges) {
    if (edge?.data?.fromMapId) edgeNodeIds.add(edge.data.fromMapId);
    if (edge?.data?.toMapId) edgeNodeIds.add(edge.data.toMapId);
  }
  const knownStart = nodeById.has(start) || edgeNodeIds.has(start);
  const knownTarget = nodeById.has(target) || edgeNodeIds.has(target);
  const adjacency = buildAdjacency(edges);
  const distances = new Map([[start, 0]]);
  const depthByNode = new Map([[start, 0]]);
  const previous = new Map();
  const queue = new Set([start]);
  const visited = new Set();

  while (queue.size > 0) {
    const current = [...queue].sort((a, b) => (distances.get(a) ?? Infinity) - (distances.get(b) ?? Infinity))[0];
    queue.delete(current);
    if (visited.has(current)) continue;
    visited.add(current);
    if (current === target) break;

    const currentDepth = depthByNode.get(current) || 0;
    if (currentDepth >= maxDepth) continue;

    for (const step of adjacency.get(current) || []) {
      const cost = edgeCost(step.edge.data);
      const total = (distances.get(current) ?? Infinity) + cost;
      if (total < (distances.get(step.to) ?? Infinity)) {
        distances.set(step.to, total);
        depthByNode.set(step.to, currentDepth + 1);
        previous.set(step.to, { from: current, edge: step.edge });
        queue.add(step.to);
      }
    }
  }

  if (!previous.has(target) && start !== target) {
    const missingMapIds = [
      knownStart ? '' : start,
      knownTarget ? '' : target
    ].filter(Boolean);
    return {
      found: false,
      startMapId: start,
      targetMapId: target,
      knownStart,
      knownTarget,
      missingMapIds,
      reason: missingMapIds.length > 0 ? 'missing_map_node' : 'path_not_found',
      maxDepth,
      visitedMapIds: [...visited],
      totalCost: null
    };
  }

  const pathMapIds = [target];
  const pathEdges = [];
  let cursor = target;
  while (cursor !== start) {
    const step = previous.get(cursor);
    if (!step) break;
    pathEdges.push(step.edge);
    cursor = step.from;
    pathMapIds.push(cursor);
  }
  pathMapIds.reverse();
  pathEdges.reverse();

  return {
    found: true,
    startMapId: start,
    targetMapId: target,
    depth: pathEdges.length,
    totalCost: distances.get(target) ?? 0,
    pathMapIds,
    pathEdgeIds: pathEdges.map((edge) => edge.id),
    edges: pathEdges,
    nodes: pathMapIds.map((mapId) => nodeById.get(mapId) || syntheticNode(mapId))
  };
}

function buildAdjacency(edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    const data = edge.data || {};
    addAdjacency(adjacency, data.fromMapId, data.toMapId, edge);
    if (isUndirected(data)) addAdjacency(adjacency, data.toMapId, data.fromMapId, edge);
  }
  return adjacency;
}

function addAdjacency(adjacency, from, to, edge) {
  if (!from || !to) return;
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push({ to, edge });
}

function sceneMountToNode(record) {
  const data = record.data || {};
  const mapId = normalizeMapId(data.mapId || record.id);
  return {
    id: mapId,
    collection: 'scene',
    data: {
      mapId,
      name: data.name,
      type: data.type,
      parentMapId: normalizeOptionalText(data.parentMapId) ? normalizeMapId(data.parentMapId) : '',
      tags: data.tags || [],
      aliases: data.aliases || [],
      summary: data.summary,
      metadata: {
        source: SCENE_MAP_MOUNTS_COLLECTION,
        originalMapId: data.mapId,
        mountId: record.id,
        status: data.status,
        visibility: data.visibility
      }
    }
  };
}

function mapStateToEdges(record) {
  const data = record.data || {};
  const mapId = normalizeMapId(data.mapId || record.id);
  const edges = [];
  for (const exit of normalizeObjectArray(data.exits)) {
    const fromMapId = normalizeOptionalText(exit.fromMapId || exit.from)
      || (exit.fromAreaId ? areaNodeId(mapId, exit.fromAreaId) : mapId);
    const toMapId = normalizeOptionalText(exit.toMapId || exit.targetMapId || exit.mapId || exit.to);
    if (!toMapId) continue;
    edges.push(syntheticEdge({
      id: `state-exit:${record.id}:${exit.id || shortHash(JSON.stringify(exit))}`,
      fromMapId,
      toMapId,
      relationType: exit.relationType || 'exit',
      label: exit.name || exit.label || '',
      direction: normalizeDirection(exit.directionality || exit.edgeDirection || (exit.oneWay ? 'directed' : 'undirected')),
      travelMode: exit.travelMode || exit.mode || 'walk',
      cost: exit.cost ?? exit.travelCost ?? exit.distance ?? 1,
      distance: exit.distance,
      difficulty: exit.difficulty ?? exit.dc,
      status: exit.status || 'open',
      visibility: exit.visibility || (exit.hidden ? 'hidden' : 'visible'),
      requirements: exit.requirements || exit.requires || [],
      conditions: exit.conditions || [],
      summary: exit.summary || '',
      tags: exit.tags || [],
      source: MAP_STRUCTURED_STATE_COLLECTION
    }));
  }
  for (const route of normalizeObjectArray(data.routes)) {
    const fromMapId = normalizeOptionalText(route.fromMapId || route.from)
      || (route.fromAreaId ? areaNodeId(mapId, route.fromAreaId) : mapId);
    const toMapId = normalizeOptionalText(route.toMapId || route.targetMapId || route.to)
      || (route.toAreaId ? areaNodeId(mapId, route.toAreaId) : '');
    if (!fromMapId || !toMapId) continue;
    edges.push(syntheticEdge({
      id: `state-route:${record.id}:${route.id || shortHash(JSON.stringify(route))}`,
      fromMapId,
      toMapId,
      relationType: route.relationType || route.type || 'route',
      label: route.name || route.label || '',
      direction: normalizeDirection(route.direction || (route.oneWay ? 'directed' : 'undirected')),
      travelMode: route.travelMode || route.mode || 'walk',
      cost: route.cost ?? route.travelCost ?? route.distance ?? 1,
      distance: route.distance,
      difficulty: route.difficulty ?? route.dc,
      status: route.status || 'open',
      visibility: route.visibility || (route.hidden ? 'hidden' : 'visible'),
      requirements: route.requirements || route.requires || [],
      conditions: route.conditions || [],
      summary: route.summary || '',
      tags: route.tags || [],
      source: MAP_STRUCTURED_STATE_COLLECTION
    }));
  }
  return edges;
}

function mapStateToNodes(record) {
  const data = record.data || {};
  const mapId = normalizeMapId(data.mapId || record.id);
  return normalizeObjectArray(data.areas)
    .map((area) => {
      const areaId = normalizeOptionalText(area.id || area.areaId || area.name);
      if (!areaId) return undefined;
      const nodeId = areaNodeId(mapId, areaId);
      return {
        id: nodeId,
        collection: 'map_state_area',
        data: {
          mapId: nodeId,
          name: area.name || area.label || areaId,
          type: 'area',
          parentMapId: mapId,
          tags: normalizeStringArray(area.tags),
          aliases: normalizeStringArray(area.aliases),
          summary: normalizeOptionalText(area.summary || area.description),
          metadata: {
            source: MAP_STRUCTURED_STATE_COLLECTION,
            parentMapId: mapId,
            areaId
          }
        }
      };
    })
    .filter(Boolean);
}

function areaNodeId(mapId, areaId) {
  const mapSegment = normalizeMapId(mapId);
  const areaSegment = safeSegment(areaId) || `area_${shortHash(areaId)}`;
  return normalizeMapId(`${mapSegment}:${areaSegment}`);
}

function syntheticNode(mapId, extra = {}) {
  const normalizedMapId = normalizeMapId(mapId);
  return {
    id: normalizedMapId,
    collection: 'synthetic',
    data: {
      mapId: normalizedMapId,
      name: extra.name || normalizedMapId,
      type: extra.type || 'area',
      parentMapId: extra.parentMapId || '',
      tags: [],
      aliases: [],
      summary: '',
      metadata: {
        source: extra.source || 'synthetic'
      }
    }
  };
}

function syntheticEdge(input = {}) {
  const normalized = normalizeMapEdge({
    ...input,
    createMissingNodes: false
  }, { now: () => '' });
  return {
    id: normalized.id,
    collection: 'synthetic',
    data: {
      ...normalized,
      metadata: {
        ...normalized.metadata,
        source: input.source || normalized.metadata?.source || 'synthetic'
      }
    }
  };
}

function normalizeMapNode(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('map relationship node must be a plain object');
  }
  const mapId = normalizeMapId(input.mapId || input.id || input.locationId || input.name);
  return {
    mapId,
    name: normalizeOptionalText(input.name) || mapId,
    type: normalizeOptionalText(input.type || input.mapType || 'area'),
    parentMapId: normalizeOptionalText(input.parentMapId || input.parentId),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    summary: normalizeOptionalText(input.summary || input.description),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

function normalizeMapEdge(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('map relationship edge must be a plain object');
  }
  const fromMapId = normalizeMapId(input.fromMapId || input.from || input.sourceMapId || input.source);
  const toMapId = normalizeMapId(input.toMapId || input.to || input.targetMapId || input.target);
  if (fromMapId === toMapId && !input.allowSelfRelation) {
    throw validationError('map relationship edge cannot connect a map to itself');
  }
  const relationType = normalizeOptionalText(input.relationType || input.type || input.kind || 'path');
  const direction = normalizeDirection(input.direction || (input.directed ? 'directed' : 'undirected'));
  const id = normalizeOptionalText(input.id || input.edgeId)
    || edgeId({ fromMapId, toMapId, relationType, direction, label: input.label });
  return {
    id,
    fromMapId,
    toMapId,
    relationType,
    label: normalizeOptionalText(input.label || input.name),
    direction,
    travelMode: normalizeOptionalText(input.travelMode || input.mode || 'walk'),
    cost: normalizeNonNegativeNumber(input.cost ?? input.travelCost ?? input.weight ?? input.distance ?? 1, 'cost'),
    distance: normalizeOptionalNumber(input.distance, 'distance'),
    difficulty: normalizeOptionalNumber(input.difficulty ?? input.dc, 'difficulty'),
    status: normalizeOptionalText(input.status || 'open'),
    visibility: normalizeOptionalText(input.visibility || (input.hidden ? 'hidden' : 'known')),
    requirements: normalizeArrayOrObject(input.requirements || input.requires),
    conditions: normalizeArrayOrObject(input.conditions),
    evidence: normalizeOptionalText(input.evidence || input.sourceText),
    summary: normalizeOptionalText(input.summary || input.description),
    tags: normalizeStringArray(input.tags),
    metadata: normalizeObject(input.metadata),
    graphUpdatedAt: now()
  };
}

function extractGraphDocument(data) {
  const root = data?.mapRelationshipGraph || data?.map_relationship_graph || data?.mapGraph || data || {};
  const nodes = [
    ...normalizeArray(root.nodes),
    ...normalizeArray(root.maps),
    ...normalizeArray(root.locations)
  ];
  const edges = [
    ...normalizeArray(root.edges),
    ...normalizeArray(root.links),
    ...normalizeArray(root.routes),
    ...normalizeArray(root.paths)
  ];
  return { nodes, edges };
}

function matchesNode(record, { requiredTags, normalizedQuery }) {
  const data = record.data || {};
  if (requiredTags.length > 0) {
    const nodeTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
    if (!requiredTags.every((tag) => nodeTags.has(tag))) return false;
  }
  if (!normalizedQuery) return true;
  return normalizeSearchText([
    record.id,
    data.mapId,
    data.name,
    data.type,
    data.parentMapId,
    data.summary,
    ...(Array.isArray(data.tags) ? data.tags : []),
    ...(Array.isArray(data.aliases) ? data.aliases : [])
  ].filter(Boolean).join(' ')).includes(normalizedQuery);
}

function matchesEdgeQuery(record, normalizedQuery) {
  const data = record.data || {};
  return normalizeSearchText([
    record.id,
    data.fromMapId,
    data.toMapId,
    data.relationType,
    data.label,
    data.travelMode,
    data.status,
    data.visibility,
    data.summary,
    data.evidence,
    ...(Array.isArray(data.tags) ? data.tags : [])
  ].filter(Boolean).join(' ')).includes(normalizedQuery);
}

function edgeTouches(data, mapId, { includeIncoming = true, includeOutgoing = true } = {}) {
  if (includeOutgoing && data.fromMapId === mapId) return true;
  if (includeIncoming && data.toMapId === mapId) return true;
  if (isUndirected(data)) {
    if (includeOutgoing && data.toMapId === mapId) return true;
    if (includeIncoming && data.fromMapId === mapId) return true;
  }
  return false;
}

function nextFromEdge(data, mapId) {
  if (data.fromMapId === mapId) return data.toMapId;
  if (isUndirected(data) && data.toMapId === mapId) return data.fromMapId;
  return '';
}

function edgeCost(data = {}) {
  const cost = Number(data.cost ?? data.travelCost ?? data.distance ?? 1);
  return Number.isFinite(cost) && cost >= 0 ? cost : 1;
}

function isBlockedEdge(data = {}) {
  return BLOCKED_STATUSES.has(normalizeSearchText(data.status));
}

function isHiddenEdge(data = {}) {
  return HIDDEN_VISIBILITIES.has(normalizeSearchText(data.visibility));
}

function isInactiveMount(data = {}) {
  return ['inactive', 'removed', 'unreachable', 'collapsed'].includes(normalizeSearchText(data.status));
}

function isUndirected(data = {}) {
  const direction = normalizeDirection(data.direction);
  return direction === 'undirected' || direction === 'mutual';
}

function edgeId({ fromMapId, toMapId, relationType, direction, label }) {
  const a = safeSegment(fromMapId);
  const b = safeSegment(toMapId);
  const type = safeSegment(relationType || 'path');
  const suffix = label ? `_${shortHash(label)}` : '';
  if (isUndirected({ direction })) {
    const [first, second] = [a, b].sort();
    return `mapedge_${type}_${first}_${second}${suffix}`.slice(0, 128);
  }
  return `mapedge_${type}_${a}_${b}${suffix}`.slice(0, 128);
}

export function normalizeMapId(value) {
  const base = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return base || `map_${shortHash(value)}`;
}

function normalizeDirection(value) {
  const normalized = normalizeSearchText(value || 'undirected').replace(/-/g, '_');
  if (['directed', 'one_way', 'oneway'].includes(normalized)) return 'directed';
  if (['mutual', 'bidirectional', 'bi_directional', 'two_way', 'twoway', 'undirected'].includes(normalized)) return 'undirected';
  return 'undirected';
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeObjectArray(value) {
  return normalizeArray(value).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
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

function normalizeOptionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be numeric`);
  return number;
}

function normalizeNonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw validationError(`${field} must be a non-negative number`);
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

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || 'current';
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
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

function validationError(message) {
  const error = new Error(message);
  error.name = 'MapRelationshipGraphValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'map-edge');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
