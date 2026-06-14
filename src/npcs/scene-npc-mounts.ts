// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { NpcRegistry } from './npc-registry.js';

export const SCENE_NPC_MOUNTS_COLLECTION = 'scene_npc_mounts';

export const SCENE_NPC_MOUNT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'sceneId', type: 'text', description: 'Current scene id or label. Use "current" when no scene id exists yet.' },
  { name: 'npcId', type: 'text', description: 'NPC registry id or local NPC id.' },
  { name: 'name', type: 'text', description: 'Display name used in the current scene.' },
  { name: 'actorType', type: 'text', description: 'Actor class: npc, player, companion, summon, monster, etc.' },
  { name: 'isPlayer', type: 'boolean', description: 'Whether this mounted actor is a player-controlled protagonist.' },
  { name: 'playerId', type: 'text', description: 'Optional player/protagonist identity id for player actors.' },
  { name: 'role', type: 'text', description: 'Scene-facing role or identity.' },
  { name: 'importance', type: 'text', description: 'minor, supporting, major, or key.' },
  { name: 'tags', type: 'json', description: 'Scene search tags.' },
  { name: 'aliases', type: 'json', description: 'Names players may use in this scene.' },
  { name: 'status', type: 'text', description: 'present, nearby, hidden, departed, inactive, dead, etc.' },
  { name: 'visibility', type: 'text', description: 'visible, hidden, unknown, disguised, or offscreen.' },
  { name: 'disposition', type: 'text', description: 'ally, neutral, hostile, wary, afraid, etc.' },
  { name: 'locationLabel', type: 'text', description: 'Local position inside the scene.' },
  { name: 'profileRef', type: 'text', description: 'Reference to the full profile or character card.' },
  { name: 'registryRef', type: 'text', description: 'Reference to the L0 NPC registry entry.' },
  { name: 'summary', type: 'text', description: 'Compact scene-specific reminder for prompt injection.' },
  { name: 'mountReason', type: 'text', description: 'Why this NPC is currently mounted.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, scene-switch, etc.' },
  { name: 'orderIndex', type: 'integer', description: 'Optional stable display order.' },
  { name: 'overrides', type: 'json', description: 'Scene-only prompt/profile overrides.' },
  { name: 'metadata', type: 'json', description: 'Extra mount metadata.' },
  { name: 'mountedAt', type: 'text', description: 'First mount timestamp.' },
  { name: 'lastSeenAt', type: 'text', description: 'Latest observed timestamp.' },
  { name: 'sceneUpdatedAt', type: 'text', description: 'Latest scene mount update timestamp.' }
];

const DEFAULT_SCENE_ID = 'current';
const INACTIVE_STATUSES = new Set(['inactive', 'departed', 'dead', 'removed']);
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

export class SceneNpcMountManager {
  constructor({
    appDatabase,
    npcRegistry,
    dataManager,
    collection = SCENE_NPC_MOUNTS_COLLECTION,
    now
  } = {}) {
    if (!appDatabase) throw validationError('SceneNpcMountManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.npcRegistry = npcRegistry || (dataManager ? new NpcRegistry({ dataManager }) : undefined);
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
  }

  ensureSceneCollection(chatSessionId) {
    const database = this.appDatabase.ensureChatDataDatabase(chatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: SCENE_NPC_MOUNT_FIELDS,
      reason: 'sceneNpcMounts:currentScene'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return this.ensureSceneCollection(chatSessionId);
  }

  mountNpc(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const registryRecord = this.resolveRegistryNpc(input);
    const existing = input.id
      ? manager.getRecord(this.collection, input.id, { missing: 'undefined' })
      : undefined;
    const normalized = normalizeSceneNpcMount(input, {
      chatSessionId,
      now: this.now,
      registryRecord,
      existing: existing?.data
    });
    return manager.upsertRecord(this.collection, normalized, { id: normalized.id });
  }

  patchMountedNpc(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const patch = input.patch || {};
    const current = this.resolveMountedNpc({
      chatSessionId,
      id: input.id,
      npcId: input.npcId,
      sceneId: input.sceneId
    });
    const { manager } = this.openManager(chatSessionId);
    const registryRecord = this.resolveRegistryNpc({
      ...current.data,
      ...patch,
      npcId: patch.npcId || patch.registryId || current.data.npcId
    });
    const normalized = normalizeSceneNpcMount({
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

  getMountedNpc(input = {}) {
    return this.resolveMountedNpc(input);
  }

  listMountedNpcs({
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
        const npcTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => npcTags.has(tag))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          data.name,
          data.npcId,
          data.actorType,
          data.playerId,
          data.role,
          data.importance,
          data.status,
          data.visibility,
          data.disposition,
          data.locationLabel,
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

  unmountNpc(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const mode = String(input.mode || 'delete');
    const current = this.resolveMountedNpc(input);
    const { manager } = this.openManager(chatSessionId);
    if (mode === 'markDeparted' || mode === 'mark-departed') {
      const timestamp = this.now();
      const record = manager.patchRecord(this.collection, current.id, {
        status: 'departed',
        sceneUpdatedAt: timestamp,
        lastSeenAt: timestamp,
        source: input.source || 'agent'
      });
      return {
        collection: this.collection,
        id: current.id,
        deleted: false,
        mode: 'markDeparted',
        record
      };
    }
    return manager.deleteRecord(this.collection, current.id);
  }

  clearSceneNpcs({
    chatSessionId,
    sceneId = DEFAULT_SCENE_ID,
    mode = 'delete',
    includeInactive = true,
    source = 'scene-clear'
  } = {}) {
    const listed = this.listMountedNpcs({
      chatSessionId,
      sceneId,
      includeInactive,
      limit: 500
    });
    const results = listed.records.map((record) => this.unmountNpc({
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
        scene_npcs: this.collection,
        sceneNpcMounts: this.collection,
        mounted_npcs: this.collection,
        mountedNpcs: this.collection,
        npcs: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectMountRecords(groups, input.collection || this.collection);
    const records = selected.map((record) => this.mountNpc({
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
    const listed = this.listMountedNpcs({
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
      sceneNpcs: listed.records.map((record) => ({
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

  resolveMountedNpc({ chatSessionId, id, npcId, sceneId = DEFAULT_SCENE_ID } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    if (id) return manager.getRecord(this.collection, id);

    const normalizedNpcId = normalizeOptionalText(npcId);
    if (!normalizedNpcId) throw validationError('id or npcId is required');
    const listed = this.listMountedNpcs({
      chatSessionId: normalizedChatSessionId,
      sceneId,
      includeInactive: true,
      filter: {
        npcId: normalizedNpcId
      },
      limit: 2
    });
    if (listed.records.length === 0) {
      throw notFound(`Scene NPC mount not found: ${normalizedNpcId}`);
    }
    if (listed.records.length > 1) {
      throw validationError(`Multiple scene NPC mounts matched npcId: ${normalizedNpcId}; use id`);
    }
    return listed.records[0];
  }

  resolveRegistryNpc(input = {}) {
    if (!this.npcRegistry) return undefined;
    const npcId = normalizeOptionalText(input.registryId || input.npcId);
    if (!npcId) return undefined;
    try {
      return this.npcRegistry.getNpc(npcId);
    } catch {
      return undefined;
    }
  }
}

export function normalizeSceneNpcMount(input = {}, {
  chatSessionId,
  now = () => new Date().toISOString(),
  registryRecord,
  existing
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('scene NPC mount must be a plain object');
  }

  const registryData = registryRecord?.data || {};
  const resolvedChatSessionId = normalizeRequiredText(chatSessionId || input.chatSessionId, 'chatSessionId');
  const sceneId = normalizeSceneId(input.sceneId ?? existing?.sceneId);
  const npcId = normalizeOptionalText(input.npcId || input.registryId || registryRecord?.id || existing?.npcId);
  const name = normalizeOptionalText(input.name ?? registryData.name ?? existing?.name);
  if (!npcId && !name) throw validationError('scene NPC mount requires npcId or name');
  const actorType = normalizeActorType(input.actorType ?? input.type ?? registryData.actorType ?? existing?.actorType ?? (input.isPlayer || registryData.isPlayer ? 'player' : 'npc'));
  const isPlayer = normalizeBoolean(input.isPlayer ?? input.player ?? registryData.isPlayer ?? existing?.isPlayer ?? actorType === 'player');

  const timestamp = now();
  const resolvedNpcId = npcId || normalizeGeneratedId(name, 'npc');
  const id = normalizeOptionalText(input.id || existing?.id) || mountId(sceneId, resolvedNpcId);

  return {
    id,
    chatSessionId: resolvedChatSessionId,
    sceneId,
    npcId: resolvedNpcId,
    name: name || resolvedNpcId,
    actorType: isPlayer ? 'player' : actorType,
    isPlayer,
    playerId: normalizeOptionalText(input.playerId ?? input.protagonistId ?? registryData.playerId ?? existing?.playerId),
    role: normalizeOptionalText(input.role ?? registryData.role ?? existing?.role) || (isPlayer ? 'player-character' : ''),
    importance: normalizeImportance(input.importance ?? registryData.importance ?? existing?.importance ?? (isPlayer ? 'key' : 'minor')),
    tags: mergeStringArrays(registryData.tags, existing?.tags, input.tags),
    aliases: mergeStringArrays(registryData.aliases, existing?.aliases, input.aliases),
    status: normalizeOptionalText(input.status ?? existing?.status ?? 'present'),
    visibility: normalizeOptionalText(input.visibility ?? existing?.visibility ?? 'visible'),
    disposition: normalizeOptionalText(input.disposition ?? existing?.disposition),
    locationLabel: normalizeOptionalText(input.locationLabel ?? input.location ?? registryData.currentLocation ?? existing?.locationLabel),
    profileRef: normalizeOptionalText(input.profileRef ?? input.profile ?? registryData.profileRef ?? existing?.profileRef),
    registryRef: normalizeOptionalText(input.registryRef ?? (registryRecord ? `npc_registry:${registryRecord.id}` : existing?.registryRef)),
    summary: normalizeOptionalText(input.summary ?? registryData.summary ?? existing?.summary),
    mountReason: normalizeOptionalText(input.mountReason ?? input.reason ?? existing?.mountReason),
    source: normalizeOptionalText(input.source ?? existing?.source ?? 'agent'),
    orderIndex: normalizeInteger(input.orderIndex ?? existing?.orderIndex, 0),
    overrides: normalizeObject(input.overrides ?? existing?.overrides),
    metadata: mergeMetadata(
      registryData.metadata,
      existing?.metadata,
      input.metadata,
      visualMetadataFrom(input, NPC_VISUAL_METADATA_KEYS)
    ),
    mountedAt: normalizeOptionalText(existing?.mountedAt ?? input.mountedAt) || timestamp,
    lastSeenAt: normalizeOptionalText(input.lastSeenAt) || timestamp,
    sceneUpdatedAt: timestamp
  };
}

function selectMountRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const mounts = groups.find((group) => [
    'scene_npcs',
    'sceneNpcMounts',
    'mounted_npcs',
    'mountedNpcs',
    'npcs',
    SCENE_NPC_MOUNTS_COLLECTION
  ].includes(group.collection));
  const selected = preferred || mounts || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function mountId(sceneId, npcId) {
  return `mount_${safeSegment(sceneId)}_${safeSegment(npcId)}`.slice(0, 128);
}

function safeSegment(value) {
  const source = String(value || '');
  const cleaned = source
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return cleaned || normalizeGeneratedId(source, 'seg');
}

function normalizeGeneratedId(value, prefix) {
  return `${prefix}_${shortHash(String(value || prefix))}`;
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || DEFAULT_SCENE_ID;
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

function normalizeImportance(value) {
  const normalized = String(value || 'minor').toLowerCase();
  if (['minor', 'supporting', 'major', 'key'].includes(normalized)) return normalized;
  return 'minor';
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

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function mergeStringArrays(...values) {
  return [...new Set(values.flatMap(normalizeStringArray))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeMetadata(value) {
  return normalizeObject(value);
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

function normalizeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 7);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'SceneNpcMountValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'SceneNpcMountNotFoundError';
  error.statusCode = 404;
  return error;
}
