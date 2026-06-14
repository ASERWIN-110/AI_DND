// @ts-nocheck
import { ActionResolver, ActionResolverTraceRecorder, normalizeActionPlan } from './action-resolver.js';
import { createId, nowIso } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const DEFAULT_ENVIRONMENT_BEHAVIOR_ALLOWED_TOOLS = [
  'game.dice.check',
  'system.npc_state.patch_state',
  'system.npc_state.rewrite_state',
  'system.map_state.patch_state',
  'system.scene_maps.patch_mounted_map',
  'system.map_relationships.upsert_node',
  'system.map_relationships.patch_node',
  'system.map_relationships.upsert_edge',
  'system.map_relationships.patch_edge',
  'system.npc_relationships.upsert_node',
  'system.npc_relationships.patch_node',
  'system.npc_relationships.upsert_edge',
  'system.npc_relationships.patch_edge',
  'system.factions.upsert_faction',
  'system.factions.patch_faction',
  'system.factions.upsert_membership',
  'system.factions.patch_membership',
  'system.factions.apply_actor_influence',
  'system.factions.upsert_relation',
  'system.factions.patch_relation',
  'system.time.advance_time',
  'system.time.add_effect',
  'system.time.schedule_event',
  'system.quests.upsert_quest',
  'system.quests.patch_quest',
  'system.quests.add_quest_event',
  'system.encounters.create_encounter',
  'system.encounters.add_event',
  'system.item_registry.upsert_item',
  'system.item_registry.upsert_equipment',
  'system.item_registry.upsert_accessory',
  'system.item_registry.upsert_weapon',
  'system.item_registry.upsert_mount',
  'system.item_registry.upsert_special_item',
  'system.mechanics_registry.upsert_skill',
  'system.mechanics_registry.upsert_status',
  'system.mechanics_registry.upsert_feat',
  'system.data.quantify_text'
];

export const ENVIRONMENT_BEHAVIOR_TEMPLATES = {
  generic: {
    id: 'generic',
    name: 'Generic Environment Behavior Template',
    description: 'Mostly no-op environmental reaction adjudication for prompt-salient scene changes.',
    plannerPrompt: [
      'You adjudicate autonomous environment reactions in an interactive text RPG.',
      'Most turns should produce no independent environment behavior. Only react when the player explicitly changes the environment, the scene already contains hazards, or reference text says this kind of scene is volatile.',
      'Do not treat ordinary description as a new fact. Prefer no action when the trigger is weak.',
      'State impact contract: if the environment reaction changes map state/routes, actor values/status/inventory/resources, NPC/map/faction relationships, quests, encounters, reusable items/skills/statuses/feats, RAG/memory, or extension data, include explicit proposals for the matching tool instead of only narrating it.',
      'Do not execute tools. Return one Environment Behavior Plan JSON object only.'
    ].join('\n'),
    planTemplate: {
      actionId: 'environment_behavior_debug_template',
      sourceText: 'Trigger or scene event.',
      intent: {
        label: 'environment-autonomy',
        summary: 'Whether the environment reacts independently.'
      },
      metadata: {
        environmentBehavior: {
          trigger: {
            type: 'scene_event',
            summary: 'What caused this environmental check.'
          },
          triggerAssessment: {
            finalChance: 0.05,
            threshold: 96,
            matchedTerms: [],
            triggerLikely: false
          },
          environmentActors: [
            {
              id: 'scene_or_map_feature',
              type: 'hazard | structure | weather | crowd | mechanism | ambient',
              pressure: 'Why it might react.',
              severity: 'none | low | medium | high'
            }
          ]
        }
      },
      checks: [],
      proposals: [],
      narrationHints: {
        noTrigger: 'No independent environment behavior is needed.'
      }
    }
  },
  hazard: {
    id: 'hazard',
    name: 'Hazard / Destruction Environment Template',
    description: 'Use when the player clearly mentions explosion, fire, collapse, flooding, poison gas, traps, or other scene hazards.',
    plannerPrompt: [
      'Focus on concrete environmental consequences: hazards, blocked exits, smoke, fire, collapse, flooding, alarms, unstable terrain, or delayed time events.',
      'Still use probability. A clearly described explosion or arson should have high trigger chance; vague atmosphere should remain low.',
      'Never punish mere observation. Consequences should follow an explicit risky action, failed action, existing hazard, or strong reference rule.'
    ].join('\n'),
    planTemplate: {
      actionId: 'environment_hazard_example',
      sourceText: 'The player tries to blow open a locked room.',
      intent: {
        label: 'environment-hazard',
        summary: 'Check whether the room reacts with smoke, debris, alarms, or structural damage.'
      },
      checks: [
        {
          id: 'environment_trigger_check',
          tool: 'game.dice.check',
          input: {
            successThreshold: 51,
            diceCount: 1,
            diceSides: 100,
            modifier: 0
          }
        }
      ],
      proposals: [
        {
          id: 'record_environment_hazard',
          when: 'success',
          tool: 'system.map_state.patch_state',
          input: {
            chatSessionId: '${chatSessionId}',
            sceneId: '${sceneId}',
            mapId: 'current_environment',
            hazards: [
              {
                id: 'hazard_environment_reaction',
                name: 'Environmental Disturbance',
                summary: '${sourceText}',
                intensity: 1
              }
            ],
            values: {
              environmentInstability: 50
            },
            source: 'environment_behavior'
          }
        }
      ],
      narrationHints: {
        success: 'Describe the visible environmental reaction and the immediate tactical consequence.',
        failure: 'The environment does not independently escalate beyond the player action result.'
      }
    }
  }
};

export class EnvironmentBehaviorResolver {
  constructor({
    toolManager,
    chatProvider,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    if (!toolManager) throw validationError('EnvironmentBehaviorResolver requires toolManager');
    this.toolManager = toolManager;
    this.chatProvider = chatProvider;
    this.now = now;
    this.traceRecorder = traceRecorder || new ActionResolverTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/environment-behavior-traces',
      cwd,
      now
    });
    this.actionResolver = new ActionResolver({
      toolManager,
      chatProvider,
      trace,
      cwd,
      now
    });
  }

  describe() {
    return {
      defaultAllowedTools: DEFAULT_ENVIRONMENT_BEHAVIOR_ALLOWED_TOOLS,
      templates: ENVIRONMENT_BEHAVIOR_TEMPLATES,
      planShape: ENVIRONMENT_BEHAVIOR_TEMPLATES.generic.planTemplate,
      flow: [
        'collect scene/map/time/encounter context',
        'assess prompt salience and reference-text weighting',
        'build editable environment behavior prompt',
        'generate or accept a behavior plan',
        'apply through the existing ActionResolver executor with dryRun=true by default'
      ],
      policy: {
        defaultBehavior: 'mostly_noop',
        triggerCheck: 'Checks should run when configured, but independent environmental escalation should remain unlikely unless the player or reference text makes it salient.',
        narrativeBoundary: 'This module plans and applies state changes before narrative.render. Narrative should describe results, not invent uncommitted environmental facts.'
      }
    };
  }

  async buildPrompt(input = {}) {
    const trace = this.traceRecorder.start('environment-behavior-build-prompt', { input: sanitizeInput(input) });
    try {
      const context = await this.collectContext(input);
      const template = selectTemplate(input.templateId);
      const triggerAssessment = assessEnvironmentTrigger({
        ...input,
        context
      });
      const prompt = buildEnvironmentBehaviorPrompt({
        ...input,
        context,
        template,
        plannerPrompt: input.plannerPrompt,
        triggerAssessment
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'triggerAssessment', triggerAssessment);
      this.traceRecorder.write(trace, 'plannerPrompt', prompt);
      const output = {
        prompt,
        context,
        template,
        triggerAssessment,
        trace: this.traceRecorder.finish(trace, {
          output: {
            promptChars: prompt.length,
            triggerChance: triggerAssessment.finalChance,
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

  async plan(input = {}) {
    const trace = this.traceRecorder.start('environment-behavior-plan', { input: sanitizeInput(input) });
    try {
      const context = await this.collectContext(input);
      const template = selectTemplate(input.templateId);
      const triggerAssessment = assessEnvironmentTrigger({
        ...input,
        context
      });
      const prompt = buildEnvironmentBehaviorPrompt({
        ...input,
        context,
        template,
        plannerPrompt: input.plannerPrompt,
        triggerAssessment
      });
      const rawPlan = input.plan || await this.createPlanFromModelOrTemplate(input, prompt, template, triggerAssessment);
      const plan = normalizeEnvironmentBehaviorPlan(rawPlan, {
        sourceText: sourceTextFromInput(input),
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId || 'current',
        trigger: buildTrigger(input),
        triggerAssessment
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'triggerAssessment', triggerAssessment);
      this.traceRecorder.write(trace, 'plannerPrompt', prompt);
      this.traceRecorder.write(trace, 'plan', rawPlan);
      this.traceRecorder.write(trace, 'normalizedPlan', plan);
      const output = {
        plan,
        rawPlan,
        context,
        prompt,
        triggerAssessment,
        trace: this.traceRecorder.finish(trace, {
          output: {
            actionId: plan.actionId,
            checks: plan.checks.length,
            proposals: plan.proposals.length,
            triggerChance: triggerAssessment.finalChance
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async applyPlan(input = {}, { context: externalContext = {} } = {}) {
    const trace = this.traceRecorder.start('environment-behavior-apply-plan', { input: sanitizeInput(input) });
    try {
      const triggerAssessment = input.triggerAssessment || assessEnvironmentTrigger(input);
      const plan = normalizeEnvironmentBehaviorPlan(input.plan || input, {
        sourceText: sourceTextFromInput(input),
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId || 'current',
        trigger: buildTrigger(input),
        triggerAssessment
      });
      const applied = await this.actionResolver.applyPlan({
        ...input,
        plan,
        dryRun: input.dryRun ?? true,
        allowedTools: input.allowedTools || DEFAULT_ENVIRONMENT_BEHAVIOR_ALLOWED_TOOLS
      }, { context: externalContext });
      const output = {
        status: applied.status,
        plan,
        triggerAssessment,
        apply: applied
      };
      this.traceRecorder.write(trace, 'normalizedPlan', plan);
      this.traceRecorder.write(trace, 'triggerAssessment', triggerAssessment);
      this.traceRecorder.write(trace, 'riskReport', applied.riskReport);
      this.traceRecorder.write(trace, 'diceResults', applied.diceResults);
      this.traceRecorder.write(trace, 'appliedToolCalls', applied.appliedToolCalls);
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, { output })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async resolve(input = {}, options = {}) {
    const trace = this.traceRecorder.start('environment-behavior-resolve', { input: sanitizeInput(input) });
    try {
      const planned = input.plan
        ? {
          plan: normalizeEnvironmentBehaviorPlan(input.plan, {
            sourceText: sourceTextFromInput(input),
            chatSessionId: input.chatSessionId,
            sceneId: input.sceneId || 'current',
            trigger: buildTrigger(input),
            triggerAssessment: input.triggerAssessment || assessEnvironmentTrigger(input)
          }),
          context: await this.collectContext(input),
          prompt: '',
          triggerAssessment: input.triggerAssessment || assessEnvironmentTrigger(input)
        }
        : await this.plan(input);
      const applied = await this.applyPlan({
        ...input,
        plan: planned.plan,
        triggerAssessment: planned.triggerAssessment,
        dryRun: input.dryRun ?? true
      }, options);
      this.traceRecorder.write(trace, 'context', planned.context);
      this.traceRecorder.write(trace, 'plannerPrompt', planned.prompt || '');
      this.traceRecorder.write(trace, 'triggerAssessment', planned.triggerAssessment);
      this.traceRecorder.write(trace, 'normalizedPlan', planned.plan);
      this.traceRecorder.write(trace, 'riskReport', applied.apply?.riskReport);
      this.traceRecorder.write(trace, 'diceResults', applied.apply?.diceResults);
      this.traceRecorder.write(trace, 'appliedToolCalls', applied.apply?.appliedToolCalls);
      const output = {
        status: applied.status,
        plan: planned.plan,
        context: planned.context,
        prompt: planned.prompt,
        triggerAssessment: planned.triggerAssessment,
        apply: applied
      };
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, { output })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async collectContext(input = {}) {
    const chatSessionId = normalizeOptionalText(input.chatSessionId);
    const sceneId = normalizeOptionalText(input.sceneId) || 'current';
    const mapId = normalizeOptionalText(input.mapId);
    const query = input.query || input.ragQuery || sourceTextFromInput(input);
    const referenceTexts = normalizeReferenceTexts(input);
    const context = {
      chatSessionId,
      sceneId,
      mapId,
      query,
      referenceTexts,
      collectedAt: this.now(),
      sources: {},
      errors: []
    };
    if (input.includeContext === false) return context;

    const calls = [];
    if (chatSessionId) {
      calls.push(
        ['sceneMaps', 'system.scene_maps.list_mounted_maps', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
        ['mapStates', 'system.map_state.list_states', { chatSessionId, sceneId, mapId: mapId || undefined, limit: 100 }],
        ['sceneNpcs', 'system.scene_npcs.list_mounted_npcs', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
        ['timeClock', 'system.time.get_clock', { chatSessionId, sceneId }],
        ['timeEncounter', 'system.time.get_encounter', { chatSessionId }],
        ['encounters', 'system.encounters.list_encounters', { chatSessionId, sceneId, limit: 50 }]
      );
    }
    for (const [key, tool, toolInput] of calls) {
      const result = await safeExecuteTool(this.toolManager, tool, toolInput);
      if (result.ok) context.sources[key] = result.output;
      else context.errors.push({ key, tool, error: result.error });
    }
    if (input.includeRag && query) {
      const ragCalls = [
        ['permanentRag', 'system.rag_permanent.search', {
          query,
          limit: input.ragLimit || 5,
          filter: input.ragFilter,
          collection: input.ragCollection
        }],
        ['runtimeRag', 'system.rag_runtime.search', {
          query,
          limit: input.ragLimit || 5,
          filter: input.ragFilter,
          collection: input.ragCollection
        }]
      ];
      for (const [key, tool, toolInput] of ragCalls) {
        const result = await safeExecuteTool(this.toolManager, tool, toolInput);
        if (result.ok) context.sources[key] = result.output;
        else context.errors.push({ key, tool, error: result.error });
      }
    }
    return context;
  }

  async createPlanFromModelOrTemplate(input, prompt, template, triggerAssessment) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('Environment behavior planning requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one Environment Behavior Plan JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0,
        maxTokens: input.maxTokens || 2500
      });
      return parseJsonObject(completion.content);
    }
    if (input.planTemplate) {
      return fillTemplateValues(input.planTemplate, {
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId || 'current',
        sourceText: sourceTextFromInput(input)
      });
    }
    return buildDefaultEnvironmentPlan(input, template, triggerAssessment);
  }
}

export function buildEnvironmentBehaviorPrompt({
  sourceText = '',
  text,
  content,
  triggerText = '',
  triggerType = 'scene_event',
  context = {},
  plannerPrompt = '',
  userRules = '',
  referenceText = '',
  referenceTexts,
  referenceDocuments,
  toolReferenceText = '',
  template = ENVIRONMENT_BEHAVIOR_TEMPLATES.generic,
  allowedTools = DEFAULT_ENVIRONMENT_BEHAVIOR_ALLOWED_TOOLS,
  planTemplate,
  triggerAssessment
} = {}) {
  const selectedTemplate = template || ENVIRONMENT_BEHAVIOR_TEMPLATES.generic;
  const templatePlan = planTemplate || selectedTemplate.planTemplate || ENVIRONMENT_BEHAVIOR_TEMPLATES.generic.planTemplate;
  const references = normalizeReferenceTexts({
    referenceText,
    referenceTexts,
    referenceDocuments,
    toolReferenceText
  });
  return [
    plannerPrompt || selectedTemplate.plannerPrompt || ENVIRONMENT_BEHAVIOR_TEMPLATES.generic.plannerPrompt,
    userRules ? `User environment behavior rules:\n${userRules}` : '',
    references.length > 0 ? `Reference text for environment behavior probability and reaction weighting:\n${references.join('\n\n---\n\n')}` : '',
    'Trigger:',
    JSON.stringify({
      type: triggerType,
      text: sourceText || text || content || triggerText || ''
    }, null, 2),
    'Trigger assessment:',
    JSON.stringify(triggerAssessment || assessEnvironmentTrigger({ sourceText, text, content, triggerText, referenceText, referenceTexts, referenceDocuments, toolReferenceText }), null, 2),
    'Important execution model:',
    '- Return a plan only. The executor handles dice, state changes, risk reports, authorization, and trace files.',
    '- Most environment checks should not trigger. Use checks/proposals only when the trigger is prompt-salient or reference text makes the environment volatile.',
    '- State impact contract: if the environment reaction changes map state/routes, actor values/status/inventory/resources, NPC/map/faction relationships, quests, encounters, reusable items/skills/statuses/feats, RAG/memory, or extension data, include explicit proposals for the matching available tool.',
    '- Map hazards/objects go to system.map_state.patch_state. New/changed routes and locations go to system.map_relationships. Actor damage/status/resources go to system.npc_state.patch_state or time/effect tools. Social/faction/quest/encounter fallout goes to npc_relationships/factions/quests/encounters. Unknown extension fields can use system.data.quantify_text.',
    '- Never punish mere observation. Consequences should follow explicit risky action, failed action, existing hazard, or strong reference rule.',
    'Available/default allowed tools for environment behavior execution:',
    JSON.stringify(allowedTools || DEFAULT_ENVIRONMENT_BEHAVIOR_ALLOWED_TOOLS, null, 2),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one Environment Behavior Plan JSON object. Use this template as a debug reference, not as a fixed rule schema:',
    JSON.stringify(templatePlan, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function normalizeEnvironmentBehaviorPlan(input = {}, {
  sourceText = '',
  chatSessionId,
  sceneId = 'current',
  trigger = {},
  triggerAssessment = {}
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Environment behavior plan must be a plain object');
  }
  const metadata = normalizeObject(input.metadata);
  const environmentBehavior = {
    trigger: {
      ...buildTrigger({ sourceText, sceneId }),
      ...normalizeObject(metadata.environmentBehavior?.trigger),
      ...normalizeObject(input.trigger),
      ...normalizeObject(trigger)
    },
    triggerAssessment: {
      ...normalizeObject(triggerAssessment),
      ...normalizeObject(metadata.environmentBehavior?.triggerAssessment),
      ...normalizeObject(input.triggerAssessment)
    },
    environmentActors: normalizeEnvironmentActors(input.environmentActors || metadata.environmentBehavior?.environmentActors),
    severity: normalizeOptionalText(input.severity || metadata.environmentBehavior?.severity)
  };
  return normalizeActionPlan({
    ...input,
    actionId: input.actionId || input.environmentBehaviorId || createId('envact'),
    sourceText: input.sourceText || sourceText,
    metadata: {
      ...metadata,
      environmentBehavior
    }
  }, { sourceText, chatSessionId, sceneId });
}

export function assessEnvironmentTrigger(input = {}) {
  const source = sourceTextFromInput(input);
  const references = normalizeReferenceTexts(input);
  const lowered = source.toLowerCase();
  const matchedTerms = ENVIRONMENT_TRIGGER_TERMS
    .filter((term) => lowered.includes(term.term.toLowerCase()));
  const referenceText = references.join('\n').toLowerCase();
  const referenceMatches = matchedTerms.filter((term) => referenceText.includes(term.term.toLowerCase()));
  const baseChance = clampNumber(input.baseChance ?? input.environmentBaseChance ?? 0.05, 0.01, 0.5);
  let chance = source ? baseChance : 0.01;
  for (const term of matchedTerms) chance += term.weight;
  if (references.length > 0) chance += 0.05;
  if (referenceMatches.length > 0) chance += 0.15;
  if (input.scenePressure !== undefined) chance += clampNumber(Number(input.scenePressure) / 100, -0.25, 0.25);
  if (input.forceTrigger === true || input.triggered === true) chance = 1;
  if (input.disableTrigger === true || input.noTrigger === true) chance = 0;
  const finalChance = clampNumber(chance, 0, 0.95);
  const triggerThreshold = clampNumber(input.triggerThreshold ?? 0.35, 0.01, 0.95);
  const diceThreshold = finalChance <= 0 ? 101 : clampInteger(Math.ceil(101 - finalChance * 100), 2, 100);
  return {
    noLlm: true,
    baseChance,
    finalChance,
    triggerThreshold,
    dice: {
      diceSides: 100,
      successThreshold: diceThreshold
    },
    matchedTerms: matchedTerms.map((term) => term.term),
    referenceMatchedTerms: referenceMatches.map((term) => term.term),
    referenceCount: references.length,
    promptSalience: matchedTerms.length > 0 ? 'high' : (source ? 'low' : 'none'),
    triggerLikely: finalChance >= triggerThreshold,
    policy: 'Environment behavior is mostly no-op; explicit destructive or volatile reference text raises the probability.'
  };
}

function buildDefaultEnvironmentPlan(input = {}, template = ENVIRONMENT_BEHAVIOR_TEMPLATES.generic, triggerAssessment = assessEnvironmentTrigger(input)) {
  const sourceText = sourceTextFromInput(input);
  if (!triggerAssessment.triggerLikely) {
    return {
      ...fillTemplateValues(template.planTemplate || ENVIRONMENT_BEHAVIOR_TEMPLATES.generic.planTemplate, {
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId || 'current',
        sourceText
      }),
      actionId: input.actionId || createId('envnoop'),
      sourceText,
      intent: {
        label: 'environment-noop',
        summary: 'Environment reaction was checked but did not become a useful independent event.'
      },
      metadata: {
        environmentBehavior: {
          trigger: buildTrigger(input),
          triggerAssessment,
          environmentActors: []
        }
      },
      checks: [],
      proposals: [],
      narrationHints: {
        noTrigger: '环境没有产生独立反应。'
      }
    };
  }

  const mapId = normalizeOptionalText(input.mapId || input.environmentId) || 'current_environment';
  const proposals = input.chatSessionId
    ? [{
      id: 'record_environment_reaction',
      when: 'success',
      tool: 'system.map_state.patch_state',
      input: {
        chatSessionId: '${chatSessionId}',
        sceneId: '${sceneId}',
        mapId,
        hazards: [{
          id: 'hazard_environment_reaction',
          name: 'Environmental Reaction',
          summary: sourceText || 'Prompt-salient environmental reaction.',
          intensity: Math.max(1, Math.round(triggerAssessment.finalChance * 3))
        }],
        values: {
          environmentInstability: Math.round(triggerAssessment.finalChance * 100)
        },
        source: 'environment_behavior'
      }
    }]
    : [];
  return {
    actionId: input.actionId || createId('envact'),
    sourceText,
    intent: {
      label: 'environment-reaction',
      summary: 'Prompt-salient environment reaction requires a probability check.'
    },
    metadata: {
      environmentBehavior: {
        trigger: buildTrigger(input),
        triggerAssessment,
        environmentActors: [{
          id: mapId,
          type: 'scene',
          pressure: triggerAssessment.matchedTerms.join(', ') || 'reference-text salience',
          severity: triggerAssessment.finalChance >= 0.7 ? 'high' : 'medium'
        }]
      }
    },
    checks: [{
      id: 'environment_trigger_check',
      tool: 'game.dice.check',
      input: {
        successThreshold: triggerAssessment.dice.successThreshold,
        diceCount: 1,
        diceSides: 100,
        modifier: 0
      }
    }],
    proposals,
    narrationHints: {
      success: 'Describe only the visible environment reaction that passed the probability gate.',
      failure: '环境没有进一步升级；只保留玩家行动本身的结果。'
    }
  };
}

const ENVIRONMENT_TRIGGER_TERMS = [
  { term: '爆炸', weight: 0.55 },
  { term: '炸', weight: 0.45 },
  { term: '放火', weight: 0.45 },
  { term: '点燃', weight: 0.35 },
  { term: '燃烧', weight: 0.3 },
  { term: '坍塌', weight: 0.45 },
  { term: '倒塌', weight: 0.4 },
  { term: '毒气', weight: 0.4 },
  { term: '洪水', weight: 0.35 },
  { term: '地震', weight: 0.45 },
  { term: '陷阱', weight: 0.25 },
  { term: '警报', weight: 0.25 },
  { term: '摧毁', weight: 0.45 },
  { term: '破坏', weight: 0.25 },
  { term: '砸碎', weight: 0.25 },
  { term: 'explosion', weight: 0.55 },
  { term: 'explode', weight: 0.55 },
  { term: 'fire', weight: 0.25 },
  { term: 'collapse', weight: 0.45 },
  { term: 'poison gas', weight: 0.4 },
  { term: 'alarm', weight: 0.25 },
  { term: 'destroy', weight: 0.4 }
];

function normalizeEnvironmentActors(value) {
  return normalizeArray(value)
    .map((actor) => {
      if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
        return {
          id: normalizeOptionalText(actor.id || actor.mapId || actor.featureId),
          type: normalizeOptionalText(actor.type || actor.actorType || actor.kind),
          pressure: normalizeOptionalText(actor.pressure || actor.reason),
          severity: normalizeOptionalText(actor.severity)
        };
      }
      return { id: normalizeOptionalText(actor), type: '', pressure: '', severity: '' };
    })
    .filter((actor) => actor.id || actor.type || actor.pressure);
}

function buildTrigger(input = {}) {
  return {
    type: normalizeOptionalText(input.triggerType || input.type) || 'scene_event',
    summary: normalizeOptionalText(input.triggerSummary || input.summary),
    sourceText: sourceTextFromInput(input),
    sceneId: normalizeOptionalText(input.sceneId) || 'current'
  };
}

async function safeExecuteTool(toolManager, tool, input) {
  try {
    return {
      ok: true,
      output: (await toolManager.executeTool(tool, removeUndefined(input))).output
    };
  } catch (error) {
    return {
      ok: false,
      error: serializeError(error)
    };
  }
}

function selectTemplate(templateId) {
  return ENVIRONMENT_BEHAVIOR_TEMPLATES[templateId] || ENVIRONMENT_BEHAVIOR_TEMPLATES.generic;
}

function sourceTextFromInput(input = {}) {
  return normalizeOptionalText(input.sourceText || input.text || input.content || input.triggerText);
}

function parseJsonObject(content) {
  try {
    return parseFirstJsonObject(content);
  } catch {
    throw validationError('Environment behavior planner did not return a JSON object');
  }
}

function fillTemplateValues(value, replacements = {}) {
  if (typeof value === 'string') {
    return value
      .replace(/\$\{chatSessionId\}/g, replacements.chatSessionId || '')
      .replace(/\$\{sceneId\}/g, replacements.sceneId || 'current')
      .replace(/\$\{sourceText\}/g, replacements.sourceText || '');
  }
  if (Array.isArray(value)) return value.map((item) => fillTemplateValues(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      fillTemplateValues(child, replacements)
    ]));
  }
  return value;
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function sanitizeInput(input = {}) {
  if (Array.isArray(input)) return input.map(sanitizeInput);
  if (!input || typeof input !== 'object') return input;
  return Object.fromEntries(Object.entries(input)
    .filter(([key]) => !/(authorization|approval|token|apiKey|secret|password)/i.test(key))
    .map(([key, value]) => [key, sanitizeInput(value)]));
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

function normalizeReferenceTexts(input = {}) {
  const values = [
    input.referenceText,
    input.toolReferenceText,
    input.referenceTexts,
    input.referenceDocuments
  ];
  return [...new Set(values.flatMap((value) => {
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) return value.flatMap((item) => normalizeReferenceTexts({ referenceText: item }));
    if (value && typeof value === 'object') {
      return [
        value.title ? `# ${value.title}` : '',
        value.content || value.text || value.body || value.summary || ''
      ].filter(Boolean).join('\n');
    }
    return String(value).trim();
  }).filter(Boolean))];
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

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, min, max) {
  return Math.floor(clampNumber(value, min, max));
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'EnvironmentBehaviorResolverValidationError';
  error.statusCode = 400;
  return error;
}
