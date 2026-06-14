// @ts-nocheck
export const LIFECYCLE_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'];
export const LIFECYCLE_SCOPES = ['chat', 'character', 'global'];

export const RESOURCE_LIFECYCLE_FIELDS = [
  { name: 'lifecycleScope', type: 'text', description: 'Resource lifecycle scope: chat, character, or global.' },
  { name: 'lifecycleLevel', type: 'text', description: 'Resource importance level. L4 is character-card scoped and inherited across chats by default.' },
  { name: 'characterCardId', type: 'text', description: 'Owning character card id for character-scoped and chat-scoped resources.' },
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id for chat-scoped resources.' },
  { name: 'lifecycleCanonicalId', type: 'text', description: 'Stable id shared by a character-card baseline record and chat-local clones.' },
  { name: 'lifecycleCloneOf', type: 'text', description: 'Source record/document id when this resource is cloned into a chat.' },
  { name: 'lifecycleClonePolicy', type: 'text', description: 'reference or copy_to_chat. copy_to_chat keeps the character-card original immutable and clones a chat working copy.' },
  { name: 'lifecycleManaged', type: 'boolean', description: 'Whether lifecycle cleanup and visibility filtering should manage this resource.' },
  { name: 'lifecycleInherited', type: 'boolean', description: 'Whether the resource is inherited by later chats under the same character card.' },
  { name: 'lifecycleRegisteredAt', type: 'text', description: 'Timestamp when lifecycle metadata was attached.' }
];

export function lifecycleInputSchema() {
  return {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: LIFECYCLE_SCOPES },
      lifecycleScope: { type: 'string', enum: LIFECYCLE_SCOPES },
      level: { type: 'string' },
      lifecycleLevel: { type: 'string' },
      importanceLevel: { type: 'string' },
      characterCardId: { type: 'string' },
      chatSessionId: { type: 'string' },
      managed: { type: 'boolean' },
      inherited: { type: 'boolean' },
      clonePolicy: { type: 'string', enum: ['reference', 'copy_to_chat', 'none'] },
      lifecycleClonePolicy: { type: 'string', enum: ['reference', 'copy_to_chat', 'none'] },
      registeredBy: { type: 'string' }
    },
    additionalProperties: true
  };
}

export function lifecycleSchemaProperties() {
  return {
    resourceLifecycle: lifecycleInputSchema(),
    lifecycleScope: { type: 'string', enum: LIFECYCLE_SCOPES },
    lifecycleLevel: { type: 'string' },
    importanceLevel: { type: 'string' },
    characterCardId: { type: 'string' },
    chatSessionId: { type: 'string' },
    lifecycleClonePolicy: { type: 'string', enum: ['reference', 'copy_to_chat', 'none'] },
    cloneForChat: { type: 'boolean' },
    includeInherited: { type: 'boolean', default: true },
    includeUnscoped: { type: 'boolean', default: true },
    strictLifecycle: { type: 'boolean', default: false }
  };
}

export function resolveResourceLifecycle(input = {}, {
  appDatabase,
  defaultLevel = 'L1',
  defaultScope,
  now = () => new Date().toISOString(),
  attachByDefault = true
} = {}) {
  const raw = extractLifecycleInput(input);
  const active = safeActiveState(appDatabase);
  const chatSessionId = normalizeOptionalText(
    raw.chatSessionId ?? input.chatSessionId ?? active?.chatSessionId
  );
  let characterCardId = normalizeOptionalText(
    raw.characterCardId ?? input.characterCardId ?? active?.characterCardId
  );

  if (!characterCardId && chatSessionId && appDatabase?.getChatSession) {
    try {
      characterCardId = appDatabase.getChatSession(chatSessionId, {
        includeMessages: false,
        includeCharacter: false,
        includeDataDatabase: false
      }).characterCardId;
    } catch {
      characterCardId = '';
    }
  }

  const hasExplicitLifecycle = Object.keys(raw).length > 0
    || input.lifecycleScope !== undefined
    || input.lifecycleLevel !== undefined
    || input.importanceLevel !== undefined
    || input.characterCardId !== undefined;
  if (!hasExplicitLifecycle && !attachByDefault) return undefined;
  if (!hasExplicitLifecycle && !chatSessionId && !characterCardId) return undefined;

  const level = normalizeLifecycleLevel(
    raw.level
      ?? raw.lifecycleLevel
      ?? raw.importanceLevel
      ?? input.lifecycleLevel
      ?? input.importanceLevel
      ?? defaultLevel
  );
  const scope = normalizeLifecycleScope(
    raw.scope
      ?? raw.lifecycleScope
      ?? input.lifecycleScope
      ?? defaultScope
      ?? (level === 'L4' || (!chatSessionId && characterCardId) ? 'character' : 'chat')
  );
  const managed = raw.managed ?? input.lifecycleManaged ?? true;
  const inherited = raw.inherited ?? input.lifecycleInherited ?? scope !== 'chat';
  const clonePolicy = normalizeClonePolicy(
    raw.clonePolicy
      ?? raw.lifecycleClonePolicy
      ?? input.lifecycleClonePolicy
      ?? (input.cloneForChat === true ? 'copy_to_chat' : (scope === 'character' ? 'copy_to_chat' : 'none'))
  );

  return {
    lifecycleScope: scope,
    lifecycleLevel: level,
    characterCardId: scope === 'global' ? '' : characterCardId,
    chatSessionId: scope === 'chat' ? chatSessionId : '',
    lifecycleCanonicalId: normalizeOptionalText(input.lifecycleCanonicalId || input.id),
    lifecycleCloneOf: normalizeOptionalText(input.lifecycleCloneOf),
    lifecycleClonePolicy: clonePolicy,
    lifecycleManaged: Boolean(managed),
    lifecycleInherited: Boolean(inherited),
    lifecycleRegisteredAt: normalizeOptionalText(input.lifecycleRegisteredAt) || now()
  };
}

export function attachResourceLifecycle(record = {}, options = {}) {
  const lifecycle = resolveResourceLifecycle(record, options);
  if (!lifecycle) return { ...record };
  return {
    ...record,
    ...lifecycle,
    metadata: {
      ...(record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata) ? record.metadata : {}),
      resourceLifecycle: lifecycle
    }
  };
}

export function resourceLifecycleFields(input = {}) {
  const raw = input?.metadata?.resourceLifecycle && typeof input.metadata.resourceLifecycle === 'object'
    ? input.metadata.resourceLifecycle
    : input;
  const fields = {};
  for (const field of RESOURCE_LIFECYCLE_FIELDS) {
    if (raw[field.name] !== undefined) fields[field.name] = raw[field.name];
  }
  return fields;
}

export function getVisibleRecordByLifecycle(dataManager, collection, id, input = {}, { appDatabase } = {}) {
  if (!dataManager?.getRecord) return undefined;
  const query = resolveLifecycleQuery(input, { appDatabase });
  const requestedId = normalizeOptionalText(id);
  if (!requestedId) return undefined;

  if (query.chatSessionId) {
    const clones = dataManager.queryRecords(collection, {
      filter: {
        lifecycleScope: 'chat',
        chatSessionId: query.chatSessionId,
        lifecycleCanonicalId: requestedId
      },
      limit: 1
    }).records;
    if (clones[0]) return clones[0];
  }

  const exact = dataManager.getRecord(collection, requestedId, { missing: 'undefined' });
  if (exact && recordVisibleInLifecycle(exact.data || {}, query)) return exact;

  if (query.characterCardId) {
    const inherited = dataManager.queryRecords(collection, {
      filter: {
        lifecycleScope: 'character',
        characterCardId: query.characterCardId,
        lifecycleCanonicalId: requestedId
      },
      limit: 1
    }).records;
    if (inherited[0]) return inherited[0];
  }
  return exact;
}

export function shouldApplyLifecycleFilter(input = {}, { appDatabase } = {}) {
  if (input.strictLifecycle === true) return true;
  if (input.includeInherited !== undefined || input.includeUnscoped !== undefined) return true;
  if (input.lifecycleScope || input.lifecycleLevel || input.importanceLevel || input.characterCardId || input.chatSessionId) return true;
  return Boolean(safeActiveState(appDatabase));
}

export function filterRecordsByLifecycle(result, input = {}, { appDatabase } = {}) {
  if (!result?.records || !shouldApplyLifecycleFilter(input, { appDatabase })) return result;
  const query = resolveLifecycleQuery(input, { appDatabase });
  return {
    ...result,
    records: dedupeVisibleRecords(result.records.filter((record) => recordVisibleInLifecycle(record?.data || {}, query)))
  };
}

export function resolveLifecycleQuery(input = {}, { appDatabase } = {}) {
  const raw = extractLifecycleInput(input);
  const active = safeActiveState(appDatabase);
  return {
    lifecycleScope: normalizeOptionalText(raw.scope ?? raw.lifecycleScope ?? input.lifecycleScope),
    lifecycleLevel: normalizeOptionalText(raw.level ?? raw.lifecycleLevel ?? raw.importanceLevel ?? input.lifecycleLevel ?? input.importanceLevel).toUpperCase(),
    characterCardId: normalizeOptionalText(raw.characterCardId ?? input.characterCardId ?? active?.characterCardId),
    chatSessionId: normalizeOptionalText(raw.chatSessionId ?? input.chatSessionId ?? active?.chatSessionId),
    includeInherited: input.includeInherited !== false,
    includeUnscoped: input.strictLifecycle === true ? false : input.includeUnscoped !== false
  };
}

export function recordVisibleInLifecycle(data = {}, query = {}) {
  const lifecycle = lifecycleFromData(data);
  if (!lifecycle.lifecycleManaged) return query.includeUnscoped !== false;
  if (query.lifecycleScope && lifecycle.lifecycleScope !== query.lifecycleScope) return false;
  if (query.lifecycleLevel && lifecycle.lifecycleLevel !== query.lifecycleLevel) return false;
  if (lifecycle.lifecycleScope === 'global') return true;
  if (lifecycle.lifecycleScope === 'character') {
    return query.includeInherited !== false
      && Boolean(query.characterCardId)
      && lifecycle.characterCardId === query.characterCardId;
  }
  if (lifecycle.lifecycleScope === 'chat') {
    return Boolean(query.chatSessionId) && lifecycle.chatSessionId === query.chatSessionId;
  }
  return query.includeUnscoped !== false;
}

export function lifecycleFromData(data = {}) {
  const nested = data?.metadata?.resourceLifecycle && typeof data.metadata.resourceLifecycle === 'object'
    ? data.metadata.resourceLifecycle
    : {};
  const lifecycleScope = normalizeOptionalText(data.lifecycleScope ?? nested.lifecycleScope);
  const lifecycleLevel = normalizeOptionalText(data.lifecycleLevel ?? nested.lifecycleLevel).toUpperCase();
  const characterCardId = normalizeOptionalText(data.characterCardId ?? nested.characterCardId);
  const chatSessionId = normalizeOptionalText(data.chatSessionId ?? nested.chatSessionId);
  const lifecycleManaged = Boolean(
    data.lifecycleManaged
      ?? nested.lifecycleManaged
      ?? lifecycleScope
      ?? lifecycleLevel
      ?? characterCardId
      ?? chatSessionId
  );
  return {
    lifecycleScope: normalizeLifecycleScope(lifecycleScope || (lifecycleLevel === 'L4' ? 'character' : 'chat')),
    lifecycleLevel: normalizeLifecycleLevel(lifecycleLevel || 'L1'),
    lifecycleCanonicalId: normalizeOptionalText(data.lifecycleCanonicalId ?? nested.lifecycleCanonicalId ?? data.id),
    lifecycleCloneOf: normalizeOptionalText(data.lifecycleCloneOf ?? nested.lifecycleCloneOf),
    lifecycleClonePolicy: normalizeClonePolicy(data.lifecycleClonePolicy ?? nested.lifecycleClonePolicy ?? 'reference'),
    characterCardId,
    chatSessionId,
    lifecycleManaged,
    lifecycleInherited: Boolean(data.lifecycleInherited ?? nested.lifecycleInherited ?? lifecycleScope !== 'chat')
  };
}

export function cloneScopedDataRecords(dataManager, {
  characterCardId,
  chatSessionId,
  now = () => new Date().toISOString()
} = {}) {
  if (!dataManager || !characterCardId || !chatSessionId) return { cloned: [] };
  const cloned = [];
  for (const collection of dataManager.listCollections()) {
    for (const record of listAllRecords(dataManager, collection)) {
      const lifecycle = lifecycleFromData(record.data);
      if (lifecycle.lifecycleScope !== 'character') continue;
      if (lifecycle.characterCardId !== characterCardId) continue;
      if (lifecycle.lifecycleClonePolicy === 'none') continue;

      const canonicalId = lifecycle.lifecycleCanonicalId || record.id;
      const cloneId = `${canonicalId}__chat_${safeSegment(chatSessionId)}`.slice(0, 180);
      if (dataManager.getRecord(collection, cloneId, { missing: 'undefined' })) continue;
      const clone = dataManager.upsertRecord(collection, {
        ...record.data,
        id: cloneId,
        lifecycleScope: 'chat',
        chatSessionId,
        characterCardId,
        lifecycleCanonicalId: canonicalId,
        lifecycleCloneOf: record.id,
        lifecycleClonePolicy: 'none',
        lifecycleInherited: false,
        lifecycleRegisteredAt: now(),
        metadata: {
          ...(record.data?.metadata || {}),
          resourceLifecycle: {
            ...lifecycle,
            lifecycleScope: 'chat',
            chatSessionId,
            characterCardId,
            lifecycleCanonicalId: canonicalId,
            lifecycleCloneOf: record.id,
            lifecycleClonePolicy: 'none',
            lifecycleInherited: false,
            lifecycleRegisteredAt: now()
          }
        }
      }, { id: cloneId });
      cloned.push({ collection, sourceId: record.id, cloneId, record: clone });
    }
  }
  return { cloned };
}

export async function cloneScopedRagDocuments(ragService, {
  characterCardId,
  chatSessionId,
  now = () => new Date().toISOString()
} = {}) {
  if (!ragService || !characterCardId || !chatSessionId) return { cloned: [] };
  const cloned = [];
  for (const collectionInfo of ragService.listCollections()) {
    const collection = collectionInfo.collection;
    const docs = ragService.listDocuments({ collection, limit: 100000 }).documents;
    for (const doc of docs) {
      const lifecycle = lifecycleFromData(doc.metadata || {});
      if (lifecycle.lifecycleScope !== 'character') continue;
      if (lifecycle.characterCardId !== characterCardId) continue;
      if (lifecycle.lifecycleClonePolicy === 'none') continue;
      const canonicalId = lifecycle.lifecycleCanonicalId || doc.metadata?.sourceId || doc.id;
      const cloneId = `${doc.id}__chat_${safeSegment(chatSessionId)}`.slice(0, 220);
      const existing = ragService.listDocuments({
        collection,
        filter: {
          lifecycleScope: 'chat',
          chatSessionId,
          lifecycleCloneOf: doc.id
        },
        limit: 1
      }).documents[0];
      if (existing) continue;
      const clone = await ragService.upsertDocument({
        collection,
        id: cloneId,
        text: doc.text,
        vector: doc.vector,
        metadata: {
          ...(doc.metadata || {}),
          sourceId: `${doc.metadata?.sourceId || doc.id}__chat_${safeSegment(chatSessionId)}`,
          lifecycleScope: 'chat',
          chatSessionId,
          characterCardId,
          lifecycleCanonicalId: canonicalId,
          lifecycleCloneOf: doc.id,
          lifecycleClonePolicy: 'none',
          lifecycleInherited: false,
          lifecycleRegisteredAt: now(),
          resourceLifecycle: {
            ...lifecycle,
            lifecycleScope: 'chat',
            chatSessionId,
            characterCardId,
            lifecycleCanonicalId: canonicalId,
            lifecycleCloneOf: doc.id,
            lifecycleClonePolicy: 'none',
            lifecycleInherited: false,
            lifecycleRegisteredAt: now()
          }
        }
      });
      cloned.push({ collection, sourceId: doc.id, cloneId, document: clone });
    }
  }
  return { cloned };
}

export function deleteScopedDataRecords(dataManager, criteria = {}) {
  if (!dataManager) return { collections: [], deleted: [] };
  const query = {
    ...criteria,
    includeUnscoped: false,
    includeInherited: true
  };
  const deleted = [];
  for (const collection of dataManager.listCollections()) {
    for (const record of listAllRecords(dataManager, collection)) {
      if (!recordMatchesCleanup(record.data, query)) continue;
      const result = dataManager.deleteRecord(collection, record.id);
      if (result.deleted) deleted.push({ collection, id: record.id });
    }
  }
  return {
    collections: [...new Set(deleted.map((item) => item.collection))],
    deleted
  };
}

export async function deleteScopedRagDocuments(ragService, criteria = {}) {
  if (!ragService) return { collections: [], sources: [] };
  const sources = new Map();
  for (const collectionInfo of ragService.listCollections()) {
    const collection = collectionInfo.collection;
    const docs = ragService.listDocuments({ collection, limit: 100000 }).documents;
    for (const doc of docs) {
      if (!recordMatchesCleanup(doc.metadata || {}, criteria)) continue;
      const sourceId = doc.metadata?.sourceId;
      if (!sourceId) continue;
      const key = `${collection}\u0000${sourceId}`;
      sources.set(key, { collection, sourceId });
    }
  }

  const deletedSources = [];
  for (const source of sources.values()) {
    deletedSources.push({
      ...source,
      deleted: await ragService.deleteSource(source)
    });
  }
  return {
    collections: [...new Set(deletedSources.map((item) => item.collection))],
    sources: deletedSources
  };
}

function recordMatchesCleanup(data = {}, criteria = {}) {
  const lifecycle = lifecycleFromData(data);
  if (!lifecycle.lifecycleManaged) return false;
  if (criteria.chatSessionId) {
    return lifecycle.lifecycleScope === 'chat' && lifecycle.chatSessionId === criteria.chatSessionId;
  }
  if (criteria.characterCardId) {
    return lifecycle.characterCardId === criteria.characterCardId;
  }
  return false;
}

function dedupeVisibleRecords(records = []) {
  const byCanonical = new Map();
  for (const record of records) {
    const lifecycle = lifecycleFromData(record.data || {});
    const canonical = lifecycle.lifecycleCanonicalId || record.id;
    const current = byCanonical.get(canonical);
    if (!current || lifecyclePriority(lifecycle) > lifecyclePriority(lifecycleFromData(current.data || {}))) {
      byCanonical.set(canonical, record);
    }
  }
  return [...byCanonical.values()];
}

function lifecyclePriority(lifecycle) {
  if (lifecycle.lifecycleScope === 'chat') return 3;
  if (lifecycle.lifecycleScope === 'character') return 2;
  if (lifecycle.lifecycleScope === 'global') return 1;
  return 0;
}

function listAllRecords(dataManager, collection) {
  const records = [];
  let offset = 0;
  while (true) {
    const page = dataManager.queryRecords(collection, { limit: 500, offset, lifecycleFilter: false });
    records.push(...page.records);
    if (page.records.length < page.limit) break;
    offset += page.limit;
  }
  return records;
}

function extractLifecycleInput(input = {}) {
  if (!input || typeof input !== 'object') return {};
  for (const key of ['resourceLifecycle', 'lifecycleBinding', 'lifecyclePolicy']) {
    const value = input[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  if (isLifecycleLikeObject(input.lifecycle)) return input.lifecycle;
  return {};
}

function isLifecycleLikeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return [
    'scope',
    'lifecycleScope',
    'level',
    'lifecycleLevel',
    'importanceLevel',
    'characterCardId',
    'chatSessionId',
    'managed',
    'inherited'
  ].some((key) => Object.hasOwn(value, key));
}

function normalizeLifecycleLevel(value) {
  const normalized = String(value || 'L1').trim().toUpperCase();
  if (LIFECYCLE_LEVELS.includes(normalized)) return normalized;
  if (['IMPORTANT', 'KEY', 'PERMANENT', 'CHARACTER'].includes(normalized)) return 'L4';
  if (['TEMP', 'TEMPORARY', 'CHAT', 'LOCAL'].includes(normalized)) return 'L1';
  return 'L1';
}

function normalizeLifecycleScope(value) {
  const normalized = String(value || 'chat').trim().toLowerCase();
  if (normalized === 'card' || normalized === 'character-card' || normalized === 'character_card') return 'character';
  if (normalized === 'session' || normalized === 'chat-session' || normalized === 'chat_session') return 'chat';
  if (LIFECYCLE_SCOPES.includes(normalized)) return normalized;
  return 'chat';
}

function normalizeClonePolicy(value) {
  const normalized = String(value || 'reference').trim().toLowerCase().replace(/-/g, '_');
  if (['copy', 'clone', 'copy_to_chat', 'clone_to_chat', 'chat_copy', 'working_copy'].includes(normalized)) return 'copy_to_chat';
  if (['none', 'disabled', 'no_clone'].includes(normalized)) return 'none';
  return 'reference';
}

function safeSegment(value) {
  return String(value || 'chat')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'chat';
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function safeActiveState(appDatabase) {
  try {
    return appDatabase?.getActiveChatState?.();
  } catch {
    return undefined;
  }
}
