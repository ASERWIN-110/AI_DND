// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';
import {
  RESOURCE_LIFECYCLE_FIELDS,
  filterRecordsByLifecycle,
  getVisibleRecordByLifecycle,
  resourceLifecycleFields
} from '../lifecycle/resource-lifecycle.js';

export const MAP_REGISTRY_COLLECTION = 'map_registry';

export const MAP_REGISTRY_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'type', type: 'text', description: 'world, region, city, district, building, room, dungeon, encounter, etc.' },
  { name: 'parentMapId', type: 'text', description: 'Parent location or map id.' },
  { name: 'tags', type: 'json', description: 'Search and mounting tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names used by players or documents.' },
  { name: 'summary', type: 'text', description: 'Compact L0 map summary.' },
  { name: 'description', type: 'text', description: 'Longer user-authored map description.' },
  { name: 'environment', type: 'json', description: 'Terrain, weather, lighting, climate, hazards, or ambiance.' },
  { name: 'factionRefs', type: 'json', description: 'Related faction ids or labels.' },
  { name: 'npcRefs', type: 'json', description: 'Resident or related NPC ids.' },
  { name: 'entryPoints', type: 'json', description: 'Known entrances, exits, or access points.' },
  { name: 'status', type: 'text', description: 'active, hidden, destroyed, sealed, unknown, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS,
  { name: 'registryUpdatedAt', type: 'text', description: 'Latest registry update timestamp.' }
];

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

export class MapRegistry {
  constructor({
    dataManager = new SQLiteDataManager(),
    collection = MAP_REGISTRY_COLLECTION,
    appDatabase,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.collection = collection;
    this.appDatabase = appDatabase;
    this.now = now || (() => new Date().toISOString());
    this.ensureRegistry();
  }

  ensureRegistry() {
    this.dataManager.ensureCollection(this.collection);
    this.dataManager.alterFields(this.collection, {
      add: MAP_REGISTRY_FIELDS,
      reason: 'mapRegistry:L0'
    });
    return this.describe();
  }

  describe() {
    return this.dataManager.describeCollection(this.collection);
  }

  upsertMap(map) {
    const normalized = normalizeMapRecord(map, { now: this.now });
    return this.dataManager.upsertRecord(this.collection, normalized, { id: normalized.id });
  }

  patchMap(id, patch) {
    const current = this.getMap(id);
    const normalized = normalizeMapRecord({
      ...current.data,
      ...patch,
      id: current.id,
      lifecycleCanonicalId: current.data.lifecycleCanonicalId || id
    }, { now: this.now });
    return this.dataManager.upsertRecord(this.collection, normalized, { id: current.id });
  }

  getMap(id) {
    return getVisibleRecordByLifecycle(this.dataManager, this.collection, id, {}, { appDatabase: this.appDatabase })
      || this.dataManager.getRecord(this.collection, id);
  }

  deleteMap(id) {
    return this.dataManager.deleteRecord(this.collection, id);
  }

  listMaps(input = {}) {
    const {
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
    } = input;
    const result = filterRecordsByLifecycle(this.dataManager.queryRecords(this.collection, {
      filter,
      sort,
      limit,
      offset
    }), input, { appDatabase: this.appDatabase });
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (requiredTags.length > 0) {
        const mapTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => mapTags.has(tag))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          record.id,
          data.name,
          data.type,
          data.parentMapId,
          data.summary,
          data.description,
          ...(Array.isArray(data.tags) ? data.tags : []),
          ...(Array.isArray(data.aliases) ? data.aliases : []),
          ...(Array.isArray(data.factionRefs) ? data.factionRefs : []),
          ...(Array.isArray(data.npcRefs) ? data.npcRefs : [])
        ].filter(Boolean).join(' '));
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });

    return {
      ...result,
      records
    };
  }

  importDocument(input = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        maps: this.collection,
        map_registry: this.collection,
        locations: this.collection,
        places: this.collection,
        areas: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectMapRecords(groups, input.collection || this.collection);
    const imported = selected.map((record) => this.upsertMap({
      ...lifecycleImportDefaults(input),
      ...record,
      importSource: input.source || 'document-import'
    }));

    return {
      format: parsed.format,
      collection: this.collection,
      count: imported.length,
      ids: imported.map((record) => record.id),
      records: imported
    };
  }

  exportDocument({
    format = 'json',
    filter = {},
    tags = [],
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listMaps({ filter, tags, query, limit, offset });
    const payload = {
      maps: listed.records.map((record) => ({
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
}

export function normalizeMapRecord(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('map must be a plain object');
  }

  const name = normalizeOptionalText(input.name);
  if (!name) throw validationError('map.name is required');
  const id = normalizeMapId(input.id || input.mapId || input.locationId || name);

  return {
    id,
    name,
    type: normalizeMapType(input.type),
    parentMapId: normalizeOptionalText(input.parentMapId ?? input.parentId ?? input.regionId),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    summary: normalizeOptionalText(input.summary),
    description: normalizeOptionalText(input.description || input.text),
    environment: normalizeObject(input.environment),
    factionRefs: normalizeStringArray(input.factionRefs || input.factions),
    npcRefs: normalizeStringArray(input.npcRefs || input.npcs),
    entryPoints: normalizeArray(input.entryPoints || input.entries || input.exits),
    status: normalizeOptionalText(input.status || 'active'),
    metadata: normalizeMetadata(input),
    ...resourceLifecycleFields(input),
    registryUpdatedAt: now()
  };
}

function selectMapRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const maps = groups.find((group) => ['maps', 'map_registry', MAP_REGISTRY_COLLECTION, 'locations', 'places', 'areas'].includes(group.collection));
  const selected = preferred || maps || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

export function normalizeMapId(value) {
  const base = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return base || `map_${shortHash(value)}`;
}

function normalizeMapType(value) {
  const normalized = String(value || 'area').toLowerCase();
  if ([
    'world',
    'region',
    'city',
    'district',
    'building',
    'room',
    'dungeon',
    'encounter',
    'area',
    'route',
    'landmark'
  ].includes(normalized)) return normalized;
  return 'area';
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

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeMetadata(input) {
  const metadata = {
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {})
  };
  for (const key of ['source', 'importSource', 'campaignId', 'chatSessionId', 'characterCardId']) {
    if (input[key] !== undefined) metadata[key] = input[key];
  }
  for (const key of MAP_VISUAL_METADATA_KEYS) {
    if (input[key] !== undefined) metadata[key] = input[key];
  }
  if (input.metadata?.resourceLifecycle) metadata.resourceLifecycle = input.metadata.resourceLifecycle;
  return metadata;
}

function lifecycleImportDefaults(input = {}) {
  return {
    resourceLifecycle: input.resourceLifecycle,
    lifecycleScope: input.lifecycleScope,
    lifecycleLevel: input.lifecycleLevel,
    importanceLevel: input.importanceLevel,
    characterCardId: input.characterCardId,
    chatSessionId: input.chatSessionId
  };
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'MapRegistryValidationError';
  error.statusCode = 400;
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
