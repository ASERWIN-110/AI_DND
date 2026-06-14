// @ts-nocheck
import YAML from 'yaml';
import { parseStructuredDocument } from '../data/structured-document-importer.js';
import { SQLiteDataManager } from '../data/sqlite-data-manager.js';

export const NPC_PROFILE_COLLECTION = 'npc_profiles';
export const NPC_PROFILE_SETTINGS_COLLECTION = 'npc_profile_settings';
export const NPC_PROFILE_WRITE_ACCESS_ID = 'agent_write_access';
export const NPC_PROFILE_LEVELS = ['L1', 'L2', 'L3'];

export const NPC_PROFILE_FIELDS = [
  { name: 'npcId', type: 'text', description: 'Stable L0 NPC id or local NPC id.' },
  { name: 'level', type: 'text', description: 'Profile detail level: L1, L2, or L3.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'actorType', type: 'text', description: 'Actor class: npc, player, companion, summon, monster, etc.' },
  { name: 'isPlayer', type: 'boolean', description: 'Whether this profile belongs to a player-controlled protagonist actor.' },
  { name: 'playerId', type: 'text', description: 'Optional player/protagonist identity id for player actors.' },
  { name: 'title', type: 'text', description: 'Optional profile title.' },
  { name: 'profileType', type: 'text', description: 'profile, characterCard, worldInfo, memory, rules, etc.' },
  { name: 'version', type: 'text', description: 'User-controlled profile version.' },
  { name: 'tags', type: 'json', description: 'Search tags.' },
  { name: 'aliases', type: 'json', description: 'Alternative names.' },
  { name: 'status', type: 'text', description: 'active, draft, archived, deprecated, etc.' },
  { name: 'summary', type: 'text', description: 'Compact profile summary.' },
  { name: 'content', type: 'text', description: 'Long-form profile text.' },
  { name: 'sections', type: 'json', description: 'Structured sections such as appearance, persona, secrets, goals.' },
  { name: 'characterCard', type: 'json', description: 'Full or partial character card data.' },
  { name: 'worldInfo', type: 'json', description: 'World info entries or book fragment for this NPC.' },
  { name: 'rules', type: 'json', description: 'Roleplay, memory, or retrieval rules.' },
  { name: 'relationships', type: 'json', description: 'Relationship graph or relation notes.' },
  { name: 'memories', type: 'json', description: 'Long-term memories or scene history.' },
  { name: 'data', type: 'json', description: 'Extra full-fidelity structured data not covered by stable fields.' },
  { name: 'metadata', type: 'json', description: 'Storage/source metadata.' },
  { name: 'source', type: 'text', description: 'manual, agent, import, migration, etc.' },
  { name: 'profileUpdatedAt', type: 'text', description: 'Latest profile update timestamp.' }
];

export const NPC_PROFILE_SETTINGS_FIELDS = [
  { name: 'key', type: 'text', description: 'Setting key.' },
  { name: 'enabled', type: 'boolean', description: 'Whether agent profile writes are enabled.' },
  { name: 'reason', type: 'text', description: 'Why this setting was changed.' },
  { name: 'updatedBy', type: 'text', description: 'user, admin, manual, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra setting metadata.' },
  { name: 'settingsUpdatedAt', type: 'text', description: 'Latest setting update timestamp.' }
];

const DEFAULT_LIMIT = 100;
const KNOWN_PROFILE_FIELDS = new Set([
  'id',
  'profileId',
  'npcId',
  'registryId',
  'characterId',
  'level',
  'layer',
  'tier',
  'name',
  'actorType',
  'isPlayer',
  'player',
  'playerId',
  'protagonistId',
  'title',
  'profileType',
  'type',
  'version',
  'tags',
  'aliases',
  'status',
  'summary',
  'content',
  'text',
  'sections',
  'characterCard',
  'character_card',
  'card',
  'worldInfo',
  'world_info',
  'worldBook',
  'rules',
  'relationships',
  'memories',
  'data',
  'metadata',
  'source',
  'profileUpdatedAt',
  'updatedAt',
  'levels',
  'l1',
  'l2',
  'l3',
  'L1',
  'L2',
  'L3'
]);

export class NpcProfileDatabase {
  constructor({
    dataManager = new SQLiteDataManager(),
    collection = NPC_PROFILE_COLLECTION,
    settingsCollection = NPC_PROFILE_SETTINGS_COLLECTION,
    now
  } = {}) {
    this.dataManager = dataManager;
    this.collection = collection;
    this.settingsCollection = settingsCollection;
    this.now = now || (() => new Date().toISOString());
    this.ensureProfileDatabase();
  }

  ensureProfileDatabase() {
    this.dataManager.ensureCollection(this.collection);
    this.dataManager.alterFields(this.collection, {
      add: NPC_PROFILE_FIELDS,
      reason: 'npcProfiles:L1-L3'
    });
    this.dataManager.ensureCollection(this.settingsCollection);
    this.dataManager.alterFields(this.settingsCollection, {
      add: NPC_PROFILE_SETTINGS_FIELDS,
      reason: 'npcProfiles:settings'
    });
    if (!this.dataManager.getRecord(this.settingsCollection, NPC_PROFILE_WRITE_ACCESS_ID, { missing: 'undefined' })) {
      this.dataManager.upsertRecord(this.settingsCollection, {
        key: NPC_PROFILE_WRITE_ACCESS_ID,
        enabled: false,
        reason: 'default closed: agent can query profiles but cannot write',
        updatedBy: 'system',
        metadata: {},
        settingsUpdatedAt: this.now()
      }, { id: NPC_PROFILE_WRITE_ACCESS_ID });
    }
    return this.describe();
  }

  describe() {
    return {
      profiles: this.dataManager.describeCollection(this.collection),
      settings: this.dataManager.describeCollection(this.settingsCollection),
      writeAccess: this.getWriteAccess()
    };
  }

  getWriteAccess() {
    const record = this.dataManager.getRecord(this.settingsCollection, NPC_PROFILE_WRITE_ACCESS_ID, { missing: 'undefined' });
    const data = record?.data || {};
    return {
      id: NPC_PROFILE_WRITE_ACCESS_ID,
      enabled: data.enabled === true,
      reason: data.reason || '',
      updatedBy: data.updatedBy || 'system',
      metadata: data.metadata || {},
      settingsUpdatedAt: data.settingsUpdatedAt || ''
    };
  }

  setWriteAccess({
    enabled = false,
    reason = '',
    updatedBy = 'user',
    metadata = {}
  } = {}) {
    const record = this.dataManager.upsertRecord(this.settingsCollection, {
      key: NPC_PROFILE_WRITE_ACCESS_ID,
      enabled: Boolean(enabled),
      reason: normalizeOptionalText(reason),
      updatedBy: normalizeOptionalText(updatedBy) || 'user',
      metadata: normalizeObject(metadata),
      settingsUpdatedAt: this.now()
    }, { id: NPC_PROFILE_WRITE_ACCESS_ID });
    return {
      ...this.getWriteAccess(),
      record
    };
  }

  upsertProfile(input = {}, options = {}) {
    this.assertWriteAllowed(options.context, 'upsert_profile');
    const normalized = normalizeNpcProfile(input, { now: this.now });
    return this.dataManager.upsertRecord(this.collection, normalized, { id: normalized.id });
  }

  patchProfile(input = {}, options = {}) {
    this.assertWriteAllowed(options.context, 'patch_profile');
    const current = this.resolveProfile(input);
    const normalized = normalizeNpcProfile({
      ...current.data,
      ...(input.patch || {}),
      id: current.id
    }, { now: this.now });
    return this.dataManager.upsertRecord(this.collection, normalized, { id: current.id });
  }

  deleteProfile(input = {}, options = {}) {
    this.assertWriteAllowed(options.context, 'delete_profile');
    const current = this.resolveProfile(input);
    return this.dataManager.deleteRecord(this.collection, current.id);
  }

  getProfile(input = {}) {
    return this.resolveProfile(input);
  }

  getProfileBundle({
    npcId,
    levels,
    includeArchived = false,
    limit = 10
  } = {}) {
    const normalizedNpcId = normalizeRequiredText(npcId, 'npcId');
    const listed = this.listProfiles({
      npcId: normalizedNpcId,
      levels,
      includeArchived,
      limit
    });
    return {
      npcId: normalizedNpcId,
      levels: listed.records
        .sort((a, b) => profileLevelWeight(a.data.level) - profileLevelWeight(b.data.level))
        .map((record) => ({
          id: record.id,
          level: record.data.level,
          profile: record
        }))
    };
  }

  listProfiles({
    npcId,
    level,
    levels,
    includeArchived = false,
    filter = {},
    tags = [],
    query = '',
    sort = [{ field: 'npcId', direction: 'asc' }, { field: 'level', direction: 'asc' }],
    limit = DEFAULT_LIMIT,
    offset = 0
  } = {}) {
    const mergedFilter = { ...filter };
    if (npcId) mergedFilter.npcId = normalizeOptionalText(npcId);
    if (level) mergedFilter.level = normalizeProfileLevel(level);

    const result = this.dataManager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const allowedLevels = new Set(normalizeLevelList(levels).map(normalizeProfileLevel));
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (!includeArchived && ['archived', 'deprecated', 'deleted'].includes(String(data.status || '').toLowerCase())) return false;
      if (allowedLevels.size > 0 && !allowedLevels.has(data.level)) return false;
      if (requiredTags.length > 0) {
        const profileTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => profileTags.has(tag))) return false;
      }
      if (normalizedQuery) {
        const haystack = normalizeSearchText([
          data.npcId,
          data.actorType,
          data.playerId,
          data.level,
          data.name,
          data.title,
          data.profileType,
          data.summary,
          data.content,
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

  importDocument(input = {}, options = {}) {
    this.assertWriteAllowed(options.context, 'import_document');
    const parsed = parseStructuredDocument(input);
    const profileInputs = extractProfileRecords(parsed.data, {
      defaultLevel: input.defaultLevel || 'L1',
      source: input.source || 'document-import'
    });
    const records = profileInputs.map((profile) => this.upsertProfile({
      ...profile,
      source: profile.source || input.source || 'document-import'
    }, options));
    return {
      format: parsed.format,
      collection: this.collection,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    format = 'json',
    npcId,
    level,
    levels,
    tags = [],
    query = '',
    includeArchived = true,
    includeSettings = false,
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listProfiles({
      npcId,
      level,
      levels,
      tags,
      query,
      includeArchived,
      limit,
      offset
    });
    const payload = {
      npcProfiles: listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }))
    };
    if (includeSettings) payload.settings = this.getWriteAccess();

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

  resolveProfile({ id, profileId, npcId, level = 'L1' } = {}) {
    const explicitId = normalizeOptionalText(profileId || id);
    if (explicitId) return this.dataManager.getRecord(this.collection, explicitId);
    const normalizedNpcId = normalizeRequiredText(npcId, 'npcId');
    const normalizedLevel = normalizeProfileLevel(level);
    return this.dataManager.getRecord(this.collection, profileIdFor(normalizedNpcId, normalizedLevel));
  }

  assertWriteAllowed(context = {}, operation = 'write') {
    const access = this.getWriteAccess();
    if (access.enabled || isUserAuthorized(context)) return true;

    const error = new Error(`NPC profile write access is disabled for agent tools: ${operation}`);
    error.name = 'NpcProfileWriteAccessError';
    error.statusCode = 403;
    throw error;
  }
}

export function normalizeNpcProfile(input = {}, { now = () => new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('npc profile must be a plain object');
  }

  const level = normalizeProfileLevel(input.level ?? input.layer ?? input.tier ?? 'L1');
  const explicitId = normalizeOptionalText(input.profileId || input.id);
  const npcId = normalizeNpcId(
    input.npcId ||
    input.registryId ||
    input.characterId ||
    (!explicitId.startsWith('profile_') ? explicitId : '') ||
    input.name
  );
  const id = explicitId && explicitId.startsWith('profile_') ? explicitId : profileIdFor(npcId, level);
  const profileData = normalizeProfileData(input);
  const actorType = normalizeActorType(input.actorType ?? (input.isPlayer || input.playerId ? 'player' : 'npc'));
  const isPlayer = normalizeBoolean(input.isPlayer ?? input.player ?? input.playerControlled ?? actorType === 'player');

  return {
    id,
    npcId,
    level,
    name: normalizeOptionalText(input.name) || npcId,
    actorType: isPlayer ? 'player' : actorType,
    isPlayer,
    playerId: normalizeOptionalText(input.playerId ?? input.protagonistId),
    title: normalizeOptionalText(input.title),
    profileType: normalizeOptionalText(input.profileType ?? (isPlayer ? 'playerProfile' : input.type) ?? 'profile'),
    version: normalizeOptionalText(input.version || '1'),
    tags: normalizeStringArray(input.tags),
    aliases: normalizeStringArray(input.aliases),
    status: normalizeOptionalText(input.status || 'active'),
    summary: normalizeOptionalText(input.summary),
    content: normalizeOptionalText(input.content ?? input.text),
    sections: normalizeObject(input.sections),
    characterCard: normalizeObject(input.characterCard ?? input.character_card ?? input.card),
    worldInfo: normalizeObject(input.worldInfo ?? input.world_info ?? input.worldBook),
    rules: normalizeObject(input.rules),
    relationships: normalizeJsonLike(input.relationships),
    memories: normalizeJsonLike(input.memories),
    data: profileData,
    metadata: normalizeObject(input.metadata),
    source: normalizeOptionalText(input.source || 'manual'),
    profileUpdatedAt: normalizeOptionalText(input.profileUpdatedAt ?? input.updatedAt) || now()
  };
}

export function extractProfileRecords(data, { defaultLevel = 'L1', source = 'document-import' } = {}) {
  const records = [];
  collectProfileRecords(data, {
    inheritedNpcId: undefined,
    defaultLevel,
    source,
    records
  });
  return records;
}

function collectProfileRecords(value, context) {
  if (Array.isArray(value)) {
    for (const item of value) collectProfileRecords(item, context);
    return;
  }
  if (!isPlainObject(value)) return;

  const roots = [
    value.npcProfiles,
    value.npc_profiles,
    value.profiles,
    value.profile,
    value.npcs
  ].filter((candidate) => candidate !== undefined);
  if (roots.length > 0 && !looksLikeSingleProfile(value)) {
    for (const root of roots) collectProfileRecords(root, context);
    return;
  }

  if (looksLikeSingleProfile(value)) {
    for (const profile of flattenProfileRecord(value, context)) {
      context.records.push(profile);
    }
    return;
  }

  for (const [npcId, profile] of Object.entries(value)) {
    if (!isPlainObject(profile)) continue;
    collectProfileRecords(profile, {
      ...context,
      inheritedNpcId: npcId
    });
  }
}

function flattenProfileRecord(value, context) {
  const base = {
    ...omitLevelContainers(value),
    npcId: value.npcId || value.registryId || context.inheritedNpcId,
    source: value.source || context.source
  };
  const output = [];

  if (isPlainObject(value.levels)) {
    for (const [levelKey, profile] of Object.entries(value.levels)) {
      output.push({
        ...base,
        ...(isPlainObject(profile) ? profile : { content: profile }),
        level: levelKey
      });
    }
  }

  for (const levelKey of ['L1', 'L2', 'L3', 'l1', 'l2', 'l3']) {
    if (!Object.hasOwn(value, levelKey)) continue;
    const profile = value[levelKey];
    output.push({
      ...base,
      ...(isPlainObject(profile) ? profile : { content: profile }),
      level: levelKey
    });
  }

  if (output.length === 0) {
    output.push({
      ...value,
      npcId: value.npcId || value.registryId || context.inheritedNpcId,
      level: value.level || context.defaultLevel,
      source: value.source || context.source
    });
  }

  return output;
}

function looksLikeSingleProfile(value) {
  if (!isPlainObject(value)) return false;
  return [
    'npcId',
    'registryId',
    'characterId',
    'level',
    'layer',
    'tier',
    'name',
    'summary',
    'content',
    'text',
    'sections',
    'characterCard',
    'character_card',
    'worldInfo',
    'world_info',
    'levels',
    'L1',
    'L2',
    'L3',
    'l1',
    'l2',
    'l3'
  ].some((key) => Object.hasOwn(value, key));
}

function omitLevelContainers(value) {
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (['levels', 'L1', 'L2', 'L3', 'l1', 'l2', 'l3'].includes(key)) continue;
    output[key] = child;
  }
  return output;
}

function normalizeProfileData(input) {
  const extra = {
    ...(isPlainObject(input.data) ? input.data : {})
  };
  for (const [key, value] of Object.entries(input)) {
    if (KNOWN_PROFILE_FIELDS.has(key)) continue;
    extra[key] = value;
  }
  return extra;
}

function profileIdFor(npcId, level) {
  return `profile_${safeSegment(npcId)}_${String(level).toLowerCase()}`.slice(0, 128);
}

function normalizeNpcId(value) {
  const text = normalizeOptionalText(value);
  if (!text) throw validationError('npcId or name is required');
  const normalized = text
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return normalized || `npc_${shortHash(text)}`;
}

function safeSegment(value) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return normalized || `npc_${shortHash(value)}`;
}

function normalizeProfileLevel(value) {
  const normalized = String(value || 'L1').trim().toUpperCase();
  if (['1', 'LEVEL1', 'LEVEL_1'].includes(normalized)) return 'L1';
  if (['2', 'LEVEL2', 'LEVEL_2'].includes(normalized)) return 'L2';
  if (['3', 'LEVEL3', 'LEVEL_3'].includes(normalized)) return 'L3';
  if (NPC_PROFILE_LEVELS.includes(normalized)) return normalized;
  throw validationError(`npc profile level must be one of ${NPC_PROFILE_LEVELS.join(', ')}`);
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

function normalizeLevelList(levels) {
  if (levels === undefined || levels === null || levels === '') return [];
  return Array.isArray(levels) ? levels : [levels];
}

function profileLevelWeight(level) {
  const index = NPC_PROFILE_LEVELS.indexOf(normalizeProfileLevel(level));
  return index === -1 ? 99 : index;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
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
  return isPlainObject(value) ? value : {};
}

function normalizeJsonLike(value) {
  if (value === undefined || value === null) return [];
  return value;
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLowerCase();
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isUserAuthorized(context = {}) {
  const authorization = context.authorization ?? context.userAuthorization ?? context.approval;
  if (authorization === true || context.manual === true || context.actor === 'user' || context.actor === 'manual') return true;
  if (!authorization || typeof authorization !== 'object') return false;
  return authorization.approved === true || authorization.userApproved === true || authorization.granted === true;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'NpcProfileValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'npc-profile');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
