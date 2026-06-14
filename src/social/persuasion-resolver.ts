// @ts-nocheck
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createId, nowIso } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const PERSUASION_TRACE_DIR = 'data/persuasion-traces';

export const PERSUASION_JUDGEMENT_TEMPLATE = {
  judgementId: 'persuasion_judgement_debug_template',
  status: 'judged | needsMoreContext | needsLlm | notEvaluated',
  targetNpcId: 'npc_target',
  speakerId: 'pc_or_npc_speaker',
  approachSummary: 'What the speaker is trying to make the target believe or do.',
  reasoningQuality: 'none | poor | weak | fair | strong | excellent',
  argumentBonus: 0,
  dcAdjustment: 0,
  confidence: 0.75,
  summary: 'Short explanation of why the player speech helps or hurts.',
  factors: [
    {
      name: 'evidence | empathy | leverage | truth | target_values | risk | delivery | contradiction | offense',
      effect: 'helps | hurts | neutral',
      modifier: 0,
      note: 'Why this factor matters.'
    }
  ],
  targetLikelyReaction: 'How the target is likely to respond if the final check succeeds or fails.',
  stateProposals: [
    {
      target: 'npc_state | npc_relationship | faction | scene',
      when: 'success | failure | criticalSuccess | criticalFailure | always',
      summary: 'Suggested state change for another tool to apply later.'
    }
  ],
  narrationHints: {
    success: 'How to narrate a convincing result.',
    failure: 'How to narrate rejection without freezing the scene.'
  },
  metadata: {}
};

export class PersuasionTraceRecorder {
  constructor({
    enabled = true,
    directory = PERSUASION_TRACE_DIR,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    this.enabled = enabled;
    this.directory = directory === null ? null : resolve(cwd, directory);
    this.now = now;
    if (this.enabled && this.directory) mkdirSync(this.directory, { recursive: true });
  }

  start(operation, { input } = {}) {
    if (!this.enabled || !this.directory) return undefined;
    const traceId = createId('persuasiontrace');
    const startedAt = this.now();
    const traceDirectory = resolve(
      this.directory,
      startedAt.slice(0, 10),
      `${safePathSegment(startedAt)}_${safePathSegment(traceId)}_${safePathSegment(operation)}`
    );
    mkdirSync(traceDirectory, { recursive: true });
    const trace = {
      traceId,
      operation,
      startedAt,
      directory: traceDirectory,
      files: {
        input: resolve(traceDirectory, 'input.json'),
        context: resolve(traceDirectory, 'context.json'),
        prompt: resolve(traceDirectory, 'prompt.txt'),
        judgement: resolve(traceDirectory, 'judgement.json'),
        dice: resolve(traceDirectory, 'dice-result.json'),
        resolution: resolve(traceDirectory, 'resolution.json'),
        output: resolve(traceDirectory, 'output.json'),
        error: resolve(traceDirectory, 'error.json'),
        summary: resolve(traceDirectory, 'summary.json')
      }
    };
    writeJson(trace.files.input, { traceId, operation, input });
    writeJson(trace.files.summary, {
      traceId,
      operation,
      status: 'started',
      startedAt,
      directory: traceDirectory,
      files: {
        input: trace.files.input,
        summary: trace.files.summary
      }
    });
    return trace;
  }

  write(trace, name, value) {
    if (!trace || !trace.files[name]) return undefined;
    if (name === 'prompt') {
      writeFileSync(trace.files[name], String(value || ''));
    } else {
      writeJson(trace.files[name], value);
    }
    return trace.files[name];
  }

  finish(trace, { output, finishedAt = this.now() } = {}) {
    if (!trace) return undefined;
    this.write(trace, 'output', output);
    const summary = {
      traceId: trace.traceId,
      operation: trace.operation,
      status: 'success',
      startedAt: trace.startedAt,
      finishedAt,
      durationMs: durationMs(trace.startedAt, finishedAt),
      directory: trace.directory,
      files: Object.fromEntries(Object.entries(trace.files).filter(([, filePath]) => existsSync(filePath)))
    };
    writeJson(trace.files.summary, summary);
    return summary;
  }

  fail(trace, { error, finishedAt = this.now() } = {}) {
    if (!trace) return undefined;
    this.write(trace, 'error', { error: serializeError(error) });
    const summary = {
      traceId: trace.traceId,
      operation: trace.operation,
      status: 'error',
      startedAt: trace.startedAt,
      finishedAt,
      durationMs: durationMs(trace.startedAt, finishedAt),
      directory: trace.directory,
      files: Object.fromEntries(Object.entries(trace.files).filter(([, filePath]) => existsSync(filePath)))
    };
    writeJson(trace.files.summary, summary);
    return summary;
  }
}

export class PersuasionResolver {
  constructor({
    toolManager,
    chatProvider,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    if (!toolManager) throw validationError('PersuasionResolver requires toolManager');
    this.toolManager = toolManager;
    this.chatProvider = chatProvider;
    this.now = now;
    this.traceRecorder = traceRecorder || new PersuasionTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      cwd,
      now
    });
  }

  describe() {
    return {
      llmPurpose: 'Judge the player-provided persuasion speech/reasoning in context, not the dice roll.',
      mutatesState: false,
      diceTool: 'game.dice.check',
      defaultThreshold: 15,
      scoring: {
        argumentBonus: 'integer -10..10 added to the dice total after the roll',
        dcAdjustment: 'integer -10..10 added to the base success threshold',
        defaultCriticalPolicy: 'argumentCanOverride'
      },
      workflow: [
        'build_prompt collects context and writes an editable LLM prompt.',
        'judge_argument asks an LLM, or normalizes a supplied judgement, into argumentBonus and dcAdjustment.',
        'resolve rolls or accepts diceResult, then deterministically combines dice total + argumentBonus against threshold + dcAdjustment.',
        'The resolver only returns judgement, outcome, narration hints, and state proposals. It does not write NPC/faction state.'
      ],
      judgementShape: PERSUASION_JUDGEMENT_TEMPLATE
    };
  }

  async buildPrompt(input = {}) {
    const trace = this.traceRecorder.start('persuasion-build-prompt', { input: sanitizeInput(input) });
    try {
      const context = input.context || await this.collectContext(input);
      const prompt = buildPersuasionPrompt({ ...input, context });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'prompt', prompt);
      const output = {
        prompt,
        context,
        judgementShape: PERSUASION_JUDGEMENT_TEMPLATE,
        trace: this.traceRecorder.finish(trace, {
          output: {
            promptChars: prompt.length,
            contextSources: Object.keys(context.sources || {})
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async judgeArgument(input = {}) {
    const trace = this.traceRecorder.start('persuasion-judge-argument', { input: sanitizeInput(input) });
    try {
      const context = input.context || await this.collectContext(input);
      const prompt = buildPersuasionPrompt({ ...input, context });
      const rawJudgement = input.judgement || input.persuasionJudgement || await this.createJudgement(input, prompt);
      const judgement = normalizePersuasionJudgement(rawJudgement, input);
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'prompt', prompt);
      this.traceRecorder.write(trace, 'judgement', judgement);
      const output = {
        judgement,
        rawJudgement,
        prompt,
        context,
        trace: this.traceRecorder.finish(trace, {
          output: {
            judgementId: judgement.judgementId,
            argumentBonus: judgement.argumentBonus,
            dcAdjustment: judgement.dcAdjustment,
            status: judgement.status
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async resolve(input = {}) {
    const trace = this.traceRecorder.start('persuasion-resolve', { input: sanitizeInput(input) });
    try {
      const judged = input.judgement || input.persuasionJudgement
        ? {
          judgement: normalizePersuasionJudgement(input.judgement || input.persuasionJudgement, input),
          rawJudgement: input.judgement || input.persuasionJudgement,
          prompt: '',
          context: input.context || await this.collectContext(input)
        }
        : await this.judgeArgument(input);
      const dice = await this.resolveDice(input);
      const resolution = combinePersuasionResult({
        ...input,
        judgement: judged.judgement,
        diceResult: dice?.output || dice
      });
      this.traceRecorder.write(trace, 'context', judged.context);
      this.traceRecorder.write(trace, 'prompt', judged.prompt);
      this.traceRecorder.write(trace, 'judgement', judged.judgement);
      this.traceRecorder.write(trace, 'dice', dice);
      this.traceRecorder.write(trace, 'resolution', resolution);
      const output = {
        status: resolution.outcome,
        outcome: resolution.outcome,
        success: resolution.success,
        failure: resolution.failure,
        judgement: judged.judgement,
        dice,
        resolution,
        prompt: judged.prompt,
        context: judged.context,
        trace: this.traceRecorder.finish(trace, {
          output: {
            outcome: resolution.outcome,
            effectiveTotal: resolution.effectiveTotal,
            effectiveThreshold: resolution.effectiveThreshold,
            argumentBonus: resolution.argumentBonus,
            dcAdjustment: resolution.dcAdjustment
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async combine(input = {}) {
    const trace = this.traceRecorder.start('persuasion-combine', { input: sanitizeInput(input) });
    try {
      const judgement = normalizePersuasionJudgement(input.judgement || input.persuasionJudgement || {}, input);
      const resolution = combinePersuasionResult({
        ...input,
        judgement,
        diceResult: input.diceResult || input.rollResult || input.dice
      });
      this.traceRecorder.write(trace, 'judgement', judgement);
      this.traceRecorder.write(trace, 'dice', input.diceResult || input.rollResult || input.dice);
      this.traceRecorder.write(trace, 'resolution', resolution);
      return {
        resolution,
        trace: this.traceRecorder.finish(trace, { output: resolution })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async collectContext(input = {}) {
    const chatSessionId = normalizeOptionalText(input.chatSessionId);
    const sceneId = normalizeOptionalText(input.sceneId) || 'current';
    const targetNpcId = normalizeOptionalText(input.targetNpcId || input.npcId || input.targetId || input.target?.npcId || input.target?.id);
    const speakerId = normalizeOptionalText(input.speakerId || input.speakerNpcId || input.actorId || input.playerId || input.speaker?.npcId || input.speaker?.id);
    const query = normalizeOptionalText(input.query || input.ragQuery || input.sourceText || input.text || input.content || input.playerSpeech || input.argument);
    const context = {
      chatSessionId,
      sceneId,
      targetNpcId,
      speakerId,
      query,
      collectedAt: this.now(),
      sources: {},
      errors: []
    };
    if (input.includeContext === false) return context;

    if (chatSessionId) {
      for (const [key, tool, toolInput] of [
        ['sceneNpcs', 'system.scene_npcs.list_mounted_npcs', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
        ['npcStates', 'system.npc_state.list_states', { chatSessionId, sceneId, limit: 100 }],
        ['characterMemory', 'system.character_memory.get_prompt_context', { chatSessionId, sceneId, maxContextTokens: 1600 }]
      ]) {
        const result = await safeExecuteTool(this.toolManager, tool, toolInput);
        if (result.ok) context.sources[key] = result.output;
        else context.errors.push({ key, tool, error: result.error });
      }
      if (targetNpcId) {
        const result = await safeExecuteTool(this.toolManager, 'system.npc_state.get_state', { chatSessionId, sceneId, npcId: targetNpcId });
        if (result.ok) context.sources.targetState = result.output;
        else context.errors.push({ key: 'targetState', tool: 'system.npc_state.get_state', error: result.error });
      }
      if (speakerId) {
        const result = await safeExecuteTool(this.toolManager, 'system.npc_state.get_state', { chatSessionId, sceneId, npcId: speakerId });
        if (result.ok) context.sources.speakerState = result.output;
        else context.errors.push({ key: 'speakerState', tool: 'system.npc_state.get_state', error: result.error });
      }
    }

    if (targetNpcId) {
      for (const [key, tool, toolInput] of [
        ['targetRelationships', 'system.npc_relationships.list_edges', { npcId: targetNpcId, includeIncoming: true, includeOutgoing: true, limit: 80 }],
        ['targetFactions', 'system.factions.get_actor_factions', { actorId: targetNpcId, npcId: targetNpcId, includeHidden: true, limit: 50 }]
      ]) {
        const result = await safeExecuteTool(this.toolManager, tool, toolInput);
        if (result.ok) context.sources[key] = result.output;
        else context.errors.push({ key, tool, error: result.error });
      }
    }
    if (speakerId) {
      const result = await safeExecuteTool(this.toolManager, 'system.factions.get_actor_factions', {
        actorId: speakerId,
        npcId: speakerId,
        includeHidden: true,
        limit: 50
      });
      if (result.ok) context.sources.speakerFactions = result.output;
      else context.errors.push({ key: 'speakerFactions', tool: 'system.factions.get_actor_factions', error: result.error });
    }

    if (input.includeRag && query) {
      for (const [key, tool] of [
        ['permanentRag', 'system.rag_permanent.search'],
        ['runtimeRag', 'system.rag_runtime.search']
      ]) {
        const result = await safeExecuteTool(this.toolManager, tool, {
          query,
          collection: input.ragCollection,
          limit: input.ragLimit || 5,
          filter: input.ragFilter
        });
        if (result.ok) context.sources[key] = result.output;
        else context.errors.push({ key, tool, error: result.error });
      }
    }

    return context;
  }

  async createJudgement(input, prompt) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('Persuasion judgement requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one persuasion judgement JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0.2,
        maxTokens: input.maxTokens || 2000
      });
      return parseJsonObject(completion.content);
    }
    const playerSpeech = normalizeOptionalText(input.playerSpeech || input.speech || input.argument || input.personalPersuasion || input.directSpeech);
    return {
      ...PERSUASION_JUDGEMENT_TEMPLATE,
      judgementId: createId('persuasion'),
      status: playerSpeech ? 'needsLlm' : 'judged',
      targetNpcId: normalizeOptionalText(input.targetNpcId || input.npcId || input.targetId),
      speakerId: normalizeOptionalText(input.speakerId || input.speakerNpcId || input.actorId || input.playerId),
      reasoningQuality: playerSpeech ? 'notEvaluated' : 'none',
      argumentBonus: 0,
      dcAdjustment: 0,
      confidence: playerSpeech ? 0 : 1,
      summary: playerSpeech
        ? 'Player speech was supplied, but no LLM judgement or manual judgement was provided. Treating it as neutral until judged.'
        : 'No direct player speech supplied; resolve with dice and existing modifiers only.',
      factors: [],
      stateProposals: [],
      narrationHints: {},
      metadata: {
        source: 'template'
      }
    };
  }

  async resolveDice(input = {}) {
    if (input.diceResult || input.rollResult) return normalizeDiceResult(input.diceResult || input.rollResult);
    if (input.rollDice === false) return undefined;
    const diceInput = buildDiceInput(input);
    const result = await this.toolManager.executeTool('game.dice.check', diceInput);
    return {
      input: diceInput,
      output: normalizeDiceResult(result.output),
      trace: result.trace
    };
  }
}

export function buildPersuasionPrompt({
  sourceText = '',
  text,
  content,
  targetNpcId,
  npcId,
  targetId,
  speakerId,
  speakerNpcId,
  actorId,
  playerId,
  playerSpeech,
  speech,
  argument,
  personalPersuasion,
  directSpeech,
  desiredOutcome = '',
  stakes = '',
  baseThreshold,
  successThreshold,
  dc,
  context = {},
  userRules = '',
  persuasionPrompt = '',
  includeDiceInPrompt = false,
  diceResult,
  judgementTemplate = PERSUASION_JUDGEMENT_TEMPLATE
} = {}) {
  const attemptText = normalizeOptionalText(sourceText || text || content);
  const direct = normalizeOptionalText(playerSpeech || speech || argument || personalPersuasion || directSpeech);
  const threshold = normalizeInteger(successThreshold ?? dc ?? baseThreshold ?? 15, 'successThreshold');
  return [
    persuasionPrompt || [
      'You judge persuasion for an interactive text RPG.',
      'The player-provided speech/reasoning is more trustworthy than raw dice luck when it is concrete, context-aware, and aligned with the target NPC.',
      'Do not roll dice. Do not decide the final outcome by yourself. You only judge the argument and context into modifiers.',
      'If no direct player speech is supplied, set argumentBonus=0 and reasoningQuality="none".',
      'Reward strong reasoning, true evidence, empathy for the target, credible leverage, fitting tone, and low-risk asks.',
      'Penalize contradictions, lies that the target can easily detect, insulting delivery, ignoring known values, unsafe asks, taboo violations, or pressure that would backfire.',
      'Use integer argumentBonus from -10 to 10. Excellent reasoning can be worth more than a mediocre roll; disastrous speech can ruin a lucky roll.',
      'Use integer dcAdjustment from -10 to 10 for contextual difficulty only: positive means harder, negative means easier.',
      'Return JSON only.'
    ].join('\n'),
    userRules ? `User/table persuasion rules:\n${userRules}` : '',
    `Base success threshold before your dcAdjustment: ${threshold}`,
    'Persuasion attempt summary:',
    attemptText,
    'Direct player speech / player argument, if any:',
    direct || '[none supplied]',
    'Speaker / target:',
    JSON.stringify({
      speakerId: normalizeOptionalText(speakerId || speakerNpcId || actorId || playerId),
      targetNpcId: normalizeOptionalText(targetNpcId || npcId || targetId)
    }, null, 2),
    desiredOutcome ? `Desired outcome:\n${desiredOutcome}` : '',
    stakes ? `Stakes / consequences:\n${stakes}` : '',
    includeDiceInPrompt && diceResult ? `Dice result already known, for reference only:\n${JSON.stringify(diceResult, null, 2)}` : '',
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one persuasion judgement JSON object. Use this shape as a debug reference, not as a fixed rules database:',
    JSON.stringify(judgementTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function combinePersuasionResult(input = {}) {
  const judgement = normalizePersuasionJudgement(input.judgement || input.persuasionJudgement || {}, input);
  const diceResult = input.diceResult ? normalizeDiceResult(input.diceResult) : undefined;
  if (!diceResult) throw validationError('diceResult is required to combine persuasion result');
  const baseThreshold = normalizeInteger(
    input.successThreshold ?? input.dc ?? input.baseThreshold ?? input.diceInput?.successThreshold ?? diceResult.successThreshold ?? 15,
    'successThreshold'
  );
  const argumentBonus = clampInteger(judgement.argumentBonus, -10, 10);
  const dcAdjustment = clampInteger(judgement.dcAdjustment, -10, 10);
  const effectiveThreshold = baseThreshold + dcAdjustment;
  const effectiveTotal = normalizeNumber(diceResult.total, 'diceResult.total') + argumentBonus;
  const margin = effectiveTotal - effectiveThreshold;
  const criticalPolicy = normalizeOptionalText(input.criticalPolicy || 'argumentCanOverride');
  const strongArgument = argumentBonus >= 6 || judgement.reasoningQuality === 'excellent';
  const badArgument = argumentBonus <= -6 || judgement.reasoningQuality === 'poor';
  let outcome;

  if (criticalPolicy === 'diceLocked') {
    outcome = diceResult.criticalSuccess ? 'criticalSuccess'
      : diceResult.criticalFailure ? 'criticalFailure'
        : margin >= 0 ? 'success' : 'failure';
  } else if (diceResult.criticalSuccess && margin >= 0 && !badArgument) {
    outcome = 'criticalSuccess';
  } else if (diceResult.criticalFailure && margin < 0 && !strongArgument) {
    outcome = 'criticalFailure';
  } else if (margin >= 0) {
    outcome = margin >= 10 && strongArgument ? 'criticalSuccess' : 'success';
  } else {
    outcome = margin <= -10 && badArgument ? 'criticalFailure' : 'failure';
  }

  const success = outcome === 'success' || outcome === 'criticalSuccess';
  const nearMiss = !success && margin >= -2;
  const costlySuccess = success && margin <= 2;
  return {
    outcome,
    success,
    failure: !success,
    criticalSuccess: outcome === 'criticalSuccess',
    criticalFailure: outcome === 'criticalFailure',
    baseThreshold,
    dcAdjustment,
    effectiveThreshold,
    diceTotal: diceResult.total,
    argumentBonus,
    effectiveTotal,
    margin,
    diceOutcome: diceResult.outcome,
    diceCriticalSuccess: Boolean(diceResult.criticalSuccess),
    diceCriticalFailure: Boolean(diceResult.criticalFailure),
    criticalPolicy,
    nearMiss,
    costlySuccess,
    reasoningQuality: judgement.reasoningQuality,
    judgementSummary: judgement.summary,
    targetLikelyReaction: judgement.targetLikelyReaction,
    stateProposals: selectStateProposals(judgement.stateProposals, outcome),
    narrationHints: {
      ...(judgement.narrationHints || {}),
      selected: selectNarrationHint(judgement.narrationHints, outcome)
    },
    metadata: {
      judgementId: judgement.judgementId
    }
  };
}

function buildDiceInput(input = {}) {
  const base = normalizeObject(input.diceInput);
  return removeUndefined({
    successThreshold: normalizeInteger(input.successThreshold ?? input.dc ?? input.baseThreshold ?? base.successThreshold ?? 15, 'successThreshold'),
    diceCount: normalizeInteger(input.diceCount ?? input.rollCount ?? base.diceCount ?? base.rollCount ?? 1, 'diceCount'),
    diceSides: normalizeInteger(input.diceSides ?? input.sides ?? base.diceSides ?? base.sides ?? 20, 'diceSides'),
    modifier: normalizeInteger(input.modifier ?? input.fixedModifier ?? base.modifier ?? base.fixedModifier ?? 0, 'modifier'),
    buff: input.buff ?? base.buff,
    debuff: input.debuff ?? base.debuff,
    abilityModifier: input.abilityModifier ?? base.abilityModifier,
    proficiencyBonus: input.proficiencyBonus ?? base.proficiencyBonus,
    modifiers: input.modifiers ?? base.modifiers,
    forceMode: input.forceMode ?? base.forceMode,
    rollMode: input.rollMode ?? base.rollMode,
    inspirationPoints: input.inspirationPoints ?? base.inspirationPoints,
    criticalMode: input.criticalMode ?? base.criticalMode ?? 'd20'
  });
}

function normalizePersuasionJudgement(input = {}, source = {}) {
  const object = normalizeObject(input);
  const targetNpcId = normalizeOptionalText(object.targetNpcId || source.targetNpcId || source.npcId || source.targetId);
  const speakerId = normalizeOptionalText(object.speakerId || source.speakerId || source.speakerNpcId || source.actorId || source.playerId);
  return {
    judgementId: normalizeOptionalText(object.judgementId || object.id) || createId('persuasion'),
    status: normalizeOptionalText(object.status) || 'judged',
    targetNpcId,
    speakerId,
    approachSummary: normalizeOptionalText(object.approachSummary || object.summary || source.sourceText || source.text || source.content),
    reasoningQuality: normalizeOptionalText(object.reasoningQuality || object.quality) || 'notEvaluated',
    argumentBonus: clampInteger(object.argumentBonus ?? object.bonus ?? object.modifier ?? 0, -10, 10),
    dcAdjustment: clampInteger(object.dcAdjustment ?? object.thresholdAdjustment ?? object.dcModifier ?? 0, -10, 10),
    confidence: clampNumber(object.confidence ?? 0.5, 0, 1),
    summary: normalizeOptionalText(object.summary || object.reason || object.rationale),
    factors: normalizeArray(object.factors).map(normalizeFactor),
    targetLikelyReaction: normalizeOptionalText(object.targetLikelyReaction || object.reaction),
    stateProposals: normalizeArray(object.stateProposals || object.proposals).map(normalizeStateProposal),
    narrationHints: normalizeObject(object.narrationHints || object.narration),
    metadata: normalizeObject(object.metadata)
  };
}

function normalizeFactor(input = {}) {
  const object = normalizeObject(input);
  return {
    name: normalizeOptionalText(object.name || object.factor) || 'factor',
    effect: normalizeOptionalText(object.effect || object.impact) || 'neutral',
    modifier: clampInteger(object.modifier ?? object.value ?? 0, -10, 10),
    note: normalizeOptionalText(object.note || object.reason || object.summary)
  };
}

function normalizeStateProposal(input = {}) {
  const object = normalizeObject(input);
  return {
    ...object,
    target: normalizeOptionalText(object.target || object.tool || object.kind),
    when: normalizeArray(object.when || 'always').map((item) => normalizeOptionalText(item)).filter(Boolean),
    summary: normalizeOptionalText(object.summary || object.description || object.reason)
  };
}

function normalizeDiceResult(input = {}) {
  const object = normalizeObject(input.output || input);
  const outcome = normalizeOptionalText(object.outcome) || (object.success ? 'success' : 'failure');
  return {
    ...object,
    outcome,
    success: object.success ?? (outcome === 'success' || outcome === 'criticalSuccess'),
    failure: object.failure ?? (outcome === 'failure' || outcome === 'criticalFailure'),
    criticalSuccess: object.criticalSuccess ?? (outcome === 'criticalSuccess'),
    criticalFailure: object.criticalFailure ?? (outcome === 'criticalFailure'),
    total: normalizeNumber(object.total ?? object.effectiveTotal, 'diceResult.total'),
    successThreshold: object.successThreshold === undefined ? undefined : normalizeNumber(object.successThreshold, 'diceResult.successThreshold')
  };
}

function selectStateProposals(proposals = [], outcome) {
  return normalizeArray(proposals).filter((proposal) => {
    const when = normalizeArray(proposal.when || 'always').map((item) => normalizeOptionalText(item));
    return when.includes('always') || when.includes(outcome) || (isSuccessOutcome(outcome) && when.includes('success')) || (!isSuccessOutcome(outcome) && when.includes('failure'));
  });
}

function selectNarrationHint(hints = {}, outcome) {
  const object = normalizeObject(hints);
  if (object[outcome]) return object[outcome];
  return isSuccessOutcome(outcome) ? object.success : object.failure;
}

function isSuccessOutcome(outcome) {
  return outcome === 'success' || outcome === 'criticalSuccess';
}

async function safeExecuteTool(toolManager, tool, input) {
  try {
    return {
      ok: true,
      output: (await toolManager.executeTool(tool, removeUndefined(input), undefined, { audit: { skipAudit: true } })).output
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeError(error)
    };
  }
}

function parseJsonObject(content) {
  try {
    return parseFirstJsonObject(content);
  } catch {
    throw validationError('Persuasion judgement did not return a JSON object');
  }
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw validationError(`${field} must be a finite number`);
  return number;
}

function normalizeInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw validationError(`${field} must be an integer`);
  return number;
}

function clampInteger(value, min, max) {
  const number = normalizeInteger(value ?? 0, 'integer');
  return Math.max(min, Math.min(max, number));
}

function clampNumber(value, min, max) {
  const number = normalizeNumber(value ?? 0, 'number');
  return Math.max(min, Math.min(max, number));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'PersuasionResolverValidationError';
  error.statusCode = 400;
  return error;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(sanitizeForJson(value), null, 2)}\n`);
}

function sanitizeInput(input) {
  return sanitizeForJson(input);
}

function sanitizeForJson(value, seen = new WeakSet(), key = '') {
  if (/(authorization|approval|api[_-]?key|token|secret|password|credential)/i.test(key)) return '[REDACTED]';
  if (value === undefined) return '[undefined]';
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return `[Function${value.name ? `:${value.name}` : ''}]`;
  if (value instanceof Error) return serializeError(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForJson(item, seen));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeForJson(entryValue, seen, entryKey)
    ]));
  }
  return String(value);
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode
  };
}

function durationMs(startedAt, finishedAt) {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
}

function safePathSegment(value) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'unknown';
}
