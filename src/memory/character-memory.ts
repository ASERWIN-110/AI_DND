// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { ChatCompressionMemory } from './chat-compression.js';
import { SCENE_NPC_MOUNTS_COLLECTION } from '../npcs/scene-npc-mounts.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { estimateTokens } from '../tokens/token-counter.js';

export const CHARACTER_MEMORY_TAG = 'AI_DND_CHARACTER_MEMORY';
export const CHARACTER_MEMORY_COLLECTION = 'character_memories';

export const CHARACTER_MEMORY_TYPES = new Set([
  'fact',
  'promise',
  'relationship',
  'secret',
  'emotion',
  'goal',
  'rumor',
  'misunderstanding',
  'preference',
  'observation',
  'plan',
  'rule'
]);

export const CHARACTER_KNOWLEDGE_STATES = new Set([
  'known',
  'believed',
  'suspected',
  'false',
  'unknown'
]);

export const CHARACTER_MEMORY_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'characterId', type: 'text', description: 'NPC id, player persona id, or local character id this memory belongs to.' },
  { name: 'name', type: 'text', description: 'Display name for the remembering character.' },
  { name: 'aliases', type: 'json', description: 'Names or aliases for matching this character.' },
  { name: 'memoryType', type: 'text', description: 'fact, promise, relationship, secret, emotion, goal, rumor, misunderstanding, preference, observation, plan, or rule.' },
  { name: 'summary', type: 'text', description: 'Compact subjective memory text from this character perspective.' },
  { name: 'knowledgeState', type: 'text', description: 'known, believed, suspected, false, or unknown.' },
  { name: 'importance', type: 'number', description: '0-1 prompt selection importance.' },
  { name: 'emotionalWeight', type: 'number', description: '0-1 affective salience for roleplay consistency.' },
  { name: 'confidence', type: 'number', description: '0-1 confidence that this memory is accurate from the character perspective.' },
  { name: 'visibility', type: 'text', description: 'private, shared, or public.' },
  { name: 'status', type: 'text', description: 'active, superseded, archived, or draft.' },
  { name: 'tags', type: 'json', description: 'Search and routing tags.' },
  { name: 'relatedCharacterIds', type: 'json', description: 'Other characters mentioned by this memory.' },
  { name: 'sourceCompressionIds', type: 'json', description: 'Compression records used to derive this memory.' },
  { name: 'sourceMessageIds', type: 'json', description: 'Raw chat message ids inherited from compression records.' },
  { name: 'fromOrderIndex', type: 'integer', description: 'First raw message order_index covered by this memory.' },
  { name: 'toOrderIndex', type: 'integer', description: 'Last raw message order_index covered by this memory.' },
  { name: 'source', type: 'text', description: 'assistant, manual, import, tool, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra debug or integration metadata.' },
  { name: 'memoryUpdatedAt', type: 'text', description: 'Latest character memory update timestamp.' }
];

const DEFAULT_MEMORY_LIMIT = 12;
const DEFAULT_COMPRESSION_LIMIT = 12;
const INACTIVE_SCENE_STATUSES = new Set(['inactive', 'departed', 'dead', 'removed']);

export class CharacterMemoryStore {
  constructor({
    appDatabase,
    chatCompression,
    collection = CHARACTER_MEMORY_COLLECTION,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('CharacterMemoryStore requires appDatabase');
    this.appDatabase = appDatabase;
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
    this.chatCompression = chatCompression || new ChatCompressionMemory({
      appDatabase,
      trace: false,
      now: this.now
    });
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/character-memory-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollection(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: CHARACTER_MEMORY_FIELDS,
      reason: 'characterMemory:compression-projection'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return this.ensureCollection(chatSessionId);
  }

  listMemories({
    chatSessionId,
    characterId,
    characterIds,
    memoryType,
    memoryTypes,
    knowledgeState,
    visibility,
    status = 'active',
    tags = [],
    query = '',
    filter = {},
    sort = [
      { field: 'importance', direction: 'desc' },
      { field: 'emotionalWeight', direction: 'desc' },
      { field: 'memoryUpdatedAt', direction: 'desc' }
    ],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const ids = normalizeStringArray(characterIds || characterId).map(normalizeCharacterId);
    const types = normalizeStringArray(memoryTypes || memoryType).map(normalizeMemoryType);
    const requiredTags = normalizeStringArray(tags).map(normalizeSearchText);
    const normalizedQuery = normalizeSearchText(query);
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (ids.length === 1) mergedFilter.characterId = ids[0];
    if (types.length === 1) mergedFilter.memoryType = types[0];
    if (knowledgeState) mergedFilter.knowledgeState = normalizeKnowledgeState(knowledgeState);
    if (visibility) mergedFilter.visibility = normalizeVisibility(visibility);
    if (status) mergedFilter.status = normalizeStatus(status);

    const result = manager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (ids.length > 1 && !ids.includes(normalizeCharacterId(data.characterId))) return false;
      if (types.length > 1 && !types.includes(data.memoryType)) return false;
      if (requiredTags.length > 0) {
        const memoryTags = new Set(normalizeStringArray(data.tags).map(normalizeSearchText));
        if (!requiredTags.every((tag) => memoryTags.has(tag))) return false;
      }
      if (normalizedQuery && !memoryHaystack(data).includes(normalizedQuery)) return false;
      return true;
    });

    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  getMemory({ chatSessionId, id, recordId, memoryId } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const normalizedId = normalizeRequiredText(recordId || memoryId || id, 'id');
    const { manager } = this.openManager(normalizedChatSessionId);
    return manager.getRecord(this.collection, normalizedId);
  }

  upsertMemory(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.memorySnapshot({ chatSessionId });
    const trace = this.traceRecorder.start('character-memory-upsert', {
      sessionId: chatSessionId,
      input: { source, memory: input },
      stateBefore: before
    });

    try {
      const record = this.applyMemoryRecord(input, { source });
      const after = this.memorySnapshot({ chatSessionId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  patchMemory(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getMemory(input);
    const patch = normalizeObject(input.patch || input.update || input);
    const before = this.memorySnapshot({ chatSessionId });
    const trace = this.traceRecorder.start('character-memory-patch', {
      sessionId: chatSessionId,
      input: { source, id: current.id, patch },
      stateBefore: before
    });

    try {
      const record = this.applyMemoryRecord({
        ...current.data,
        ...patch,
        chatSessionId,
        id: current.id
      }, { source });
      const after = this.memorySnapshot({ chatSessionId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  deleteMemory(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const current = this.getMemory(input);
    const before = this.memorySnapshot({ chatSessionId });
    const trace = this.traceRecorder.start('character-memory-delete', {
      sessionId: chatSessionId,
      input: { id: current.id },
      stateBefore: before
    });

    try {
      const { manager } = this.openManager(chatSessionId);
      const deleted = manager.deleteRecord(this.collection, current.id);
      const after = this.memorySnapshot({ chatSessionId });
      return {
        ...deleted,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: deleted,
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  buildPrompt(chatSessionId, {
    characterId,
    characterIds,
    sceneId,
    sourceCompressionIds,
    compressionTypes = ['segment_summary', 'pinned_fact', 'scene_summary', 'manual_note'],
    compressionQuery = '',
    compressionLimit = DEFAULT_COMPRESSION_LIMIT,
    includeExistingMemories = true,
    memoryLimit = DEFAULT_MEMORY_LIMIT,
    extraInstructions = ''
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const characters = this.resolveTargetCharacters({
      chatSessionId: normalizedChatSessionId,
      characterIds: characterIds || characterId,
      sceneId
    });
    const compressionRecords = this.selectCompressionRecords(normalizedChatSessionId, {
      sourceCompressionIds,
      compressionTypes,
      compressionQuery,
      compressionLimit
    });
    const existingMemories = includeExistingMemories
      ? this.listMemories({
        chatSessionId: normalizedChatSessionId,
        characterIds: characters.map((character) => character.characterId),
        limit: memoryLimit
      }).records
      : [];
    const prompt = buildCharacterMemoryPrompt({
      chatSessionId: normalizedChatSessionId,
      characters,
      compressionRecords,
      existingMemories,
      extraInstructions
    });
    const trace = this.tracePrompt(normalizedChatSessionId, {
      prompt,
      state: this.memorySnapshot({
        chatSessionId: normalizedChatSessionId,
        characterIds: characters.map((character) => character.characterId)
      }),
      source: 'character-memory.buildPrompt',
      options: {
        characterIds,
        characterId,
        sceneId,
        sourceCompressionIds,
        compressionTypes,
        compressionQuery,
        compressionLimit,
        includeExistingMemories,
        memoryLimit,
        extraInstructions
      }
    });
    return {
      prompt,
      characters,
      compressionRecords,
      existingMemories,
      trace
    };
  }

  applyModelOutput(chatSessionId, content, {
    source = 'assistant',
    defaultMemoryType = 'observation'
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.memorySnapshot({ chatSessionId: normalizedChatSessionId });
    const trace = this.traceRecorder.start('character-memory-apply-model-output', {
      sessionId: normalizedChatSessionId,
      input: { source, defaultMemoryType, content },
      stateBefore: before
    });

    try {
      const extracted = extractCharacterMemoryUpdates(content);
      const records = [];
      for (const update of extracted.updates) {
        records.push(...this.applyCharacterMemoryUpdate(normalizedChatSessionId, update, {
          source,
          defaultMemoryType
        }));
      }
      const output = {
        content: stripCharacterMemoryUpdates(content),
        updates: extracted.updates,
        records,
        state: this.memorySnapshot({ chatSessionId: normalizedChatSessionId }),
        updated: records.length > 0
      };
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output: {
            content: output.content,
            updates: output.updates,
            recordIds: records.map((record) => record.id),
            updated: output.updated
          },
          stateAfter: output.state
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  getPromptContext(chatSessionId, {
    characterId,
    characterIds,
    sceneId,
    query = '',
    memoryTypes,
    visibility,
    status = 'active',
    limitPerCharacter = DEFAULT_MEMORY_LIMIT,
    maxContextTokens
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const characters = this.resolveTargetCharacters({
      chatSessionId: normalizedChatSessionId,
      characterIds: characterIds || characterId,
      sceneId
    });
    const resolvedIds = characters.map((character) => character.characterId);
    const records = this.listMemories({
      chatSessionId: normalizedChatSessionId,
      characterIds: resolvedIds,
      memoryTypes,
      visibility,
      status,
      query,
      limit: Math.max(1, resolvedIds.length || 1) * safePositiveInteger(limitPerCharacter, DEFAULT_MEMORY_LIMIT)
    }).records;
    const byCharacter = new Map(characters.map((character) => [character.characterId, {
      character,
      records: []
    }]));
    for (const record of records) {
      const key = normalizeCharacterId(record.data?.characterId);
      if (!byCharacter.has(key)) {
        byCharacter.set(key, {
          character: { characterId: key, name: record.data?.name || key },
          records: []
        });
      }
      const group = byCharacter.get(key);
      if (group.records.length < safePositiveInteger(limitPerCharacter, DEFAULT_MEMORY_LIMIT)) {
        group.records.push(record);
      }
    }
    const sections = [...byCharacter.values()]
      .filter((group) => group.records.length > 0);
    const rawContext = renderCharacterMemoryContext(sections);
    const context = trimContextByTokenBudget(rawContext, maxContextTokens);
    return {
      chatSessionId: normalizedChatSessionId,
      characters,
      context,
      sections,
      tokenEstimate: estimateTokens(context),
      truncated: context.length < rawContext.length,
      options: {
        characterIds,
        characterId,
        sceneId,
        query,
        memoryTypes,
        visibility,
        status,
        limitPerCharacter,
        maxContextTokens
      }
    };
  }

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        characterMemories: this.collection,
        character_memories: this.collection,
        memories: this.collection,
        memory: this.collection,
        records: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectMemoryRecords(groups, input.collection || this.collection);
    const records = selected.map((record) => this.applyMemoryRecord({
      ...record,
      chatSessionId
    }, {
      source: input.source || record.source || 'document-import',
      defaultMemoryType: input.defaultMemoryType || record.memoryType || 'observation'
    }));
    return {
      format: parsed.format,
      collection: this.collection,
      chatSessionId,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    format = 'json',
    characterId,
    characterIds,
    memoryType,
    memoryTypes,
    status,
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listMemories({
      chatSessionId,
      characterId,
      characterIds,
      memoryType,
      memoryTypes,
      status,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      characterMemories: listed.records.map((record) => ({
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

  applyCharacterMemoryUpdate(chatSessionId, update = {}, { source = 'assistant', defaultMemoryType = 'observation' } = {}) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) return [];
    const entries = extractMemoryEntries(update, defaultMemoryType);
    return entries.map((entry) => this.applyMemoryRecord({
      sourceCompressionIds: update.sourceCompressionIds,
      sourceMessageIds: update.sourceMessageIds,
      fromOrderIndex: update.fromOrderIndex,
      toOrderIndex: update.toOrderIndex,
      ...entry,
      chatSessionId,
      memoryType: entry.memoryType || entry.type || update.memoryType || defaultMemoryType
    }, {
      source: entry.source || update.source || source,
      defaultMemoryType
    }));
  }

  applyMemoryRecord(input = {}, { source = 'manual', defaultMemoryType = 'observation' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const explicitId = normalizeOptionalText(input.recordId || input.memoryId || input.id);
    const existing = explicitId
      ? manager.getRecord(this.collection, explicitId, { missing: 'undefined' })
      : undefined;
    const normalized = normalizeCharacterMemoryRecord(input, {
      chatSessionId,
      existing: existing?.data,
      source,
      defaultMemoryType,
      now: this.now
    });
    const recordId = explicitId || characterMemoryId(normalized);
    return manager.upsertRecord(this.collection, normalized, { id: recordId });
  }

  selectCompressionRecords(chatSessionId, {
    sourceCompressionIds,
    compressionTypes = [],
    compressionQuery = '',
    compressionLimit = DEFAULT_COMPRESSION_LIMIT
  } = {}) {
    const ids = normalizeStringArray(sourceCompressionIds);
    const types = normalizeStringArray(compressionTypes);
    if (ids.length > 0) {
      return ids.map((id) => this.chatCompression.getSummary({ chatSessionId, id }));
    }
    const listed = this.chatCompression.listSummaries({
      chatSessionId,
      status: 'active',
      query: compressionQuery,
      limit: safePositiveInteger(compressionLimit, DEFAULT_COMPRESSION_LIMIT)
    });
    return listed.records.filter((record) => types.length === 0 || types.includes(record.data?.type));
  }

  resolveTargetCharacters({ chatSessionId, characterIds, sceneId } = {}) {
    const ids = normalizeStringArray(characterIds);
    if (ids.length > 0) {
      return ids.map((id) => ({
        characterId: normalizeCharacterId(id),
        name: normalizeCharacterId(id),
        source: 'input'
      }));
    }
    if (sceneId) {
      const sceneCharacters = this.listSceneCharacters({ chatSessionId, sceneId });
      if (sceneCharacters.length > 0) return sceneCharacters;
    }
    return [];
  }

  listSceneCharacters({ chatSessionId, sceneId = 'current' } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    this.ensureCollection(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    if (!manager.hasCollection(SCENE_NPC_MOUNTS_COLLECTION)) return [];
    const result = manager.queryRecords(SCENE_NPC_MOUNTS_COLLECTION, {
      filter: { sceneId: normalizeOptionalText(sceneId) || 'current' },
      limit: 500,
      sort: [{ field: 'orderIndex', direction: 'asc' }, { field: 'name', direction: 'asc' }]
    });
    return result.records
      .filter((record) => !INACTIVE_SCENE_STATUSES.has(String(record.data?.status || '').toLowerCase()))
      .map((record) => ({
        characterId: normalizeCharacterId(record.data?.npcId || record.id),
        name: normalizeOptionalText(record.data?.name) || normalizeCharacterId(record.data?.npcId || record.id),
        aliases: normalizeStringArray(record.data?.aliases),
        role: normalizeOptionalText(record.data?.role),
        summary: normalizeOptionalText(record.data?.summary),
        source: 'scene_npc_mount',
        mountId: record.id
      }));
  }

  memorySnapshot({ chatSessionId, characterIds, status = 'active' } = {}) {
    const listed = this.listMemories({
      chatSessionId,
      characterIds,
      status,
      limit: 500
    });
    return {
      chatSessionId: listed.chatSessionId,
      characterIds: normalizeStringArray(characterIds),
      status,
      memories: listed.records.map((record) => ({
        id: record.id,
        ...record.data
      }))
    };
  }

  tracePrompt(chatSessionId, { prompt, state, source = 'prompt', options = {} } = {}) {
    const trace = this.traceRecorder.start('character-memory-build-prompt', {
      sessionId: chatSessionId,
      input: { source, options },
      stateBefore: state
    });
    return this.traceRecorder.finish(trace, {
      output: {
        source,
        options,
        promptChars: String(prompt || '').length
      },
      stateAfter: state,
      prompt
    });
  }

  openManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

export function buildCharacterMemoryPrompt({
  chatSessionId,
  characters = [],
  compressionRecords = [],
  existingMemories = [],
  extraInstructions = '',
  tag = CHARACTER_MEMORY_TAG
} = {}) {
  const template = {
    memories: [
      {
        characterId: 'npc_id',
        name: 'NPC name',
        memoryType: 'fact',
        summary: 'what this character remembers, believes, suspects, or feels',
        knowledgeState: 'known',
        importance: 0.7,
        emotionalWeight: 0.3,
        confidence: 0.9,
        visibility: 'private',
        tags: ['tag'],
        relatedCharacterIds: ['other_npc_id'],
        sourceCompressionIds: ['chatcomp_id'],
        sourceMessageIds: ['msg_id'],
        fromOrderIndex: 0,
        toOrderIndex: 0,
        status: 'active'
      }
    ]
  };

  return [
    'Project compressed chat memory into per-character subjective memories for an interactive text RPG.',
    'Use only the provided compressed source records. Do not scan or invent raw chat history.',
    'Write memories from the perspective of each target character: what they know, believe, suspect, misunderstand, care about, promised, fear, want, or should react to.',
    'Do not store full persona, long backstory, numeric combat state, inventory, or relationship graph data here.',
    'Prefer compact records with stable characterId, memoryType, sourceCompressionIds, and inherited sourceMessageIds.',
    'A character may remember false or incomplete information; use knowledgeState "false" or "suspected" instead of correcting it omnisciently.',
    `Return exactly one JSON block wrapped as <${tag}>JSON</${tag}>.`,
    `Chat session id: ${chatSessionId || ''}.`,
    characters.length > 0 ? `Target characters:\n${JSON.stringify(characters, null, 2)}` : 'Target characters: infer from source records only if characterId is explicit; otherwise write no memory.',
    existingMemories.length > 0 ? `Existing character memories:\n${serializeMemoryRecords(existingMemories)}` : '',
    compressionRecords.length > 0 ? `Compressed source records:\n${serializeCompressionRecords(compressionRecords)}` : 'Compressed source records: none.',
    extraInstructions ? `Additional instructions:\n${extraInstructions}` : '',
    `Output JSON shape reference:\n${JSON.stringify(template, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function extractCharacterMemoryUpdates(content, { tag = CHARACTER_MEMORY_TAG } = {}) {
  const text = String(content || '');
  const updates = [];
  const tagPattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*<\\/${tag}>`, 'gi');
  let match;

  while ((match = tagPattern.exec(text))) {
    updates.push(parseMemoryUpdate(match[1]));
  }

  const fencePattern = /```(?:json)?\s*ai-dnd-character-memory\s*([\s\S]*?)```/gi;
  while ((match = fencePattern.exec(text))) {
    updates.push(parseMemoryUpdate(match[1]));
  }

  return { updates };
}

export function stripCharacterMemoryUpdates(content, { tag = CHARACTER_MEMORY_TAG } = {}) {
  return String(content || '')
    .replace(new RegExp(`\\s*<${tag}>\\s*[\\s\\S]*?\\s*<\\/${tag}>\\s*`, 'gi'), '\n')
    .replace(/\s*```(?:json)?\s*ai-dnd-character-memory\s*[\s\S]*?```\s*/gi, '\n')
    .trim();
}

export function normalizeCharacterMemoryRecord(input = {}, {
  chatSessionId,
  existing,
  source = 'manual',
  defaultMemoryType = 'observation',
  now = () => new Date().toISOString()
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('character memory record must be a plain object');
  }

  const base = normalizeExistingMemory(existing);
  const characterId = normalizeCharacterId(pickDefined(input.characterId, input.npcId, base.characterId));
  const memoryType = normalizeMemoryType(pickDefined(input.memoryType, input.type, base.memoryType, defaultMemoryType));
  const summary = normalizeOptionalText(pickDefined(input.summary, input.text, base.summary));
  if (!summary) throw validationError('summary is required');
  const sourceCompressionIds = normalizeStringArray(pickDefined(input.sourceCompressionIds, input.compressionIds, base.sourceCompressionIds));
  const sourceMessageIds = normalizeStringArray(pickDefined(input.sourceMessageIds, input.messageIds, base.sourceMessageIds));

  return {
    chatSessionId: normalizeRequiredText(chatSessionId || input.chatSessionId || base.chatSessionId, 'chatSessionId'),
    characterId,
    name: normalizeOptionalText(pickDefined(input.name, base.name)) || characterId,
    aliases: normalizeStringArray(pickDefined(input.aliases, base.aliases)),
    memoryType,
    summary,
    knowledgeState: normalizeKnowledgeState(pickDefined(input.knowledgeState, input.state, base.knowledgeState, 'known')),
    importance: normalizeUnitNumber(pickDefined(input.importance, base.importance, defaultImportance(memoryType)), 'importance'),
    emotionalWeight: normalizeUnitNumber(pickDefined(input.emotionalWeight, input.emotionWeight, base.emotionalWeight, defaultEmotionalWeight(memoryType)), 'emotionalWeight'),
    confidence: normalizeUnitNumber(pickDefined(input.confidence, base.confidence, 0.8), 'confidence'),
    visibility: normalizeVisibility(pickDefined(input.visibility, base.visibility, 'private')),
    status: normalizeStatus(pickDefined(input.status, base.status, 'active')),
    tags: normalizeStringArray(pickDefined(input.tags, base.tags)),
    relatedCharacterIds: normalizeStringArray(pickDefined(input.relatedCharacterIds, input.relatedNpcIds, base.relatedCharacterIds)).map(normalizeCharacterId),
    sourceCompressionIds,
    sourceMessageIds,
    fromOrderIndex: normalizeOptionalInteger(pickDefined(input.fromOrderIndex, base.fromOrderIndex)),
    toOrderIndex: normalizeOptionalInteger(pickDefined(input.toOrderIndex, base.toOrderIndex)),
    source: normalizeOptionalText(source || input.source || base.source || 'manual'),
    metadata: normalizeObject(pickDefined(input.metadata, base.metadata)),
    memoryUpdatedAt: now()
  };
}

function extractMemoryEntries(update, defaultMemoryType) {
  if (Array.isArray(update.memories)) return update.memories;
  if (Array.isArray(update.characterMemories)) return update.characterMemories;
  if (Array.isArray(update.records)) return update.records;
  if (update.characterId || update.npcId || update.summary || update.text) {
    return [{ ...update, memoryType: update.memoryType || update.type || defaultMemoryType }];
  }
  return [];
}

function selectMemoryRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const selected = preferred || groups.find((group) => [
    'characterMemories',
    'character_memories',
    CHARACTER_MEMORY_COLLECTION,
    'memories',
    'memory',
    'records'
  ].includes(group.collection)) || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function renderCharacterMemoryContext(sections = []) {
  return sections.map(({ character, records }) => {
    const header = `${character.name || character.characterId} (${character.characterId}) memories:`;
    const lines = records.map((record) => {
      const data = record.data || {};
      const state = data.knowledgeState && data.knowledgeState !== 'known' ? `/${data.knowledgeState}` : '';
      const type = data.memoryType ? `[${data.memoryType}${state}] ` : '';
      return `- ${type}${data.summary}`;
    });
    return [header, ...lines].join('\n');
  }).join('\n\n');
}

function serializeCompressionRecords(records = []) {
  return records.map((record) => {
    const data = record.data || {};
    return JSON.stringify({
      id: record.id,
      type: data.type,
      title: data.title,
      summary: data.summary,
      facts: data.facts,
      openThreads: data.openThreads,
      npcNotes: data.npcNotes,
      sceneNotes: data.sceneNotes,
      sourceMessageIds: data.sourceMessageIds,
      fromOrderIndex: data.fromOrderIndex,
      toOrderIndex: data.toOrderIndex
    }, null, 2);
  }).join('\n');
}

function serializeMemoryRecords(records = []) {
  return records.map((record) => JSON.stringify({
    id: record.id,
    ...record.data
  }, null, 2)).join('\n');
}

function trimContextByTokenBudget(context, maxContextTokens) {
  const budget = Number(maxContextTokens);
  if (!Number.isFinite(budget) || budget <= 0) return context;
  if (estimateTokens(context) <= budget) return context;
  const approxChars = Math.max(200, Math.floor(budget * 3));
  return context.slice(Math.max(0, context.length - approxChars)).trimStart();
}

function characterMemoryId(record) {
  return `charmem_${safeSegment(record.characterId)}_${safeSegment(record.memoryType)}_${shortHash(record.summary)}`.slice(0, 128);
}

function normalizeExistingMemory(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    chatSessionId: '',
    characterId: '',
    name: '',
    aliases: [],
    memoryType: 'observation',
    summary: '',
    knowledgeState: 'known',
    importance: undefined,
    emotionalWeight: undefined,
    confidence: undefined,
    visibility: 'private',
    status: 'active',
    tags: [],
    relatedCharacterIds: [],
    sourceCompressionIds: [],
    sourceMessageIds: [],
    fromOrderIndex: undefined,
    toOrderIndex: undefined,
    source: '',
    metadata: {},
    ...input,
    aliases: normalizeStringArray(input.aliases || []),
    tags: normalizeStringArray(input.tags || []),
    relatedCharacterIds: normalizeStringArray(input.relatedCharacterIds || []),
    sourceCompressionIds: normalizeStringArray(input.sourceCompressionIds || []),
    sourceMessageIds: normalizeStringArray(input.sourceMessageIds || []),
    metadata: normalizeObject(input.metadata)
  };
}

function parseMemoryUpdate(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = `Invalid character memory JSON: ${error.message}`;
    error.statusCode = 400;
    throw error;
  }
}

function memoryHaystack(data) {
  return normalizeSearchText([
    data.characterId,
    data.name,
    ...(Array.isArray(data.aliases) ? data.aliases : []),
    data.memoryType,
    data.summary,
    data.knowledgeState,
    data.visibility,
    ...(Array.isArray(data.tags) ? data.tags : []),
    ...(Array.isArray(data.relatedCharacterIds) ? data.relatedCharacterIds : []),
    ...(Array.isArray(data.sourceCompressionIds) ? data.sourceCompressionIds : []),
    ...(Array.isArray(data.sourceMessageIds) ? data.sourceMessageIds : [])
  ].filter(Boolean).join(' '));
}

function normalizeCharacterId(value) {
  const text = normalizeRequiredText(value, 'characterId');
  return safeSegment(text) || `char_${shortHash(text)}`;
}

function normalizeMemoryType(type) {
  const normalized = String(type || 'observation').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (CHARACTER_MEMORY_TYPES.has(normalized)) return normalized;
  throw validationError(`Unsupported character memory type: ${type}`);
}

function normalizeKnowledgeState(value) {
  const normalized = String(value || 'known').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (CHARACTER_KNOWLEDGE_STATES.has(normalized)) return normalized;
  throw validationError(`Unsupported character knowledge state: ${value}`);
}

function normalizeVisibility(value) {
  const normalized = String(value || 'private').trim().toLowerCase();
  if (['private', 'shared', 'public'].includes(normalized)) return normalized;
  throw validationError(`Unsupported character memory visibility: ${value}`);
}

function normalizeStatus(status) {
  const normalized = String(status || 'active').trim().toLowerCase();
  if (['active', 'superseded', 'archived', 'draft'].includes(normalized)) return normalized;
  throw validationError(`Unsupported character memory status: ${status}`);
}

function defaultImportance(type) {
  if (['secret', 'promise', 'relationship', 'goal'].includes(type)) return 0.8;
  if (['emotion', 'misunderstanding', 'rule'].includes(type)) return 0.7;
  return 0.5;
}

function defaultEmotionalWeight(type) {
  if (['emotion', 'relationship', 'secret', 'promise'].includes(type)) return 0.6;
  return 0.2;
}

function normalizeUnitNumber(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be a finite number: ${value}`);
  return Math.max(0, Math.min(1, number));
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) throw validationError(`Expected integer, got: ${value}`);
  return number;
}

function safePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return fallback;
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

function pickDefined(...values) {
  return values.find((value) => value !== undefined);
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'character-memory');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'CharacterMemoryValidationError';
  error.statusCode = 400;
  return error;
}
