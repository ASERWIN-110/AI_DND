// @ts-nocheck
import { StructuredInterfaceTraceRecorder } from '../structured/structured-interface.js';
import { countTokens } from '../tokens/token-counter.js';
import { createId, nowIso } from '../utils/id.js';

export const CONTEXT_COMPLETENESS_TRACE_DIR = 'data/context-completeness-traces';

export const CONTEXT_COMPLETENESS_POLICY = {
  noLlm: true,
  defaultMissingPolicy: 'report_only',
  levels: {
    L0: 'Index layer: identity, role, importance, current location, short summary, profileRef.',
    L1: 'Light roleplay layer: compact persona, current motive, speaking style, prompt-ready summary.',
    L2: 'Structured deep layer: secrets, long-term goals, relationships, habits, rules, vulnerabilities.',
    L3: 'Full-fidelity layer: full character card, world book fragments, long history, special private rules.',
    RAG: 'Evidence layer: history, world lore, prior chat facts, source snippets, and gap probes.'
  },
  missingPolicies: ['report_only', 'ask_user', 'generate_ephemeral', 'generate_persistent'],
  escalationRules: [
    'casual/chat with minor actors: L0, optionally L1',
    'roleplay with major/key actors: L0 + L1',
    'persuasion/deception/intimidation: L0 + L1 + L2 + relationships + RAG',
    'npc_behavior/faction impact: L0 + L1 + L2 + relationships + factions + RAG',
    'worldline/permanent/high-risk decisions: add L3 and RAG',
    'combat basics: numeric state and L0; special actions add L1/L2'
  ],
  ragGapStrategy: 'RAG is used both as evidence and as a gap probe. Missing-awareness output tells the LLM what is absent and which layer/tool should be queried next.'
};

const INTENT_RULES = {
  casual_chat: {
    levels: ['L0', 'L1'],
    sources: [],
    rag: false,
    riskFloor: 'low'
  },
  chat_only: {
    levels: ['L0', 'L1'],
    sources: [],
    rag: false,
    riskFloor: 'low'
  },
  observation: {
    levels: ['L0', 'L1'],
    sources: ['state'],
    rag: false,
    riskFloor: 'low'
  },
  movement: {
    levels: ['L0'],
    sources: ['map', 'state'],
    rag: false,
    riskFloor: 'low'
  },
  combat_action: {
    levels: ['L0'],
    sources: ['state'],
    rag: false,
    riskFloor: 'medium'
  },
  combat_special: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['state', 'relationships'],
    rag: true,
    riskFloor: 'medium'
  },
  social_action: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['state', 'relationships', 'factions'],
    rag: true,
    riskFloor: 'medium'
  },
  persuasion: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['state', 'relationships', 'factions'],
    rag: true,
    riskFloor: 'medium'
  },
  deception: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['state', 'relationships', 'factions'],
    rag: true,
    riskFloor: 'medium'
  },
  intimidation: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['state', 'relationships', 'factions'],
    rag: true,
    riskFloor: 'medium'
  },
  npc_behavior: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['state', 'relationships', 'factions'],
    rag: true,
    riskFloor: 'high'
  },
  faction_impact: {
    levels: ['L0', 'L1', 'L2'],
    sources: ['relationships', 'factions'],
    rag: true,
    riskFloor: 'high'
  },
  world_lore: {
    levels: [],
    sources: ['worldbook'],
    rag: true,
    riskFloor: 'low'
  },
  adjudication: {
    levels: ['L0', 'L1'],
    sources: ['state'],
    rag: true,
    riskFloor: 'medium'
  },
  player_action: {
    levels: ['L0', 'L1'],
    sources: ['state'],
    rag: true,
    riskFloor: 'medium'
  }
};

const RISK_WEIGHT = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  permanent: 4,
  worldline: 5
};

export class ContextCompletenessPlanner {
  constructor({
    toolManager,
    appDatabase,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    if (!toolManager) throw new TypeError('ContextCompletenessPlanner requires toolManager');
    this.toolManager = toolManager;
    this.appDatabase = appDatabase;
    this.now = now;
    this.traceRecorder = traceRecorder || new StructuredInterfaceTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || CONTEXT_COMPLETENESS_TRACE_DIR,
      cwd,
      now
    });
  }

  describePolicy() {
    return {
      ...cloneJson(CONTEXT_COMPLETENESS_POLICY),
      traceDirectory: CONTEXT_COMPLETENESS_TRACE_DIR,
      toolsRead: [
        'system.scene_npcs.list_mounted_npcs',
        'system.npc_registry.get_npc',
        'system.npc_profiles.get_profile_bundle',
        'system.npc_state.list_states',
        'system.npc_relationships.traverse_relations',
        'system.factions.get_actor_factions',
        'system.rag_permanent.search',
        'system.rag_runtime.search',
        'system.context_planner.plan_context'
      ]
    };
  }

  assessNeed(input = {}) {
    const request = normalizeRequest(input, { requireChatSession: false });
    const intents = normalizeIntentList(input.intent || input.intents || request.intent || inferIntents(request.query));
    const risk = strongestRisk([
      normalizeRisk(input.riskHint || input.risk || input.riskLevel),
      ...intents.map((intent) => INTENT_RULES[intent]?.riskFloor).filter(Boolean),
      inferRisk(request.query)
    ]);
    const actorIds = uniqueStrings([
      ...normalizeStringArray(input.actorIds || input.actors || input.npcIds || input.npcs),
      ...normalizeStringArray(input.targetActorIds || input.targetNpcIds)
    ]);
    const base = buildRequirementFromIntents(intents);
    const requiredLevels = escalateLevels(base.levels, {
      risk,
      importance: input.importance || input.actorImportance || input.importanceHint,
      forceLevels: input.requiredLevels || input.profileLevels
    });
    const requiredSources = escalateSources(base.sources, { risk, includeRag: base.rag || input.includeRag === true });
    const actorRequirements = Object.fromEntries(actorIds.map((actorId) => [
      actorId,
      {
        actorId,
        requiredLevels,
        requiredSources,
        reasons: buildReasons({ intents, risk, requiredLevels, requiredSources })
      }
    ]));
    const plan = {
      planId: request.planId,
      noLlm: true,
      query: request.query,
      intents,
      risk,
      actorIds,
      requiredLevels,
      requiredSources,
      actorRequirements,
      ragRequired: requiredSources.includes('rag'),
      missingPolicy: normalizeMissingPolicy(input.missingPolicy),
      reasons: buildReasons({ intents, risk, requiredLevels, requiredSources }),
      next: {
        resolveTool: 'system.context_completeness.resolve_context',
        recommendedInput: {
          chatSessionId: request.chatSessionId || undefined,
          sceneId: request.sceneId,
          query: request.query,
          intents,
          actorIds,
          riskHint: risk,
          missingPolicy: normalizeMissingPolicy(input.missingPolicy)
        }
      }
    };
    return plan;
  }

  explainPlan(input = {}) {
    const assessment = input.assessment && isPlainObject(input.assessment)
      ? input.assessment
      : this.assessNeed(input);
    return {
      noLlm: true,
      planId: assessment.planId || input.planId || createId('ctxneed'),
      summary: [
        `Intents: ${(assessment.intents || []).join(', ') || 'unknown'}`,
        `Risk: ${assessment.risk || 'medium'}`,
        `Required levels: ${(assessment.requiredLevels || []).join(', ') || 'none'}`,
        `Required sources: ${(assessment.requiredSources || []).join(', ') || 'none'}`,
        `Missing policy: ${assessment.missingPolicy || 'report_only'}`
      ].join('\n'),
      reasons: assessment.reasons || [],
      ragGapStrategy: CONTEXT_COMPLETENESS_POLICY.ragGapStrategy,
      assessment
    };
  }

  async resolveContext(input = {}) {
    const request = normalizeRequest(input, { requireChatSession: true });
    const trace = this.traceRecorder.start('resolve-context-completeness', {
      sessionId: request.chatSessionId,
      input: request,
      stateBefore: {
        hasAppDatabase: Boolean(this.appDatabase),
        hasContextPlanner: this.hasTool('system.context_planner.plan_context'),
        availableReadTools: this.describePolicy().toolsRead.filter((toolId) => this.hasTool(toolId))
      }
    });

    try {
      const initialAssessment = input.assessment && isPlainObject(input.assessment)
        ? input.assessment
        : this.assessNeed(input);
      const errors = [];
      const toolCalls = [];
      const mountedNpcs = await this.collectMountedNpcs(request, errors, toolCalls);
      const actorIds = uniqueStrings([
        ...normalizeStringArray(initialAssessment.actorIds),
        ...normalizeStringArray(request.actorIds),
        ...mountedNpcs.map((record) => record.data?.npcId || record.npcId || record.id).filter(Boolean)
      ]).slice(0, request.actorLimit);

      const actorContext = {};
      for (const actorId of actorIds) {
        actorContext[actorId] = await this.resolveActorContext({
          actorId,
          request,
          initialAssessment,
          errors,
          toolCalls
        });
      }

      const resolvedLevels = uniqueStrings(Object.values(actorContext).flatMap((actor) => actor.requiredLevels || []));
      const requiredSources = uniqueStrings([
        ...(initialAssessment.requiredSources || []),
        ...Object.values(actorContext).flatMap((actor) => actor.requiredSources || [])
      ]);
      const rag = await this.resolveRag({
        request,
        requiredSources,
        errors,
        toolCalls,
        missingProbe: true
      });
      const contextPlanner = await this.resolveContextPlanner({
        request,
        requiredLevels: resolvedLevels.length > 0 ? resolvedLevels : initialAssessment.requiredLevels,
        requiredSources,
        errors,
        toolCalls
      });
      const missing = buildMissingReport({ actorContext, rag, requiredSources });
      const missingAwareness = buildMissingAwareness({
        request,
        actorContext,
        rag,
        missing,
        missingPolicy: initialAssessment.missingPolicy || request.missingPolicy
      });
      const contextPackage = renderContextPackage({
        request,
        assessment: initialAssessment,
        actorContext,
        rag,
        contextPlanner,
        missingAwareness
      });
      const promptContext = contextPlanner.promptContext || contextPackage;
      const sufficiency = summarizeSufficiency(missing);
      const databaseCallCounts = buildDatabaseCallCounts(toolCalls);
      const output = {
        planId: request.planId,
        noLlm: true,
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        query: request.query,
        intent: initialAssessment.intents?.[0],
        intents: initialAssessment.intents || [],
        risk: initialAssessment.risk,
        sufficiency,
        assessment: {
          ...initialAssessment,
          actorIds,
          requiredLevels: resolvedLevels.length > 0 ? resolvedLevels : initialAssessment.requiredLevels,
          requiredSources
        },
        actorContext,
        rag,
        contextPlanner,
        missing,
        missingAwareness,
        nextRetrievalActions: missingAwareness.nextRetrievalActions,
        promptContext,
        contextPackage,
        usage: {
          promptTokens: countTokens(promptContext),
          packageTokens: countTokens(contextPackage),
          actorCount: Object.keys(actorContext).length,
          ragHits: rag.totalHits || 0,
          databaseCallCount: databaseCallCounts.rawCallCount
        },
        debug: {
          databaseCallCounts,
          note: 'Counts are grouped for debugging context retrieval. A single profile_bundle call can increment multiple L1/L2/L3 counters; empty means the lookup succeeded but returned no data for that requested importance layer.'
        },
        toolCalls,
        errors,
        policy: {
          noLlm: true,
          missingPolicy: initialAssessment.missingPolicy || request.missingPolicy,
          ragGapStrategy: CONTEXT_COMPLETENESS_POLICY.ragGapStrategy
        }
      };
      output.trace = this.traceRecorder.finish(trace, {
        output,
        stateAfter: {
          sufficiency,
          actorIds,
          missing,
          rag: {
            searched: rag.searched,
            totalHits: rag.totalHits
          },
          databaseCallCounts,
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

  async collectMountedNpcs(request, errors, toolCalls) {
    if (request.includeSceneActors === false || !request.chatSessionId || !this.hasTool('system.scene_npcs.list_mounted_npcs')) return [];
    const result = await this.callTool('system.scene_npcs.list_mounted_npcs', {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      includeInactive: request.includeInactiveSceneObjects,
      limit: request.sceneNpcLimit
    }, errors, toolCalls, { missingIsEmpty: true });
    return extractRecords(result.output);
  }

  async resolveActorContext({ actorId, request, initialAssessment, errors, toolCalls }) {
    let requiredLevels = normalizeLevels(initialAssessment.actorRequirements?.[actorId]?.requiredLevels || initialAssessment.requiredLevels || request.profileLevels);
    let requiredSources = uniqueStrings(initialAssessment.actorRequirements?.[actorId]?.requiredSources || initialAssessment.requiredSources || []);
    const actor = {
      actorId,
      requiredLevels,
      requiredSources,
      loadedLevels: [],
      missingLevels: [],
      sources: {},
      warnings: []
    };

    if (requiredLevels.includes('L0')) {
      let registryRecord;
      if (this.hasTool('system.npc_registry.list_npcs')) {
        const listed = await this.callTool('system.npc_registry.list_npcs', {
          filter: { id: actorId },
          limit: 1
        }, errors, toolCalls, { missingIsEmpty: true });
        registryRecord = findRecordById(extractRecords(listed.output), actorId);
      } else if (this.hasTool('system.npc_registry.get_npc')) {
        const l0 = await this.callTool('system.npc_registry.get_npc', { id: actorId }, errors, toolCalls, { missingIsEmpty: true });
        registryRecord = l0.ok ? l0.output : undefined;
      }
      if (registryRecord) {
        actor.sources.L0 = compactRecord(registryRecord);
        actor.loadedLevels.push('L0');
        requiredLevels = escalateLevels(requiredLevels, {
          risk: initialAssessment.risk,
          importance: registryRecord.data?.importance,
          forceLevels: request.profileLevels
        });
        requiredSources = escalateSources(requiredSources, {
          risk: initialAssessment.risk,
          includeRag: initialAssessment.ragRequired || request.includeRag === true,
          importance: registryRecord.data?.importance
        });
      }
    }

    const profileLevels = requiredLevels.filter((level) => ['L1', 'L2', 'L3'].includes(level));
    if (profileLevels.length > 0 && this.hasTool('system.npc_profiles.get_profile_bundle')) {
      const bundle = await this.callTool('system.npc_profiles.get_profile_bundle', {
        npcId: actorId,
        levels: profileLevels,
        limit: Math.min(request.profileLimit, 10)
      }, errors, toolCalls, { missingIsEmpty: true });
      if (bundle.ok && bundle.output) {
        actor.sources.profiles = {
          npcId: bundle.output.npcId || actorId,
          levels: (bundle.output.levels || []).map((level) => ({
            ...level,
            profile: compactRecord(level.profile)
          }))
        };
        for (const level of actor.sources.profiles.levels) actor.loadedLevels.push(level.level);
      }
    }

    if (requiredSources.includes('state') && this.hasTool('system.npc_state.list_states')) {
      const states = await this.callTool('system.npc_state.list_states', {
        chatSessionId: request.chatSessionId,
        sceneId: request.sceneId,
        npcId: actorId,
        limit: request.npcStateLimit
      }, errors, toolCalls, { missingIsEmpty: true });
      actor.sources.state = extractRecords(states.output).map(compactRecord);
    }

    if (requiredSources.includes('relationships') && this.hasTool('system.npc_relationships.traverse_relations')) {
      const nodeExists = await this.hasRelationshipNode(actorId, errors, toolCalls);
      if (nodeExists) {
        const relations = await this.callTool('system.npc_relationships.traverse_relations', {
          startNpcId: actorId,
          maxDepth: request.relationshipDepth,
          limit: request.relationshipLimit
        }, errors, toolCalls, { missingIsEmpty: true });
        actor.sources.relationships = relations.output ? compactRecord(relations.output) : undefined;
      } else {
        actor.sources.relationships = { nodes: [], edges: [], missingNode: actorId };
      }
    }

    if (requiredSources.includes('factions') && this.hasTool('system.factions.get_actor_factions')) {
      const factions = await this.callTool('system.factions.get_actor_factions', {
        actorId,
        limit: request.factionLimit
      }, errors, toolCalls, { missingIsEmpty: true });
      actor.sources.factions = factions.output ? compactRecord(factions.output) : undefined;
    }

    actor.requiredLevels = requiredLevels;
    actor.requiredSources = requiredSources;
    actor.loadedLevels = uniqueStrings(actor.loadedLevels).sort(profileLevelCompare);
    actor.missingLevels = requiredLevels.filter((level) => !actor.loadedLevels.includes(level));
    actor.sufficiency = actor.missingLevels.length === 0 ? 'enough' : 'insufficient';
    actor.reason = actor.sufficiency === 'enough'
      ? `Loaded required levels for ${actorId}: ${actor.loadedLevels.join(', ')}.`
      : `Missing required levels for ${actorId}: ${actor.missingLevels.join(', ')}.`;
    return actor;
  }

  async resolveRag({ request, requiredSources, errors, toolCalls, missingProbe }) {
    const ragRequired = request.includeRag !== false && (requiredSources.includes('rag') || request.forceRag === true || request.ragProbe === true);
    const output = {
      searched: false,
      required: ragRequired,
      missingProbe: Boolean(missingProbe),
      query: request.query,
      totalHits: 0,
      permanent: { hits: [] },
      runtime: { hits: [] },
      warnings: []
    };
    if (!ragRequired || !request.query.trim()) {
      if (ragRequired) output.warnings.push('RAG required but query is empty.');
      return output;
    }
    output.searched = true;
    if (this.hasTool('system.rag_permanent.search') && request.includePermanentRag !== false) {
      const permanent = await this.callTool('system.rag_permanent.search', {
        collection: request.permanentRagCollection || request.ragCollection,
        query: request.query,
        limit: request.ragLimit,
        minScore: request.minScore,
        filter: request.ragFilter
      }, errors, toolCalls, { missingIsEmpty: true });
      output.permanent = { hits: extractHits(permanent.output).map(compactRagHit) };
    }
    if (this.hasTool('system.rag_runtime.search') && request.includeRuntimeRag !== false) {
      const runtime = await this.callTool('system.rag_runtime.search', {
        collection: request.runtimeRagCollection,
        query: request.query,
        limit: request.ragLimit,
        minScore: request.minScore,
        filter: request.ragFilter
      }, errors, toolCalls, { missingIsEmpty: true });
      output.runtime = { hits: extractHits(runtime.output).map(compactRagHit) };
    }
    output.totalHits = output.permanent.hits.length + output.runtime.hits.length;
    if (ragRequired && output.totalHits === 0) output.warnings.push('RAG gap probe found no hits; deeper profile levels or user clarification may be needed.');
    return output;
  }

  async resolveContextPlanner({ request, requiredLevels, requiredSources, errors, toolCalls }) {
    if (request.useContextPlanner === false || !this.hasTool('system.context_planner.plan_context')) {
      return {
        executed: false,
        reason: request.useContextPlanner === false ? 'disabled' : 'tool_not_registered',
        promptContext: ''
      };
    }
    const input = {
      chatSessionId: request.chatSessionId,
      sceneId: request.sceneId,
      query: request.query,
      currentInput: request.currentInput || request.sourceText || request.query,
      sourceText: request.sourceText || request.currentInput || request.query,
      maxContextTokens: request.maxContextTokens,
      recentMessageCount: request.recentMessageCount,
      profileLevels: requiredLevels.length > 0 ? requiredLevels : ['L0', 'L1'],
      includeNpcProfiles: true,
      includeNpcStates: requiredSources.includes('state'),
      includePermanentRag: requiredSources.includes('rag') && request.includePermanentRag !== false,
      includeRuntimeRag: requiredSources.includes('rag') && request.includeRuntimeRag !== false,
      permanentRagCollection: request.permanentRagCollection,
      runtimeRagCollection: request.runtimeRagCollection,
      ragCollection: request.ragCollection,
      ragLimit: request.ragLimit,
      minScore: request.minScore,
      ragFilter: request.ragFilter,
      ...(request.contextPlannerInput || {})
    };
    const result = await this.callTool('system.context_planner.plan_context', input, errors, toolCalls, { missingIsEmpty: true });
    return {
      executed: result.ok,
      input,
      output: result.output,
      promptContext: result.output?.promptContext || '',
      selectedSections: result.output?.selectedSections || [],
      omittedSections: result.output?.omittedSections || []
    };
  }

  hasTool(toolId) {
    try {
      this.toolManager.getTool(toolId);
      return true;
    } catch {
      return false;
    }
  }

  async hasRelationshipNode(actorId, errors, toolCalls) {
    if (!this.hasTool('system.npc_relationships.list_nodes')) return false;
    const listed = await this.callTool('system.npc_relationships.list_nodes', {
      filter: { npcId: actorId },
      limit: 5
    }, errors, toolCalls, { missingIsEmpty: true });
    const records = extractRecords(listed.output);
    return records.some((record) => {
      const data = record?.data || record || {};
      return data.npcId === actorId || data.id === actorId || record.id === actorId;
    });
  }

  async callTool(toolId, input, errors, toolCalls, { missingIsEmpty = false } = {}) {
    const call = createDebugToolCall(toolId, input);
    toolCalls.push(call);
    if (!this.hasTool(toolId)) {
      call.status = 'missing';
      call.error = { name: 'ToolNotRegistered', message: `Tool not registered: ${toolId}` };
      call.emptyImportanceLayers = call.importanceLayers;
      if (!missingIsEmpty) errors.push({ toolId, input, ...call.error });
      return { ok: false, output: undefined, error: call.error };
    }
    try {
      const result = await this.toolManager.executeTool(toolId, input, undefined, {
        source: 'system.context_completeness.resolve_context',
        audit: { skipAudit: true }
      });
      call.status = 'ok';
      call.trace = result.trace;
      call.outputSummary = summarizeToolOutput(result.output);
      call.resolvedImportanceLayers = inferResolvedImportanceLayers(toolId, result.output, call.importanceLayers);
      call.emptyImportanceLayers = call.importanceLayers.filter((layer) => !call.resolvedImportanceLayers.includes(layer));
      return { ok: true, output: result.output, trace: result.trace };
    } catch (error) {
      call.status = 'error';
      call.error = serializeError(error);
      call.emptyImportanceLayers = call.importanceLayers;
      if (!missingIsEmpty || !isMissingError(error)) errors.push({ toolId, input, ...call.error });
      return { ok: false, output: undefined, error: call.error };
    }
  }
}

const DEBUG_IMPORTANCE_LAYERS = ['L0', 'L1', 'L2', 'L3', 'RAG'];

function createDebugToolCall(toolId, input) {
  return {
    toolId,
    input,
    sourceKind: inferToolCallSourceKind(toolId),
    actorId: inferToolCallActorId(toolId, input),
    importanceLayers: inferToolCallImportanceLayers(toolId, input),
    status: 'pending'
  };
}

function buildDatabaseCallCounts(toolCalls = []) {
  const counts = {
    rawCallCount: toolCalls.length,
    total: createCallCounter(),
    byImportance: Object.fromEntries(DEBUG_IMPORTANCE_LAYERS.map((layer) => [layer, createCallCounter()])),
    bySource: {},
    byTool: {},
    byActor: {},
    notes: [
      'rawCallCount counts direct tool/database lookups issued by ContextCompletenessPlanner.',
      'byImportance expands multi-layer profile lookups, so L1/L2/L3 totals may exceed rawCallCount.',
      'empty means a lookup ran but returned no usable data for that requested L0/L1/L2/L3/RAG layer.'
    ]
  };

  for (const call of toolCalls) {
    const status = normalizeCallStatus(call.status);
    incrementCallCounter(counts.total, status);

    const sourceKind = call.sourceKind || inferToolCallSourceKind(call.toolId);
    incrementCallCounter(counts.bySource[sourceKind] ||= createCallCounter(), status);

    const toolCounter = counts.byTool[call.toolId] ||= createCallCounter();
    incrementCallCounter(toolCounter, status);
    if ((call.emptyImportanceLayers || []).length > 0) toolCounter.empty += 1;

    const importanceLayers = uniqueStrings(call.importanceLayers || inferToolCallImportanceLayers(call.toolId, call.input))
      .filter((layer) => DEBUG_IMPORTANCE_LAYERS.includes(layer));
    const emptyImportanceLayers = new Set(call.emptyImportanceLayers || []);
    for (const layer of importanceLayers) {
      const counter = counts.byImportance[layer] ||= createCallCounter();
      incrementCallCounter(counter, status);
      if (emptyImportanceLayers.has(layer)) counter.empty += 1;
    }

    if (call.actorId) {
      const actorCounter = counts.byActor[call.actorId] ||= {
        total: createCallCounter(),
        byImportance: Object.fromEntries(DEBUG_IMPORTANCE_LAYERS.map((layer) => [layer, createCallCounter()]))
      };
      incrementCallCounter(actorCounter.total, status);
      for (const layer of importanceLayers) {
        incrementCallCounter(actorCounter.byImportance[layer], status);
        if (emptyImportanceLayers.has(layer)) actorCounter.byImportance[layer].empty += 1;
      }
    }
  }

  return counts;
}

function createCallCounter() {
  return {
    attempted: 0,
    ok: 0,
    error: 0,
    missing: 0,
    pending: 0,
    empty: 0
  };
}

function incrementCallCounter(counter, status, amount = 1) {
  counter.attempted += amount;
  if (status === 'ok') counter.ok += amount;
  else if (status === 'error') counter.error += amount;
  else if (status === 'missing') counter.missing += amount;
  else counter.pending += amount;
}

function normalizeCallStatus(status) {
  return ['ok', 'error', 'missing', 'pending'].includes(status) ? status : 'pending';
}

function inferToolCallImportanceLayers(toolId, input = {}) {
  if (toolId === 'system.npc_registry.get_npc') return ['L0'];
  if (toolId === 'system.npc_registry.list_npcs') return ['L0'];
  if (toolId === 'system.npc_profiles.get_profile_bundle') {
    const levels = normalizeLevels(input.levels || input.profileLevels || input.requiredLevels);
    return levels.length > 0 ? levels.filter((level) => ['L1', 'L2', 'L3'].includes(level)) : ['L1', 'L2', 'L3'];
  }
  if (toolId === 'system.rag_permanent.search' || toolId === 'system.rag_runtime.search') return ['RAG'];
  return [];
}

function inferResolvedImportanceLayers(toolId, output, requestedLayers = []) {
  if (!output) return [];
  if (toolId === 'system.npc_registry.get_npc') {
    return hasRecordLikeOutput(output) ? ['L0'] : [];
  }
  if (toolId === 'system.npc_registry.list_npcs') {
    return extractRecords(output).length > 0 ? ['L0'] : [];
  }
  if (toolId === 'system.npc_profiles.get_profile_bundle') {
    const levels = extractProfileBundleLevels(output);
    return levels.length > 0 ? levels : [];
  }
  if (toolId === 'system.rag_permanent.search' || toolId === 'system.rag_runtime.search') {
    return extractHits(output).length > 0 ? ['RAG'] : [];
  }
  return requestedLayers.length > 0 ? requestedLayers : [];
}

function inferToolCallSourceKind(toolId) {
  const sourceKinds = {
    'system.scene_npcs.list_mounted_npcs': 'sceneMounts',
    'system.npc_registry.get_npc': 'npcRegistry',
    'system.npc_registry.list_npcs': 'npcRegistry',
    'system.npc_profiles.get_profile_bundle': 'npcProfiles',
    'system.npc_state.list_states': 'npcState',
    'system.npc_relationships.traverse_relations': 'npcRelationships',
    'system.factions.get_actor_factions': 'factions',
    'system.rag_permanent.search': 'ragPermanent',
    'system.rag_runtime.search': 'ragRuntime',
    'system.context_planner.plan_context': 'contextPlanner'
  };
  return sourceKinds[toolId] || 'other';
}

function inferToolCallActorId(toolId, input = {}) {
  if (toolId === 'system.npc_registry.get_npc') return normalizeOptionalText(input.id);
  if (toolId === 'system.npc_registry.list_npcs') return normalizeOptionalText(input.filter?.id || input.id || input.npcId);
  if (toolId === 'system.npc_profiles.get_profile_bundle') return normalizeOptionalText(input.npcId || input.actorId);
  if (toolId === 'system.npc_state.list_states') return normalizeOptionalText(input.actorId || input.npcId);
  if (toolId === 'system.npc_relationships.traverse_relations') return normalizeOptionalText(input.startNpcId || input.sourceNpcId || input.actorId);
  if (toolId === 'system.factions.get_actor_factions') return normalizeOptionalText(input.actorId || input.npcId);
  return '';
}

function hasRecordLikeOutput(output) {
  if (!output || typeof output !== 'object') return false;
  if (output.record || output.data) return true;
  if (output.id || output.npcId || output.name) return true;
  return extractRecords(output).length > 0;
}

function extractProfileBundleLevels(output) {
  if (!output || typeof output !== 'object') return [];
  const records = [
    ...(Array.isArray(output.levels) ? output.levels : []),
    ...(Array.isArray(output.profiles) ? output.profiles : []),
    ...extractRecords(output)
  ];
  return normalizeLevels(records.map((record) => (
    record.level
      || record.profile?.level
      || record.data?.level
      || record.data?.profileLevel
  )));
}

function normalizeRequest(input = {}, { requireChatSession = false } = {}) {
  const chatSessionId = normalizeOptionalText(input.chatSessionId || input.chatId || input.sessionId);
  if (requireChatSession && !chatSessionId) throw new TypeError('chatSessionId is required');
  const query = normalizeOptionalText(input.query || input.text || input.currentInput || input.sourceText || input.playerInput || '');
  return {
    planId: input.planId || createId('ctxcomplete'),
    chatSessionId,
    sceneId: normalizeOptionalText(input.sceneId) || 'current',
    query,
    currentInput: normalizeOptionalText(input.currentInput || input.playerInput),
    sourceText: normalizeOptionalText(input.sourceText),
    intent: input.intent,
    actorIds: normalizeStringArray(input.actorIds || input.actors || input.npcIds || input.npcs),
    profileLevels: normalizeLevels(input.profileLevels || input.requiredLevels || ['L0', 'L1']),
    missingPolicy: normalizeMissingPolicy(input.missingPolicy),
    includeSceneActors: input.includeSceneActors !== false,
    includeInactiveSceneObjects: input.includeInactiveSceneObjects === true,
    includeRag: input.includeRag !== false,
    includePermanentRag: input.includePermanentRag !== false,
    includeRuntimeRag: input.includeRuntimeRag !== false,
    forceRag: input.forceRag === true,
    ragProbe: input.ragProbe !== false,
    useContextPlanner: input.useContextPlanner !== false,
    contextPlannerInput: isPlainObject(input.contextPlannerInput) ? input.contextPlannerInput : {},
    maxContextTokens: normalizeInteger(input.maxContextTokens, 6000),
    recentMessageCount: normalizeInteger(input.recentMessageCount, 12),
    actorLimit: normalizeInteger(input.actorLimit || input.npcLimit, 20),
    sceneNpcLimit: normalizeInteger(input.sceneNpcLimit || input.npcLimit, 50),
    profileLimit: normalizeInteger(input.profileLimit, 10),
    npcStateLimit: normalizeInteger(input.npcStateLimit, 50),
    relationshipDepth: normalizeInteger(input.relationshipDepth, 2),
    relationshipLimit: normalizeInteger(input.relationshipLimit, 50),
    factionLimit: normalizeInteger(input.factionLimit, 20),
    ragLimit: normalizeInteger(input.ragLimit, 5),
    minScore: typeof input.minScore === 'number' ? input.minScore : 0.15,
    ragFilter: isPlainObject(input.ragFilter) ? input.ragFilter : undefined,
    ragCollection: normalizeOptionalText(input.ragCollection),
    permanentRagCollection: normalizeOptionalText(input.permanentRagCollection || input.ragCollection),
    runtimeRagCollection: normalizeOptionalText(input.runtimeRagCollection || 'runtime-default')
  };
}

function buildRequirementFromIntents(intents = []) {
  const rules = intents.map((intent) => INTENT_RULES[intent]).filter(Boolean);
  const levels = uniqueStrings(rules.flatMap((rule) => rule.levels || []));
  const sources = uniqueStrings(rules.flatMap((rule) => rule.sources || []));
  const rag = rules.some((rule) => rule.rag);
  return {
    levels: levels.length > 0 ? levels : ['L0', 'L1'],
    sources: rag ? uniqueStrings([...sources, 'rag']) : sources,
    rag
  };
}

function escalateLevels(levels = [], { risk = 'medium', importance = '', forceLevels } = {}) {
  const output = new Set(normalizeLevels(levels));
  for (const level of normalizeLevels(forceLevels)) output.add(level);
  const normalizedImportance = normalizeOptionalText(importance).toLowerCase();
  if (['supporting', 'major', 'key'].includes(normalizedImportance)) output.add('L1');
  if (['major', 'key'].includes(normalizedImportance) && riskWeight(risk) >= RISK_WEIGHT.medium) output.add('L2');
  if (riskWeight(risk) >= RISK_WEIGHT.high) output.add('L2');
  if (riskWeight(risk) >= RISK_WEIGHT.permanent) output.add('L3');
  if (output.size === 0) output.add('L0');
  return [...output].sort(profileLevelCompare);
}

function escalateSources(sources = [], { risk = 'medium', includeRag = false, importance = '' } = {}) {
  const output = new Set(normalizeStringArray(sources));
  if (includeRag || riskWeight(risk) >= RISK_WEIGHT.high) output.add('rag');
  if (riskWeight(risk) >= RISK_WEIGHT.medium) output.add('state');
  if (riskWeight(risk) >= RISK_WEIGHT.high || ['major', 'key'].includes(normalizeOptionalText(importance).toLowerCase())) {
    output.add('relationships');
    output.add('factions');
  }
  return [...output];
}

function buildReasons({ intents = [], risk, requiredLevels = [], requiredSources = [] } = {}) {
  const reasons = [];
  if (intents.length > 0) reasons.push(`Intent requires context: ${intents.join(', ')}.`);
  if (risk) reasons.push(`Risk level ${risk} drives depth ${requiredLevels.join(', ') || 'none'}.`);
  if (requiredSources.includes('rag')) reasons.push('RAG is required as evidence and gap probe.');
  if (requiredSources.includes('relationships')) reasons.push('Relationships may affect NPC consistency and adjudication.');
  if (requiredSources.includes('factions')) reasons.push('Faction membership/pressure may affect motives and consequences.');
  return reasons;
}

function buildMissingReport({ actorContext, rag, requiredSources }) {
  const actors = Object.fromEntries(Object.entries(actorContext).map(([actorId, actor]) => [
    actorId,
    {
      missingLevels: actor.missingLevels || [],
      loadedLevels: actor.loadedLevels || [],
      sufficiency: actor.sufficiency,
      reason: actor.reason
    }
  ]));
  const missingActors = Object.entries(actors).filter(([, actor]) => actor.missingLevels.length > 0)
    .map(([actorId]) => actorId);
  const ragMissing = requiredSources.includes('rag') && (!rag.searched || rag.totalHits === 0);
  return {
    actors,
    missingActors,
    rag: {
      required: requiredSources.includes('rag'),
      searched: rag.searched,
      totalHits: rag.totalHits,
      missing: ragMissing
    },
    totalMissingLevels: Object.values(actors).reduce((sum, actor) => sum + actor.missingLevels.length, 0)
  };
}

function buildMissingAwareness({ request, actorContext, rag, missing, missingPolicy }) {
  const nextRetrievalActions = [];
  for (const [actorId, actor] of Object.entries(actorContext)) {
    for (const level of actor.missingLevels || []) {
      nextRetrievalActions.push({
        actorId,
        missing: level,
        tool: level === 'L0' ? 'system.npc_registry.get_npc' : 'system.npc_profiles.get_profile_bundle',
        suggestedInput: level === 'L0'
          ? { id: actorId }
          : { npcId: actorId, levels: [level] },
        reason: `Required ${level} was not available for ${actorId}.`
      });
    }
  }
  if (missing.rag.missing) {
    nextRetrievalActions.push({
      missing: 'RAG',
      tool: 'system.rag_permanent.search',
      suggestedInput: { query: request.query, limit: request.ragLimit },
      reason: 'RAG was required but returned no hits.'
    });
  }
  return {
    policy: missingPolicy || 'report_only',
    summary: missing.totalMissingLevels === 0 && !missing.rag.missing
      ? 'Required context layers are available enough for this turn.'
      : 'Some required context layers are missing. LLM should avoid inventing stable facts and should use nextRetrievalActions or ask the user when needed.',
    ragGapHints: [
      rag.searched ? `RAG searched with ${rag.totalHits} hit(s).` : 'RAG was not searched.',
      ...(rag.warnings || [])
    ],
    nextRetrievalActions,
    promptHint: [
      'If context is insufficient, do not silently invent permanent facts.',
      'Use loaded L0/L1/L2/L3 and RAG evidence first.',
      'For missing major/key actor layers, ask user or generate ephemeral chat-local assumptions only when policy allows.'
    ].join(' ')
  };
}

function summarizeSufficiency(missing) {
  if (missing.totalMissingLevels === 0 && !missing.rag.missing) return 'enough';
  if (missing.totalMissingLevels > 0) return 'insufficient';
  return 'enough_with_warnings';
}

function renderContextPackage({ request, assessment, actorContext, rag, contextPlanner, missingAwareness }) {
  return [
    `<AI_DND_CONTEXT_COMPLETENESS id="${request.planId}">`,
    '## Need Assessment',
    JSON.stringify({
      intents: assessment.intents,
      risk: assessment.risk,
      requiredLevels: assessment.requiredLevels,
      requiredSources: assessment.requiredSources,
      reasons: assessment.reasons
    }, null, 2),
    '',
    '## Loaded Actor Context',
    JSON.stringify(actorContext, null, 2),
    '',
    '## RAG Gap Probe',
    JSON.stringify(rag, null, 2),
    '',
    '## Missing Awareness',
    JSON.stringify(missingAwareness, null, 2),
    '',
    contextPlanner.promptContext ? '## Budgeted Prompt Context' : '',
    contextPlanner.promptContext || '',
    '</AI_DND_CONTEXT_COMPLETENESS>'
  ].filter((line) => line !== '').join('\n');
}

function inferIntents(query) {
  const text = normalizeOptionalText(query).toLowerCase();
  const intents = [];
  if (/(说服|劝|谈判|求婚|欺骗|威胁|恐吓|persuad|convince|deceive|intimidat)/i.test(text)) intents.push('persuasion');
  if (/(背叛|叛变|自杀|刺杀|阵营|势力|faction|betray)/i.test(text)) intents.push('npc_behavior');
  if (/(攻击|战斗|施法|格挡|闪避|combat|attack|fight)/i.test(text)) intents.push('combat_action');
  if (/(前往|移动|进入|离开|寻路|move|travel|go to)/i.test(text)) intents.push('movement');
  if (/(调查|观察|查看|搜索|检查|investigate|search|inspect)/i.test(text)) intents.push('observation');
  if (/(世界|历史|传说|设定|world|lore|history)/i.test(text)) intents.push('world_lore');
  return intents.length > 0 ? intents : ['player_action'];
}

function inferRisk(query) {
  const text = normalizeOptionalText(query).toLowerCase();
  if (/(世界线|永久|毁灭|灭国|杀死|死亡|复活|叛变|自杀|刺杀|worldline|permanent|kill|death)/i.test(text)) return 'high';
  if (/(战斗|说服|欺骗|威胁|阵营|combat|persuad|faction)/i.test(text)) return 'medium';
  return 'low';
}

function normalizeIntentList(value) {
  const raw = normalizeStringArray(value);
  const normalized = raw.map((intent) => normalizeIntent(intent)).filter(Boolean);
  return uniqueStrings(normalized.length > 0 ? normalized : ['player_action']);
}

function normalizeIntent(intent) {
  const compact = normalizeOptionalText(intent).toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fff]+/g, '_');
  const aliases = {
    chat: 'casual_chat',
    social: 'social_action',
    persuade: 'persuasion',
    persuasion_check: 'persuasion',
    convince: 'persuasion',
    deceive: 'deception',
    intimidate: 'intimidation',
    npc: 'npc_behavior',
    faction: 'faction_impact',
    combat: 'combat_action',
    special_combat: 'combat_special',
    action: 'player_action',
    lore: 'world_lore'
  };
  return aliases[compact] || (INTENT_RULES[compact] ? compact : compact || 'player_action');
}

function normalizeRisk(value) {
  const compact = normalizeOptionalText(value).toLowerCase();
  if (['none', 'safe'].includes(compact)) return 'none';
  if (['low', 'minor', 'small'].includes(compact)) return 'low';
  if (['medium', 'moderate', 'normal'].includes(compact)) return 'medium';
  if (['high', 'major', 'dangerous', 'severe'].includes(compact)) return 'high';
  if (['permanent', 'irreversible'].includes(compact)) return 'permanent';
  if (['worldline', 'timeline'].includes(compact)) return 'worldline';
  return '';
}

function strongestRisk(values = []) {
  return values
    .map((value) => normalizeRisk(value))
    .filter(Boolean)
    .sort((a, b) => riskWeight(b) - riskWeight(a))[0] || 'medium';
}

function riskWeight(risk) {
  return RISK_WEIGHT[normalizeRisk(risk) || risk] ?? RISK_WEIGHT.medium;
}

function normalizeLevels(value) {
  const output = [];
  for (const item of normalizeStringArray(value)) {
    const normalized = String(item).trim().toUpperCase();
    if (['0', 'LEVEL0', 'LEVEL_0'].includes(normalized)) output.push('L0');
    else if (['1', 'LEVEL1', 'LEVEL_1'].includes(normalized)) output.push('L1');
    else if (['2', 'LEVEL2', 'LEVEL_2'].includes(normalized)) output.push('L2');
    else if (['3', 'LEVEL3', 'LEVEL_3'].includes(normalized)) output.push('L3');
    else if (['L0', 'L1', 'L2', 'L3'].includes(normalized)) output.push(normalized);
  }
  return uniqueStrings(output).sort(profileLevelCompare);
}

function profileLevelCompare(a, b) {
  return profileLevelWeight(a) - profileLevelWeight(b);
}

function profileLevelWeight(level) {
  const index = ['L0', 'L1', 'L2', 'L3'].indexOf(String(level || '').toUpperCase());
  return index === -1 ? 99 : index;
}

function normalizeMissingPolicy(value) {
  const policy = normalizeOptionalText(value || CONTEXT_COMPLETENESS_POLICY.defaultMissingPolicy);
  return CONTEXT_COMPLETENESS_POLICY.missingPolicies.includes(policy) ? policy : CONTEXT_COMPLETENESS_POLICY.defaultMissingPolicy;
}

function extractRecords(output) {
  if (!output) return [];
  if (Array.isArray(output)) return output;
  if (Array.isArray(output.records)) return output.records;
  if (Array.isArray(output.items)) return output.items;
  if (Array.isArray(output.states)) return output.states;
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

function compactRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const data = record.data && typeof record.data === 'object' ? record.data : record;
  return pruneLargeValues({
    id: record.id || data.id,
    collection: record.collection,
    data: {
      name: data.name,
      npcId: data.npcId,
      actorType: data.actorType,
      role: data.role,
      importance: data.importance,
      level: data.level,
      title: data.title,
      profileType: data.profileType,
      status: data.status,
      visibility: data.visibility,
      summary: data.summary,
      content: data.content,
      sections: data.sections,
      characterCard: data.characterCard,
      worldInfo: data.worldInfo,
      relationships: data.relationships,
      memories: data.memories,
      values: data.values || data.numericValues,
      statusBar: data.statusBar,
      specialStatuses: data.specialStatuses || data.statuses,
      inventory: data.inventory,
      equipment: data.equipment,
      tags: data.tags,
      metadata: data.metadata
    }
  });
}

function compactRagHit(hit) {
  const compact = hit.compact && typeof hit.compact === 'object' ? hit.compact : undefined;
  return pruneLargeValues({
    id: hit.id || hit.sourceId || hit.metadata?.sourceId,
    score: hit.score,
    text: compact?.claim || compact?.text || hit.text || hit.content,
    metadata: compact?.metadata || hit.metadata,
    sourceRef: compact?.sourceRef || hit.sourceRef,
    scores: hit.scores
  });
}

function summarizeToolOutput(output) {
  if (!output || typeof output !== 'object') return { type: typeof output };
  return {
    keys: Object.keys(output).slice(0, 12),
    recordCount: extractRecords(output).length,
    hitCount: extractHits(output).length
  };
}

function pruneLargeValues(value, depth = 0) {
  if (depth > 5) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => pruneLargeValues(entry, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    .slice(0, 50)
    .map(([key, entry]) => [
      key,
      typeof entry === 'string' && entry.length > 1600
        ? `${entry.slice(0, 1600)}...[truncated]`
        : pruneLargeValues(entry, depth + 1)
    ]));
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeStringArray(item));
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
