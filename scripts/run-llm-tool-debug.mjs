import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

const OUT_DIR = join(process.cwd(), 'manuals', 'generated-debug', 'llm-tool-debug');
const SCENE_ID = 'grayridge_silver_gate';

const SCENARIO_REFERENCE = [
  '# DnD 工具调试场景参考',
  '',
  '战役框架：参考 DnD 5e 的黑暗奇幻边境山口。',
  '',
  '场景：灰岭银门，一座被冷月照着的废弃山口关卡。',
  '',
  '玩家角色：',
  '- pc_arin：阿林·维尔，3 级游荡者，熟练使用盗贼工具，手快，习惯先谈判再开打。',
  '',
  'NPC：',
  '- npc_guard_elowen：艾洛温，疲惫的守门卫兵，隶属灰岭守望。',
  '- npc_wight_captain：带有月痕的亡灵队长，被古老通行税誓约束缚。',
  '',
  '阵营：',
  '- city_watch：灰岭守望，目标是维持秩序、守住关税权、避免民众恐慌。',
  '- moon_cult：月之密教，目标是取得银铃圣物，并在月升时打开银门。',
  '',
  '本地事实：',
  '- 银门只有在月光照到铃座时才会响应。',
  '- 废弃税所里有一只裂开的银铃和旧账册。',
  '- 守卫可以被说服，但公开背叛会带来阵营风险。',
  '- 直接伤害、物品损失或惩罚只能发生在检定失败或玩家明确选择冒险之后。',
  '',
  '本批调试使用的房规：',
  '- 任务目标应描述问题和结果，不应写成固定的 A -> B -> C 路线链。',
  '- LLM 工具必须只返回 JSON。',
  '- 数值采用保守的 DnD 风格：DC 12 简单，DC 15 中等，DC 18 困难。',
  '- 奖励和后果必须与风险、难度、玩家过程成比例。'
].join('\n');

class DebugLlmProvider {
  constructor() {
    this.calls = [];
    this.currentToolId = 'unknown';
  }

  setCurrentTool(toolId) {
    this.currentToolId = toolId;
  }

  async generate(request = {}) {
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const prompt = messages.map((message) => String(message.content || '')).join('\n\n');
    const response = replaceChatPlaceholders(responseForTool(this.currentToolId, prompt), this.state || {});
    const call = {
      index: this.calls.length + 1,
      toolId: this.currentToolId,
      request: {
        messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      },
      response
    };
    this.calls.push(call);
    return {
      content: JSON.stringify(response, null, 2),
      raw: {
        provider: 'debug-mock-llm',
        toolId: this.currentToolId,
        callIndex: call.index
      }
    };
  }
}

function responseForTool(toolId, prompt) {
  if (toolId.startsWith('system.data.') || toolId.startsWith('system.item_registry.') || toolId.startsWith('system.mechanics_registry.')) {
    return quantificationResponse(prompt);
  }

  const responses = {
    'system.action.plan': actionPlan('act_shadow_lockpick'),
    'system.action.resolve': actionPlan('act_resolve_silver_gate'),
    'system.action.judge_absurdity': {
      judgementId: 'absurd_nyarlathotep_gravity_proposal',
      status: 'judged',
      absurdityLevel: 'impossibleButPlayable',
      summary: '向奈亚求婚并说服重力改判在普通场景里几乎不可能，但可以作为宇宙级荒诞誓约尝试处理，只允许产生局部征兆或代价线索。',
      factors: [
        { name: 'cosmic_scale', judgement: '奈亚级存在和重力法则不应被普通说服直接支配。', supportsAttempt: false },
        { name: 'setting_support', judgement: '银门誓约、月光仪式和亡灵通行税让“誓约回应”可以产生象征性反馈。', supportsAttempt: true },
        { name: 'scope', judgement: '结果必须限于短暂征兆、恐怖线索或局部战术机会，不能真的让外神答应求婚或改写重力。', supportsAttempt: true }
      ],
      canAttempt: true,
      shouldRollOrResolve: true,
      successDoesNotMeanExactWish: true,
      requiresAbsurdityExplanationOnSuccess: true,
      explanationSeeds: ['银铃发出不属于空气传播的低笑，桥面重力只在一瞬间偏向尸妖脚下的裂缝。'],
      boundaries: [
        '奈亚不会真的订婚。',
        '重力不会长期改变。',
        '成功只给一条线索、一次短暂优势或一个后续代价。'
      ]
    },
    'system.action.explain_absurdity': {
      explanationId: 'explain_nyarlathotep_gravity_proposal',
      status: 'explained',
      premise: '阿林向奈亚递出荒唐求婚誓词，并试图说服重力把尸妖当作彩礼往桥下拖。',
      acceptedOutcome: '成功时，重力只在尸妖脚边轻微偏斜一瞬，同时显露银门誓约中的危险漏洞。',
      explanationMode: 'symbolic',
      explanation: '奈亚没有答应求婚；它只是借银铃回声嘲笑这个誓词。那声嘲笑触碰了银门旧誓约，让桥面重量在尸妖脚边短暂错位。',
      consequences: [
        { kind: 'boon', summary: '尸妖下一次守桥动作出现破绽，队伍获得一次可检定的战术机会。' },
        { kind: 'cost', summary: '阿林的名字被某个外神玩笑记住，之后可能引来梦境代价。' },
        { kind: 'risk', summary: '月之密教误以为队伍掌握外神婚誓仪式。' }
      ],
      followUpHooks: ['下一次长休时，阿林可能梦见一份写满无意义条款的婚约。'],
      narration: {
        immediate: '银铃没有响，却像有人在每个人牙齿后面轻笑；尸妖脚边的尘土向上落了一瞬。',
        later: '桥石恢复正常，只剩一道像婚戒又像眼睛的霜痕。'
      }
    },
    'system.action.request_rejudgement': {
      appealId: 'appeal_silver_gate_dc',
      status: 'accepted',
      originalActionId: 'act_shadow_lockpick',
      disputedRuling: '原本开锁 DC 忽略了阿林用裂银铃作为杠杆的场景优势。',
      playerArgument: '这个工具用法聪明，而且扎根于现场线索。',
      requestedOutcome: '降低 DC 或给予优势。',
      summary: '申诉成立：银铃杠杆应降低开锁 DC。',
      findings: [
        { issue: 'context_bonus_ignored', summary: '原裁定没有计入裂银铃作为临时杠杆的合理帮助。' }
      ],
      correction: {
        shouldChangeRuling: true,
        recommendedOutcome: '把开锁 DC 从 18 调整为 13，并重新按修订计划结算。',
        rerollRecommended: true,
        rollbackRecommended: false,
        notes: '不直接修改状态，只返回修订计划供后续工具应用。'
      },
      revisedPlan: actionPlan('act_rejudged_shadow_lockpick', { dc: 13 })
    },
    'system.npc_behavior.plan': npcBehaviorPlan('npc_plan_guard_wavers'),
    'system.npc_behavior.resolve': npcBehaviorPlan('npc_resolve_guard_wavers'),
    'system.persuasion.judge_argument': persuasionJudgement(),
    'system.persuasion.resolve': persuasionJudgement(),
    'system.combat.judge_start': combatStartDecision(),
    'system.combat.start_battle': combatStartDecision(),
    'system.combat.judge_special_action': combatSpecialJudgement(),
    'system.combat.plan_aftermath': combatAftermath(),
    'system.combat.end_battle': combatAftermath(),
    'system.quests.create_hook': questHook(),
    'system.quests.gate_relevance': {
      relevant: true,
      questIds: ['quest_silver_bell'],
      ignoredQuestIds: [],
      shouldCheckCompletion: true,
      shouldResolveInvestigation: true,
      reason: '文本明确提到银铃和银门誓约，符合当前任务目标。',
      confidence: 0.86
    },
    'system.quests.resolve_investigation_tick': {
      tickType: 'evidence',
      summary: '账册证明通行税队长受“月亮见证”条款约束。',
      evidenceUpdates: [
        { slotId: 'bell_origin', status: 'filled', value: '银铃是合法誓约焦点，不是密教偶像。' }
      ],
      budgetSpent: 1,
      mustConcludeNow: false,
      questStatus: 'tracked',
      linkedNpcIds: ['npc_guard_elowen'],
      linkedFactionIds: ['city_watch']
    },
    'system.quests.check_completion': {
      objectiveSatisfied: true,
      status: 'completed',
      reason: '队伍找回银铃并在月光下敲响，满足了不绑定路线的任务目标。',
      satisfiedCriteria: ['找回银铃或等效誓约证据', '用它打开或安抚银门'],
      evidenceUpdates: [
        { slotId: 'bell_origin', status: 'filled', value: '银铃在银门处生效。' }
      ],
      rewardEligible: true,
      confidence: 0.82
    },
    'system.quests.plan_reward': {
      rewardId: 'reward_silver_bell',
      status: 'planned',
      rewards: [
        { type: 'coin', amount: 75, unit: 'gp', source: '灰岭守望赏金' },
        { type: 'favor', summary: '灰岭守望签发一次安全通行文书。' }
      ],
      withheldRewards: [],
      rationale: '中等社交和探索风险，且没有重大战斗损失。',
      hooks: ['月之密教不信任这份通行文书。']
    },
    'system.quests.plan_consequence': {
      consequenceId: 'consequence_silver_bell_delay',
      status: 'planned',
      consequenceTier: 'minor',
      immediateEffects: [
        { type: 'faction_pressure', summary: '月之密教在山口附近增加巡逻。', severity: 'medium' }
      ],
      delayedEffects: [
        { type: 'watch_inquiry', summary: '艾洛温被上级盘问。', severity: 'low' }
      ],
      affectedNpcs: ['npc_guard_elowen'],
      affectedFactions: ['moon_cult', 'city_watch'],
      affectedLocations: [SCENE_ID],
      rationale: '后果体现拖延和公开怀疑，不是免费惩罚。'
    },
    'system.encounters.create_encounter': encounterRecord(),
    'system.encounters.resolve_tick': {
      tickType: 'choice',
      summary: '尸妖提出：若队伍为旧誓约敲响银铃，就让他们安全通行。',
      stateUpdates: [
        { criterionId: 'learn_oath', status: 'partial', value: '队长会回应合法通行税措辞。' }
      ],
      budgetSpent: 1,
      mustConcludeNow: false,
      encounterStatus: 'engaged',
      linkedNpcIds: ['npc_wight_captain'],
      linkedFactionIds: ['moon_cult']
    },
    'system.encounters.check_outcome': {
      resolved: true,
      failed: false,
      escaped: false,
      status: 'resolved',
      reason: '队伍援引通行税誓约，避免了不必要战斗。',
      stateUpdates: [
        { criterionId: 'avoid_free_punishment', status: 'resolved', value: '没有在行动失败前施加伤害。' }
      ],
      rewardEligible: true,
      consequenceEligible: false,
      confidence: 0.8
    },
    'system.encounters.plan_reward': {
      rewardId: 'enc_reward_wight_oath',
      status: 'planned',
      rewards: [
        { type: 'information', summary: '尸妖透露隐藏铃座的位置。' },
        { type: 'minor_treasure', summary: '三枚古旧通行税代币，总值 15 gp。' }
      ],
      rationale: '优秀过程让混合社交/亡灵遭遇在无战斗情况下解决。'
    },
    'system.encounters.plan_consequence': {
      consequenceId: 'enc_consequence_failed_oath',
      status: 'planned',
      consequenceTier: 'minor',
      immediateEffects: [
        { type: 'combat_pressure', summary: '欺骗检定失败后，尸妖召来两名幽灵税吏。', severity: 'medium' }
      ],
      delayedEffects: [],
      affectedNpcs: ['npc_wight_captain'],
      affectedFactions: ['moon_cult'],
      affectedLocations: [SCENE_ID],
      rationale: '只在欺骗失败或明确破坏誓约后触发。'
    },
    'system.time.interpret_advance': {
      action: 'advance_time',
      confidence: 0.84,
      needsConfirmation: false,
      reason: '仔细谈判并查阅税所账册，合理耗时数分钟。',
      seconds: 300,
      source: 'llm'
    },
    'system.time.generate_world_pulse': worldPulse(),
    'system.time.run_world_pulse': worldPulse()
  };

  return responses[toolId] || {
    status: 'debugFallback',
    summary: `没有为 ${toolId} 配置专门的 mock 响应。`,
    confidence: 0.5
  };
}

function actionPlan(actionId, { dc = 15 } = {}) {
  return {
    actionId,
    sourceText: '阿林观察银门锁芯，并把裂银铃边缘当作杠杆辅助开锁。',
    intent: {
      label: 'unlock-silver-gate',
      summary: '在不惊动月之密教的情况下打开银门锁。'
    },
    checks: [
      {
        id: `${actionId}_check`,
        tool: 'game.dice.check',
        input: {
          successThreshold: dc,
          diceCount: 1,
          diceSides: 20,
          modifier: 5
        }
      }
    ],
    proposals: [
      {
        id: `${actionId}_unlock_state`,
        when: 'success',
        tool: 'system.map_state.patch_state',
        input: {
          chatSessionId: '__CHAT_SESSION_ID__',
          sceneId: SCENE_ID,
          mapId: 'map_silver_gate',
          objects: [
            { id: 'silver_gate_lock', name: '银门锁', status: 'unlocked' }
          ]
        }
      }
    ],
    narrationHints: {
      success: '月光下的银铃边缘正好卡入暗槽，锁芯轻响一声打开。',
      failure: '锁芯仍然卡死，一声很轻的铃音漏进山口冷风里。'
    },
    metadata: {
      debug: true
    }
  };
}

function npcBehaviorPlan(actionId) {
  return {
    actionId,
    sourceText: '艾洛温在守望誓言和阿林证明旧门诅咒真实之间犹豫。',
    intent: {
      label: 'guard-wavers',
      summary: '艾洛温暗中帮忙，但不完全背叛守望。'
    },
    metadata: {
      npcBehavior: {
        actors: [
          {
            npcId: 'npc_guard_elowen',
            motivation: '保护平民，同时避免公开失职。',
            pressure: '守望纪律与月誓约证据互相冲突。',
            severity: 'medium'
          }
        ]
      }
    },
    checks: [],
    proposals: [
      {
        id: 'reduce_elowen_loyalty',
        when: 'always',
        tool: 'system.factions.patch_membership',
        input: {
          actorId: 'npc_guard_elowen',
          factionId: 'city_watch',
          patch: {
            status: 'wavering',
            loyalty: 42,
            reasons: ['看到了誓约证据', '仍然害怕上级处分']
          }
        }
      }
    ],
    narrationHints: {
      resolved: '艾洛温压低声音，告诉阿林哪条巡逻路线有空档。'
    }
  };
}

function persuasionJudgement() {
  return {
    judgementId: 'persuade_elowen_oath',
    status: 'judged',
    targetNpcId: 'npc_guard_elowen',
    speakerId: 'pc_arin',
    approachSummary: '阿林主张遵守古老月誓约比盲目服从更能保护守望。',
    reasoningQuality: 'strong',
    argumentBonus: 4,
    dcAdjustment: -1,
    confidence: 0.78,
    summary: '这段说服同时使用证据、职责和低风险折中方案。',
    factors: [
      { name: 'evidence', effect: 'helps', modifier: 2, note: '裂银铃和账册支持这个说法。' },
      { name: 'target_values', effect: 'helps', modifier: 2, note: '艾洛温重视公共安全和合法命令。' },
      { name: 'risk', effect: 'hurts', modifier: -1, note: '帮助队伍仍然有被处分的风险。' }
    ],
    targetLikelyReaction: '艾洛温会提供有限帮助，同时保护自己。',
    stateProposals: [
      {
        target: 'faction',
        when: 'success',
        summary: '把艾洛温的阵营成员状态改为动摇，而不是叛逃。'
      }
    ],
    narrationHints: {
      success: '艾洛温吐出一口气，指向侧梯，然后假装什么都没看见。',
      failure: '艾洛温表面拒绝，但没有立刻拉响警报。'
    }
  };
}

function combatStartDecision() {
  return {
    decisionId: 'combat_start_wight_bridge',
    status: 'judged',
    shouldStartBattle: true,
    battleName: '月下税所冲突',
    reason: '队伍拒绝诅咒通行税后，尸妖队长挡住桥面并拔出锈剑。',
    participantIds: ['pc_arin', 'npc_guard_elowen', 'npc_wight_captain'],
    allyIds: ['pc_arin', 'npc_guard_elowen'],
    enemyIds: ['npc_wight_captain'],
    objective: '迫使尸妖让路，或破坏它的通行税焦点。',
    stakes: '失败会让月之密教先抵达银门。',
    recommendedOpening: '从狭桥上的中距离开场。',
    metadata: { debug: true }
  };
}

function combatSpecialJudgement() {
  return {
    judgementId: 'combat_special_bell_flash',
    status: 'judged',
    actionText: '阿林用裂银铃反射月光，照向尸妖队长。',
    actionMode: 'normalCombatAction',
    consumesResourcesAfterResolution: true,
    resourceCosts: [
      { kind: 'actionEconomy', resource: 'action', amount: 1 }
    ],
    combatAction: {
      actionKind: 'status',
      actorId: 'pc_arin',
      targetIds: ['npc_wight_captain'],
      attack: { successThreshold: 14, diceCount: 1, diceSides: 20, modifier: 5 },
      statusEffects: [
        { id: 'moon_dazzled', name: '月光眩目', durationRounds: 1 }
      ]
    },
    explanationNeeded: false,
    summary: '按状态动作处理，使用敏捷或工具相关检定。',
    rulingGuidance: '成功时尸妖下一次攻击具有劣势；失败时动作照常消耗。',
    followUpHooks: ['反复反射月光可能让银铃裂得更严重。'],
    metadata: { debug: true }
  };
}

function combatAftermath() {
  return {
    aftermathId: 'combat_after_wight_bridge',
    status: 'planned',
    battleId: 'battle_moonlit_tollhouse',
    outcome: 'won',
    rewardPlan: {
      rewards: [
        { type: 'loot', summary: '古旧通行税代币和一枚月银扣。' },
        { type: 'information', summary: '尸妖说出门拱下铃座的位置。' }
      ],
      withheldRewards: [],
      rationale: '击败单个超自然守卫，适合给予以线索为核心的小额战利品。'
    },
    influencePlan: {
      npcUpdates: [
        { npcId: 'npc_guard_elowen', summary: '艾洛温更信任阿林，但害怕守望处分。' }
      ],
      factionUpdates: [
        { factionId: 'moon_cult', summary: '密教斥候注意到桥上的战斗。' }
      ],
      mapUpdates: [
        { mapId: 'map_silver_gate', summary: '桥面暂时安全。' }
      ],
      questOrEncounterHooks: ['密教可能在月升时反击。']
    },
    narrativeSummary: '尸妖碎成旧通行税票据和冰冷月灰。',
    metadata: { debug: true }
  };
}

function questHook() {
  return {
    questId: 'quest_silver_bell',
    title: '银铃誓约',
    status: 'tracked',
    hookText: '这只破裂的银铃若在月光下敲响，或许能打开被诅咒的银门。',
    objective: '找回或修复足够的银铃誓约力量，用来打开或安抚银门。',
    successCriteria: [
      '证明银铃是银门誓约焦点。',
      '使用银铃、誓词或等效证据中和银门。'
    ],
    evidenceSlots: [
      { id: 'bell_origin', description: '银铃实际绑定的对象或规则。', required: true },
      { id: 'opening_phrase', description: '合法开门誓词或替代证据。', required: false }
    ],
    knownFacts: ['银门会对月光产生反应。'],
    suspectedFacts: ['月之密教也想取得这件圣物。'],
    openLeads: ['搜索税所账册。', '询问艾洛温关于旧守望仪式的事。'],
    stakeholders: [
      { id: 'city_watch', kind: 'faction' },
      { id: 'moon_cult', kind: 'faction' }
    ],
    locations: ['grayridge_silver_gate', 'old_tollhouse'],
    difficultyHint: '中等',
    riskHint: '月升时风险上升',
    rewardHints: ['守望好感', '安全通行', '小型银质圣物'],
    failureImpact: { note: '若队伍拖延，密教会先抵达银门。' },
    resolutionPressure: 'medium',
    investigationBudget: 3,
    budgetRemaining: 3
  };
}

function encounterRecord() {
  return {
    encounterId: 'enc_wight_toll',
    title: '尸妖税吏',
    status: 'engaged',
    sceneId: SCENE_ID,
    encounterType: 'mixed',
    luckTier: 'mixed',
    luckScore: 52,
    entryText: '带月痕的尸妖从税所拱门下走出，索要一枚活人铸币厂早已遗忘的硬币。',
    immediateSituation: '桥被拦住，但尸妖尚未攻击。',
    objective: '通过誓约、谈判或战斗越过桥面，同时不给密教争取时间。',
    resolutionCriteria: [
      '识别通行税誓约。',
      '说服、绕过或击败尸妖。',
      '在月升前避免不必要警报。'
    ],
    stateFacts: ['尸妖会回应法律式誓约措辞。'],
    openQuestions: ['什么硬币或证据能满足通行税？'],
    involvedNpcIds: ['npc_wight_captain', 'npc_guard_elowen'],
    involvedFactionIds: ['moon_cult', 'city_watch'],
    locations: [SCENE_ID],
    difficultyHint: '中等',
    riskHint: '侮辱或严重欺骗失败会引发战斗',
    rewardHints: ['通行税代币', '银门线索'],
    failureImpact: { note: '只在检定失败或明确破坏誓约后应用。' },
    noFreePunishmentRule: 1,
    resolutionPressure: 'medium',
    resolutionBudget: 2,
    budgetRemaining: 2
  };
}

function worldPulse() {
  return {
    events: [
      {
        eventId: 'pulse_moon_cult_moves',
        title: '月之密教斥候推进',
        category: 'faction_action',
        severity: 'medium',
        summary: '密教斥候看见月光闪耀后向银门推进。',
        proposedToolCalls: [
          {
            tool: 'system.factions.apply_relation_shift',
            input: {
              sourceFactionId: 'moon_cult',
              targetFactionId: 'city_watch',
              shift: { direction: 'pressure', intensity: 'medium' },
              dryRun: true
            }
          }
        ],
        metadata: { debug: true }
      },
      {
        eventId: 'pulse_elowen_warning',
        title: '艾洛温传来警告',
        category: 'npc_action',
        severity: 'low',
        summary: '艾洛温悄悄警告阿林，守望队长已经起疑。',
        proposedToolCalls: [
          {
            tool: 'system.npc_behavior.resolve',
            input: {
              chatSessionId: '__CHAT_SESSION_ID__',
              sceneId: SCENE_ID,
              actorNpcIds: ['npc_guard_elowen'],
              triggerText: '艾洛温决定是否提醒队伍。'
            }
          }
        ],
        metadata: { debug: true }
      }
    ]
  };
}

function quantificationResponse(prompt) {
  const fieldMatch = prompt.match(/"name"\s*:\s*"([^"]+)"/);
  const modeMatch = prompt.match(/"mode"\s*:\s*"([^"]+)"/);
  const field = fieldMatch?.[1] || 'debugValue';
  const mode = modeMatch?.[1] || (/(text|special|description|tag)/i.test(field) ? 'text' : 'numeric');
  if (mode === 'text') {
    return {
      field,
      mode: 'text',
      value: textValueForField(field),
      confidence: 0.76,
      reason: `调试 mock 根据 DnD 场景参考推断 ${field}。`,
      referencesUsed: ['灰岭银门场景参考']
    };
  }
  return {
    field,
    mode: 'numeric',
    value: numericValueForField(field),
    confidence: 0.78,
    reason: `调试 mock 为 ${field} 赋予保守的 DnD 风格数值。`,
    referencesUsed: ['DnD 风格 DC 与物品缩放参考']
  };
}

function numericValueForField(field) {
  const key = String(field).toLowerCase();
  if (key.includes('dc')) return 15;
  if (key.includes('attack')) return 2;
  if (key.includes('damage')) return 3;
  if (key.includes('heal')) return 6;
  if (key.includes('speed')) return 40;
  if (key.includes('cargo') || key.includes('capacity')) return 540;
  if (key.includes('ac') || key.includes('armor')) return 1;
  if (key.includes('charges')) return 3;
  if (key.includes('duration')) return 1;
  if (key.includes('uses')) return 1;
  if (key.includes('bonus')) return 2;
  if (key.includes('value') || key.includes('price')) return 75;
  return 2;
}

function textValueForField(field) {
  const key = String(field).toLowerCase();
  if (key.includes('damage')) return '光耀';
  if (key.includes('condition') || key.includes('status')) return '月光眩目';
  if (key.includes('activation')) return '需要直接月光照射';
  return '银门调试备注';
}

function makeQuantificationDefinition(extraFields = [], options = {}) {
  const baseFields = options.includeBase === false ? [] : [
    { name: 'dc', mode: 'numeric', type: 'integer', min: 5, max: 30, description: '相关检定 DC。' },
    { name: 'bonus', mode: 'numeric', type: 'integer', min: -5, max: 10, description: '保守修正值或加值。' }
  ];
  return {
    version: 'debug-dnd-v1',
    prompt: [
      '把模糊的 DnD 物品或机制描述转换为保守的结构化数值。',
      '使用有边界的 5e 风格数字，避免发明过强效果。',
      '优先使用明确场景参考，而不是泛泛的奇幻假设。'
    ].join(' '),
    fields: [
      ...baseFields,
      ...extraFields
    ]
  };
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const provider = new DebugLlmProvider();
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    chatProvider: provider,
    trace: false
  });

  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: '灰岭调试 GM',
      description: '用于工具 prompt 调试的 DnD 风格 GM。',
      first_mes: '银门在月光下静静等待。'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'LLM 工具调试 - 灰岭银门',
    includeGreeting: false
  }).session;

  const state = {
    chatSessionId: chat.id,
    sceneId: SCENE_ID,
    battleId: 'battle_moonlit_tollhouse',
    questId: 'quest_silver_bell',
    encounterId: 'enc_wight_toll'
  };
  provider.state = state;

  try {
    await seedWorld(manager, state);

    writeFileSync(join(OUT_DIR, 'SCENARIO_REFERENCE.md'), `${SCENARIO_REFERENCE}\n`);

    const cases = buildCases(state);
    const manifest = [];
    const aggregateCases = [];
    for (const debugCase of cases) {
      const { manifestEntry, aggregateCase } = await runCase({ manager, provider, debugCase, state });
      manifest.push(manifestEntry);
      aggregateCases.push(aggregateCase);
    }

    writeFileSync(join(OUT_DIR, 'index.md'), renderIndex(manifest, state));
    writeFileSync(join(OUT_DIR, 'LLM工具调试汇总.md'), renderAggregate({
      manifest,
      aggregateCases,
      state
    }));
    writeJson(join(OUT_DIR, 'manifest.json'), {
      generatedAt: new Date().toISOString(),
      scenario: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId
      },
      cases: manifest
    });
  } finally {
    dataManager.close();
    appDatabase.close();
  }
}

async function seedWorld(manager, state) {
  await manager.executeTool('system.factions.upsert_faction', {
    factionId: 'city_watch',
    name: '灰岭守望',
    type: 'militia',
    coreInterests: ['维持秩序', '保障通行安全', '稳定民众信心'],
    publicFace: '在诅咒查明前，银门必须保持受控。'
  });
  await manager.executeTool('system.factions.upsert_faction', {
    factionId: 'moon_cult',
    name: '月之密教',
    type: 'cult',
    coreInterests: ['银铃', '月升仪式', '开启银门'],
    publicFace: '隐藏行动。'
  });
  await manager.executeTool('system.factions.upsert_membership', {
    actorId: 'npc_guard_elowen',
    actorName: '艾洛温',
    factionId: 'city_watch',
    role: '守门卫兵',
    loyalty: 72,
    status: 'active'
  });
  await manager.executeTool('system.npc_state.patch_state', {
    chatSessionId: state.chatSessionId,
    sceneId: state.sceneId,
    npcId: 'pc_arin',
    actorType: 'player',
    isPlayer: true,
    name: '阿林·维尔',
    values: { hp: 22, maxHp: 24, dexterityModifier: 3, proficiencyBonus: 2 },
    statusBar: { hp: 22, maxHp: 24 },
    resources: {
      actionEconomy: {
        action: { current: 1, max: 1 },
        bonusAction: { current: 1, max: 1 },
        reaction: { current: 1, max: 1 },
        movement: { current: 30, max: 30 }
      }
    },
    inventory: {
      items: [
        { id: 'thieves_tools', name: '盗贼工具', quantity: 1 },
        { id: 'cracked_silver_bell', name: '裂银铃', quantity: 1 }
      ]
    }
  });
  await manager.executeTool('system.npc_state.patch_state', {
    chatSessionId: state.chatSessionId,
    sceneId: state.sceneId,
    npcId: 'npc_guard_elowen',
    actorType: 'npc',
    isPlayer: false,
    name: '艾洛温',
    values: { hp: 11, maxHp: 11, wisdomModifier: 1 },
    statusBar: { hp: 11, maxHp: 11 },
    specialStatuses: [{ id: 'conflicted', name: '动摇', intensity: 1 }]
  });
  await manager.executeTool('system.npc_state.patch_state', {
    chatSessionId: state.chatSessionId,
    sceneId: state.sceneId,
    npcId: 'npc_wight_captain',
    actorType: 'npc',
    isPlayer: false,
    name: '月痕尸妖队长',
    values: { hp: 45, maxHp: 45, ac: 14 },
    statusBar: { hp: 45, maxHp: 45 }
  });
  await manager.executeTool('system.map_state.patch_state', {
    chatSessionId: state.chatSessionId,
    sceneId: state.sceneId,
    mapId: 'map_silver_gate',
    objects: [
      { id: 'silver_gate_lock', name: '银门锁', status: 'sealed' },
      { id: 'bell_socket', name: '铃座', status: 'unlit' }
    ]
  });
  await manager.executeTool('system.time.set_interpreter_settings', {
    chatSessionId: state.chatSessionId,
    enabled: true,
    llmEnabled: true,
    timeEstimationEnabled: true
  }, undefined, { authorization: true });
  await manager.executeTool('system.time.set_world_clock', {
    chatSessionId: state.chatSessionId,
    worldClockId: 'grayridge_world_pulse',
    sceneId: state.sceneId,
    name: '灰岭月升压力',
    enabled: true,
    llmEnabled: true,
    intervalSeconds: 60,
    maxEventsPerPulse: 2,
    npcActionChance: 1,
    factionActionChance: 1,
    disasterChance: 0,
    environmentEventChance: 0,
    randomEventChance: 0
  }, undefined, { authorization: true });
  await manager.executeTool('system.time.advance_time', {
    chatSessionId: state.chatSessionId,
    minutes: 1
  });
}

function makeToolPrompt(role, guidance) {
  return [
    `你是 DnD 工具调试用的${role}。`,
    guidance,
    '只返回该工具要求的 JSON 对象，不要输出 Markdown。',
    'JSON key、工具 id、枚举值、ID 和数字按输入保持英文或数字；所有叙述、理由、摘要和可读文本使用中文。'
  ].join('\n');
}

function buildCases(state) {
  const commonContext = {
    scene: '灰岭银门',
    visibleThreats: ['月之密教斥候正在山脊附近活动', '尸妖队长守在通行税桥上'],
    clues: ['裂银铃', '旧税所账册', '月光照亮的铃座']
  };
  const quantDef = makeQuantificationDefinition([
    { name: 'charges', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '可用次数或充能数。' },
    { name: 'activationNote', mode: 'text', description: '简短触发条件。' }
  ]);

  return [
    {
      toolId: 'system.action.plan',
      reference: '行动规划工具应把开放式 DnD 行动转换为检定和状态变更提案。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        sourceText: '阿林尝试用盗贼工具开银门锁，并把裂银铃边缘当作杠杆辅助。',
        templateId: 'dnd5eLite',
        plannerPrompt: makeToolPrompt('行动规划器', '请把玩家行动拆成一次可检定的 DnD 行动计划，成功时只打开锁，不直接打开整座银门。'),
        userRules: `盗贼工具熟练已包含在 +5 修正里。成功只打开门锁，不直接开启整座银门。场景上下文：${JSON.stringify(commonContext)}`,
        useLlm: true
      }
    },
    {
      toolId: 'system.action.resolve',
      reference: '行动结算工具应运行规划器并用 dryRun 检查下游工具调用提案。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        sourceText: '艾洛温分散巡逻注意力时，阿林安静地处理门锁。',
        templateId: 'dnd5eLite',
        plannerPrompt: makeToolPrompt('行动结算规划器', '请生成可检查的行动计划和下游工具调用提案；本次用于调试审阅，不要直接造成不可逆惩罚。'),
        userRules: `保持 dryRun=true 便于调试审阅。场景上下文：${JSON.stringify(commonContext)}`,
        useLlm: true,
        dryRun: true
      }
    },
    {
      toolId: 'system.action.judge_absurdity',
      reference: '荒诞行动判断工具应处理宇宙级越界请求，例如向奈亚求婚或试图说服重力，同时限制成功范围。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        sourceText: '阿林向奈亚拉托提普递出即兴求婚誓词，并试图说服重力把尸妖队长当作彩礼往桥下拖。',
        absurdityPrompt: makeToolPrompt('荒诞行动裁定器', '请判断这个宇宙级越界行动是否荒诞但可玩，并严格限制成功结果的作用范围。'),
        userRules: '荒诞成功只能产生局部征兆、线索或一次短暂战术机会；不能让奈亚真的答应求婚，不能让玩家长期操控重力。',
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.action.explain_absurdity',
      reference: '荒诞解释工具应把成功的荒诞行动解释成世界内事件，并限制范围、加入钩子。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        sourceText: '“向奈亚求婚并说服重力”的尝试获得了荒诞意义上的成功。',
        judgement: {
          absurdityLevel: 'impossibleButPlayable',
          requiresAbsurdityExplanationOnSuccess: true
        },
        explanationPrompt: makeToolPrompt('荒诞成功解释器', '请用灰岭银门的誓约、银铃、外神嘲笑和局部重力错位解释成功原因；不要让奈亚真的答应，也不要改写物理法则。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.action.request_rejudgement',
      reference: '重判申诉工具应产出修订计划，而不是直接修改状态。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        playerArgument: '之前的 DC 忽略了阿林用银铃作杠杆，而且具备工具熟练。',
        requestedOutcome: '降低开锁 DC，或给予优势。',
        originalPlan: actionPlan('act_original_shadow_lockpick', { dc: 18 }),
        appealPrompt: makeToolPrompt('重判申诉裁定器', '请判断玩家申诉是否成立，并在成立时返回修订后的行动计划。'),
        userRules: `申诉上下文：${JSON.stringify(commonContext)}`,
        useLlm: true
      }
    },
    {
      toolId: 'system.npc_behavior.plan',
      reference: 'NPC 行为规划工具应考虑阵营压力，避免一次对话就让 NPC 立即叛变。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        actorNpcIds: ['npc_guard_elowen'],
        triggerText: '艾洛温看见旧门誓约真实存在的证据，但帮助阿林会违反当前守望命令。',
        templateId: 'factionPressure',
        plannerPrompt: makeToolPrompt('NPC 行为规划器', '请让艾洛温在职责、恐惧和证据之间摇摆；她可以暗中帮忙，但不能立刻公开叛变。'),
        userRules: `不要让艾洛温因为一次对话就公开叛变。场景上下文：${JSON.stringify(commonContext)}`,
        useLlm: true
      }
    },
    {
      toolId: 'system.npc_behavior.resolve',
      reference: 'NPC 行为结算工具应产出计划，并通过授权下游工具以 dryRun 方式检查后果。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        actorNpcIds: ['npc_guard_elowen'],
        triggerText: '被说服后，判断艾洛温是否悄悄警告队伍。',
        plannerPrompt: makeToolPrompt('NPC 行为结算规划器', '请生成可审阅的 NPC 行动计划和下游工具调用提案；本次保持可检查。'),
        userRules: `默认 dryRun=true，便于检查。场景上下文：${JSON.stringify(commonContext)}`,
        useLlm: true,
        dryRun: true
      }
    },
    {
      toolId: 'system.persuasion.judge_argument',
      reference: '说服判断工具应评价玩家话术本身，而不是评价骰子结果。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        speakerId: 'pc_arin',
        targetNpcId: 'npc_guard_elowen',
        playerSpeech: '如果守望誓言是为了保护灰岭，那么隐藏银铃证据只会帮到密教。请帮我们安静核实，你仍然是在履行职责。',
        successThreshold: 15,
        persuasionPrompt: makeToolPrompt('说服话术裁定器', '请根据玩家发言、目标 NPC 价值观和场景证据打分；不要掷骰，只判断话术质量。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.persuasion.resolve',
      reference: '说服结算工具应把 LLM 话术判断与确定性骰子结果合并。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        speakerId: 'pc_arin',
        targetNpcId: 'npc_guard_elowen',
        playerSpeech: '给我们十分钟查看税所账册。如果我错了，我自己戴着镣铐回来。',
        successThreshold: 15,
        diceResult: { total: 12, success: false, critical: false },
        rollDice: false,
        persuasionPrompt: makeToolPrompt('说服结算裁定器', '请先判断玩家话术，再与给定骰子结果合并；不要重新掷骰。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.combat.judge_start',
      reference: '战斗开始判断工具应决定场景是否进入战斗，但不施加伤害。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        sourceText: '阿林拒绝被诅咒的通行税后，尸妖队长拔出锈剑挡住桥面。',
        participantIds: ['pc_arin', 'npc_guard_elowen', 'npc_wight_captain'],
        userRules: '只有在即时敌意明确时才开始战斗。',
        startPrompt: makeToolPrompt('战斗开始裁定器', '请判断当前场景是否进入战斗，只决定参战者、目标和利害关系，不结算伤害。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.combat.start_battle',
      reference: '创建战斗工具可使用 LLM 开战判断，然后创建战斗记录。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        battleId: state.battleId,
        sourceText: '队伍拒绝支付幽灵通行税后，尸妖发起攻击。',
        participantIds: ['pc_arin', 'npc_guard_elowen', 'npc_wight_captain'],
        startPrompt: makeToolPrompt('战斗记录创建裁定器', '请判断是否创建战斗记录，并说明参战者、阵营和开场态势。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.combat.judge_special_action',
      reference: '特殊战斗动作判断工具应把非常规行动路由到确定性后续处理。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        battleId: state.battleId,
        actorId: 'pc_arin',
        targetId: 'npc_wight_captain',
        sourceText: '阿林调整裂银铃角度，把月光反射进尸妖队长的眼窝。',
        userRules: '只有在确定性结算后，才消耗动作。',
        specialPrompt: makeToolPrompt('特殊战斗动作裁定器', '请判断这个非常规动作应按状态动作、说服、普通行动解析还是叙事处理，并给出后续结算建议。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.combat.plan_aftermath',
      reference: '战斗善后规划工具应规划奖励、阵营影响和后续钩子，但不直接应用。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        battleId: state.battleId,
        outcome: 'won',
        sourceText: '尸妖被击败，艾洛温没有受到致命伤。',
        userRules: '奖励以线索推进为主，避免过量战利品。',
        aftermathPrompt: makeToolPrompt('战斗善后规划器', '请基于战斗结果规划适度奖励、NPC/阵营影响和后续钩子，不要直接改状态。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.combat.end_battle',
      reference: '结束战斗工具可把 LLM 善后计划附加到战斗记录。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        battleId: state.battleId,
        outcome: 'won',
        sourceText: '队伍获胜后，在灰烬残骸中搜索线索。',
        aftermathPrompt: makeToolPrompt('结束战斗善后规划器', '请为结束战斗记录生成线索型奖励、阵营反应和后续风险。'),
        context: commonContext,
        useLlm: true
      }
    },
    {
      toolId: 'system.quests.create_hook',
      reference: '任务钩子工具应定义开放问题，而不是固定路线链。',
      input: {
        chatSessionId: state.chatSessionId,
        seedText: '裂银铃和税所账册暗示银门被古老誓约束缚。',
        sceneContext: SCENARIO_REFERENCE,
        userRules: '不要写必经步骤链。线索只能作为可选提示保存。',
        useLlm: true
      }
    },
    {
      toolId: 'system.quests.gate_relevance',
      reference: '任务相关性闸门应判断哪个活跃任务需要调查或完成检查。',
      input: {
        chatSessionId: state.chatSessionId,
        text: '阿林阅读税所账册，并把内容与裂银铃上的裂纹比对。',
        sceneContext: SCENARIO_REFERENCE,
        userRules: '只有文本实质触及目标时，才标记为相关。',
        useLlm: true
      }
    },
    {
      toolId: 'system.quests.resolve_investigation_tick',
      reference: '调查推进工具必须推进证据、排除项、风险或结论。',
      input: {
        chatSessionId: state.chatSessionId,
        questId: state.questId,
        sourceText: '账册记载：守望队长曾敲响银铃，用它束缚亡灵通行税吏。',
        sceneContext: SCENARIO_REFERENCE,
        userRules: '只有产生有意义进展时才消耗调查预算。',
        useLlm: true,
        dryRun: true
      }
    },
    {
      toolId: 'system.quests.check_completion',
      reference: '任务完成检查应判断结果是否满足目标，而不是是否遵守固定路线。',
      input: {
        chatSessionId: state.chatSessionId,
        questId: state.questId,
        sourceText: '月升时，阿林在银门前敲响修复过的银铃，并说出誓词。',
        sceneContext: SCENARIO_REFERENCE,
        useLlm: true,
        dryRun: true
      }
    },
    {
      toolId: 'system.quests.plan_reward',
      reference: '任务奖励规划应与难度、风险和玩家过程成比例。',
      input: {
        chatSessionId: state.chatSessionId,
        questId: state.questId,
        completion: { objectiveSatisfied: true, status: 'completed' },
        processSummary: '队伍依靠证据推进，并避免了不必要战斗。',
        userRules: '优先给社交通行权和线索，而不是大量金币。',
        useLlm: true
      }
    },
    {
      toolId: 'system.quests.plan_consequence',
      reference: '任务后果规划应避免免费惩罚，只在失败、过期或忽略钩子时应用。',
      input: {
        chatSessionId: state.chatSessionId,
        questId: state.questId,
        failureOrExpiry: { status: 'expired', reason: '队伍拖延到月升之后。' },
        userRules: '后果应制造压力，而不是剥夺玩家能动性。',
        useLlm: true
      }
    },
    {
      toolId: 'system.encounters.create_encounter',
      reference: '遭遇创建工具用于已触发事件，必须避免免费惩罚。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        sourceText: '随机遭遇触发后，一个带月痕的尸妖从税所里走出。',
        luckScore: 52,
        sceneContext: SCENARIO_REFERENCE,
        userRules: '遭遇可以制造威胁，但在行动失败或进入战斗前不能造成伤害。',
        useLlm: true
      }
    },
    {
      toolId: 'system.encounters.resolve_tick',
      reference: '遭遇推进工具应消耗收束预算，并让局势发生变化。',
      input: {
        chatSessionId: state.chatSessionId,
        encounterId: state.encounterId,
        sourceText: '阿林询问尸妖欠它的是哪种硬币，并展示裂银铃。',
        sceneContext: SCENARIO_REFERENCE,
        useLlm: true,
        dryRun: true
      }
    },
    {
      toolId: 'system.encounters.check_outcome',
      reference: '遭遇结果检查应在玩家过程之后判断 resolved、failed、escaped 或 engaged。',
      input: {
        chatSessionId: state.chatSessionId,
        encounterId: state.encounterId,
        sourceText: '队伍援引通行税誓约，尸妖让开桥面。',
        sceneContext: SCENARIO_REFERENCE,
        useLlm: true,
        dryRun: true
      }
    },
    {
      toolId: 'system.encounters.plan_reward',
      reference: '遭遇奖励应体现运气、风险、过程和结果。',
      input: {
        chatSessionId: state.chatSessionId,
        encounterId: state.encounterId,
        outcome: { resolved: true, rewardEligible: true },
        processSummary: '队伍没有开战就解决了尸妖问题。',
        userRules: '奖励保持适度，并以线索推进为主。',
        useLlm: true
      }
    },
    {
      toolId: 'system.encounters.plan_consequence',
      reference: '遭遇后果只用于检定失败、目标失败、逃脱或明确冒险选择。',
      input: {
        chatSessionId: state.chatSessionId,
        encounterId: state.encounterId,
        failure: { failed: true, reason: '队伍在誓约下撒谎，并且欺瞒检定失败。' },
        userRules: '不要追溯伤害；创建公平的战斗或压力后果。',
        useLlm: true
      }
    },
    {
      toolId: 'system.time.interpret_advance',
      reference: '时间解释工具以规则优先，但可用 LLM 估算模糊耗时。',
      input: {
        chatSessionId: state.chatSessionId,
        sceneId: state.sceneId,
        text: '阿林和艾洛温花了一段时间交叉核对账册、银铃裂纹和月光下的铃座。',
        recentContext: SCENARIO_REFERENCE,
        preferLlm: true,
        useLlm: true
      }
    },
    {
      toolId: 'system.time.generate_world_pulse',
      reference: '世界脉冲工具应提出可检查的 NPC、阵营或环境事件，但不直接排程。',
      input: {
        chatSessionId: state.chatSessionId,
        worldClockId: 'grayridge_world_pulse',
        sceneId: state.sceneId,
        force: true,
        contextText: SCENARIO_REFERENCE,
        npcRefs: [{ id: 'npc_guard_elowen', name: '艾洛温' }],
        factionRefs: [{ id: 'moon_cult', name: '月之密教' }, { id: 'city_watch', name: '灰岭守望' }],
        userRules: '生成压力、警告或复杂化事件；不要直接造成伤害。',
        useLlm: true
      }
    },
    {
      toolId: 'system.time.run_world_pulse',
      reference: '运行世界脉冲工具可使用 LLM，然后 dryRun 或排程生成事件。',
      input: {
        chatSessionId: state.chatSessionId,
        worldClockId: 'grayridge_world_pulse',
        sceneId: state.sceneId,
        force: true,
        dryRun: true,
        contextText: SCENARIO_REFERENCE,
        npcRefs: [{ id: 'npc_guard_elowen', name: '艾洛温' }],
        factionRefs: [{ id: 'moon_cult', name: '月之密教' }, { id: 'city_watch', name: '灰岭守望' }],
        userRules: '保持 dryRun=true，便于调试检查。',
        useLlm: true
      }
    },
    {
      toolId: 'system.data.quantify_text',
      reference: '数据量化工具测试把模糊文本逐字段量化并写入 SQLite。',
      input: {
        collection: 'debug_magic_effects',
        id: 'moon_bell_effect',
        text: '裂银铃能让誓约相关检定获得适度的 +2 加值，通常需要在月光下通过 DC 15 才能激活。',
        definition: quantDef,
        useLlm: true,
        requireLlm: true
      }
    },
    ...itemCases(),
    ...mechanicCases()
  ];
}

function itemBase(definition) {
  return {
    quantificationDefinition: definition,
    quantify: true,
    useLlm: true,
    requireLlm: true,
    actor: 'agent'
  };
}

function itemCases() {
  const consumableDef = makeQuantificationDefinition([
    { name: 'charges', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '可用份数或充能数。' },
    { name: 'activationNote', mode: 'text', description: '简短触发条件。' }
  ]);
  const equipmentDef = makeQuantificationDefinition([
    { name: 'armorBonus', mode: 'numeric', type: 'integer', min: 0, max: 5, description: '护甲或防护加值。' },
    { name: 'activationNote', mode: 'text', description: '防护生效条件。' }
  ], { includeBase: false });
  const accessoryDef = makeQuantificationDefinition([
    { name: 'charges', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '可用充能数。' },
    { name: 'activationNote', mode: 'text', description: '戒指共鸣或侦测条件。' }
  ]);
  const weaponDef = makeQuantificationDefinition([
    { name: 'attackBonus', mode: 'numeric', type: 'integer', min: 0, max: 5, description: '特定条件下的攻击加值。' },
    { name: 'radiantDamage', mode: 'numeric', type: 'integer', min: 0, max: 12, description: '光耀附加伤害。' },
    { name: 'activationNote', mode: 'text', description: '附加效果生效条件。' }
  ], { includeBase: false });
  const mountDef = makeQuantificationDefinition([
    { name: 'handlingDc', mode: 'numeric', type: 'integer', min: 5, max: 30, description: '特殊情况下安抚或操控坐骑的 DC。' },
    { name: 'speedFeet', mode: 'numeric', type: 'integer', min: 0, max: 120, description: '移动速度，单位英尺。' },
    { name: 'cargoCapacity', mode: 'numeric', type: 'integer', min: 0, max: 2000, description: '载重，单位磅。' }
  ], { includeBase: false });
  const specialDef = makeQuantificationDefinition([
    { name: 'dc', mode: 'numeric', type: 'integer', min: 5, max: 30, description: '任务物品激活 DC。' },
    { name: 'charges', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '安全使用次数。' },
    { name: 'activationNote', mode: 'text', description: '任务物品触发条件。' }
  ], { includeBase: false });
  const materialDef = makeQuantificationDefinition([
    { name: 'uses', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '一次导入样例中的可用次数。' },
    { name: 'activationNote', mode: 'text', description: '材料准备条件。' }
  ]);
  return [
    itemUpsertCase('system.item_registry.upsert_item', 'item_moon_tea', '月薄荷茶', {
      itemType: 'consumable',
      description: '用月薄荷泡成的茶，能恢复专注，并帮助回忆誓约内容。',
      quantificationSourceText: '温和消耗品，有三份用量；回忆旧誓约时获得 +2 加值。'
    }, itemBase(consumableDef)),
    itemPatchCase('system.item_registry.patch_item', 'item_moon_tea', {
      description: '月薄荷茶也能让害怕的证人在守望审问前稳住情绪。',
      quantificationSourceText: '更新为社交辅助消耗品；准备 DC 15，提供 +2 加值。'
    }, itemBase(consumableDef)),
    itemUpsertCase('system.item_registry.upsert_equipment', 'equip_moon_cloak', '月银斗篷', {
      equipmentType: 'clothing',
      slot: 'shoulders',
      description: '能捕捉月光的斗篷，在银门附近提供轻微防护。',
      quantificationSourceText: '轻型防护斗篷；只有在直接月光下提供 +1 AC。'
    }, itemBase(equipmentDef)),
    itemPatchCase('system.item_registry.patch_equipment', 'equip_moon_cloak', {
      description: '斗篷进入室内后防护会消散。',
      quantificationSourceText: '月光下情境性 +1 AC；室内没有加值。'
    }, itemBase(equipmentDef)),
    itemUpsertCase('system.item_registry.upsert_accessory', 'acc_toll_ring', '通行税戒指', {
      accessoryType: 'ring',
      slot: 'finger',
      description: '一枚古旧通行税戒指，靠近合法城门誓约时会共鸣。',
      quantificationSourceText: '戒指有三次充能；识别城门誓约时 +2。'
    }, itemBase(accessoryDef)),
    itemPatchCase('system.item_registry.patch_accessory', 'acc_toll_ring', {
      description: '戒指揭穿虚假誓约时会消耗一次充能。',
      quantificationSourceText: '三次充能；侦测誓约 DC 15。'
    }, itemBase(accessoryDef)),
    itemUpsertCase('system.item_registry.upsert_weapon', 'weapon_bell_dagger', '铃首匕首', {
      weaponType: 'dagger',
      damage: '1d4 piercing',
      damageType: 'piercing',
      description: '一把柄尾嵌着月银小铃的匕首。',
      quantificationSourceText: '灵巧匕首；攻击受誓约束缚的亡灵时 +2；每场景一次附加 +3 光耀伤害。'
    }, itemBase(weaponDef)),
    itemPatchCase('system.item_registry.patch_weapon', 'weapon_bell_dagger', {
      description: '只有银铃被敲响后，光耀附加效果才会生效。',
      quantificationSourceText: '只有铃声共鸣后攻击 +2；每场景一次 +3 光耀附加。'
    }, itemBase(weaponDef)),
    itemUpsertCase('system.item_registry.upsert_mount', 'mount_gray_mule', '灰岭骡', {
      mountType: 'mule',
      size: 'medium',
      description: '一头受过峭壁小径训练、步伐稳健的骡子。',
      quantificationSourceText: '骡子速度 40 英尺，载重 540 磅。'
    }, itemBase(mountDef)),
    itemPatchCase('system.item_registry.patch_mount', 'mount_gray_mule', {
      description: '除非被安抚，否则这头骡子会拒绝走上有亡灵盘踞的桥。',
      quantificationSourceText: '速度 40 英尺；靠近亡灵桥梁时，安抚它需要 DC 15 动物驯养。'
    }, itemBase(mountDef)),
    itemUpsertCase('system.item_registry.upsert_special_item', 'special_silver_bell', '裂银铃', {
      specialType: 'quest_item',
      rarity: 'unique',
      description: '一只破裂的银铃，能在月光下激活银门誓约。',
      quantificationSourceText: '唯一任务物品；月光下激活 DC 15；裂纹恶化前可安全敲响三次。'
    }, itemBase(specialDef)),
    itemPatchCase('system.item_registry.patch_special_item', 'special_silver_bell', {
      description: '轻轻敲响时，银铃还能揭露虚假的通行税誓约。',
      quantificationSourceText: '激活 DC 15；可安全敲响三次；月光下揭露虚假誓约。'
    }, itemBase(specialDef)),
    {
      toolId: 'system.item_registry.import_document',
      reference: '物品导入工具应把同样的异步量化默认值应用到结构化物品文档。',
      context: { authorization: true },
      input: {
        kind: 'item',
        format: 'json',
        text: JSON.stringify({
          items: [
            {
              id: 'item_imported_moon_salt',
              name: '月盐',
              itemType: 'material',
              description: '用于绘制誓约法阵的银白色盐。',
              quantificationSourceText: '材料提供 +2 仪式加值；正确准备需要 DC 15。',
              quantificationDefinition: materialDef,
              quantify: true
            }
          ]
        }, null, 2),
        useLlm: true,
        requireLlm: true
      }
    }
  ];
}

function itemUpsertCase(toolId, id, name, input, base) {
  return {
    toolId,
    reference: `${toolId} 应把模糊的 DnD 物品文本量化为注册表条目。`,
    context: { authorization: true, actor: 'agent' },
    input: {
      id,
      name,
      ...input,
      ...base
    }
  };
}

function itemPatchCase(toolId, id, patch, base) {
  return {
    toolId,
    reference: `${toolId} 应在模糊补丁后重新量化既有 DnD 注册表条目。`,
    context: { authorization: true, actor: 'agent' },
    input: {
      id,
      patch: {
        ...patch,
        ...base
      }
    }
  };
}

function mechanicBase(definition) {
  return {
    quantificationDefinition: definition,
    quantify: true,
    useLlm: true,
    requireLlm: true,
    actor: 'agent'
  };
}

function mechanicCases() {
  const skillDef = makeQuantificationDefinition([
    { name: 'dc', mode: 'numeric', type: 'integer', min: 5, max: 30, description: '晦涩知识或困难应用的 DC。' },
    { name: 'useBonus', mode: 'numeric', type: 'integer', min: -5, max: 10, description: '该技能在适用场景下提供的加值。' },
    { name: 'activationNote', mode: 'text', description: '适用条件或限制。' }
  ], { includeBase: false });
  const statusDef = makeQuantificationDefinition([
    { name: 'dc', mode: 'numeric', type: 'integer', min: 5, max: 30, description: '施加状态所需 DC。' },
    { name: 'durationRounds', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '以轮为单位的持续时间。' },
    { name: 'conditionTag', mode: 'text', description: '状态关键词。' }
  ], { includeBase: false });
  const featDef = makeQuantificationDefinition([
    { name: 'useBonus', mode: 'numeric', type: 'integer', min: -5, max: 10, description: '专长提供的相关检定加值。' },
    { name: 'usesPerScene', mode: 'numeric', type: 'integer', min: 0, max: 10, description: '每场景可用次数。' },
    { name: 'activationNote', mode: 'text', description: '专长触发条件。' }
  ], { includeBase: false });
  return [
    mechanicUpsertCase('system.mechanics_registry.upsert_skill', 'skill_oath_lore', '誓约学识', {
      category: 'knowledge',
      ability: 'int',
      description: '关于古老城邦、神圣和魔法誓约的知识。',
      mechanicalEffect: '帮助识别约束性誓词和合法漏洞。',
      quantificationSourceText: '识别誓约条款时 +2；识别晦涩通行税誓约需要 DC 15。'
    }, mechanicBase(skillDef)),
    mechanicPatchCase('system.mechanics_registry.patch_skill', 'skill_oath_lore', {
      mechanicalEffect: '也能识别亡灵说出的虚假誓约。',
      quantificationSourceText: '+2 加值；识破亡灵虚假通行税誓约需要 DC 15。'
    }, mechanicBase(skillDef)),
    mechanicUpsertCase('system.mechanics_registry.upsert_status', 'status_moon_dazzled', '月光眩目', {
      category: 'condition',
      severity: 'minor',
      durationType: 'round',
      description: '从银器反射出的月光会扰乱亡灵专注。',
      mechanicalEffect: '目标在下一轮结束前的一次攻击具有劣势。',
      quantificationSourceText: '轻微状态，持续 1 轮；用银铃闪光施加需要 DC 15。'
    }, mechanicBase(statusDef)),
    mechanicPatchCase('system.mechanics_registry.patch_status', 'status_moon_dazzled', {
      mechanicalEffect: '不会影响免疫目盲或光耀效果的生物。',
      quantificationSourceText: '持续 1 轮，DC 15，状态标签为 moon-dazzled。'
    }, mechanicBase(statusDef)),
    mechanicUpsertCase('system.mechanics_registry.upsert_feat', 'feat_oath_listener', '誓约聆听者', {
      category: 'social',
      tier: 'novice',
      description: '当一处地点与古老公共誓约共鸣时，你能听见回声。',
      mechanicalEffect: '每场景一次，获得一条关于合法誓约或约束词句的线索。',
      quantificationSourceText: '每场景一次的线索特性；相关洞悉或历史检定 +2。'
    }, mechanicBase(featDef)),
    mechanicPatchCase('system.mechanics_registry.patch_feat', 'feat_oath_listener', {
      mechanicalEffect: '线索不能直接解决任务，只能揭示有用角度。',
      quantificationSourceText: '每场景一次，提供 +2 支援，不自动完成任务。'
    }, mechanicBase(featDef)),
    {
      toolId: 'system.mechanics_registry.import_document',
      reference: '机制导入工具应把异步量化默认值应用到结构化技能、状态或专长文档。',
      context: { authorization: true, actor: 'agent' },
      input: {
        kind: 'skill',
        format: 'json',
        text: JSON.stringify({
          skills: [
            {
              id: 'skill_imported_gatecraft',
              name: '门工学',
              category: 'exploration',
              ability: 'int',
              description: '关于闸门、锁具和古旧城门机关的实用知识。',
              mechanicalEffect: '帮助检查或解除加固城门机关。',
              quantificationSourceText: '检查旧城门时 +2；识别隐藏机关需要 DC 15。',
              quantificationDefinition: skillDef,
              quantify: true
            }
          ]
        }, null, 2),
        useLlm: true,
        requireLlm: true
      }
    }
  ];
}

function mechanicUpsertCase(toolId, id, name, input, base) {
  return {
    toolId,
    reference: `${toolId} 应量化一条模糊的 DnD 机制条目。`,
    context: { authorization: true, actor: 'agent' },
    input: {
      id,
      name,
      ...input,
      ...base
    }
  };
}

function mechanicPatchCase(toolId, id, patch, base) {
  return {
    toolId,
    reference: `${toolId} 应在补丁文本后重新量化既有 DnD 机制。`,
    context: { authorization: true, actor: 'agent' },
    input: {
      id,
      patch: {
        ...patch,
        ...base
      }
    }
  };
}

async function runCase({ manager, provider, debugCase, state }) {
  const toolId = debugCase.toolId;
  const dirName = toolId.replaceAll('.', '__');
  const dir = join(OUT_DIR, dirName);
  mkdirSync(dir, { recursive: true });

  const input = replaceChatPlaceholders(typeof debugCase.input === 'function' ? debugCase.input(state) : debugCase.input, state);
  const context = debugCase.context || {};
  provider.setCurrentTool(toolId);
  const beforeCallCount = provider.calls.length;
  const startedAt = new Date().toISOString();
  let status = 'ok';
  let result;
  let error;

  try {
    result = await manager.executeTool(toolId, input, undefined, context);
    if (toolId === 'system.quests.create_hook') {
      state.questId = result.output.quest?.data?.questId || result.output.quest?.questId || state.questId;
    }
    if (toolId === 'system.encounters.create_encounter') {
      state.encounterId = result.output.encounter?.data?.encounterId || result.output.encounter?.encounterId || state.encounterId;
    }
    if (toolId === 'system.combat.start_battle') {
      state.battleId = result.output.battle?.data?.battleId || state.battleId;
    }
  } catch (caught) {
    status = 'error';
    error = serializeError(caught);
  }

  const finishedAt = new Date().toISOString();
  const llmCalls = provider.calls.slice(beforeCallCount);
  const promptFromOutput = extractPrompt(result?.output);
  const reviewPrompt = buildChineseReviewPrompt({
    toolId,
    reference: debugCase.reference || '',
    input,
    context
  });

  writeFileSync(join(dir, 'reference.md'), `${SCENARIO_REFERENCE}\n\n## 工具专用参考\n\n${debugCase.reference || ''}\n`);
  writeJson(join(dir, 'input.json'), { toolId, input, context });
  writeJson(join(dir, 'llm_calls.json'), llmCalls);
  writeFileSync(join(dir, 'prompt.md'), renderPrompts({ reviewPrompt, promptFromOutput, llmCalls }));
  if (result) writeJson(join(dir, 'output.json'), result);
  if (error) writeJson(join(dir, 'error.json'), error);
  writeFileSync(join(dir, 'README.md'), renderCaseReadme({
    toolId,
    status,
    reference: debugCase.reference || '',
    startedAt,
    finishedAt,
    llmCallCount: llmCalls.length
  }));

  const manifestEntry = {
    toolId,
    directory: dirName,
    status,
    llmCallCount: llmCalls.length,
    hasPrompt: Boolean(promptFromOutput || llmCalls.length),
    error: error?.message
  };
  return {
    manifestEntry,
    aggregateCase: {
      toolId,
      directory: dirName,
      status,
      reference: debugCase.reference || '',
      startedAt,
      finishedAt,
      input,
      context,
      reviewPrompt,
      promptFromOutput,
      llmCalls,
      output: result,
      error
    }
  };
}

function replaceChatPlaceholders(value, state) {
  if (Array.isArray(value)) return value.map((item) => replaceChatPlaceholders(item, state));
  if (!value || typeof value !== 'object') {
    return value === '__CHAT_SESSION_ID__' ? state.chatSessionId : value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceChatPlaceholders(entry, state)]));
}

function extractPrompt(output) {
  if (!output || typeof output !== 'object') return '';
  if (typeof output.prompt === 'string') return output.prompt;
  if (output.pulse && typeof output.pulse.prompt === 'string') return output.pulse.prompt;
  return '';
}

function buildChineseReviewPrompt({ toolId, reference, input, context }) {
  return [
    '你是 DnD 工具调试用的 LLM。',
    `工具名称：${toolId}`,
    '',
    '请根据共享场景参考、工具专用参考、执行上下文和工具输入，返回该工具期望的 JSON。',
    'JSON key、工具 id、枚举值、ID 和数字保持原样；除非字段强制要求英文或数字，所有可读文本都使用中文。',
    '不要输出 Markdown，不要解释 JSON 外的内容。',
    '',
    '## 共享场景参考',
    SCENARIO_REFERENCE,
    '',
    '## 工具专用参考',
    reference || '无额外参考。',
    '',
    '## 执行上下文',
    JSON.stringify(context || {}, jsonReplacer, 2),
    '',
    '## 工具输入',
    JSON.stringify(input || {}, jsonReplacer, 2)
  ].join('\n');
}

function renderPrompts({ reviewPrompt, promptFromOutput, llmCalls }) {
  const parts = ['# Prompt 捕获', ''];
  parts.push(
    '## 中文审阅 Prompt',
    '',
    '这段是本次调试整理出的中文 prompt，用于人工审阅工具效果。',
    '',
    '```text',
    reviewPrompt,
    '```',
    ''
  );
  if (promptFromOutput) {
    parts.push('## 工具输出暴露的原始 Prompt', '', '```text', promptFromOutput, '```', '');
  }
  for (const call of llmCalls) {
    parts.push(`## LLM 调用 ${call.index}`, '');
    for (const [index, message] of (call.request.messages || []).entries()) {
      parts.push(`### 消息 ${index + 1}: ${message.role || 'unknown'}`, '', '```text', String(message.content || ''), '```', '');
    }
    parts.push('### Mock LLM 响应', '', '```json', JSON.stringify(call.response, jsonReplacer, 2), '```', '');
  }
  if (!promptFromOutput && llmCalls.length === 0) {
    parts.push('没有捕获到原始 prompt。工具可能在调用 LLM 前失败，或返回时没有实际使用 LLM。');
  }
  return `${parts.join('\n')}\n`;
}

function renderCaseReadme({ toolId, status, reference, startedAt, finishedAt, llmCallCount }) {
  return [
    `# ${toolId}`,
    '',
    `状态：${status}`,
    `捕获到的 LLM 调用数：${llmCallCount}`,
    `开始时间：${startedAt}`,
    `结束时间：${finishedAt}`,
    '',
    '## 调试意图',
    '',
    reference,
    '',
    '## 文件',
    '',
    '- `reference.md`：共享 DnD 场景和工具专用参考。',
    '- `input.json`：准确的工具输入和执行上下文。',
    '- `prompt.md`：中文审阅 prompt，以及工具输出或 mock LLM 调用中捕获到的原始 prompt。',
    '- `llm_calls.json`：结构化 mock LLM 请求和响应。',
    '- `output.json`：成功时的完整工具执行结果。',
    '- `error.json`：失败时序列化后的错误。'
  ].join('\n');
}

function renderIndex(manifest, state) {
  const rows = manifest.map((entry) => `| \`${entry.toolId}\` | ${entry.status} | ${entry.llmCallCount} | [${entry.directory}](./${entry.directory}/README.md) | ${escapeMarkdownCell(entry.error || '')} |`);
  return [
    '# LLM 工具调试索引',
    '',
    `聊天会话：\`${state.chatSessionId}\``,
    `场景：\`${state.sceneId}\``,
    '',
    '本目录使用确定性 mock LLM 生成，便于在没有外部 API 波动的情况下审阅 prompt、参考、输入和输出。',
    '',
    '总汇总文件：[LLM工具调试汇总.md](./LLM工具调试汇总.md)',
    '',
    '| 工具 | 状态 | LLM 调用数 | 目录 | 错误 |',
    '|---|---:|---:|---|---|',
    ...rows,
    ''
  ].join('\n');
}

function renderAggregate({ manifest, aggregateCases, state }) {
  const rows = manifest.map((entry) => `| \`${entry.toolId}\` | ${entry.status} | ${entry.llmCallCount} | \`${entry.directory}\` | ${escapeMarkdownCell(entry.error || '')} |`);
  const parts = [
    '# LLM 工具调试汇总',
    '',
    `聊天会话：\`${state.chatSessionId}\``,
    `场景：\`${state.sceneId}\``,
    '',
    '说明：本文把每个需要 LLM 才能运行的工具，按工具名称汇总 prompt、参考、输入、原始 LLM 调用、mock 输出和最终工具输出。工具 ID、JSON key、枚举值、ID 和数字按机器要求保留英文或数字；我能控制的场景参考、测试 prompt、必要输入和 mock 可读输出均已中文化。源码内部硬编码的原始 prompt 会原样保留，可能包含英文。',
    '',
    '## 共享场景参考',
    '',
    SCENARIO_REFERENCE,
    '',
    '## 工具索引',
    '',
    '| 工具 | 状态 | LLM 调用数 | 目录 | 错误 |',
    '|---|---:|---:|---|---|',
    ...rows,
    '',
    '## 工具详情',
    ''
  ];

  for (const item of aggregateCases) {
    parts.push(
      `### ${item.toolId}`,
      '',
      `状态：${item.status}`,
      `目录：\`${item.directory}\``,
      `开始时间：${item.startedAt}`,
      `结束时间：${item.finishedAt}`,
      '',
      '#### 调试参考',
      '',
      item.reference || '无额外参考。',
      '',
      '#### 中文审阅 Prompt',
      '',
      '```text',
      item.reviewPrompt,
      '```',
      '',
      '#### 工具输入',
      '',
      '```json',
      JSON.stringify(item.input, jsonReplacer, 2),
      '```',
      '',
      '#### 执行上下文',
      '',
      '```json',
      JSON.stringify(item.context || {}, jsonReplacer, 2),
      '```',
      ''
    );

    if (item.promptFromOutput) {
      parts.push(
        '#### 工具输出暴露的原始 Prompt',
        '',
        '```text',
        item.promptFromOutput,
        '```',
        ''
      );
    }

    parts.push('#### 原始 LLM 调用与 Mock 响应', '');
    if (item.llmCalls.length === 0) {
      parts.push('未捕获到 LLM 调用。', '');
    } else {
      for (const call of item.llmCalls) {
        parts.push(`##### 调用 ${call.index}`, '');
        for (const [index, message] of (call.request.messages || []).entries()) {
          parts.push(
            `消息 ${index + 1}（${message.role || 'unknown'}）：`,
            '',
            '```text',
            String(message.content || ''),
            '```',
            ''
          );
        }
        parts.push(
          'Mock LLM 响应：',
          '',
          '```json',
          JSON.stringify(call.response, jsonReplacer, 2),
          '```',
          ''
        );
      }
    }

    if (item.output) {
      parts.push(
        '#### 工具输出',
        '',
        '```json',
        JSON.stringify(item.output, jsonReplacer, 2),
        '```',
        ''
      );
    }
    if (item.error) {
      parts.push(
        '#### 工具错误',
        '',
        '```json',
        JSON.stringify(item.error, jsonReplacer, 2),
        '```',
        ''
      );
    }
  }

  return `${parts.join('\n')}\n`;
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, jsonReplacer, 2)}\n`);
}

function jsonReplacer(_key, value) {
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Error) return serializeError(value);
  return value;
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack,
    statusCode: error?.statusCode,
    details: error?.details
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
