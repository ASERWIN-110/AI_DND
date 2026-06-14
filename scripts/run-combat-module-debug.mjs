import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppDatabase,
  createDefaultToolPluginManager
} from '../src/index.js';

const OUT_DIR = join(process.cwd(), 'manuals', 'generated-debug', 'combat-module');
const SCENE_ID = 'debug_bridge';
const BATTLE_ID = 'battle_debug_bridge';

class QueueJsonProvider {
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  async generate(request = {}) {
    const response = this.responses.shift();
    if (!response) {
      throw new Error('QueueJsonProvider has no queued response for LLM call');
    }
    const call = {
      index: this.calls.length + 1,
      request: cloneJson({
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      }),
      response: cloneJson(response)
    };
    this.calls.push(call);
    return {
      content: JSON.stringify(response),
      raw: {
        provider: 'combat-module-debug-queue',
        callIndex: call.index
      }
    };
  }
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const provider = new QueueJsonProvider([
    combatStartDecision(),
    combatAftermath()
  ]);
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    appDatabase,
    chatProvider: provider,
    trace: false
  });
  const calls = installToolCallRecorder(manager);
  let phase = 'setup';
  calls.setPhase(() => phase);

  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Combat Debug GM',
      first_mes: 'Debug combat begins.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'Combat Module Debug',
    includeGreeting: false
  }).session;

  try {
    await seedCombatSetup(manager, chat.id);

    phase = 'combat_flow';
    const decisionResult = await manager.executeTool('system.combat.judge_start', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      sourceText: '亡灵队长拔出锈剑，堵住桥面并宣告任何人不得通过。',
      participantIds: ['pc_arin', 'npc_wight_captain'],
      allyIds: ['pc_arin'],
      enemyIds: ['npc_wight_captain'],
      userRules: '只判断是否开战；不要结算伤害、掷骰或写状态。',
      useLlm: true
    });

    assert.equal(decisionResult.output.decision.shouldStartBattle, true);

    const startResult = await manager.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      sourceText: '开战判定为 true 后创建战斗记录。',
      decision: decisionResult.output.decision,
      includeContext: false
    });

    const spawnResult = await manager.executeTool('system.combat.spawn_combatant', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      enemyObject: {
        enemyId: 'npc_wight_captain',
        name: '月痕尸妖队长',
        threatTier: 'solo_debug',
        values: { hp: 18, maxHp: 18, armorClass: 13, speed: 30 },
        normalActionPolicy: {
          actorId: 'npc_wight_captain',
          weights: { attack: 100, defense: 0, dodge: 0 },
          attack: {
            successThreshold: -100,
            modifier: 0,
            damage: [{ type: 'necrotic', amount: 2 }]
          }
        }
      }
    });

    await manager.executeTool('system.resources.reset_action_economy', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      npcId: 'pc_arin',
      movementMax: 30,
      source: 'combat-module-debug'
    });

    const firstPlayerAction = await manager.executeTool('system.combat.resolve_action', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      actionId: 'pc_attack_1',
      actorId: 'pc_arin',
      targetId: 'npc_wight_captain',
      sourceText: '阿林用短剑刺向尸妖队长。',
      hitResult: { outcome: 'hit', hit: true, total: 17, successThreshold: 13 },
      damage: [{ type: 'slashing', amount: 5 }]
    });

    const enemyTurn = await manager.executeTool('system.combat.resolve_enemy_turn', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      actorId: 'npc_wight_captain',
      targetId: 'pc_arin',
      roll: 0.01,
      sourceText: '尸妖队长按普通敌方行动表反击。'
    });

    await manager.executeTool('system.resources.reset_action_economy', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      npcId: 'pc_arin',
      movementMax: 30,
      source: 'combat-module-debug-round-2'
    });

    const secondPlayerAction = await manager.executeTool('system.combat.resolve_action', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      actionId: 'pc_attack_2',
      actorId: 'pc_arin',
      targetId: 'npc_wight_captain',
      sourceText: '阿林趁尸妖露出破绽，第二击结束战斗。',
      hitResult: { outcome: 'hit', hit: true, total: 19, successThreshold: 13 },
      damage: [{ type: 'slashing', amount: 13 }]
    });

    const summary = await manager.executeTool('system.combat.summarize_battle_result', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID
    });

    const aftermath = await manager.executeTool('system.combat.plan_aftermath', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      outcome: 'won',
      sourceText: '尸妖被击败，桥面暂时安全。',
      userRules: '奖励以线索和轻量战利品为主；不要直接写入奖励。',
      useLlm: true
    });

    const ended = await manager.executeTool('system.combat.end_battle', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      outcome: 'won',
      sourceText: '把战斗标记为胜利，并附加善后计划。',
      aftermath: aftermath.output.aftermath,
      includeContext: false
    });

    const finalEnemy = await manager.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      npcId: 'npc_wight_captain'
    });

    assert.equal(startResult.output.ok, true);
    assert.equal(spawnResult.output.enemy.enemyId, 'npc_wight_captain');
    assert.equal(firstPlayerAction.output.settlement.records[0].data.values.hp, 13);
    assert.equal(enemyTurn.output.ordinaryAction.selected.mode, 'attack');
    assert.equal(secondPlayerAction.output.settlement.records[0].data.values.hp, 0);
    assert.equal(finalEnemy.output.data.values.hp, 0);
    assert.equal(summary.output.summary.llmUsedForOrdinaryCombat, false);
    assert.equal(aftermath.output.aftermath.status, 'planned');
    assert.equal(ended.output.battle.data.status, 'won');

    const rawArtifact = {
      generatedAt: new Date().toISOString(),
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      assertions: {
        judgeStartShouldStartBattle: decisionResult.output.decision.shouldStartBattle,
        firstPlayerDamageLeavesEnemyHp: firstPlayerAction.output.settlement.records[0].data.values.hp,
        enemyOrdinaryActionMode: enemyTurn.output.ordinaryAction.selected.mode,
        secondPlayerDamageLeavesEnemyHp: secondPlayerAction.output.settlement.records[0].data.values.hp,
        ordinaryCombatUsedLlm: summary.output.summary.llmUsedForOrdinaryCombat,
        finalBattleStatus: ended.output.battle.data.status
      },
      llmCalls: provider.calls,
      toolCalls: calls.entries
    };
    const artifact = {
      ...rawArtifact,
      llmCalls: provider.calls.map(compactLlmCall),
      toolCalls: calls.entries.map(compactCallEntry)
    };

    writeFileSync(join(OUT_DIR, 'combat-tool-chain.json'), `${JSON.stringify(artifact, jsonReplacer, 2)}\n`);
    writeFileSync(join(OUT_DIR, 'combat-tool-chain.raw.json'), `${JSON.stringify(rawArtifact, jsonReplacer, 2)}\n`);
    writeFileSync(join(OUT_DIR, 'combat-tool-chain.md'), renderMarkdown(artifact));
    console.log(`Combat module debug complete: ${join(OUT_DIR, 'combat-tool-chain.md')}`);
  } finally {
    appDatabase.close();
  }
}

async function seedCombatSetup(manager, chatSessionId) {
  await manager.executeTool('system.npc_state.patch_state', {
    chatSessionId,
    sceneId: SCENE_ID,
    npcId: 'pc_arin',
    actorType: 'player',
    isPlayer: true,
    name: '阿林',
    values: { hp: 22, maxHp: 22, armorClass: 14, speed: 30 },
    statusBar: { hp: 22, maxHp: 22 }
  });
  await manager.executeTool('system.resources.reset_action_economy', {
    chatSessionId,
    sceneId: SCENE_ID,
    npcId: 'pc_arin',
    movementMax: 30,
    source: 'combat-module-debug-setup'
  });
}

function installToolCallRecorder(manager) {
  const entries = [];
  const originalExecuteTool = manager.executeTool.bind(manager);
  let depth = 0;
  let phaseGetter = () => 'unknown';

  manager.executeTool = async (...args) => {
    const invocation = normalizeInvocation(args);
    const entry = {
      index: entries.length + 1,
      phase: phaseGetter(),
      depth,
      toolId: invocation.toolId,
      input: cloneJson(invocation.input),
      context: cloneJson(invocation.context),
      startedAt: new Date().toISOString()
    };
    entries.push(entry);
    depth += 1;
    try {
      const result = await originalExecuteTool(...args);
      entry.status = 'success';
      entry.finishedAt = new Date().toISOString();
      entry.returnValue = cloneJson(result);
      entry.output = cloneJson(result.output);
      return result;
    } catch (error) {
      entry.status = 'error';
      entry.finishedAt = new Date().toISOString();
      entry.error = serializeError(error);
      throw error;
    } finally {
      depth -= 1;
    }
  };

  return {
    entries,
    setPhase(getter) {
      phaseGetter = getter;
    }
  };
}

function normalizeInvocation(args) {
  const [toolIdOrPluginId, maybeToolNameOrInput, maybeInput, context] = args;
  const hasExplicitToolName = typeof maybeToolNameOrInput === 'string';
  return {
    toolId: hasExplicitToolName
      ? `${toolIdOrPluginId}.${maybeToolNameOrInput}`
      : String(toolIdOrPluginId),
    input: hasExplicitToolName ? maybeInput : maybeToolNameOrInput,
    context: hasExplicitToolName ? context : maybeInput
  };
}

function combatStartDecision() {
  return {
    decisionId: 'combat_start_debug_bridge',
    status: 'judged',
    shouldStartBattle: true,
    battleName: '调试桥面战斗',
    reason: '亡灵队长已经拔剑堵桥，敌意明确，进入战斗。',
    participantIds: ['pc_arin', 'npc_wight_captain'],
    allyIds: ['pc_arin'],
    enemyIds: ['npc_wight_captain'],
    objective: '击败或迫退亡灵队长，夺回桥面通行权。',
    stakes: '失败会让队伍被堵在桥头并失去推进窗口。',
    recommendedOpening: '从桥面中距离开始，双方都有一次标准动作。',
    metadata: { debug: true }
  };
}

function combatAftermath() {
  return {
    aftermathId: 'combat_after_debug_bridge',
    status: 'planned',
    battleId: BATTLE_ID,
    outcome: 'won',
    rewardPlan: {
      rewards: [
        { type: 'information', summary: '尸妖残骸中露出桥下暗门的线索。' },
        { type: 'loot', summary: '一枚旧通行税铜印。' }
      ],
      withheldRewards: [],
      rationale: '这是小规模调试战斗，奖励保持轻量并以线索为主。'
    },
    influencePlan: {
      npcUpdates: [],
      factionUpdates: [],
      mapUpdates: [
        { mapId: 'debug_bridge_map', summary: '桥面暂时安全。' }
      ],
      questOrEncounterHooks: ['桥下暗门可能通往下一处遭遇。']
    },
    narrativeSummary: '亡灵队长倒下后，桥面恢复短暂安静。',
    metadata: { debug: true }
  };
}

function compactCallEntry(entry) {
  return removeUndefined({
    index: entry.index,
    phase: entry.phase,
    depth: entry.depth,
    toolId: entry.toolId,
    status: entry.status,
    input: entry.input,
    context: entry.context,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    output: entry.status === 'success' ? compactToolOutput(entry) : undefined,
    error: entry.status === 'error' ? entry.error : undefined
  });
}

function compactLlmCall(call = {}) {
  const messages = call.request?.messages || [];
  return {
    index: call.index,
    request: {
      system: messages.find((message) => message.role === 'system')?.content,
      user: compactPromptText(messages.find((message) => message.role === 'user')?.content || ''),
      temperature: call.request?.temperature,
      maxTokens: call.request?.maxTokens
    },
    response: call.response
  };
}

function compactPromptText(text = '') {
  const content = String(text || '');
  return removeUndefined({
    sceneActionText: extractPromptSection(content, 'Scene/action text:', 'Collected context:'),
    endText: extractPromptSection(content, 'End text:', 'Collected context:'),
    battleOutcome: content.match(/Battle outcome:\s*([^\n]+)/)?.[1],
    userRules: extractFirstMatchingBlock(content, [
      ['User combat start rules:', 'Scene/action text:'],
      ['User aftermath rules:', 'Battle outcome:']
    ]),
    returnShape: summarizeReturnShape(content),
    omittedCharacters: Math.max(0, content.length - 1200)
  });
}

function extractFirstMatchingBlock(content, pairs) {
  for (const [start, end] of pairs) {
    const section = extractPromptSection(content, start, end);
    if (section) return section;
  }
  return undefined;
}

function extractPromptSection(content, start, end) {
  const startIndex = content.indexOf(start);
  if (startIndex === -1) return undefined;
  const valueStart = startIndex + start.length;
  const endIndex = content.indexOf(end, valueStart);
  const raw = content.slice(valueStart, endIndex === -1 ? undefined : endIndex).trim();
  return raw ? truncateText(raw, 500) : undefined;
}

function summarizeReturnShape(content) {
  if (content.includes('combat start decision')) return 'COMBAT_START_DECISION_TEMPLATE';
  if (content.includes('combat aftermath')) return 'COMBAT_AFTERMATH_TEMPLATE';
  return undefined;
}

function truncateText(text, maxLength) {
  const content = String(text || '');
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}... [truncated ${content.length - maxLength} chars]`;
}

function compactToolOutput(entry) {
  const output = entry.output || {};
  switch (entry.toolId) {
    case 'system.combat.judge_start':
      return {
        decision: compactStartDecision(output.decision),
        llmUsed: Boolean(output.rawDecision),
        context: compactContext(output.context)
      };
    case 'system.combat.start_battle':
      return {
        ok: output.ok,
        skipped: output.skipped,
        reason: output.reason,
        battle: compactBattleRecord(output.battle),
        event: compactCombatEvent(output.event),
        decision: compactStartDecision(output.decision)
      };
    case 'system.combat.spawn_combatant':
      return {
        ok: output.ok,
        dryRun: output.dryRun,
        llmUsed: output.llmUsed,
        enemy: compactEnemy(output.enemy),
        state: compactNpcRecord(output.state?.record),
        actionEconomy: compactToolOutput({
          toolId: 'system.resources.reset_action_economy',
          output: output.actionEconomy?.output || output.actionEconomy
        }),
        event: compactCombatEvent(output.event)
      };
    case 'system.combat.resolve_action':
      return compactResolveAction(output);
    case 'system.combat.resolve_enemy_turn':
      return {
        ok: output.ok,
        status: output.status,
        dryRun: output.dryRun,
        llmUsed: output.llmUsed,
        actorId: output.actorId,
        targetId: output.targetId,
        ordinaryAction: compactOrdinaryAction(output.ordinaryAction),
        actionInput: compactActionInput(output.actionInput),
        actionResult: compactNestedActionResult(output.actionResult || {})
      };
    case 'system.combat.summarize_battle_result':
      return {
        summary: compactBattleSummary(output.summary),
        llmUsed: output.llmUsed,
        aiContext: truncateText(output.aiContext, 800)
      };
    case 'system.combat.plan_aftermath':
      return {
        aftermath: compactAftermathOutput(output.aftermath),
        context: compactContext(output.context),
        llmUsed: Boolean(output.rawAftermath)
      };
    case 'system.combat.end_battle':
      return {
        battle: compactBattleRecord(output.battle),
        event: compactCombatEvent(output.event),
        aftermath: compactAftermathOutput(output.aftermath)
      };
    case 'system.npc_state.patch_state':
      return {
        record: compactNpcRecord(output.record),
        patchedFields: Object.keys(entry.input || {}).filter((key) => !['chatSessionId', 'sceneId', 'npcId', 'id', 'recordId', 'source'].includes(key))
      };
    case 'system.npc_state.get_state':
      return compactNpcRecord(output);
    case 'system.npc_state.list_states':
      return compactRecordList(output, compactNpcRecord);
    case 'system.scene_npcs.list_mounted_npcs':
      return compactRecordList(output, compactRecord);
    case 'system.time.list_turn_order':
      return compactGeneric(output);
    case 'system.resources.reset_action_economy':
      return {
        ok: output.ok,
        actorId: output.actorId,
        actionEconomy: compactActionEconomy(output.actionEconomy),
        record: compactNpcRecord(output.record)
      };
    case 'system.resources.get_actor_resources':
      return {
        actor: compactNpcRecord(output.actor),
        snapshot: compactResourceSnapshot(output.snapshot)
      };
    case 'system.resources.spend_action_economy':
      return {
        ok: output.ok,
        actorId: output.actorId,
        resource: output.resource,
        amount: output.amount,
        before: output.before,
        after: output.after,
        actionEconomy: compactActionEconomy(output.actionEconomy)
      };
    case 'system.effects.apply_settlement':
    case 'system.effects.preview_settlement':
      return compactSettlement(output);
    case 'game.dice.check':
      return {
        outcome: output.outcome,
        success: output.success,
        critical: output.critical,
        criticalSuccess: output.criticalSuccess,
        criticalFailure: output.criticalFailure,
        successThreshold: output.successThreshold,
        dice: output.dice?.expression,
        rolls: output.rolls,
        modifierTotal: output.modifierTotal,
        total: output.total
      };
    default:
      return compactGeneric(output);
  }
}

function compactResolveAction(output = {}) {
  return {
    ok: output.ok,
    status: output.status,
    dryRun: output.dryRun,
    llmUsed: output.llmUsed,
    action: compactAction(output.action),
    attack: compactAttack(output.attack),
    damage: output.damage,
    settlement: compactSettlement(output.settlement),
    costPlan: output.costPlan,
    costValidation: compactCostValidation(output.costValidation),
    costApplications: (output.costApplications || []).map(compactCostApplication),
    event: compactCombatEvent(output.event)
  };
}

function compactNestedActionResult(output = {}) {
  return {
    ok: output.ok,
    status: output.status,
    llmUsed: output.llmUsed,
    action: compactAction(output.action),
    attack: compactAttack(output.attack),
    damage: output.damage,
    settlement: compactSettlementTotals(output.settlement),
    costApplications: (output.costApplications || []).map((application) => ({
      cost: application.cost,
      actorId: application.result?.output?.actorId,
      resource: application.result?.output?.resource,
      before: application.result?.output?.before,
      after: application.result?.output?.after
    })),
    event: compactCombatEvent(output.event)
  };
}

function compactSettlementTotals(settlement = {}) {
  if (!settlement || typeof settlement !== 'object') return settlement;
  return removeUndefined({
    settlementId: settlement.settlementId,
    totalDamage: settlement.totalDamage,
    totalHealing: settlement.totalHealing,
    targets: (settlement.targets || []).map((target) => ({
      targetId: target.targetId,
      damage: (target.damage || []).map((damage) => ({
        type: damage.type,
        finalAmount: damage.finalAmount
      }))
    })),
    resultingActors: (settlement.records || []).map((record) => {
      const data = record.data || record;
      return {
        npcId: data.npcId,
        hp: data.values?.hp,
        maxHp: data.values?.maxHp,
        conditions: data.statusBar?.conditions
      };
    })
  });
}

function compactBattleSummary(summary = {}) {
  if (!summary || typeof summary !== 'object') return summary;
  return removeUndefined({
    battleId: summary.battleId,
    sceneId: summary.sceneId,
    name: summary.name,
    outcome: summary.outcome,
    defeatedActorIds: summary.defeatedActorIds,
    actors: summary.actors?.map((actor) => ({
      actorId: actor.actorId,
      name: actor.name,
      hp: actor.hp,
      maxHp: actor.maxHp,
      conditions: actor.conditions,
      statuses: actor.statuses
    })),
    latestEvents: summary.latestEvents?.map((event) => ({
      eventType: event.eventType,
      actorId: event.actorId,
      targetIds: event.targetIds,
      summary: event.summary,
      damage: event.result?.damage,
      settlementTotals: event.result?.settlementTotals
    })),
    eventCount: summary.eventCount,
    llmUsedForOrdinaryCombat: summary.llmUsedForOrdinaryCombat
  });
}

function compactStartDecision(decision = {}) {
  if (!decision || typeof decision !== 'object') return decision;
  return {
    decisionId: decision.decisionId,
    status: decision.status,
    shouldStartBattle: decision.shouldStartBattle,
    battleName: decision.battleName,
    reason: decision.reason,
    participantIds: decision.participantIds,
    allyIds: decision.allyIds,
    enemyIds: decision.enemyIds,
    objective: decision.objective,
    stakes: decision.stakes,
    recommendedOpening: decision.recommendedOpening,
    metadata: decision.metadata
  };
}

function compactBattleRecord(record) {
  if (!record) return undefined;
  return {
    recordId: record.id,
    ...compactBattleData(record.data || record)
  };
}

function compactBattleData(data = {}) {
  if (!data || typeof data !== 'object') return data;
  return removeUndefined({
    battleId: data.battleId,
    sceneId: data.sceneId,
    name: data.name,
    status: data.status,
    participantIds: data.participantIds,
    allyIds: data.allyIds,
    enemyIds: data.enemyIds,
    objective: data.objective,
    stakes: data.stakes,
    startDecision: data.startDecision ? compactStartDecision(data.startDecision) : undefined,
    aftermath: data.aftermath ? compactAftermathOutput(data.aftermath) : undefined,
    startedAt: data.startedAt,
    endedAt: data.endedAt
  });
}

function compactCombatEvent(record) {
  if (!record) return undefined;
  const data = record.data || record;
  return removeUndefined({
    recordId: record.id,
    eventId: data.eventId,
    battleId: data.battleId,
    eventType: data.eventType,
    actorId: data.actorId,
    targetIds: data.targetIds,
    sourceText: data.sourceText,
    summary: data.summary,
    llmUsed: data.metadata?.llmUsed,
    resultKeys: data.result ? Object.keys(data.result) : undefined
  });
}

function compactEnemy(enemy = {}) {
  if (!enemy || typeof enemy !== 'object') return enemy;
  return removeUndefined({
    enemyId: enemy.enemyId,
    name: enemy.name,
    actorType: enemy.actorType,
    sceneId: enemy.sceneId,
    threatTier: enemy.threatTier,
    values: compactValues(enemy.values),
    defenses: enemy.defenses,
    normalActionPolicy: compactActionPolicy(enemy.normalActionPolicy),
    specialHooks: enemy.specialHooks,
    lootHints: enemy.lootHints,
    plotTags: enemy.plotTags
  });
}

function compactNpcRecord(record) {
  if (!record) return undefined;
  const data = record.data || record;
  return removeUndefined({
    recordId: record.id,
    npcId: data.npcId,
    name: data.name,
    actorType: data.actorType,
    isPlayer: data.isPlayer,
    values: compactValues(data.values),
    conditions: data.statusBar?.conditions,
    deathSaves: data.statusBar?.deathSaves,
    action: data.resources?.actionEconomy?.action?.current ?? data.statusBar?.actionEconomy?.action?.current,
    specialStatuses: compactStatuses(data.specialStatuses)
  });
}

function compactValues(values = {}) {
  if (!values || typeof values !== 'object') return values;
  return removeUndefined({
    hp: values.hp,
    maxHp: values.maxHp,
    temporaryHp: values.temporaryHp,
    armorClass: values.armorClass,
    ac: values.ac,
    speed: values.speed,
    deathSaveSuccesses: values.deathSaveSuccesses,
    deathSaveFailures: values.deathSaveFailures
  });
}

function compactStatusBar(statusBar = {}) {
  if (!statusBar || typeof statusBar !== 'object') return statusBar;
  return removeUndefined({
    hp: statusBar.hp,
    maxHp: statusBar.maxHp,
    temporaryHp: statusBar.temporaryHp,
    conditions: statusBar.conditions,
    deathSaves: statusBar.deathSaves,
    defenses: statusBar.defenses,
    combat: statusBar.combat,
    combatModifiers: statusBar.combatModifiers
  });
}

function compactStatuses(statuses = []) {
  return (statuses || []).map((status) => ({
    id: status.id,
    name: status.name,
    active: status.active,
    remainingTurns: status.remainingTurns,
    intensity: status.intensity,
    source: status.source,
    metadata: status.metadata && Object.keys(status.metadata).length ? status.metadata : undefined
  }));
}

function compactActionEconomy(actionEconomy = {}) {
  if (!actionEconomy || typeof actionEconomy !== 'object') return actionEconomy;
  return emptyToUndefined(removeUndefined({
    action: compactPool(actionEconomy.action),
    bonusAction: compactPool(actionEconomy.bonusAction),
    reaction: compactPool(actionEconomy.reaction),
    movement: compactPool(actionEconomy.movement),
    turnId: actionEconomy.turnId
  }));
}

function compactPool(pool = {}) {
  if (!pool || typeof pool !== 'object') return pool;
  return emptyToUndefined(removeUndefined({
    current: pool.current,
    max: pool.max,
    available: pool.available,
    unit: pool.unit
  }));
}

function compactActionPolicy(policy = {}) {
  if (!policy || typeof policy !== 'object') return policy;
  return removeUndefined({
    actionTableId: policy.actionTableId,
    actorId: policy.actorId,
    weights: policy.weights,
    probabilities: policy.probabilities,
    attack: compactActionPayload(policy.attack),
    defense: compactActionPayload(policy.defense),
    dodge: compactActionPayload(policy.dodge)
  });
}

function compactActionPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  return removeUndefined({
    mode: payload.mode,
    targetPolicy: payload.targetPolicy,
    successThreshold: payload.successThreshold,
    diceCount: payload.diceCount,
    diceSides: payload.diceSides,
    modifier: payload.modifier,
    damage: payload.damage,
    damageRolls: payload.damageRolls,
    acBonus: payload.acBonus,
    temporaryHp: payload.temporaryHp,
    incomingAttackDisadvantage: payload.incomingAttackDisadvantage,
    dexSaveAdvantage: payload.dexSaveAdvantage,
    durationRounds: payload.durationRounds,
    resourceCosts: payload.resourceCosts
  });
}

function compactAction(action = {}) {
  if (!action || typeof action !== 'object') return action;
  return removeUndefined({
    actionId: action.actionId,
    battleId: action.battleId,
    sceneId: action.sceneId,
    actorId: action.actorId,
    targetIds: action.targetIds,
    actionKind: action.actionKind,
    sourceText: action.sourceText,
    metadata: action.metadata
  });
}

function compactActionInput(input = {}) {
  if (!input || typeof input !== 'object') return input;
  return removeUndefined({
    chatSessionId: input.chatSessionId,
    sceneId: input.sceneId,
    battleId: input.battleId,
    actionId: input.actionId,
    actorId: input.actorId,
    targetId: input.targetId,
    actionKind: input.actionKind,
    sourceText: input.sourceText,
    attack: input.attack,
    damage: input.damage,
    damageRolls: input.damageRolls,
    resourceCosts: input.resourceCosts,
    metadata: input.metadata
  });
}

function compactAttack(attack = {}) {
  if (!attack || typeof attack !== 'object') return attack;
  return removeUndefined({
    outcome: attack.outcome,
    hit: attack.hit,
    miss: attack.miss,
    critical: attack.critical,
    criticalSuccess: attack.criticalSuccess,
    criticalFailure: attack.criticalFailure,
    total: attack.total,
    successThreshold: attack.successThreshold,
    margin: attack.margin,
    input: attack.input,
    diceOutput: attack.output ? compactToolOutput({ toolId: 'game.dice.check', output: attack.output }) : undefined
  });
}

function compactSettlement(settlement = {}) {
  if (!settlement || typeof settlement !== 'object') return settlement;
  if (settlement.skipped) return settlement;
  return removeUndefined({
    settlementId: settlement.settlementId,
    sourceActionId: settlement.sourceActionId,
    source: settlement.source,
    totalDamage: settlement.totalDamage,
    totalHealing: settlement.totalHealing,
    dryRun: settlement.dryRun,
    targets: (settlement.targets || []).map(compactSettlementTarget),
    records: (settlement.records || []).map(compactNpcRecord)
  });
}

function compactSettlementTarget(target = {}) {
  return removeUndefined({
    targetId: target.targetId,
    name: target.name,
    hit: target.hit,
    damage: (target.damage || []).map((damage) => ({
      type: damage.type,
      amount: damage.amount,
      finalAmount: damage.finalAmount,
      ignored: damage.ignored,
      reason: damage.reason
    })),
    healing: target.healing,
    temporaryHp: target.temporaryHp,
    statusEffects: target.statusEffects,
    concentrationCheck: target.concentrationCheck,
    deathSaves: target.deathSaves
  });
}

function compactCostValidation(validation = {}) {
  if (!validation || typeof validation !== 'object') return validation;
  return removeUndefined({
    ok: validation.ok,
    actorId: validation.actorId,
    costs: validation.costs?.map((cost) => ({
      cost: cost.cost,
      ok: cost.ok,
      available: cost.available,
      requested: cost.requested
    }))
  });
}

function compactCostApplication(application = {}) {
  return removeUndefined({
    cost: application.cost,
    toolId: application.result?.toolId,
    output: application.result
      ? compactToolOutput({ toolId: application.result.toolId, output: application.result.output })
      : undefined
  });
}

function compactOrdinaryAction(ordinaryAction = {}) {
  if (!ordinaryAction || typeof ordinaryAction !== 'object') return ordinaryAction;
  return removeUndefined({
    noLlm: ordinaryAction.noLlm,
    roll: ordinaryAction.roll,
    selected: ordinaryAction.selected ? {
      mode: ordinaryAction.selected.mode,
      probability: ordinaryAction.selected.probability,
      range: ordinaryAction.selected.range,
      payload: compactActionPayload(ordinaryAction.selected.payload)
    } : undefined,
    actionTable: compactActionPolicy(ordinaryAction.actionTable)
  });
}

function compactAftermathOutput(aftermath = {}) {
  if (!aftermath || typeof aftermath !== 'object') return aftermath;
  return removeUndefined({
    aftermathId: aftermath.aftermathId,
    status: aftermath.status,
    battleId: aftermath.battleId,
    outcome: aftermath.outcome,
    rewardPlan: aftermath.rewardPlan,
    influencePlan: aftermath.influencePlan,
    narrativeSummary: aftermath.narrativeSummary,
    metadata: aftermath.metadata
  });
}

function compactContext(context = {}) {
  if (!context || typeof context !== 'object') return context;
  return removeUndefined({
    chatSessionId: context.chatSessionId,
    sceneId: context.sceneId,
    battleId: context.battleId,
    sourceText: context.sourceText,
    sources: context.sources ? {
      battle: context.sources.battle ? compactBattleData(context.sources.battle) : undefined,
      events: context.sources.events ? {
        count: context.sources.events.length,
        eventTypes: context.sources.events.map((event) => event.eventType)
      } : undefined,
      sceneNpcs: context.sources.sceneNpcs ? {
        count: context.sources.sceneNpcs.records?.length || 0
      } : undefined,
      npcStates: context.sources.npcStates ? {
        count: context.sources.npcStates.records?.length || 0,
        actors: (context.sources.npcStates.records || []).map((record) => {
          const data = record.data || record;
          return {
            npcId: data.npcId,
            name: data.name,
            hp: data.values?.hp,
            maxHp: data.values?.maxHp,
            action: data.resources?.actionEconomy?.action?.current
          };
        })
      } : undefined,
      turnOrder: context.sources.turnOrder ? {
        count: context.sources.turnOrder.records?.length || context.sources.turnOrder.turns?.length || 0
      } : undefined
    } : undefined,
    errors: context.errors?.map((error) => ({
      key: error.key,
      tool: error.tool,
      message: error.error?.message,
      statusCode: error.error?.statusCode
    }))
  });
}

function compactResourceSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return removeUndefined({
    actorId: snapshot.actorId,
    actionEconomy: compactActionEconomy(snapshot.actionEconomy)
  });
}

function compactRecordList(output = {}, mapper = compactRecord) {
  const records = output.records || [];
  return removeUndefined({
    collection: output.collection,
    count: records.length,
    limit: output.limit,
    offset: output.offset,
    records: records.map(mapper)
  });
}

function compactRecord(record) {
  if (!record || typeof record !== 'object') return record;
  return removeUndefined({
    recordId: record.id,
    collection: record.collection,
    data: compactGeneric(record.data)
  });
}

function compactGeneric(value) {
  if (Array.isArray(value)) return value.map(compactGeneric);
  if (!value || typeof value !== 'object') return value;
  if (value.records) return compactRecordList(value);
  if (value.data && value.id) return compactRecord(value);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'trace' || key === 'prompt' || key === 'context') continue;
    result[key] = compactGeneric(entry);
  }
  return result;
}

function renderMarkdown(artifact) {
  const combatCalls = artifact.toolCalls.filter((entry) => entry.phase === 'combat_flow');
  const setupCalls = artifact.toolCalls.filter((entry) => entry.phase === 'setup');
  const lines = [
    '# 战斗模块独立透明测试',
    '',
    `生成时间：${artifact.generatedAt}`,
    `chatSessionId：\`${artifact.chatSessionId}\``,
    `sceneId：\`${artifact.sceneId}\``,
    `battleId：\`${artifact.battleId}\``,
    '',
    '说明：本文只展示每次工具调用新增或改变的关键信息；完整原始返回见 `combat-tool-chain.raw.json`。',
    '',
    '## 判定结果',
    '',
    '```json',
    JSON.stringify(artifact.assertions, jsonReplacer, 2),
    '```',
    '',
    '## LLM 调用',
    '',
    '本次只有两个 LLM 边界：战斗开始判断与战斗善后规划。普通攻击、敌方普通回合、伤害结算和资源消耗没有调用 LLM。',
    ''
  ];

  for (const call of artifact.llmCalls) {
    lines.push(
      `### LLM 调用 ${call.index}`,
      '',
      '请求：',
      '',
      '```json',
      JSON.stringify(call.request, jsonReplacer, 2),
      '```',
      '',
      '返回：',
      '',
      '```json',
      JSON.stringify(call.response, jsonReplacer, 2),
      '```',
      ''
    );
  }

  lines.push(
    '## Setup 工具调用',
    '',
    '这些调用只用于创建可测试的玩家状态和行动经济，不属于“判定开战后”的主链路。',
    ''
  );
  appendToolCalls(lines, setupCalls);

  lines.push(
    '## 判定开战后的工具调用链',
    '',
    '下面按真实执行顺序记录每一次顶层和嵌套 `executeTool` 调用。`depth=0` 是脚本显式调用，`depth>0` 是战斗模块内部调用的下游工具。',
    ''
  );
  appendToolCalls(lines, combatCalls);

  return `${lines.join('\n')}\n`;
}

function appendToolCalls(lines, calls) {
  for (const call of calls) {
    lines.push(
      `### ${call.index}. ${'  '.repeat(call.depth)}${call.toolId}`,
      '',
      `phase：\`${call.phase}\`  depth：\`${call.depth}\`  status：\`${call.status}\``,
      '',
      '传参：',
      '',
      '```json',
      JSON.stringify(call.input ?? {}, jsonReplacer, 2),
      '```',
      '',
      '返回值（精简，只保留本调用新增/变化）：',
      '',
      '```json',
      JSON.stringify(call.output ?? call.error ?? {}, jsonReplacer, 2),
      '```',
      ''
    );
  }
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, jsonReplacer));
}

function removeUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function emptyToUndefined(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.keys(value).length ? value : undefined;
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
