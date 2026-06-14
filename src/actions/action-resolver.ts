// @ts-nocheck
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createId, nowIso } from '../utils/id.js';
import { parseFirstJsonObject } from '../utils/json.js';

export const DEFAULT_ACTION_ALLOWED_TOOLS = [
  'game.dice.check',
  'system.npc_state.patch_state',
  'system.npc_state.rewrite_state',
  'system.resources.spend_action_economy',
  'system.resources.restore_action_economy',
  'system.resources.reset_action_economy',
  'system.resources.spend_resource',
  'system.resources.restore_resource',
  'system.resources.set_resource',
  'system.resources.consume_item',
  'system.resources.start_cooldown',
  'system.map_state.patch_state',
  'system.map_state.rewrite_state',
  'system.time.next_turn',
  'system.time.end_turn',
  'system.time.advance_time',
  'system.time.add_effect',
  'system.time.schedule_event',
  'system.scene_npcs.mount_npc',
  'system.scene_npcs.patch_mounted_npc',
  'system.scene_npcs.unmount_npc',
  'system.scene_maps.mount_map',
  'system.scene_maps.patch_mounted_map',
  'system.scene_maps.unmount_map',
  'system.party.add_member',
  'system.party.patch_member',
  'system.party.assign_member',
  'system.party.set_member_activity',
  'system.party.set_member_location',
  'system.party.remove_member',
  'system.map_relationships.find_scene_path',
  'system.npc_registry.upsert_npc',
  'system.map_registry.upsert_map',
  'system.map_relationships.upsert_node',
  'system.map_relationships.patch_node',
  'system.map_relationships.upsert_edge',
  'system.map_relationships.patch_edge',
  'system.npc_relationships.upsert_node',
  'system.npc_relationships.patch_node',
  'system.npc_relationships.upsert_edge',
  'system.npc_relationships.patch_edge',
  'system.item_registry.upsert_item',
  'system.item_registry.upsert_equipment',
  'system.item_registry.upsert_accessory',
  'system.item_registry.upsert_weapon',
  'system.item_registry.upsert_mount',
  'system.item_registry.upsert_special_item',
  'system.mechanics_registry.upsert_skill',
  'system.mechanics_registry.upsert_status',
  'system.mechanics_registry.upsert_feat',
  'system.quests.upsert_quest',
  'system.quests.patch_quest',
  'system.quests.add_quest_event',
  'system.factions.upsert_membership',
  'system.factions.patch_membership',
  'system.factions.apply_actor_influence',
  'system.factions.upsert_faction',
  'system.factions.patch_faction',
  'system.factions.upsert_relation',
  'system.factions.patch_relation',
  'system.data.quantify_text'
];

export const ACTION_RESOLVER_TEMPLATES = {
  generic: {
    id: 'generic',
    name: 'Generic Action Plan',
    description: 'Provider-agnostic action resolver template. It does not enforce action types.',
    plannerPrompt: [
      'You are an action adjudication planner for an interactive text RPG.',
      'Use the provided context and the user rules to produce one Action Plan JSON object.',
      'Do not execute tools. Do not claim dice results. Do not write database state directly.',
      'Treat the player text as an attempted action to adjudicate now. Do not turn a concrete action into a menu of optional next actions.',
      'For broad but executable compound actions, choose a reasonable abstraction level and produce a plan that resolves meaningful progress in this turn.',
      'Ask for more information only when a required target/resource/irreversible choice is genuinely missing.',
      'Routine low-risk training, study, rest, preparation, and regular resource pickup can be resolved as automatic small progress without a dice check. Use dice for uncertainty, danger, opposition, time pressure, forced speed, breakthrough, overreach, or meaningful stakes.',
      'Do not accept claimed outcomes as facts; adjudicate the attempt and constrain success through checks, proposals, costs, or consequences.',
      'The plan may contain any intent label the user rules define. Do not restrict action types to a fixed enum.',
      'If the adjudicated result changes actor numeric values, statusBar, skillBar, specialStatuses, inventory, resources, equipment, current-scene NPC presence, current-scene map/location mounts, party roster/activity, NPC relations, map state, map routes, faction state, quest state, RAG/memory, or extension database fields, put those changes into explicit proposals with tool and input.',
      'Use system.npc_state.patch_state for actor values/statusBar/skillBar/specialStatuses/inventory/resources/equipment. Use system.scene_npcs.* when an NPC/monster appears in, leaves, or changes visibility/status inside the current scene. Use system.scene_maps.* when a map/location becomes, leaves, or changes visibility/status in the current scene UI. Use system.party.* for companions joining, leaving, following, standby, offscreen assignments, or party location/activity. Use system.mechanics_registry.* for reusable skills/statuses/feats. Use system.item_registry.* for reusable item definitions. Use relationship/map/faction/quest/data tools for world or extension effects.',
      'Do not hide concrete state changes only in narrationHints; proposals are the auditable handoff for database writes.',
      'Only propose tool calls that are necessary and explain why in narrationHints or metadata.'
    ].join('\n'),
    planTemplate: {
      actionId: 'act_debug_template',
      sourceText: 'User natural-language action.',
      intent: {
        label: 'user-defined-action',
        summary: 'Short description of what the player is attempting.',
        target: {
          kind: 'npc | map | item | scene | abstract',
          id: 'target-id'
        }
      },
      checks: [
        {
          id: 'main_check',
          tool: 'game.dice.check',
          input: {
            successThreshold: 15,
            diceCount: 1,
            diceSides: 20,
            modifier: 0,
            rollMode: 'normal'
          }
        }
      ],
      proposals: [],
      narrationHints: {
        success: 'Describe the successful consequence.',
        failure: 'Describe the failed attempt and any cost.',
        criticalSuccess: 'Describe an exceptional success.',
        criticalFailure: 'Describe a serious complication.'
      }
    }
  },
  dnd5eLite: {
    id: 'dnd5e-lite',
    name: 'D&D 5e Lite Debug Template',
    description: 'A lightweight D&D-like example. It is a template for debugging, not a built-in rule database.',
    plannerPrompt: [
      'Use a D&D 5e-like style only as a reference.',
      'Resolve the attempted action this turn when it is executable; do not ask for tactical options unless a required target or resource choice is missing.',
      'For uncertain actions, propose a d20 check using game.dice.check. Routine low-risk training or regular pickup can be automatic progress with explicit state proposals instead of a check.',
      'Choose DC conservatively from the user-provided rules or context. Typical DCs: 10 easy, 15 moderate, 20 hard.',
      'Put ability/skill labels in check.metadata if useful, but do not require a fixed action type enum.'
    ].join('\n'),
    planTemplate: {
      actionId: 'act_lockpick_example',
      sourceText: '我撬开那把锈蚀的锁。',
      intent: {
        label: 'lockpick',
        summary: '尝试打开锈蚀门锁。',
        target: {
          kind: 'map_object',
          id: 'rusty_lock'
        }
      },
      checks: [
        {
          id: 'lockpick_check',
          tool: 'game.dice.check',
          input: {
            successThreshold: 15,
            diceCount: 1,
            diceSides: 20,
            modifier: 3,
            rollMode: 'normal'
          },
          metadata: {
            ability: 'dexterity',
            skill: 'sleight_of_hand',
            reason: '锈蚀但仍可操作的普通锁。'
          }
        }
      ],
      proposals: [
        {
          id: 'unlock_on_success',
          when: ['success', 'criticalSuccess'],
          tool: 'system.map_state.patch_state',
          input: {
            chatSessionId: '${chatSessionId}',
            sceneId: '${sceneId}',
            mapId: 'current_map',
            objects: [
              { id: 'rusty_lock', status: 'unlocked' }
            ]
          }
        },
        {
          id: 'advance_turn_after_attempt',
          when: 'always',
          tool: 'system.time.next_turn',
          input: {
            chatSessionId: '${chatSessionId}'
          }
        }
      ],
      narrationHints: {
        success: '锁舌弹开。',
        failure: '锁芯卡住，工具发出刺耳细响。',
        criticalSuccess: '你几乎无声地打开锁，并发现锁舌旁还有一处暗扣。',
        criticalFailure: '工具断在锁芯里，声音惊动附近守卫。'
      }
    }
  },
  investigation: {
    id: 'investigation',
    name: 'Investigation Template',
    description: 'Example for search, clue discovery, and map-state changes.',
    plannerPrompt: [
      'Use this as an investigation/search template.',
      'If the player declares a search or investigation, resolve what they find or fail to find now; do not only list where they could search next.',
      'Only propose elapsed time if the user explicitly requested it or the caller enabled time estimation.',
      'Prefer map_state proposals for discovered areas, objects, clues, hazards, and numeric alert/noise values.'
    ].join('\n'),
    planTemplate: {
      actionId: 'act_search_example',
      sourceText: '我检查蓝色摊棚下方。',
      intent: {
        label: 'search',
        summary: '搜索当前区域可能的线索。',
        target: {
          kind: 'map_area',
          id: 'blue_stall'
        }
      },
      checks: [
        {
          id: 'search_check',
          tool: 'game.dice.check',
          input: {
            successThreshold: 13,
            diceCount: 1,
            diceSides: 20,
            modifier: 2
          },
          metadata: {
            ability: 'intelligence',
            skill: 'investigation'
          }
        }
      ],
      proposals: [
        {
          id: 'reveal_clue',
          when: ['success', 'criticalSuccess'],
          tool: 'system.map_state.patch_state',
          input: {
            chatSessionId: '${chatSessionId}',
            sceneId: '${sceneId}',
            mapId: 'current_map',
            objects: [
              { id: 'loose_board', name: '松动木板', status: 'revealed' }
            ]
          }
        }
      ]
    }
  },
  social: {
    id: 'social',
    name: 'Social Encounter Template',
    description: 'Example for persuasion, deception, intimidation, attitude, and relationship shifts.',
    plannerPrompt: [
      'Use this as a social adjudication template.',
      'If the player attempts persuasion, deception, intimidation, or negotiation, adjudicate the attempt now; do not pause to ask for optional talking points unless no target exists.',
      'Represent attitude, trust, suspicion, and pressure as numeric or text state changes only when the user rules call for it.',
      'Prefer proposals over direct narration of permanent NPC belief changes.'
    ].join('\n'),
    planTemplate: {
      actionId: 'act_social_example',
      sourceText: '我试图说服守卫放我们进去。',
      intent: {
        label: 'persuade',
        summary: '尝试改变守卫态度。',
        target: {
          kind: 'npc',
          id: 'npc_guard'
        }
      },
      checks: [
        {
          id: 'persuasion_check',
          tool: 'game.dice.check',
          input: {
            successThreshold: 15,
            diceCount: 1,
            diceSides: 20,
            modifier: 4
          },
          metadata: {
            ability: 'charisma',
            skill: 'persuasion'
          }
        }
      ],
      proposals: [
        {
          id: 'guard_trust_up',
          when: ['success', 'criticalSuccess'],
          tool: 'system.npc_state.patch_state',
          input: {
            chatSessionId: '${chatSessionId}',
            sceneId: '${sceneId}',
            npcId: 'npc_guard',
            values: {
              trust: 1
            }
          }
        }
      ]
    }
  }
};

export const ACTION_APPEAL_DECISION_TEMPLATE = {
  appealId: 'appeal_debug_template',
  status: 'pending | accepted | partiallyAccepted | rejected | needsMoreInfo',
  summary: 'Short explanation of whether the original ruling should change.',
  originalActionId: 'act_original',
  disputedRuling: 'What the player is challenging.',
  playerArgument: 'Player rebuttal and rule/context argument.',
  requestedOutcome: 'What the player asks to change.',
  findings: [
    {
      issue: 'Relevant rule, context fact, or fairness concern.',
      evaluation: 'Why it supports or does not support changing the ruling.',
      supportsPlayer: true
    }
  ],
  correction: {
    shouldChangeRuling: true,
    recommendedOutcome: 'More reasonable ruling.',
    rerollRecommended: false,
    rollbackRecommended: false
  },
  revisedPlan: {
    actionId: 'act_rejudged_example',
    sourceText: 'Original action text.',
    checks: [],
    proposals: []
  },
  narrationGuidance: 'How to explain the corrected ruling to the player.',
  metadata: {}
};

export const ACTION_ABSURDITY_JUDGEMENT_TEMPLATE = {
  judgementId: 'absurdity_debug_template',
  status: 'judged | notEvaluated | needsMoreContext',
  absurdityLevel: 'ordinary | unusual | absurd | extreme | impossibleButPlayable',
  relativeTo: {
    actor: 'Who is attempting the action.',
    target: 'Who or what is affected.',
    world: 'Relevant genre, cosmology, rules, and scene assumptions.'
  },
  summary: 'Short judgement of why this is or is not absurd in context.',
  factors: [
    {
      name: 'identity | power_gap | access | npc_persona | taboo | special_ability | hidden_setting | genre_logic',
      judgement: 'qualitative assessment, not a numeric score',
      supportsAttempt: true,
      note: 'Why this factor matters.'
    }
  ],
  canAttempt: true,
  shouldRollOrResolve: true,
  successDoesNotMeanExactWish: true,
  requiresAbsurdityExplanationOnSuccess: false,
  checkGuidance: {
    difficulty: 'ordinary | hard | extreme | narrative-only | custom',
    reason: 'How the action resolver should frame success/failure without treating absurdity as automatic failure.'
  },
  explanationSeeds: [
    'Possible hidden law, loophole, prophecy, divine joke, genre twist, social misunderstanding, symbolic success, or consequence hook.'
  ],
  boundaries: [
    'Agency, consent, taboo, tone, or table-boundary notes to respect.'
  ],
  metadata: {}
};

export const ACTION_ABSURDITY_EXPLANATION_TEMPLATE = {
  explanationId: 'absurdity_explanation_debug_template',
  status: 'explained | notNeeded | needsHuman',
  premise: 'The absurd successful action that must now be made playable.',
  acceptedOutcome: 'What success means at the table.',
  explanationMode: 'literal | symbolic | loophole | misunderstanding | pact | prophecy | genre-comedy | hidden-setting | partial-but-real',
  explanation: 'Concise in-world explanation that honors success without ending the game.',
  consequences: [
    {
      kind: 'boon | cost | complication | status | faction | npc | map | cosmic | comedy',
      summary: 'Follow-up consequence.'
    }
  ],
  followUpHooks: [
    'A future scene, NPC reaction, faction shift, cosmic obligation, rumor, or timer.'
  ],
  narration: {
    immediate: 'What to narrate now.',
    later: 'What may become relevant later.'
  },
  suggestedProposals: [],
  metadata: {}
};

export class ActionResolverTraceRecorder {
  constructor({
    enabled = true,
    directory = 'data/action-resolver-traces',
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
    const traceId = createId('actiontrace');
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
        plannerPrompt: resolve(traceDirectory, 'planner-prompt.txt'),
        plan: resolve(traceDirectory, 'plan.json'),
        normalizedPlan: resolve(traceDirectory, 'normalized-plan.json'),
        absurdityPrompt: resolve(traceDirectory, 'absurdity-prompt.txt'),
        absurdityJudgement: resolve(traceDirectory, 'absurdity-judgement.json'),
        absurdityExplanationPrompt: resolve(traceDirectory, 'absurdity-explanation-prompt.txt'),
        absurdityExplanation: resolve(traceDirectory, 'absurdity-explanation.json'),
        appealPrompt: resolve(traceDirectory, 'appeal-prompt.txt'),
        appealDecision: resolve(traceDirectory, 'appeal-decision.json'),
        appealApplication: resolve(traceDirectory, 'appeal-application.json'),
        semanticWritePrompt: resolve(traceDirectory, 'semantic-write-prompt.txt'),
        semanticWriteDecision: resolve(traceDirectory, 'semantic-write-decision.json'),
        semanticWritePlan: resolve(traceDirectory, 'semantic-write-plan.json'),
        riskReport: resolve(traceDirectory, 'risk-report.json'),
        diceResults: resolve(traceDirectory, 'dice-results.json'),
        appliedToolCalls: resolve(traceDirectory, 'applied-tool-calls.json'),
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
    if (name === 'plannerPrompt' || name === 'appealPrompt' || name === 'absurdityPrompt' || name === 'absurdityExplanationPrompt' || name === 'semanticWritePrompt') {
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

export class ActionResolver {
  constructor({
    toolManager,
    chatProvider,
    trace,
    traceRecorder,
    cwd = process.cwd(),
    now = nowIso
  } = {}) {
    if (!toolManager) throw validationError('ActionResolver requires toolManager');
    this.toolManager = toolManager;
    this.chatProvider = chatProvider;
    this.now = now;
    this.traceRecorder = traceRecorder || new ActionResolverTraceRecorder({
      ...(trace && typeof trace === 'object' ? trace : {}),
      enabled: trace === false ? false : (trace?.enabled ?? true),
      cwd,
      now
    });
  }

  describe() {
    return {
      defaultAllowedTools: DEFAULT_ACTION_ALLOWED_TOOLS,
      defaultResolverToolId: 'system.action.resolve',
      legacySinglePassResolverToolId: 'system.action.resolve_once',
      templates: ACTION_RESOLVER_TEMPLATES,
      planShape: ACTION_RESOLVER_TEMPLATES.generic.planTemplate,
      appealDecisionShape: ACTION_APPEAL_DECISION_TEMPLATE,
      absurdityJudgementShape: ACTION_ABSURDITY_JUDGEMENT_TEMPLATE,
      absurdityExplanationShape: ACTION_ABSURDITY_EXPLANATION_TEMPLATE,
      absurdityWorkflow: [
        'judge_absurdity evaluates whether an attempted action is relatively absurd in the current scene, without converting that judgement into automatic failure.',
        'The normal action plan/check still decides success or failure.',
        'explain_absurdity is used after a successful absurd action to force a playable in-world explanation, consequences, and hooks.'
      ],
      appealWorkflow: [
        'system.action.resolve is the default player-facing resolver and returns an accept/rebut decision loop.',
        'system.action.resolve_once is the archived legacy single-pass resolver for debugging and compatibility.',
        'build_appeal_prompt collects context and writes an editable appeal prompt.',
        'request_rejudgement returns a structured appeal decision. It does not mutate state.',
        'apply_rejudgement reuses apply_plan for an accepted revisedPlan and defaults to dryRun=true.',
        'resolve_with_appeal is a compatibility alias for the same player appeal loop.'
      ],
      permissions: {
        userCanAllowAllTools: true,
        aiPlanAuthorizationIgnored: true,
        externalContextAuthorizationRequired: true,
        dangerousToolsFollowUnderlyingToolAuthorization: true
      }
    };
  }

  async buildPrompt(input = {}) {
    const trace = this.traceRecorder.start('action-build-prompt', { input });
    try {
      const context = await this.collectContext(input);
      const prompt = buildActionPlannerPrompt({
        ...input,
        context,
        template: selectTemplate(input.templateId),
        plannerPrompt: input.plannerPrompt
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'plannerPrompt', prompt);
      const output = {
        prompt,
        context,
        template: selectTemplate(input.templateId),
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
    const trace = this.traceRecorder.start('action-plan', { input });
    try {
      const context = await this.collectContext(input);
      const template = selectTemplate(input.templateId);
      const prompt = buildActionPlannerPrompt({
        ...input,
        context,
        template,
        plannerPrompt: input.plannerPrompt
      });
      const rawPlan = input.plan || await this.createPlanFromModelOrTemplate(input, prompt, template);
      const normalizedPlan = normalizeActionPlan(rawPlan, {
        sourceText: input.sourceText || input.text || input.content || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId
      });
      const semantic = await this.semanticNormalizePlan(normalizedPlan, input, { context, trace });
      const finalPlan = semantic.plan;
      const absurdityJudgement = input.includeAbsurdity || input.absurdityJudgement || input.useAbsurdityLlm
        ? await this.judgeAbsurdity({
          ...input,
          plan: finalPlan,
          context,
          judgement: input.absurdityJudgement,
          useLlm: input.useAbsurdityLlm ?? input.useLlm
        })
        : undefined;
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'plannerPrompt', prompt);
      this.traceRecorder.write(trace, 'plan', rawPlan);
      this.traceRecorder.write(trace, 'normalizedPlan', finalPlan);
      this.traceRecorder.write(trace, 'semanticWritePlan', semantic);
      if (absurdityJudgement) this.traceRecorder.write(trace, 'absurdityJudgement', absurdityJudgement.judgement);
      const output = {
        plan: finalPlan,
        rawPlan,
        semanticWritePlanning: semantic.summary,
        absurdityJudgement,
        context,
        prompt,
        trace: this.traceRecorder.finish(trace, {
          output: {
            actionId: finalPlan.actionId,
            checks: finalPlan.checks.length,
            proposals: finalPlan.proposals.length
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
    const trace = this.traceRecorder.start('action-apply-plan', { input: sanitizeActionInput(input) });
    try {
      const normalizedPlan = normalizeActionPlan(input.plan || input, {
        sourceText: input.sourceText || input.text || input.content || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId
      });
      const semantic = await this.semanticNormalizePlan(normalizedPlan, input, { trace });
      const plan = semantic.plan;
      const authorization = normalizeAuthorization(externalContext);
      const allowed = resolveAllowedTools(input.allowedTools, { authorized: authorization.authorized });
      const riskReport = buildRiskReport(plan, {
        toolManager: this.toolManager,
        allowedTools: allowed.effectiveAllowedTools,
        requestedAllowedTools: allowed.requestedAllowedTools,
        allowedOverrideAuthorized: allowed.overrideAuthorized,
        authorization
      });
      this.traceRecorder.write(trace, 'normalizedPlan', plan);
      this.traceRecorder.write(trace, 'semanticWritePlan', semantic);
      this.traceRecorder.write(trace, 'riskReport', riskReport);

      if (input.dryRun === true) {
        const output = {
          status: 'dry_run',
          plan,
          riskReport,
          diceResults: [],
          appliedToolCalls: [],
          failedToolCalls: [],
          skippedToolCalls: riskReport.toolCalls
        };
        return {
          ...output,
          trace: this.traceRecorder.finish(trace, { output })
        };
      }

      const diceResults = [];
      const appliedToolCalls = [];
      const failedToolCalls = [];
      const skippedToolCalls = [];
      const resultByCheckId = new Map();

      for (const check of plan.checks) {
        const risk = riskReport.toolCalls.find((call) => call.phase === 'check' && call.id === check.id);
        if (!risk?.allowed) {
          skippedToolCalls.push({ ...risk, reason: risk?.blockReason || 'not_allowed' });
          continue;
        }
        try {
          const preparedCheck = await this.prepareCheckCall(check, input);
          const result = await this.executePlannedTool(preparedCheck, externalContext);
          const record = {
            id: preparedCheck.id,
            tool: preparedCheck.tool,
            input: preparedCheck.input,
            modifierResolution: preparedCheck.modifierResolution,
            output: result.output,
            trace: result.trace,
            outcome: result.output?.outcome,
            success: result.output?.success,
            failure: result.output?.failure,
            criticalSuccess: result.output?.criticalSuccess,
            criticalFailure: result.output?.criticalFailure
          };
          diceResults.push(record);
          resultByCheckId.set(check.id, record);
        } catch (error) {
          const failed = {
            id: check.id,
            phase: 'check',
            tool: check.tool,
            error: serializeError(error)
          };
          failedToolCalls.push(failed);
          if (!input.continueOnError) break;
        }
      }

      for (const proposal of plan.proposals) {
        const risk = riskReport.toolCalls.find((call) => call.phase === 'proposal' && call.id === proposal.id);
        if (!shouldRunProposal(proposal, resultByCheckId)) {
          skippedToolCalls.push({ ...risk, reason: 'when_not_matched' });
          continue;
        }
        if (!risk?.allowed) {
          skippedToolCalls.push({ ...risk, reason: risk?.blockReason || 'not_allowed' });
          continue;
        }
        try {
          const result = await this.executePlannedTool(proposal, externalContext);
          appliedToolCalls.push({
            id: proposal.id,
            tool: proposal.tool,
            input: proposal.input,
            output: result.output,
            trace: result.trace
          });
        } catch (error) {
          failedToolCalls.push({
            id: proposal.id,
            phase: 'proposal',
            tool: proposal.tool,
            error: serializeError(error)
          });
          if (!input.continueOnError) break;
        }
      }

      const status = failedToolCalls.length
        ? (appliedToolCalls.length || diceResults.length ? 'partial_failure' : 'failure')
        : 'success';
      const output = {
        status,
        plan,
        riskReport,
        diceResults,
        appliedToolCalls,
        failedToolCalls,
        skippedToolCalls,
        narrationHints: selectNarrationHints(plan, diceResults)
      };
      this.traceRecorder.write(trace, 'diceResults', diceResults);
      this.traceRecorder.write(trace, 'appliedToolCalls', appliedToolCalls);
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
    const trace = this.traceRecorder.start('action-resolve', { input: sanitizeActionInput(input) });
    try {
      const planned = input.plan
        ? {
          plan: normalizeActionPlan(input.plan, {
            sourceText: input.sourceText || input.text || input.content || '',
            chatSessionId: input.chatSessionId,
            sceneId: input.sceneId
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
      const absurdityJudgement = planned.absurdityJudgement || ((input.includeAbsurdity || input.absurdityJudgement || input.useAbsurdityLlm)
        ? await this.judgeAbsurdity({
          ...input,
          plan: planned.plan,
          context: planned.context,
          judgement: input.absurdityJudgement,
          useLlm: input.useAbsurdityLlm ?? input.useLlm
        })
        : undefined);
      const absurdityExplanation = shouldExplainAbsurdity(absurdityJudgement?.judgement, applied, input)
        ? await this.explainAbsurdity({
          ...input,
          plan: planned.plan,
          context: planned.context,
          judgement: absurdityJudgement.judgement,
          actionResult: applied,
          explanation: input.absurdityExplanation,
          useLlm: input.useAbsurdityExplanationLlm ?? input.useAbsurdityLlm ?? input.useLlm
        })
        : undefined;
      this.traceRecorder.write(trace, 'context', planned.context);
      this.traceRecorder.write(trace, 'plannerPrompt', planned.prompt || '');
      this.traceRecorder.write(trace, 'normalizedPlan', planned.plan);
      if (absurdityJudgement) this.traceRecorder.write(trace, 'absurdityJudgement', absurdityJudgement.judgement);
      if (absurdityExplanation) this.traceRecorder.write(trace, 'absurdityExplanation', absurdityExplanation.explanation);
      this.traceRecorder.write(trace, 'riskReport', applied.riskReport);
      this.traceRecorder.write(trace, 'diceResults', applied.diceResults);
      this.traceRecorder.write(trace, 'appliedToolCalls', applied.appliedToolCalls);
      const output = {
        status: applied.status,
        plan: planned.plan,
        absurdityJudgement,
        absurdityExplanation,
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

  async resolveWithAppeal(input = {}, options = {}) {
    const trace = this.traceRecorder.start('action-resolve-with-appeal', { input: sanitizeActionInput(input) });
    try {
      const action = normalizeAppealLoopAction(input.action);
      let output;
      if (action === 'accept') {
        output = this.acceptAppealLoop(input);
      } else if (action === 'appeal') {
        output = await this.continueAppealLoop(input, options);
      } else {
        output = await this.startAppealLoop(input, options);
      }
      this.traceRecorder.write(trace, 'appealApplication', output);
      return {
        ...output,
        trace: this.traceRecorder.finish(trace, { output })
      };
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async startAppealLoop(input = {}, options = {}) {
    const resolution = await this.resolve({
      ...stripAppealLoopFields(input),
      dryRun: input.dryRun ?? true
    }, options);
    return buildAppealLoopDecisionOutput({
      input,
      currentResolution: resolution,
      eventType: 'initial',
      now: this.now()
    });
  }

  async continueAppealLoop(input = {}, options = {}) {
    const previousState = normalizeAppealLoopState(input.loopState || input.state);
    const previousResolution = resolveAppealLoopResolution(input, previousState);
    if (!Object.keys(previousResolution).length) {
      throw validationError('resolve_with_appeal action "appeal" requires loopState or currentResolution');
    }
    const baseInput = normalizeObject(previousState.input);
    const playerArgument = buildLoopPlayerArgument(input);
    const requestInput = {
      ...baseInput,
      ...stripAppealLoopFields(input),
      chatSessionId: input.chatSessionId || previousState.chatSessionId || baseInput.chatSessionId,
      sceneId: input.sceneId || previousState.sceneId || baseInput.sceneId || 'current',
      sourceText: input.sourceText || previousState.sourceText || baseInput.sourceText,
      originalPlan: input.originalPlan || previousResolution.plan || previousState.currentPlan || previousState.originalPlan,
      originalRuling: input.originalRuling || summarizeResolutionForAppeal(previousResolution),
      playerArgument,
      requestedOutcome: input.requestedOutcome || '',
      useLlm: input.useRejudgementLlm ?? input.useLlm,
      revisedPlan: input.revisedPlan,
      decision: input.decision
    };
    const rejudgement = await this.requestRejudgement(requestInput);
    const shouldApply = input.applyRejudgement !== false
      && rejudgement.decision?.revisedPlan
      && !['rejected', 'needsMoreInfo', 'pending'].includes(rejudgement.decision.status);
    const application = shouldApply
      ? await this.applyRejudgement({
        ...requestInput,
        decision: rejudgement.decision,
        dryRun: input.dryRun ?? true,
        allowedTools: input.allowedTools || baseInput.allowedTools,
        continueOnError: input.continueOnError ?? baseInput.continueOnError
      }, options)
      : undefined;
    const currentResolution = buildResolutionFromRejudgement({
      previousResolution,
      rejudgement,
      application
    });
    return buildAppealLoopDecisionOutput({
      input: {
        ...baseInput,
        ...stripAppealLoopFields(input),
        chatSessionId: requestInput.chatSessionId,
        sceneId: requestInput.sceneId,
        sourceText: requestInput.sourceText
      },
      previousState,
      currentResolution,
      rejudgement,
      application,
      eventType: 'appeal',
      now: this.now()
    });
  }

  acceptAppealLoop(input = {}) {
    const previousState = normalizeAppealLoopState(input.loopState || input.state);
    const finalResolution = resolveAppealLoopResolution(input, previousState);
    if (!Object.keys(finalResolution).length) {
      throw validationError('resolve_with_appeal action "accept" requires loopState or currentResolution');
    }
    const loopState = {
      ...previousState,
      status: 'accepted',
      acceptedAt: this.now(),
      currentResolution: finalResolution,
      currentSummary: summarizeActionResolution(finalResolution)
    };
    return {
      status: 'accepted',
      final: true,
      prompt: '玩家已接受当前裁决，裁决循环结束。',
      loopState,
      finalResolution,
      currentResolution: finalResolution,
      appealAvailable: false,
      choices: []
    };
  }

  async buildAbsurdityPrompt(input = {}) {
    const trace = this.traceRecorder.start('action-build-absurdity-prompt', { input: sanitizeActionInput(input) });
    try {
      const context = input.context || await this.collectContext(input);
      const plan = input.plan ? normalizeActionPlan(input.plan, {
        sourceText: input.sourceText || input.text || input.content || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId
      }) : undefined;
      const prompt = buildAbsurdityJudgementPrompt({
        ...input,
        context,
        plan
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'absurdityPrompt', prompt);
      const output = {
        prompt,
        context,
        judgementShape: ACTION_ABSURDITY_JUDGEMENT_TEMPLATE,
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

  async judgeAbsurdity(input = {}) {
    const trace = this.traceRecorder.start('action-judge-absurdity', { input: sanitizeActionInput(input) });
    try {
      const context = input.context || await this.collectContext(input);
      const plan = input.plan ? normalizeActionPlan(input.plan, {
        sourceText: input.sourceText || input.text || input.content || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId
      }) : undefined;
      const prompt = buildAbsurdityJudgementPrompt({
        ...input,
        context,
        plan
      });
      const rawJudgement = input.judgement || input.absurdityJudgement || await this.createAbsurdityJudgementFromModelOrTemplate(input, prompt);
      const judgement = normalizeAbsurdityJudgement(rawJudgement, {
        sourceText: input.sourceText || input.text || input.content || plan?.sourceText || '',
        plan
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'absurdityPrompt', prompt);
      this.traceRecorder.write(trace, 'absurdityJudgement', judgement);
      const output = {
        judgement,
        rawJudgement,
        prompt,
        context,
        trace: this.traceRecorder.finish(trace, {
          output: {
            judgementId: judgement.judgementId,
            absurdityLevel: judgement.absurdityLevel,
            requiresExplanation: judgement.requiresAbsurdityExplanationOnSuccess
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async buildAbsurdityExplanationPrompt(input = {}) {
    const trace = this.traceRecorder.start('action-build-absurdity-explanation-prompt', { input: sanitizeActionInput(input) });
    try {
      const context = input.context || await this.collectContext(input);
      const plan = input.plan ? normalizeActionPlan(input.plan, {
        sourceText: input.sourceText || input.text || input.content || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId
      }) : undefined;
      const judgement = normalizeAbsurdityJudgement(input.judgement || input.absurdityJudgement || {}, {
        sourceText: input.sourceText || input.text || input.content || plan?.sourceText || '',
        plan
      });
      const prompt = buildAbsurdityExplanationPrompt({
        ...input,
        context,
        plan,
        judgement
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'absurdityExplanationPrompt', prompt);
      const output = {
        prompt,
        context,
        judgement,
        explanationShape: ACTION_ABSURDITY_EXPLANATION_TEMPLATE,
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

  async explainAbsurdity(input = {}) {
    const trace = this.traceRecorder.start('action-explain-absurdity', { input: sanitizeActionInput(input) });
    try {
      const context = input.context || await this.collectContext(input);
      const plan = input.plan ? normalizeActionPlan(input.plan, {
        sourceText: input.sourceText || input.text || input.content || '',
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId
      }) : undefined;
      const judgement = normalizeAbsurdityJudgement(input.judgement || input.absurdityJudgement || {}, {
        sourceText: input.sourceText || input.text || input.content || plan?.sourceText || '',
        plan
      });
      const prompt = buildAbsurdityExplanationPrompt({
        ...input,
        context,
        plan,
        judgement
      });
      const rawExplanation = input.explanation || input.absurdityExplanation || await this.createAbsurdityExplanationFromModelOrTemplate(input, prompt, judgement);
      const explanation = normalizeAbsurdityExplanation(rawExplanation, {
        sourceText: input.sourceText || input.text || input.content || plan?.sourceText || '',
        judgement,
        actionResult: input.actionResult || input.result || input.apply
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'absurdityJudgement', judgement);
      this.traceRecorder.write(trace, 'absurdityExplanationPrompt', prompt);
      this.traceRecorder.write(trace, 'absurdityExplanation', explanation);
      const output = {
        explanation,
        rawExplanation,
        prompt,
        context,
        judgement,
        trace: this.traceRecorder.finish(trace, {
          output: {
            explanationId: explanation.explanationId,
            status: explanation.status,
            explanationMode: explanation.explanationMode
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async buildAppealPrompt(input = {}) {
    const trace = this.traceRecorder.start('action-build-appeal-prompt', { input: sanitizeActionInput(input) });
    try {
      const context = await this.collectContext({
        ...input,
        query: input.query || input.playerArgument || input.sourceText || input.text || input.content
      });
      const prompt = buildActionAppealPrompt({
        ...input,
        context
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'appealPrompt', prompt);
      const output = {
        prompt,
        context,
        decisionShape: ACTION_APPEAL_DECISION_TEMPLATE,
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

  async requestRejudgement(input = {}) {
    const trace = this.traceRecorder.start('action-request-rejudgement', { input: sanitizeActionInput(input) });
    try {
      const context = await this.collectContext({
        ...input,
        query: input.query || input.playerArgument || input.sourceText || input.text || input.content
      });
      const prompt = buildActionAppealPrompt({
        ...input,
        context
      });
      const rawDecision = input.decision || await this.createAppealDecisionFromModelOrTemplate(input, prompt);
      const decision = normalizeAppealDecision(rawDecision, {
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId,
        sourceText: input.sourceText || input.text || input.content || input.originalActionText || '',
        playerArgument: input.playerArgument,
        requestedOutcome: input.requestedOutcome,
        originalPlan: input.originalPlan || input.plan
      });
      this.traceRecorder.write(trace, 'context', context);
      this.traceRecorder.write(trace, 'appealPrompt', prompt);
      this.traceRecorder.write(trace, 'appealDecision', decision);
      const output = {
        decision,
        rawDecision,
        prompt,
        context,
        trace: this.traceRecorder.finish(trace, {
          output: {
            appealId: decision.appealId,
            status: decision.status,
            hasRevisedPlan: Boolean(decision.revisedPlan)
          }
        })
      };
      return output;
    } catch (error) {
      this.traceRecorder.fail(trace, { error });
      throw error;
    }
  }

  async applyRejudgement(input = {}, options = {}) {
    const trace = this.traceRecorder.start('action-apply-rejudgement', { input: sanitizeActionInput(input) });
    try {
      const decision = normalizeAppealDecision(input.decision || input, {
        chatSessionId: input.chatSessionId,
        sceneId: input.sceneId,
        sourceText: input.sourceText || input.text || input.content || '',
        playerArgument: input.playerArgument,
        requestedOutcome: input.requestedOutcome,
        originalPlan: input.originalPlan || input.plan
      });
      this.traceRecorder.write(trace, 'appealDecision', decision);

      if (!decision.revisedPlan || ['rejected', 'needsMoreInfo', 'pending'].includes(decision.status)) {
        const output = {
          status: 'skipped',
          reason: decision.revisedPlan ? 'decision_not_accepted' : 'no_revised_plan',
          decision,
          apply: undefined
        };
        this.traceRecorder.write(trace, 'appealApplication', output);
        return {
          ...output,
          trace: this.traceRecorder.finish(trace, { output })
        };
      }

      const applied = await this.applyPlan({
        ...input,
        plan: decision.revisedPlan,
        dryRun: input.dryRun ?? true
      }, options);
      const output = {
        status: applied.status,
        decision,
        apply: applied
      };
      this.traceRecorder.write(trace, 'riskReport', applied.riskReport);
      this.traceRecorder.write(trace, 'diceResults', applied.diceResults);
      this.traceRecorder.write(trace, 'appliedToolCalls', applied.appliedToolCalls);
      this.traceRecorder.write(trace, 'appealApplication', output);
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
    const query = input.query || input.ragQuery || input.sourceText || input.text || input.content || '';
    const context = {
      chatSessionId,
      sceneId,
      query,
      collectedAt: this.now(),
      sources: {},
      errors: []
    };
    if (!chatSessionId || input.includeContext === false) return context;

    if (input.useContextCompleteness !== false) {
      const completeness = await safeExecuteTool(this.toolManager, 'system.context_completeness.resolve_context', {
        chatSessionId,
        sceneId,
        query,
        intent: input.intent || input.actionType || 'adjudication',
        actorIds: extractContextActorIds(input),
        riskHint: input.riskHint || input.risk || input.difficultyHint,
        missingPolicy: input.missingPolicy || 'report_only',
        maxContextTokens: input.maxContextTokens || 3000,
        includeRag: input.includeRag !== false,
        contextPlannerInput: {
          includeRecentMessages: false
        }
      });
      if (completeness.ok) context.sources.contextCompleteness = completeness.output;
      else if (!/not registered/i.test(completeness.error?.message || '')) context.errors.push({ key: 'contextCompleteness', tool: 'system.context_completeness.resolve_context', error: completeness.error });
    }

    const calls = [
      ['sceneNpcs', 'system.scene_npcs.list_mounted_npcs', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
      ['sceneMaps', 'system.scene_maps.list_mounted_maps', { chatSessionId, sceneId, includeInactive: false, limit: 50 }],
      ['npcStates', 'system.npc_state.list_states', { chatSessionId, sceneId, limit: 100 }],
      ['mapStates', 'system.map_state.list_states', { chatSessionId, sceneId, limit: 100 }],
      ['partyMembers', 'system.party.list_members', { chatSessionId, includeInactive: true, limit: 100 }],
      ['partyContext', 'system.party.build_prompt_context', { chatSessionId, includeInactive: true, limit: 100 }],
      ['timeClock', 'system.time.get_clock', { chatSessionId, sceneId }],
      ['timeEncounter', 'system.time.get_encounter', { chatSessionId }],
      ['timeTurnOrder', 'system.time.list_turn_order', { chatSessionId, includeInactive: false, limit: 100 }],
      ['characterMemory', 'system.character_memory.get_prompt_context', { chatSessionId, sceneId, maxContextTokens: 2000 }]
    ];
    for (const [key, tool, toolInput] of calls) {
      const result = await safeExecuteTool(this.toolManager, tool, toolInput);
      if (result.ok) context.sources[key] = result.output;
      else context.errors.push({ key, tool, error: result.error });
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

  async semanticNormalizePlan(plan = {}, input = {}, { context, trace } = {}) {
    const basePlan = normalizeActionPlan(plan, {
      sourceText: input.sourceText || input.text || input.content || plan.sourceText || '',
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId
    });
    const sourceText = normalizeOptionalText(input.sourceText || input.text || input.content || basePlan.sourceText);
    let decision = normalizeSemanticWriteDecision(input.semanticWriteDecision || input.databaseWriteDecision || input.writeDecision);
    const shouldProbeWithoutBaseProposals = basePlan.proposals.length === 0
      && !decision
      && shouldUseSemanticWriteLlm(input)
      && shouldRunSemanticWriteWithoutBaseProposals(sourceText, input);
    if (input.semanticWritePlanning === false || input.useSemanticWritePlanning === false || (basePlan.proposals.length === 0 && !decision && !shouldProbeWithoutBaseProposals)) {
      return {
        status: 'skipped',
        reason: input.semanticWritePlanning === false || input.useSemanticWritePlanning === false
          ? 'semantic_write_planning_disabled'
          : 'no_database_proposals',
        plan: basePlan,
        summary: {
          status: 'skipped',
          reason: input.semanticWritePlanning === false || input.useSemanticWritePlanning === false
            ? 'semantic_write_planning_disabled'
            : 'no_database_proposals'
        }
      };
    }

    const prompt = buildSemanticWritePlannerPrompt({
      sourceText,
      plan: basePlan,
      context,
      availableTools: DEFAULT_ACTION_ALLOWED_TOOLS,
      userRules: input.semanticWriteRules || input.databaseWriteRules || input.userRules
    });
    let llmUsed = false;
    let llmError;
    if (!decision && shouldUseSemanticWriteLlm(input) && this.chatProvider && typeof this.chatProvider.generate === 'function') {
      try {
        const completion = await this.chatProvider.generate({
          messages: [
            {
              role: 'system',
              content: 'Return one Semantic Database Write Decision JSON object only. Do not include markdown.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: input.semanticWriteTemperature ?? input.temperature ?? 0,
          maxTokens: input.semanticWriteMaxTokens || input.maxTokens || 2400
        });
        decision = normalizeSemanticWriteDecision(parseJsonObject(completion.content));
        llmUsed = true;
      } catch (error) {
        llmError = serializeError(error);
        if (input.requireSemanticWriteLlm) throw error;
      }
    }

    const decisionApplied = decision
      ? applySemanticWriteDecision(basePlan, decision, input)
      : basePlan;
    const fallbackApplied = applySemanticWriteFallbacks(decisionApplied, {
      sourceText,
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId
    });
    const finalPlan = normalizeActionPlan({
      ...fallbackApplied,
      metadata: {
        ...normalizeObject(fallbackApplied.metadata),
        semanticWritePlanning: {
          status: decision ? 'decision_applied' : 'fallback_applied',
          llmUsed,
          decisionId: decision?.decisionId,
          changedProposalCount: countChangedProposals(basePlan.proposals, fallbackApplied.proposals),
          fallbackApplied: true,
          llmError
        }
      }
    }, {
      sourceText,
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId
    });
    const output = {
      status: decision ? 'decision_applied' : 'fallback_applied',
      prompt,
      decision,
      llmUsed,
      llmError,
      plan: finalPlan,
      summary: {
        status: decision ? 'decision_applied' : 'fallback_applied',
        llmUsed,
        decisionId: decision?.decisionId,
        changedProposalCount: countChangedProposals(basePlan.proposals, finalPlan.proposals),
        proposalCount: finalPlan.proposals.length,
        llmError
      }
    };
    this.traceRecorder.write(trace, 'semanticWritePrompt', prompt);
    this.traceRecorder.write(trace, 'semanticWriteDecision', {
      decision,
      llmUsed,
      llmError,
      summary: output.summary
    });
    return output;
  }

  async createPlanFromModelOrTemplate(input, prompt, template) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('Action planning requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one Action Plan JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0,
        maxTokens: input.maxTokens || 2000
      });
      return parseJsonObject(completion.content);
    }
    const plan = fillTemplateValues(input.planTemplate || template.planTemplate, {
      chatSessionId: input.chatSessionId,
      sceneId: input.sceneId || 'current',
      sourceText: input.sourceText || input.text || input.content || ''
    });
    return applyDefaultActionPlanHeuristics(plan, input, {
      skipDifficultyInference: Boolean(input.planTemplate)
    });
  }

  async createAppealDecisionFromModelOrTemplate(input, prompt) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('Action rejudgement requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one rejudgement decision JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0,
        maxTokens: input.maxTokens || 2000
      });
      return parseJsonObject(completion.content);
    }
    const heuristicDecision = buildHeuristicAppealDecision(input);
    if (heuristicDecision) return heuristicDecision;
    return {
      ...ACTION_APPEAL_DECISION_TEMPLATE,
      appealId: createId('appeal'),
      status: 'pending',
      originalActionId: input.originalPlan?.actionId || input.plan?.actionId || '',
      disputedRuling: input.originalRuling || input.originalNarration || '',
      playerArgument: input.playerArgument || '',
      requestedOutcome: input.requestedOutcome || '',
      summary: 'Pending human or LLM rejudgement. Review the appeal prompt and provide a decision.',
      revisedPlan: input.revisedPlan || undefined
    };
  }

  async createAbsurdityJudgementFromModelOrTemplate(input, prompt) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('Absurdity judgement requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one absurdity judgement JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0.2,
        maxTokens: input.maxTokens || 2000
      });
      return parseJsonObject(completion.content);
    }
    const heuristic = buildHeuristicAbsurdityJudgement(input);
    if (heuristic) return heuristic;
    return {
      ...ACTION_ABSURDITY_JUDGEMENT_TEMPLATE,
      judgementId: createId('absurd'),
      status: 'notEvaluated',
      absurdityLevel: 'ordinary',
      summary: 'Pending human or LLM absurdity judgement. Absurdity is not automatic failure.',
      canAttempt: true,
      shouldRollOrResolve: true,
      requiresAbsurdityExplanationOnSuccess: false,
      metadata: {
        source: 'template'
      }
    };
  }

  async createAbsurdityExplanationFromModelOrTemplate(input, prompt, judgement) {
    if (input.useLlm) {
      if (!this.chatProvider || typeof this.chatProvider.generate !== 'function') {
        throw validationError('Absurdity explanation requested LLM, but no chatProvider is available');
      }
      const completion = await this.chatProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Return one absurdity explanation JSON object only. Do not include markdown unless unavoidable.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: input.temperature ?? 0.5,
        maxTokens: input.maxTokens || 2400
      });
      return parseJsonObject(completion.content);
    }
    const heuristic = buildHeuristicAbsurdityExplanation(input, judgement);
    if (heuristic) return heuristic;
    return {
      ...ACTION_ABSURDITY_EXPLANATION_TEMPLATE,
      explanationId: createId('absurdexp'),
      status: judgement?.requiresAbsurdityExplanationOnSuccess ? 'needsHuman' : 'notNeeded',
      premise: input.sourceText || input.text || input.content || '',
      acceptedOutcome: 'Pending explanation. The successful absurd result should be honored in a playable way.',
      explanation: '',
      metadata: {
        source: 'template'
      }
    };
  }

  async executePlannedTool(call, externalContext) {
    const cleanContext = sanitizeExecutionContext(externalContext);
    return this.toolManager.executeTool(call.tool, call.input || {}, undefined, cleanContext);
  }

  async prepareCheckCall(call, actionInput = {}) {
    if (call.tool !== 'game.dice.check') return call;
    if (actionInput.useModifierResolver === false || actionInput.applyModifiers === false || call.input?.useModifierResolver === false) return call;
    if (!this.toolManager?.getTool || !this.toolManager?.executeTool) return call;
    try {
      this.toolManager.getTool('system.modifiers.resolve_check_modifiers');
    } catch {
      return call;
    }
    const actorId = normalizeOptionalText(
      call.input?.actorId
      || call.input?.npcId
      || call.input?.playerId
      || call.metadata?.actorId
      || actionInput.actorId
      || actionInput.npcId
      || actionInput.playerId
      || normalizeStringArray(actionInput.actorIds || actionInput.npcIds)[0]
    );
    if (!actorId) return call;
    const targetId = normalizeOptionalText(
      call.input?.targetId
      || call.input?.targetNpcId
      || call.metadata?.targetId
      || actionInput.targetId
      || actionInput.targetNpcId
      || normalizeStringArray(actionInput.targetIds || actionInput.targets)[0]
    );
    const result = await safeExecuteTool(this.toolManager, 'system.modifiers.resolve_check_modifiers', {
      chatSessionId: actionInput.chatSessionId || call.input?.chatSessionId,
      sceneId: actionInput.sceneId || call.input?.sceneId || 'current',
      actorId,
      targetId,
      checkKind: call.metadata?.checkKind || call.metadata?.kind || call.metadata?.skill ? 'skill' : (call.metadata?.ability ? 'ability' : 'check'),
      actionId: actionInput.actionId,
      ability: call.metadata?.ability || call.input?.ability,
      skillId: call.metadata?.skillId || call.metadata?.skill || call.input?.skillId || call.input?.skill,
      base: call.input,
      successThresholdLocked: true
    });
    if (!result.ok || !result.output?.resolved) return call;
    const { modifierBreakdown, ...resolvedDiceInput } = result.output.resolved;
    return {
      ...call,
      input: stripModifierOnlyFields({
        ...call.input,
        ...resolvedDiceInput
      }),
      modifierResolution: {
        ...result.output,
        resolved: result.output.resolved,
        modifierBreakdown
      }
    };
  }
}

export function buildActionPlannerPrompt({
  sourceText = '',
  text,
  content,
  context = {},
  routerIntent,
  actionPacing,
  plannerPrompt = '',
  userRules = '',
  template = ACTION_RESOLVER_TEMPLATES.generic,
  allowedTools = DEFAULT_ACTION_ALLOWED_TOOLS,
  planTemplate
} = {}) {
  const selectedTemplate = template || ACTION_RESOLVER_TEMPLATES.generic;
  const templatePlan = planTemplate || selectedTemplate.planTemplate || ACTION_RESOLVER_TEMPLATES.generic.planTemplate;
	  return [
	    plannerPrompt || selectedTemplate.plannerPrompt || ACTION_RESOLVER_TEMPLATES.generic.plannerPrompt,
	    userRules ? `User adjudication rules:\n${userRules}` : '',
	    'Important permission model:',
	    '- You may propose any tool call, but you cannot authorize tools.',
	    '- Do not include context.authorization or user approval in the plan. User authorization comes only from the outer execution context.',
	    '- The executor will strip any context fields from planned tool calls.',
	    'Available/default allowed tools for normal execution:',
	    JSON.stringify(allowedTools || DEFAULT_ACTION_ALLOWED_TOOLS, null, 2),
	    'State impact contract:',
	    [
	      '- Any concrete change caused by the ruling must be represented as a proposal tool call, not only described in narration.',
	      '- Actor values/statusBar/skillBar/specialStatuses/inventory/resources/equipment -> system.npc_state.patch_state.',
	      '- Reusable skills/statuses/feats -> system.mechanics_registry.*; reusable items/equipment/weapons/accessories/mounts/special items -> system.item_registry.*.',
	      '- NPC relations, map state/routes, faction state, quest state, RAG/memory, and extension DB changes -> the matching available tool or system.data.quantify_text.',
	      '- If a fitting extension tool is not listed, include a proposal using the closest explicit data tool and explain the missing route in metadata.'
	    ].join('\n'),
	    routerIntent || actionPacing ? `Router classification and pacing:\n${JSON.stringify({
	      routerIntent: routerIntent || undefined,
	      actionPacing: actionPacing || undefined
	    }, null, 2)}` : '',
	    actionPacing?.mode === 'macro_resolution'
	      ? [
	          'Macro action pacing rule:',
	          '- Treat the player text as a declared broad action or action sequence to adjudicate this turn.',
	          '- Resolve a meaningful batch outcome now: what was attempted, how well it went, costs/risks, concrete state changes, and one concise follow-up hook.',
	          '- Do not convert the action into a slow step-by-step menu, travel chain, or task list unless a required target/resource/irreversible choice is genuinely missing.',
	          '- If the exact claimed outcome is too strong, adjudicate partial progress, complications, resource costs, time passage, or a check rather than stalling.'
	        ].join('\n')
	      : '',
	    'Current action text:',
	    String(sourceText || text || content || ''),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one Action Plan JSON object. Use this template as a debug reference, not as a fixed rule schema:',
    JSON.stringify(templatePlan, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function buildActionAppealPrompt({
  sourceText = '',
  text,
  content,
  originalActionText = '',
  originalPlan,
  originalRuling = '',
  originalResult,
  originalNarration = '',
  playerArgument = '',
  playerEvidence = [],
  requestedOutcome = '',
  context = {},
  appealPrompt = '',
  userRules = '',
  decisionTemplate = ACTION_APPEAL_DECISION_TEMPLATE
} = {}) {
  return [
    appealPrompt || [
      'You are a re-adjudication reviewer for an interactive text RPG.',
      'The player may challenge the GM ruling with rules, context, or fairness arguments.',
      'Evaluate the challenge on its merits. Do not defend the original ruling by default.',
      'Do not execute tools, roll dice, or mutate state. If the ruling should change, propose a revisedPlan or rollback recommendation.',
      'If the player lacks evidence, explain what information is missing instead of inventing facts.'
    ].join('\n'),
    userRules ? `User adjudication rules:\n${userRules}` : '',
    'Original action text:',
    String(originalActionText || sourceText || text || content || ''),
    'Original Action Plan, if available:',
    JSON.stringify(originalPlan || {}, null, 2),
    'Original ruling/result/narration:',
    JSON.stringify({
      originalRuling,
      originalResult,
      originalNarration
    }, null, 2),
    'Player appeal argument:',
    String(playerArgument || ''),
    'Player evidence or citations:',
    JSON.stringify(normalizeArray(playerEvidence), null, 2),
    'Requested outcome:',
    String(requestedOutcome || ''),
    'Collected current context:',
    JSON.stringify(context || {}, null, 2),
    'Return one rejudgement decision JSON object. Use this shape as a debug reference, not as a fixed rule database:',
    JSON.stringify(decisionTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function buildAbsurdityJudgementPrompt({
  sourceText = '',
  text,
  content,
  plan,
  context = {},
  absurdityPrompt = '',
  userRules = '',
  absurdityRules = '',
  tone = '',
  judgementTemplate = ACTION_ABSURDITY_JUDGEMENT_TEMPLATE
} = {}) {
  return [
    absurdityPrompt || [
      'You judge relative absurdity for an interactive text RPG action.',
      'Absurdity is relative, not automatic failure. A god proposing to a god is less absurd than a mortal proposing to an unknowable god; persuading gravity may work in some cosmologies.',
      'Judge the premise qualitatively. Do not convert this into a numeric score. Do not decide success or failure; the normal action check/resolution decides that.',
      'Consider identities of both sides, power gap, access/interactivity, NPC persona and consent/agency, taboo or boundary issues, special abilities, hidden settings, genre logic, world rules, current scene facts, and prior interactions.',
      'If the action is absurd but playable, mark requiresAbsurdityExplanationOnSuccess=true and provide explanationSeeds.',
      'Avoid shutting down player creativity. Prefer canAttempt=true unless user rules, table boundaries, or context clearly forbid the attempt.',
      'Return one JSON object only.'
    ].join('\n'),
    userRules ? `User/table rules:\n${userRules}` : '',
    absurdityRules ? `Absurdity-specific rules:\n${absurdityRules}` : '',
    tone ? `Desired tone:\n${tone}` : '',
    'Action text:',
    String(sourceText || text || content || plan?.sourceText || ''),
    'Action plan, if available:',
    JSON.stringify(plan || {}, null, 2),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one absurdity judgement JSON object. Use this shape as a debug reference, not as a fixed rule database:',
    JSON.stringify(judgementTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function buildAbsurdityExplanationPrompt({
  sourceText = '',
  text,
  content,
  plan,
  judgement,
  actionResult,
  result,
  context = {},
  explanationPrompt = '',
  userRules = '',
  absurdityRules = '',
  tone = '',
  explanationTemplate = ACTION_ABSURDITY_EXPLANATION_TEMPLATE
} = {}) {
  return [
    explanationPrompt || [
      'You explain a successful absurd RPG action so the game can continue.',
      'Honor the successful ruling. Do not simply deny the success because the premise is strange.',
      'Success may be literal, symbolic, partial-but-real, a loophole, a pact, a misunderstanding, a prophecy, a cosmic joke, a hidden-setting reveal, or a playable genre-comedy twist.',
      'Preserve meaningful consequences. Very absurd successes can create obligations, faction shifts, cosmic attention, rumors, new statuses, temporary boons, costs, or future hooks.',
      'Respect NPC agency, table boundaries, and tone. Keep explicit sexual content out; if romance/taboo is involved, explain in a playable non-graphic way.',
      'Return one JSON object only.'
    ].join('\n'),
    userRules ? `User/table rules:\n${userRules}` : '',
    absurdityRules ? `Absurdity-specific rules:\n${absurdityRules}` : '',
    tone ? `Desired tone:\n${tone}` : '',
    'Successful action text:',
    String(sourceText || text || content || plan?.sourceText || ''),
    'Action plan:',
    JSON.stringify(plan || {}, null, 2),
    'Absurdity judgement:',
    JSON.stringify(judgement || {}, null, 2),
    'Action result / dice / application output:',
    JSON.stringify(actionResult || result || {}, null, 2),
    'Collected context:',
    JSON.stringify(context || {}, null, 2),
    'Return one absurdity explanation JSON object. Use this shape as a debug reference, not as a fixed rule database:',
    JSON.stringify(explanationTemplate, null, 2)
  ].filter(Boolean).join('\n\n');
}

export function normalizeActionPlan(input = {}, { sourceText = '', chatSessionId, sceneId = 'current' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Action plan must be a plain object');
  }
  const actionId = normalizeOptionalText(input.actionId || input.id) || createId('act');
  const resolvedSourceText = normalizeOptionalText(input.sourceText || sourceText);
  const plan = {
    actionId,
    sourceText: resolvedSourceText,
    intent: normalizeIntent(input.intent),
    checks: normalizePlanCalls(input.checks || [], {
      phase: 'check',
      chatSessionId,
      sceneId
    }),
    proposals: normalizePlanCalls(input.proposals || input.stateChangeProposals || [], {
      phase: 'proposal',
      chatSessionId,
      sceneId
    }),
    narrationHints: normalizeObject(input.narrationHints),
    metadata: normalizeObject(input.metadata)
  };
  return plan;
}

function buildSemanticWritePlannerPrompt({
  sourceText = '',
  plan = {},
  context,
  availableTools = DEFAULT_ACTION_ALLOWED_TOOLS,
  userRules = ''
} = {}) {
  return [
    '# Semantic Database Write Planner',
    '',
    'You decide how adjudicated state-change proposals should be represented in databases.',
    'First tokenize the source text into concrete proper nouns, named resources, named mechanics, locations, organizations, relationships, and explicit setting facts.',
    'Then classify each token into exactly one best database destination: NPC registry/state, current-scene NPC mount, current-scene map mount, party roster/activity, item registry/inventory, mechanics registry/skillBar/status/feat, map registry/routes/state, quest log, faction graph, relationship graph, or extension data.',
    'If a token or fact does not fit any existing destination, create a new proposal with system.data.quantify_text, including collection name, field definitions, literal value, and original source text.',
    'Use one response to both correct existing proposals and add missing proposals; do not rely on narration to carry facts that should be queryable.',
    'Do not merely copy literal player words into database entities or fields when they are abstract, setting-dependent, or better represented by an existing numeric/currency/status field.',
    'Choose the most suitable existing tool and field. If no existing collection/field fits, propose system.data.quantify_text with a clear collection and field definition.',
    'Keep concrete proper nouns as names when they are actual NPCs, maps, factions, quests, or unique items.',
    'Drop or rewrite misleading proposals. Preserve original wording in metadata.originalTerm/sourceText for debugging.',
    'Never mark an attempted player claim as fact unless the proposal is already gated by a successful adjudication.',
    userRules ? `\n# User Rules\n${userRules}` : '',
    '',
    '# Source Text',
    sourceText || '(empty)',
    '',
    '# Available Write Tools',
    JSON.stringify(availableTools, null, 2),
    '',
    '# Current Action Plan Proposals',
    JSON.stringify((plan.proposals || []).map((proposal) => ({
      id: proposal.id,
      tool: proposal.tool,
      when: proposal.when,
      checkId: proposal.checkId,
      input: proposal.input,
      metadata: proposal.metadata
    })), null, 2),
    '',
    '# Context Summary',
    JSON.stringify(compactSemanticContext(context), null, 2),
    '',
    '# Return JSON Shape',
    JSON.stringify({
      decisionId: 'semantic_write_decision_id',
      summary: 'Short reasoned summary.',
      tokenClassification: [
        {
          token: 'proper noun or named fact from source text',
          classification: 'npc | scene_npc_mount | scene_npc_departure | scene_map_mount | scene_map_departure | party_member | party_activity | item | inventory | skill | status | feat | map | quest | faction | npc_relationship | faction_relationship | currency | extension_data | ignore',
          databaseTarget: 'tool id or collection/field target',
          reason: 'Why this token belongs there.'
        }
      ],
      updates: [
        {
          proposalId: 'existing proposal id',
          action: 'keep | patch | replace | drop',
          tool: 'optional replacement tool id',
          input: { note: 'replacement or patch input' },
          reason: 'Why this database/field is semantically correct.',
          metadata: {
            originalTerm: 'literal term if rewritten',
            canonicalKind: 'currency | item | status | npc | map | faction | quest | relationship | extension_data'
          }
        }
      ],
      newProposals: [
        {
          id: 'optional new proposal id',
          tool: 'system.data.quantify_text or another allowed write tool',
          when: 'success',
          input: {},
          reason: 'Why a new proposal is needed.',
          metadata: {}
        }
      ],
      droppedProposalIds: []
    }, null, 2)
  ].filter(Boolean).join('\n');
}

function compactSemanticContext(context = {}) {
  const sources = normalizeObject(context.sources);
  const output = {};
  for (const [key, value] of Object.entries(sources)) {
    if (['contextCompleteness', 'npcStates', 'mapStates', 'sceneNpcs', 'sceneMaps', 'partyMembers', 'partyContext', 'timeClock', 'runtimeRag', 'permanentRag'].includes(key)) {
      output[key] = truncateJsonForPrompt(value, 1800);
    }
  }
  return output;
}

function truncateJsonForPrompt(value, maxChars = 1800) {
  const text = JSON.stringify(value || {}, null, 2);
  if (text.length <= maxChars) return value;
  return {
    truncated: true,
    preview: `${text.slice(0, maxChars)}...`
  };
}

function shouldUseSemanticWriteLlm(input = {}) {
  if (input.dryRun === true && input.allowExternalApiInDryRun !== true) return false;
  if (input.useSemanticWriteLlm !== undefined) return input.useSemanticWriteLlm === true;
  if (input.semanticWriteLlm !== undefined) return input.semanticWriteLlm === true;
  if (input.useDatabaseWriteLlm !== undefined) return input.useDatabaseWriteLlm === true;
  return input.useLlm === true;
}

function shouldRunSemanticWriteWithoutBaseProposals(sourceText = '', input = {}) {
  if (input.requireSemanticWriteLlm === true) return true;
  const source = String(sourceText || '').normalize('NFKC').trim();
  if (!source) return false;
  return hasTokenizedWorldFactCue(source)
    || hasSceneNpcPresenceCue(source)
    || hasSceneMapPresenceCue(source)
    || hasPartyRosterCue(source)
    || /数据库|入库|写库|补漏|分类器|token|tokenizer|专有名词|专名|抽取|提取|参考文本|世界观设定|设定项|专长|天赋|特质|特性|专精/u.test(source)
    || /\b(database|tokenizer|classifier|classify|proper noun|named fact|lore fact|setting fact|feat|perk|talent|trait|specialty)\b/i.test(source);
}

function normalizeSemanticWriteDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return {
    decisionId: normalizeOptionalText(value.decisionId || value.id) || createId('semantic_write'),
    summary: normalizeOptionalText(value.summary || value.reason),
    tokenClassification: normalizeArray(value.tokenClassification || value.tokens || value.classifications)
      .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      .map((entry) => ({
        token: normalizeOptionalText(entry.token || entry.name || entry.text),
        classification: normalizeOptionalText(entry.classification || entry.kind || entry.type),
        databaseTarget: normalizeOptionalText(entry.databaseTarget || entry.target || entry.tool || entry.collection),
        tool: normalizeOptionalText(entry.tool || entry.toolId || (/^system\./.test(String(entry.databaseTarget || entry.target || '')) ? (entry.databaseTarget || entry.target) : '')),
        input: normalizeObject(entry.input || entry.toolInput),
        when: normalizeOptionalText(entry.when),
        checkId: normalizeOptionalText(entry.checkId),
        status: normalizeOptionalText(entry.status || entry.relationStatus || entry.learningStatus),
        relationType: normalizeOptionalText(entry.relationType || entry.relationshipType),
        fromName: normalizeOptionalText(entry.fromName || entry.fromNpcName || entry.fromFactionName),
        toName: normalizeOptionalText(entry.toName || entry.toNpcName || entry.toFactionName),
        fromId: normalizeOptionalText(entry.fromId || entry.fromNpcId || entry.fromFactionId),
        toId: normalizeOptionalText(entry.toId || entry.toNpcId || entry.toFactionId),
        fromNpcId: normalizeOptionalText(entry.fromNpcId),
        toNpcId: normalizeOptionalText(entry.toNpcId),
        fromFactionId: normalizeOptionalText(entry.fromFactionId),
        toFactionId: normalizeOptionalText(entry.toFactionId),
        quantity: Number.isFinite(Number(entry.quantity ?? entry.count ?? entry.amount)) ? Number(entry.quantity ?? entry.count ?? entry.amount) : undefined,
        value: entry.value ?? entry.factValue ?? entry.metricValue,
        collection: normalizeOptionalText(entry.collection || (/^system\./.test(String(entry.databaseTarget || entry.target || '')) ? '' : (entry.databaseTarget || entry.target))),
        field: normalizeOptionalText(entry.field || entry.fieldName || entry.metricName || entry.factName),
        reason: normalizeOptionalText(entry.reason || entry.summary),
        metadata: normalizeObject(entry.metadata)
      }))
      .filter((entry) => entry.token || entry.classification || entry.databaseTarget),
    updates: normalizeArray(value.updates || value.proposalUpdates || value.rewrites)
      .filter((update) => update && typeof update === 'object' && !Array.isArray(update))
      .map((update, index) => ({
        proposalId: normalizeOptionalText(update.proposalId || update.id || update.targetProposalId),
        action: normalizeSemanticWriteAction(update.action || update.mode),
        tool: normalizeOptionalText(update.tool || update.toolId),
        input: normalizeObject(update.input || update.patch || update.replacementInput),
        reason: normalizeOptionalText(update.reason || update.summary),
        metadata: normalizeObject(update.metadata),
        order: index
      }))
      .filter((update) => update.proposalId),
    newProposals: normalizeArray(value.newProposals || value.addProposals || value.proposals)
      .filter((proposal) => proposal && typeof proposal === 'object' && !Array.isArray(proposal))
      .map((proposal, index) => ({
        id: normalizeOptionalText(proposal.id) || `semantic_proposal_${index + 1}`,
        tool: normalizeOptionalText(proposal.tool || proposal.toolId),
        input: normalizeObject(proposal.input),
        when: proposal.when || 'success',
        checkId: normalizeOptionalText(proposal.checkId),
        metadata: {
          ...normalizeObject(proposal.metadata),
          semanticWrite: removeUndefined({
            source: 'semantic_write_decision',
            reason: normalizeOptionalText(proposal.reason || proposal.summary)
          })
        }
      }))
      .filter((proposal) => proposal.tool),
    droppedProposalIds: compactUnique(value.droppedProposalIds || value.dropProposalIds || value.drops)
  };
}

function normalizeSemanticWriteAction(value = '') {
  const action = String(value || '').trim().toLowerCase();
  if (['drop', 'delete', 'remove', 'skip'].includes(action)) return 'drop';
  if (['replace', 'rewrite', 'redirect'].includes(action)) return 'replace';
  if (['patch', 'merge', 'update'].includes(action)) return 'patch';
  return 'keep';
}

function applySemanticWriteDecision(plan = {}, decision = {}, input = {}) {
  const sourceText = normalizeOptionalText(input.sourceText || input.text || input.content || plan.sourceText);
  const byId = new Map(normalizeArray(plan.proposals).map((proposal) => [proposal.id, clonePlain(proposal)]));
  for (const id of decision.droppedProposalIds || []) byId.delete(id);
  for (const update of decision.updates || []) {
    const previous = byId.get(update.proposalId);
    if (!previous) continue;
    if (update.action === 'drop') {
      byId.delete(update.proposalId);
      continue;
    }
    const semanticMetadata = removeUndefined({
      source: 'semantic_write_decision',
      decisionId: decision.decisionId,
      reason: update.reason,
      ...normalizeObject(update.metadata)
    });
    if (update.action === 'replace') {
      byId.set(update.proposalId, {
        ...previous,
        tool: update.tool || previous.tool,
        input: Object.keys(update.input || {}).length ? update.input : previous.input,
        metadata: {
          ...normalizeObject(previous.metadata),
          semanticWrite: semanticMetadata
        }
      });
    } else if (update.action === 'patch') {
      byId.set(update.proposalId, {
        ...previous,
        tool: update.tool || previous.tool,
        input: mergePlain(previous.input, update.input),
        metadata: {
          ...normalizeObject(previous.metadata),
          semanticWrite: semanticMetadata
        }
      });
    } else {
      byId.set(update.proposalId, {
        ...previous,
        metadata: {
          ...normalizeObject(previous.metadata),
          semanticWrite: semanticMetadata
        }
      });
    }
  }
  for (const proposal of proposalsFromSemanticTokenClassifications(decision.tokenClassification, {
    sourceText,
    chatSessionId: input.chatSessionId,
    sceneId: input.sceneId,
    actorId: input.actorId || input.npcId || input.playerId || input.controlledActorId || input.protagonistActorId,
    actorName: input.actorName || input.playerName || input.controlledActorTitle,
    defaultWhen: normalizeArray(plan.checks).length ? 'success' : 'always'
  }, decision)) {
    if (!byId.has(proposal.id)) byId.set(proposal.id, proposal);
  }
  for (const proposal of decision.newProposals || []) byId.set(proposal.id, proposal);
  return normalizeActionPlan({
    ...plan,
    sourceText,
    proposals: [...byId.values()],
    metadata: {
      ...normalizeObject(plan.metadata),
      semanticWriteDecision: {
        decisionId: decision.decisionId,
        summary: decision.summary,
        tokenClassification: decision.tokenClassification,
        updateCount: decision.updates?.length || 0,
        tokenProposalCount: proposalsFromSemanticTokenClassifications(decision.tokenClassification, {
          sourceText,
          chatSessionId: input.chatSessionId,
          sceneId: input.sceneId,
          actorId: input.actorId || input.npcId || input.playerId || input.controlledActorId || input.protagonistActorId,
          actorName: input.actorName || input.playerName || input.controlledActorTitle,
          defaultWhen: normalizeArray(plan.checks).length ? 'success' : 'always'
        }, decision).length,
        newProposalCount: decision.newProposals?.length || 0,
        droppedProposalCount: decision.droppedProposalIds?.length || 0
      }
    }
  }, {
    sourceText,
    chatSessionId: input.chatSessionId,
    sceneId: input.sceneId
  });
}

function proposalsFromSemanticTokenClassifications(classifications = [], input = {}, decision = {}) {
  const proposals = [];
  const sourceText = normalizeOptionalText(input.sourceText);
  const chatSessionId = input.chatSessionId;
  const sceneId = normalizeOptionalText(input.sceneId) || 'current';
  const actorId = normalizeOptionalText(input.actorId) || 'player';
  const actorName = normalizeOptionalText(input.actorName) || '玩家角色';
  const defaultWhen = normalizeOptionalText(input.defaultWhen) || 'success';
  for (const entry of normalizeArray(classifications)) {
    const classification = normalizeSemanticClassification(entry.classification);
    if (!classification || classification === 'ignore') continue;
    const token = normalizeOptionalText(entry.token);
    const tool = normalizeOptionalText(entry.tool || entry.databaseTarget);
    const explicitInput = normalizeObject(entry.input);
    const idBase = safeStateKey(`${classification}_${token || tool || entry.field || entry.collection || 'token'}`) || createId('semantic_token');
    const semanticWrite = removeUndefined({
      source: 'semantic_token_classification',
      decisionId: decision.decisionId,
      token,
      classification,
      databaseTarget: entry.databaseTarget,
      reason: entry.reason,
      ...normalizeObject(entry.metadata)
    });
    if (tool && /^system\./.test(tool) && Object.keys(explicitInput).length) {
      proposals.push({
        id: `semantic_token_${idBase}`,
        when: entry.when || defaultWhen,
        checkId: entry.checkId,
        tool,
        input: explicitInput,
        metadata: { semanticWrite }
      });
      continue;
    }
    const proposal = buildSemanticTokenProposal({
      classification,
      token,
      entry,
      idBase,
      sourceText,
      chatSessionId,
      sceneId,
      actorId,
      actorName,
      defaultWhen,
      semanticWrite
    });
    if (Array.isArray(proposal)) proposals.push(...proposal.filter(Boolean));
    else if (proposal) proposals.push(proposal);
  }
  return dedupeById(proposals);
}

function normalizeSemanticClassification(value = '') {
  const text = normalizeOptionalText(value).toLowerCase();
  if (!text) return '';
  if (/faction_relationship|faction_relation|阵营关系|势力关系/.test(text)) return 'faction_relationship';
  if (/npc_relationship|relationship|人物关系|npc关系/.test(text)) return 'npc_relationship';
  if (/npc|character|人物|角色/.test(text)) return 'npc';
  if (/inventory|背包|owned|获得/.test(text)) return 'inventory';
  if (/currency|money|货币|灵石|金币/.test(text)) return 'currency';
  if (/item|equipment|weapon|accessory|物品|道具|装备|武器|法器/.test(text)) return 'item';
  if (/feat|perk|talent|trait|specialty|专长|天赋|特质|特性|专精/.test(text)) return 'feat';
  if (/skill|mechanic|ability|spell|功法|技能|法术/.test(text)) return 'skill';
  if (/status|condition|状态|效果/.test(text)) return 'status';
  if (/map|location|地点|地图/.test(text)) return 'map';
  if (/quest|task|mission|任务|委托/.test(text)) return 'quest';
  if (/faction|organization|势力|组织|宗门/.test(text)) return 'faction';
  if (/extension|metric|fact|data|setting|扩展|指标|设定/.test(text)) return 'extension_data';
  if (/ignore|skip|none|忽略/.test(text)) return 'ignore';
  return text;
}

function buildSemanticTokenProposal({
  classification,
  token,
  entry = {},
  idBase,
  sourceText,
  chatSessionId,
  sceneId,
  actorId,
  actorName,
  defaultWhen = 'success',
  semanticWrite
} = {}) {
  const quantity = Number.isFinite(Number(entry.quantity)) ? Number(entry.quantity) : (extractQuantityNearResourceName(sourceText, token) || 1);
  const metadata = { semanticWrite };
  if (classification === 'npc' && token) {
    const roleStripped = stripKnownRolePrefix(token);
    const name = roleStripped || token;
    const role = roleStripped && roleStripped !== token ? token.slice(0, token.length - roleStripped.length) : normalizeOptionalText(entry.metadata?.role);
    return {
      id: `semantic_token_npc_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.npc_registry.upsert_npc',
      input: removeUndefined({
        npcId: factId('npc', name),
        name,
        role,
        summary: `${name}由语义写库分类器从本轮文本中识别。`,
        source: 'semantic-token-classifier',
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
  }
  if (classification === 'item' && token) {
    return {
      id: `semantic_token_item_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.item_registry.upsert_special_item',
      input: removeUndefined({
        itemId: factId('item', token),
        id: factId('item', token),
        name: token,
        category: normalizeOptionalText(entry.metadata?.category) || 'story_item',
        description: `${token}由语义写库分类器从本轮文本中识别。`,
        source: 'semantic-token-classifier',
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
  }
  if (classification === 'inventory' && token) {
    return {
      id: `semantic_token_inventory_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.npc_state.patch_state',
      input: removeUndefined({
        chatSessionId,
        sceneId,
        npcId: actorId,
        name: actorName,
        actorType: 'player',
        isPlayer: true,
        inventory: {
          items: [{
            id: factId('item', token),
            name: token,
            quantity,
            tags: ['semantic-token-classifier']
          }]
        },
        source: 'semantic-token-classifier'
      }),
      metadata
    };
  }
  if (classification === 'currency' && token) {
    const canonical = canonicalCurrencyFromAbstractResource({ name: token, quantity }, sourceText);
    const key = normalizeOptionalText(entry.metadata?.currencyKey || canonical?.key) || 'currency';
    return {
      id: `semantic_token_currency_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.npc_state.patch_state',
      input: removeUndefined({
        chatSessionId,
        sceneId,
        npcId: actorId,
        name: actorName,
        actorType: 'player',
        isPlayer: true,
        inventory: { currency: { [key]: canonical?.amount || quantity } },
        source: 'semantic-token-classifier'
      }),
      metadata
    };
  }
  if (classification === 'skill' && token) {
    const skillId = factId('skill', token);
    const actorSkillStatus = semanticSkillStatusFromSource(sourceText, token, entry);
    const registryProposal = {
      id: `semantic_token_skill_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.mechanics_registry.upsert_skill',
      input: removeUndefined({
        id: skillId,
        skillId,
        name: token,
        category: normalizeOptionalText(entry.metadata?.category) || 'skill',
        description: `${token}由语义写库分类器从本轮文本中识别。`,
        mechanicalEffect: normalizeOptionalText(entry.metadata?.mechanicalEffect) || '具体效果由规则包、参考文本或后续判定决定。',
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
    if (!actorSkillStatus) return registryProposal;
    const key = safeStateKey(token);
    return [
      registryProposal,
      {
        id: `semantic_token_actor_skill_${idBase}`,
        when: entry.when || defaultWhen,
        tool: 'system.npc_state.patch_state',
        input: removeUndefined({
          chatSessionId,
          sceneId,
          npcId: actorId,
          name: actorName,
          actorType: 'player',
          isPlayer: true,
          skillBar: {
            [key]: {
              id: skillId,
              skillId,
              name: token,
              status: actorSkillStatus,
              lastAction: sourceText
            },
            skills: [{
              id: skillId,
              skillId,
              name: token,
              status: actorSkillStatus,
              lastAction: sourceText
            }],
            actions: [{
              id: skillId,
              name: token,
              mechanicKind: 'skill',
              skillId,
              source: 'semantic-token-classifier'
            }]
          },
          specialStatuses: [{
            id: `${actorSkillStatus === 'learned' ? 'learned' : 'training'}_${key}`,
            name: token,
            active: true,
            description: sourceText
          }],
          source: 'semantic-token-classifier'
        }),
        metadata
      }
    ];
  }
  if (classification === 'status' && token) {
    const statusId = factId('status', token);
    const actorStatus = semanticStatusApplicationFromSource(sourceText, token, entry);
    const registryProposal = {
      id: `semantic_token_status_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.mechanics_registry.upsert_status',
      input: removeUndefined({
        id: statusId,
        statusId,
        name: token,
        category: normalizeOptionalText(entry.metadata?.category) || 'status',
        severity: normalizeOptionalText(entry.metadata?.severity),
        durationType: normalizeOptionalText(entry.metadata?.durationType),
        stackRule: normalizeOptionalText(entry.metadata?.stackRule),
        description: `${token}由语义写库分类器从本轮文本中识别。`,
        mechanicalEffect: normalizeOptionalText(entry.metadata?.mechanicalEffect) || '具体效果由规则包、参考文本或后续判定决定。',
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
    if (!actorStatus.active) return registryProposal;
    return [
      registryProposal,
      {
        id: `semantic_token_actor_status_${idBase}`,
        when: entry.when || defaultWhen,
        tool: 'system.npc_state.patch_state',
        input: removeUndefined({
          chatSessionId,
          sceneId,
          npcId: actorId,
          name: actorName,
          specialStatuses: [{
            id: statusId,
            name: token,
            active: true,
            description: sourceText
          }],
          source: 'semantic-token-classifier'
        }),
        metadata
      }
    ];
  }
  if (classification === 'feat' && token) {
    const featId = factId('feat', token);
    const actorFeatStatus = semanticFeatStatusFromSource(sourceText, token, entry);
    const registryProposal = {
      id: `semantic_token_feat_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.mechanics_registry.upsert_feat',
      input: removeUndefined({
        id: featId,
        featId,
        name: token,
        category: normalizeOptionalText(entry.metadata?.category) || 'feat',
        tier: normalizeOptionalText(entry.metadata?.tier),
        description: `${token}由语义写库分类器从本轮文本中识别。`,
        mechanicalEffect: normalizeOptionalText(entry.metadata?.mechanicalEffect) || '具体效果由规则包、参考文本或后续判定决定。',
        grants: normalizeArray(entry.metadata?.grants),
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
    if (!actorFeatStatus) return registryProposal;
    const key = safeStateKey(token);
    return [
      registryProposal,
      {
        id: `semantic_token_actor_feat_${idBase}`,
        when: entry.when || defaultWhen,
        tool: 'system.npc_state.patch_state',
        input: removeUndefined({
          chatSessionId,
          sceneId,
          npcId: actorId,
          name: actorName,
          actorType: 'player',
          isPlayer: true,
          skillBar: {
            feats: [{
              id: featId,
              featId,
              name: token,
              status: actorFeatStatus,
              lastAction: sourceText
            }]
          },
          resources: {
            combat: {
              featIds: [featId]
            }
          },
          specialStatuses: [{
            id: `${actorFeatStatus === 'learned' ? 'learned' : 'gained'}_${key}`,
            name: token,
            active: true,
            description: sourceText
          }],
          source: 'semantic-token-classifier'
        }),
        metadata
      }
    ];
  }
  if (classification === 'map' && token) {
    return {
      id: `semantic_token_map_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.map_registry.upsert_map',
      input: removeUndefined({
        mapId: factId('map', token),
        name: token,
        type: normalizeOptionalText(entry.metadata?.type) || 'location',
        summary: `${token}由语义写库分类器从本轮文本中识别。`,
        source: 'semantic-token-classifier',
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
  }
  if (classification === 'quest' && token) {
    return {
      id: `semantic_token_quest_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.quests.upsert_quest',
      input: removeUndefined({
        chatSessionId,
        questId: factId('quest', token),
        title: token,
        status: 'tracked',
        hookText: sourceText,
        objective: token,
        antiRailroadRules: ['No fixed route chain; resolve by objective satisfaction.'],
        metadata: { source: 'semantic-token-classifier' }
      }),
      metadata
    };
  }
  if (classification === 'faction' && token) {
    return {
      id: `semantic_token_faction_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.factions.upsert_faction',
      input: removeUndefined({
        factionId: factId('faction', token),
        name: token,
        kind: 'organization',
        status: 'active',
        summary: `${token}由语义写库分类器从本轮文本中识别。`,
        tags: ['semantic-token-classifier']
      }),
      metadata
    };
  }
  if (classification === 'npc_relationship') {
    const relation = semanticRelationshipInput({
      entry,
      sourceText,
      actorId,
      actorName,
      token,
      defaultRelationType: 'related'
    });
    if (!relation.fromNpcId || !relation.toNpcId) return undefined;
    return {
      id: `semantic_token_npc_relation_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.npc_relationships.upsert_edge',
      input: removeUndefined({
        edgeId: relation.edgeId,
        fromNpcId: relation.fromNpcId,
        toNpcId: relation.toNpcId,
        relationType: relation.relationType,
        status: relation.status,
        trust: relation.trust,
        tension: relation.tension,
        weight: relation.weight,
        summary: relation.summary,
        sourceText,
        tags: ['semantic-token-classifier', relation.relationType]
      }),
      metadata
    };
  }
  if (classification === 'faction_relationship') {
    const relation = semanticRelationshipInput({
      entry,
      sourceText,
      actorId,
      actorName,
      token,
      defaultRelationType: 'related'
    });
    if (!relation.fromFactionId || !relation.toFactionId) return undefined;
    return {
      id: `semantic_token_faction_relation_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.factions.upsert_relation',
      input: removeUndefined({
        relationId: relation.edgeId,
        fromFactionId: relation.fromFactionId,
        toFactionId: relation.toFactionId,
        relationType: relation.relationType,
        status: relation.status,
        tension: relation.tension,
        summary: relation.summary,
        sourceText,
        createMissingFactions: true,
        tags: ['semantic-token-classifier', relation.relationType]
      }),
      metadata
    };
  }
  if (classification === 'extension_data') {
    const factName = normalizeOptionalText(entry.field || entry.metadata?.factName || token || entry.collection || '语义扩展事实');
    const factValue = entry.value ?? entry.metadata?.value ?? entry.metadata?.factValue ?? token;
    const numericValue = parseQuantityToken(factValue);
    return {
      id: `semantic_token_extension_${idBase}`,
      when: entry.when || defaultWhen,
      tool: 'system.data.quantify_text',
      input: removeUndefined({
        collection: normalizeOptionalText(entry.collection) || 'story_extension_facts',
        id: factId('fact', factName),
        text: sourceText,
        values: {
          factName,
          factValue,
          numericValue: Number.isFinite(numericValue) ? numericValue : undefined
        },
        definition: {
          version: '1',
          prompt: 'Store semantic token classifier extension facts that do not fit existing databases.',
          numericFields: Number.isFinite(numericValue)
            ? [{ name: 'numericValue', prompt: `Numeric value for ${factName}.` }]
            : [],
          textFields: [
            { name: 'factName', prompt: 'Fact name from source text.' },
            { name: 'factValue', prompt: 'Fact value from source text.' }
          ]
        },
        storeRawText: true,
        rawTextField: 'sourceText',
        chatSessionId
      }),
      metadata
    };
  }
  return undefined;
}

function semanticRelationshipInput({
  entry = {},
  sourceText = '',
  actorId = 'player',
  actorName = '玩家角色',
  token = '',
  defaultRelationType = 'related'
} = {}) {
  const metadata = normalizeObject(entry.metadata);
  const fromName = normalizeOptionalText(
    metadata.fromName
    || metadata.fromNpcName
    || metadata.fromFactionName
    || entry.fromName
    || entry.fromNpcName
    || entry.fromFactionName
  );
  const toName = normalizeOptionalText(
    metadata.toName
    || metadata.toNpcName
    || metadata.toFactionName
    || entry.toName
    || entry.toNpcName
    || entry.toFactionName
  );
  const inferred = inferSemanticRelationshipStatus([
    token,
    entry.reason,
    metadata.relationType,
    metadata.status,
    sourceText
  ].filter(Boolean).join(' '));
  const relationType = normalizeOptionalText(
    metadata.relationType
    || metadata.type
    || entry.relationType
    || entry.status
    || inferred.relationType
  ) || defaultRelationType;
  const status = normalizeOptionalText(metadata.status || entry.status || inferred.status || relationType);
  const fromNpcId = normalizeOptionalText(metadata.fromNpcId || entry.fromNpcId || metadata.fromId || entry.fromId)
    || (fromName ? factId('npc', fromName) : undefined)
    || (token ? factId('npc', token) : undefined);
  const toNpcId = normalizeOptionalText(metadata.toNpcId || entry.toNpcId || metadata.toId || entry.toId)
    || (toName ? factId('npc', toName) : undefined)
    || actorId;
  const fromFactionId = normalizeOptionalText(metadata.fromFactionId || entry.fromFactionId || metadata.fromId || entry.fromId)
    || (fromName ? factId('faction', fromName) : undefined);
  const toFactionId = normalizeOptionalText(metadata.toFactionId || entry.toFactionId || metadata.toId || entry.toId)
    || (toName ? factId('faction', toName) : undefined);
  return removeUndefined({
    edgeId: factId('rel', [fromName || fromNpcId || fromFactionId || token, toName || toNpcId || toFactionId || actorName, relationType].filter(Boolean).join('_')),
    fromNpcId,
    toNpcId,
    fromFactionId,
    toFactionId,
    relationType,
    status,
    trust: inferred.trust,
    tension: inferred.tension,
    weight: inferred.weight,
    summary: normalizeOptionalText(entry.reason || metadata.summary) || `${token || relationType}由语义写库分类器从本轮文本中识别。`
  });
}

function inferSemanticRelationshipStatus(text = '') {
  const source = String(text || '');
  if (/信任|友好|帮助|支持|盟友|结盟|亲近|trust|friendly|support|ally|alliance/i.test(source)) {
    return { relationType: 'trust', status: 'friendly', trust: 20, weight: 1 };
  }
  if (/敌视|敌对|仇视|冲突|紧张|hostile|enemy|tense|conflict/i.test(source)) {
    return { relationType: 'hostile', status: 'hostile', tension: 20, weight: -1 };
  }
  if (/中立|neutral/i.test(source)) {
    return { relationType: 'neutral', status: 'neutral', weight: 0 };
  }
  return { relationType: 'related', status: 'known', weight: 0 };
}

function semanticSkillStatusFromSource(sourceText = '', token = '', entry = {}) {
  const explicit = normalizeOptionalText(entry.status || entry.metadata?.status || entry.learningStatus);
  if (explicit) return explicit;
  const text = String(sourceText || '');
  const index = token ? text.indexOf(token) : -1;
  const window = index >= 0
    ? text.slice(Math.max(0, index - 24), Math.min(text.length, index + token.length + 24))
    : text;
  if (/(学会|习得|掌握|获得|修成|练成|已会|已掌握)/u.test(window)) return 'learned';
  if (/(修炼|修习|学习|练功|研读|研习|练习|参悟|演练|练)/u.test(window)) return 'in_progress';
  return '';
}

function semanticFeatStatusFromSource(sourceText = '', token = '', entry = {}) {
  const explicit = normalizeOptionalText(entry.status || entry.metadata?.status || entry.featStatus || entry.learningStatus);
  if (explicit) return explicit;
  const text = String(sourceText || '');
  const index = token ? text.indexOf(token) : -1;
  const window = index >= 0
    ? text.slice(Math.max(0, index - 24), Math.min(text.length, index + token.length + 24))
    : text;
  if (/(获得|取得|解锁|习得|学会|掌握|拥有|觉醒|激活|获得专长|获得天赋|获得特质|已拥有|已解锁)/u.test(window)) return 'learned';
  return '';
}

function semanticStatusApplicationFromSource(sourceText = '', token = '', entry = {}) {
  const explicit = normalizeOptionalText(entry.status || entry.metadata?.status || entry.statusState || entry.applicationStatus);
  if (/^(?:definition|defined|registry|draft|inactive|removed|cleared|false|定义|设定|草稿|未生效)$/iu.test(explicit)) {
    return { active: false, status: explicit };
  }
  if (explicit && !/^(?:none|ignore|skip)$/iu.test(explicit)) {
    return { active: true, status: explicit };
  }
  const text = String(sourceText || '');
  const index = token ? text.indexOf(token) : -1;
  const window = index >= 0
    ? text.slice(Math.max(0, index - 24), Math.min(text.length, index + token.length + 24))
    : text;
  const active = /(?:进入|陷入|获得|受到|附加|施加|感染|中毒|燃烧|冰冻|眩晕|激活|生效|处于|变为).{0,12}(?:状态|效果|buff|debuff)|(?:状态|效果|buff|debuff).{0,12}(?:生效|激活|附加|施加|获得|受到)/iu.test(window);
  return { active, status: active ? 'active' : '' };
}

function applySemanticWriteFallbacks(plan = {}, { sourceText = '', chatSessionId, sceneId = 'current' } = {}) {
  return normalizeActionPlan({
    ...plan,
    proposals: normalizeArray(plan.proposals).map((proposal) => fallbackCanonicalizeProposal(proposal, { sourceText }))
  }, {
    sourceText: sourceText || plan.sourceText,
    chatSessionId,
    sceneId
  });
}

function fallbackCanonicalizeProposal(proposal = {}, { sourceText = '' } = {}) {
  if (!proposal || typeof proposal !== 'object') return proposal;
  if (proposal.tool === 'system.npc_state.patch_state' || proposal.tool === 'system.npc_state.rewrite_state') {
    const canonical = fallbackCanonicalizeNpcStateInput(proposal.input, { sourceText });
    if (canonical.changed) {
      return {
        ...proposal,
        input: canonical.input,
        metadata: {
          ...normalizeObject(proposal.metadata),
          semanticWrite: {
            source: 'fallback_semantic_write',
            reason: canonical.reason,
            originalTerms: canonical.originalTerms,
            canonicalKind: 'currency'
          }
        }
      };
    }
  }
  if (/^system\.item_registry\.upsert_/.test(proposal.tool || '')) {
    const canonical = fallbackCanonicalizeItemRegistryInput(proposal.input, { sourceText });
    if (canonical.changed) {
      return {
        ...proposal,
        input: canonical.input,
        metadata: {
          ...normalizeObject(proposal.metadata),
          semanticWrite: {
            source: 'fallback_semantic_write',
            reason: canonical.reason,
            originalTerms: canonical.originalTerms,
            canonicalKind: 'currency_item_definition'
          }
        }
      };
    }
  }
  return proposal;
}

function fallbackCanonicalizeNpcStateInput(input = {}, { sourceText = '' } = {}) {
  const next = clonePlain(input);
  const inventory = normalizeObject(next.inventory);
  const items = normalizeArray(inventory.items);
  if (!items.length) return { changed: false, input };
  const kept = [];
  const currency = { ...normalizeObject(inventory.currency) };
  const originalTerms = [];
  for (const item of items) {
    const canonical = canonicalCurrencyFromAbstractResource(item, sourceText);
    if (!canonical) {
      kept.push(item);
      continue;
    }
    currency[canonical.key] = (Number(currency[canonical.key]) || 0) + canonical.amount;
    originalTerms.push(canonical.originalTerm);
  }
  if (!originalTerms.length) return { changed: false, input };
  next.inventory = {
    ...inventory,
    currency,
    items: kept
  };
  return {
    changed: true,
    input: next,
    reason: 'Abstract reward/resource terms are stored as currency instead of literal inventory items.',
    originalTerms
  };
}

function fallbackCanonicalizeItemRegistryInput(input = {}, { sourceText = '' } = {}) {
  const originalName = normalizeOptionalText(input.name || input.itemName || input.title);
  const canonical = canonicalCurrencyFromAbstractResource({ name: originalName, quantity: 1 }, sourceText);
  if (!canonical) return { changed: false, input };
  const label = canonical.label;
  return {
    changed: true,
    input: {
      ...input,
      name: label,
      category: input.category || 'currency',
      itemType: input.itemType || 'currency',
      aliases: compactUnique([...(input.aliases || []), originalName].filter(Boolean)),
      description: input.description || `${label}是该设定中可流通或可消耗的资源。`,
      metadata: {
        ...normalizeObject(input.metadata),
        semanticCanonicalization: {
          originalTerm: canonical.originalTerm,
          canonicalCurrency: canonical.key,
          source: 'fallback_semantic_write'
        }
      }
    },
    reason: 'Abstract reward/resource item definition is stored as a concrete currency resource.',
    originalTerms: [canonical.originalTerm]
  };
}

function canonicalCurrencyFromAbstractResource(item = {}, sourceText = '') {
  const name = normalizeOptionalText(item.name || item.id || item.label);
  if (!name) return undefined;
  const text = `${sourceText}\n${name}`;
  const abstractReward = /俸禄|月俸|月供|工资|津贴|薪酬|薪水|配给|补给|定期资源|每月资源|每月灵石/u.test(name);
  const explicitCurrency = /灵石|金币|金|银币|银两|铜币|铜钱|coin|gold|silver|copper/i.test(name);
  if (!abstractReward && !explicitCurrency) return undefined;
  const explicitItemQuantity = Number(item.quantity);
  const amount = extractFirstPositiveNumber(name)
    || extractQuantityNearResourceName(sourceText, name)
    || (Number.isFinite(explicitItemQuantity) && explicitItemQuantity > 0 ? explicitItemQuantity : undefined)
    || 1;
  const cultivationContext = /修仙|修炼|宗门|功法|灵脉|妖兽|魔兽|灵气|丹药|洞府|筑基|金丹|元婴|sect|cultivat|spirit/i.test(text);
  if (/灵石|spirit/i.test(text) || (abstractReward && cultivationContext)) {
    if (/下品|低品|low[-_\s]?grade/i.test(text)) {
      return { key: 'low_grade_spirit_stone', label: '下品灵石', amount, originalTerm: name };
    }
    if (/中品|mid[-_\s]?grade|middle[-_\s]?grade/i.test(text)) {
      return { key: 'mid_grade_spirit_stone', label: '中品灵石', amount, originalTerm: name };
    }
    if (/上品|高品|high[-_\s]?grade/i.test(text)) {
      return { key: 'high_grade_spirit_stone', label: '上品灵石', amount, originalTerm: name };
    }
    return { key: 'spirit_stone', label: '灵石', amount, originalTerm: name };
  }
  if (/银币|银两|silver/i.test(text)) return { key: 'silver', label: '银币', amount, originalTerm: name };
  if (/铜币|铜钱|copper/i.test(text)) return { key: 'copper', label: '铜币', amount, originalTerm: name };
  return { key: 'gold', label: '金币', amount, originalTerm: name };
}

function countChangedProposals(before = [], after = []) {
  const beforeById = new Map(normalizeArray(before).map((proposal) => [proposal.id, JSON.stringify(proposal)]));
  let changed = 0;
  for (const proposal of normalizeArray(after)) {
    if (beforeById.get(proposal.id) !== JSON.stringify(proposal)) changed += 1;
    beforeById.delete(proposal.id);
  }
  return changed + beforeById.size;
}

function applyDefaultActionPlanHeuristics(plan = {}, input = {}, { skipDifficultyInference = false } = {}) {
  const sourceText = normalizeOptionalText(input.sourceText || input.text || input.content || plan.sourceText);
  const resolvedLabel = inferActionLabel(sourceText, plan.intent?.label);
  const output = {
    ...plan,
    sourceText: sourceText || plan.sourceText,
    intent: {
      ...normalizeObject(plan.intent),
      summary: sourceText || plan.intent?.summary || '',
      label: resolvedLabel
    },
    metadata: {
      ...normalizeObject(plan.metadata),
      heuristicSource: 'default_action_plan'
    }
  };
  const automaticProgress = inferAutomaticProgressAction(sourceText, input);
  if (!skipDifficultyInference && automaticProgress && !hasExplicitActionDc(input)) {
    return buildAutomaticProgressPlan(output, input, automaticProgress);
  }
  const explicitWorldFacts = inferExplicitWorldFactProposals(sourceText, input);
  if (explicitWorldFacts.proposals.length) {
    output.proposals = [
      ...normalizeArray(output.proposals),
      ...explicitWorldFacts.proposals
    ];
      output.metadata = {
        ...normalizeObject(output.metadata),
        resolutionMode: 'explicit_world_fact_updates',
        explicitWorldFactKinds: explicitWorldFacts.kinds
      };
    output.narrationHints = {
      ...normalizeObject(output.narrationHints),
      success: '本轮行动成功后，叙事中明确出现的任务、NPC、物品、地图、关系、阵营或扩展数值必须按工具写入结果来描述。',
      failure: '如果检定失败，不要把这些显式世界变化叙述成已经生效。'
    };
  }
  if (skipDifficultyInference || hasExplicitActionDc(input)) return output;
  const difficulty = inferActionDifficulty(sourceText);
  const resultClaim = detectPlayerResultClaim(sourceText);
  if (resultClaim.detected) {
    output.metadata = {
      ...normalizeObject(output.metadata),
      playerResultClaimDetected: true,
      playerResultClaimReason: resultClaim.reason
    };
  }
  output.checks = normalizeArray(plan.checks).map((check) => {
    const checkInput = normalizeObject(check.input);
    if (check.tool !== 'game.dice.check') return check;
    const currentThreshold = checkInput.successThreshold ?? checkInput.dc ?? checkInput.baseThreshold;
    if (currentThreshold !== undefined && Number(currentThreshold) !== 15) return check;
    return {
      ...check,
      input: {
        ...checkInput,
        successThreshold: difficulty.dc
      },
      metadata: {
        ...normalizeObject(check.metadata),
        difficulty: difficulty.label,
        difficultyReason: difficulty.reason
      }
    };
  });
  return output;
}

function hasExplicitActionDc(input = {}) {
  return input.successThreshold !== undefined
    || input.dc !== undefined
    || input.baseThreshold !== undefined
    || input.diceInput?.successThreshold !== undefined
    || input.diceInput?.dc !== undefined;
}

function inferActionLabel(text = '', fallback = '') {
  const source = String(text || '');
  if (/说服|劝|谈判|交涉|威胁|欺骗|询问|打听|邀请|请求/u.test(source)) return 'social_action';
  if (/(?:攻击|袭击|战斗|斗法|击杀|杀|砍|斩|刺|打(?!听|探|扫|量|算|开|磨|招呼|工|水|饭|理|造|点|扰))/u.test(source)) return 'combat_or_violence';
  if (/修炼|学习|练功|突破|提升/u.test(source)) return 'training';
  if (/领取|拿取|购买|拾取|获得|收集/u.test(source)) return 'acquire_resource';
  if (/调查|搜索|查看|观察|检查|寻找|翻阅|阅读|扫描|侦测|分析|检索|破解|撬开/u.test(source)) return 'investigation';
  if (/移动|前往|进入|离开|穿过|返回/u.test(source)) return 'movement_or_travel';
  return normalizeOptionalText(fallback) && !/\|/.test(String(fallback)) ? fallback : 'player_action';
}

function inferActionDifficulty(text = '') {
  const source = String(text || '').normalize('NFKC');
  if (!source.trim()) return { dc: 10, label: 'normal', reason: 'empty_or_generic_action' };
  if (/不可能|绝不可能|逆天|改写现实|说服重力|古神|神明|天道|飞升|秒杀|一击必杀|毁灭世界/u.test(source)) {
    return { dc: 22, label: 'extreme', reason: 'reality_bending_or_extreme_claim' };
  }
  if (/传奇|宗师|大能|元婴|化神|boss|首领|精英|强大|高阶|困难|危险|硬闯|强行/u.test(source)) {
    return { dc: 18, label: 'hard', reason: 'hard_or_high_risk_terms' };
  }
  if (/(?:低级|杂鱼|小怪|弱小|普通).{0,8}(?:妖兽|魔兽|怪物|敌人|战斗|攻击|击杀|猎杀|杀|打(?!听|探|扫|量|算|开|磨|招呼|工|水|饭|理|造|点|扰))|(?:妖兽|魔兽|怪物|敌人).{0,8}(?:低级|杂鱼|小怪|弱小|普通)/u.test(source)) {
    return { dc: 10, label: 'easy_combat', reason: 'low_tier_combat_or_hostile_target' };
  }
  if (/妖兽|魔兽|怪物|敌人|战斗|攻击|击杀|猎杀|杀|打(?!听|探|扫|量|算|开|磨|招呼|工|水|饭|理|造|点|扰)/u.test(source)) {
    return { dc: 14, label: 'combat', reason: 'ordinary_combat_or_hostile_target' };
  }
  if (/入门|基础|简单|容易|日常|每月|领取|常规|普通|低级|杂鱼|小事|村里|同桌|图书馆|旧报纸|日志|木箱锁/u.test(source)) {
    return { dc: 10, label: 'easy', reason: 'routine_or_low_tier_action' };
  }
  if (/准备|整理|打听|询问|邀请|观察|查看|搜索|调查|寻找|翻阅|阅读|检查|扫描|侦测|分析|检索|修炼|学习|练功|提升|小心|撬开/u.test(source)) {
    return { dc: 10, label: 'standard', reason: 'standard_progress_action' };
  }
  return { dc: 12, label: 'moderate', reason: 'fallback_moderate_action' };
}

function detectPlayerResultClaim(text = '') {
  const source = String(text || '').normalize('NFKC');
  if (!source.trim()) return { detected: false };
  if (/(?:忽略|无视|覆盖).{0,12}(?:规则|之前|系统|GM|裁决|判定|检定|提示)|(?:无需|不用|不要).{0,8}(?:判定|检定|裁决)|(?:已经|已|结果是|直接|立刻).{0,16}(?:成功|获得|写入|通过|说服|击败|杀死|打开|完成)/u.test(source)
    || /(?:我|我们).{0,12}(?:成功了|通过了|说服了|击败了|杀死了|打开了|完成了|拿到了|获得了|写入了)/u.test(source)
    || /\b(?:ignore|bypass|no check|no roll|without a roll|auto success|automatic success|already succeeded|already passed|i succeed|i succeeded|i convince|i convinced|i defeat|i defeated|i kill|i killed|i open|i opened|the result is|write it as fact)\b/i.test(source)) {
    return { detected: true, reason: 'player_text_claims_or_commands_result' };
  }
  return { detected: false };
}

function buildHeuristicAbsurdityJudgement(input = {}) {
  const source = String(input.sourceText || input.text || input.content || '').normalize('NFKC');
  if (!source.trim()) return undefined;
  const cosmicOrLaw = /说服重力|重力|改写现实|逆转因果|时间倒流|天道|古神|神明|奈亚|克苏鲁|雷神|奥丁|宙斯|湿婆|因陀罗|命运|自然法则|月亮|太阳|星球|银河|宇宙|影子|梦境|因果线|世界规则/u.test(source)
    || /(?:装进|塞进|放进).{0,8}(?:口袋|背包|瓶子|盒子)/u.test(source)
    || /\b(?:gravity|reality|causality|time travel|old god|cthulhu|nyarlathotep|odin|thor|zeus|shiva|indra|fate|natural law|moon|sun|planet|galaxy|universe|shadow|dream|world rule)\b/i.test(source);
  const absoluteDemand = /永久|彻底|无条件|毁灭世界|秒杀|一击必杀|全知全能/u.test(source)
    || /\b(?:permanent|unconditional|destroy the world|one-shot|omniscient|omnipotent)\b/i.test(source);
  if (!cosmicOrLaw) return undefined;
  return {
    ...ACTION_ABSURDITY_JUDGEMENT_TEMPLATE,
    judgementId: createId('absurd'),
    status: 'judged',
    absurdityLevel: absoluteDemand ? 'extreme' : 'impossibleButPlayable',
    summary: absoluteDemand
      ? '行动目标极端越界，但仍可作为尝试处理；成功也应被解释为局部、短暂或有重大代价。'
      : '行动对象超出日常逻辑，但在神话、魔法、克苏鲁、异世界或喜剧化题材中可作为高荒谬尝试处理。',
    factors: [
      { name: 'genre_logic', judgement: '不同题材可能允许神性、契约、漏洞、象征性回应或隐藏设定。', supportsAttempt: true },
      { name: 'boundary', judgement: '成功不等于玩家精确愿望永久成立。', supportsAttempt: true }
    ],
    canAttempt: true,
    shouldRollOrResolve: true,
    successDoesNotMeanExactWish: true,
    requiresAbsurdityExplanationOnSuccess: true,
    explanationSeeds: [
      '成功可以表现为短暂漏洞、神明玩笑、隐秘契约、象征性回应或有代价的局部生效。'
    ],
    sourceText: source,
    metadata: {
      source: 'heuristic_absurdity',
      absoluteDemand
    }
  };
}

function buildHeuristicAbsurdityExplanation(input = {}, judgement = {}) {
  if (!judgement?.requiresAbsurdityExplanationOnSuccess) return undefined;
  const source = normalizeOptionalText(input.sourceText || input.text || input.content || judgement.sourceText);
  return {
    ...ACTION_ABSURDITY_EXPLANATION_TEMPLATE,
    explanationId: createId('absurdexp'),
    status: 'explained',
    premise: source,
    acceptedOutcome: '成功被保留为短暂、局部且有代价的可玩结果，而不是永久改写世界规则。',
    explanationMode: 'loophole',
    explanation: '这次成功触发了世界规则中的一个隐秘漏洞或旧契约：荒谬请求被误认为一次临时许可，因此短暂生效，但会留下后续代价。',
    consequences: [
      { kind: 'boon', summary: '玩家获得一次短暂且有限的异常效果。' },
      { kind: 'cost', summary: '相关神秘力量、自然法则或旁观者会在之后索取解释或代价。' }
    ],
    followUpHooks: [
      '异常效果结束后，世界会以一个小麻烦提醒玩家这不是免费奇迹。'
    ],
    narration: {
      immediate: '荒谬的请求没有被直接否定，而是以一个短暂漏洞的形式回应。',
      later: '这次漏洞会成为后续剧情中的债务、注视或传闻。'
    },
    metadata: {
      source: 'heuristic_absurdity_explanation'
    }
  };
}

function inferAutomaticProgressAction(text = '', input = {}) {
  const source = String(text || '').normalize('NFKC').trim();
  if (!source) return undefined;
  if (input.forceDice || input.rollDice || input.requireCheck || input.alwaysRoll) return undefined;
  if (/强行|速成|立刻|马上|一口气|突破|越级|高阶|危险|硬闯|战斗|攻击|击杀|猎杀|杀|打|boss|首领|精英|不可能|逆天|秒杀|飞升/u.test(source)) return undefined;
  const actions = [];
  if (/(?:修炼|修习|学习|练功|研读|研习|练习|参悟|演练|练).{0,20}(?:入门|基础|简单|日常|常规|普通|低级|功法|技能|法术|招式|剑诀|心法|身法|秘术|术法)|(?:入门|基础|简单|日常|常规|普通|低级|[\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:功法|技能|法术|招式|剑诀|心法|身法|秘术|术法)).{0,20}(?:修炼|修习|学习|练功|研读|研习|练习|参悟|演练|练)/u.test(source)) {
    actions.push({
      kind: 'training',
      label: 'routine_training_progress',
      reason: 'low_risk_training_or_study',
      name: extractTrainingProgressName(source)
    });
  }
  if (/(?:领取|拿取|领取|领|收取).{0,12}(?:每月|月供|月俸|俸禄|灵石|补给|资源|工资|津贴|配给)|(?:每月|月供|月俸|俸禄).{0,12}(?:领取|领|收取|灵石|资源|补给)/u.test(source)) {
    actions.push({
      kind: 'resource_pickup',
      label: 'routine_resource_pickup',
      reason: 'regular_low_risk_resource_pickup',
      name: extractResourcePickupName(source)
    });
  }
  if (actions.length > 1) {
    return {
      kind: 'compound_routine_progress',
      label: 'compound_routine_progress',
      reason: actions.map((action) => action.reason).join('+'),
      actions
    };
  }
  if (actions.length === 1) return actions[0];
  return undefined;
}

function buildAutomaticProgressPlan(plan = {}, input = {}, progress = {}) {
  const sourceText = normalizeOptionalText(input.sourceText || input.text || input.content || plan.sourceText);
  const actorId = normalizeOptionalText(
    input.actorId
    || input.npcId
    || input.playerId
    || input.controlledActorId
    || input.protagonistActorId
  ) || 'player';
  const sceneId = normalizeOptionalText(input.sceneId) || 'current';
  const chatSessionId = input.chatSessionId;
  const progressActions = Array.isArray(progress.actions) && progress.actions.length ? progress.actions : [progress];
  const proposals = progressActions
    .flatMap((entry) => entry.kind === 'resource_pickup'
      ? buildResourcePickupProposal({ chatSessionId, sceneId, actorId, sourceText, progress: entry })
      : buildTrainingProgressProposal({ chatSessionId, sceneId, actorId, sourceText, progress: entry }))
    .map((proposal, index) => progressActions.length <= 1 ? proposal : ({
      ...proposal,
      id: `${proposal.id}_${index + 1}`
    }));
  return {
    ...plan,
    checks: [],
    proposals,
    metadata: {
      ...normalizeObject(plan.metadata),
      resolutionMode: 'automatic_progress',
      difficulty: progress.label,
      difficultyReason: progress.reason,
      dicePolicy: 'no_main_check_for_low_risk_routine_progress',
      automaticProgressKinds: progressActions.map((entry) => entry.kind)
    },
    narrationHints: {
      ...normalizeObject(plan.narrationHints),
      success: progress.kind === 'compound_routine_progress'
        ? '这是低风险复合日常行动，直接结算为修炼/学习进展与定期资源领取。'
        : progress.kind === 'resource_pickup'
        ? `这是低风险定期领取，直接结算为获得${progress.name || '资源'}。`
        : `这是低风险日常修炼/学习，直接结算为小幅进展。`,
      resolved: '叙事应说明做得怎么样、获得了什么小幅进展或资源、接下来可以继续推进什么。'
    }
  };
}

function buildTrainingProgressProposal({ chatSessionId, sceneId, actorId, sourceText, progress } = {}) {
  const key = safeStateKey(progress.name || 'routine_training');
  const skillId = `skill_${key}`;
  const name = progress.name || '日常修炼';
  return [
    {
      id: 'register_routine_training_skill',
      when: 'always',
      tool: 'system.mechanics_registry.upsert_skill',
      input: removeUndefined({
        id: skillId,
        skillId,
        name,
        category: 'training',
        tags: ['routine_training', 'player_progress'],
        description: `${name}的日常修炼进度。`,
        mechanicalEffect: '作为角色已接触/正在修炼的技能或功法条目记录；具体数值提升由后续训练、检定或规则包结算。',
        numericValues: {
          progressDelta: 1
        },
        metadata: {
          source: 'default-action-automatic-progress',
          sourceText
        }
      }),
      metadata: {
        reason: progress.reason,
        noDice: true
      }
    },
    {
      id: 'record_routine_training_progress',
      when: 'always',
      tool: 'system.npc_state.patch_state',
      input: removeUndefined({
        chatSessionId,
        sceneId,
        npcId: actorId,
        skillBar: {
          [key]: {
            id: skillId,
            skillId,
            name,
            status: 'in_progress',
            progressDelta: 1,
            lastAction: sourceText
          },
          skills: [{
            id: skillId,
            skillId,
            name,
            status: 'in_progress',
            progressDelta: 1,
            lastAction: sourceText
          }],
          actions: [{
            id: skillId,
            name,
            mechanicKind: 'skill',
            skillId,
            source: 'default-action-automatic-progress'
          }]
        },
        specialStatuses: [
          {
            id: 'routine_training_progress',
            name,
            active: true,
            intensity: 1,
            description: sourceText
          }
        ],
        source: 'default-action-automatic-progress'
      }),
      metadata: {
        reason: progress.reason,
        noDice: true
      }
    }
  ];
}

function buildResourcePickupProposal({ chatSessionId, sceneId, actorId, sourceText, progress } = {}) {
  const resources = inferRoutineResourcePickup(sourceText, progress);
  const hasCurrency = Object.keys(resources.currency || {}).length > 0;
  const items = normalizeArray(resources.items);
  return {
    id: 'record_routine_resource_pickup',
    when: 'always',
    tool: 'system.npc_state.patch_state',
    input: removeUndefined({
      chatSessionId,
      sceneId,
      npcId: actorId,
      inventory: {
        ...(hasCurrency ? { currency: resources.currency } : {}),
        items
      },
      source: 'default-action-automatic-progress'
    }),
    metadata: {
      reason: progress.reason,
      noDice: true
    }
  };
}

function inferExplicitWorldFactProposals(sourceText = '', input = {}) {
  const tokenized = inferTokenizedExplicitWorldFactProposals(sourceText, input);
  const regex = inferRegexExplicitWorldFactProposals(sourceText, input);
  return mergeExplicitWorldFactProposalSets(tokenized, regex);
}

function mergeExplicitWorldFactProposalSets(...sets) {
  const byId = new Map();
  const semanticKeys = new Set();
  const kinds = new Set();
  for (const set of sets) {
    for (const proposal of normalizeArray(set?.proposals)) {
      if (!proposal?.id) continue;
      const keys = proposalSemanticKeys(proposal);
      if (keys.some((key) => semanticKeys.has(key))) continue;
      if (!byId.has(proposal.id)) byId.set(proposal.id, proposal);
      for (const key of keys) semanticKeys.add(key);
    }
    for (const kind of normalizeArray(set?.kinds)) kinds.add(kind);
  }
  return {
    proposals: [...byId.values()],
    kinds: [...kinds]
  };
}

function proposalSemanticKeys(proposal = {}) {
  const kind = normalizeOptionalText(proposal.metadata?.factKind);
  const input = normalizeObject(proposal.input);
  const token = normalizeObject(proposal.metadata?.token);
  const names = compactUnique([
    input.name,
    input.title,
    input.npcId && input.name ? input.name : '',
    input.itemId && input.name ? input.name : '',
    input.mapId && input.name ? input.name : '',
    input.skillId && input.name ? input.name : '',
    token.name,
    token.displayName,
    token.values?.factName
  ].filter(Boolean));
  return names
    .flatMap((name) => compactUnique([name, stripKnownRolePrefix(name)]))
    .map((name) => `${kind}:${name}`)
    .filter((key) => key !== ':');
}

function stripKnownRolePrefix(value = '') {
  return String(value || '')
    .replace(/^(铁匠|掌柜|老板娘|老板|猎人|矿工|修士|道士|巫师|护卫|长老|弟子|商人|炼丹师|药师|阵法师|剑修|医师|镖师|队长|祭司|学徒)/u, '')
    .trim();
}

function inferTokenizedExplicitWorldFactProposals(sourceText = '', input = {}) {
  const source = String(sourceText || '').normalize('NFKC').trim();
  if (!source) return { proposals: [], kinds: [] };
  const tokens = tokenizeAndClassifyStoryFacts(source);
  if (!tokens.hasCue) return { proposals: [], kinds: [] };

  const chatSessionId = input.chatSessionId;
  const sceneId = normalizeOptionalText(input.sceneId) || 'current';
  const actorId = normalizeOptionalText(
    input.actorId
    || input.npcId
    || input.playerId
    || input.controlledActorId
    || input.protagonistActorId
  ) || 'player';
  const actorName = normalizeOptionalText(input.actorName || input.playerName) || actorId;
  const lifecycle = { lifecycleScope: 'chat', lifecycleLevel: 'L1', chatSessionId };
  const proposals = [];
  const kinds = new Set();
  const currentLocation = extractCurrentLocationFact(source);

  const push = (proposal, kind) => {
    if (!proposal?.id || !proposal?.tool) return;
    proposals.push(proposal);
    if (kind) kinds.add(kind);
  };

  for (const npc of tokens.npcs) {
    push({
      id: `record_npc_${npc.id}`,
      when: 'success',
      tool: 'system.npc_registry.upsert_npc',
      input: removeUndefined({
        npcId: npc.id,
        name: npc.name,
        role: npc.role,
        importance: 'supporting',
        currentLocation,
        summary: npc.summary || `${npc.displayName || npc.name}在本轮剧情中登场。`,
        tags: ['story-explicit', 'agent-created', 'tokenized-entity'],
        source: 'default-action-token-classifier',
        ...lifecycle
      }),
      metadata: { factKind: 'npc', source: 'tokenized_story_fact_classifier', token: npc }
    }, 'npc');
    push({
      id: `record_npc_relation_node_${npc.id}`,
      when: 'success',
      tool: 'system.npc_relationships.upsert_node',
      input: removeUndefined({
        npcId: npc.id,
        name: npc.name,
        tags: ['story-explicit', 'agent-created', 'tokenized-entity'],
        summary: npc.summary || `${npc.displayName || npc.name}在本轮剧情中登场。`,
        metadata: npc.role ? { role: npc.role } : undefined
      }),
      metadata: { factKind: 'npc_relationship_node', source: 'tokenized_story_fact_classifier', token: npc }
    }, 'npc_relationship_node');
  }

  for (const item of tokens.items) {
    push({
      id: `record_item_${item.id}`,
      when: 'success',
      tool: item.tool || 'system.item_registry.upsert_special_item',
      input: removeUndefined({
        itemId: item.id,
        id: item.id,
        name: item.name,
        category: item.category,
        itemType: item.category,
        rarity: item.rarity || 'story',
        description: item.description || `${item.name}在本轮剧情中出现。`,
        tags: ['story-explicit', item.category || 'story_item', 'tokenized-entity'],
        source: 'default-action-token-classifier',
        ...lifecycle
      }),
      metadata: { factKind: 'item', source: 'tokenized_story_fact_classifier', token: item }
    }, 'item');
    if (item.received) {
      push({
        id: `record_inventory_${item.id}`,
        when: 'success',
        tool: 'system.npc_state.patch_state',
        input: removeUndefined({
          chatSessionId,
          sceneId,
          npcId: actorId,
          name: actorName,
          actorType: 'player',
          isPlayer: true,
          isProtagonist: true,
          inventory: {
            items: [{
              id: item.id,
              name: item.name,
              quantity: item.quantity || 1,
              tags: ['story-explicit', item.category || 'story_item', 'tokenized-entity']
            }]
          },
          source: 'default-action-token-classifier'
        }),
        metadata: { factKind: 'inventory', source: 'tokenized_story_fact_classifier', token: item }
      }, 'inventory');
    }
  }

  for (const skill of tokens.skills) {
    push({
      id: `record_skill_${skill.id}`,
      when: 'success',
      tool: 'system.mechanics_registry.upsert_skill',
      input: removeUndefined({
        id: skill.id,
        skillId: skill.id,
        name: skill.name,
        category: skill.category,
        tags: ['story-explicit', 'tokenized-entity', skill.category],
        description: skill.description || `${skill.name}在本轮剧情中成为可引用的技能/功法条目。`,
        mechanicalEffect: skill.mechanicalEffect || '具体数值效果由参考文本、规则包或后续判定决定；本条目用于保证叙事中出现的功法/技能可被数据库引用。',
        metadata: {
          source: 'default-action-token-classifier',
          sourceText: source
        },
        ...lifecycle
      }),
      metadata: { factKind: 'skill', source: 'tokenized_story_fact_classifier', token: skill }
    }, 'skill');
    if (skill.learned || skill.actorSkillStatus) {
      const actorSkillStatus = skill.actorSkillStatus || 'learned';
      push({
        id: `record_actor_skill_${skill.id}`,
        when: 'success',
        tool: 'system.npc_state.patch_state',
        input: removeUndefined({
          chatSessionId,
          sceneId,
          npcId: actorId,
          skillBar: {
            [safeStateKey(skill.name)]: {
              id: skill.id,
              skillId: skill.id,
              name: skill.name,
              status: actorSkillStatus,
              lastAction: source
            },
            skills: [{
              id: skill.id,
              skillId: skill.id,
              name: skill.name,
              status: actorSkillStatus,
              lastAction: source
            }],
            actions: [{
              id: skill.id,
              name: skill.name,
              mechanicKind: 'skill',
              skillId: skill.id,
              source: 'default-action-token-classifier'
            }]
          },
          specialStatuses: [{
            id: `${actorSkillStatus === 'learned' ? 'learned' : 'training'}_${safeStateKey(skill.name)}`,
            name: skill.name,
            active: true,
            description: source
          }],
          source: 'default-action-token-classifier'
        }),
        metadata: { factKind: 'actor_skill', source: 'tokenized_story_fact_classifier', token: skill }
      }, 'actor_skill');
    }
  }

  for (const map of tokens.maps) {
    push({
      id: `record_map_${map.id}`,
      when: 'success',
      tool: 'system.map_registry.upsert_map',
      input: removeUndefined({
        mapId: map.id,
        name: map.name,
        type: map.type,
        summary: map.summary || `${map.name}在本轮剧情中成为可用地点。`,
        tags: ['story-explicit', 'agent-created', 'tokenized-entity'],
        source: 'default-action-token-classifier',
        ...lifecycle
      }),
      metadata: { factKind: 'map', source: 'tokenized_story_fact_classifier', token: map }
    }, 'map');
    push({
      id: `record_map_node_${map.id}`,
      when: 'success',
      tool: 'system.map_relationships.upsert_node',
      input: removeUndefined({
        mapId: map.id,
        name: map.name,
        type: map.type,
        tags: ['story-explicit', 'agent-created', 'tokenized-entity'],
        summary: map.summary || `${map.name}在本轮剧情中成为可用地点。`
      }),
      metadata: { factKind: 'map_relationship_node', source: 'tokenized_story_fact_classifier', token: map }
    }, 'map_relationship_node');
    if (currentLocation) {
      const fromMap = {
        id: factId('map', currentLocation),
        name: currentLocation
      };
      push({
        id: `record_map_${fromMap.id}`,
        when: 'success',
        tool: 'system.map_registry.upsert_map',
        input: removeUndefined({
          mapId: fromMap.id,
          name: fromMap.name,
          type: 'city',
          summary: `${fromMap.name}在本轮剧情中作为出发地点出现。`,
          tags: ['story-explicit', 'agent-created'],
          source: 'default-action-token-classifier',
          ...lifecycle
        }),
        metadata: { factKind: 'map', source: 'tokenized_story_fact_classifier' }
      }, 'map');
      push({
        id: `record_map_route_${fromMap.id}_${map.id}`,
        when: 'success',
        tool: 'system.map_relationships.upsert_edge',
        input: removeUndefined({
          fromMapId: fromMap.id,
          toMapId: map.id,
          relationType: 'route',
          travelMode: 'walk',
          status: 'known',
          summary: `${fromMap.name}可以作为前往${map.name}的线索出发点。`,
          sourceText: source,
          tags: ['story-explicit', 'route', 'tokenized-entity']
        }),
        metadata: { factKind: 'map_route', source: 'tokenized_story_fact_classifier', token: map }
      }, 'map_route');
    }
  }

  const factions = extractExplicitFactionFacts(source);
  for (const faction of factions.factions) {
    push({
      id: `record_faction_${faction.id}`,
      when: 'success',
      tool: 'system.factions.upsert_faction',
      input: removeUndefined({
        factionId: faction.id,
        name: faction.name,
        kind: 'organization',
        status: 'active',
        tags: ['story-explicit', 'tokenized-entity'],
        summary: `${faction.name}在本轮剧情中被提及。`,
        metadata: { source: 'default-action-token-classifier' }
      }),
      metadata: { factKind: 'faction', source: 'tokenized_story_fact_classifier', token: faction }
    }, 'faction');
  }

  for (const fact of tokens.extensionFacts) {
    push({
      id: fact.proposalId || (fact.kind === 'metric' ? `record_metric_${fact.id}` : `record_extension_fact_${fact.id}`),
      when: 'success',
      tool: 'system.data.quantify_text',
      input: removeUndefined({
        collection: fact.collection,
        id: fact.id,
        text: source,
        values: fact.values,
        definition: fact.definition,
        storeRawText: true,
        rawTextField: 'sourceText',
        lifecycleScope: 'chat',
        lifecycleLevel: 'L1',
        chatSessionId
      }),
      metadata: { factKind: 'extension_data', source: 'tokenized_story_fact_classifier', token: fact }
    }, 'extension_data');
  }

  return {
    proposals,
    kinds: [...kinds]
  };
}

function inferRegexExplicitWorldFactProposals(sourceText = '', input = {}) {
  const source = String(sourceText || '').normalize('NFKC').trim();
  if (!source) return { proposals: [], kinds: [] };
  if (!hasExplicitWorldFactCue(source)) return { proposals: [], kinds: [] };

  const chatSessionId = input.chatSessionId;
  const sceneId = normalizeOptionalText(input.sceneId) || 'current';
  const actorId = normalizeOptionalText(
    input.actorId
    || input.npcId
    || input.playerId
    || input.controlledActorId
    || input.protagonistActorId
  ) || 'player';
  const actorName = normalizeOptionalText(input.actorName || input.playerName) || actorId;
  const lifecycle = { lifecycleScope: 'chat', lifecycleLevel: 'L1', chatSessionId };
  const proposals = [];
  const kinds = new Set();

  const npc = extractExplicitNpcFact(source);
  const currentLocation = extractCurrentLocationFact(source);
  if (npc) {
    kinds.add('npc');
    proposals.push({
      id: `record_npc_${npc.id}`,
      when: 'success',
      tool: 'system.npc_registry.upsert_npc',
      input: removeUndefined({
        npcId: npc.id,
        name: npc.name,
        role: npc.role,
        importance: 'supporting',
        currentLocation,
        summary: npc.summary || `${npc.displayName || npc.name}在本轮剧情中登场。`,
        tags: ['story-explicit', 'agent-created'],
        source: 'default-action-explicit-world-fact',
        ...lifecycle
      }),
      metadata: { factKind: 'npc', source: 'explicit_world_fact_heuristic' }
    });
    proposals.push({
      id: `record_npc_relation_node_${npc.id}`,
      when: 'success',
      tool: 'system.npc_relationships.upsert_node',
      input: removeUndefined({
        npcId: npc.id,
        name: npc.name,
        tags: ['story-explicit', 'agent-created'],
        summary: npc.summary || `${npc.displayName || npc.name}在本轮剧情中登场。`,
        metadata: npc.role ? { role: npc.role } : undefined
      }),
      metadata: { factKind: 'npc_relationship_node', source: 'explicit_world_fact_heuristic' }
    });
  }

  const item = extractExplicitItemFact(source);
  if (item) {
    kinds.add('item');
    proposals.push({
      id: `record_item_${item.id}`,
      when: 'success',
      tool: 'system.item_registry.upsert_special_item',
      input: removeUndefined({
        itemId: item.id,
        name: item.name,
        category: item.category,
        rarity: 'story',
        description: item.description,
        tags: ['story-explicit', 'quest-item'],
        source: 'default-action-explicit-world-fact',
        ...lifecycle
      }),
      metadata: { factKind: 'item', source: 'explicit_world_fact_heuristic' }
    });
    if (/交给我|给我|获得|拿到|取得|收入|放入背包/u.test(source) || /\b(gives? me|give me|obtain|obtained|receive|received|take|takes|put in backpack|add(?:ed)? to backpack)\b/i.test(source)) {
      kinds.add('inventory');
      proposals.push({
        id: `record_inventory_${item.id}`,
        when: 'success',
        tool: 'system.npc_state.patch_state',
        input: removeUndefined({
          chatSessionId,
          sceneId,
          npcId: actorId,
          name: actorName,
          actorType: 'player',
          isPlayer: true,
          isProtagonist: true,
          inventory: {
            items: [{
              id: item.id,
              name: item.name,
              quantity: 1,
              tags: ['story-explicit', 'quest-item']
            }]
          },
          source: 'default-action-explicit-world-fact'
        }),
        metadata: { factKind: 'inventory', source: 'explicit_world_fact_heuristic' }
      });
    }
  }

  const map = extractExplicitMapFact(source);
  if (map) {
    kinds.add('map');
    proposals.push({
      id: `record_map_${map.id}`,
      when: 'success',
      tool: 'system.map_registry.upsert_map',
      input: removeUndefined({
        mapId: map.id,
        name: map.name,
        type: map.type,
        summary: map.summary,
        tags: ['story-explicit', 'agent-created'],
        source: 'default-action-explicit-world-fact',
        ...lifecycle
      }),
      metadata: { factKind: 'map', source: 'explicit_world_fact_heuristic' }
    });
    proposals.push({
      id: `record_map_node_${map.id}`,
      when: 'success',
      tool: 'system.map_relationships.upsert_node',
      input: removeUndefined({
        mapId: map.id,
        name: map.name,
        type: map.type,
        tags: ['story-explicit', 'agent-created'],
        summary: map.summary
      }),
      metadata: { factKind: 'map_relationship_node', source: 'explicit_world_fact_heuristic' }
    });
    if (currentLocation) {
      const fromMap = {
        id: factId('map', currentLocation),
        name: currentLocation
      };
      proposals.push({
        id: `record_map_${fromMap.id}`,
        when: 'success',
        tool: 'system.map_registry.upsert_map',
        input: removeUndefined({
          mapId: fromMap.id,
          name: fromMap.name,
          type: 'city',
          summary: `${fromMap.name}在本轮剧情中作为出发地点出现。`,
          tags: ['story-explicit', 'agent-created'],
          source: 'default-action-explicit-world-fact',
          ...lifecycle
        }),
        metadata: { factKind: 'map', source: 'explicit_world_fact_heuristic' }
      });
      proposals.push({
        id: `record_map_route_${fromMap.id}_${map.id}`,
        when: 'success',
        tool: 'system.map_relationships.upsert_edge',
        input: removeUndefined({
          fromMapId: fromMap.id,
          toMapId: map.id,
          relationType: 'route',
          travelMode: 'walk',
          status: 'known',
          summary: `${fromMap.name}可以作为前往${map.name}的线索出发点。`,
          sourceText: source,
          tags: ['story-explicit', 'route']
        }),
        metadata: { factKind: 'map_route', source: 'explicit_world_fact_heuristic' }
      });
    }
  }

  const quest = extractExplicitQuestFact(source, { map, npc, item });
  if (quest) {
    kinds.add('quest');
    proposals.push({
      id: `record_quest_${quest.id}`,
      when: 'success',
      tool: 'system.quests.upsert_quest',
      input: removeUndefined({
        chatSessionId,
        questId: quest.id,
        title: quest.title,
        status: 'tracked',
        hookText: quest.hookText,
        objective: quest.objective,
        successCriteria: quest.successCriteria,
        knownFacts: quest.knownFacts,
        openLeads: quest.openLeads,
        stakeholders: quest.stakeholders,
        locations: quest.locations,
        difficultyHint: 'unknown',
        riskHint: 'unknown',
        antiRailroadRules: [
          'No fixed route chain; completion is based on satisfying the objective.',
          'Keep investigation convergent and avoid endless room-by-room extension.'
        ],
        metadata: {
          source: 'default-action-explicit-world-fact',
          sourceText: source
        }
      }),
      metadata: { factKind: 'quest', source: 'explicit_world_fact_heuristic' }
    });
  }

  const npcRelation = npc ? extractExplicitNpcRelationFact(source, { npc, actorId, actorName }) : undefined;
  if (npcRelation) {
    kinds.add('npc_relation');
    proposals.push({
      id: `record_npc_relation_${npcRelation.id}`,
      when: 'success',
      tool: 'system.npc_relationships.upsert_edge',
      input: removeUndefined({
        edgeId: npcRelation.id,
        fromNpcId: npc.id,
        toNpcId: actorId,
        relationType: npcRelation.type,
        trust: npcRelation.trust,
        weight: npcRelation.weight,
        status: npcRelation.status,
        summary: npcRelation.summary,
        sourceText: source,
        tags: ['story-explicit', npcRelation.type]
      }),
      metadata: { factKind: 'npc_relation', source: 'explicit_world_fact_heuristic' }
    });
  }

  const factions = extractExplicitFactionFacts(source);
  for (const faction of factions.factions) {
    kinds.add('faction');
    proposals.push({
      id: `record_faction_${faction.id}`,
      when: 'success',
      tool: 'system.factions.upsert_faction',
      input: removeUndefined({
        factionId: faction.id,
        name: faction.name,
        kind: 'organization',
        status: 'active',
        tags: ['story-explicit'],
        summary: `${faction.name}在本轮剧情中被提及。`,
        metadata: { source: 'default-action-explicit-world-fact' }
      }),
      metadata: { factKind: 'faction', source: 'explicit_world_fact_heuristic' }
    });
  }
  if (factions.actorFaction && factions.actorFaction.factionId) {
    kinds.add('faction_membership');
    proposals.push({
      id: `record_faction_membership_${factions.actorFaction.factionId}_${safeStateKey(actorId)}`,
      when: 'success',
      tool: 'system.factions.upsert_membership',
      input: removeUndefined({
        actorId,
        actorName,
        factionId: factions.actorFaction.factionId,
        status: factions.actorFaction.status,
        loyalty: factions.actorFaction.loyalty,
        reason: [factions.actorFaction.summary],
        sourceText: source,
        tags: ['story-explicit', 'stance']
      }),
      metadata: { factKind: 'faction_membership', source: 'explicit_world_fact_heuristic' }
    });
  }
  if (factions.relation) {
    kinds.add('faction_relation');
    proposals.push({
      id: `record_faction_relation_${factions.relation.id}`,
      when: 'success',
      tool: 'system.factions.upsert_relation',
      input: removeUndefined({
        relationId: factions.relation.id,
        fromFactionId: factions.relation.fromFactionId,
        toFactionId: factions.relation.toFactionId,
        relationType: factions.relation.type,
        tension: factions.relation.tension,
        status: factions.relation.status,
        summary: factions.relation.summary,
        sourceText: source,
        createMissingFactions: true,
        tags: ['story-explicit', 'faction-shift']
      }),
      metadata: { factKind: 'faction_relation', source: 'explicit_world_fact_heuristic' }
    });
  }

  const metric = extractExplicitMetricFact(source);
  if (metric) {
    kinds.add('extension_data');
    proposals.push({
      id: `record_metric_${metric.id}`,
      when: 'success',
      tool: 'system.data.quantify_text',
      input: removeUndefined({
        collection: metric.collection,
        id: metric.id,
        text: source,
        values: {
          metricName: metric.name,
          value: metric.value,
          sourceDescription: metric.sourceDescription
        },
        definition: {
          version: '1',
          prompt: 'Store explicit story metric values. Use provided values when present; do not infer unrelated fields.',
          numericFields: [
            { name: 'value', min: 0, max: 100, prompt: `Numeric value for ${metric.name}.` }
          ],
          textFields: [
            { name: 'metricName', prompt: 'Metric name from the story text.' },
            { name: 'sourceDescription', prompt: 'Short text description of the metric source.' }
          ]
        },
        storeRawText: true,
        rawTextField: 'sourceText',
        lifecycleScope: 'chat',
        lifecycleLevel: 'L1',
        chatSessionId
      }),
      metadata: { factKind: 'extension_data', source: 'explicit_world_fact_heuristic' }
    });
  }

  return {
    proposals,
    kinds: [...kinds]
  };
}

function tokenizeAndClassifyStoryFacts(source = '') {
  const text = String(source || '').normalize('NFKC').trim();
  const hasCue = hasExplicitWorldFactCue(text) || hasTokenizedWorldFactCue(text);
  const npcs = dedupeById(extractTokenizedNpcFacts(text));
  const items = dedupeById(extractTokenizedItemFacts(text));
  const maps = dedupeById(extractTokenizedMapFacts(text));
  const skills = dedupeById(extractTokenizedSkillFacts(text));
  const extensionFacts = dedupeById(extractTokenizedExtensionFacts(text));
  return {
    hasCue: Boolean(hasCue && (npcs.length || items.length || maps.length || skills.length || extensionFacts.length || extractExplicitFactionFacts(text).factions.length)),
    npcs,
    items,
    maps,
    skills,
    extensionFacts
  };
}

function hasTokenizedWorldFactCue(source = '') {
  return /记录|写入|入库|保存|创建|新增|设定|世界书|数据库|新NPC|新人物|新地图|新地点|新物品|获得|得到|拿到|拾取|交给我|学会|习得|掌握|接下|接受|传闻|委托|任务|关系|指数|等级|参数/u.test(source)
    || /\b(record|store|database|world\s*info|new|obtain|receive|learn|quest|rumor|metric|index|rating|level|parameter)\b/i.test(source);
}

function hasSceneNpcPresenceCue(source = '') {
  const text = String(source || '').normalize('NFKC');
  return /(?:加入|写入|添加|放入|挂载|进入).{0,12}(?:当前场景|场景|眼前|面前)|(?:当前场景|场景|眼前|面前|身边|附近|在场).{0,12}(?:出现|登场|现身|来到|站着|站在|靠近|有|加入|写入|挂载)|[\u4e00-\u9fa5A-Za-z0-9]{2,18}.{0,8}(?:出现|登场|现身|来到|在场|站在|离开|离去|退场|消失|不见).{0,12}(?:当前场景|场景|眼前|面前|身边|附近|视野)|(?:遇见|遇到|遭遇|发现|看见|看到|撞见).{0,18}(?:NPC|人物|修士|妖兽|魔兽|怪物|敌人|商人|守卫|护卫|炼丹师|剑修)|(?:NPC|人物|修士|妖兽|魔兽|怪物|敌人|商人|守卫|护卫|炼丹师|剑修)[^,，.。;；:：\n\r]{0,16}(?:出现|登场|现身|来到|在场|站在|离开|离去|退场|消失|不见)|(?:离开|离去|退场|消失|不见|移出).{0,12}(?:当前场景|场景|眼前|面前|身边|在场)/u.test(text)
    || /\b(?:scene NPC|mount NPC|mounted NPC|current scene|appears? in front|appears? here|is present|leaves? the scene|departs? the scene|unmount NPC)\b/i.test(text);
}

function hasSceneMapPresenceCue(source = '') {
  const text = String(source || '').normalize('NFKC');
  return /(?:当前场景|当前地点|所在地点|所在位置|场景地图|眼前区域|眼前地点|地图面板).{0,12}(?:变为|更新为|设为|显示|挂载|进入|抵达|到达|来到|打开|载入|是|为)|[\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:井底|洞府|洞窟|遗迹|山谷|森林|城镇|酒馆|矿井|秘境|坊市|宗门|山门|营地|村落|城|镇|村|塔|峰|谷|殿|宫|寺|庙|湖|河|港).{0,12}(?:成为|变为|写入|挂载|显示在|进入).{0,12}(?:当前场景|当前地点|场景地图|地图面板|眼前区域)|(?:进入|抵达|到达|来到).{0,10}(?:当前场景|当前地点|眼前区域|场景地图)?[^,，.。;；:：\n\r]{0,24}(?:井底|洞府|洞窟|遗迹|山谷|森林|城镇|酒馆|矿井|秘境|坊市|宗门|山门|营地|村落|城|镇|村|塔|峰|谷|殿|宫|寺|庙|湖|河|港)|(?:移出|卸载|离开|关闭|不再显示).{0,12}(?:当前场景|当前地点|场景地图|地图面板|眼前区域)/u.test(text)
    || /\b(?:scene map|mount map|mounted map|current map|current location|map panel|appears on map|leave(?:s|d)? current map|unmount map)\b/i.test(text);
}

function hasPartyRosterCue(source = '') {
  const text = String(source || '').normalize('NFKC');
  return /(?:邀请|招募|说服|让|带上|收下|接纳).{0,12}(?:同行|跟随|随行|入队|加入队伍|成为队友|成为同伴)|(?:加入|入队|归队|成为|变成).{0,12}(?:队伍|小队|队友|同伴|伙伴|随从|一员|成员)|(?:队友|同伴|伙伴|随从|队伍成员).{0,12}(?:加入|入队|归队|跟随|同行|随行|待命|外派|派去|离队)|(?:跟随|同行|随行|跟着).{0,12}(?:你|我|主角|玩家|队伍|小队|大家|一行人)|(?:留守|待命|留在后方|留在营地|原地待命)|(?:派去|分配去|安排去|受命前往|前去).{0,24}(?:侦察|调查|打探|守卫|巡逻|护送|研究|待命)|(?:离队|退队|脱队|退出队伍|离开队伍|不再跟随|移出队伍|从队伍移除|踢出|逐出)/u.test(text)
    || /\b(?:invite|recruit|join(?:s|ed)?(?: the)? party|party member|companion|follower|follow(?:s|ed)? me|standby|assigned|leave(?:s|d)?(?: the)? party|remove(?:d)? from(?: the)? party)\b/i.test(text);
}

function extractTokenizedNpcFacts(source = '') {
  const text = String(source || '');
  const rawValues = [
    ...[...text.matchAll(/(?:新NPC|NPC|人物|角色)\s*([^,，.。;；:：]{2,24})/gu)].map((match) => match[1]),
    ...[...text.matchAll(/(?:遇见|遇到|结识|认识|救下)\s*(?:新NPC|NPC|人物|角色)?\s*([^,，.。;；:：]{2,24}?)(?=,|，|他|她|给|把|请|$)/gu)].map((match) => match[1]),
    ...[...text.matchAll(/\b(?:new NPC|NPC|meet|met|rescue|rescued)\s+(.{2,60}?)(?:\s+END|\s+new item\b|\s+new map\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/gi)].map((match) => match[1])
  ];
  return rawValues.map(normalizeTokenizedNpcFact).filter(Boolean);
}

function normalizeTokenizedNpcFact(value = '') {
  const displayName = cleanNpcEntity(value);
  if (!displayName || displayName.length > 24) return undefined;
  if (looksLikeNonNpcEntity(displayName)) return undefined;
  const roleMatch = displayName.match(/^(铁匠|掌柜|老板娘|老板|猎人|矿工|修士|道士|巫师|护卫|长老|弟子|商人|炼丹师|药师|阵法师|剑修|医师|镖师|队长|祭司|学徒)(.{1,16})$/u)
    || displayName.match(/^(Hunter|Merchant|Blacksmith|Healer|Guard|Elder|Miner|Mage|Wizard|Priest|Scout|Captain|Alchemist|Doctor)\s+(.{1,40})$/i);
  const role = roleMatch?.[1] || '';
  const name = cleanStoryEntity(roleMatch?.[2] || displayName);
  if (!name || looksLikeNonNpcEntity(name)) return undefined;
  return {
    id: factId('npc', name),
    name,
    displayName,
    role,
    summary: `${displayName}在本轮剧情中登场。`
  };
}

function cleanNpcEntity(value = '') {
  return cleanStoryEntity(value)
    .replace(/^(?:NPC|人物|角色|新NPC|新人物)/iu, '')
    .replace(/^(?:被|我|玩家|主角|救下|遇见|遇到|结识|认识)/u, '')
    .trim();
}

function looksLikeNonNpcEntity(value = '') {
  return /(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴|灵石|功法|技能|法术|招式|剑诀|心法|身法|地图|井底|洞府|洞窟|遗迹|山谷|森林|矿井|酒馆|城|镇|村|营地|商会|帮|宗|派|门|盟|指数|等级|参数)$/u.test(value);
}

function extractTokenizedItemFacts(source = '') {
  const text = String(source || '');
  const suffix = '(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴|符纸|符箓|灵草|药草|矿石|材料|素材|护符|玉佩|法印|阵盘)';
  const bareItem = '(?:符纸|符箓|灵草|药草|矿石|材料|素材|钥匙|令牌|卷轴)';
  const rawValues = [
    ...[...text.matchAll(new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9]{1,16}${suffix})`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(new RegExp(`(${bareItem})`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(/\b(?:new item|item|obtain|receive|received|gets?|got)\s+(.{2,80}?(?:Token|Key|Potion|Scroll|Relic|Orb|Gem|Charm|Talisman|Blade|Sword|Herb|Pill|Material))(?:\s+END|\s+new map\b|\s+quest\b|\s+new NPC\b|\s+faction\b|\s+metric\b|$)/gi)].map((match) => match[1])
  ];
  return rawValues.map((name) => normalizeTokenizedItemFact(name, text)).filter(Boolean);
}

function normalizeTokenizedItemFact(value = '', source = '') {
  const name = cleanItemEntity(value);
  if (!name || /灵石/u.test(name) || name.length > 24) return undefined;
  const category = classifyItemCategory(name);
  const received = tokenContextHas(source, name, /交给我|给我|获得|拿到|取得|收入|放入背包|拾取|捡到|得到|赠予|奖励/u, /\b(gives? me|give me|obtain|obtained|receive|received|take|takes|loot|looted|reward|rewards)\b/i);
  return {
    id: factId('item', name),
    name,
    category,
    quantity: extractQuantityNearResourceName(source, name) || 1,
    received,
    description: `${name}在本轮剧情中出现。`
  };
}

function classifyItemCategory(name = '') {
  if (/钥匙|Key/iu.test(name)) return 'key';
  if (/丹药|药水|Pill|Potion/iu.test(name)) return 'consumable';
  if (/符纸|符箓|卷轴|Scroll/iu.test(name)) return 'scroll';
  if (/法器|护符|玉佩|法印|阵盘|Relic|Orb|Charm|Talisman/iu.test(name)) return 'artifact';
  if (/材料|素材|灵草|药草|矿石|Material|Herb/iu.test(name)) return 'material';
  return 'story_item';
}

function extractTokenizedMapFacts(source = '') {
  const text = String(source || '');
  const suffix = '(?:井底|洞府|洞窟|遗迹|山谷|森林|城镇|酒馆|矿井|秘境|坊市|宗门|山门|营地|村落|城|镇|村|塔|峰|谷|殿|宫|寺|庙|湖|河|港)';
  const rawValues = [
    ...[...text.matchAll(new RegExp(`(?:新地图|地图|地点)\\s*([^,，.。;；:：]{2,24}${suffix}?)`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(new RegExp(`(?:前往|去|进入|抵达|到达|发现|找到)\\s*(?:新地图|地图|地点)?\\s*([^,，.。;；:：]{2,24}${suffix})`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(/\b(?:new map|map|go to|enter|discover|found)\s+(.{2,60}?(?:Mine|Valley|Cave|Ruins|Forest|Town|Tavern|City|Camp|Gate|Temple|Tower|Peak|Lake|Harbor))(?:\s+END|\s+new NPC\b|\s+new item\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/gi)].map((match) => match[1])
  ];
  return rawValues.map(normalizeTokenizedMapFact).filter(Boolean);
}

function normalizeTokenizedMapFact(value = '') {
  const name = cleanStoryEntity(value);
  if (!name || name.length > 28 || looksLikeItemOrSkill(name)) return undefined;
  return {
    id: factId('map', name),
    name,
    type: /酒馆|客栈|坊市|城|镇|村|Tavern|Town|Village|City|Inn|Market/iu.test(name) ? 'city' : 'area',
    summary: `${name}在本轮剧情中成为可用地点。`
  };
}

function looksLikeItemOrSkill(value = '') {
  return /(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴|符纸|符箓|功法|技能|法术|招式|剑诀|心法|身法)$/u.test(value);
}

function extractTokenizedSkillFacts(source = '') {
  const text = String(source || '');
  const suffix = '(?:功法|技能|法术|招式|剑诀|心法|身法|秘术|术法)';
  const rawValues = [
    ...[...text.matchAll(new RegExp(`(?:新技能|新功法|技能|功法)\\s*([^,，.。;；:：]{1,18}${suffix}?)`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(new RegExp(`(?:学会|习得|掌握|获得|修成|练成)\\s*([^,，.。;；:：]{1,18}${suffix})`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(new RegExp(`(?:修炼|修习|学习|练功|研读|研习|练习|参悟|演练|练)\\s*([^,，.。;；:：]{1,18}${suffix})`, 'gu'))].map((match) => match[1]),
    ...[...text.matchAll(/\b(?:learn|learned|gain|gained|new skill)\s+(.{2,60}?(?:Skill|Spell|Technique|Art|Method))(?:\s+END|\s+new map\b|\s+quest\b|\s+new NPC\b|\s+faction\b|\s+metric\b|$)/gi)].map((match) => match[1])
  ];
  return rawValues.map((name) => normalizeTokenizedSkillFact(name, text)).filter(Boolean);
}

function normalizeTokenizedSkillFact(value = '', source = '') {
  const name = cleanStoryEntity(value);
  if (!name || name.length > 24) return undefined;
  const learned = tokenContextHas(source, name, /学会|习得|掌握|获得|修成|练成/u, /\b(learn|learned|gain|gained|master|mastered)\b/i);
  const training = tokenContextHas(source, name, /修炼|修习|学习|练功|研读|研习|练习|参悟|演练|练/u, /\b(train|training|practice|study|studying)\b/i);
  return {
    id: `skill_${safeStateKey(name)}`,
    name,
    category: /功法|心法|身法|Method/iu.test(name) ? 'cultivation' : 'skill',
    learned,
    actorSkillStatus: learned ? 'learned' : (training ? 'in_progress' : ''),
    description: `${name}在本轮剧情中出现。`
  };
}

function extractTokenizedExtensionFacts(source = '') {
  const text = String(source || '');
  const facts = [];
  const metric = extractExplicitMetricFact(text);
  if (metric) facts.push(metricFactToExtension(metric));
  for (const match of text.matchAll(/(?:记录|新增|创建|自定义扩展数据|扩展数据|新设定|设定项)\s*[:：]?\s*([^,，.。;；:：]{2,24}?)(?:目前|当前|为|是|=|:|：)\s*([^,，.。;；]{1,40})/gu)) {
    const name = cleanExtensionFactName(match[1]);
    const valueText = cleanStoryEntity(match[2]);
    if (!name || !valueText || /指数$/u.test(name)) continue;
    facts.push(genericExtensionFact(name, valueText, text));
  }
  for (const match of text.matchAll(/([^,，.。;；:：]{1,20}(?:等级|参数|评分|浓度|危险度|稳定度|污染度|战力|威胁))(?:目前|当前|为|是|=|:|：){0,3}\s*([A-Za-z甲乙丙丁戊己庚辛壬癸零一二两三四五六七八九十百千万\d.]{1,16})/gu)) {
    const name = cleanExtensionFactName(match[1]);
    const valueText = cleanStoryEntity(match[2]);
    if (!name || !valueText) continue;
    facts.push(genericExtensionFact(name, valueText, text));
  }
  return facts.filter(Boolean);
}

function metricFactToExtension(metric = {}) {
  return {
    id: metric.id,
    kind: 'metric',
    collection: metric.collection || 'story_metrics',
    values: {
      metricName: metric.name,
      value: metric.value,
      sourceDescription: metric.sourceDescription
    },
    definition: {
      version: '1',
      prompt: 'Store explicit story metric values. Use provided values when present; do not infer unrelated fields.',
      numericFields: [
        { name: 'value', min: 0, max: 100, prompt: `Numeric value for ${metric.name}.` }
      ],
      textFields: [
        { name: 'metricName', prompt: 'Metric name from the story text.' },
        { name: 'sourceDescription', prompt: 'Short text description of the metric source.' }
      ]
    }
  };
}

function genericExtensionFact(name = '', valueText = '', source = '') {
  const numericValue = parseQuantityToken(valueText);
  const values = Number.isFinite(numericValue)
    ? { factName: name, numericValue, factValue: valueText }
    : { factName: name, factValue: valueText };
  return {
    id: factId('ext', name),
    kind: 'extension_fact',
    collection: 'story_extension_facts',
    values,
    definition: {
      version: '1',
      prompt: 'Store explicit story facts that do not fit existing NPC, map, item, faction, quest, skill, or relationship tools.',
      numericFields: Number.isFinite(numericValue)
        ? [{ name: 'numericValue', prompt: `Numeric value for ${name}.` }]
        : [],
      textFields: [
        { name: 'factName', prompt: 'Name of the explicit story fact.' },
        { name: 'factValue', prompt: 'Literal value or qualitative rating from the story text.' }
      ]
    },
    sourceText: source
  };
}

function cleanExtensionFactName(value = '') {
  return cleanStoryEntity(value)
    .replace(/^(?:一个|一条|一项|自定义|扩展数据|新设定|设定项|记录)/u, '')
    .trim();
}

function tokenContextHas(source = '', token = '', zhPattern, enPattern) {
  const text = String(source || '');
  const index = token ? text.indexOf(token) : -1;
  const window = index >= 0
    ? text.slice(Math.max(0, index - 24), Math.min(text.length, index + token.length + 24))
    : text;
  return Boolean((zhPattern && zhPattern.test(window)) || (enPattern && enPattern.test(window)));
}

function dedupeById(values = []) {
  const byId = new Map();
  for (const value of normalizeArray(values)) {
    if (!value?.id) continue;
    byId.set(value.id, value);
  }
  return [...byId.values()];
}

function hasExplicitWorldFactCue(source = '') {
  return /新NPC|新地图|委托|任务|传闻|钥匙|交给我|获得|关系|信任|敌视|阵营|帮|宗|派|门|商会|盟|指数|扩展数据|污染源/u.test(source)
    || /\b(new NPC|new map|new item|quest|rumor|token|key|gives me|obtain|relationship|relation|trusts?|hostile|faction|gang|sect|guild|clan|order|alliance|metric|index|source)\b/i.test(source);
}

function extractExplicitNpcFact(source = '') {
  const match = source.match(/(?:新NPC|遇见新NPC|遇到新NPC)\s*([^,，.。;；:：]{2,24})/u)
    || source.match(/(?:遇见|遇到|结识|认识)\s*新NPC\s*([^,，.。;；:：]{2,24}?)(?:,|，|他|她|给|把|请|$)/u)
    || source.match(/\bnew NPC\s+(.{2,60}?)(?:\s+END|\s+new item\b|\s+new map\b|\s+accept quest\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/i)
    || source.match(/\bmeet\s+new NPC\s+(.{2,60}?)(?:\s+END|\s+he\b|\s+she\b|\s+gives\b|\s+asks\b|$)/i);
  const displayName = cleanStoryEntity(match?.[1] || '');
  if (!displayName) return undefined;
  const roleMatch = displayName.match(/^(铁匠|掌柜|老板娘|老板|猎人|矿工|修士|道士|巫师|护卫|长老|弟子|商人)(.{1,16})$/u)
    || displayName.match(/^(Hunter|Merchant|Blacksmith|Healer|Guard|Elder|Miner|Mage|Wizard|Priest|Scout|Captain)\s+(.{1,40})$/i);
  const role = roleMatch?.[1] || '';
  const name = cleanStoryEntity(roleMatch?.[2] || displayName);
  if (!name) return undefined;
  return {
    id: factId('npc', name),
    name,
    displayName,
    role,
    summary: `${displayName}在本轮剧情中登场。`
  };
}

function extractCurrentLocationFact(source = '') {
  const match = source.match(/在([^,，.。;；:：]{2,24}?(?:酒馆|客栈|市场|宗门|城|镇|村|营地))/u)
    || source.match(/\blocation\s+(.{2,50}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+new map\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/i)
    || source.match(/\bin\s+(.{2,50}?(?:Tavern|Town|Market|Camp|Village|City|Sect|Inn))(?:\s+END|\s+new NPC\b|\s+new item\b|\s+new map\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/i);
  return cleanStoryEntity(match?.[1] || '');
}

function extractExplicitItemFact(source = '') {
  const matches = [
    ...[...String(source || '').matchAll(/([\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴))/gu)]
      .map((match) => match[1]),
    ...[...String(source || '').matchAll(/\b(?:new item|item)\s+(.{2,60}?(?:Token|Key|Potion|Scroll|Relic|Orb|Gem|Charm|Talisman|Blade|Sword|Herb|Pill))(?:\s+END|\s+new map\b|\s+accept quest\b|\s+quest\b|\s+new NPC\b|\s+faction\b|\s+metric\b|$)/gi)]
      .map((match) => match[1]),
    ...[...String(source || '').matchAll(/\bgives me\s+(.{2,60}?(?:Token|Key|Potion|Scroll|Relic|Orb|Gem|Charm|Talisman|Blade|Sword|Herb|Pill))(?:\s+END|\s+asks\b|\s+new map\b|\s+faction\b|\s+metric\b|$)/gi)]
      .map((match) => match[1])
  ]
    .map((value) => cleanItemEntity(value))
    .filter(Boolean);
  const name = matches.find((candidate) => /钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴|Token|Key|Potion|Scroll|Relic|Orb|Gem|Charm|Talisman|Blade|Sword|Herb|Pill/iu.test(candidate)) || '';
  if (!name) return undefined;
  return {
    id: factId('item', name),
    name,
    category: /钥匙|Key/iu.test(name) ? 'key' : 'story_item',
    description: `${name}在本轮剧情中出现。`
  };
}

function extractExplicitMapFact(source = '') {
  const match = source.match(/新地图\s*([^,，.。;；:：]{2,24})/u)
    || source.match(/(?:前往|去|进入)\s*(?:新地图)?\s*([^,，.。;；:：]{2,24}?(?:井底|洞府|洞窟|遗迹|山谷|森林|城镇|酒馆|矿井))/u)
    || source.match(/\bnew map\s+(.{2,50}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+accept quest\b|\s+quest\b|\s+faction\b|\s+metric\b|$)/i)
    || source.match(/\bgo to\s+(?:new map\s+)?(.{2,50}?(?:Mine|Valley|Cave|Ruins|Forest|Town|Tavern|City|Camp|Gate|Temple))(?:\s+END|\s+new NPC\b|\s+new item\b|\s+faction\b|\s+metric\b|$)/i);
  const name = cleanStoryEntity(match?.[1] || '');
  if (!name) return undefined;
  return {
    id: factId('map', name),
    name,
    type: /酒馆|城|镇|村|Tavern|Town|Village|City/iu.test(name) ? 'city' : 'area',
    summary: `${name}在本轮剧情中成为可用地点。`
  };
}

function extractExplicitQuestFact(source = '', { map, npc, item } = {}) {
  const match = source.match(/(?:接下|接受|领取).{0,12}(调查[^,，.。;；:：]{2,24}?)(?:的委托|委托|任务|$)/u)
    || source.match(/传闻[:：]\s*([^.。;；]{6,60})/u)
    || source.match(/\b(?:accept|take|track)\s+quest\s+(.{2,80}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+new map\b|\s+faction\b|\s+metric\b|$)/i)
    || source.match(/\bquest\s+(.{2,80}?)(?:\s+END|\s+new NPC\b|\s+new item\b|\s+new map\b|\s+faction\b|\s+metric\b|$)/i);
  const raw = cleanStoryEntity(match?.[1] || '');
  if (!raw) return undefined;
  const title = /调查/u.test(raw) || /^Investigate\b/i.test(raw) ? raw.replace(/的$/, '') : `调查${map?.name || '传闻'}`;
  const objective = map?.name
    ? `调查${map.name}相关线索并确认传闻真相。`
    : `${title}。`;
  return {
    id: factId('quest', title),
    title,
    hookText: source,
    objective,
    successCriteria: [
      '确认传闻核心事实',
      ...(item ? [`查明${item.name}的用途或来源`] : []),
      ...(map ? [`调查${map.name}`] : [])
    ],
    knownFacts: [
      raw,
      ...(item ? [`出现物品：${item.name}`] : []),
      ...(npc ? [`委托相关人物：${npc.displayName || npc.name}`] : [])
    ],
    openLeads: [
      ...(map ? [`前往${map.name}`] : []),
      ...(npc ? [`询问${npc.displayName || npc.name}`] : [])
    ],
    stakeholders: npc ? [npc.name] : [],
    locations: map ? [map.name] : []
  };
}

function extractExplicitNpcRelationFact(source = '', { npc, actorId, actorName } = {}) {
  if (!/信任|感谢|敌视|仇视|怀疑|好感/u.test(source) && !/\b(trusts?|thanks?|likes?|hostile|hates?|distrusts?|suspects?)\b/i.test(source)) return undefined;
  if (/信任|感谢|好感/u.test(source) || /\b(trusts?|thanks?|likes?)\b/i.test(source)) {
    return {
      id: factId('rel', `${npc.id}_${actorId}_trust`),
      type: 'trust',
      trust: 30,
      weight: 30,
      status: 'positive',
      summary: `${npc.name}对${actorName || actorId}的信任上升。`
    };
  }
  return {
    id: factId('rel', `${npc.id}_${actorId}_hostile`),
    type: 'hostile',
    trust: -30,
    weight: -30,
    status: 'hostile',
    summary: `${npc.name}对${actorName || actorId}产生敌意。`
  };
}

function extractExplicitFactionFacts(source = '') {
  const names = compactUnique([
    ...[...String(source || '').matchAll(/([^\s,，.。;；:：和]{1,8}(?:商会|帮|宗|派|门|盟|国|城|家|族|教|团))/gu)]
      .map((match) => normalizeFactionName(match[1])),
    ...[...String(source || '').matchAll(/\bfaction\s+(.{2,60}?(?:Gang|Sect|Guild|Clan|Order|Alliance|Kingdom|House|Cult|Band|Company|Church|Temple))(?:\s+END|\s+hostile\b|\s+relation\b|\s+and\b|\s+starts\b|\s+becomes\b|$)/gi)]
      .map((match) => normalizeFactionName(match[1])),
    ...[...String(source || '').matchAll(/\b([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,4}\s+(?:Gang|Sect|Guild|Clan|Order|Alliance|Kingdom|House|Cult|Band|Company|Church|Temple))\b/g)]
      .map((match) => normalizeFactionName(match[1]))
  ].filter(Boolean));
  const factions = names.map((name) => ({ id: factId('faction', name), name }));
  const actorFactionName = names.find((name) => new RegExp(`${escapeRegExp(name)}.{0,24}(?:敌视|仇视|针对|通缉|hostile|hates?|targets?|wanted)`, 'iu').test(source));
  const actorFaction = actorFactionName
    ? {
        factionId: factId('faction', actorFactionName),
        status: 'hostile',
        loyalty: -50,
        summary: `${actorFactionName}开始敌视玩家角色。`
      }
    : undefined;
  const relation = names.length >= 2 && (/关系.{0,16}(?:紧张|敌对|恶化|合作|中立)/u.test(source) || /\brelation(?:ship)?.{0,32}(?:tense|hostile|worse|cooperat|neutral)/i.test(source))
    ? {
        id: factId('frel', `${names[0]}_${names[1]}`),
        fromFactionId: factId('faction', names[0]),
        toFactionId: factId('faction', names[1]),
        type: /敌对|hostile/i.test(source) ? 'hostile' : (/合作|cooperat/i.test(source) ? 'cooperation' : 'tense'),
        tension: /紧张|敌对|恶化|tense|hostile|worse/i.test(source) ? 65 : 20,
        status: /紧张|敌对|恶化|tense|hostile|worse/i.test(source) ? 'tense' : 'active',
        summary: `${names[0]}与${names[1]}的关系出现变化。`
      }
    : undefined;
  return { factions, actorFaction, relation };
}

function extractExplicitMetricFact(source = '') {
  const match = source.match(/(?:^|[,，.。;；:：\s])([^,，.。;；:：]{1,20}指数)(?:目前|当前|为|是|[:：]){0,3}\s*(\d+(?:\.\d+)?)/u)
    || source.match(/\bmetric\s+(.{2,50}?(?:Index|Score|Level|Rating|Value))(?:\s+currently|\s+now|\s+is|\s+at|\s*=|\s+){0,3}\s*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const name = cleanStoryEntity(match[1]);
  const value = Number(match[2]);
  if (!name || !Number.isFinite(value)) return undefined;
  const sourceMatch = source.match(/污染源描述为([^，。；;]+)/u)
    || source.match(/来源(?:描述)?为([^，。；;]+)/u)
    || source.match(/\bsource\s+(.{1,80}?)(?:\s+END|\s+Please\b|$)/i);
  return {
    id: factId('metric', name),
    collection: 'story_metrics',
    name,
    value,
    sourceDescription: cleanStoryEntity(sourceMatch?.[1] || '')
  };
}

function cleanStoryEntity(value = '') {
  return String(value || '')
    .replace(/^[：:，,。；;\s]+|[：:，,。；;\s]+$/gu, '')
    .replace(/^(?:但|一个|一位|一枚|一件|新|的|去|到|前往|请我去)/u, '')
    .replace(/\s+END$/i, '')
    .trim();
}

function cleanItemEntity(value = '') {
  const cleaned = cleanStoryEntity(value)
    .replace(/^(?:请记录|记录|写入|入库|保存|新增|创建)/u, '')
    .replace(/^(?:获得|得到|拿到|拾取|捡到|领取|收取|交给我|给我|赠予|奖励)/u, '')
    .replace(/^(?:他把|她把|其把|把|他给我|她给我)/u, '')
    .replace(/^.*(?:一枚|一件|一个|一把)/u, '')
    .trim();
  const suffixMatch = cleaned.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,8}(?:钥匙|令牌|宝珠|遗物|法器|丹药|药水|卷轴))$/u);
  return suffixMatch?.[1] || cleaned;
}

function normalizeFactionName(value = '') {
  const cleaned = cleanStoryEntity(value);
  const suffixMatch = cleaned.match(/([^和,，.。;；:：]{1,8}(?:商会|帮|宗|派|门|盟|国|城|家|族|教|团))$/u);
  return suffixMatch?.[1] || cleaned;
}

function factId(prefix, value = '') {
  const key = safeStateKey(value);
  const ascii = key
    .replace(/[^a-z0-9_.-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${prefix}_${ascii || 'x'}_${stableTextHash(value)}`.slice(0, 96);
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compactUnique(values = []) {
  return [...new Set(normalizeArray(values).map((value) => String(value || '').trim()).filter(Boolean))];
}

function stableTextHash(value = '') {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function extractTrainingProgressName(source = '') {
  const text = String(source || '').trim();
  const explicit = text.match(/(?:修炼|修习|学习|练功|研读|研习|练习|参悟|演练|练)\s*([^，,。；;！!\n]{1,24})/u)?.[1];
  if (explicit) return cleanTrainingProgressName(explicit);
  const named = text.match(/([\u4e00-\u9fa5A-Za-z0-9]{1,18}(?:功法|技能|法术|招式|剑诀|心法|身法|秘术|术法))/u)?.[1];
  if (named) return cleanTrainingProgressName(named);
  if (/入门功法/u.test(text)) return '入门功法';
  if (/基础/u.test(text)) return '基础训练';
  return '日常修炼';
}

function cleanTrainingProgressName(value = '') {
  const cleaned = String(value || '')
    .replace(/^(?:一下|一些|一点|这门|那门|一门|这个|那个)/u, '')
    .replace(/[零一二两三四五六七八九十百千万\d]+(?:次|遍|轮|日|天|个时辰|小时)$/u, '')
    .replace(/(?:并|同时|然后|再|顺便|领取|获得|拿取|收取).+$/u, '')
    .trim();
  return cleaned || String(value || '').trim();
}

function extractResourcePickupName(source = '') {
  const text = String(source || '').trim();
  if (/灵石/u.test(text)) return /每月/u.test(text) ? '每月灵石' : '灵石';
  if (/月供/u.test(text)) return '月供';
  if (/俸禄/u.test(text)) return '俸禄';
  if (/月俸/u.test(text)) return '月俸';
  if (/补给/u.test(text)) return '补给';
  if (/资源/u.test(text)) return '定期资源';
  return '定期资源';
}

function inferRoutineResourcePickup(source = '', progress = {}) {
  const name = normalizeOptionalText(progress.name) || extractResourcePickupName(source);
  const currency = {};
  const itemMap = new Map();
  for (const entry of extractRoutineCurrencyEntries(source)) {
    currency[entry.currencyKey] = (Number(currency[entry.currencyKey]) || 0) + entry.amount;
  }
  for (const entry of extractRoutineItemEntries(source)) {
    const id = safeStateKey(entry.name);
    const previous = itemMap.get(id) || {
      id,
      name: entry.name,
      quantity: 0,
      tags: ['routine_reward'],
      metadata: {
        semanticHint: 'routine_resource_pickup',
        originalTerm: entry.name
      }
    };
    previous.quantity += entry.amount;
    itemMap.set(id, previous);
  }
  if (!Object.keys(currency).length && !itemMap.size) {
    const fallbackAmount = extractQuantityNearResourceName(source, name) || 1;
    const canonical = canonicalCurrencyFromAbstractResource({ name, quantity: fallbackAmount }, source);
    if (canonical) {
      currency[canonical.key] = (Number(currency[canonical.key]) || 0) + canonical.amount;
    } else {
      const id = safeStateKey(name);
      itemMap.set(id, {
        id,
        name,
        quantity: fallbackAmount,
        tags: ['routine_reward'],
        metadata: {
          semanticHint: 'abstract_resource_pickup',
          originalTerm: name
        }
      });
    }
  }
  return {
    originalTerm: name,
    currency,
    items: [...itemMap.values()]
  };
}

function extractRoutineCurrencyEntries(source = '') {
  const text = String(source || '');
  const entries = [];
  const termPattern = '(?:下品|低品|中品|上品|高品)?\\s*灵石|灵石';
  for (const match of text.matchAll(new RegExp(`(${termPattern})\\s*([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)?\\s*(?:个|枚|块|颗|份)?`, 'gu'))) {
    if (hasQuantityImmediatelyBefore(text, match.index || 0)) continue;
    const term = normalizeResourceTerm(match[1]);
    if (!term || !/灵石/u.test(term)) continue;
    const amount = parseQuantityToken(match[2]) || 1;
    const canonical = canonicalCurrencyFromAbstractResource({ name: term, quantity: amount }, text);
    if (canonical) entries.push({ currencyKey: canonical.key, amount: canonical.amount, originalTerm: canonical.originalTerm });
  }
  for (const match of text.matchAll(new RegExp(`([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)\\s*(?:个|枚|块|颗|份)?\\s*(${termPattern})`, 'gu'))) {
    const term = normalizeResourceTerm(match[2]);
    if (!term || !/灵石/u.test(term)) continue;
    const amount = parseQuantityToken(match[1]) || 1;
    const canonical = canonicalCurrencyFromAbstractResource({ name: term, quantity: amount }, text);
    if (canonical) entries.push({ currencyKey: canonical.key, amount: canonical.amount, originalTerm: canonical.originalTerm });
  }
  return mergeResourceEntries(entries, (entry) => entry.currencyKey);
}

function extractRoutineItemEntries(source = '') {
  const text = String(source || '');
  const entries = [];
  const termPattern = '(?:[\\u4e00-\\u9fa5A-Za-z]{1,12}(?:丹药|丹|药水|符纸|符箓|材料|素材|兽骨|兽皮|灵草|药草|矿石|钥匙|令牌|卷轴)|符纸|符箓|材料|素材|兽骨|兽皮|灵草|药草|矿石|钥匙|令牌|卷轴)';
  for (const match of text.matchAll(new RegExp(`(${termPattern})\\s*([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)?\\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?`, 'gu'))) {
    if (!/^(?:和|与|及|并|以及)/u.test(String(match[1] || '')) && hasQuantityImmediatelyBefore(text, match.index || 0)) continue;
    const name = normalizeResourceTerm(match[1]);
    if (!name || /灵石/u.test(name)) continue;
    const amount = parseQuantityToken(match[2]) || 1;
    entries.push({ name, amount });
  }
  for (const match of text.matchAll(new RegExp(`([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)\\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?\\s*(${termPattern})`, 'gu'))) {
    if (/^(?:和|与|及|并|以及)/u.test(String(match[2] || '').replace(/\s+/g, ''))) continue;
    const name = normalizeResourceTerm(match[2]);
    if (!name || /灵石/u.test(name)) continue;
    entries.push({ name, amount: parseQuantityToken(match[1]) || 1 });
  }
  return mergeResourceEntries(entries, (entry) => entry.name);
}

function hasQuantityImmediatelyBefore(source = '', index = 0) {
  const before = String(source || '').slice(Math.max(0, index - 12), index);
  return /[零一二两三四五六七八九十百千万\d]+(?:\.\d+)?\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?\s*$/u.test(before);
}

function mergeResourceEntries(entries = [], keyFn = (entry) => entry.name || entry.currencyKey) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = keyFn(entry);
    if (!key) continue;
    const previous = byKey.get(key);
    if (previous) {
      previous.amount += Number(entry.amount) || 1;
    } else {
      byKey.set(key, { ...entry, amount: Number(entry.amount) || 1 });
    }
  }
  return [...byKey.values()];
}

function extractQuantityNearResourceName(source = '', name = '') {
  const text = String(source || '');
  const term = normalizeResourceTerm(name);
  if (!text || !term) return undefined;
  const escaped = escapeRegExp(term);
  const after = text.match(new RegExp(`${escaped}\\s*([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)\\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?`, 'u'));
  if (after) return parseQuantityToken(after[1]);
  const before = text.match(new RegExp(`([零一二两三四五六七八九十百千万\\d]+(?:\\.\\d+)?)\\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件)?\\s*${escaped}`, 'u'));
  if (before) return parseQuantityToken(before[1]);
  return undefined;
}

function normalizeResourceTerm(value = '') {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/^(?:和|与|及|并|以及|领取|领|拿取|获得|收取)/u, '')
    .replace(/[，,。；;！!：:、]+$/u, '')
    .trim();
}

function parseQuantityToken(value = '') {
  const token = String(value || '').trim();
  if (!token) return undefined;
  if (/^\d+(?:\.\d+)?$/u.test(token)) {
    const number = Number(token);
    return Number.isFinite(number) && number > 0 ? number : undefined;
  }
  const number = parseChineseInteger(token);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function extractFirstPositiveNumber(source = '') {
  const text = String(source || '');
  const match = text.match(/\d+(?:\.\d+)?/u);
  const number = match ? Number(match[0]) : parseChineseQuantity(text);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function parseChineseQuantity(source = '') {
  const text = String(source || '');
  const match = text.match(/([零一二两三四五六七八九十百千万]+)\s*(?:个|枚|块|颗|粒|份|瓶|张|把|件|只|头|名|位|群|队|点|枚)?/u);
  if (!match) return undefined;
  return parseChineseInteger(match[1]);
}

function parseChineseInteger(value = '') {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const digitMap = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (/^[零一二两三四五六七八九]$/u.test(text)) return digitMap[text];
  let total = 0;
  let section = 0;
  let number = 0;
  const unitMap = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  for (const char of text) {
    if (digitMap[char] !== undefined) {
      number = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) continue;
    if (unit === 10000) {
      section = (section + number) || 1;
      total += section * unit;
      section = 0;
    } else {
      section += (number || 1) * unit;
    }
    number = 0;
  }
  return total + section + number;
}

function safeStateKey(value = '') {
  const text = String(value || 'value').trim().toLowerCase();
  const converted = text
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return converted || 'value';
}

export function normalizeAbsurdityJudgement(input = {}, { sourceText = '', plan } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Absurdity judgement must be a plain object');
  }
  const level = normalizeAbsurdityLevel(input.absurdityLevel || input.level || input.category);
  const requiresExplanation = input.requiresAbsurdityExplanationOnSuccess !== undefined
    ? Boolean(input.requiresAbsurdityExplanationOnSuccess)
    : ['absurd', 'extreme', 'impossibleButPlayable'].includes(level);
  return {
    judgementId: normalizeOptionalText(input.judgementId || input.id) || createId('absurd'),
    status: normalizeAbsurdityStatus(input.status),
    absurdityLevel: level,
    relativeTo: normalizeObject(input.relativeTo),
    summary: normalizeOptionalText(input.summary || input.reason || input.reasoning),
    factors: normalizeAbsurdityFactors(input.factors || input.analysis),
    canAttempt: input.canAttempt === undefined ? true : Boolean(input.canAttempt),
    shouldRollOrResolve: input.shouldRollOrResolve === undefined ? true : Boolean(input.shouldRollOrResolve),
    successDoesNotMeanExactWish: input.successDoesNotMeanExactWish === undefined ? true : Boolean(input.successDoesNotMeanExactWish),
    requiresAbsurdityExplanationOnSuccess: requiresExplanation,
    checkGuidance: normalizeObject(input.checkGuidance),
    explanationSeeds: normalizeStringArray(input.explanationSeeds || input.seeds),
    boundaries: normalizeStringArray(input.boundaries || input.boundaryNotes),
    sourceText: normalizeOptionalText(input.sourceText || sourceText || plan?.sourceText),
    metadata: normalizeObject(input.metadata)
  };
}

export function normalizeAbsurdityExplanation(input = {}, { sourceText = '', judgement = {}, actionResult } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Absurdity explanation must be a plain object');
  }
  return {
    explanationId: normalizeOptionalText(input.explanationId || input.id) || createId('absurdexp'),
    status: normalizeAbsurdityExplanationStatus(input.status),
    premise: normalizeOptionalText(input.premise || input.sourceText || sourceText || judgement.sourceText),
    acceptedOutcome: normalizeOptionalText(input.acceptedOutcome || input.outcome || summarizeActionSuccess(actionResult)),
    explanationMode: normalizeOptionalText(input.explanationMode || input.mode) || 'hidden-setting',
    explanation: normalizeOptionalText(input.explanation || input.summary || input.reason),
    consequences: normalizeConsequenceList(input.consequences || input.followUpConsequences),
    followUpHooks: normalizeStringArray(input.followUpHooks || input.hooks),
    narration: normalizeObject(input.narration),
    suggestedProposals: normalizeArray(input.suggestedProposals || input.proposals)
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item)),
    metadata: normalizeObject(input.metadata)
  };
}

function buildHeuristicAppealDecision(input = {}) {
  if (input.revisedPlan) {
    return {
      ...ACTION_APPEAL_DECISION_TEMPLATE,
      appealId: createId('appeal'),
      status: 'accepted',
      originalActionId: input.originalPlan?.actionId || input.plan?.actionId || '',
      disputedRuling: input.originalRuling || input.originalNarration || '',
      playerArgument: input.playerArgument || '',
      requestedOutcome: input.requestedOutcome || '',
      summary: '玩家提供了明确 revisedPlan，按该修正计划重裁。',
      revisedPlan: input.revisedPlan,
      findings: [{
        issue: 'explicit_revised_plan',
        evaluation: '调用方提供了可执行修正计划。',
        supportsPlayer: true
      }],
      correction: {
        shouldChangeRuling: true,
        recommendedOutcome: 'Apply provided revised plan.',
        rerollRecommended: true,
        rollbackRecommended: false
      },
      metadata: {
        source: 'heuristic_rejudgement',
        explicitRevisedPlan: true
      }
    };
  }

  const originalPlan = normalizeObject(input.originalPlan || input.plan);
  const checks = normalizeArray(originalPlan.checks);
  if (!checks.length) return undefined;
  const argument = [
    input.playerArgument,
    input.additionalInfo,
    input.rebuttal,
    input.appealText,
    input.requestedOutcome
  ].map((value) => String(value || '')).join('\n');
  const correction = inferAppealCorrection(argument);
  if (!correction.shouldChange) return undefined;

  const revisedPlan = {
    ...originalPlan,
    actionId: `${originalPlan.actionId || createId('act')}_rejudged`,
    checks: checks.map((check) => reviseAppealCheck(check, correction)),
    metadata: {
      ...normalizeObject(originalPlan.metadata),
      rejudgementHeuristic: true,
      rejudgementReason: correction.reason,
      rejudgementBonus: correction.bonus || undefined,
      rejudgementThresholdAdjustment: correction.thresholdAdjustment || undefined,
      rejudgementAdvantage: correction.advantage || undefined
    }
  };

  return {
    ...ACTION_APPEAL_DECISION_TEMPLATE,
    appealId: createId('appeal'),
    status: correction.partial ? 'partiallyAccepted' : 'accepted',
    originalActionId: originalPlan.actionId || '',
    disputedRuling: input.originalRuling || input.originalNarration || '',
    playerArgument: input.playerArgument || argument,
    requestedOutcome: input.requestedOutcome || '',
    summary: '玩家申诉提供了可核验的遗漏加值、优势或难度依据，系统生成修正计划并重新裁决。',
    findings: [{
      issue: correction.reason,
      evaluation: '该依据会影响检定输入，但不会直接承认玩家声称的结果。',
      supportsPlayer: true
    }],
    correction: {
      shouldChangeRuling: true,
      recommendedOutcome: 'Rerun with corrected check input.',
      rerollRecommended: true,
      rollbackRecommended: false
    },
    revisedPlan,
    metadata: {
      source: 'heuristic_rejudgement'
    }
  };
}

function inferAppealCorrection(argument = '') {
  const text = String(argument || '').normalize('NFKC');
  if (!text.trim()) return { shouldChange: false };
  const concreteBasis = /漏算|遗漏|忘记|未计算|熟练|工具|优势|advantage|modifier|加值|修正|属性|技能|背景|装备|道具|线索|证据|规则|DC|难度|过高|降低|地形|高地|掩护/u.test(text)
    || /\b(?:missed|forgot|proficiency|tool|advantage|modifier|bonus|evidence|rule|dc|difficulty|too high|lower)\b/i.test(text);
  const onlyOutcomeDemand = /(?:我已经|必须|直接|无条件|无需|不用).{0,12}(?:成功|通过|获胜|写入|判定|检定)|\b(?:must succeed|auto success|no roll|no check)\b/i.test(text);
  if (!concreteBasis || onlyOutcomeDemand && !/漏算|遗漏|熟练|工具|优势|modifier|加值|规则|DC|难度|evidence|proficiency|bonus|advantage/i.test(text)) {
    return { shouldChange: false };
  }
  const explicitBonus = text.match(/[+＋]\s*(\d{1,2})/) || text.match(/(?:加值|修正|bonus|modifier).{0,6}(\d{1,2})/i);
  let bonus = explicitBonus ? Number(explicitBonus[1]) : 0;
  if (!Number.isFinite(bonus)) bonus = 0;
  if (!bonus && /熟练|工具|proficiency|tool/i.test(text)) bonus = 2;
  if (!bonus && /线索|证据|准备|观察|evidence|prepared/i.test(text)) bonus = 1;
  bonus = Math.max(0, Math.min(10, bonus));
  const advantage = /优势|advantage/i.test(text);
  const lowerDifficulty = /DC|难度|过高|降低|too high|difficulty|lower/i.test(text);
  const thresholdAdjustment = lowerDifficulty ? -2 : 0;
  return {
    shouldChange: bonus > 0 || advantage || thresholdAdjustment < 0,
    partial: onlyOutcomeDemand,
    bonus,
    advantage,
    thresholdAdjustment,
    reason: [
      bonus > 0 ? `missed_bonus:+${bonus}` : '',
      advantage ? 'missed_advantage' : '',
      thresholdAdjustment < 0 ? 'difficulty_too_high' : ''
    ].filter(Boolean).join(',') || 'concrete_appeal_basis'
  };
}

function reviseAppealCheck(check = {}, correction = {}) {
  if (check.tool !== 'game.dice.check') return check;
  const input = normalizeObject(check.input);
  const currentModifier = Number(input.modifier ?? input.fixedModifier ?? 0);
  const currentThreshold = Number(input.successThreshold ?? input.dc ?? input.baseThreshold);
  const revisedInput = {
    ...input,
    modifier: Number.isFinite(currentModifier)
      ? currentModifier + (correction.bonus || 0)
      : correction.bonus || 0
  };
  if (Number.isFinite(currentThreshold) && correction.thresholdAdjustment) {
    revisedInput.successThreshold = Math.max(2, currentThreshold + correction.thresholdAdjustment);
  }
  if (correction.advantage && (!input.rollMode || input.rollMode === 'normal')) {
    revisedInput.rollMode = 'advantage';
  }
  return {
    ...check,
    input: revisedInput,
    metadata: {
      ...normalizeObject(check.metadata),
      rejudgementApplied: true,
      rejudgementReason: correction.reason
    }
  };
}

export function normalizeAppealDecision(input = {}, {
  sourceText = '',
  chatSessionId,
  sceneId = 'current',
  playerArgument = '',
  requestedOutcome = '',
  originalPlan
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Appeal decision must be a plain object');
  }
  const status = normalizeAppealStatus(input.status || input.decisionStatus);
  const revisedPlanInput = input.revisedPlan || input.plan;
  const originalActionId = normalizeOptionalText(
    input.originalActionId
    || input.actionId
    || originalPlan?.actionId
    || originalPlan?.id
  );
  return {
    appealId: normalizeOptionalText(input.appealId || input.id) || createId('appeal'),
    status,
    summary: normalizeOptionalText(input.summary || input.reasoning || input.reason),
    originalActionId,
    disputedRuling: normalizeOptionalText(input.disputedRuling || input.originalRuling),
    playerArgument: normalizeOptionalText(input.playerArgument || playerArgument),
    requestedOutcome: normalizeOptionalText(input.requestedOutcome || requestedOutcome),
    findings: normalizeFindings(input.findings || input.issues || input.analysis),
    correction: normalizeCorrection(input.correction || input.recommendation || input.recommendedCorrection),
    revisedPlan: revisedPlanInput
      ? normalizeActionPlan(revisedPlanInput, {
        sourceText: revisedPlanInput.sourceText || sourceText,
        chatSessionId,
        sceneId
      })
      : undefined,
    rollbackRecommendation: normalizeObject(input.rollbackRecommendation || input.rollback),
    narrationGuidance: normalizeOptionalText(input.narrationGuidance || input.narration || input.explanation),
    metadata: normalizeObject(input.metadata)
  };
}

function normalizeAppealStatus(value) {
  const normalized = String(value || 'pending').trim();
  const compact = normalized.replace(/[-_\s]+/g, '').toLowerCase();
  if (compact === 'accepted' || compact === 'accept') return 'accepted';
  if (compact === 'partiallyaccepted' || compact === 'partial' || compact === 'partlyaccepted') return 'partiallyAccepted';
  if (compact === 'rejected' || compact === 'reject' || compact === 'denied') return 'rejected';
  if (compact === 'needsmoreinfo' || compact === 'needmoreinfo' || compact === 'moreinfo') return 'needsMoreInfo';
  return 'pending';
}

function normalizeAbsurdityStatus(value) {
  const compact = String(value || 'judged').replace(/[-_\s]+/g, '').toLowerCase();
  if (compact === 'notevaluated' || compact === 'pending') return 'notEvaluated';
  if (compact === 'needsmorecontext' || compact === 'morecontext') return 'needsMoreContext';
  return 'judged';
}

function normalizeAbsurdityExplanationStatus(value) {
  const compact = String(value || 'explained').replace(/[-_\s]+/g, '').toLowerCase();
  if (compact === 'notneeded' || compact === 'skip' || compact === 'skipped') return 'notNeeded';
  if (compact === 'needshuman' || compact === 'human') return 'needsHuman';
  return 'explained';
}

function normalizeAbsurdityLevel(value) {
  const compact = String(value || 'ordinary').replace(/[-_\s]+/g, '').toLowerCase();
  if (compact === 'unusual' || compact === 'unlikely') return 'unusual';
  if (compact === 'absurd') return 'absurd';
  if (compact === 'extreme' || compact === 'veryabsurd') return 'extreme';
  if (compact === 'impossiblebutplayable' || compact === 'impossibleplayable' || compact === 'playableimpossible') return 'impossibleButPlayable';
  return 'ordinary';
}

function normalizeAbsurdityFactors(value) {
  return normalizeArray(value)
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return {
          name: normalizeOptionalText(item.name || item.factor || item.type),
          judgement: normalizeOptionalText(item.judgement || item.assessment || item.summary),
          supportsAttempt: item.supportsAttempt === undefined ? undefined : Boolean(item.supportsAttempt),
          note: normalizeOptionalText(item.note || item.reason)
        };
      }
      return {
        name: '',
        judgement: String(item || ''),
        supportsAttempt: undefined,
        note: ''
      };
    })
    .filter((item) => item.name || item.judgement || item.note);
}

function normalizeConsequenceList(value) {
  return normalizeArray(value)
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return {
          kind: normalizeOptionalText(item.kind || item.type || 'complication'),
          summary: normalizeOptionalText(item.summary || item.description || item.text),
          metadata: normalizeObject(item.metadata)
        };
      }
      return {
        kind: 'complication',
        summary: String(item || ''),
        metadata: {}
      };
    })
    .filter((item) => item.summary || item.kind);
}

function normalizeFindings(value) {
  return normalizeArray(value)
    .map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return {
          issue: normalizeOptionalText(item.issue || item.claim || item.point),
          evaluation: normalizeOptionalText(item.evaluation || item.analysis || item.reason),
          supportsPlayer: item.supportsPlayer === undefined ? undefined : Boolean(item.supportsPlayer),
          evidence: normalizeArray(item.evidence)
        };
      }
      return {
        issue: String(item || ''),
        evaluation: '',
        supportsPlayer: undefined,
        evidence: []
      };
    })
    .filter((item) => item.issue || item.evaluation);
}

function normalizeCorrection(value) {
  const correction = normalizeObject(value);
  return {
    shouldChangeRuling: Boolean(correction.shouldChangeRuling ?? correction.changeRuling ?? correction.accepted),
    recommendedOutcome: normalizeOptionalText(correction.recommendedOutcome || correction.outcome),
    rerollRecommended: Boolean(correction.rerollRecommended || correction.reroll),
    rollbackRecommended: Boolean(correction.rollbackRecommended || correction.rollback),
    notes: normalizeOptionalText(correction.notes)
  };
}

function normalizeIntent(value = {}) {
  const intent = normalizeObject(value);
  return {
    ...intent,
    label: normalizeOptionalText(intent.label || intent.type || 'freeform'),
    summary: normalizeOptionalText(intent.summary || intent.description)
  };
}

function normalizePlanCalls(calls, { phase, chatSessionId, sceneId } = {}) {
  const input = Array.isArray(calls) ? calls : [calls];
  return input
    .filter((call) => call && typeof call === 'object' && !Array.isArray(call))
    .map((call, index) => ({
      id: normalizeOptionalText(call.id) || `${phase}_${index + 1}`,
      phase,
      tool: normalizeRequiredText(call.tool, `${phase}.tool`),
      input: fillTemplateValues(stripAuthorizationFields(call.input || {}), { chatSessionId, sceneId }),
      when: call.when ?? (phase === 'check' ? 'always' : 'success'),
      checkId: normalizeOptionalText(call.checkId),
      metadata: normalizeObject(call.metadata)
    }));
}

function buildRiskReport(plan, {
  toolManager,
  allowedTools = DEFAULT_ACTION_ALLOWED_TOOLS,
  requestedAllowedTools = DEFAULT_ACTION_ALLOWED_TOOLS,
  allowedOverrideAuthorized = false,
  authorization
} = {}) {
  const calls = [
    ...plan.checks.map((call) => ({ ...call, phase: 'check' })),
    ...plan.proposals.map((call) => ({ ...call, phase: 'proposal' }))
  ];
  const toolCalls = calls.map((call) => {
    const tool = safeGetTool(toolManager, call.tool);
    const allowed = tool && isToolAllowed(call.tool, allowedTools);
    const requiresAuthorization = tool ? toolRequiresUserAuthorization(tool) : false;
    const destructive = Boolean(tool?.metadata?.destructive || tool?.annotations?.destructiveHint);
    const mutatesState = Boolean(tool?.mutatesState);
    const risk = !tool
      ? 'unknown'
      : (destructive || requiresAuthorization ? 'high' : (mutatesState ? 'medium' : 'low'));
    return {
      id: call.id,
      phase: call.phase,
      tool: call.tool,
      exists: Boolean(tool),
      allowed: Boolean(allowed),
      blockReason: !tool ? 'tool_not_found' : (!allowed ? 'tool_not_allowed' : undefined),
      requestedAllowedTools,
      allowedOverrideAuthorized,
      requiresAuthorization,
      hasExternalAuthorization: Boolean(authorization?.authorized),
      destructive,
      mutatesState,
      risk,
      title: tool?.title,
      description: tool?.description
    };
  });
  return {
    defaultAllowedTools: DEFAULT_ACTION_ALLOWED_TOOLS,
    effectiveAllowedTools: allowedTools,
    requestedAllowedTools,
    allowedOverrideAuthorized,
    externalAuthorization: authorization,
    toolCalls,
    summary: {
      total: toolCalls.length,
      allowed: toolCalls.filter((call) => call.allowed).length,
      blocked: toolCalls.filter((call) => !call.allowed).length,
      requiresAuthorization: toolCalls.filter((call) => call.requiresAuthorization).length,
      highRisk: toolCalls.filter((call) => call.risk === 'high').length
    }
  };
}

function resolveAllowedTools(requested, { authorized = false } = {}) {
  const requestedAllowedTools = normalizeAllowedTools(requested);
  const defaultSet = new Set(DEFAULT_ACTION_ALLOWED_TOOLS);
  const requestedSet = new Set(requestedAllowedTools);
  const overrideRequested = requestedAllowedTools.includes('*')
    || [...requestedSet].some((tool) => !defaultSet.has(tool));
  const effectiveAllowedTools = overrideRequested && !authorized
    ? DEFAULT_ACTION_ALLOWED_TOOLS
    : requestedAllowedTools;
  return {
    requestedAllowedTools,
    effectiveAllowedTools,
    overrideAuthorized: !overrideRequested || authorized
  };
}

function normalizeAllowedTools(value) {
  if (value === undefined || value === null || value === '') return [...DEFAULT_ACTION_ALLOWED_TOOLS];
  const tools = Array.isArray(value) ? value : [value];
  return tools.map((tool) => String(tool).trim()).filter(Boolean);
}

function isToolAllowed(tool, allowedTools) {
  return allowedTools.includes('*') || allowedTools.includes(tool);
}

function shouldRunProposal(proposal, resultByCheckId) {
  const whenValues = Array.isArray(proposal.when) ? proposal.when : [proposal.when || 'success'];
  return whenValues.some((when) => matchWhen(String(when), proposal, resultByCheckId));
}

function matchWhen(when, proposal, resultByCheckId) {
  if (when === 'always') return true;
  if (when === 'noCheck') return resultByCheckId.size === 0;
  const checkId = proposal.checkId || firstKey(resultByCheckId);
  const result = resultByCheckId.get(checkId);
  if (!result) return false;
  if (when.includes(':')) {
    const [explicitCheckId, explicitOutcome] = when.split(':');
    return matchWhen(explicitOutcome, { ...proposal, checkId: explicitCheckId }, resultByCheckId);
  }
  if (when === 'success') return Boolean(result.success);
  if (when === 'failure') return Boolean(result.failure);
  if (when === 'criticalSuccess') return Boolean(result.criticalSuccess);
  if (when === 'criticalFailure') return Boolean(result.criticalFailure);
  if (when === 'anySuccess') return [...resultByCheckId.values()].some((candidate) => candidate.success);
  if (when === 'anyFailure') return [...resultByCheckId.values()].some((candidate) => candidate.failure);
  return result.outcome === when;
}

function selectNarrationHints(plan, diceResults = []) {
  const primary = diceResults[0];
  const hints = normalizeObject(plan.narrationHints);
  if (!primary) return hints;
  return {
    selected: hints[primary.outcome] || (primary.success ? hints.success : hints.failure),
    ...hints
  };
}

function shouldExplainAbsurdity(judgement, applied, input = {}) {
  if (!judgement) return false;
  if (input.forceAbsurdityExplanation) return true;
  if (!judgement.requiresAbsurdityExplanationOnSuccess) return false;
  if (input.dryRun === true && !input.explainAbsurdityOnDryRun) return false;
  return actionResultSucceeded(applied);
}

function actionResultSucceeded(applied) {
  const result = normalizeObject(applied?.apply || applied);
  if (!result) return false;
  if (Array.isArray(result.diceResults) && result.diceResults.length > 0) {
    return result.diceResults.some((candidate) => candidate.success || candidate.criticalSuccess);
  }
  return ['success', 'partial_failure'].includes(result.status) && (!Array.isArray(result.failedToolCalls) || result.failedToolCalls.length === 0);
}

function summarizeActionSuccess(actionResult = {}) {
  const dice = Array.isArray(actionResult.diceResults) ? actionResult.diceResults : [];
  const primary = dice.find((result) => result.success || result.criticalSuccess);
  if (primary) return `Successful action result: ${primary.outcome || 'success'}`;
  if (actionResult.status) return `Action status: ${actionResult.status}`;
  return '';
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

function safeGetTool(toolManager, tool) {
  try {
    return toolManager.getTool(tool);
  } catch {
    return undefined;
  }
}

function toolRequiresUserAuthorization(tool) {
  return Boolean(
    tool?.metadata?.requiresUserAuthorization
    || tool?.annotations?.requiresUserAuthorization
    || tool?._meta?.['ai-dnd/requiresUserAuthorization']
  );
}

function normalizeAuthorization(context = {}) {
  const authorization = context.authorization ?? context.userAuthorization ?? context.approval;
  const authorized = authorization === true
    || (authorization && typeof authorization === 'object' && (
      authorization.approved === true
      || authorization.userApproved === true
      || authorization.granted === true
    ));
  return {
    authorized: Boolean(authorized),
    source: authorized ? 'external_context' : 'none'
  };
}

function sanitizeExecutionContext(context = {}) {
  const authorization = context.authorization ?? context.userAuthorization ?? context.approval;
  const clean = {};
  if (authorization !== undefined) clean.authorization = authorization;
  for (const key of ['chatSessionId', 'chatId', 'sessionId', 'turnId', 'phaseId', 'source']) {
    if (context[key] !== undefined) clean[key] = context[key];
  }
  if (context.agentLoop && typeof context.agentLoop === 'object') {
    clean.agentLoop = {
      chatSessionId: context.agentLoop.chatSessionId,
      turnId: context.agentLoop.turnId,
      phaseId: context.agentLoop.phaseId,
      dryRun: context.agentLoop.dryRun
    };
  }
  if (context.agentAccessPolicy) clean.agentAccessPolicy = context.agentAccessPolicy;
  if (context.agentAccess?.policy) clean.agentAccess = { policy: context.agentAccess.policy };
  if (context.llmPromptOverrides) clean.llmPromptOverrides = context.llmPromptOverrides;
  if (context.promptOverrides) clean.promptOverrides = context.promptOverrides;
  if (context.llm?.promptOverrides || context.llm?.targets) {
    clean.llm = {
      ...(context.llm?.promptOverrides ? { promptOverrides: context.llm.promptOverrides } : {}),
      ...(context.llm?.targets ? { targets: context.llm.targets } : {})
    };
  }
  return clean;
}

function sanitizeActionInput(input = {}) {
  return stripAuthorizationFields(input);
}

function normalizeAppealLoopAction(value) {
  const compact = String(value || 'start').replace(/[-_\s]+/g, '').toLowerCase();
  if (['appeal', 'rebut', 'challenge', 'rejudge', 'rejudgement', 'rejudgment'].includes(compact)) return 'appeal';
  if (['accept', 'accepted', 'confirm', 'finish', 'done'].includes(compact)) return 'accept';
  return 'start';
}

function stripAppealLoopFields(input = {}) {
  const blocked = new Set([
    'action',
    'loopState',
    'state',
    'currentResolution',
    'resolution',
    'additionalInfo',
    'rebuttal',
    'appealText',
    'applyRejudgement'
  ]);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !blocked.has(key)));
}

function normalizeAppealLoopState(value = {}) {
  const state = normalizeObject(value);
  return {
    loopId: normalizeOptionalText(state.loopId),
    status: normalizeOptionalText(state.status),
    chatSessionId: normalizeOptionalText(state.chatSessionId),
    sceneId: normalizeOptionalText(state.sceneId) || 'current',
    sourceText: normalizeOptionalText(state.sourceText),
    input: normalizeObject(state.input),
    originalPlan: normalizeObject(state.originalPlan),
    currentPlan: normalizeObject(state.currentPlan),
    currentResolution: normalizeObject(state.currentResolution),
    currentResolutionRef: normalizeObject(state.currentResolutionRef),
    currentSummary: normalizeObject(state.currentSummary),
    history: Array.isArray(state.history) ? state.history : [],
    acceptedAt: normalizeOptionalText(state.acceptedAt)
  };
}

function buildAppealLoopDecisionOutput({
  input = {},
  previousState = {},
  currentResolution,
  rejudgement,
  application,
  eventType = 'initial',
  now
} = {}) {
  const previous = normalizeAppealLoopState(previousState);
  const currentSummary = summarizeActionResolution(currentResolution);
  const loopId = previous.loopId || createId('appealloop');
  const currentResolutionRef = buildResolutionReference(currentResolution);
  const history = [
    ...previous.history,
    {
      round: previous.history.length + 1,
      eventType,
      at: now,
      summary: currentSummary,
      appealDecision: rejudgement?.decision
        ? {
          appealId: rejudgement.decision.appealId,
          status: rejudgement.decision.status,
          summary: rejudgement.decision.summary
        }
        : undefined,
      applicationStatus: application?.status
    }
  ].slice(-20);
  const loopState = {
    loopId,
    status: 'awaiting_player_decision',
    chatSessionId: input.chatSessionId || previous.chatSessionId,
    sceneId: input.sceneId || previous.sceneId || 'current',
    sourceText: input.sourceText || input.text || input.content || previous.sourceText,
    input: {
      ...previous.input,
      ...stripAppealLoopFields(input)
    },
    originalPlan: Object.keys(previous.originalPlan).length ? previous.originalPlan : normalizeObject(currentResolution?.plan),
    currentPlan: normalizeObject(currentResolution?.plan),
    currentResolutionRef,
    currentSummary,
    history
  };
  const choices = buildAppealLoopChoices(loopState);
  const resolutionStatus = normalizeOptionalText(currentSummary.status || currentResolution?.status);
  const resolutionSucceeded = actionResultSucceeded(currentResolution);
  return {
    status: 'awaiting_player_decision',
    resolutionStatus,
    resolutionSucceeded,
    final: false,
    prompt: buildAppealLoopPrompt({ resolutionStatus, resolutionSucceeded, currentSummary }),
    loopState,
    currentResolution,
    currentSummary,
    rejudgement,
    application,
    appealAvailable: true,
    choices
  };
}

function buildAppealLoopPrompt({ resolutionStatus = '', resolutionSucceeded = false, currentSummary = {} } = {}) {
  if (resolutionSucceeded) {
    const mode = currentSummary.resolutionMode === 'automatic_progress' ? '自动进度已结算成功。' : '裁决结果已结算成功。';
    return `${mode} 是否接受当前裁决记录？如果不接受，请补充遗漏事实、规则依据或希望修正的结果后发起驳斥重裁。`;
  }
  const dice = Array.isArray(currentSummary.diceResults) ? currentSummary.diceResults : [];
  if (dice.some((result) => result.success === false || result.outcome === 'failure' || result.outcome === 'criticalFailure')) {
    return '行动检定未通过，当前结果不会按成功写入。是否接受这个失败裁决？如果不接受，请补充依据后发起驳斥重裁。';
  }
  if (resolutionStatus === 'failure' || resolutionStatus === 'partial_failure') {
    return '裁决执行未成功结算。请查看失败工具调用、缺失授权或字段错误；如果不接受，请补充依据后发起驳斥重裁。';
  }
  if (resolutionStatus === 'dry_run') {
    return '裁决仍是 dry-run 预览，尚未写入数据库。是否接受当前裁决预览？';
  }
  return '裁决结果已生成。是否接受当前裁决？如果不接受，请补充遗漏事实、规则依据或希望修正的结果后发起驳斥重裁。';
}

function buildAppealLoopChoices(loopState) {
  const compactState = compactAppealLoopState(loopState);
  return [
    {
      id: 'accept',
      label: '接受裁决',
      toolInput: {
        action: 'accept',
        loopState: compactState
      }
    },
    {
      id: 'appeal',
      label: '驳斥并请求重裁',
      requiresPlayerInput: true,
      inputFields: ['playerArgument', 'additionalInfo', 'requestedOutcome'],
      toolInput: {
        action: 'appeal',
        loopState: compactState,
        playerArgument: '',
        additionalInfo: '',
        requestedOutcome: ''
      }
    }
  ];
}

function resolveAppealLoopResolution(input = {}, previousState = {}) {
  const explicit = normalizeObject(input.currentResolution || input.resolution || previousState.currentResolution);
  if (Object.keys(explicit).length) return explicit;
  return buildResolutionFromAppealState(previousState);
}

function buildResolutionFromAppealState(stateInput = {}) {
  const state = normalizeAppealLoopState(stateInput);
  const currentSummary = normalizeObject(state.currentSummary);
  const currentPlan = normalizeObject(state.currentPlan);
  const currentResolutionRef = normalizeObject(state.currentResolutionRef);
  if (!Object.keys(currentSummary).length && !Object.keys(currentPlan).length && !Object.keys(currentResolutionRef).length) {
    return {};
  }
  return removeUndefined({
    status: currentSummary.status || currentResolutionRef.status || state.status,
    plan: Object.keys(currentPlan).length ? currentPlan : undefined,
    apply: Object.keys(currentSummary).length
      ? removeUndefined({
          status: currentSummary.status,
          diceResults: currentSummary.diceResults || [],
          riskReport: currentSummary.riskSummary ? { summary: currentSummary.riskSummary } : undefined,
          narrationHints: currentSummary.narrationHints
        })
      : undefined,
    currentSummary,
    currentResolutionRef
  });
}

function compactAppealLoopState(loopState = {}) {
  return removeUndefined({
    loopId: loopState.loopId,
    status: loopState.status,
    chatSessionId: loopState.chatSessionId,
    sceneId: loopState.sceneId,
    sourceText: loopState.sourceText,
    input: loopState.input,
    originalPlan: loopState.originalPlan,
    currentPlan: loopState.currentPlan,
    currentResolutionRef: loopState.currentResolutionRef,
    currentSummary: loopState.currentSummary,
    history: loopState.history
  });
}

function buildResolutionReference(resolution = {}) {
  const trace = normalizeObject(resolution.trace);
  return removeUndefined({
    status: resolution.status,
    actionId: resolution.plan?.actionId || resolution.apply?.plan?.actionId,
    traceId: trace.traceId,
    traceSummary: trace.files?.summary,
    traceOutput: trace.files?.output
  });
}

function buildLoopPlayerArgument(input = {}) {
  const parts = [
    normalizeOptionalText(input.playerArgument),
    normalizeOptionalText(input.additionalInfo),
    normalizeOptionalText(input.rebuttal),
    normalizeOptionalText(input.appealText)
  ].filter(Boolean);
  if (input.playerEvidence !== undefined && input.playerEvidence !== null && input.playerEvidence !== '') {
    parts.push(`Evidence: ${typeof input.playerEvidence === 'string' ? input.playerEvidence : JSON.stringify(input.playerEvidence)}`);
  }
  return parts.join('\n\n');
}

function summarizeResolutionForAppeal(resolution = {}) {
  const summary = summarizeActionResolution(resolution);
  return JSON.stringify(summary);
}

function summarizeActionResolution(resolution = {}) {
  const apply = normalizeObject(resolution.apply || resolution);
  const diceResults = Array.isArray(apply.diceResults) ? apply.diceResults : [];
  const appliedToolCalls = Array.isArray(apply.appliedToolCalls) ? apply.appliedToolCalls : [];
  const failedToolCalls = Array.isArray(apply.failedToolCalls) ? apply.failedToolCalls : [];
  const skippedToolCalls = Array.isArray(apply.skippedToolCalls) ? apply.skippedToolCalls : [];
  const riskSummary = apply.riskReport?.summary;
  const planMetadata = normalizeObject(resolution.plan?.metadata || apply.plan?.metadata);
  return removeUndefined({
    status: resolution.status || apply.status,
    actionId: resolution.plan?.actionId || apply.plan?.actionId,
    resolutionMode: planMetadata.resolutionMode,
    dicePolicy: planMetadata.dicePolicy,
    appliedToolCallCount: appliedToolCalls.length,
    failedToolCallCount: failedToolCalls.length,
    skippedToolCallCount: skippedToolCalls.length,
    appliedToolCalls: appliedToolCalls.map((call) => ({
      id: call.id,
      tool: call.tool
    })),
    failedToolCalls: failedToolCalls.map((call) => ({
      id: call.id,
      tool: call.tool,
      error: call.error ? {
        name: call.error.name,
        message: call.error.message,
        statusCode: call.error.statusCode
      } : undefined
    })),
    diceResults: diceResults.map((item) => ({
      checkId: item.checkId || item.id,
      outcome: item.result?.outcome || item.output?.outcome || item.outcome,
      total: item.result?.total ?? item.output?.total ?? item.total,
      threshold: item.result?.successThreshold
        ?? item.output?.successThreshold
        ?? item.input?.successThreshold
        ?? item.threshold,
      success: item.result?.success ?? item.output?.success ?? item.success,
      criticalSuccess: item.result?.criticalSuccess ?? item.output?.criticalSuccess ?? item.criticalSuccess,
      criticalFailure: item.result?.criticalFailure ?? item.output?.criticalFailure ?? item.criticalFailure
    })),
    riskSummary,
    narrationHints: resolution.plan?.narrationHints || apply.narrationHints,
    appealDecision: resolution.rejudgement?.decision
      ? {
        appealId: resolution.rejudgement.decision.appealId,
        status: resolution.rejudgement.decision.status,
        summary: resolution.rejudgement.decision.summary
      }
      : undefined
  });
}

function buildResolutionFromRejudgement({ previousResolution, rejudgement, application } = {}) {
  if (application?.apply) {
    return {
      status: application.status,
      plan: rejudgement.decision?.revisedPlan || previousResolution.plan,
      apply: application.apply,
      rejudgement,
      application,
      prompt: rejudgement.prompt,
      context: rejudgement.context
    };
  }
  return {
    ...previousResolution,
    status: previousResolution.status || 'awaiting_player_decision',
    rejudgement,
    application
  };
}

function stripAuthorizationFields(value) {
  if (Array.isArray(value)) return value.map(stripAuthorizationFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(authorization|approval|token|apiKey|secret|password)/i.test(key))
    .map(([key, child]) => [key, stripAuthorizationFields(child)]));
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

function selectTemplate(templateId) {
  return ACTION_RESOLVER_TEMPLATES[templateId] || ACTION_RESOLVER_TEMPLATES.generic;
}

function parseJsonObject(content) {
  try {
    return parseFirstJsonObject(content);
  } catch {
    throw validationError('Action planner did not return a JSON object');
  }
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function stripModifierOnlyFields(input = {}) {
  const {
    modifierBreakdown,
    modifierResolution,
    actor,
    target,
    chatSessionId,
    sceneId,
    actorId,
    npcId,
    playerId,
    targetId,
    targetNpcId,
    checkKind,
    actionKind,
    skillId,
    skill,
    ability,
    ...diceInput
  } = normalizeObject(input);
  return removeUndefined(diceInput);
}

function normalizeArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function extractContextActorIds(input = {}) {
  return [...new Set([
    ...normalizeStringArray(input.actorIds || input.npcIds),
    ...normalizeArray(input.targets)
      .map((target) => {
        if (typeof target === 'string') return target;
        if (target && typeof target === 'object') return target.npcId || target.actorId || target.id || target.name;
        return '';
      })
      .filter(Boolean)
  ])];
}

function normalizeStringArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return [...new Set((Array.isArray(value) ? value : [value])
    .flatMap((item) => typeof item === 'string' ? item.split(',') : [item])
    .map((item) => String(item).trim())
    .filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function mergePlain(base, patch) {
  if (patch === undefined) return clonePlain(base);
  if (patch === null) return undefined;
  if (Array.isArray(base) || Array.isArray(patch)) return Array.isArray(patch) ? clonePlain(patch) : clonePlain(base);
  if (base && typeof base === 'object' && patch && typeof patch === 'object') {
    const output = { ...clonePlain(base) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete output[key];
      else output[key] = mergePlain(output[key], value);
    }
    return output;
  }
  return clonePlain(patch);
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

function firstKey(map) {
  return map.keys().next().value;
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ActionResolverValidationError';
  error.statusCode = 400;
  return error;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(sanitizeForJson(value), null, 2)}\n`);
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
    statusCode: error?.statusCode,
    stack: error?.stack
  };
}

function safePathSegment(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 160);
}

function durationMs(startedAt, finishedAt) {
  const duration = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? duration : undefined;
}
