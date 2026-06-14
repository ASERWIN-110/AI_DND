import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AppDatabase,
  SQLiteDataManager,
  createDefaultToolPluginManager
} from '../src/index.js';

const OUT_DIR = join(process.cwd(), 'manuals', 'generated-debug', 'no-llm-combat');
const SCENE_ID = 'no_llm_arena';
const BATTLE_ID = 'battle_no_llm_5_rounds';
const PLAYER_ID = 'pc_arin';
const ENEMY_ID = 'npc_training_wight';
const ROUND_COUNT = 5;

class NoLlmProvider {
  constructor() {
    this.calls = [];
  }

  async generate(request) {
    this.calls.push(request);
    throw new Error('LLM must not be called during no-LLM combat rounds');
  }
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const provider = new NoLlmProvider();
  const appDatabase = new AppDatabase({ databasePath: ':memory:' });
  const dataManager = new SQLiteDataManager({ databasePath: ':memory:' });
  const manager = createDefaultToolPluginManager({
    appDatabase,
    dataManager,
    chatProvider: provider,
    trace: false
  });
  const recorder = installRecorder(manager);
  let phase = 'setup';
  recorder.setPhase(() => phase);

  const character = appDatabase.importCharacterCard({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'No LLM Combat GM',
      first_mes: 'Begin numeric combat.'
    }
  });
  const chat = appDatabase.createChatSession({
    characterCardId: character.id,
    title: 'No LLM 5-Round Combat Debug',
    includeGreeting: false
  }).session;

  try {
    await seedPlayerMechanics(manager);
    await seedPlayer(manager, chat.id);

    phase = 'combat_setup';
    await manager.executeTool('system.combat.start_battle', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      name: '无 LLM 五轮数值战斗',
      participantIds: [PLAYER_ID, ENEMY_ID],
      allyIds: [PLAYER_ID],
      enemyIds: [ENEMY_ID],
      objective: '用纯数值工具跑完五轮回合战斗。',
      stakes: '验证玩家选择、敌人随机出招、结算和行动经济不依赖 LLM。'
    });
    await spawnEnemy(manager, chat.id);

    let playerHp = 42;
    let enemyHp = 38;
    const playerPlan = [
      'skill_precise_thrust',
      'skill_guard_breaker',
      'skill_precise_thrust',
      'skill_guard_breaker',
      'skill_precise_thrust'
    ];
    const playerHitResults = [
      { outcome: 'hit', hit: true, total: 18, successThreshold: 13 },
      { outcome: 'hit', hit: true, total: 16, successThreshold: 13 },
      { outcome: 'hit', hit: true, total: 21, successThreshold: 13 },
      { outcome: 'hit', hit: true, total: 15, successThreshold: 13 },
      { outcome: 'hit', hit: true, total: 19, successThreshold: 13 }
    ];
    const enemyRolls = [0.1, 0.75, 0.95, 0.2, 0.8];
    const rounds = [];

    for (let round = 1; round <= ROUND_COUNT; round += 1) {
      phase = `round_${round}`;
      const playerHpBefore = playerHp;
      const enemyHpBefore = enemyHp;
      const selectedActionId = playerPlan[round - 1];

      await resetActionEconomy(manager, chat.id, PLAYER_ID, round);
      await resetActionEconomy(manager, chat.id, ENEMY_ID, round);

      const listed = await manager.executeTool('system.combat.list_player_actions', {
        chatSessionId: chat.id,
        sceneId: SCENE_ID,
        battleId: BATTLE_ID,
        actorId: PLAYER_ID,
        targetId: ENEMY_ID
      });
      const listedChoice = listed.output.choices.find((choice) => choice.actionId === selectedActionId);
      const built = await manager.executeTool('system.combat.build_player_action', {
        chatSessionId: chat.id,
        sceneId: SCENE_ID,
        battleId: BATTLE_ID,
        actorId: PLAYER_ID,
        targetId: ENEMY_ID,
        selectedActionId,
        outputActionId: `round_${round}_${selectedActionId}`,
        sourceText: `第 ${round} 轮：阿林选择${listedChoice?.name || selectedActionId}。`,
        hitResult: playerHitResults[round - 1]
      });
      const playerAction = await manager.executeTool('system.combat.resolve_action', built.output.resolveActionInput);
      enemyHp = readActorHpFromSettlement(playerAction.output.settlement, ENEMY_ID, enemyHp);

      const enemyTurn = await manager.executeTool('system.combat.resolve_enemy_turn', {
        chatSessionId: chat.id,
        sceneId: SCENE_ID,
        battleId: BATTLE_ID,
        actorId: ENEMY_ID,
        targetId: PLAYER_ID,
        roll: enemyRolls[round - 1],
        sourceText: `第 ${round} 轮：训练用尸妖从技能/专长/状态候选中随机行动。`
      });
      const enemySummary = summarizeEnemyTurn(enemyTurn.output, playerHp);
      playerHp = enemySummary.playerHpAfter;

      rounds.push({
        round,
        player: {
          availableChoices: listed.output.choices.map(compactChoice),
          selected: compactChoice(built.output.selected),
          hit: playerAction.output.attack?.hit,
          damage: compactDamage(playerAction.output.damage),
          enemyHpBefore,
          enemyHpAfter: enemyHp,
          actionAfterSpend: actionAfterSpend(playerAction.output.costApplications)
        },
        enemy: {
          roll: enemyRolls[round - 1],
          hpBefore: enemyHp,
          hpAfter: enemyHp,
          ...enemySummary
        },
        playerHpBefore,
        playerHpAfter: playerHp,
        llmUsed: Boolean(
          listed.output.llmUsed
          || built.output.llmUsed
          || playerAction.output.llmUsed
          || enemyTurn.output.llmUsed
          || enemyTurn.output.actionResult?.llmUsed
        )
      });
    }

    phase = 'summary';
    const finalSummary = await manager.executeTool('system.combat.summarize_battle_result', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID
    });
    const finalPlayer = await manager.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      npcId: PLAYER_ID
    });
    const finalEnemy = await manager.executeTool('system.npc_state.get_state', {
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      npcId: ENEMY_ID
    });

    assert.equal(provider.calls.length, 0);
    assert.equal(rounds.length, ROUND_COUNT);
    assert.equal(rounds.every((round) => round.llmUsed === false), true);
    assert.equal(rounds.some((round) => round.enemy.selected.mode === 'attack'), true);
    assert.equal(rounds.some((round) => round.enemy.selected.mode === 'defense'), true);
    assert.equal(rounds.some((round) => round.enemy.selected.mode === 'dodge'), true);
    assert.equal(finalSummary.output.summary.llmUsedForOrdinaryCombat, false);

    const rawArtifact = {
      generatedAt: new Date().toISOString(),
      chatSessionId: chat.id,
      sceneId: SCENE_ID,
      battleId: BATTLE_ID,
      roundCount: ROUND_COUNT,
      assertions: {
        llmCallCount: provider.calls.length,
        allRoundsLlmUsed: false,
        finalPlayerHp: finalPlayer.output.data.values.hp,
        finalEnemyHp: finalEnemy.output.data.values.hp,
        ordinaryCombatUsedLlm: finalSummary.output.summary.llmUsedForOrdinaryCombat,
        enemyModesSeen: [...new Set(rounds.map((round) => round.enemy.selected.mode))]
      },
      rounds,
      toolCalls: recorder.entries
    };
    const artifact = {
      ...rawArtifact,
      toolCalls: recorder.entries.map(compactCall)
    };

    writeFileSync(join(OUT_DIR, 'no-llm-5-rounds.json'), `${JSON.stringify(artifact, jsonReplacer, 2)}\n`);
    writeFileSync(join(OUT_DIR, 'no-llm-5-rounds.raw.json'), `${JSON.stringify(rawArtifact, jsonReplacer, 2)}\n`);
    writeFileSync(join(OUT_DIR, 'no-llm-5-rounds.md'), renderMarkdown(artifact));
    console.log(`No-LLM combat debug complete: ${join(OUT_DIR, 'no-llm-5-rounds.md')}`);
  } finally {
    dataManager.close();
    appDatabase.close();
  }
}

async function seedPlayerMechanics(manager) {
  const context = { authorization: true };
  await manager.executeTool('system.mechanics_registry.upsert_skill', {
    id: 'skill_precise_thrust',
    name: '精准刺击',
    category: 'combat',
    mechanicalEffect: '一次稳定的穿刺攻击。',
    metadata: {
      combatAction: {
        actionKind: 'attack',
        mode: 'attack',
        modifier: 6,
        damage: [{ type: 'piercing', amount: 6 }]
      }
    }
  }, undefined, context);
  await manager.executeTool('system.mechanics_registry.upsert_skill', {
    id: 'skill_guard_breaker',
    name: '破势斩',
    category: 'combat',
    mechanicalEffect: '一次较轻但可靠的破防攻击。',
    metadata: {
      combatAction: {
        actionKind: 'attack',
        mode: 'attack',
        modifier: 4,
        damage: [{ type: 'slashing', amount: 5 }]
      }
    }
  }, undefined, context);
}

async function seedPlayer(manager, chatSessionId) {
  await manager.executeTool('system.npc_state.patch_state', {
    chatSessionId,
    sceneId: SCENE_ID,
    npcId: PLAYER_ID,
    actorType: 'player',
    isPlayer: true,
    name: '阿林',
    values: { hp: 42, maxHp: 42, armorClass: 14, speed: 30 },
    statusBar: { hp: 42, maxHp: 42 },
    skillBar: {
      actions: [
        { id: 'skill_precise_thrust', name: '精准刺击', mechanicKind: 'skill', skillId: 'skill_precise_thrust' },
        { id: 'skill_guard_breaker', name: '破势斩', mechanicKind: 'skill', skillId: 'skill_guard_breaker' }
      ]
    }
  });
  await resetActionEconomy(manager, chatSessionId, PLAYER_ID, 0);
}

async function spawnEnemy(manager, chatSessionId) {
  await manager.executeTool('system.combat.spawn_combatant', {
    chatSessionId,
    sceneId: SCENE_ID,
    battleId: BATTLE_ID,
      enemyObject: {
        enemyId: ENEMY_ID,
        name: '训练用尸妖',
        threatTier: 'debug_standard',
        values: { hp: 38, maxHp: 38, armorClass: 13, speed: 30 },
        combatMechanics: {
          skills: [{
            id: 'skill_wight_claw',
            name: '阴影爪击',
            category: 'combat',
            numericValues: { weight: 70 },
            metadata: {
              combatAction: {
                mode: 'attack',
                weight: 70,
                successThreshold: -100,
                modifier: 4,
                criticalMode: 'none',
                damage: [{ type: 'necrotic', amount: 3 }]
              }
            }
          }],
          feats: [{
            id: 'feat_guarded_recovery',
            name: '守势回气',
            category: 'combat',
            numericValues: { weight: 20 },
            metadata: {
              combatAction: {
                mode: 'defense',
                weight: 20,
                acBonus: 2,
                temporaryHp: 2,
                durationRounds: 1
              }
            }
          }],
          statuses: [{
            id: 'status_cornered',
            name: '被逼入角落',
            category: 'condition',
            numericValues: { weight: 10 },
            metadata: {
              combatAction: {
                mode: 'dodge',
                weight: 10,
                acBonus: 3,
                durationRounds: 1
              }
            }
          }]
        },
        normalActionPolicy: {
          actorId: ENEMY_ID,
          weights: { attack: 100, defense: 0, dodge: 0 },
        attack: {
          successThreshold: -100,
          diceCount: 1,
          diceSides: 20,
          modifier: 0,
          criticalMode: 'none',
          damage: [{ type: 'necrotic', amount: 1 }]
        }
      }
    }
  });
}

async function resetActionEconomy(manager, chatSessionId, npcId, round) {
  return manager.executeTool('system.resources.reset_action_economy', {
    chatSessionId,
    sceneId: SCENE_ID,
    npcId,
    movementMax: 30,
    source: `no-llm-round-${round}`
  });
}

function summarizeEnemyTurn(output = {}, playerHpBefore) {
  const selected = compactCandidate(output.ordinaryAction?.selected);
  const actionResult = output.actionResult;
  const playerHpAfter = actionResult
    ? readActorHpFromSettlement(actionResult.settlement, PLAYER_ID, playerHpBefore)
    : playerHpBefore;
  return {
    selected,
    selectionSource: output.ordinaryAction?.selectionSource,
    selectionRoll: output.ordinaryAction?.roll,
    ranges: output.ordinaryAction?.ranges,
    mechanics: output.ordinaryAction?.mechanics?.map(compactMechanicRef) || [],
    damage: compactDamage(actionResult?.damage),
    defenseOrDodge: output.settlement ? compactSettlement(output.settlement) : undefined,
    statePatch: compactDefensePatch(output.statePatch),
    playerHpBefore,
    playerHpAfter,
    actionAfterSpend: actionAfterSpend(actionResult?.costApplications || output.costApplications),
    llmUsed: Boolean(output.llmUsed || actionResult?.llmUsed)
  };
}

function installRecorder(manager) {
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
      startedAt: new Date().toISOString()
    };
    entries.push(entry);
    depth += 1;
    try {
      const result = await originalExecuteTool(...args);
      entry.status = 'success';
      entry.finishedAt = new Date().toISOString();
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
  const [toolIdOrPluginId, maybeToolNameOrInput, maybeInput] = args;
  const hasExplicitToolName = typeof maybeToolNameOrInput === 'string';
  return {
    toolId: hasExplicitToolName
      ? `${toolIdOrPluginId}.${maybeToolNameOrInput}`
      : String(toolIdOrPluginId),
    input: hasExplicitToolName ? maybeInput : maybeToolNameOrInput
  };
}

function compactCall(call) {
  return {
    index: call.index,
    phase: call.phase,
    depth: call.depth,
    toolId: call.toolId,
    status: call.status,
    input: compactInput(call.toolId, call.input),
    output: call.status === 'success' ? compactOutput(call.toolId, call.output) : undefined,
    error: call.error
  };
}

function compactInput(toolId, input = {}) {
  if (toolId === 'system.combat.list_player_actions') {
    return pick(input, ['actorId', 'targetId', 'battleId']);
  }
  if (toolId === 'system.combat.build_player_action') {
    return pick(input, ['actorId', 'targetId', 'selectedActionId', 'outputActionId', 'sourceText', 'hitResult']);
  }
  if (toolId === 'system.combat.resolve_action') {
    return {
      actionId: input.actionId,
      actorId: input.actorId,
      targetId: input.targetId,
      actionKind: input.actionKind,
      sourceText: input.sourceText,
      hitResult: input.hitResult,
      damage: input.damage,
      metadata: input.metadata
    };
  }
  if (toolId === 'system.combat.resolve_enemy_turn') {
    return pick(input, ['actorId', 'targetId', 'roll', 'sourceText']);
  }
  if (toolId.startsWith('system.mechanics_registry.get_')) {
    return pick(input, ['id']);
  }
  if (toolId.startsWith('system.mechanics_registry.upsert_')) {
    return {
      id: input.id,
      name: input.name,
      category: input.category,
      numericValues: input.numericValues,
      combatAction: input.metadata?.combatAction
    };
  }
  if (toolId.startsWith('system.resources.')) {
    return pick(input, ['npcId', 'resource', 'amount', 'source']);
  }
  if (toolId === 'system.npc_state.patch_state') {
    return {
      npcId: input.npcId,
      actorType: input.actorType,
      isPlayer: input.isPlayer,
      values: input.values,
      statusBar: input.statusBar,
      skillBar: input.skillBar,
      specialStatuses: input.specialStatuses,
      resources: input.resources,
      source: input.source
    };
  }
  if (toolId === 'system.npc_state.get_state') {
    return pick(input, ['npcId', 'sceneId']);
  }
  return input;
}

function compactOutput(toolId, output = {}) {
  if (toolId === 'system.combat.start_battle') {
    return {
      ok: output.ok,
      battle: compactBattle(output.battle),
      event: compactEvent(output.event),
      llmUsed: false
    };
  }
  if (toolId === 'system.combat.spawn_combatant') {
    return {
      ok: output.ok,
      llmUsed: output.llmUsed,
      enemy: compactEnemy(output.enemy),
      mechanicWrites: output.mechanicWrites?.map((write) => ({
        tool: write.tool,
        id: write.id,
        name: write.name
      })),
      state: compactActorRecord(output.state?.record),
      event: compactEvent(output.event)
    };
  }
  if (toolId === 'system.combat.list_player_actions') {
    return {
      actor: compactListedActor(output.actor),
      choices: output.choices?.map(compactChoice),
      mechanics: output.mechanics?.map(compactMechanicRef),
      noLlm: output.noLlm
    };
  }
  if (toolId === 'system.combat.build_player_action') {
    return {
      selected: compactChoice(output.selected),
      resolveActionInput: compactInput('system.combat.resolve_action', output.resolveActionInput),
      noLlm: output.noLlm
    };
  }
  if (toolId === 'system.combat.resolve_action') return compactActionResult(output);
  if (toolId === 'system.combat.resolve_enemy_turn') {
    return {
      ok: output.ok,
      status: output.status,
      llmUsed: output.llmUsed,
      actorId: output.actorId,
      targetId: output.targetId,
      selectionSource: output.ordinaryAction?.selectionSource,
      selected: compactCandidate(output.ordinaryAction?.selected),
      roll: output.ordinaryAction?.roll,
      ranges: output.ordinaryAction?.ranges,
      mechanics: output.ordinaryAction?.mechanics?.map(compactMechanicRef),
      actionInput: output.actionInput ? compactInput('system.combat.resolve_action', output.actionInput) : undefined,
      actionResult: output.actionResult ? compactActionResult(output.actionResult) : undefined,
      settlement: output.settlement ? compactSettlement(output.settlement) : undefined,
      statePatch: compactDefensePatch(output.statePatch),
      statePatchResult: compactActorRecord(output.statePatchResult?.record),
      actionCost: compactCostApplications(output.costApplications)
    };
  }
  if (toolId === 'system.effects.apply_settlement') return compactSettlement(output);
  if (toolId === 'system.resources.reset_action_economy') {
    return {
      ok: output.ok,
      actorId: output.actorId,
      action: output.actionEconomy?.action?.current,
      movement: output.actionEconomy?.movement?.current
    };
  }
  if (toolId === 'system.resources.get_actor_resources') {
    return {
      actorId: output.snapshot?.actorId || output.actor?.data?.npcId,
      action: output.snapshot?.actionEconomy?.action?.current
    };
  }
  if (toolId === 'system.resources.spend_action_economy') {
    return pick(output, ['ok', 'actorId', 'resource', 'before', 'after']);
  }
  if (toolId === 'game.dice.check') {
    return pick(output, ['outcome', 'success', 'forced', 'total', 'successThreshold', 'rolls']);
  }
  if (toolId === 'system.npc_state.patch_state' || toolId === 'system.npc_state.get_state') {
    return compactActorRecord(output.record || output);
  }
  if (toolId.startsWith('system.mechanics_registry.get_') || toolId.startsWith('system.mechanics_registry.upsert_')) {
    return compactMechanicRecord(output);
  }
  if (toolId === 'system.combat.summarize_battle_result') {
    return {
      summary: {
        battleId: output.summary?.battleId,
        actors: output.summary?.actors,
        eventCount: output.summary?.eventCount,
        llmUsedForOrdinaryCombat: output.summary?.llmUsedForOrdinaryCombat
      },
      llmUsed: output.llmUsed
    };
  }
  return output;
}

function compactActionResult(output = {}) {
  return {
    ok: output.ok,
    status: output.status,
    llmUsed: output.llmUsed,
    action: {
      actionId: output.action?.actionId,
      actorId: output.action?.actorId,
      targetIds: output.action?.targetIds,
      actionKind: output.action?.actionKind,
      metadata: output.action?.metadata
    },
    attack: output.attack ? pick(output.attack, ['outcome', 'hit', 'total', 'successThreshold']) : undefined,
    damage: compactDamage(output.damage),
    settlement: compactSettlement(output.settlement),
    actionCost: compactCostApplications(output.costApplications),
    event: compactEvent(output.event)
  };
}

function compactSettlement(settlement = {}) {
  if (!settlement || settlement.skipped) return settlement;
  return {
    settlementId: settlement.settlementId,
    totalDamage: settlement.totalDamage,
    totalHealing: settlement.totalHealing,
    targets: settlement.targets?.map((target) => ({
      targetId: target.targetId,
      damage: target.damage?.map((damage) => ({
        type: damage.type,
        finalAmount: damage.finalAmount
      })),
      temporaryHp: target.temporaryHp
    })),
    resultingActors: settlement.records?.map((record) => {
      const data = record.data || record;
      return {
        npcId: data.npcId,
        hp: data.values?.hp,
        temporaryHp: data.values?.temporaryHp,
        maxHp: data.values?.maxHp,
        action: data.resources?.actionEconomy?.action?.current,
        conditions: data.statusBar?.conditions,
        combatModifiers: data.statusBar?.combatModifiers,
        specialStatuses: data.specialStatuses?.map((status) => pick(status, ['id', 'name', 'active', 'remainingTurns']))
      };
    })
  };
}

function compactChoice(choice = {}) {
  return removeEmpty({
    actionId: choice.actionId,
    name: choice.name,
    mode: choice.mode,
    actionKind: choice.actionKind,
    source: choice.source,
    mechanic: choice.mechanic,
    ready: choice.ready,
    requiresTarget: choice.requiresTarget,
    damage: compactDamage(choice.damage),
    attack: choice.attack ? pick(choice.attack, ['successThreshold', 'diceCount', 'diceSides', 'modifier', 'criticalMode']) : undefined,
    resourceCosts: choice.resourceCosts
  });
}

function compactCandidate(candidate = {}) {
  return removeEmpty({
    actionId: candidate.actionId,
    name: candidate.name,
    mode: candidate.mode,
    actionKind: candidate.actionKind,
    weight: candidate.weight,
    source: candidate.source,
    mechanic: candidate.mechanic,
    payload: compactCandidatePayload(candidate.payload)
  });
}

function compactCandidatePayload(payload = {}) {
  return removeEmpty({
    mode: payload.mode,
    successThreshold: payload.successThreshold,
    successThresholdPolicy: payload.successThresholdPolicy,
    modifier: payload.modifier,
    damage: compactDamage(payload.damage),
    acBonus: payload.acBonus,
    temporaryHp: payload.temporaryHp,
    durationRounds: payload.durationRounds,
    targetPolicy: payload.targetPolicy,
    resourceCosts: payload.resourceCosts
  });
}

function compactMechanicRef(mechanic = {}) {
  const data = mechanic.data || mechanic.record?.data || mechanic;
  return removeEmpty({
    kind: mechanic.kind,
    id: mechanic.id || data.id,
    source: mechanic.source,
    name: data.name,
    numericValues: data.numericValues,
    combatAction: data.metadata?.combatAction || data.metadata?.action
  });
}

function compactMechanicRecord(record = {}) {
  const data = record.data || record.record?.data || record;
  return removeEmpty({
    id: data.id || record.id,
    name: data.name,
    category: data.category,
    numericValues: data.numericValues,
    combatAction: data.metadata?.combatAction || data.metadata?.action
  });
}

function compactDamage(damage = []) {
  return normalizeArray(damage).map((item) => pick(item, ['type', 'amount', 'finalAmount']));
}

function compactCostApplications(costApplications = []) {
  return normalizeArray(costApplications).map((item) => ({
    actorId: item.result?.output?.actorId,
    resource: item.result?.output?.resource,
    before: item.result?.output?.before,
    after: item.result?.output?.after
  }));
}

function compactDefensePatch(patch = {}) {
  if (!patch) return undefined;
  return removeEmpty({
    statusBar: patch.statusBar,
    specialStatuses: patch.specialStatuses
  });
}

function compactBattle(record) {
  const data = record?.data || record || {};
  return pick(data, ['battleId', 'name', 'status', 'participantIds', 'allyIds', 'enemyIds']);
}

function compactEnemy(enemy = {}) {
  return {
    enemyId: enemy.enemyId,
    name: enemy.name,
    values: enemy.values,
    fallbackActionPolicy: enemy.normalActionPolicy?.weights
  };
}

function compactActorRecord(record) {
  const data = record?.data || record || {};
  return removeEmpty({
    npcId: data.npcId,
    name: data.name,
    actorType: data.actorType,
    isPlayer: data.isPlayer,
    hp: data.values?.hp,
    temporaryHp: data.values?.temporaryHp,
    maxHp: data.values?.maxHp,
    armorClass: data.values?.armorClass,
    action: data.resources?.actionEconomy?.action?.current,
    skillActions: data.skillBar?.actions?.map((action) => pick(action, ['id', 'name', 'mechanicKind', 'skillId'])),
    combatSkillIds: data.resources?.combat?.skillIds,
    combatFeatIds: data.resources?.combat?.featIds,
    combatStatusIds: data.resources?.combat?.statusIds,
    specialStatuses: data.specialStatuses?.map((status) => pick(status, ['id', 'name', 'active', 'remainingTurns'])),
    combatModifiers: data.statusBar?.combatModifiers
  });
}

function compactListedActor(actor = {}) {
  return removeEmpty({
    actorId: actor.actorId,
    name: actor.name,
    hp: actor.values?.hp,
    action: actor.actionEconomy?.action?.current,
    skillActions: actor.skillBar?.actions?.map((action) => pick(action, ['id', 'name', 'mechanicKind', 'skillId'])),
    specialStatuses: actor.specialStatuses?.map((status) => pick(status, ['id', 'name', 'active']))
  });
}

function compactEvent(record) {
  const data = record?.data || record || {};
  return pick(data, ['eventId', 'eventType', 'actorId', 'targetIds', 'summary']);
}

function actionAfterSpend(costApplications = []) {
  return normalizeArray(costApplications).find((item) => item.result?.output?.resource === 'action')?.result?.output?.after;
}

function readActorHpFromSettlement(settlement = {}, actorId, fallback) {
  const record = normalizeArray(settlement.records)
    .map((item) => item.data || item)
    .find((item) => item.npcId === actorId);
  return record?.values?.hp ?? fallback;
}

function renderMarkdown(artifact) {
  const topLevel = artifact.toolCalls.filter((call) => call.depth === 0);
  const lines = [
    '# 无 LLM 五轮回合战斗调试',
    '',
    `生成时间：${artifact.generatedAt}`,
    `chatSessionId：\`${artifact.chatSessionId}\``,
    `sceneId：\`${artifact.sceneId}\``,
    `battleId：\`${artifact.battleId}\``,
    '',
    '说明：本脚本没有调用 `judge_start`、`judge_special_action`、`plan_aftermath` 或任何 LLM。`NoLlmProvider.generate()` 一旦被调用会直接抛错。',
    '',
    '新增验证点：',
    '',
    '- 玩家每轮先调用 `system.combat.list_player_actions` 从玩家状态和 SQLite 机制表列出技能，再调用 `system.combat.build_player_action` 构造 `resolve_action` 入参。',
    '- 敌人由 `spawn_combatant` 的 enemyObject 自带 `combatMechanics` 生成；召唤时自动写入 SQLite 机制表并写入 NPC 的 `skillBar` / `resources.combat` 引用。',
    '- 敌人 `resolve_enemy_turn` 内部读取敌人状态，调用 `system.mechanics_registry.get_skill/get_feat/get_status`，再按候选权重和本轮 roll 选择 attack/defense/dodge。',
    '- Markdown 中的“返回值”只保留当前工具新增或改变的关键字段；完整原始返回值保存在 `no-llm-5-rounds.raw.json`。',
    '',
    '## 断言',
    '',
    '```json',
    JSON.stringify(artifact.assertions, null, 2),
    '```',
    '',
    '## 五轮概览',
    '',
    '| 轮 | 玩家可选/选择 | 敌人 HP | 敌方 roll/选择 | 玩家 HP | LLM |',
    '|---:|---|---:|---|---:|---:|',
    ...artifact.rounds.map((round) => [
      `| ${round.round}`,
      `${round.player.availableChoices.map((choice) => choice.name).join(' / ')} -> ${round.player.selected.name}，伤害 ${damageText(round.player.damage)}`,
      `${round.player.enemyHpBefore} -> ${round.player.enemyHpAfter}`,
      `${round.enemy.roll} -> ${round.enemy.selected.mode}:${round.enemy.selected.name}，${enemyEffectText(round.enemy)}`,
      `${round.playerHpBefore} -> ${round.playerHpAfter}`,
      `${round.llmUsed} |`
    ].join(' | ')),
    '',
    '## 顶层工具顺序',
    '',
    ...topLevel.map((call) => `- ${call.phase}: \`${call.toolId}\``),
    '',
    '## 每轮调用细节',
    ''
  ];

  for (let round = 1; round <= artifact.roundCount; round += 1) {
    const calls = artifact.toolCalls.filter((call) => call.phase === `round_${round}`);
    lines.push(`### Round ${round}`, '');
    appendCalls(lines, calls);
  }

  lines.push('## Setup / Summary 调用', '');
  appendCalls(lines, artifact.toolCalls.filter((call) => !String(call.phase).startsWith('round_')));
  return `${lines.join('\n')}\n`;
}

function appendCalls(lines, calls) {
  for (const call of calls) {
    lines.push(
      `#### ${call.index}. ${'  '.repeat(call.depth)}${call.toolId}`,
      '',
      `phase：\`${call.phase}\` depth：\`${call.depth}\` status：\`${call.status}\``,
      '',
      '传参：',
      '',
      '```json',
      JSON.stringify(call.input || {}, null, 2),
      '```',
      '',
      '返回值（当前工具新增/改变字段，精简）：',
      '',
      '```json',
      JSON.stringify(call.output || call.error || {}, null, 2),
      '```',
      ''
    );
  }
}

function damageText(damage = []) {
  const items = compactDamage(damage);
  if (!items.length) return '0';
  return items.map((item) => `${item.type}:${item.amount ?? item.finalAmount ?? 0}`).join('+');
}

function enemyEffectText(enemy = {}) {
  if (enemy.damage?.length) return `伤害 ${damageText(enemy.damage)}`;
  const payload = enemy.selected?.payload || {};
  if (enemy.selected?.mode === 'defense') return `临时 HP ${payload.temporaryHp || 0}，AC +${payload.acBonus || 0}`;
  if (enemy.selected?.mode === 'dodge') return `闪避 AC +${payload.acBonus || 0}`;
  return '无直接伤害';
}

function pick(object = {}, keys = []) {
  const output = {};
  for (const key of keys) {
    if (object?.[key] !== undefined) output[key] = object[key];
  }
  return output;
}

function removeEmpty(object = {}) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value, jsonReplacer));
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
