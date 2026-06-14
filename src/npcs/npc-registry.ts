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

export const NPC_REGISTRY_COLLECTION = 'npc_registry';

export const NPC_REGISTRY_FIELDS = [
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'actorType', type: 'text', description: 'Actor class: npc, player, companion, summon, monster, etc. Players are special NPC/actor records.' },
  { name: 'isPlayer', type: 'boolean', description: 'Whether this registry entry represents a player-controlled protagonist actor.' },
  { name: 'playerId', type: 'text', description: 'Optional player/protagonist identity id for player actors and protagonist switching.' },
  { name: 'role', type: 'text', description: 'L0 role label, e.g. player-character, investigator, guard captain, merchant.' },
  { name: 'importance', type: 'text', description: 'minor, supporting, major, or key.' },
  { name: 'tags', type: 'json', description: 'Search and mounting tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names used by players or documents.' },
  { name: 'currentLocation', type: 'text', description: 'Current known location id or label.' },
  { name: 'profileRef', type: 'text', description: 'Reference to full NPC profile or character card.' },
  { name: 'status', type: 'text', description: 'active, inactive, missing, dead, hidden, etc.' },
  { name: 'summary', type: 'text', description: 'Short L0/L1 bridge summary; keep it compact.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt registry metadata.' },
  ...RESOURCE_LIFECYCLE_FIELDS
];

const NPC_VISUAL_METADATA_KEYS = [
  'image',
  'imageUrl',
  'imageUri',
  'avatar',
  'avatarUrl',
  'portrait',
  'portraitUrl',
  'portraitImage',
  'cg',
  'cgUrl',
  'sprite',
  'spriteUrl',
  'token',
  'tokenUrl',
  'visual',
  'assets',
  'media'
];

export class NpcRegistry {
  constructor({
    dataManager = new SQLiteDataManager(),
    collection = NPC_REGISTRY_COLLECTION,
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
      add: NPC_REGISTRY_FIELDS,
      reason: 'npcRegistry:L0'
    });
    return this.describe();
  }

  describe() {
    return this.dataManager.describeCollection(this.collection);
  }

  upsertNpc(npc) {
    const normalized = normalizeNpcRecord(npc, { now: this.now });
    return this.dataManager.upsertRecord(this.collection, normalized, { id: normalized.id });
  }

  patchNpc(id, patch) {
    const current = this.getNpc(id);
    const normalized = normalizeNpcRecord({
      ...current.data,
      ...patch,
      id: current.id,
      lifecycleCanonicalId: current.data.lifecycleCanonicalId || id
    }, { partial: false, now: this.now });
    return this.dataManager.upsertRecord(this.collection, normalized, { id: current.id });
  }

  getNpc(id) {
    return getVisibleRecordByLifecycle(this.dataManager, this.collection, id, {}, { appDatabase: this.appDatabase })
      || this.dataManager.getRecord(this.collection, id);
  }

  deleteNpc(id) {
    return this.dataManager.deleteRecord(this.collection, id);
  }

  listNpcs(input = {}) {
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
    const requiredTags = normalizeStringArray(tags);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (requiredTags.length > 0) {
        const npcTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => npcTags.has(normalizeSearchText(tag)))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          data.name,
          data.actorType,
          data.playerId,
          data.role,
          data.importance,
          data.currentLocation,
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
      records
    };
  }

  importDocument(input = {}) {
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        npcs: this.collection,
        npc_registry: this.collection,
        characters: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectNpcRecords(groups, input.collection || this.collection);
    const imported = selected.map((record) => this.upsertNpc({
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
    const listed = this.listNpcs({ filter, tags, query, limit, offset });
    const payload = {
      npcs: listed.records.map((record) => ({
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

export function normalizeNpcRecord(input = {}, { partial = false, now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('npc must be a plain object');
  }

  const name = normalizeOptionalText(input.name);
  if (!partial && !name) throw validationError('npc.name is required');
  const id = normalizeNpcId(input.id || input.npcId || name);
  const actorType = normalizeActorType(input.actorType ?? input.type ?? (input.isPlayer || input.playerId ? 'player' : 'npc'));
  const isPlayer = normalizeBoolean(input.isPlayer ?? input.player ?? input.playerControlled ?? actorType === 'player');

  return {
    id,
    name: name || id,
    actorType: isPlayer ? 'player' : actorType,
    isPlayer,
    playerId: normalizeOptionalText(input.playerId ?? input.protagonistId),
    role: normalizeOptionalText(input.role) || (isPlayer ? 'player-character' : ''),
    importance: normalizeImportance(input.importance ?? (isPlayer ? 'key' : 'minor')),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    currentLocation: normalizeOptionalText(input.currentLocation ?? input.location),
    profileRef: normalizeOptionalText(input.profileRef ?? input.profile ?? input.characterCardRef),
    status: normalizeOptionalText(input.status || 'active'),
    summary: normalizeOptionalText(input.summary),
    metadata: normalizeMetadata(input),
    ...resourceLifecycleFields(input),
    registryUpdatedAt: now()
  };
}

function normalizeActorType(value) {
  const normalized = String(value || 'npc').trim().toLowerCase();
  if (['pc', 'player-character', 'player_character', 'protagonist'].includes(normalized)) return 'player';
  return normalized || 'npc';
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on', 'player', 'pc'].includes(normalized);
}

function selectNpcRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const npcs = groups.find((group) => ['npcs', 'npc_registry', NPC_REGISTRY_COLLECTION].includes(group.collection));
  const selected = preferred || npcs || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function normalizeNpcId(value) {
  const base = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return base || `npc_${shortHash(value)}`;
}

function normalizeImportance(value) {
  const normalized = String(value || 'minor').toLowerCase();
  if (['minor', 'supporting', 'major', 'key'].includes(normalized)) return normalized;
  return 'minor';
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
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
  for (const key of NPC_VISUAL_METADATA_KEYS) {
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
  error.name = 'NpcRegistryValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'npc');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
