// @ts-nocheck
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const PROTAGONIST_ACTIVE_COLLECTION = 'protagonist_active';
export const PROTAGONIST_SWITCH_HISTORY_COLLECTION = 'protagonist_switch_history';

export const PROTAGONIST_ACTIVE_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning app chat session id. Duplicated for readable exports.' },
  { name: 'activeActorId', type: 'text', description: 'Current protagonist actor id, usually an npc_structured_states npcId.' },
  { name: 'activePlayerId', type: 'text', description: 'Optional player/protagonist identity id.' },
  { name: 'sceneId', type: 'text', description: 'Scene where the protagonist pointer is active.' },
  { name: 'mode', type: 'text', description: 'perspective, possession, manual, or import.' },
  { name: 'previousActorId', type: 'text', description: 'Previous protagonist actor id.' },
  { name: 'switchId', type: 'text', description: 'Latest switch history id.' },
  { name: 'reason', type: 'text', description: 'User/agent visible switch reason.' },
  { name: 'metadata', type: 'json', description: 'Extra switch metadata.' },
  { name: 'switchedAt', type: 'text', description: 'Latest switch timestamp.' }
];

export const PROTAGONIST_SWITCH_HISTORY_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning app chat session id. Duplicated for readable exports.' },
  { name: 'switchId', type: 'text', description: 'Stable switch event id.' },
  { name: 'mode', type: 'text', description: 'perspective or possession.' },
  { name: 'fromActorId', type: 'text', description: 'Previous protagonist actor id.' },
  { name: 'toActorId', type: 'text', description: 'New protagonist actor id.' },
  { name: 'fromSceneId', type: 'text', description: 'Source scene id for state lookup.' },
  { name: 'toSceneId', type: 'text', description: 'Target scene id for active pointer and inherited state.' },
  { name: 'sourceStateRecordId', type: 'text', description: 'Actor state record used as the inheritance source, if any.' },
  { name: 'targetStateRecordId', type: 'text', description: 'Actor state record activated or written by this switch.' },
  { name: 'inheritFields', type: 'json', description: 'Runtime fields copied during possession switch.' },
  { name: 'reason', type: 'text', description: 'User/agent visible switch reason.' },
  { name: 'metadata', type: 'json', description: 'Extra switch metadata.' },
  { name: 'switchedAt', type: 'text', description: 'Switch timestamp.' }
];

const ACTIVE_RECORD_ID = 'active';
const DEFAULT_SCENE_ID = 'current';
const DEFAULT_INHERIT_FIELDS = [
  'values',
  'statusBar',
  'skillBar',
  'specialStatuses',
  'inventory',
  'equipment',
  'resources'
];

export class ProtagonistSwitchManager {
  constructor({
    appDatabase,
    actorState,
    activeCollection = PROTAGONIST_ACTIVE_COLLECTION,
    historyCollection = PROTAGONIST_SWITCH_HISTORY_COLLECTION,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('ProtagonistSwitchManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.actorState = actorState || new NpcStructuredStateDatabase({
      appDatabase,
      trace: trace === false ? false : trace?.actorState
    });
    this.activeCollection = activeCollection;
    this.historyCollection = historyCollection;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/protagonist-switch-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollections(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    manager.ensureCollection(this.activeCollection);
    manager.alterFields(this.activeCollection, {
      add: PROTAGONIST_ACTIVE_FIELDS,
      reason: 'protagonistSwitch:active'
    });
    manager.ensureCollection(this.historyCollection);
    manager.alterFields(this.historyCollection, {
      add: PROTAGONIST_SWITCH_HISTORY_FIELDS,
      reason: 'protagonistSwitch:history'
    });
    return {
      database,
      active: manager.describeCollection(this.activeCollection),
      history: manager.describeCollection(this.historyCollection),
      actorState: this.actorState.describe(normalizedChatSessionId)
    };
  }

  describe(chatSessionId) {
    return this.ensureCollections(chatSessionId);
  }

  getActive({ chatSessionId } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const record = manager.getRecord(this.activeCollection, ACTIVE_RECORD_ID, { missing: 'undefined' });
    return {
      chatSessionId: normalizedChatSessionId,
      active: record,
      state: record?.data?.activeActorId
        ? this.getActorStateOrUndefined({
          chatSessionId: normalizedChatSessionId,
          sceneId: record.data.sceneId,
          actorId: record.data.activeActorId
        })
        : undefined
    };
  }

  listSwitches({
    chatSessionId,
    mode,
    fromActorId,
    toActorId,
    limit = 100,
    offset = 0
  } = {}) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const { manager } = this.openManager(normalizedChatSessionId);
    const filter = {};
    if (mode) filter.mode = normalizeSwitchMode(mode);
    if (fromActorId) filter.fromActorId = normalizeActorId(fromActorId);
    if (toActorId) filter.toActorId = normalizeActorId(toActorId);
    return {
      ...manager.queryRecords(this.historyCollection, {
        filter,
        sort: [{ field: 'switchedAt', direction: 'desc' }],
        limit,
        offset
      }),
      chatSessionId: normalizedChatSessionId
    };
  }

  switchPerspective(input = {}) {
    return this.withTrace('protagonist-perspective-switch', input.chatSessionId, input, () => {
      const normalized = this.normalizeSwitchInput(input, { mode: 'perspective' });
      const previous = this.getActive({ chatSessionId: normalized.chatSessionId }).active;
      const targetState = this.getActorStateOrUndefined({
        chatSessionId: normalized.chatSessionId,
        sceneId: normalized.toSceneId,
        actorId: normalized.toActorId
      }) || (normalized.createTargetState
        ? this.actorState.patchNpcState({
          chatSessionId: normalized.chatSessionId,
          sceneId: normalized.toSceneId,
          npcId: normalized.toActorId,
          actorType: 'player',
          isPlayer: true,
          isProtagonist: true,
          playerId: normalized.toPlayerId,
          name: normalized.toName || normalized.toActorId,
          greeting: normalized.greeting
        }, { source: 'protagonist.perspective_switch' }).record
        : undefined);

      const switchRecord = this.recordSwitch({
        ...normalized,
        mode: 'perspective',
        fromActorId: normalized.fromActorId || previous?.data?.activeActorId || '',
        sourceStateRecordId: '',
        targetStateRecordId: targetState?.id || ''
      });
      const active = this.setActive({
        ...normalized,
        mode: 'perspective',
        previousActorId: switchRecord.data.fromActorId,
        switchId: switchRecord.id
      });

      return {
        mode: 'perspective',
        active,
        previous,
        targetState,
        switch: switchRecord,
        inherited: false
      };
    });
  }

  switchPossession(input = {}) {
    return this.withTrace('protagonist-possession-switch', input.chatSessionId, input, () => {
      const normalized = this.normalizeSwitchInput(input, { mode: 'possession' });
      const previous = this.getActive({ chatSessionId: normalized.chatSessionId }).active;
      const fromActorId = normalized.fromActorId || previous?.data?.activeActorId;
      if (!fromActorId) throw validationError('fromActorId is required for possession switch when no active protagonist exists');

      const sourceState = this.getActorStateOrUndefined({
        chatSessionId: normalized.chatSessionId,
        sceneId: normalized.fromSceneId,
        actorId: fromActorId
      });
      if (!sourceState && !normalized.allowMissingSource) {
        throw notFound(`Source actor state not found for possession switch: ${fromActorId}`);
      }
      const targetBefore = this.getActorStateOrUndefined({
        chatSessionId: normalized.chatSessionId,
        sceneId: normalized.toSceneId,
        actorId: normalized.toActorId
      });
      const inheritedInput = buildInheritedActorState({
        sourceState: sourceState?.data,
        targetState: targetBefore?.data,
        input: normalized,
        inheritFields: normalized.inheritFields
      });
      const targetState = this.actorState.rewriteNpcState(inheritedInput, {
        source: 'protagonist.possession_switch'
      }).record;
      const switchRecord = this.recordSwitch({
        ...normalized,
        mode: 'possession',
        fromActorId,
        sourceStateRecordId: sourceState?.id || '',
        targetStateRecordId: targetState.id
      });
      const active = this.setActive({
        ...normalized,
        mode: 'possession',
        previousActorId: fromActorId,
        switchId: switchRecord.id
      });

      return {
        mode: 'possession',
        active,
        previous,
        sourceState,
        targetBefore,
        targetState,
        switch: switchRecord,
        inherited: true,
        inheritFields: normalized.inheritFields
      };
    });
  }

  buildPromptContext({ chatSessionId } = {}) {
    const active = this.getActive({ chatSessionId });
    const record = active.active?.data || {};
    const state = active.state?.data || {};
    const prompt = [
      '[Active Protagonist]',
      record.activeActorId ? `actorId: ${record.activeActorId}` : '',
      record.activePlayerId ? `playerId: ${record.activePlayerId}` : '',
      record.sceneId ? `sceneId: ${record.sceneId}` : '',
      record.mode ? `switchMode: ${record.mode}` : '',
      state.name ? `name: ${state.name}` : '',
      state.statusBar ? `statusBar: ${JSON.stringify(state.statusBar)}` : '',
      state.resources ? `resources: ${JSON.stringify(state.resources)}` : ''
    ].filter(Boolean).join('\n');
    return {
      ...active,
      prompt: `${prompt}\n`
    };
  }

  setActive({
    chatSessionId,
    toActorId,
    toPlayerId,
    toSceneId,
    mode,
    previousActorId,
    switchId,
    reason,
    metadata
  } = {}) {
    const { manager } = this.openManager(chatSessionId);
    return manager.upsertRecord(this.activeCollection, {
      chatSessionId,
      activeActorId: toActorId,
      activePlayerId: toPlayerId || '',
      sceneId: toSceneId,
      mode,
      previousActorId: previousActorId || '',
      switchId,
      reason: reason || '',
      metadata: normalizeObject(metadata),
      switchedAt: this.now()
    }, { id: ACTIVE_RECORD_ID });
  }

  recordSwitch({
    chatSessionId,
    mode,
    fromActorId = '',
    toActorId,
    fromSceneId,
    toSceneId,
    sourceStateRecordId = '',
    targetStateRecordId = '',
    inheritFields = [],
    reason = '',
    metadata = {}
  } = {}) {
    const { manager } = this.openManager(chatSessionId);
    const timestamp = this.now();
    const switchId = `switch_${safeSegment(mode)}_${safeSegment(toSceneId)}_${safeSegment(toActorId)}_${safeSegment(timestamp)}`.slice(0, 128);
    return manager.upsertRecord(this.historyCollection, {
      chatSessionId,
      switchId,
      mode,
      fromActorId,
      toActorId,
      fromSceneId,
      toSceneId,
      sourceStateRecordId,
      targetStateRecordId,
      inheritFields,
      reason,
      metadata: normalizeObject(metadata),
      switchedAt: timestamp
    }, { id: switchId });
  }

  normalizeSwitchInput(input = {}, { mode } = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId, 'chatSessionId');
    const toActorId = normalizeActorId(input.toActorId || input.targetActorId || input.toNpcId || input.targetNpcId || input.npcId || input.playerId);
    const toSceneId = normalizeSceneId(input.toSceneId || input.sceneId);
    return {
      chatSessionId,
      mode: normalizeSwitchMode(input.mode || mode),
      fromActorId: input.fromActorId || input.sourceActorId || input.fromNpcId || input.sourceNpcId
        ? normalizeActorId(input.fromActorId || input.sourceActorId || input.fromNpcId || input.sourceNpcId)
        : '',
      toActorId,
      fromSceneId: normalizeSceneId(input.fromSceneId || input.sceneId || toSceneId),
      toSceneId,
      toPlayerId: normalizeOptionalText(input.toPlayerId || input.targetPlayerId || input.playerId),
      toName: normalizeOptionalText(input.toName || input.targetName || input.name),
      greeting: normalizeOptionalText(input.greeting || input.initialGreeting || input.initialSituation || input.openingSituation),
      inheritFields: normalizeInheritFields(input.inheritFields),
      allowMissingSource: input.allowMissingSource === true,
      createTargetState: input.createTargetState === true,
      reason: normalizeOptionalText(input.reason),
      metadata: normalizeObject(input.metadata)
    };
  }

  getActorStateOrUndefined({ chatSessionId, sceneId, actorId } = {}) {
    try {
      return this.actorState.getNpcState({
        chatSessionId,
        sceneId,
        npcId: actorId
      });
    } catch {
      // Imported initial settings may use custom record ids instead of the
      // manager's generated npcstate_<scene>_<actor> id.
    }
    try {
      return this.actorState.listNpcStates({
        chatSessionId,
        sceneId,
        npcId: actorId,
        limit: 1
      }).records?.[0];
    } catch {
      return undefined;
    }
  }

  snapshot(chatSessionId) {
    return {
      ...this.getActive({ chatSessionId }),
      switches: this.listSwitches({ chatSessionId, limit: 500 }).records
    };
  }

  withTrace(operation, chatSessionId, input, fn) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const before = this.snapshot(normalizedChatSessionId);
    const trace = this.traceRecorder.start(operation, {
      sessionId: normalizedChatSessionId,
      input,
      stateBefore: before
    });
    try {
      const output = fn();
      const after = this.snapshot(normalizedChatSessionId);
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, {
          output,
          stateAfter: after,
          prompt: this.buildPromptContext({ chatSessionId: normalizedChatSessionId }).prompt
        })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  openManager(chatSessionId) {
    this.ensureCollections(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

function buildInheritedActorState({ sourceState = {}, targetState = {}, input = {}, inheritFields = DEFAULT_INHERIT_FIELDS } = {}) {
  const inherited = {};
  for (const field of inheritFields) {
    inherited[field] = deepClone(sourceState[field] ?? defaultRuntimeField(field));
  }
  return {
    ...inherited,
    chatSessionId: input.chatSessionId,
    sceneId: input.toSceneId,
    npcId: input.toActorId,
    actorType: 'player',
    isPlayer: true,
    isProtagonist: true,
    playerId: input.toPlayerId || targetState.playerId || '',
    name: input.toName || targetState.name || input.toActorId,
    greeting: input.greeting || targetState.greeting || '',
    source: 'protagonist.possession_switch'
  };
}

function defaultRuntimeField(field) {
  if (field === 'specialStatuses') return [];
  if (field === 'inventory') return { currency: {}, items: [] };
  return {};
}

function normalizeInheritFields(value) {
  const requested = normalizeStringArray(value);
  if (requested.length === 0) return [...DEFAULT_INHERIT_FIELDS];
  const allowed = new Set(DEFAULT_INHERIT_FIELDS);
  return requested.filter((field) => allowed.has(field));
}

function normalizeSwitchMode(value) {
  const normalized = String(value || 'perspective').trim().toLowerCase();
  if (['view', '视角', 'perspective'].includes(normalized)) return 'perspective';
  if (['possession', 'possess', '夺舍'].includes(normalized)) return 'possession';
  if (['manual', 'import'].includes(normalized)) return normalized;
  throw validationError(`Unsupported protagonist switch mode: ${value}`);
}

function normalizeActorId(value) {
  return normalizeRequiredText(value, 'actorId');
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

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    || 'id';
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ProtagonistSwitchValidationError';
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.name = 'ProtagonistSwitchNotFoundError';
  error.statusCode = 404;
  return error;
}
