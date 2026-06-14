// @ts-nocheck
import YAML from 'yaml';
import { documentToCollections, parseStructuredDocument } from '../data/structured-document-importer.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const NPC_STRUCTURED_STATE_TAG = 'AI_DND_NPC_STATE';
export const ACTOR_STRUCTURED_STATE_TAG = 'AI_DND_ACTOR_STATE';
export const NPC_STRUCTURED_STATE_COLLECTION = 'npc_structured_states';

export const NPC_STRUCTURED_STATE_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'sceneId', type: 'text', description: 'Scene id or label. Use "current" when no scene id exists yet.' },
  { name: 'npcId', type: 'text', description: 'NPC id from L0 registry, scene mount, or local state.' },
  { name: 'name', type: 'text', description: 'Display name.' },
  { name: 'actorType', type: 'text', description: 'Actor class: npc, player, companion, summon, monster, etc.' },
  { name: 'isPlayer', type: 'boolean', description: 'Whether this actor state belongs to a player-controlled protagonist.' },
  { name: 'isProtagonist', type: 'boolean', description: 'Whether this actor is the unique active protagonist for the current chat.' },
  { name: 'playerId', type: 'text', description: 'Optional player/protagonist identity id for player actors.' },
  { name: 'greeting', type: 'text', description: 'Optional protagonist opening situation or first player-side message. Empty means the opening is not fixed.' },
  { name: 'values', type: 'json', description: 'Numeric values only, e.g. hp, maxHp, armor, morale, suspicion.' },
  { name: 'statusBar', type: 'json', description: 'Player-facing status bar state: hp, resources, abilities, saves, conditions, special skills.' },
  { name: 'skillBar', type: 'json', description: 'Player-facing skill/action bar: skills, spells, actions, cooldowns, uses.' },
  { name: 'specialStatuses', type: 'json', description: 'Special status effects and conditions.' },
  { name: 'inventory', type: 'json', description: 'NPC inventory: currency and items.' },
  { name: 'equipment', type: 'json', description: 'Player-facing equipped items, attunement, armor, weapons, or quick slots.' },
  { name: 'resources', type: 'json', description: 'Player-facing consumable or replenishing resources such as inspiration, spell slots, hit dice, stamina.' },
  { name: 'source', type: 'text', description: 'assistant, manual, tool, import, etc.' },
  { name: 'stateUpdatedAt', type: 'text', description: 'Latest NPC structured state update timestamp.' }
];

const DEFAULT_SCENE_ID = 'current';

export class NpcStructuredStateDatabase {
  constructor({
    appDatabase,
    collection = NPC_STRUCTURED_STATE_COLLECTION,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('NpcStructuredStateDatabase requires appDatabase');
    this.appDatabase = appDatabase;
    this.collection = collection;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/npc-structured-state-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollection(chatSessionId) {
    const database = this.appDatabase.ensureChatDataDatabase(chatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
    manager.ensureCollection(this.collection);
    manager.alterFields(this.collection, {
      add: NPC_STRUCTURED_STATE_FIELDS,
      reason: 'npcStructuredState:values-status-inventory'
    });
    return {
      database,
      collection: manager.describeCollection(this.collection)
    };
  }

  describe(chatSessionId) {
    return this.ensureCollection(chatSessionId);
  }

  listNpcStates({
    chatSessionId,
    sceneId,
    npcId,
    actorType,
    isPlayer,
    isProtagonist,
    playerId,
    query = '',
    filter = {},
    sort = [{ field: 'sceneId', direction: 'asc' }, { field: 'name', direction: 'asc' }],
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const mergedFilter = { ...filter };
    if (sceneId) mergedFilter.sceneId = normalizeSceneId(sceneId);
    if (npcId) mergedFilter.npcId = normalizeOptionalText(npcId);
    if (actorType) mergedFilter.actorType = normalizeActorType(actorType);
    if (isPlayer !== undefined) mergedFilter.isPlayer = normalizeBoolean(isPlayer);
    if (isProtagonist !== undefined) mergedFilter.isProtagonist = normalizeBoolean(isProtagonist);
    if (playerId) mergedFilter.playerId = normalizeOptionalText(playerId);

    const result = manager.queryRecords(this.collection, {
      filter: mergedFilter,
      sort,
      limit,
      offset
    });
    const normalizedQuery = normalizeSearchText(query);
    const records = result.records.filter((record) => {
      const data = record.data || {};
      if (!normalizedQuery) return true;
      const haystack = normalizeSearchText([
        data.npcId,
        data.name,
        data.actorType,
        data.playerId,
        data.greeting,
        data.sceneId,
        Object.keys(data.values || {}).join(' '),
        JSON.stringify(data.statusBar || {}),
        JSON.stringify(data.skillBar || {}),
        JSON.stringify(data.resources || {}),
        (data.specialStatuses || []).map((status) => `${status.id || ''} ${status.name || ''}`).join(' '),
        (data.inventory?.items || []).map((item) => `${item.id || ''} ${item.name || ''}`).join(' ')
      ].filter(Boolean).join(' '));
      return haystack.includes(normalizedQuery);
    });

    return {
      ...result,
      chatSessionId: normalizedChatSessionId,
      records
    };
  }

  getNpcState(input = {}) {
    return this.resolveNpcState(input);
  }

  patchNpcState(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start('npc-state-update', {
      sessionId: chatSessionId,
      input: { source, mode: 'patch', update: input },
      stateBefore: before
    });

    try {
      const record = this.applyNpcStateRecord(input, { mode: 'patch', source });
      const after = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source, mode: 'patch' },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  rewriteNpcState(input = {}, { source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start('npc-state-save', {
      sessionId: chatSessionId,
      input: { source, mode: 'rewrite', state: input },
      stateBefore: before
    });

    try {
      const record = this.applyNpcStateRecord(input, { mode: 'rewrite', source });
      const after = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
      return {
        record,
        state: after,
        trace: this.traceRecorder.finish(trace, {
          output: { recordId: record.id, source, mode: 'rewrite' },
          stateAfter: after
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  deleteNpcState(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId, sceneId: input.sceneId, includeAllScenes: !input.sceneId });
    const trace = this.traceRecorder.start('npc-state-delete', {
      sessionId: chatSessionId,
      input,
      stateBefore: before
    });

    try {
      const current = this.resolveNpcState(input);
      const { manager } = this.openManager(chatSessionId);
      const deleted = manager.deleteRecord(this.collection, current.id);
      const after = this.stateSnapshot({ chatSessionId, sceneId: current.data.sceneId });
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

  applyModelOutput(chatSessionId, content, {
    defaultMode = 'patch',
    source = 'assistant',
    sceneId = DEFAULT_SCENE_ID
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.stateSnapshot({ chatSessionId: normalizedChatSessionId, sceneId });
    const trace = this.traceRecorder.start('npc-state-apply-model-output', {
      sessionId: normalizedChatSessionId,
      input: { source, defaultMode, sceneId, content },
      stateBefore: before
    });

    try {
      const extracted = extractNpcStructuredStateUpdates(content);
      const records = [];
      for (const update of extracted.updates) {
        records.push(...this.applyNpcStructuredUpdate(normalizedChatSessionId, update, {
          defaultMode,
          source,
          sceneId
        }));
      }
      const output = {
        content: stripNpcStructuredStateUpdates(content),
        updates: extracted.updates,
        records,
        state: this.stateSnapshot({ chatSessionId: normalizedChatSessionId, sceneId }),
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

  buildPrompt(chatSessionId, {
    sceneId = DEFAULT_SCENE_ID,
    includeCurrentState = true,
    mode = 'patch',
    extraInstructions = ''
  } = {}) {
    const state = this.stateSnapshot({ chatSessionId, sceneId });
    const prompt = buildNpcStructuredStatePrompt({
      state,
      includeCurrentState,
      mode,
      extraInstructions
    });
    const trace = this.tracePrompt(chatSessionId, {
      prompt,
      state,
      source: 'npc-state.buildPrompt',
      options: {
        sceneId,
        includeCurrentState,
        mode,
        extraInstructions
      }
    });
    return {
      prompt,
      state,
      trace
    };
  }

  tracePrompt(chatSessionId, { prompt, state, source = 'prompt', options = {} } = {}) {
    const trace = this.traceRecorder.start('npc-state-build-prompt', {
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

  importDocument(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const sceneId = normalizeSceneId(input.sceneId);
    const parsed = parseStructuredDocument(input);
    const groups = documentToCollections({
      data: parsed.data,
      collection: input.collection,
      collectionMap: input.collectionMap || {
        npcStates: this.collection,
        npc_states: this.collection,
        npc_structured_states: this.collection,
        actors: this.collection,
        players: this.collection,
        playerStates: this.collection,
        player_states: this.collection,
        npcs: this.collection
      },
      idField: input.idField || 'id'
    });
    const selected = selectNpcStateRecords(groups, input.collection || this.collection);
    const mode = input.mode || 'rewrite';
    const records = selected.map((record) => this.applyNpcStateRecord({
      ...record,
      chatSessionId,
      sceneId: record.sceneId || sceneId
    }, {
      mode,
      source: input.source || record.source || 'document-import'
    }));
    return {
      format: parsed.format,
      collection: this.collection,
      chatSessionId,
      sceneId,
      count: records.length,
      ids: records.map((record) => record.id),
      records
    };
  }

  exportDocument({
    chatSessionId,
    sceneId,
    format = 'json',
    query = '',
    limit = 500,
    offset = 0
  } = {}) {
    const listed = this.listNpcStates({
      chatSessionId,
      sceneId,
      query,
      limit,
      offset
    });
    const payload = {
      chatSessionId: listed.chatSessionId,
      sceneId: sceneId ? normalizeSceneId(sceneId) : undefined,
      npcStates: listed.records.map((record) => ({
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

  applyNpcStructuredUpdate(chatSessionId, update = {}, { defaultMode = 'patch', source = 'assistant', sceneId } = {}) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) return [];
    const mode = normalizeMode(update.mode || defaultMode);
    const resolvedSceneId = normalizeSceneId(update.sceneId || sceneId);
    const entries = [
      ...normalizeActorEntries(update.actors),
      ...normalizeActorEntries(update.players).map((entry) => ({ ...entry, actorType: entry.actorType || 'player', isPlayer: entry.isPlayer ?? true })),
      ...normalizeActorEntries(update.player).map((entry) => ({ ...entry, actorType: entry.actorType || 'player', isPlayer: entry.isPlayer ?? true })),
      ...normalizeActorEntries(update.npcs),
      ...normalizeActorEntries(update.npc),
      ...((update.npcId || update.playerId || update.name) ? [update] : [])
    ];

    return entries.map((entry) => this.applyNpcStateRecord({
      ...entry,
      chatSessionId,
      sceneId: entry.sceneId || resolvedSceneId
    }, { mode, source: entry.source || source }));
  }

  applyNpcStateRecord(input = {}, { mode = 'patch', source = 'manual' } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(chatSessionId);
    const sceneId = normalizeSceneId(input.sceneId);
    const npcId = normalizeNpcId(input.npcId || input.playerId || input.id || input.name);
    const recordId = input.recordId || npcStateId(sceneId, npcId);
    const existing = manager.getRecord(this.collection, recordId, { missing: 'undefined' });
    const normalized = normalizeNpcStructuredState(input, {
      chatSessionId,
      sceneId,
      npcId,
      existing: existing?.data,
      mode,
      source,
      now: this.now
    });
    return manager.upsertRecord(this.collection, normalized, { id: recordId });
  }

  stateSnapshot({ chatSessionId, sceneId, includeAllScenes = false } = {}) {
    const listed = this.listNpcStates({
      chatSessionId,
      sceneId: includeAllScenes ? undefined : sceneId,
      limit: 500
    });
    const actors = listed.records.map((record) => ({
      id: record.id,
      ...record.data
    }));
    return {
      chatSessionId: listed.chatSessionId,
      sceneId: includeAllScenes ? undefined : normalizeSceneId(sceneId),
      actors,
      players: actors.filter((actor) => actor.isPlayer === true || actor.actorType === 'player'),
      npcs: actors.filter((actor) => !(actor.isPlayer === true || actor.actorType === 'player'))
    };
  }

  resolveNpcState({ chatSessionId, id, recordId, npcId, playerId, sceneId = DEFAULT_SCENE_ID } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const explicitId = normalizeOptionalText(recordId || id);
    if (explicitId && explicitId.startsWith('npcstate_')) return manager.getRecord(this.collection, explicitId);

    const normalizedNpcId = normalizeNpcId(npcId || playerId || id);
    return manager.getRecord(this.collection, npcStateId(normalizeSceneId(sceneId), normalizedNpcId));
  }

  openManager(chatSessionId) {
    this.ensureCollection(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

export function buildNpcStructuredStatePrompt({
  state = { npcs: [] },
  mode = 'patch',
  tag = ACTOR_STRUCTURED_STATE_TAG,
  includeCurrentState = true,
  extraInstructions = ''
} = {}) {
  const template = {
    mode,
    sceneId: 'string',
    actors: [{
      npcId: 'string',
      actorType: 'npc | player',
      isPlayer: false,
      isProtagonist: false,
      playerId: 'string when actorType is player',
      name: 'string',
      greeting: 'optional protagonist opening situation; empty means not fixed',
      values: {
        hp: 0,
        maxHp: 0,
        armorClass: 0,
        morale: 0,
        suspicion: 0
      },
      statusBar: {
        hp: 0,
        maxHp: 0,
        armorClass: 0,
        initiative: 0,
        inspiration: 0,
        abilityScores: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        savingThrows: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
        conditions: ['string'],
        specialSkills: [{ id: 'string', name: 'string', uses: 0, maxUses: 0, ready: true }]
      },
      skillBar: {
        skills: [{ id: 'string', name: 'string', rank: 0, bonus: 0, ready: true }],
        actions: [{ id: 'string', name: 'string', cost: 'action', uses: 0, maxUses: 0, ready: true }],
        spells: [{ id: 'string', name: 'string', level: 0, prepared: true, uses: 0, maxUses: 0 }]
      },
      specialStatuses: [{
        id: 'string',
        name: 'string',
        active: true,
        stacks: 0,
        intensity: 0,
        remainingTurns: 0,
        description: 'string'
      }],
      inventory: {
        currency: { gold: 0 },
        items: [{
          id: 'string',
          name: 'string',
          quantity: 1,
          equipped: false,
          description: 'string'
        }]
      },
      resources: {
        spellSlots: { level1: 0 },
        hitDice: 0
      },
      equipment: {
        armor: { id: 'string', name: 'string' },
        weapons: [{ id: 'string', name: 'string', equipped: true }],
        quickSlots: [{ id: 'string', itemId: 'string' }]
      }
    }]
  };

  return [
    'Maintain only structured actor runtime state for an interactive text RPG. Actors include NPCs and player-controlled protagonists.',
    'Players are special NPC/actor records. Mark possible player-controlled actors with actorType "player" or isPlayer true, and use stable npcId/playerId so protagonist switching is safe.',
    'Only one actor in a chat should have isProtagonist true. greeting is an optional manual/imported protagonist opening situation; if absent, the opening is intentionally not fixed.',
    'Write normal narrative first. Then append exactly one structured JSON block only when an actor numeric value, player status bar, skill bar, special status, resource, equipment, or inventory changes.',
    `Use this exact wrapper: <${tag}>JSON</${tag}>.`,
    `The legacy wrapper <${NPC_STRUCTURED_STATE_TAG}>JSON</${NPC_STRUCTURED_STATE_TAG}> is still accepted for NPC-only updates.`,
    'Allowed state categories are values, statusBar, skillBar, specialStatuses, inventory, resources, equipment, and the manual/imported player setup fields isProtagonist/greeting.',
    'The values object must contain numbers only. statusBar/skillBar/resources/equipment may contain compact structured UI fields for player actors.',
    'Do not put persona, dialogue style, secrets, scene summaries, or long lore here; player persona/profile belongs in L0/L1 actor data, not runtime state.',
    'Use stable npcId and stable ids for statuses/items. For arrays of objects, the same id updates the previous item; include "_delete": true to remove it.',
    'Use mode "patch" for normal updates and "rewrite" only when replacing one actor state.',
    extraInstructions ? `Additional instructions:\n${extraInstructions}` : '',
    includeCurrentState ? `Current NPC structured state / actor structured state:\n${JSON.stringify(state || { actors: [] }, null, 2)}` : '',
    `Output JSON shape reference:\n${JSON.stringify(template, null, 2)}`
  ].filter(Boolean).join('\n\n');
}

export function extractNpcStructuredStateUpdates(content, { tag = ACTOR_STRUCTURED_STATE_TAG } = {}) {
  const text = String(content || '');
  const updates = [];
  const tags = [...new Set([tag, ACTOR_STRUCTURED_STATE_TAG, NPC_STRUCTURED_STATE_TAG].filter(Boolean))];
  let match;

  for (const wrapperTag of tags) {
    const tagPattern = new RegExp(`<${wrapperTag}>\\s*([\\s\\S]*?)\\s*<\\/${wrapperTag}>`, 'gi');
    while ((match = tagPattern.exec(text))) {
      updates.push(parseStructuredUpdate(match[1]));
    }
  }

  const fencePattern = /```(?:json)?\s*ai-dnd-(?:npc|actor)-state\s*([\s\S]*?)```/gi;
  while ((match = fencePattern.exec(text))) {
    updates.push(parseStructuredUpdate(match[1]));
  }

  return { updates };
}

export function stripNpcStructuredStateUpdates(content, { tag = ACTOR_STRUCTURED_STATE_TAG } = {}) {
  let output = String(content || '');
  const tags = [...new Set([tag, ACTOR_STRUCTURED_STATE_TAG, NPC_STRUCTURED_STATE_TAG].filter(Boolean))];
  for (const wrapperTag of tags) {
    output = output.replace(new RegExp(`\\s*<${wrapperTag}>\\s*[\\s\\S]*?\\s*<\\/${wrapperTag}>\\s*`, 'gi'), '\n');
  }
  return output
    .replace(/\s*```(?:json)?\s*ai-dnd-(?:npc|actor)-state\s*[\s\S]*?```\s*/gi, '\n')
    .trim();
}

export function normalizeNpcStructuredState(input = {}, {
  chatSessionId,
  sceneId = DEFAULT_SCENE_ID,
  npcId,
  existing,
  mode = 'patch',
  source = 'manual',
  now = () => new Date().toISOString()
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('npc structured state must be a plain object');
  }

  const rewrite = ['rewrite', 'replace', 'generate'].includes(normalizeMode(mode));
  const base = rewrite ? emptyNpcState() : normalizeExistingState(existing);
  const resolvedSceneId = normalizeSceneId(input.sceneId || sceneId || base.sceneId);
  const actorType = normalizeActorType(input.actorType ?? input.type ?? base.actorType ?? (input.isPlayer || input.playerId ? 'player' : 'npc'));
  const isPlayer = normalizeBoolean(input.isPlayer ?? input.player ?? base.isPlayer ?? actorType === 'player');
  const resolvedNpcId = normalizeNpcId(input.npcId || input.playerId || npcId || base.npcId || input.name);
  const greeting = normalizeGreetingField(input, base);

  return {
    chatSessionId: normalizeRequiredText(chatSessionId || input.chatSessionId || base.chatSessionId, 'chatSessionId'),
    sceneId: resolvedSceneId,
    npcId: resolvedNpcId,
    name: normalizeOptionalText(input.name ?? base.name) || resolvedNpcId,
    actorType: isPlayer ? 'player' : actorType,
    isPlayer,
    isProtagonist: normalizeBoolean(input.isProtagonist ?? input.protagonist ?? input.activeProtagonist ?? base.isProtagonist ?? false),
    playerId: normalizeOptionalText(input.playerId ?? input.protagonistId ?? base.playerId),
    greeting,
    values: updateNumericValues(base.values, input.values || input.numericValues || {}, { rewrite }),
    statusBar: updateStructuredObject(base.statusBar, input.statusBar || {}, { rewrite }),
    skillBar: updateStructuredObject(base.skillBar, input.skillBar || {}, { rewrite }),
    specialStatuses: updateSpecialStatuses(base.specialStatuses, input.specialStatuses || input.statuses || [], { rewrite }),
    inventory: updateInventory(base.inventory, input.inventory || {}, { rewrite }),
    equipment: updateStructuredObject(base.equipment, input.equipment || {}, { rewrite }),
    resources: updateStructuredObject(base.resources, input.resources || {}, { rewrite }),
    source: normalizeOptionalText(source || input.source || base.source || 'manual'),
    stateUpdatedAt: now()
  };
}

function updateNumericValues(current = {}, update = {}, { rewrite = false } = {}) {
  const output = rewrite ? {} : { ...normalizeNumericValues(current, { allowDelete: false }) };
  const incoming = normalizeNumericValues(update, { allowDelete: true });
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) {
      delete output[key];
    } else {
      output[key] = value;
    }
  }
  return output;
}

function updateStructuredObject(current = {}, update = {}, { rewrite = false } = {}) {
  const base = rewrite ? {} : normalizeObject(current);
  const incoming = normalizeObject(update);
  if (Object.keys(incoming).length === 0) return base;
  return deepMergeStructured(base, incoming);
}

function normalizeGreetingField(input = {}, base = {}) {
  for (const field of ['greeting', 'initialGreeting', 'initialSituation', 'openingSituation']) {
    if (Object.hasOwn(input, field)) return normalizeOptionalText(input[field]);
  }
  return normalizeOptionalText(base.greeting || '');
}

function deepMergeStructured(current, update) {
  if (update === undefined) return current;
  if (update === null) return undefined;
  if (Array.isArray(current) || Array.isArray(update)) {
    return Array.isArray(update) ? update : current;
  }
  if (isPlainObject(current) && isPlainObject(update)) {
    const merged = { ...current };
    for (const [key, value] of Object.entries(update)) {
      if (value === null) {
        delete merged[key];
      } else {
        merged[key] = deepMergeStructured(current[key], value);
      }
    }
    return merged;
  }
  return update;
}

function normalizeNumericValues(values = {}, { allowDelete = false } = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(values)) {
    const field = normalizeStateFieldName(key);
    if (raw === null && allowDelete) {
      output[field] = null;
      continue;
    }
    if (typeof raw === 'object') {
      throw validationError(`NPC numeric value must be a number: ${field}`);
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      throw validationError(`NPC numeric value must be finite: ${field}`);
    }
    output[field] = value;
  }
  return output;
}

function updateSpecialStatuses(current = [], update = [], { rewrite = false } = {}) {
  return mergeObjectArray(rewrite ? [] : normalizeSpecialStatuses(current), normalizeSpecialStatuses(update), 'status');
}

function normalizeSpecialStatuses(statuses = []) {
  const items = Array.isArray(statuses) ? statuses : [statuses];
  return items
    .filter((status) => status && typeof status === 'object' && !Array.isArray(status))
    .map((status) => ({
      id: normalizeItemId(status.id || status.name || status.status, 'status'),
      name: normalizeOptionalText(status.name || status.status || status.id),
      active: status.active !== false,
      stacks: normalizeOptionalNumber(status.stacks),
      intensity: normalizeOptionalNumber(status.intensity ?? status.value),
      remainingTurns: normalizeOptionalNumber(status.remainingTurns ?? status.duration ?? status.turns),
      source: normalizeOptionalText(status.source),
      description: normalizeOptionalText(status.description || status.text),
      metadata: normalizeObject(status.metadata),
      _delete: status._delete === true
    }));
}

function updateInventory(current = {}, update = {}, { rewrite = false } = {}) {
  const base = rewrite ? emptyInventory() : normalizeInventory(current);
  const incoming = normalizeInventory(update);
  return {
    currency: updateNumericValues(base.currency, incoming.currency),
    items: mergeObjectArray(base.items, incoming.items, 'item')
  };
}

function normalizeInventory(inventory = {}) {
  const input = inventory && typeof inventory === 'object' && !Array.isArray(inventory) ? inventory : {};
  return {
    currency: normalizeNumericValues(input.currency || {}),
    items: normalizeInventoryItems(input.items || [])
  };
}

function normalizeInventoryItems(items = []) {
  const input = Array.isArray(items) ? items : [items];
  return input
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      id: normalizeItemId(item.id || item.name, 'item'),
      name: normalizeOptionalText(item.name || item.id),
      quantity: normalizeOptionalNumber(item.quantity ?? item.count, 1),
      equipped: item.equipped === true,
      value: normalizeOptionalNumber(item.value),
      weight: normalizeOptionalNumber(item.weight),
      tags: normalizeStringArray(item.tags),
      description: normalizeOptionalText(item.description || item.text),
      metadata: normalizeObject(item.metadata),
      _delete: item._delete === true
    }));
}

function mergeObjectArray(current = [], update = [], prefix = 'item') {
  const byId = new Map();
  for (const item of current) {
    if (!item?.id) continue;
    const { _delete, ...clean } = item;
    byId.set(clean.id, clean);
  }
  for (const item of update) {
    if (!item?.id) continue;
    if (item._delete) {
      byId.delete(item.id);
      continue;
    }
    const previous = byId.get(item.id) || {};
    const { _delete, ...clean } = item;
    byId.set(clean.id, { ...previous, ...clean });
  }
  return [...byId.values()].map((item) => ({
    ...item,
    id: item.id || normalizeItemId(item.name, prefix)
  }));
}

function selectNpcStateRecords(groups, preferredCollection) {
  const preferred = groups.find((group) => group.collection === preferredCollection);
  const states = groups.find((group) => [
    'npcStates',
    'npc_states',
    'npc_structured_states',
    'actorStates',
    'actor_states',
    'actors',
    'playerStates',
    'player_states',
    'players',
    'npcs',
    NPC_STRUCTURED_STATE_COLLECTION
  ].includes(group.collection));
  const selected = preferred || states || groups[0];
  return (selected?.records || []).filter((record) => record && typeof record === 'object');
}

function emptyNpcState() {
  return {
    chatSessionId: '',
    sceneId: DEFAULT_SCENE_ID,
    npcId: '',
    name: '',
    actorType: 'npc',
    isPlayer: false,
    isProtagonist: false,
    playerId: '',
    greeting: '',
    values: {},
    statusBar: {},
    skillBar: {},
    specialStatuses: [],
    inventory: emptyInventory(),
    equipment: {},
    resources: {},
    source: ''
  };
}

function normalizeExistingState(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...emptyNpcState(),
    ...input,
    values: normalizeNumericValues(input.values || {}),
    greeting: normalizeOptionalText(input.greeting || input.initialGreeting || input.initialSituation || input.openingSituation || ''),
    statusBar: normalizeObject(input.statusBar || {}),
    skillBar: normalizeObject(input.skillBar || {}),
    specialStatuses: normalizeSpecialStatuses(input.specialStatuses || []),
    inventory: normalizeInventory(input.inventory || {}),
    equipment: normalizeObject(input.equipment || {}),
    resources: normalizeObject(input.resources || {})
  };
}

function emptyInventory() {
  return {
    currency: {},
    items: []
  };
}

function normalizeActorEntries(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
}

function parseStructuredUpdate(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    error.message = `Invalid NPC structured state JSON: ${error.message}`;
    error.statusCode = 400;
    throw error;
  }
}

function npcStateId(sceneId, npcId) {
  return `npcstate_${safeSegment(sceneId)}_${safeSegment(npcId)}`.slice(0, 128);
}

function normalizeNpcId(value) {
  const text = normalizeRequiredText(value, 'npcId');
  return safeSegment(text) || `npc_${shortHash(text)}`;
}

function normalizeSceneId(value) {
  return normalizeOptionalText(value) || DEFAULT_SCENE_ID;
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

function normalizeStateFieldName(value) {
  const field = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  if (!field) throw validationError('NPC numeric value field name is required');
  return field;
}

function normalizeItemId(value, prefix) {
  const text = normalizeOptionalText(value);
  return safeSegment(text) || `${prefix}_${shortHash(text || prefix)}`;
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function normalizeMode(mode) {
  const normalized = String(mode || 'patch').toLowerCase();
  if (['rewrite', 'replace', 'generate', 'manual', 'patch', 'auto'].includes(normalized)) return normalized;
  return 'patch';
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

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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

function validationError(message) {
  const error = new Error(message);
  error.name = 'NpcStructuredStateValidationError';
  error.statusCode = 400;
  return error;
}

function shortHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || 'npc-state');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
