// @ts-nocheck
import { NpcStructuredStateDatabase } from '../npcs/npc-structured-state.js';
import { NPC_REGISTRY_COLLECTION } from '../npcs/npc-registry.js';
import { PROTAGONIST_ACTIVE_COLLECTION } from './protagonist-switch-manager.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';

export const ACTOR_CONTROL_CONTEXT_COLLECTION = 'actor_control_context';
export const ACTOR_CONTROL_HISTORY_COLLECTION = 'actor_control_history';

export const ACTOR_CONTROL_CONTEXT_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'sceneId', type: 'text', description: 'Scene id where this control context is active.' },
  { name: 'controlledActorId', type: 'text', description: 'Actor currently controlled by the user/player.' },
  { name: 'controlledActorTitle', type: 'text', description: 'Display title/name used to tag player chat input.' },
  { name: 'controlledPlayerId', type: 'text', description: 'Optional player/protagonist id.' },
  { name: 'viewpointActorId', type: 'text', description: 'Actor whose senses/camera the narrative uses.' },
  { name: 'viewpointActorTitle', type: 'text', description: 'Display title/name for the current viewpoint actor.' },
  { name: 'embodiedActorId', type: 'text', description: 'Actor body currently inhabited by the player.' },
  { name: 'embodiedActorTitle', type: 'text', description: 'Display title/name for the current embodied actor.' },
  { name: 'speakerRole', type: 'text', description: 'Input speaker role, usually player.' },
  { name: 'inputAuthority', type: 'text', description: 'actor_claim, canonical_user_edit, tool_result, resolver_result, import, or system.' },
  { name: 'worldEditMode', type: 'boolean', description: 'Whether ordinary input is allowed to assert canonical world facts.' },
  { name: 'canAssertWorldFacts', type: 'boolean', description: 'Whether this input channel can directly create world facts.' },
  { name: 'canAssertNpcDecisions', type: 'boolean', description: 'Whether this input channel can directly decide NPC choices.' },
  { name: 'aiRole', type: 'text', description: 'AI role for this turn, usually gm.' },
  { name: 'userRole', type: 'text', description: 'User role for this turn, usually player_controller.' },
  { name: 'aiAllowedSpeakers', type: 'json', description: 'Actor ids or role labels the AI may speak/control this turn.' },
  { name: 'aiForbiddenControl', type: 'json', description: 'Actor ids the AI must not directly control.' },
  { name: 'factWriteChannels', type: 'json', description: 'Channels that may create canonical facts.' },
  { name: 'requiresInitialization', type: 'boolean', description: 'True when no persistent player actor has been selected yet.' },
  { name: 'source', type: 'text', description: 'stored, request, protagonist, player_state, fallback_unbound, manual, frontend, import, etc.' },
  { name: 'metadata', type: 'json', description: 'Extra non-prompt metadata.' },
  { name: 'controlUpdatedAt', type: 'text', description: 'Latest context update timestamp.' }
];

export const ACTOR_CONTROL_HISTORY_FIELDS = [
  { name: 'chatSessionId', type: 'text', description: 'Owning chat session id. Duplicated for readable exports.' },
  { name: 'contextId', type: 'text', description: 'Stable history event id.' },
  { name: 'operation', type: 'text', description: 'set_context, clear_context, import, frontend_select, etc.' },
  { name: 'previousContext', type: 'json', description: 'Previous actor control context.' },
  { name: 'nextContext', type: 'json', description: 'New actor control context.' },
  { name: 'reason', type: 'text', description: 'Human-readable reason.' },
  { name: 'metadata', type: 'json', description: 'Extra operation metadata.' },
  { name: 'eventAt', type: 'text', description: 'History event timestamp.' }
];

const ACTIVE_RECORD_ID = 'active';
const DEFAULT_SCENE_ID = 'current';
const DEFAULT_FACT_WRITE_CHANNELS = [
  'database_editor',
  'import_document',
  'authorized_tool_call',
  'resolver_result',
  'worldline_restore'
];

export class ActorControlContextManager {
  constructor({
    appDatabase,
    dataManager,
    actorState,
    contextCollection = ACTOR_CONTROL_CONTEXT_COLLECTION,
    historyCollection = ACTOR_CONTROL_HISTORY_COLLECTION,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now
  } = {}) {
    if (!appDatabase) throw validationError('ActorControlContextManager requires appDatabase');
    this.appDatabase = appDatabase;
    this.dataManager = dataManager;
    this.actorState = actorState || new NpcStructuredStateDatabase({
      appDatabase,
      trace: trace === false ? false : trace?.actorState
    });
    this.contextCollection = contextCollection;
    this.historyCollection = historyCollection;
    this.now = now || (() => new Date().toISOString());
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/actor-control-traces',
      cwd,
      now: this.now
    });
  }

  ensureCollections(chatSessionId) {
    const normalizedChatSessionId = normalizeRequiredText(chatSessionId, 'chatSessionId');
    const database = this.appDatabase.ensureChatDataDatabase(normalizedChatSessionId);
    const manager = this.appDatabase.openChatDataManagerByChatId(normalizedChatSessionId);
    manager.ensureCollection(this.contextCollection);
    manager.alterFields(this.contextCollection, {
      add: ACTOR_CONTROL_CONTEXT_FIELDS,
      reason: 'actorControl:context'
    });
    manager.ensureCollection(this.historyCollection);
    manager.alterFields(this.historyCollection, {
      add: ACTOR_CONTROL_HISTORY_FIELDS,
      reason: 'actorControl:history'
    });
    return {
      database,
      context: manager.describeCollection(this.contextCollection),
      history: manager.describeCollection(this.historyCollection)
    };
  }

  describe(chatSessionId) {
    return {
      noLlm: true,
      policy: 'Actor Control Context binds user input to a controlled player actor. Ordinary chat is actor_claim, not canonical world fact.',
      collections: this.ensureCollections(chatSessionId),
      inputAuthorities: ['actor_claim', 'canonical_user_edit', 'resolver_result', 'tool_result', 'import', 'system'],
      factWriteChannels: [...DEFAULT_FACT_WRITE_CHANNELS]
    };
  }

  getContext(input = {}) {
    const normalized = normalizeContextInput(input);
    const stored = this.getStoredRecord(normalized.chatSessionId);
    const context = this.resolveContext(normalized, stored?.data);
    return this.buildOutput({ input: normalized, context, storedRecord: stored });
  }

  setContext(input = {}) {
    const normalized = normalizeContextInput(input, { requireControlledActor: true });
    const before = this.getContext({
      chatSessionId: normalized.chatSessionId,
      sceneId: normalized.sceneId,
      text: normalized.text
    }).context;
    const trace = this.traceRecorder.start('actor-control-set-context', {
      sessionId: normalized.chatSessionId,
      input: normalized,
      stateBefore: before
    });
    try {
      const context = this.resolveContext({
        ...normalized,
        source: normalized.source || 'manual'
      }, undefined, { persist: true });
      const { manager } = this.openManager(normalized.chatSessionId);
      const record = manager.upsertRecord(this.contextCollection, context, { id: ACTIVE_RECORD_ID });
      const history = this.recordHistory({
        chatSessionId: normalized.chatSessionId,
        operation: normalized.operation || 'set_context',
        previousContext: before,
        nextContext: record.data,
        reason: normalized.reason,
        metadata: normalized.metadata
      });
      const output = this.buildOutput({ input: normalized, context: record.data, storedRecord: record, history });
      output.trace = this.traceRecorder.finish(trace, {
        output,
        stateAfter: output.context,
        prompt: output.promptContext
      });
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  clearContext(input = {}) {
    const chatSessionId = normalizeRequiredText(input.chatSessionId || input.chatId || input.sessionId, 'chatSessionId');
    const before = this.getContext({ chatSessionId, sceneId: input.sceneId }).context;
    const trace = this.traceRecorder.start('actor-control-clear-context', {
      sessionId: chatSessionId,
      input,
      stateBefore: before
    });
    try {
      const { manager } = this.openManager(chatSessionId);
      const existing = manager.getRecord(this.contextCollection, ACTIVE_RECORD_ID, { missing: 'undefined' });
      const deleted = existing ? manager.deleteRecord(this.contextCollection, ACTIVE_RECORD_ID) : { deleted: false };
      const history = this.recordHistory({
        chatSessionId,
        operation: 'clear_context',
        previousContext: before,
        nextContext: undefined,
        reason: input.reason || '',
        metadata: normalizeObject(input.metadata)
      });
      const output = {
        chatSessionId,
        deleted,
        history,
        context: this.getContext({ chatSessionId, sceneId: input.sceneId }).context
      };
      output.trace = this.traceRecorder.finish(trace, {
        output,
        stateAfter: output.context
      });
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  buildPromptContext(input = {}) {
    return this.getContext(input);
  }

  wrapInput(input = {}) {
    const normalized = normalizeContextInput(input);
    const context = input.context && typeof input.context === 'object'
      ? normalizeResolvedContext({
        ...input.context,
        chatSessionId: normalized.chatSessionId,
        sceneId: normalized.sceneId
      }, {
        now: this.now,
        fallbackTitle: '玩家角色'
      })
      : this.getContext(normalized).context;
    return {
      chatSessionId: normalized.chatSessionId,
      sceneId: normalized.sceneId,
      context,
      inputEnvelope: buildInputEnvelope({
        text: normalized.text,
        context
      })
    };
  }

  resolveContext(input, stored, { persist = false } = {}) {
    const candidate = {
      ...this.contextFromProtagonist(input),
      ...this.contextFromPlayerState(input),
      ...stored,
      ...input.actorControl,
      ...directContextFields(input)
    };
    const explicitActorId = normalizeOptionalText(candidate.controlledActorId);
    const controlledActorTitle = this.resolveActorTitle({
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId,
      actorId: explicitActorId,
      explicitTitle: candidate.controlledActorTitle || candidate.actorTitle || candidate.title || candidate.name
    });
    const viewpointActorId = normalizeOptionalText(candidate.viewpointActorId) || explicitActorId;
    const embodiedActorId = normalizeOptionalText(candidate.embodiedActorId) || explicitActorId;
    const worldEditMode = normalizeBoolean(candidate.worldEditMode ?? candidate.editMode ?? false);
    const inputAuthority = normalizeInputAuthority(candidate.inputAuthority || (worldEditMode ? 'canonical_user_edit' : 'actor_claim'));
    const canAssertWorldFacts = inputAuthority === 'canonical_user_edit' || worldEditMode || normalizeBoolean(candidate.canAssertWorldFacts);
    const canAssertNpcDecisions = inputAuthority === 'canonical_user_edit' || worldEditMode || normalizeBoolean(candidate.canAssertNpcDecisions);
    const requiresInitialization = !explicitActorId;
    return normalizeResolvedContext({
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId,
      controlledActorId: explicitActorId,
      controlledActorTitle,
      controlledPlayerId: normalizeOptionalText(candidate.controlledPlayerId || candidate.playerId || candidate.activePlayerId),
      viewpointActorId,
      viewpointActorTitle: this.resolveActorTitle({
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId,
        actorId: viewpointActorId,
        explicitTitle: candidate.viewpointActorTitle || (viewpointActorId === explicitActorId ? controlledActorTitle : '')
      }),
      embodiedActorId,
      embodiedActorTitle: this.resolveActorTitle({
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId,
        actorId: embodiedActorId,
        explicitTitle: candidate.embodiedActorTitle || (embodiedActorId === explicitActorId ? controlledActorTitle : '')
      }),
      speakerRole: normalizeOptionalText(candidate.speakerRole) || 'player',
      inputAuthority,
      worldEditMode,
      canAssertWorldFacts,
      canAssertNpcDecisions,
      aiRole: normalizeOptionalText(candidate.aiRole) || 'gm',
      userRole: normalizeOptionalText(candidate.userRole) || 'player_controller',
      aiAllowedSpeakers: normalizeStringArray(candidate.aiAllowedSpeakers).length > 0
        ? normalizeStringArray(candidate.aiAllowedSpeakers)
        : ['gm', 'narrator', 'npc'],
      aiForbiddenControl: normalizeStringArray(candidate.aiForbiddenControl).length > 0
        ? normalizeStringArray(candidate.aiForbiddenControl)
        : (explicitActorId ? [explicitActorId] : []),
      factWriteChannels: normalizeStringArray(candidate.factWriteChannels).length > 0
        ? normalizeStringArray(candidate.factWriteChannels)
        : [...DEFAULT_FACT_WRITE_CHANNELS],
      requiresInitialization,
      source: normalizeOptionalText(candidate.source) || inferContextSource({ stored, candidate, persist, requiresInitialization }),
      metadata: normalizeObject(candidate.metadata),
      controlUpdatedAt: this.now()
    }, {
      now: this.now,
      fallbackTitle: '玩家角色'
    });
  }

  buildOutput({ input, context, storedRecord, history } = {}) {
    const inputEnvelope = buildInputEnvelope({
      text: input.text,
      context
    });
    const promptContext = renderActorControlPrompt(context, inputEnvelope);
    return removeUndefined({
      noLlm: true,
      chatSessionId: context.chatSessionId,
      sceneId: context.sceneId,
      context,
      storedRecord,
      history,
      inputEnvelope,
      promptContext,
      warnings: context.requiresInitialization
        ? ['No controlled player actor is bound. Frontend should require selecting or creating a player actor before normal play.']
        : [],
      policy: {
        ordinaryChatAuthority: 'actor_claim',
        canonicalFactSources: context.factWriteChannels,
        aiForbiddenControl: context.aiForbiddenControl
      }
    });
  }

  contextFromProtagonist({ chatSessionId, sceneId } = {}) {
    try {
      const manager = this.appDatabase.openChatDataManagerByChatId(chatSessionId);
      const record = manager.getRecord(PROTAGONIST_ACTIVE_COLLECTION, ACTIVE_RECORD_ID, { missing: 'undefined' });
      if (!record?.data?.activeActorId) return {};
      return {
        controlledActorId: record.data.activeActorId,
        controlledPlayerId: record.data.activePlayerId,
        viewpointActorId: record.data.activeActorId,
        embodiedActorId: record.data.activeActorId,
        sceneId: record.data.sceneId || sceneId,
        source: 'protagonist'
      };
    } catch {
      return {};
    }
  }

  contextFromPlayerState({ chatSessionId } = {}) {
    try {
      const listed = this.actorState.listNpcStates({
        chatSessionId,
        isPlayer: true,
        limit: 50
      });
      const records = Array.isArray(listed.records) ? listed.records : [];
      const protagonists = records.filter((record) => record?.data?.isProtagonist === true);
      if (protagonists.length > 1) return {};
      const record = protagonists.length === 1 ? protagonists[0] : (records.length === 1 ? records[0] : undefined);
      if (!record) return {};
      if (!record?.data?.npcId) return {};
      return {
        controlledActorId: record.data.npcId,
        controlledActorTitle: record.data.name || record.data.npcId,
        controlledPlayerId: record.data.playerId,
        viewpointActorId: record.data.npcId,
        viewpointActorTitle: record.data.name || record.data.npcId,
        embodiedActorId: record.data.npcId,
        embodiedActorTitle: record.data.name || record.data.npcId,
        source: 'player_state'
      };
    } catch {
      return {};
    }
  }

  resolveActorTitle({ chatSessionId, sceneId, actorId, explicitTitle } = {}) {
    const explicit = normalizeOptionalText(explicitTitle);
    if (explicit) return explicit;
    const id = normalizeOptionalText(actorId);
    if (!id) return '玩家角色';
    try {
      const state = this.actorState.getNpcState({
        chatSessionId,
        sceneId,
        npcId: id
      });
      if (state?.data?.name) return state.data.name;
    } catch {
      // fall through
    }
    try {
      const state = this.actorState.listNpcStates({
        chatSessionId,
        npcId: id,
        limit: 1
      }).records?.[0];
      if (state?.data?.name) return state.data.name;
    } catch {
      // fall through
    }
    try {
      const registry = this.dataManager?.getRecord?.(NPC_REGISTRY_COLLECTION, id, { missing: 'undefined' });
      if (registry?.data?.name) return registry.data.name;
    } catch {
      // fall through
    }
    return id;
  }

  recordHistory({
    chatSessionId,
    operation,
    previousContext,
    nextContext,
    reason = '',
    metadata = {}
  } = {}) {
    const { manager } = this.openManager(chatSessionId);
    const timestamp = this.now();
    const contextId = `actorctl_${safeSegment(operation)}_${safeSegment(timestamp)}`.slice(0, 128);
    return manager.upsertRecord(this.historyCollection, {
      chatSessionId,
      contextId,
      operation,
      previousContext,
      nextContext,
      reason,
      metadata: normalizeObject(metadata),
      eventAt: timestamp
    }, { id: contextId });
  }

  getStoredRecord(chatSessionId) {
    const { manager } = this.openManager(chatSessionId);
    return manager.getRecord(this.contextCollection, ACTIVE_RECORD_ID, { missing: 'undefined' });
  }

  openManager(chatSessionId) {
    this.ensureCollections(chatSessionId);
    return {
      manager: this.appDatabase.openChatDataManagerByChatId(chatSessionId)
    };
  }
}

function buildInputEnvelope({ text = '', context = {} } = {}) {
  const rawText = normalizeOptionalText(text);
  const actorTitle = context.controlledActorTitle || '玩家角色';
  const actorLabel = context.controlledActorId
    ? `${actorTitle}/${context.controlledActorId}`
    : actorTitle;
  const authority = context.inputAuthority || 'actor_claim';
  const actorTaggedText = `[玩家角色：${actorLabel} | authority=${authority}] ${rawText}`;
  const potentialAssertions = detectPotentialFactAssertions(rawText);
  return {
    rawText,
    actorTaggedText,
    speakerRole: context.speakerRole || 'player',
    actorId: context.controlledActorId || '',
    actorTitle,
    authority,
    factAuthority: {
      inputIsCanonicalWorldFact: Boolean(context.canAssertWorldFacts),
      canAssertWorldFacts: Boolean(context.canAssertWorldFacts),
      canAssertNpcDecisions: Boolean(context.canAssertNpcDecisions),
      ordinaryActorClaim: authority === 'actor_claim',
      canonicalFactSources: context.factWriteChannels || DEFAULT_FACT_WRITE_CHANNELS
    },
    potentialAssertions,
    handling: potentialAssertions.length > 0 && !context.canAssertWorldFacts
      ? 'Treat possible outcome/world assertions as player-character claims or attempts until a resolver/tool/user override confirms them.'
      : 'No extra assertion handling required.'
  };
}

function renderActorControlPrompt(context = {}, envelope = {}) {
  return [
    '<AI_DND_ACTOR_CONTROL_CONTEXT>',
    `controlledActorId: ${context.controlledActorId || '(unbound)'}`,
    `controlledActorTitle: ${context.controlledActorTitle || '玩家角色'}`,
    `viewpointActorId: ${context.viewpointActorId || context.controlledActorId || '(unbound)'}`,
    `embodiedActorId: ${context.embodiedActorId || context.controlledActorId || '(unbound)'}`,
    `inputAuthority: ${context.inputAuthority || 'actor_claim'}`,
    `worldEditMode: ${Boolean(context.worldEditMode)}`,
    `canAssertWorldFacts: ${Boolean(context.canAssertWorldFacts)}`,
    `canAssertNpcDecisions: ${Boolean(context.canAssertNpcDecisions)}`,
    `aiRole: ${context.aiRole || 'gm'}`,
    `aiForbiddenControl: ${JSON.stringify(context.aiForbiddenControl || [])}`,
    `factWriteChannels: ${JSON.stringify(context.factWriteChannels || DEFAULT_FACT_WRITE_CHANNELS)}`,
    context.requiresInitialization ? 'warning: controlled player actor is not initialized; frontend should bind one before normal play.' : '',
    '',
    'Rules:',
    '- Ordinary chat input is an actor_claim from the controlled player actor, not a canonical world fact.',
    '- If the player text asserts NPC decisions or world outcomes, treat those as claims/attempts until resolver/tool/user override confirms them.',
    '- Do not decide major actions, inner thoughts, or dialogue for the controlled player actor unless explicit user authorization exists.',
    '- Canonical facts come from database editor/import, authorized tools, resolver results, or worldline restore.',
    '',
    'Tagged current input:',
    envelope.actorTaggedText || '',
    '</AI_DND_ACTOR_CONTROL_CONTEXT>'
  ].filter((line) => line !== '').join('\n');
}

function detectPotentialFactAssertions(text) {
  const normalized = normalizeOptionalText(text);
  if (!normalized) return [];
  const rules = [
    {
      type: 'npc_decision_assertion',
      pattern: /(他|她|它|他们|她们|npc|NPC|奈亚|国王|守卫|老板娘).{0,20}(同意|答应|拒绝|爱上|背叛|投降|加入|离开|自杀|死亡|死了|给我|让给我)/u
    },
    {
      type: 'world_outcome_assertion',
      pattern: /(已经|立刻|直接|成功|完成).{0,20}(胜利|通关|完成任务|获得|拿到|晋升|成为|杀死|打败|摧毁)/u
    },
    {
      type: 'self_result_assertion',
      pattern: /我.{0,20}(获得|拿到|成为|晋升|杀死|打败|完成|拥有).{0,20}(神器|奖励|王位|神格|任务|战斗|敌人)/u
    }
  ];
  return rules
    .filter((rule) => rule.pattern.test(normalized))
    .map((rule) => ({
      type: rule.type,
      authority: 'requires_resolver_or_user_override',
      text: normalized.slice(0, 240)
    }));
}

function normalizeContextInput(input = {}, { requireControlledActor = false } = {}) {
  const actorControl = input.actorControl && typeof input.actorControl === 'object' && !Array.isArray(input.actorControl)
    ? input.actorControl
    : {};
  const chatSessionId = normalizeRequiredText(input.chatSessionId || input.chatId || input.sessionId || actorControl.chatSessionId, 'chatSessionId');
  const controlledActorId = normalizeOptionalText(
    input.controlledActorId
      || input.playerActorId
      || input.protagonistActorId
      || actorControl.controlledActorId
      || actorControl.playerActorId
      || actorControl.protagonistActorId
  );
  if (requireControlledActor && !controlledActorId) throw validationError('controlledActorId is required');
  return {
    ...input,
    actorControl,
    chatSessionId,
    sceneId: normalizeOptionalText(input.sceneId || input.currentSceneId || actorControl.sceneId) || DEFAULT_SCENE_ID,
    text: normalizeOptionalText(input.text || input.currentInput || input.userInput || input.query || actorControl.text),
    controlledActorId,
    controlledActorTitle: normalizeOptionalText(
      input.controlledActorTitle
        || input.playerActorTitle
        || input.actorTitle
        || input.title
        || input.name
        || actorControl.controlledActorTitle
        || actorControl.playerActorTitle
        || actorControl.actorTitle
    ),
    controlledPlayerId: normalizeOptionalText(input.controlledPlayerId || input.playerId || actorControl.controlledPlayerId || actorControl.playerId),
    viewpointActorId: normalizeOptionalText(input.viewpointActorId || actorControl.viewpointActorId),
    viewpointActorTitle: normalizeOptionalText(input.viewpointActorTitle || actorControl.viewpointActorTitle),
    embodiedActorId: normalizeOptionalText(input.embodiedActorId || actorControl.embodiedActorId),
    embodiedActorTitle: normalizeOptionalText(input.embodiedActorTitle || actorControl.embodiedActorTitle),
    inputAuthority: normalizeInputAuthority(input.inputAuthority || actorControl.inputAuthority),
    source: normalizeOptionalText(input.source || actorControl.source),
    operation: normalizeOptionalText(input.operation || actorControl.operation),
    reason: normalizeOptionalText(input.reason || actorControl.reason),
    metadata: normalizeObject(input.metadata || actorControl.metadata)
  };
}

function directContextFields(input = {}) {
  return removeEmptyFields({
    controlledActorId: input.controlledActorId,
    controlledActorTitle: input.controlledActorTitle,
    controlledPlayerId: input.controlledPlayerId,
    viewpointActorId: input.viewpointActorId,
    viewpointActorTitle: input.viewpointActorTitle,
    embodiedActorId: input.embodiedActorId,
    embodiedActorTitle: input.embodiedActorTitle,
    inputAuthority: input.inputAuthority,
    worldEditMode: input.worldEditMode,
    canAssertWorldFacts: input.canAssertWorldFacts,
    canAssertNpcDecisions: input.canAssertNpcDecisions,
    aiRole: input.aiRole,
    userRole: input.userRole,
    speakerRole: input.speakerRole,
    aiAllowedSpeakers: input.aiAllowedSpeakers,
    aiForbiddenControl: input.aiForbiddenControl,
    factWriteChannels: input.factWriteChannels,
    source: input.source,
    metadata: input.metadata
  });
}

function normalizeResolvedContext(context = {}, { now = () => new Date().toISOString(), fallbackTitle = '玩家角色' } = {}) {
  const controlledActorId = normalizeOptionalText(context.controlledActorId);
  const title = normalizeOptionalText(context.controlledActorTitle) || controlledActorId || fallbackTitle;
  return {
    chatSessionId: normalizeRequiredText(context.chatSessionId, 'chatSessionId'),
    sceneId: normalizeOptionalText(context.sceneId) || DEFAULT_SCENE_ID,
    controlledActorId,
    controlledActorTitle: title,
    controlledPlayerId: normalizeOptionalText(context.controlledPlayerId),
    viewpointActorId: normalizeOptionalText(context.viewpointActorId) || controlledActorId,
    viewpointActorTitle: normalizeOptionalText(context.viewpointActorTitle) || title,
    embodiedActorId: normalizeOptionalText(context.embodiedActorId) || controlledActorId,
    embodiedActorTitle: normalizeOptionalText(context.embodiedActorTitle) || title,
    speakerRole: normalizeOptionalText(context.speakerRole) || 'player',
    inputAuthority: normalizeInputAuthority(context.inputAuthority || 'actor_claim'),
    worldEditMode: normalizeBoolean(context.worldEditMode),
    canAssertWorldFacts: normalizeBoolean(context.canAssertWorldFacts),
    canAssertNpcDecisions: normalizeBoolean(context.canAssertNpcDecisions),
    aiRole: normalizeOptionalText(context.aiRole) || 'gm',
    userRole: normalizeOptionalText(context.userRole) || 'player_controller',
    aiAllowedSpeakers: normalizeStringArray(context.aiAllowedSpeakers).length > 0 ? normalizeStringArray(context.aiAllowedSpeakers) : ['gm', 'narrator', 'npc'],
    aiForbiddenControl: normalizeStringArray(context.aiForbiddenControl),
    factWriteChannels: normalizeStringArray(context.factWriteChannels).length > 0 ? normalizeStringArray(context.factWriteChannels) : [...DEFAULT_FACT_WRITE_CHANNELS],
    requiresInitialization: normalizeBoolean(context.requiresInitialization),
    source: normalizeOptionalText(context.source) || 'fallback_unbound',
    metadata: normalizeObject(context.metadata),
    controlUpdatedAt: normalizeOptionalText(context.controlUpdatedAt || context.updatedAt) || now()
  };
}

function inferContextSource({ stored, candidate, persist, requiresInitialization }) {
  if (persist) return 'manual';
  if (stored) return 'stored';
  if (candidate?.source) return candidate.source;
  if (requiresInitialization) return 'fallback_unbound';
  return 'request';
}

function normalizeInputAuthority(value) {
  const normalized = normalizeOptionalText(value).toLowerCase();
  if (['canonical', 'canonical_user_edit', 'user_edit', 'gm_override', 'override', 'database_edit'].includes(normalized)) return 'canonical_user_edit';
  if (['resolver', 'resolver_result', 'adjudication'].includes(normalized)) return 'resolver_result';
  if (['tool', 'tool_result'].includes(normalized)) return 'tool_result';
  if (['import', 'document_import'].includes(normalized)) return 'import';
  if (['system'].includes(normalized)) return 'system';
  return 'actor_claim';
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeOptionalText(value).toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeStringArray(item));
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function safeSegment(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/^[^A-Za-z]+/, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    || 'id';
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function removeEmptyFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => {
    if (entry === undefined || entry === null) return false;
    if (typeof entry === 'string' && entry.trim() === '') return false;
    if (Array.isArray(entry) && entry.length === 0) return false;
    return true;
  }));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ActorControlContextValidationError';
  error.statusCode = 400;
  return error;
}
