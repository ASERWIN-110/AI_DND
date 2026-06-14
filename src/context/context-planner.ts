// @ts-nocheck
import { serializeDialogue } from '../core/messages.js';
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { countTokens } from '../tokens/token-counter.js';
import { createId, nowIso } from '../utils/id.js';

export const CONTEXT_PLANNER_TRACE_DIR = 'data/context-planner-traces';

export const CONTEXT_PLANNER_SOURCES = [
  {
    id: 'turn.focus',
    title: 'Current Turn Focus',
    order: 5,
    priority: 120,
    required: true,
    maxTokens: 700
  },
  {
    id: 'scene.npcs',
    title: 'Current Scene NPCs',
    order: 10,
    priority: 100,
    required: true,
    maxTokens: 700
  },
  {
    id: 'current.map',
    title: 'Current Map',
    order: 20,
    priority: 95,
    required: true,
    maxTokens: 700
  },
  {
    id: 'current.quests',
    title: 'Current Quests',
    order: 30,
    priority: 90,
    required: false,
    maxTokens: 700
  },
  {
    id: 'character.memory',
    title: 'Relevant Character Memory',
    order: 40,
    priority: 82,
    required: false,
    maxTokens: 900
  },
  {
    id: 'permanent.rag',
    title: 'Permanent RAG',
    order: 50,
    priority: 72,
    required: false,
    maxTokens: 900
  },
  {
    id: 'runtime.rag',
    title: 'Runtime RAG',
    order: 60,
    priority: 68,
    required: false,
    maxTokens: 700
  },
  {
    id: 'recent.messages',
    title: 'Recent Messages',
    order: 70,
    priority: 86,
    required: true,
    maxTokens: 1200
  },
  {
    id: 'chat.compression',
    title: 'Compressed Summary',
    order: 80,
    priority: 78,
    required: false,
    maxTokens: 900
  }
];

const DEFAULT_MAX_CONTEXT_TOKENS = 6000;
const DEFAULT_RECENT_MESSAGE_COUNT = 12;
const MIN_TRIMMED_SECTION_TOKENS = 60;

export class ContextPlanner {
  constructor({
    toolManager,
    appDatabase,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    if (!toolManager) throw new TypeError('ContextPlanner requires toolManager');
    this.toolManager = toolManager;
    this.appDatabase = appDatabase;
    this.now = now;
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || CONTEXT_PLANNER_TRACE_DIR,
      cwd,
      now
    });
  }

  describe() {
    return {
      noLlm: true,
      purpose: 'Plan which existing context sources should be inserted into the next prompt under a token budget.',
      sources: CONTEXT_PLANNER_SOURCES.map((source) => ({ ...source })),
      defaults: {
        maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
        recentMessageCount: DEFAULT_RECENT_MESSAGE_COUNT,
        includeSceneNpcs: true,
        includeNpcProfiles: true,
        includeNpcStates: true,
        includeCurrentMap: true,
        includeMapState: true,
        includeQuests: true,
        includeCharacterMemory: true,
        includePermanentRag: true,
        includeRuntimeRag: true,
        includeRecentMessages: true,
        includeTurnFocus: true,
        includeCompression: true
      },
      traceDirectory: CONTEXT_PLANNER_TRACE_DIR
    };
  }

  async planContext(input = {}) {
    const request = normalizeRequest(input);
    const trace = this.traceRecorder.start('plan-context', {
      sessionId: request.chatSessionId,
      input: request,
      stateBefore: this.buildTraceStateBefore(request)
    });

    try {
      const collected = [];
      const errors = [];
      const collectedCounts = {};
      const collectorContext = { request, errors, collectedCounts };

      if (request.includeTurnFocus) {
        collected.push(await this.collectTurnFocus(collectorContext));
      }
      if (request.includeSceneNpcs) {
        collected.push(await this.collectSceneNpcs(collectorContext));
      }
      if (request.includeCurrentMap) {
        collected.push(await this.collectCurrentMap(collectorContext));
      }
      if (request.includeQuests) {
        collected.push(await this.collectCurrentQuests(collectorContext));
      }
      if (request.includeCharacterMemory) {
        collected.push(await this.collectCharacterMemory(collectorContext));
      }
      if (request.includePermanentRag) {
        collected.push(await this.collectPermanentRag(collectorContext));
      }
      if (request.includeRuntimeRag) {
        collected.push(await this.collectRuntimeRag(collectorContext));
      }
      if (request.includeRecentMessages) {
        collected.push(await this.collectRecentMessages(collectorContext));
      }
      if (request.includeCompression) {
        collected.push(await this.collectCompression(collectorContext));
      }

      const candidates = collected
        .filter(Boolean)
        .map((candidate) => this.applySourceOverrides(candidate, request));
      const budgeted = budgetSections(candidates, request.maxContextTokens);
      const selectedSections = budgeted.selected
        .sort((a, b) => a.order - b.order)
        .map(publicSection);
      const omittedSections = budgeted.omitted
        .sort((a, b) => a.order - b.order)
        .map(publicOmittedSection);
      const promptContext = renderPromptContext({
        planId: request.planId,
        sections: budgeted.selected.sort((a, b) => a.order - b.order)
      });
      const turnFocus = candidates.find((section) => section.id === 'turn.focus')?.raw || request.turnFocus;
      const output = {
        planId: request.planId,
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        query: request.query,
        turnFocus,
        maxContextTokens: request.maxContextTokens,
        selectedSections,
        omittedSections,
        promptContext,
        usage: {
          selectedTokens: selectedSections.reduce((sum, section) => sum + section.tokenEstimate, 0),
          omittedTokens: omittedSections.reduce((sum, section) => sum + section.tokenEstimate, 0),
          totalCandidateTokens: candidates.reduce((sum, section) => sum + section.tokenEstimate, 0),
          selectedCount: selectedSections.length,
          omittedCount: omittedSections.length
        },
        sources: {
          collectedCounts,
          errors
        },
        policy: {
          noLlm: true,
          selection: 'required sections first, then higher source priority, each source trimmed to its source budget before global budget selection',
          sourceBudgets: request.sourceBudgets,
          sourcePriorities: request.sourcePriorities
        }
      };

      output.trace = this.traceRecorder.finish(trace, {
        output,
        stateAfter: {
          selectedSections: selectedSections.map((section) => ({
            id: section.id,
            title: section.title,
            tokenEstimate: section.tokenEstimate,
            truncated: section.truncated
          })),
          omittedSections: omittedSections.map((section) => ({
            id: section.id,
            reason: section.reason,
            tokenEstimate: section.tokenEstimate
          })),
          errors
        },
        prompt: promptContext
      });
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  buildTraceStateBefore(request) {
    const state = {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      hasAppDatabase: Boolean(this.appDatabase),
      suppliedMessageCount: request.messages.length
    };
    if (!this.appDatabase) return state;
    try {
      const messages = this.appDatabase.listChatMessages(request.chatSessionId);
      return {
        ...state,
        persistedMessageCount: messages.length,
        recentMessageIds: messages.slice(-request.recentMessageCount).map((message) => message.id)
      };
    } catch (error) {
      return {
        ...state,
        appDatabaseError: serializeError(error)
      };
    }
  }

  async collectTurnFocus({ request, collectedCounts }) {
    const messages = request.messages.length > 0
      ? request.messages
      : this.loadPersistedMessages(request.chatSessionId);
    const focus = buildTurnFocusContext({
      currentInput: request.currentInput || request.sourceText,
      query: request.query,
      messages
    });
    collectedCounts['turn.focus.messages'] = messages.length;
    collectedCounts['turn.focus.foregroundTargets'] = focus.foregroundTargetCandidates.length;
    collectedCounts['turn.focus.staleWarnings'] = focus.staleContextWarnings.length;
    collectedCounts['turn.focus.suppressStaleCombatNpcs'] = shouldSuppressStaleCombatNpcs(focus) ? 1 : 0;
    request.turnFocus = focus;
    return candidate('turn.focus', renderTurnFocusContext(focus), {
      raw: focus
    });
  }

  applySourceOverrides(candidate, request) {
    const base = CONTEXT_PLANNER_SOURCES.find((source) => source.id === candidate.id) || {};
    const maxTokens = numericOverride(request.sourceBudgets, candidate.id, candidate.maxTokens ?? base.maxTokens);
    const priority = numericOverride(request.sourcePriorities, candidate.id, candidate.priority ?? base.priority);
    return {
      ...base,
      ...candidate,
      maxTokens,
      priority,
      tokenEstimate: countTokens(candidate.text || '')
    };
  }

  async collectSceneNpcs({ request, errors, collectedCounts }) {
    const turnFocus = request.turnFocus || buildTurnFocusContext({
      currentInput: request.currentInput || request.sourceText,
      query: request.query,
      messages: request.messages.length > 0 ? request.messages : this.loadPersistedMessages(request.chatSessionId)
    });
    const suppressStaleCombatNpcs = shouldSuppressStaleCombatNpcs(turnFocus);
    const mounts = await this.callTool('system.scene_npcs.list_mounted_npcs', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      includeInactive: request.includeInactiveSceneObjects,
      query: request.sceneNpcQuery,
      limit: request.npcLimit
    }, errors);
    let mountedNpcs = extractRecords(mounts.output);
    if (suppressStaleCombatNpcs) {
      const before = mountedNpcs.length;
      mountedNpcs = filterStaleCombatNpcRecords(mountedNpcs, turnFocus);
      collectedCounts['scene.npcs.suppressedCombatMounts'] = before - mountedNpcs.length;
    }
    collectedCounts['scene.npcs.mounts'] = mountedNpcs.length;

    let states = [];
    if (request.includeNpcStates) {
      const stateResult = await this.callTool('system.npc_state.list_states', {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        limit: request.npcStateLimit
      }, errors);
      states = extractRecords(stateResult.output);
      if (suppressStaleCombatNpcs) {
        const before = states.length;
        states = filterStaleCombatNpcRecords(states, turnFocus);
        collectedCounts['scene.npcs.suppressedCombatStates'] = before - states.length;
      }
      collectedCounts['scene.npcs.states'] = states.length;
    }

    let profiles = [];
    if (request.includeNpcProfiles) {
      const npcIds = uniqueStrings(mountedNpcs
        .map((record) => record.data?.npcId || record.npcId || record.id)
        .filter(Boolean))
        .slice(0, request.profileLimit);
      const { includeL0, profileDbLevels } = splitProfileLevels(request.profileLevels);
      const profileBundles = new Map();

      if (includeL0 && this.hasTool('system.npc_registry.list_npcs')) {
        for (const npcId of npcIds) {
          const listed = await this.callTool('system.npc_registry.list_npcs', {
            filter: { id: npcId },
            limit: 1
          }, errors, { missingIsEmpty: true });
          const registryRecord = findRecordById(extractRecords(listed.output), npcId);
          if (registryRecord) {
            pushProfileBundleLevel(profileBundles, npcId, {
              id: registryRecord.id || npcId,
              level: 'L0',
              source: 'system.npc_registry.list_npcs',
              profile: registryRecord
            });
          }
        }
      } else if (includeL0 && this.hasTool('system.npc_registry.get_npc')) {
        for (const npcId of npcIds) {
          const l0 = await this.callTool('system.npc_registry.get_npc', {
            id: npcId
          }, errors, { missingIsEmpty: true });
          if (l0.ok && l0.output) {
            pushProfileBundleLevel(profileBundles, npcId, {
              id: l0.output.id || npcId,
              level: 'L0',
              source: 'system.npc_registry.get_npc',
              profile: l0.output
            });
          }
        }
      }

      if (profileDbLevels.length > 0 && this.hasTool('system.npc_profiles.get_profile_bundle')) {
        const profileBundleLimit = Math.min(request.profileLimit, 10);
        for (const npcId of npcIds) {
          const profile = await this.callTool('system.npc_profiles.get_profile_bundle', {
            npcId,
            levels: profileDbLevels,
            limit: profileBundleLimit
          }, errors, { missingIsEmpty: true });
          if (profile.ok && profile.output) {
            for (const level of profile.output.levels || []) {
              pushProfileBundleLevel(profileBundles, npcId, {
                ...level,
                source: level.source || 'system.npc_profiles.get_profile_bundle'
              });
            }
          }
        }
      }

      profiles = [...profileBundles.values()].map((bundle) => ({
        ...bundle,
        levels: bundle.levels.sort((a, b) => profileLevelOrder(a.level) - profileLevelOrder(b.level))
      }));
      collectedCounts['scene.npcs.profiles'] = profiles.length;
      collectedCounts['scene.npcs.profileLevels.L0'] = profiles.reduce(
        (sum, bundle) => sum + bundle.levels.filter((level) => level.level === 'L0').length,
        0
      );
      collectedCounts['scene.npcs.profileLevels.database'] = profiles.reduce(
        (sum, bundle) => sum + bundle.levels.filter((level) => level.level !== 'L0').length,
        0
      );
    }

    return candidate('scene.npcs', renderRecordBlock({
      mounts: mountedNpcs,
      states,
      profiles
    }), {
      raw: { mounts: mountedNpcs, states, profiles }
    });
  }

  async collectCurrentMap({ request, errors, collectedCounts }) {
    const mounted = await this.callTool('system.scene_maps.list_mounted_maps', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      includeInactive: request.includeInactiveSceneObjects,
      limit: request.mapLimit
    }, errors);
    const maps = extractRecords(mounted.output);
    collectedCounts['current.map.mounts'] = maps.length;

    let states = [];
    if (request.includeMapState) {
      const stateResult = await this.callTool('system.map_state.list_states', {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        limit: request.mapStateLimit
      }, errors);
      states = extractRecords(stateResult.output);
      collectedCounts['current.map.states'] = states.length;
    }

    return candidate('current.map', renderRecordBlock({ maps, states }), {
      raw: { maps, states }
    });
  }

  async collectCurrentQuests({ request, errors, collectedCounts }) {
    const active = await this.callTool('system.quests.list_quests', {
      chatSessionId: request.chatSessionId,
      activeOnly: true,
      query: request.questQuery,
      limit: request.questLimit
    }, errors);
    const quests = extractRecords(active.output);
    collectedCounts['current.quests'] = quests.length;
    return candidate('current.quests', renderRecordBlock({ quests }), {
      raw: { quests }
    });
  }

  async collectCharacterMemory({ request, errors, collectedCounts }) {
    let memory = await this.callTool('system.character_memory.get_prompt_context', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      query: request.query,
      limitPerCharacter: request.memoryLimitPerCharacter,
      maxContextTokens: request.sourceBudgets['character.memory'] || sourceDefault('character.memory').maxTokens
    }, errors);
    let context = memory.output?.context || '';
    if (!context.trim() && request.query.trim()) {
      memory = await this.callTool('system.character_memory.get_prompt_context', {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        limitPerCharacter: request.memoryLimitPerCharacter,
        maxContextTokens: request.sourceBudgets['character.memory'] || sourceDefault('character.memory').maxTokens
      }, errors);
      context = memory.output?.context || '';
    }
    collectedCounts['character.memory.sections'] = Array.isArray(memory.output?.sections) ? memory.output.sections.length : (context ? 1 : 0);
    return candidate('character.memory', context, {
      raw: memory.output
    });
  }

  async collectPermanentRag({ request, errors, collectedCounts }) {
    if (!request.query.trim()) {
      collectedCounts['permanent.rag'] = 0;
      return candidate('permanent.rag', '', { raw: { skipped: 'empty_query' } });
    }
    const rag = await this.callTool('system.rag_permanent.search', {
      collection: request.permanentRagCollection,
      query: request.query,
      limit: request.permanentRagLimit,
      minScore: request.minScore,
      filter: request.ragFilter
    }, errors, { missingIsEmpty: true });
    const hits = extractHits(rag.output);
    collectedCounts['permanent.rag'] = hits.length;
    return candidate('permanent.rag', renderRagHits(hits), {
      raw: { hits }
    });
  }

  async collectRuntimeRag({ request, errors, collectedCounts }) {
    if (!request.query.trim()) {
      collectedCounts['runtime.rag'] = 0;
      return candidate('runtime.rag', '', { raw: { skipped: 'empty_query' } });
    }
    const rag = await this.callTool('system.rag_runtime.search', {
      collection: request.runtimeRagCollection,
      query: request.query,
      limit: request.runtimeRagLimit,
      minScore: request.minScore,
      filter: request.ragFilter
    }, errors, { missingIsEmpty: true });
    const hits = extractHits(rag.output);
    collectedCounts['runtime.rag'] = hits.length;
    return candidate('runtime.rag', renderRagHits(hits), {
      raw: { hits }
    });
  }

  async collectRecentMessages({ request, collectedCounts }) {
    const messages = request.messages.length > 0
      ? request.messages
      : this.loadPersistedMessages(request.chatSessionId);
    const recent = messages.slice(-request.recentMessageCount);
    collectedCounts['recent.messages'] = recent.length;
    return candidate('recent.messages', serializeDialogue(recent), {
      raw: {
        messageIds: recent.map((message) => message.id).filter(Boolean),
        messages: recent
      }
    });
  }

  async collectCompression({ request, errors, collectedCounts }) {
    let compression = await this.callTool('system.chat_compression.get_prompt_context', {
      chatSessionId: request.chatSessionId,
      query: request.query,
      recentMessageCount: 0,
      includeRolling: true,
      includeSegmentSummaries: true,
      includePinnedFacts: true,
      summaryLimit: request.compressionSummaryLimit,
      pinnedLimit: request.pinnedLimit,
      maxContextTokens: request.sourceBudgets['chat.compression'] || sourceDefault('chat.compression').maxTokens,
      includeRawMessages: false
    }, errors);
    let context = compression.output?.context || '';
    if (!context.trim() && request.query.trim()) {
      compression = await this.callTool('system.chat_compression.get_prompt_context', {
        chatSessionId: request.chatSessionId,
        recentMessageCount: 0,
        includeRolling: true,
        includeSegmentSummaries: true,
        includePinnedFacts: true,
        summaryLimit: request.compressionSummaryLimit,
        pinnedLimit: request.pinnedLimit,
        maxContextTokens: request.sourceBudgets['chat.compression'] || sourceDefault('chat.compression').maxTokens,
        includeRawMessages: false
      }, errors);
      context = compression.output?.context || '';
    }
    collectedCounts['chat.compression.sections'] = Array.isArray(compression.output?.sections) ? compression.output.sections.length : (context ? 1 : 0);
    return candidate('chat.compression', context, {
      raw: compression.output
    });
  }

  loadPersistedMessages(chatSessionId) {
    if (!this.appDatabase) return [];
    try {
      return this.appDatabase.listChatMessages(chatSessionId);
    } catch {
      return [];
    }
  }

  hasTool(toolId) {
    try {
      this.toolManager.getTool(toolId);
      return true;
    } catch {
      return false;
    }
  }

  async callTool(toolId, input, errors, { missingIsEmpty = false } = {}) {
    if (!this.hasTool(toolId)) {
      const error = { toolId, message: `Tool not registered: ${toolId}`, name: 'ToolNotRegistered' };
      if (!missingIsEmpty) errors.push(error);
      return { ok: false, output: undefined, error };
    }
    try {
      const result = await this.toolManager.executeTool(toolId, input, undefined, {
        source: 'system.context_planner.plan_context',
        audit: { skipAudit: true }
      });
      return {
        ok: true,
        output: result.output,
        trace: result.trace
      };
    } catch (error) {
      const serialized = {
        toolId,
        input,
        ...serializeError(error)
      };
      if (!missingIsEmpty || !isMissingError(error)) {
        errors.push(serialized);
      }
      return {
        ok: false,
        output: undefined,
        error: serialized
      };
    }
  }
}

function normalizeRequest(input = {}) {
  const chatSessionId = normalizeRequiredText(input.chatSessionId || input.chatId || input.sessionId, 'chatSessionId');
  const messages = Array.isArray(input.messages)
    ? input.messages.map(normalizeMessageLike).filter((message) => message.content)
    : [];
  const query = normalizeOptionalText(
    input.query || input.text || input.currentInput || input.sourceText || buildQueryFromMessages(messages)
  );
  const sourceBudgets = normalizeNumberMap(input.sourceBudgets);
  const sourcePriorities = normalizeNumberMap(input.sourcePriorities);
  return {
    planId: input.planId || createId('ctxplan'),
    chatSessionId,
    sceneId: normalizeOptionalText(input.sceneId, 'current') || 'current',
    query,
    text: normalizeOptionalText(input.text),
    currentInput: normalizeOptionalText(input.currentInput || input.playerInput),
    sourceText: normalizeOptionalText(input.sourceText),
    messages,
    maxContextTokens: normalizePositiveInteger(input.maxContextTokens, DEFAULT_MAX_CONTEXT_TOKENS),
    reservedResponseTokens: normalizePositiveInteger(input.reservedResponseTokens, 0),
    recentMessageCount: normalizePositiveInteger(input.recentMessageCount, DEFAULT_RECENT_MESSAGE_COUNT),
    sourceBudgets: withDefaultSourceBudgets(sourceBudgets),
    sourcePriorities,
    includeSceneNpcs: input.includeSceneNpcs !== false,
    includeNpcProfiles: input.includeNpcProfiles !== false,
    includeNpcStates: input.includeNpcStates !== false,
    includeCurrentMap: input.includeCurrentMap !== false,
    includeMapState: input.includeMapState !== false,
    includeQuests: input.includeQuests !== false,
    includeCharacterMemory: input.includeCharacterMemory !== false,
    includePermanentRag: input.includePermanentRag !== false,
    includeRuntimeRag: input.includeRuntimeRag !== false,
    includeRecentMessages: input.includeRecentMessages !== false,
    includeTurnFocus: input.includeTurnFocus !== false,
    includeCompression: input.includeCompression !== false,
    includeInactiveSceneObjects: input.includeInactiveSceneObjects === true,
    permanentRagCollection: normalizeOptionalText(input.permanentRagCollection || input.ragCollection || 'permanent-default'),
    runtimeRagCollection: normalizeOptionalText(input.runtimeRagCollection || 'runtime-default'),
    permanentRagLimit: normalizePositiveInteger(input.permanentRagLimit ?? input.ragLimit, 4),
    runtimeRagLimit: normalizePositiveInteger(input.runtimeRagLimit ?? input.ragLimit, 4),
    minScore: typeof input.minScore === 'number' ? input.minScore : 0.15,
    ragFilter: isPlainObject(input.ragFilter) ? input.ragFilter : undefined,
    memoryLimitPerCharacter: normalizePositiveInteger(input.memoryLimitPerCharacter, 5),
    compressionSummaryLimit: normalizePositiveInteger(input.compressionSummaryLimit, 8),
    pinnedLimit: normalizePositiveInteger(input.pinnedLimit, 8),
    questLimit: normalizePositiveInteger(input.questLimit, 8),
    npcLimit: normalizePositiveInteger(input.npcLimit, 20),
    mapLimit: normalizePositiveInteger(input.mapLimit, 5),
    mapStateLimit: normalizePositiveInteger(input.mapStateLimit, 10),
    npcStateLimit: normalizePositiveInteger(input.npcStateLimit, 30),
    profileLevels: normalizeStringArray(input.profileLevels, ['L0', 'L1', 'L2']),
    profileLimit: normalizePositiveInteger(input.profileLimit, 20),
    sceneNpcQuery: normalizeOptionalText(input.sceneNpcQuery),
    questQuery: normalizeOptionalText(input.questQuery)
  };
}

function candidate(id, text, extra = {}) {
  const source = sourceDefault(id);
  const rendered = String(text || '').trim();
  return {
    ...source,
    id,
    text: rendered,
    tokenEstimate: countTokens(rendered),
    raw: extra.raw
  };
}

function budgetSections(candidates, maxContextTokens) {
  const available = Math.max(0, maxContextTokens);
  let remaining = available;
  const selected = [];
  const omitted = [];
  const sorted = [...candidates].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.order - b.order;
  });

  for (const section of sorted) {
    if (!section.text.trim()) {
      omitted.push({ ...section, reason: 'empty' });
      continue;
    }

    const sourceTrimmed = trimSection(section, section.maxTokens);
    if (sourceTrimmed.tokenEstimate <= remaining) {
      selected.push(sourceTrimmed);
      remaining -= sourceTrimmed.tokenEstimate;
      continue;
    }

    if (remaining >= MIN_TRIMMED_SECTION_TOKENS) {
      const globalTrimmed = trimSection(sourceTrimmed, remaining, 'global_budget');
      selected.push(globalTrimmed);
      remaining = Math.max(0, remaining - globalTrimmed.tokenEstimate);
      continue;
    }

    omitted.push({ ...sourceTrimmed, reason: 'budget_exhausted' });
  }

  return { selected, omitted };
}

function trimSection(section, maxTokens, reason = 'source_budget') {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return { ...section };
  const tokenEstimate = section.tokenEstimate ?? countTokens(section.text);
  if (tokenEstimate <= maxTokens) {
    return {
      ...section,
      tokenEstimate
    };
  }

  const trimmedText = trimTextByTokens(section.text, maxTokens);
  return {
    ...section,
    text: trimmedText,
    tokenEstimate: countTokens(trimmedText),
    originalTokenEstimate: tokenEstimate,
    truncated: true,
    truncationReason: reason
  };
}

function trimTextByTokens(text, maxTokens) {
  const value = String(text || '');
  if (countTokens(value) <= maxTokens) return value;

  let low = 0;
  let high = value.length;
  let best = '';
  const suffix = '\n[...truncated by Context Planner budget...]';
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateText = `${value.slice(0, mid).trimEnd()}${suffix}`;
    if (countTokens(candidateText) <= maxTokens) {
      best = candidateText;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best || suffix.trim();
}

function buildTurnFocusContext({ currentInput = '', query = '', messages = [] } = {}) {
  const normalizedMessages = Array.isArray(messages)
    ? messages.map(normalizeMessageLike).filter((message) => message.content)
    : [];
  const userMessages = normalizedMessages.filter((message) => message.role === 'user');
  const explicitCurrent = normalizeOptionalText(currentInput);
  const latestUser = userMessages.at(-1);
  const currentText = explicitCurrent || normalizeOptionalText(latestUser?.content) || normalizeOptionalText(query);
  const latestUserIsCurrent = latestUser && sameLooseText(latestUser.content, currentText);
  const previousUserMessages = latestUserIsCurrent ? userMessages.slice(0, -1) : userMessages;
  const previousUser = previousUserMessages.at(-1);
  const latestNonCombatUser = [...previousUserMessages].reverse().find((message) => !looksLikeCombatHistory(message.content));
  const latestCombatUser = [...previousUserMessages].reverse().find((message) => looksLikeCombatHistory(message.content));
  const latestAssistant = [...normalizedMessages].reverse().find((message) => message.role === 'assistant');
  const latestNonCurrentUserText = normalizeOptionalText(previousUser?.content);
  const foregroundText = normalizeOptionalText(latestNonCombatUser?.content);
  const foregroundKind = inferForegroundKind(foregroundText);
  const foregroundTargetCandidates = foregroundText ? extractForegroundTargetCandidates(foregroundText) : [];
  const currentShortOrElliptic = isShortOrEllipticInput(currentText);
  const currentCombatExplicit = looksLikeCombatHistory(currentText);
  const staleContextWarnings = [];
  if (currentShortOrElliptic && foregroundKind && latestCombatUser && latestNonCombatUser && latestCombatUser !== latestNonCombatUser && !currentCombatExplicit) {
    staleContextWarnings.push('Recent combat/monster mentions exist, but the latest non-combat foreground action is newer. Bind the short current input to the foreground action, not to older combat history.');
  }
  if (currentShortOrElliptic && foregroundKind === 'tracking' && !currentCombatExplicit) {
    staleContextWarnings.push('For a short escape/flee input during NPC tracking, interpret escape as leaving the tracking situation or avoiding the tracked NPC/current scene unless the player explicitly names an enemy or combat.');
  }
  return {
    currentInput: currentText,
    currentInputClass: currentShortOrElliptic ? 'short_or_elliptic' : 'explicit',
    currentCombatExplicit,
    latestNonCurrentUserInput: latestNonCurrentUserText,
    latestAssistantSummary: trimSingleLine(latestAssistant?.content || '', 180),
    foreground: foregroundText ? {
      kind: foregroundKind || 'recent_noncombat_action',
      sourceText: foregroundText,
      targetCandidates: foregroundTargetCandidates
    } : undefined,
    foregroundTargetCandidates,
    recentCombatHint: latestCombatUser ? trimSingleLine(latestCombatUser.content, 160) : '',
    staleContextWarnings,
    bindingPolicy: [
      'Resolve pronouns, omitted objects, and short inputs against the latest foreground/current-scene action first.',
      'Do not let older combat, monster, or defeated enemy mentions override a newer NPC tracking/social/investigation focus.',
      'Only bind the current input to combat/enemies when the current input explicitly mentions combat/enemy terms, or when active combat is the immediately previous foreground with no newer non-combat focus.'
    ]
  };
}

function renderTurnFocusContext(focus = {}) {
  const lines = [
    '<AI_DND_TURN_FOCUS>',
    `currentInput: ${focus.currentInput || '(empty)'}`,
    `currentInputClass: ${focus.currentInputClass || 'unknown'}`,
    `currentCombatExplicit: ${Boolean(focus.currentCombatExplicit)}`,
    focus.latestNonCurrentUserInput ? `latestNonCurrentUserInput: ${focus.latestNonCurrentUserInput}` : '',
    focus.foreground ? `foregroundKind: ${focus.foreground.kind}` : '',
    focus.foreground?.sourceText ? `foregroundSourceText: ${focus.foreground.sourceText}` : '',
    focus.foregroundTargetCandidates?.length ? `foregroundTargetCandidates: ${focus.foregroundTargetCandidates.join(', ')}` : '',
    focus.recentCombatHint ? `olderCombatHint: ${focus.recentCombatHint}` : '',
    focus.latestAssistantSummary ? `latestAssistantSummary: ${focus.latestAssistantSummary}` : '',
    focus.staleContextWarnings?.length ? 'staleContextWarnings:' : '',
    ...asArray(focus.staleContextWarnings).map((warning) => `- ${warning}`),
    'bindingPolicy:',
    ...asArray(focus.bindingPolicy).map((rule) => `- ${rule}`),
    '</AI_DND_TURN_FOCUS>'
  ].filter(Boolean);
  return lines.join('\n');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sameLooseText(a = '', b = '') {
  const left = String(a || '').replace(/\s+/g, '').trim();
  const right = String(b || '').replace(/\s+/g, '').trim();
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function looksLikeCombatHistory(text = '') {
  return /攻击|袭击|战斗|开战|交战|斗法|击杀|杀死|猎杀|妖兽|魔兽|怪物|敌人|敌方|守卫|强盗|盗匪|刺客|杀手|boss|monster|enemy|combat|attack|fight/i.test(String(text || ''));
}

function inferForegroundKind(text = '') {
  const source = String(text || '');
  if (/跟踪|追踪|尾随|盯梢|跟上|保持距离|follow|tail|track|shadow/i.test(source)) return 'tracking';
  if (/观察|调查|查看|搜索|检查|打听|investigate|search|inspect|observe/i.test(source)) return 'investigation';
  if (/说服|交谈|谈判|威胁|欺骗|询问|persuade|talk|negotiate|ask/i.test(source)) return 'social';
  if (/前往|进入|离开|移动|move|travel|enter|leave/i.test(source)) return 'movement';
  return '';
}

function extractForegroundTargetCandidates(text = '') {
  const source = String(text || '');
  const names = [];
  for (const match of source.matchAll(/(?:跟踪|追踪|尾随|盯梢|跟上|观察|调查|查看|询问|说服|交谈)\s*(?:NPC|人物|角色)?\s*([^，,。；;、]{2,18})/gu)) {
    const name = cleanPotentialTargetName(match[1]);
    if (name) names.push(name);
  }
  for (const match of source.matchAll(/(?:NPC|人物|角色|炼丹师|药师|商人|守卫|护卫|弟子|长老|剑修|修士)\s*([\u4e00-\u9fa5]{2,6})/gu)) {
    const name = cleanPotentialTargetName(match[1]);
    if (name) names.push(name);
  }
  for (const match of source.matchAll(/\b(?:NPC|merchant|guard|alchemist|healer|mage|target)\s+([A-Z][A-Za-z0-9_-]{1,30})\b/g)) {
    const name = cleanPotentialTargetName(match[1]);
    if (name) names.push(name);
  }
  return uniqueStrings(names).slice(0, 6);
}

function cleanPotentialTargetName(value = '') {
  const text = String(value || '').trim()
    .replace(/(?:保持距离|保持|距离|观察|看看|去哪里|去了哪里|去哪里了|去向|行踪|踪迹|动向).+$/u, '')
    .replace(/^(?:我|你|他|她|它|保持|距离|观察|跟踪|追踪|尾随|炼丹师|药师|商人|守卫|护卫|弟子|长老|剑修|修士)/u, '')
    .replace(/(?:哪里|那里|这里|当前|之前|之后)$/u, '')
    .trim();
  if (!text || text.length < 2) return '';
  if (/^(?:我要|逃跑|逃离|保持|距离|观察|看看|哪里|当前|之前|之后|妖兽|魔兽|怪物|敌人)$/u.test(text)) return '';
  return text;
}

function shouldSuppressStaleCombatNpcs(focus = {}) {
  const foregroundKind = focus.foreground?.kind || '';
  return focus.currentInputClass === 'short_or_elliptic'
    && focus.currentCombatExplicit !== true
    && ['tracking', 'investigation', 'social'].includes(foregroundKind)
    && focus.recentCombatHint
    && focus.latestNonCurrentUserInput;
}

function filterStaleCombatNpcRecords(records = [], focus = {}) {
  return records.filter((record) => {
    if (recordMatchesFocusTarget(record, focus)) return true;
    return !looksLikeCombatNpcRecord(record);
  });
}

function recordMatchesFocusTarget(record = {}, focus = {}) {
  const data = record?.data && typeof record.data === 'object' ? record.data : record || {};
  const labels = [record.id, data.id, data.npcId, data.actorId, data.name, data.title]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const targets = focus.foregroundTargetCandidates || [];
  return targets.some((target) => labels.some((label) => label.includes(target) || target.includes(label)));
}

function looksLikeCombatNpcRecord(record = {}) {
  const data = record?.data && typeof record.data === 'object' ? record.data : record || {};
  const type = String(data.actorType || data.type || data.kind || '').toLowerCase();
  if (['monster', 'enemy', 'hostile'].includes(type)) return true;
  if (data.threatTier || data.enemyId || data.combatMechanics || data.lootHints) return true;
  const text = JSON.stringify({
    id: record.id || data.id,
    name: data.name || data.npcId || data.actorId,
    tags: data.tags,
    metadata: data.metadata
  });
  return /妖兽|魔兽|怪物|敌人|敌方|monster|enemy|hostile/i.test(text);
}

function trimSingleLine(value = '', maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function isShortOrEllipticInput(text = '') {
  const source = String(text || '').trim();
  if (!source) return false;
  const compact = source.replace(/[，,。.!！?？\s]/g, '');
  return compact.length <= 12
    || /^(?:我)?(?:要|想|准备)?(?:逃跑|逃离|跑|撤退|撤离|离开|躲开|藏起来|甩开|摆脱|run|flee|escape)/iu.test(source);
}

function renderPromptContext({ planId, sections }) {
  const blocks = sections
    .filter((section) => section.text.trim())
    .map((section) => [
      `## ${section.title}`,
      section.text
    ].join('\n'));
  if (blocks.length === 0) return '';
  return [
    `<AI_DND_CONTEXT_PLAN id="${planId}">`,
    ...blocks,
    '</AI_DND_CONTEXT_PLAN>'
  ].join('\n\n');
}

function publicSection(section) {
  return {
    id: section.id,
    title: section.title,
    priority: section.priority,
    required: section.required,
    order: section.order,
    tokenEstimate: section.tokenEstimate,
    originalTokenEstimate: section.originalTokenEstimate,
    maxTokens: section.maxTokens,
    truncated: section.truncated === true,
    truncationReason: section.truncationReason
  };
}

function publicOmittedSection(section) {
  return {
    id: section.id,
    title: section.title,
    priority: section.priority,
    required: section.required,
    order: section.order,
    tokenEstimate: section.tokenEstimate,
    originalTokenEstimate: section.originalTokenEstimate,
    maxTokens: section.maxTokens,
    reason: section.reason || 'omitted',
    truncated: section.truncated === true,
    truncationReason: section.truncationReason
  };
}

function renderRecordBlock(groups) {
  const cleaned = {};
  for (const [key, value] of Object.entries(groups || {})) {
    const records = Array.isArray(value) ? value : [];
    if (records.length > 0) {
      cleaned[key] = records.map(compactRecord);
    }
  }
  if (Object.keys(cleaned).length === 0) return '';
  return JSON.stringify(cleaned, null, 2);
}

function compactRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  const compacted = {
    id: record.id || data.id,
    ...pickDefined({
      name: data.name,
      title: data.title,
      npcId: data.npcId,
      mapId: data.mapId,
      questId: data.questId,
      sceneId: data.sceneId,
      role: data.role,
      type: data.type,
      status: data.status,
      visibility: data.visibility,
      importance: data.importance,
      location: data.location || data.locationLabel,
      summary: data.summary,
      objective: data.objective,
      hookText: data.hookText || data.hook,
      values: data.values || data.numericValues,
      statusBar: data.statusBar,
      skillBar: data.skillBar,
      specialStatuses: data.specialStatuses || data.statuses,
      inventory: data.inventory,
      equipment: data.equipment,
      position: data.position,
      areas: data.areas,
      exits: data.exits,
      objects: data.objects || data.visibleObjects,
      hazards: data.hazards,
      routes: data.routes,
      tags: data.tags,
      metadata: data.metadata
    })
  };
  if (data.levels) compacted.levels = data.levels;
  if (data.records) compacted.records = data.records;
  return pruneLargeValues(compacted);
}

function renderRagHits(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return '';
  return hits.map((hit, index) => {
    const compact = hit.compact && typeof hit.compact === 'object' ? hit.compact : undefined;
    const sourceRef = compact?.sourceRef || hit.sourceRef || {};
    const source = sourceRef.recordId
      || sourceRef.sourceId
      || hit.metadata?.sourceId
      || hit.sourceId
      || hit.id
      || `hit-${index + 1}`;
    const score = Number.isFinite(hit.score) ? ` score=${hit.score.toFixed(3)}` : '';
    const metadataSource = compact?.metadata || hit.metadata;
    const metadata = metadataSource && Object.keys(metadataSource).length > 0
      ? ` metadata=${JSON.stringify(pruneLargeValues(metadataSource))}`
      : '';
    const body = compact?.claim || compact?.text || hit.text || hit.content || '';
    return `[${source}${score}${metadata}]\n${String(body).trim()}`;
  }).filter((entry) => entry.trim()).join('\n\n');
}

function extractRecords(output) {
  if (!output) return [];
  if (Array.isArray(output)) return output;
  if (Array.isArray(output.records)) return output.records;
  if (Array.isArray(output.items)) return output.items;
  if (Array.isArray(output.states)) return output.states;
  if (Array.isArray(output.maps)) return output.maps;
  if (Array.isArray(output.npcs)) return output.npcs;
  if (Array.isArray(output.quests)) return output.quests;
  if (output.record) return [output.record];
  return [];
}

function findRecordById(records = [], id) {
  return records.find((record) => {
    const data = record?.data || record || {};
    return record?.id === id || data.id === id || data.npcId === id;
  });
}

function extractHits(output) {
  if (!output) return [];
  if (Array.isArray(output.hits)) return output.hits;
  if (Array.isArray(output.documents)) return output.documents;
  if (Array.isArray(output.results)) return output.results;
  if (Array.isArray(output)) return output;
  return [];
}

function normalizeMessageLike(message) {
  if (!message || typeof message !== 'object') {
    return {
      role: 'user',
      content: String(message || '')
    };
  }
  return {
    id: message.id,
    role: message.role || 'user',
    name: message.name,
    content: String(message.content || ''),
    metadata: message.metadata || {},
    createdAt: message.createdAt,
    orderIndex: message.orderIndex
  };
}

function buildQueryFromMessages(messages) {
  return serializeDialogue(messages.slice(-6));
}

function normalizeRequiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}

function normalizeOptionalText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function normalizeNumberMap(value) {
  if (!isPlainObject(value)) return {};
  const output = {};
  for (const [key, number] of Object.entries(value)) {
    const normalized = Number(number);
    if (Number.isFinite(normalized)) output[key] = normalized;
  }
  return output;
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry || '').trim()).filter(Boolean);
    return normalized.length > 0 ? normalized : fallback;
  }
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function splitProfileLevels(levels = []) {
  const normalized = uniqueStrings(normalizeStringArray(levels, ['L0', 'L1', 'L2'])
    .map(normalizeProfileLevelForPlanner)
    .filter(Boolean));
  return {
    includeL0: normalized.includes('L0'),
    profileDbLevels: normalized.filter((level) => ['L1', 'L2', 'L3'].includes(level))
  };
}

function normalizeProfileLevelForPlanner(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['0', 'LEVEL0', 'LEVEL_0'].includes(normalized)) return 'L0';
  if (['1', 'LEVEL1', 'LEVEL_1'].includes(normalized)) return 'L1';
  if (['2', 'LEVEL2', 'LEVEL_2'].includes(normalized)) return 'L2';
  if (['3', 'LEVEL3', 'LEVEL_3'].includes(normalized)) return 'L3';
  if (['L0', 'L1', 'L2', 'L3'].includes(normalized)) return normalized;
  return '';
}

function pushProfileBundleLevel(profileBundles, npcId, level) {
  const bundle = profileBundles.get(npcId) || { npcId, levels: [] };
  const normalizedLevel = normalizeProfileLevelForPlanner(level.level);
  if (!normalizedLevel) return;
  if (!bundle.levels.some((entry) => entry.level === normalizedLevel && (entry.id || entry.profile?.id) === (level.id || level.profile?.id))) {
    const compactedLevel = {
      ...level,
      level: normalizedLevel
    };
    if (compactedLevel.profile) compactedLevel.profile = compactRecord(compactedLevel.profile);
    bundle.levels.push({
      ...compactedLevel
    });
  }
  profileBundles.set(npcId, bundle);
}

function profileLevelOrder(level) {
  const normalized = normalizeProfileLevelForPlanner(level);
  return ['L0', 'L1', 'L2', 'L3'].indexOf(normalized) === -1
    ? 99
    : ['L0', 'L1', 'L2', 'L3'].indexOf(normalized);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function withDefaultSourceBudgets(overrides) {
  return Object.fromEntries(CONTEXT_PLANNER_SOURCES.map((source) => [
    source.id,
    numericOverride(overrides, source.id, source.maxTokens)
  ]));
}

function numericOverride(map, id, fallback) {
  if (!map || typeof map !== 'object') return fallback;
  const direct = Number(map[id]);
  if (Number.isFinite(direct)) return direct;
  const looseKey = id.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  for (const [key, value] of Object.entries(map)) {
    if (key.replace(/[^A-Za-z0-9]/g, '').toLowerCase() === looseKey) {
      const normalized = Number(value);
      if (Number.isFinite(normalized)) return normalized;
    }
  }
  return fallback;
}

function sourceDefault(id) {
  return CONTEXT_PLANNER_SOURCES.find((source) => source.id === id) || {
    id,
    title: id,
    order: 1000,
    priority: 0,
    required: false,
    maxTokens: 500
  };
}

function pickDefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ''));
}

function pruneLargeValues(value, depth = 0) {
  if (depth > 4) return '[depth-limit]';
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => pruneLargeValues(entry, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value).slice(0, 40).map(([key, entry]) => [
    key,
    typeof entry === 'string' && entry.length > 1000
      ? `${entry.slice(0, 1000)}...[truncated]`
      : pruneLargeValues(entry, depth + 1)
  ]);
  return Object.fromEntries(entries);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode
  };
}

function isMissingError(error) {
  return /not found|not registered/i.test(error?.message || '');
}
