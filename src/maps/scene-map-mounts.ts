// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { MapRegistry } from './map-registry.js';

export const SCENE_MAP_MOUNTS_COLLECTION = 'scene_map_mounts';

export const SCENE_MAP_MOUNT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'sceneId', type: 'text', description: 'Current scene id or label. Use "current" when no scene id exists yet.' },
  { name: 'mapId', type: 'text', description: 'Map registry id or local map id.' },
  { name: 'name', type: 'text', description: 'Display name used in the current scene.' },
  { name: 'type', type: 'text', description: 'world, region, city, district, building, room, dungeon, encounter, area, etc.' },
  { name: 'parentMapId', type: 'text', description: 'Parent mounted map or global map id.' },
  { name: 'tags', type: 'json', description: 'Scene search tags.' },
  { name: 'aliases', type: 'json', description: 'Names players may use in this scene.' },
  { name: 'status', type: 'text', description: 'active, visible, hidden, discovered, locked, blocked, collapsed, unreachable, etc.' },
  { name: 'visibility', type: 'text', description: 'visible, hidden, unknown, fogged, secret, or offscreen.' },
  { name: 'locationLabel', type: 'text', description: 'Local label inside the scene.' },
  { name: 'registryRef', type: 'text', description: 'Reference to the L0 map registry entry.' },
  { name: 'summary', type: 'text', description: 'Compact scene-specific map reminder for prompt injection.' },
  { name: 'mountReason', type: 'text', description: 'Why this map is currently mounted.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, scene-switch, etc.' },
  { name: 'orderIndex', type: 'integer', description: 'Optional stable display order.' },
  { name: 'overrides', type: 'json', description: 'Scene-only map overrides.' },
  { name: 'metadata', type: 'json', description: 'Extra mount metadata.' },
  { name: 'mountedAt', type: 'text', description: 'First mount timestamp.' },
  { name: 'lastSeenAt', type: 'text', description: 'Latest observed timestamp.' },
  { name: 'sceneUpdatedAt', type: 'text', description: 'Latest scene mount update timestamp.' }
];

const DEFAULT_SCENE_ID = 'current';
const INACTIVE_STATUSES = new Set(['inactive', 'removed', 'unreachable', 'collapsed']);
const MAP_VISUAL_METADATA_KEYS = [
  'image',
  'imageUrl',
  'imageUri',
  'background',
  'backgroundUrl',
  'backgroundImage',
  'backgroundImageUrl',
  'cg',
  'cgUrl',
  'visual',
  'assets',
  'media'
];

export class SceneMapMountManager {
  constructor({
    appDatabase,
    mapRegistry,
    dataManager,
    collection = SCENE_MAP_MOUNTS_COLLECTION,
    now
  } = {}) {
    if (!appDatabase) throw validationError('SceneMapMountManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.mapRegistry = mapRegistry || (dataManager ? new MapRegistry({ dataManager }) : undefined);
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
  }

  ensureSceneCollection(chatSessionId) {
    const database = this.appDatabase.ensureChatDataDatabase(chatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: SCENE_MAP_MOUNT_FIELDS,
      reason: 'sceneMapMounts:currentScene'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return this.ensureSceneCollection(chatSessionId);
  }

  mountMap(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const registryRecord = this.resolveRegistryMap(input);
    const existing = input.id
      ? manager.getRecord(this.collection, input.id, { missing: 'undefined' })
      : undefined;
    const normalized = normalizeSceneMapMount(input, {
      chatSessionId,
      now: this.now,
      registryRecord,
      existing: existing?.data
    });
    return manager.upsertRecord(this.collection, normalized, { id: normalized.id });
  }

  patchMountedMap(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const patch = input.patch || {};
    const current = this.resolveMountedMap({
      chatSessionId,
      id: input.id,
      mapId: input.mapId,
      sceneId: input.sceneId
    });
    const { manager } = this.openManager(chatSessionId);
    const registryRecord = this.resolveRegistryMap({
      ...current.data,
      ...patch,
      mapId: patch.mapId || patch.registryId || current.data.mapId
    });
    const normalized = normalizeSceneMapMount({
      ...current.data,
      ...patch,
      id: current.id,
      chatSessionId
    }, {
      chatSessionId,
      now: this.now,
      registryRecord,
      existing: current.data
    });
    return manager.upsertRecord(this.collection, normalized, { id: current.id });
  }

  getMountedMap(input = {}) {
    return this.resolveMountedMap(input);
  }

  listMountedMaps({
    chatSessionId,
    sceneId = DEFAULT_SCENE_ID,
    includeInactive = false,
    status,
    visibility,
    tags = [],
    query = '',
    filter = {},
    sort = [{ field: 'orderIndex', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = {
      ...filter,
      sceneId: normalizeSceneId(sceneId)
    };
    if (status) mergedFilter.status = String(status);
    if (visibility) mergedFilter.visibility = String(visibility);

    const result = manager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (!includeInactive && INACTIVE_STATUSES.has(String(data.status || '').toLowerCase())) return false;
      if (requiredTags.length > 0) {
        const mapTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => mapTags.has(tag))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          record.id,
          data.mapId,
          data.name,
          data.type,
          data.status,
          data.visibility,
          data.locationLabel,
          data.parentMapId,
          data.summary,
          ...(Array.isArray(data.tags) ? data.tags : []),
          ...(Array.isArray(data.aliases) ? data.aliases : [])
        ].filter(Boolean).join(' '));
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    return {
      ...result,
      sceneId: normalizeSceneId(sceneId),
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  unmountMap(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const mode = String(input.mode || 'delete');
    const current = this.resolveMountedMap(input);
    const { manager } = this.openManager(chatSessionId);
    if (mode === 'markInactive' || mode === 'mark-inactive') {
      const timestamp = this.now();
      const record = manager.patchRecord(this.collection, current.id, {
        status: 'inactive',
        sceneUpdatedAt: timestamp,
        lastSeenAt: timestamp,
        source: input.source || 'agent'
      });
      return {
        collection: this.collection,
        id: current.id,
        deleted: false,
        mode: 'markInactive',
        record
      };
    }
    return manager.deleteRecord(this.collection, current.id);
  }

  clearSceneMaps({
    chatSessionId,
    sceneId = DEFAULT_SCENE_ID,
    mode = 'delete',
    includeInactive = true,
    source = 'scene-clear'
  } = {}) {
    const listed = this.listMountedMaps({
      chatSessionId,
      sceneId,
      includeInactive,
      limit: 500
    });
    const results = listed.records.map((record) => this.unmountMap({
      chatSessionId,
      id: record.id,
      mode,
      source
    }));
    return {
      chatSessionId: listed.chatSessionId,
      sceneId: listed.sceneId,
      mode,
      count: results.length,
      results
    };
  }

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId);
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        scene_maps: this.collection,
        sceneMapMounts: this.collection,
        mounted_maps: this.collection,
        mountedMaps: this.collection,
        maps: this.collection,
        locations: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectMountRecords(groups, input.collection || this.collection);
    const records = selected.map((record) => this.mountMap({
      ...record,
      chatSessionId,
      sceneId: record.sceneId || sceneId,
      source: input.source || record.source || 'document-import'
    }));
    return {
      format: parsed.format,
      chatSessionId,
      sceneId,
      collection: this.collection,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    sceneId = DEFAULT_SCENE_ID,
    format = 'json',
    includeInactive = true,
    tags = [],
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listMountedMaps({
      chatSessionId,
      sceneId,
      includeInactive,
      tags,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      sceneId: listed.sceneId,
      sceneMaps: listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }))
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

  openManager(chatSessionId) {
    this.ensureSceneCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }

  resolveMountedMap({ chatSessionId, id, mapId, sceneId = DEFAULT_SCENE_ID } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    if (id) return manager.getRecord(this.collection, id);

    const normalizedMapId = normalizeOptionalText(mapId);
    if (!normalizedMapId) throw validationError('id or mapId is required');
    const listed = this.listMountedMaps({
      chatSessionId: normalizedChatSessionId,
      sceneId,
      includeInactive: true,
      filter: {
        mapId: normalizedMapId
      },
      limit: 2
    });
    if (listed.records.length === 0) {
      throw notFound(`Scene map mount not found: ${normalizedMapId}`);
    }
    if (listed.records.length > 1) {
      throw validationError(`Multiple scene map mounts matched mapId: ${normalizedMapId}; use id`);
    }
    return listed.records[0];
  }

  resolveRegistryMap(input = {}) {
    if (!this.mapRegistry) return undefined;
    const mapId = normalizeOptionalText(input.registryId || input.mapId);
    if (!mapId) return undefined;
    try {
      return this.mapRegistry.getMap(mapId);
    } catch {
      return undefined;
    }
  }
}

export function normalizeSceneMapMount(input = {}, {
  chatSessionId,
  now = () => new Date().toISOString(),
  registryRecord,
  existing
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('scene map mount must be a plain object');
  }

  const registryData = registryRecord?.data || {};
  const resolvedChatSessionId = normalizeRequiredText(chatSessionId || input.chatSessionId, 'chatSessionId');
  const sceneId = normalizeSceneId(input.sceneId ?? existing?.sceneId);
  const mapId = normalizeOptionalText(input.mapId || input.registryId || registryRecord?.id || existing?.mapId);
  const name = normalizeOptionalText(input.name ?? registryData.name ?? existing?.name);
  if (!mapId && !name) throw validationError('scene map mount requires mapId or name');

  const timestamp = now();
  const resolvedMapId = mapId || normalizeGeneratedId(name, 'map');
  const id = normalizeOptionalText(input.id || existing?.id) || mountId(sceneId, resolvedMapId);

  return {
    id,
    chatSessionId: resolvedChatSessionId,
    sceneId,
    mapId: resolvedMapId,
    name: name || registryData.name || resolvedMapId,
    type: normalizeOptionalText(input.type ?? registryData.type ?? existing?.type) || 'area',
    parentMapId: normalizeOptionalText(input.parentMapId ?? registryData.parentMapId ?? existing?.parentMapId),
    tags: mergeStringArrays(registryData.tags, existing?.tags, input.tags),
    aliases: mergeStringArrays(registryData.aliases, existing?.aliases, input.aliases),
    status: normalizeOptionalText(input.status ?? existing?.status ?? 'active'),
    visibility: normalizeOptionalText(input.visibility ?? existing?.visibility ?? 'visible'),
    locationLabel: normalizeOptionalText(input.locationLabel ?? input.location ?? existing?.locationLabel),
    registryRef: normalizeOptionalText(input.registryRef ?? registryRecord?.id ?? existing?.registryRef),
    summary: normalizeOptionalText(input.summary ?? registryData.summary ?? existing?.summary),
    mountReason: normalizeOptionalText(input.mountReason ?? input.reason ?? existing?.mountReason),
    source: normalizeOptionalText(input.source ?? existing?.source ?? 'agent'),
    orderIndex: normalizeOptionalInteger(input.orderIndex ?? existing?.orderIndex),
    overrides: normalizeObject(input.overrides ?? existing?.overrides),
    metadata: mergeMetadata(
      registryData.metadata,
      existing?.metadata,
      input.metadata,
      visualMetadataFrom(input, MAP_VISUAL_METADATA_KEYS)
    ),
    mountedAt: normalizeOptionalText(existing?.mountedAt) || timestamp,
    lastSeenAt: timestamp,
    sceneUpdatedAt: timestamp
  };
}

function selectMountRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const mounts = groups.find((group) => [
    'scene_maps',
    'sceneMapMounts',
    'mounted_maps',
    'mountedMaps',
    'maps',
    SCENE_MAP_MOUNTS_COLLECTION
  ].includes(group.collection));
  const selected = preferred || mounts || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function mountId(sceneId, mapId) {
  return `scenemap_${safeSegment(sceneId)}_${safeSegment(mapId)}`.slice(0, 128);
}

function normalizeGeneratedId(value, prefix) {
  return safeSegment(value) || `${prefix}_${shortHash(value)}`;
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || DEFAULT_SCENE_ID;
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) throw validationError(`Expected integer, got: ${value}`);
  return number;
}

function mergeStringArrays(...values) {
  return [...new Set(values.flatMap(normalizeStringArray))];
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeMetadata(...values) {
  const merged = {};
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(merged, value);
    }
  }
  return merged;
}

function visualMetadataFrom(input = {}, keys = []) {
  const metadata = {};
  for (const key of keys) {
    if (input[key] !== undefined) metadata[key] = input[key];
  }
  return metadata;
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

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'SceneMapMountValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'SceneMapMountNotFoundError';
  error.statusCode = 404;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'map');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
