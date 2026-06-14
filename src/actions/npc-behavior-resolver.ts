// @ts-nocheck
import { ActionResolver, ActionResolverTraceRecorder, normalizeActionPlan } from './action-resolver.js';
import { createId, nowIso } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const DEFAULT_NPC_BEHAVIOR_ALLOWED_TOOLS = [
  'game.dice.check',
  'system.npc_state.patch_state',
  'system.npc_state.rewrite_state',
  'system.scene_npcs.patch_mounted_npc',
  'system.npc_relationships.upsert_node',
  'system.npc_relationships.patch_node',
  'system.npc_relationships.upsert_edge',
  'system.npc_relationships.patch_edge',
  'system.factions.upsert_membership',
  'system.factions.patch_membership',
  'system.factions.apply_actor_influence',
  'system.factions.upsert_faction',
  'system.factions.patch_faction',
  'system.factions.upsert_relation',
  'system.factions.patch_relation',
  'system.map_relationships.upsert_node',
  'system.map_relationships.patch_node',
  'system.map_relationships.upsert_edge',
  'system.map_relationships.patch_edge',
  'system.map_state.patch_state',
  'system.scene_maps.patch_mounted_map',
  'system.time.next_turn',
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

export const NPC_BEHAVIOR_TEMPLATES = {
  generic: {
    id: 'generic',
    name: 'Generic NPC Behavior Template',
    description: 'Autonomous NPC behavior adjudication without fixed action types.',
    plannerPrompt: [
      'You adjudicate non-player character autonomous behavior in an interactive text RPG.',
      'This is not a player action ruling. Decide what NPCs plausibly choose after the trigger, based on persona, state, relationships, faction pressure, fear, loyalty, goals, and current scene context.',
      'Doing nothing is valid. Severe, irreversible, betrayal, self-destructive, or faction-changing behavior must be strongly grounded in context and should usually be proposed as state changes rather than asserted without evidence.',
      'State impact contract: if behavior changes actor values, statusBar, skillBar, specialStatuses, inventory, resources, equipment, reusable items/skills/statuses/feats, NPC/map relationships, factions, quests, encounters, maps, RAG/memory, or extension data, include explicit proposals for the matching tool instead of only narrating it.',
      'Do not execute tools. Return one NPC Behavior Plan JSON object only.'
    ].join('\n'),
    planTemplate: {
      actionId: 'npc_behavior_debug_template',
      sourceText: 'Trigger or scene event.',
      intent: {
        label: 'npc-autonomy',
        summary: 'What the NPCs decide to do and why.'
      },
      metadata: {
        npcBehavior: {
          trigger: {
            type: 'scene_event',
            summary: 'What caused this adjudication.'
          },
          actors: [
            {
              npcId: 'npc_id',
              motivation: 'Short motivation.',
              pressure: 'Faction, fear, need, belief, or relationship pressure.',
              severity: 'low | medium | high | irreversible'
            }
          ]
        }
      },
      checks: [],
      proposals: [],
      narrationHints: {
        resolved: 'Narrate the NPC decision and visible consequences.'
      }
    }
  },
  factionPressure: {
    id: 'faction-pressure',
    name: 'Faction Pressure Template',
    description: 'NPC behavior driven by faction loyalty, betrayal, infiltration, or orders.',
    plannerPrompt: [
      'Focus on faction pressure, membership reasons, loyalty, obligations, and core interests.',
      'If the NPC changes allegiance, defects, obeys orders, leaks information, or sabotages someone, propose faction membership/relation and NPC state updates.',
      'Do not assume betrayal just because factions conflict; require motive, opportunity, and pressure.'
    ].join('\n'),
    planTemplate: {
      actionId: 'npc_faction_pressure_example',
      sourceText: 'A guard was persuaded to ignore an order.',
      intent: {
        label: 'faction-pressure',
        summary: 'Resolve how faction loyalties influence the NPC response.'
      },
      metadata: {
        npcBehavior: {
          trigger: { type: 'social_result', summary: 'Player persuasion changed immediate incentives.' },
          actors: [{ npcId: 'npc_guard', motivation: 'Avoid punishment while helping the player.', pressure: 'Faction duty versus personal trust.', severity: 'medium' }]
        }
      },
      checks: [
        {
          id: 'loyalty_check',
          tool: 'game.dice.check',
          input: {
            successThreshold: 15,
            diceCount: 1,
            diceSides: 20,
            modifier: 0
          }
        }
      ],
      proposals: [
        {
          id: 'mark_guard_conflicted',
          when: 'always',
          tool: 'system.npc_state.patch_state',
          input: {
            chatSessionId: '${chatSessionId}',
            sceneId: '${sceneId}',
            npcId: 'npc_guard',
            specialStatuses: [
              { id: 'conflicted_loyalty', name: 'Conflicted Loyalty', intensity: 1 }
            ]
          }
        }
      ]
    }
  }
};

export class NpcBehaviorResolver {
  constructor({
    toolManager,
    chatProvider,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    if (!toolManager) throw validationError('NpcBehaviorResolver requires toolManager');
    this.toolManager = toolManager;
    this.chatProvider = chatProvider;
    this.now = now;
    this.traceRecorder = traceRecorder || new ActionResolverTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      directory: trace?.directory || 'data/npc-behavior-traces',
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
      defaultAllowedTools: DEFAULT_NPC_BEHAVIOR_ALLOWED_TOOLS,
      templates: NPC_BEHAVIOR_TEMPLATES,
      planShape: NPC_BEHAVIOR_TEMPLATES.generic.planTemplate,
      flow: [
        'collect NPC/faction/relationship/scene/time context',
        'build editable NPC behavior prompt',
        'generate or accept a behavior plan',
        'apply via the existing ActionResolver executor with dryRun=true by default'
      ],
      warnings: [
        'This resolver may propose betrayal, flight, surrender, self-destructive behavior, faction shifts, or offscreen moves, but such outcomes should be grounded in context.',
        'Applying proposals still follows tool allow-lists, risk reports, and underlying authorization rules.'
      ]
    };
  }

  async buildPrompt(input = {}) {
    const trace = this.traceRecorder.start('npc-behavior-build-prompt', { input: sanitizeInput(input) });
    try {
      const context = await this.collectContext(input);
      const template = selectTemplate(input.templateId);
      const prompt = buildNpcBehaviorPrompt({
        ...input,
        context,
        template,
        plannerPrompt: input.plannerPrompt
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'plannerPrompt', prompt);
      const output = {
        prompt,
        context,
        template,
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

  async plan(input = {}) {
    const trace = this.traceRecorder.start('npc-behavior-plan', { input: sanitizeInput(input) });
    try {
      const context = await this.collectContext(input);
      const template = selectTemplate(input.templateId);
      const prompt = buildNpcBehaviorPrompt({
        ...input,
        context,
        template,
        plannerPrompt: input.plannerPrompt
      });
      const rawPlan = input.plan || await this.createPlanFromModelOrTemplate(input, prompt, template);
      const plan = normalizeNpcBehaviorPlan(rawPlan, {
        sourceText: input.sourceText || input.text || input.content || input.triggerText || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId || 'current',
        actorNpcIds: input.actorNpcIds || input.npcIds || input.npcId,
        trigger: buildTrigger(input)
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'plannerPrompt', prompt);
      this.traceRecorder.write(trace, 'plan', rawPlan);
      this.traceRecorder.write(trace, 'normalizedPlan', plan);
      const output = {
        plan,
        rawPlan,
        context,
        prompt,
        trace: this.traceRecorder.finish(trace, {
          output: {
            actionId: plan.actionId,
            checks: plan.checks.length,
            proposals: plan.proposals.length
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
    const trace = this.traceRecorder.start('npc-behavior-apply-plan', { input: sanitizeInput(input) });
    try {
      const plan = normalizeNpcBehaviorPlan(input.plan || input, {
        sourceText: input.sourceText || input.text || input.content || input.triggerText || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId || 'current',
        actorNpcIds: input.actorNpcIds || input.npcIds || input.npcId,
        trigger: buildTrigger(input)
      });
      const applied = await this.actionResolver.applyPlan({
        ...input,
        plan,
        dryRun: input.dryRun ?? true,
        allowedTools: input.allowedTools || DEFAULT_NPC_BEHAVIOR_ALLOWED_TOOLS
      }, { context: externalContext });
      const output = {
        status: applied.status,
        plan,
        apply: applied
      };
      this.traceRecorder.write(trace, 'normalizedPlan', plan);
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
    const trace = this.traceRecorder.start('npc-behavior-resolve', { input: sanitizeInput(input) });
    try {
      const planned = input.plan
        ? {
          plan: normalizeNpcBehaviorPlan(input.plan, {
            sourceText: input.sourceText || input.text || input.content || input.triggerText || '',
            chatSessionId: input.chatSessionId,
            sceneId: input.sceneId || 'current',
            actorNpcIds: input.actorNpcIds || input.npcIds || input.npcId,
            trigger: buildTrigger(input)
          }),
          context: await this.collectContext(input),
          prompt: ''
        }
        : await this.plan(input);
      const applied = await this.applyPlan({
        ...input,
        plan: planned.plan,
        dryRun: input.dryRun ?? true
      }, options);
      this.traceRecorder.write(trace, 'context', planned.context);
      this.traceRecorder.write(trace, 'plannerPrompt', planned.prompt || '');
      this.traceRecorder.write(trace, 'normalizedPlan', planned.plan);
      this.traceRecorder.write(trace, 'riskReport', applied.apply?.riskReport);
      this.traceRecorder.write(trace, 'diceResults', applied.apply?.diceResults);
      this.traceRecorder.write(trace, 'appliedToolCalls', applied.apply?.appliedToolCalls);
      const output = {
        status: applied.status,
        plan: planned.plan,
        context: planned.context,
        prompt: planned.prompt,
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
    const actorNpcIds = normalizeStringArray(input.actorNpcIds || input.npcIds || input.npcId);
    const factionIds = normalizeStringArray(input.factionIds || input.factionId);
    const query = input.query || input.ragQuery || input.sourceText || input.text || input.content || input.triggerText || '';
    const context = {
      chatSessionId,
      sceneId,
      actorNpcIds,
      factionIds,
      query,
      collectedAt: this.now(),
      sources: {},
      errors: []
    };
    if (input.includeContext === false) return context;

    const calls = [];
    if (chatSessionId) {
      calls.push(
        ['sceneNpcs', 'system.scene_npcs.list_mounted_npcs', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
        ['sceneMaps', 'system.scene_maps.list_mounted_maps', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
        ['npcStates', 'system.npc_state.list_states', { chatSessionId, sceneId, limit: 100 }],
        ['mapStates', 'system.map_state.list_states', { chatSessionId, sceneId, limit: 100 }],
        ['timeClock', 'system.time.get_clock', { chatSessionId, sceneId }],
        ['timeEncounter', 'system.time.get_encounter', { chatSessionId }],
        ['timeTurnOrder', 'system.time.list_turn_order', { chatSessionId, includeInactive: false, limit: 100 }]
      );
    }
    calls.push(
      ['factions', 'system.factions.list_factions', { query: input.factionQuery || '', limit: 100 }],
      ['factionRelations', 'system.factions.list_relations', { factionId: factionIds[0], limit: 100 }],
      ['factionMemberships', 'system.factions.list_memberships', { factionId: factionIds[0], limit: 100 }]
    );
    for (const npcId of actorNpcIds) {
      calls.push(
        [`actorFactions:${npcId}`, 'system.factions.get_actor_factions', { actorId: npcId, limit: 50 }],
        [`npcRelations:${npcId}`, 'system.npc_relationships.traverse_relations', { startNpcId: npcId, maxDepth: 2, limit: 100 }],
        [`npcProfiles:${npcId}`, 'system.npc_profiles.get_profile_bundle', { npcId, levels: ['L1', 'L2'], limit: 2 }]
      );
    }
    for (const [key, tool, toolInput] of calls) {
      const result = await safeExecuteTool(this.toolManager, tool, toolInput);
      if (result.ok) context.sources[key] = result.output;
      else context.errors.push({ key, tool, error: result.error });
    }
    if (input.includeRag && query) {
      const ragCalls = [
        ['factionRag', 'system.factions.search_rag', {
          query,
          limit: input.ragLimit || 5,
          filter: input.ragFilter
        }],
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

  async createPlanFromModelOrTemplate(input, prompt, template) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('NPC behavior planning requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one NPC Behavior Plan JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0,
        maxTokens: input.maxTokens || 2500
      });
      return parseJsonObject(completion.content);
    }
    return fillTemplateValues(input.planTemplate || template.planTemplate, {
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId || 'current',
      sourceText: input.sourceText || input.text || input.content || input.triggerText || ''
    });
  }
}

export function buildNpcBehaviorPrompt({
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
  template = NPC_BEHAVIOR_TEMPLATES.generic,
  allowedTools = DEFAULT_NPC_BEHAVIOR_ALLOWED_TOOLS,
  planTemplate
} = {}) {
  const selectedTemplate = template || NPC_BEHAVIOR_TEMPLATES.generic;
  const templatePlan = planTemplate || selectedTemplate.planTemplate || NPC_BEHAVIOR_TEMPLATES.generic.planTemplate;
  const references = normalizeReferenceTexts({
    referenceText,
    referenceTexts,
    referenceDocuments,
    toolReferenceText
  });
  return [
    plannerPrompt || selectedTemplate.plannerPrompt || NPC_BEHAVIOR_TEMPLATES.generic.plannerPrompt,
    userRules ? `User NPC behavior rules:\n${userRules}` : '',
    references.length > 0 ? `Reference text for NPC behavior probability and reaction weighting:\n${references.join('\n\n---\n\n')}` : '',
    'Trigger:',
    JSON.stringify({
      type: triggerType,
      text: sourceText || text || content || triggerText || ''
    }, null, 2),
    'Important execution model:',
    '- Return a plan only. The executor handles dice, state changes, risk reports, authorization, and trace files.',
    '- State impact contract: if behavior changes actor values, statusBar, skillBar, specialStatuses, inventory, resources, equipment, reusable items/skills/statuses/feats, NPC/map relationships, factions, quests, encounters, maps, RAG/memory, or extension data, include explicit proposals for the matching available tool.',
    '- Actor-facing values/status/inventory/skills/resources/equipment normally go to system.npc_state.patch_state. Reusable definitions go to system.mechanics_registry or system.item_registry. Routes/locations go to system.map_relationships or map_state. Social/faction changes go to npc_relationships/factions. Quest/encounter hooks go to quests/encounters. Unknown extension fields can use system.data.quantify_text.',
    '- Prefer no action or delayed action when motives are weak.',
    '- For betrayal, panic, flight, self-destructive decisions, or faction switching, include clear motivation and pressure in metadata.npcBehavior.actors.',
    'Available/default allowed tools for NPC behavior execution:',
    JSON.stringify(allowedTools || DEFAULT_NPC_BEHAVIOR_ALLOWED_TOOLS, null, 2),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one NPC Behavior Plan JSON object. Use this template as a debug reference, not as a fixed rule schema:',
    JSON.stringify(templatePlan, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function normalizeNpcBehaviorPlan(input = {}, {
  sourceText = '',
  chatSessionId,
  sceneId = 'current',
  actorNpcIds = [],
  trigger = {}
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('NPC behavior plan must be a plain object');
  }
  const actorIds = normalizeStringArray(actorNpcIds);
  const metadata = normalizeObject(input.metadata);
  const npcBehavior = {
    trigger: {
      ...buildTrigger({ sourceText, sceneId }),
      ...normalizeObject(metadata.npcBehavior?.trigger),
      ...normalizeObject(input.trigger),
      ...normalizeObject(trigger)
    },
    actors: normalizeActors(input.actors || metadata.npcBehavior?.actors, actorIds),
    factionImpacts: normalizeArray(input.factionImpacts || metadata.npcBehavior?.factionImpacts),
    severity: normalizeOptionalText(input.severity || metadata.npcBehavior?.severity)
  };
  return normalizeActionPlan({
    ...input,
    actionId: input.actionId || input.npcBehaviorId || createId('npcact'),
    sourceText: input.sourceText || sourceText,
    metadata: {
      ...metadata,
      npcBehavior
    }
  }, { sourceText, chatSessionId, sceneId });
}

function normalizeActors(value, fallbackActorIds) {
  const actors = normalizeArray(value)
    .map((actor) => {
      if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
        return {
          npcId: normalizeOptionalText(actor.npcId || actor.actorId || actor.id),
          name: normalizeOptionalText(actor.name),
          motivation: normalizeOptionalText(actor.motivation || actor.reason),
          pressure: normalizeOptionalText(actor.pressure),
          severity: normalizeOptionalText(actor.severity)
        };
      }
      return { npcId: normalizeOptionalText(actor), name: '', motivation: '', pressure: '', severity: '' };
    })
    .filter((actor) => actor.npcId || actor.name || actor.motivation);
  if (actors.length > 0) return actors;
  return fallbackActorIds.map((npcId) => ({ npcId, name: '', motivation: '', pressure: '', severity: '' }));
}

function buildTrigger(input = {}) {
  return {
    type: normalizeOptionalText(input.triggerType || input.type) || 'scene_event',
    summary: normalizeOptionalText(input.triggerSummary || input.summary),
    sourceText: normalizeOptionalText(input.sourceText || input.text || input.content || input.triggerText),
    sceneId: normalizeOptionalText(input.sceneId) || 'current'
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
  return NPC_BEHAVIOR_TEMPLATES[templateId] || NPC_BEHAVIOR_TEMPLATES.generic;
}

function parseJsonObject(content) {
  try {
    return parseFirstJsonObject(content);
  } catch {
    throw validationError('NPC behavior planner did not return a JSON object');
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

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
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

function normalizeOptionalText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'NpcBehaviorResolverValidationError';
  error.statusCode = 400;
  return error;
}
